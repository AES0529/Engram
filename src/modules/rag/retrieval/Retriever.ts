/**
 * Retriever Service
 *
 * V0.8.5: 扩展支持向量检索 + Rerank 混合召回
 *
 * 召回模式：
 * - full: 预处理 + Embedding + Rerank
 * - standard: Embedding + Rerank
 * - light: 仅 Embedding
 * - llm_only: LLM 直接召回 (未实现，留作后续)
 */

import { SettingsManager } from '@/config/settings';
import { RecallLogService } from '@/core/logger/RecallLogger';
import { tryGetDbForChat } from '@/data/db';
import { getCurrentChatId } from '@/integrations/tavern';

import { DEFAULT_BRAIN_RECALL_CONFIG, DEFAULT_RECALL_CONFIG } from '@/config/types/defaults';
import type { BrainRecallConfig, RecallConfig, RerankConfig, VectorConfig } from '@/config/types/rag';
import { Logger, LogModule } from '@/core/logger';
import type { EventNode } from '@/data/types/graph';
import type { AgenticRecall } from '@/modules/preprocessing/types';
import { brainRecallCache, type RecallCandidate } from './BrainRecallCache';


// ==================== 类型定义 ====================

export interface RetrievalResult {
    entries: string[]; // Formatted entries ready for injection
    nodes: EventNode[]; // Raw nodes
    candidates?: any[]; // V1.4: 曝露带分数的候选列表供前端装配
}

// ==================== Retriever ====================

class Retriever {
    /**
     * 获取召回配置
     */
    private getRecallConfig(): RecallConfig {
        const apiSettings = SettingsManager.get('apiSettings');
        return apiSettings?.recallConfig || DEFAULT_RECALL_CONFIG;
    }

    // Fix P1: 缓存 hasVectorizedNodes 结果，避免每次都扫全表
    private _hasVectorizedNodesCache: boolean | null = null;

    /**
     * 检查是否存在已向量化的节点
     * 用于决定是否需要执行向量检索
     */
    async hasVectorizedNodes(): Promise<boolean> {
        const chatId = getCurrentChatId();
        if (!chatId) return false;

        const db = tryGetDbForChat(chatId);
        if (!db) return false;

        // 检查是否存在任何带有 embeddings 的事件
        // 使用 limit(1) 提高效率，只要找到一个就返回 true
        const count = await db.events
            .filter(e => !!e.embedding && e.embedding.length > 0)
            .limit(1)
            .count();

        this._hasVectorizedNodesCache = count > 0;
        return this._hasVectorizedNodesCache;
    }

    /**
     * 清理矢量化节点缓存（暴露给外部在触发 embedding 构建后调用）
     */
    invalidateVectorCache(): void {
        this._hasVectorizedNodesCache = null;
    }

    /**
     * 获取全局向量配置
     */
    private getVectorConfig(): VectorConfig | undefined {
        const apiSettings = SettingsManager.get('apiSettings');
        return apiSettings?.vectorConfig;
    }

    /**
     * 获取 Rerank 配置
     */
    private getRerankConfig(): RerankConfig | null {
        const apiSettings = SettingsManager.get('apiSettings');
        return apiSettings?.rerankConfig || null;
    }

    /**
     * 主入口：根据配置执行召回
     *
     * @param userInput 用户输入
     * @param unifiedQueries 预处理生成的查询词列表 (可选)
     * @returns 召回结果
     */
    async search(userInput: string, unifiedQueries?: string[]): Promise<RetrievalResult> {
        const recallConfig = this.getRecallConfig();
        const vectorConfig = this.getVectorConfig();

        // Fix P0: 不要使用 setConfig 覆盖全局，改用直接传递参数的方式调用
        // 原生 EmbeddingService.embed 不支持直接传 model，但我们只需要保证获取 vectorConfig 时使用 Retriever 的配置
        // 最佳实践是不修改全局 setConfig，如果需要临时覆盖，应在 Embedding 服务内实现 scopedContext
        // 这里为了兼容性且不大量修改底层，我们移除了 setConfig 的危险操作。
        // 目前系统的逻辑是 Retriever 和 Batch 共享同样的配置源，不需要在搜索时强行复写。
        // if (recallConfig.useEmbedding && vectorConfig) {
        //     embeddingService.setConfig(vectorConfig);
        // }



        // 未启用召回，使用滚动窗口策略
        if (!recallConfig.enabled) {
            Logger.debug(LogModule.RAG_RETRIEVE, '召回未启用，使用滚动窗口策略');
            // 注意：这里原本用 config.embedding.topK，现在不能用了
            // 滚动窗口暂时给个默认值或者读取 Config，这里先默认 20
            const limit = recallConfig.embedding?.topK || 20;
            return this.rollingSearch(limit);
        }

        // 向量检索 (含 Rerank)
        if (recallConfig.useEmbedding) {
            return this.hybridSearch(userInput, unifiedQueries, recallConfig);
        }

        // 默认回退
        return this.rollingSearch(recallConfig.embedding?.topK || 20);
    }

    private async hybridSearch(
        userInput: string,
        unifiedQueries: string[] | undefined,
        config: RecallConfig
    ): Promise<RetrievalResult> {
        const startTime = Date.now();

        try {
            const { WorkflowEngine } = await import('@/modules/workflow/core/WorkflowEngine');
            const { createRetrievalWorkflow } = await import('@/modules/workflow/definitions/RetrievalWorkflow');

            const context = await WorkflowEngine.run(createRetrievalWorkflow(), {
                input: {
                    query: userInput,
                    unifiedQueries,
                    mode: 'hybrid'
                },
                data: {
                    recallConfig: config,
                    vectorRetrieveStartTime: startTime
                }
            });

            return context.output as RetrievalResult || { entries: [], nodes: [] };
        } catch (e: any) {
            Logger.error(LogModule.RAG_RETRIEVE, 'Hybrid Search 工作流执行失败', { error: e.message });
            return { entries: [], nodes: [] };
        }
    }


    /**
     * Agentic RAG 直通检索
     * 跳过 Embedding/Rerank，直接按 LLM 裁判给出的 ID 从数据库捣取事件
     *
     * @param recalls LLM 输出的召回决策列表
     * @returns 检索结果
     */
    async agenticSearch(recalls: AgenticRecall[]): Promise<RetrievalResult> {
        const startTime = Date.now();
        const chatId = getCurrentChatId();
        if (!chatId) {
            Logger.warn(LogModule.RAG_RETRIEVE, 'Agentic Search: 无当前聊天');
            return { entries: [], nodes: [] };
        }

        const db = tryGetDbForChat(chatId);
        if (!db) {
            Logger.warn(LogModule.RAG_RETRIEVE, 'Agentic Search: 数据库不可用');
            return { entries: [], nodes: [] };
        }

        // 1. 按 ID 直接从数据库捣取事件
        const ids = recalls.map(r => r.id);
        const events = await db.events.bulkGet(ids);
        const validEvents = events.filter((e): e is EventNode => e != null);

        if (validEvents.length === 0) {
            Logger.warn(LogModule.RAG_RETRIEVE, 'Agentic Search: 无有效事件', {
                requestedIds: ids,
            });
            return { entries: [], nodes: [] };
        }

        Logger.info(LogModule.RAG_RETRIEVE, 'Agentic Search: 数据库查询完成', {
            requested: ids.length,
            found: validEvents.length,
        });

        // 2. 构建 RecallCandidate（用 LLM 给的 score 填充双轨）
        const validEventMap = new Map(validEvents.map(e => [e.id, e]));
        const candidates: RecallCandidate[] = recalls
            .filter(r => validEventMap.has(r.id))
            .map(r => ({
                id: r.id,
                label: validEventMap.get(r.id)!.structured_kv?.event || r.id,
                embeddingScore: r.score,
                rerankScore: r.score, // 双轨同分，让 BrainRecallCache 的门控逻辑正常工作
            }));

        // 3. 送入 BrainRecallCache（自动触发 Decay Bomb）
        const recallConfig = this.getRecallConfig();
        const brainConfig: BrainRecallConfig = recallConfig.brainRecall || DEFAULT_BRAIN_RECALL_CONFIG;
        let finalNodes = validEvents;

        if (brainConfig.enabled) {
            brainRecallCache.setConfig(brainConfig);
            brainRecallCache.nextRound();

            const brainResults = brainRecallCache.process(candidates);

            // 根据 BrainRecallCache 输出重新排序
            const brainIdSet = new Set(brainResults.map(s => s.id));
            finalNodes = validEvents.filter(e => brainIdSet.has(e.id));

            Logger.info(LogModule.RAG_RETRIEVE, 'Agentic Search: 类脑召回已应用', {
                inputCount: candidates.length,
                outputCount: brainResults.length,
                round: brainRecallCache.getCurrentRound(),
            });
        }

        // 4. 记录召回日志
        const totalTime = Date.now() - startTime;
        const brainStats = brainConfig.enabled ? {
            round: brainRecallCache.getCurrentRound(),
            snapshot: brainRecallCache.getShortTermSnapshot()
        } : undefined;

        RecallLogService.log({
            query: '[Agentic RAG]',
            mode: 'agentic',
            results: recalls
                .filter(r => validEventMap.has(r.id))
                .map(r => ({
                    eventId: r.id,
                    summary: validEventMap.get(r.id)!.summary,
                    category: validEventMap.get(r.id)!.structured_kv?.event || 'unknown',
                    embeddingScore: r.score,
                    hybridScore: r.score,
                    isTopK: true,
                    isReranked: false,
                    reason: r.reason,
                })),
            stats: {
                totalCandidates: recalls.length,
                topKCount: validEvents.length,
                rerankCount: 0,
                latencyMs: totalTime,
            },
            brainStats,
        });

        // 5. 返回结果
        const entries = finalNodes.map(n => n.summary);

        Logger.info(LogModule.RAG_RETRIEVE, 'Agentic Search 完成', {
            totalTime,
            resultCount: finalNodes.length,
        });

        return { entries, nodes: finalNodes, candidates };
    }


    /**
     * 滚动窗口策略 (基础模式)
     * 返回最近的事件，不使用向量检索
     */
    private async rollingSearch(limit: number): Promise<RetrievalResult> {
        const chatId = getCurrentChatId();
        if (!chatId) {
            return { entries: [], nodes: [] };
        }

        const db = tryGetDbForChat(chatId);
        if (!db) {
            return { entries: [], nodes: [] };
        }

        // 1. Get recent Level 0 (Details)
        const recentEvents = await db.events
            .filter(node => node.level === 0)
            .reverse()
            .limit(limit)
            .toArray();

        // 2. Get latest Level 1 (Macro Context)
        const latestMacro = await db.events
            .filter(node => node.level === 1)
            .reverse()
            .first();

        const nodes: EventNode[] = [...recentEvents];
        if (latestMacro) {
            nodes.unshift(latestMacro);
        }

        // 3. Format entries
        const entries = nodes.map(node => node.summary);

        return { entries, nodes };
    }

    /**
     * @deprecated 使用 search() 替代
     */
    async vectorSearch(query: string, limit: number): Promise<RetrievalResult> {
        return this.search(query);
    }
}

export const retriever = new Retriever();
