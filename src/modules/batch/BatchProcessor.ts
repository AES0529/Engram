/**
 * BatchProcessor - 批量处理服务
 *
 * V0.9.6: 支持历史消息批处理和外部 txt 导入
 * - 复用 SummarizerService、EntityBuilder、EventTrimmer、EmbeddingService
 * - 有序 Pipeline 队列编排
 */

import { SettingsManager } from '@/config/settings';
import { Logger, LogModule } from '@/core/logger';
import { generateShortUUID } from '@/core/utils';
import { summarizerService } from '@/modules/memory';
import { entityBuilder } from '@/modules/memory/EntityExtractor';
import { eventTrimmer } from '@/modules/memory/EventTrimmer';
import { embeddingService } from '@/modules/rag/embedding/EmbeddingService';
import { WorkflowEngine } from '@/modules/workflow/core/WorkflowEngine';
import { SaveEvent } from '@/modules/workflow/steps/persistence/SaveEvent';
import { ParseJson } from '@/modules/workflow/steps/processing/ParseJson';
import { useMemoryStore } from '@/state/memoryStore';
import { notificationService } from '@/ui/services/NotificationService';
import { BatchUtils } from './utils/BatchUtils';

// ==================== 类型定义 ====================

/** 任务类型 */
type BatchTaskType = 'summary' | 'entity' | 'trim' | 'embed';

/** 任务状态 */
export type BatchTaskStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped';

/** 单个批处理任务 */
export interface BatchTask {
    id: string;
    type: BatchTaskType;
    status: BatchTaskStatus;
    progress: { current: number; total: number };
    floorRange?: { start: number; end: number };
    error?: string;
}

/** 批处理队列 */
export interface BatchQueue {
    tasks: BatchTask[];
    isRunning: boolean;
    isPaused: boolean;
    currentTaskIndex: number;
    overallProgress: { current: number; total: number };
}

/** 历史分析结果 */
export interface HistoryAnalysis {
    currentFloor: number;
    startFloor: number;
    endFloor: number;
    summaryTasks: number;
    entityTasks: number;
    trimTasks: number;
    embedTasks: number;
    estimatedTokens: number;
}

/** 外部导入模式 */
export type ImportMode = 'fast' | 'detailed';

/** 外部导入配置 */
interface ImportConfig {
    mode: ImportMode;
    chunkSize: number;
    overlapSize: number;
}

/** 进度回调 */
type BatchProgressCallback = (queue: BatchQueue) => void;

// ==================== 默认配置 ====================

const DEFAULT_IMPORT_CONFIG: ImportConfig = {
    mode: 'detailed',
    chunkSize: 2000,
    overlapSize: 200,
};

// ==================== BatchProcessor ====================

class BatchProcessor {
    private queue: BatchQueue = {
        tasks: [],
        isRunning: false,
        isPaused: false,
        currentTaskIndex: 0,
        overallProgress: { current: 0, total: 0 },
    };

    private onProgress?: BatchProgressCallback;
    private listeners: Set<BatchProgressCallback> = new Set();
    private stopSignal = false;

    /** 订阅状态更新 */
    subscribe(callback: BatchProgressCallback): () => void {
        this.listeners.add(callback);
        // 立即返回当前状态
        this.notifyProgress();
        return () => {
            this.listeners.delete(callback);
        };
    }

    /** 分析历史消息，计算所需任务 */
    async analyzeHistory(startFloor = 0, endFloor?: number, types?: BatchTaskType[]): Promise<HistoryAnalysis> {
        const status = summarizerService.getStatus();
        const currentFloor = status.currentFloor;
        const targetTypes = new Set(types || ['summary', 'entity', 'trim', 'embed']);

        const summarizerConfig = summarizerService.getConfig();
        const entityConfig = entityBuilder.getConfig();
        const trimConfig = eventTrimmer.getConfig();

        // V1.2 Fix: Apply buffer size to protect recent messages
        const bufferSize = summarizerConfig.bufferSize || 0;
        const maxProcessableFloor = currentFloor - bufferSize;

        // If endFloor is not specified, default to buffered max floor
        // If endFloor IS specified, we respect it (user manual override)
        const targetEnd = endFloor ?? Math.max(0, maxProcessableFloor);
        const floorRange = Math.max(0, targetEnd - startFloor);

        const summaryInterval = summarizerConfig.floorInterval || 10;
        // 如果同步选择了 summary，则 entity 的分片也强行挂载跟随 summary，否则用自己默认的
        const entityInterval = targetTypes.has('summary') ? summaryInterval : (entityConfig.floorInterval || 50);

        const summaryTasks = targetTypes.has('summary') ? Math.ceil(floorRange / summaryInterval) : 0;
        const entityTasks = (targetTypes.has('entity') && entityConfig.enabled) ? Math.ceil(floorRange / entityInterval) : 0;
        const trimThreshold = trimConfig.countLimit || 5;
        const trimTasks = (targetTypes.has('trim') && trimConfig.enabled) ? Math.floor(summaryTasks / trimThreshold) : 0;
        const embedTasks = targetTypes.has('embed') ? (summaryTasks || 1) * 2 : 0;

        const estimatedTokens = summaryTasks * 2000 + entityTasks * 2000 + trimTasks * 2000 + embedTasks * 200;

        return {
            currentFloor,
            startFloor,
            endFloor: targetEnd,
            summaryTasks,
            entityTasks,
            trimTasks,
            embedTasks,
            estimatedTokens,
        };
    }

    /** 构建任务队列 */
    buildQueue(analysis: HistoryAnalysis, types?: BatchTaskType[]): BatchTask[] {
        const tasks: BatchTask[] = [];
        const targetTypes = new Set(types || ['summary', 'entity', 'trim', 'embed']);

        const { startFloor, endFloor, summaryTasks, entityTasks, trimTasks, embedTasks } = analysis;
        const summaryInterval = summarizerService.getConfig().floorInterval || 10;
        const entityInterval = targetTypes.has('summary') ? summaryInterval : (entityBuilder.getConfig().floorInterval || 50);

        // 使用交替插入的方法来保证顺序（先 summary 后 entity）
        const maxTasks = Math.max(summaryTasks, entityTasks);
        for (let i = 0; i < maxTasks; i++) {
            if (i < summaryTasks && targetTypes.has('summary')) {
                const taskStart = startFloor + i * summaryInterval;
                const taskEnd = Math.min(taskStart + summaryInterval, endFloor);
                tasks.push({
                    id: generateShortUUID('job_'),
                    type: 'summary',
                    status: 'pending',
                    progress: { current: 0, total: 1 },
                    floorRange: { start: taskStart, end: taskEnd },
                });
            }
            if (i < entityTasks && targetTypes.has('entity')) {
                const taskStart = startFloor + i * entityInterval;
                const taskEnd = Math.min(taskStart + entityInterval, endFloor);
                tasks.push({
                    id: generateShortUUID('job_'),
                    type: 'entity',
                    status: 'pending',
                    progress: { current: 0, total: 1 },
                    floorRange: { start: taskStart, end: taskEnd },
                });
            }
        }

        for (let i = 0; i < trimTasks; i++) {
            tasks.push({
                id: generateShortUUID('job_'),
                type: 'trim',
                status: 'pending',
                progress: { current: 0, total: 1 },
            });
        }

        if (embedTasks > 0) {
            tasks.push({
                id: generateShortUUID('job_'),
                type: 'embed',
                status: 'pending',
                progress: { current: 0, total: embedTasks },
            });
        }

        return tasks;
    }

    /** 开始批处理 */
    async start(startFloor = 0, endFloor?: number, onProgress?: BatchProgressCallback, types?: BatchTaskType[]): Promise<void> {
        if (this.queue.isRunning) {
            Logger.warn(LogModule.BATCH, '已在运行中');
            return;
        }

        this.onProgress = onProgress;
        this.stopSignal = false;

        const analysis = await this.analyzeHistory(startFloor, endFloor, types);
        this.queue.tasks = this.buildQueue(analysis, types);
        this.queue.overallProgress.total = this.queue.tasks.length;
        this.queue.overallProgress.current = 0;

        if (this.queue.tasks.length === 0) {
            Logger.warn(LogModule.BATCH, '没有生成任何任务');
            return;
        }

        this.queue.isRunning = true;
        this.queue.isPaused = false;
        this.queue.currentTaskIndex = 0;
        this.queue.overallProgress = { current: 0, total: this.queue.tasks.length };

        Logger.info(LogModule.BATCH, `开始执行 ${this.queue.tasks.length} 个任务`);
        this.notifyProgress();
        await this.runQueue();
    }

    /** 执行队列 */
    private async runQueue(): Promise<void> {
        while (this.queue.currentTaskIndex < this.queue.tasks.length) {
            if (this.stopSignal) {
                Logger.info(LogModule.BATCH, '用户停止');
                break;
            }

            if (this.queue.isPaused) {
                await new Promise(resolve => setTimeout(resolve, 500));
                continue;
            }

            const task = this.queue.tasks[this.queue.currentTaskIndex];
            task.status = 'running';
            this.notifyProgress();

            try {
                await this.executeTask(task);
                task.status = 'done';
                task.progress.current = task.progress.total;
            } catch (error) {
                task.status = 'error';
                task.error = String(error);
                Logger.warn(LogModule.BATCH, `任务 ${task.type} ${task.floorRange ? `(${task.floorRange.start} - ${task.floorRange.end})` : ''} 失败, 容错跳过`, { error: String(error) });
                // 仅抛出容假警告，不中断批队列，使断点续传后续可继续
                continue;
            }

            this.queue.currentTaskIndex++;
            this.queue.overallProgress.current = this.queue.currentTaskIndex;
            this.notifyProgress();
        }

        this.queue.isRunning = false;
        const completedCount = this.queue.tasks.filter(t => t.status === 'done').length;
        const errorCount = this.queue.tasks.filter(t => t.status === 'error').length;
        Logger.success(LogModule.BATCH, '批处理完成');
        // V0.9.10: 弹成功通知（带统计信息）
        if (errorCount === 0) {
            notificationService.success(`批处理完成: ${completedCount} 个任务`, 'Engram', {
                action: { goto: 'processing' }
            });
        } else {
            notificationService.warning(`批处理中断: ${completedCount} 成功, ${errorCount} 失败`, 'Engram', {
                action: { goto: 'devlog' }
            });
        }
        this.notifyProgress();
    }

    /** 执行单个任务 */
    private async executeTask(task: BatchTask): Promise<void> {
        switch (task.type) {
            case 'summary':
                await this.executeSummaryTask(task);
                break;
            case 'entity':
                await this.executeEntityTask(task);
                break;
            case 'trim':
                await this.executeTrimTask(task);
                break;
            case 'embed':
                await this.executeEmbedTask(task);
                break;
        }
    }

    private async executeSummaryTask(task: BatchTask): Promise<void> {
        if (!task.floorRange) return;

        // 1. 触发总结服务 (Summary)，底层会自动更新 last_summarized_floor 指针
        await summarizerService.setLastSummarizedFloor(task.floorRange.start);
        const result = await summarizerService.triggerSummary(true);
        if (!result) {
            // Strict Mode: summary 失败不能简单跳过，必须报错，交由上层标记 error 并 continue
            throw new Error(`Summary task failed for range ${task.floorRange.start}-${task.floorRange.end}`);
        }
    }

    private async executeEntityTask(task: BatchTask): Promise<void> {
        if (!task.floorRange) return;

        // 单独抽取实体时，借用从外部存好的底层进度来确切提取剩余未提的
        const { chatManager } = await import('@/data/ChatManager');
        const state = await chatManager.getState();
        const lastExtracted = state.last_extracted_floor || 0;
        const targetEnd = task.floorRange.end;

        if (targetEnd > lastExtracted) {
            const extractRange: [number, number] = [lastExtracted + 1, targetEnd];
            const extractResult = await entityBuilder.extractByRange(extractRange, true);
            if (!extractResult) {
                Logger.warn(LogModule.BATCH, `Entity extraction softly skipped for range ${extractRange[0]}-${extractRange[1]}`);
                task.status = 'skipped';
            }
        } else {
            task.status = 'skipped';
        }
    }

    private async executeTrimTask(task: BatchTask): Promise<void> {
        const { canTrim } = await eventTrimmer.canTrim();
        if (canTrim) {
            await eventTrimmer.trim(true);
        } else {
            task.status = 'skipped';
        }
    }

    private async executeEmbedTask(task: BatchTask): Promise<void> {
        // V1.2.2: 批处理执行前初始化配置
        const vectorConfig = SettingsManager.get('apiSettings')?.vectorConfig;
        if (vectorConfig) {
            embeddingService.setConfig(vectorConfig);
        }

        const result = await embeddingService.embedUnprocessedEvents((current: number, total: number) => {
            task.progress.current = current;
            task.progress.total = total;
            this.notifyProgress();
        });
        task.progress.current = result.success;
    }

    pause(): void {
        this.queue.isPaused = true;
        Logger.info(LogModule.BATCH, '已暂停');
        this.notifyProgress();
    }

    resume(): void {
        this.queue.isPaused = false;
        Logger.info(LogModule.BATCH, '已恢复');
        this.notifyProgress();
    }

    stop(): void {
        this.stopSignal = true;
        this.queue.isPaused = false;
        Logger.info(LogModule.BATCH, '正在停止');
    }

    reset(): void {
        this.stopSignal = true;
        this.queue = {
            tasks: [],
            isRunning: false,
            isPaused: false,
            currentTaskIndex: 0,
            overallProgress: { current: 0, total: 0 },
        };
        this.notifyProgress();
    }

    getStatus(): {
        status: BatchTaskStatus | 'idle';
        queue: BatchQueue;
        progress: number;
        currentTask: string | null;
        error: string | null;
    } {
        let status: BatchTaskStatus | 'idle' = 'idle';
        if (this.queue.isRunning) status = 'running';
        if (this.queue.isPaused) status = 'pending'; // or 'paused' if we had it
        // Check current task status
        const currentTask = this.queue.tasks[this.queue.currentTaskIndex];
        if (currentTask && currentTask.status === 'error') status = 'error';

        const progress = this.queue.overallProgress.total > 0
            ? (this.queue.overallProgress.current / this.queue.overallProgress.total) * 100
            : 0;

        return {
            status,
            queue: { ...this.queue }, // Return copy
            progress,
            currentTask: currentTask ? currentTask.type : null,
            error: currentTask?.error || null
        };
    }

    clear(): void {
        this.reset();
    }

    getQueue(): BatchQueue {
        return { ...this.queue };
    }

    private notifyProgress(): void {
        const queueState = { ...this.queue };
        // 兼容原有的 onProgress 单线回调
        if (this.onProgress) {
            try {
                this.onProgress(queueState);
            } catch (e) {
                Logger.debug(LogModule.BATCH, '单线回调失败', e);
            }
        }

        // 广播给所有订阅者
        this.listeners.forEach(listener => {
            try {
                listener(queueState);
            } catch (e) {
                Logger.debug(LogModule.BATCH, '订阅者回调失败', e);
            }
        });
    }

    // ==================== 外部 txt 导入 ====================

    async importText(
        text: string,
        config: ImportConfig = DEFAULT_IMPORT_CONFIG,
        onProgress?: BatchProgressCallback
    ): Promise<{ success: number; failed: number }> {
        const chunks = BatchUtils.chunkText(text, config.chunkSize, config.overlapSize);
        const store = useMemoryStore.getState();
        await store.initChat();

        let success = 0;
        let failed = 0;

        this.queue = {
            tasks: [{
                id: generateShortUUID('job_'),
                type: 'embed',
                status: 'running',
                progress: { current: 0, total: chunks.length },
            }],
            isRunning: true,
            isPaused: false,
            currentTaskIndex: 0,
            overallProgress: { current: 0, total: chunks.length },
        };

        this.onProgress = onProgress;
        this.stopSignal = false;
        this.notifyProgress();

        for (let i = 0; i < chunks.length; i++) {
            if (this.stopSignal) break;

            const chunk = chunks[i];

            try {
                if (config.mode === 'detailed') {
                    // V0.9.7: 调用 LLM 生成结构化摘要
                    const llmResult = await BatchUtils.summarizeChunk(chunk, i);

                    if (llmResult) {
                        // 使用 Workflow Engine 解析 JSON 并存储
                        const savedEvents = await WorkflowEngine.run(
                            {
                                name: 'ImportFlow',
                                steps: [new ParseJson(), new SaveEvent()]
                            },
                            {
                                llmResponse: {
                                    content: llmResult,
                                    success: true,
                                    tokenUsage: 0
                                },
                                input: {
                                    // 模拟 range，用于 SaveEvent 记录 source_range
                                    range: [i, i]
                                }
                            }
                        );

                        if (Array.isArray(savedEvents) && savedEvents.length > 0) {
                            // Pipeline 已处理存储，只需嵌入
                            // V1.2.2: 联动嵌入前确保配置已加载
                            const vectorConfig = SettingsManager.get('apiSettings')?.vectorConfig;
                            if (vectorConfig) {
                                embeddingService.setConfig(vectorConfig);
                            }

                            for (const evt of savedEvents) {
                                await embeddingService.embedEvent(evt);
                            }
                            success++;
                            this.queue.tasks[0].progress.current = i + 1;
                            this.queue.overallProgress.current = i + 1;
                            this.notifyProgress();
                            continue;  // 跳过后续的直接存储逻辑
                        }
                    }
                    // 降级：LLM 失败或 Pipeline 解析失败，使用原文
                    Logger.warn(LogModule.BATCH, `分块 ${i} 回退为原文`);
                }

                // 快速模式 或 降级：直接存储原文
                const eventNode = await store.saveEvent({
                    summary: chunk,
                    structured_kv: {
                        time_anchor: '',
                        role: [],
                        location: [],  // V1.0.2: location 改为数组
                        event: `外部导入 #${i + 1}`,
                        logic: [],
                        causality: '',
                    },
                    significance_score: 0.5,
                    level: 0,
                    is_embedded: false,
                    is_archived: false,
                    source_range: { start_index: i, end_index: i },
                });

                // V1.2.2: 联动嵌入前确保配置已加载
                const vectorConfig = SettingsManager.get('apiSettings')?.vectorConfig;
                if (vectorConfig) {
                    embeddingService.setConfig(vectorConfig);
                }

                await embeddingService.embedEvent(eventNode);
                success++;
            } catch (error) {
                Logger.error(LogModule.BATCH, `导入分块 ${i} 失败`, { error: String(error) });
                failed++;
            }

            this.queue.tasks[0].progress.current = i + 1;
            this.queue.overallProgress.current = i + 1;
            this.notifyProgress();
        }

        this.queue.isRunning = false;
        this.queue.tasks[0].status = 'done';
        this.notifyProgress();

        Logger.success(LogModule.BATCH, `导入完成: ${success} 成功, ${failed} 失败`);
        // V0.9.10: 弹成功通知
        if (failed === 0) {
            notificationService.success(`文本导入完成: ${success} 个分块`, 'Engram', {
                action: { goto: 'memory' }
            });
        } else {
            notificationService.warning(`文本导入: ${success} 成功, ${failed} 失败`, 'Engram', {
                action: { goto: 'devlog' }
            });
        }
        return { success, failed };
    }
}

/** 默认实例 */
export const batchProcessor = new BatchProcessor();
