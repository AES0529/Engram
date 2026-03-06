import type { RecallConfig, RerankConfig } from '@/config/types/defaults';
import React from 'react';
import { RecallConfigForm } from './components/RecallConfigForm';

interface RecallPanelProps {
    recallConfig: RecallConfig;
    rerankConfig: RerankConfig;
    onRecallConfigChange: (config: RecallConfig) => void;
    onRerankConfigChange: (config: RerankConfig) => void;
}

// 导入图标
import { preprocessor } from '@/modules/preprocessing';
import { type AgenticRecall } from '@/modules/preprocessing/types';
import { retriever } from '@/modules/rag/retrieval/Retriever';
import { notificationService } from '@/ui/services/NotificationService';
import { RecallDecisionModal } from '@/ui/views/review/RecallDecisionModal';
import { BrainCircuit, Loader2, Play, Search } from 'lucide-react';

export const RecallPanel: React.FC<RecallPanelProps> = ({
    recallConfig,
    rerankConfig,
    onRecallConfigChange,
    onRerankConfigChange
}) => {
    // 测试状态
    const [testQuery, setTestQuery] = React.useState('');
    const [isTesting, setIsTesting] = React.useState(false);
    const [isModalOpen, setIsModalOpen] = React.useState(false);
    const [currentRecalls, setCurrentRecalls] = React.useState<AgenticRecall[]>([]);

    const isAgenticMode = recallConfig.useAgenticRAG;

    // 统一处理预览测试：前置确认 -> 调取大模型 / 向量检索引擎 -> 弹出 Modal (统一样式)
    const handlePreviewTest = async () => {
        if (!testQuery.trim() || isTesting) return;

        // 向用户提供明确的 Token 扣费警告
        const userAgreed = window.confirm('召回预览将马上调用远端模型（大语言模型或 Embedding/Rerank 模型）来生成结果，这会产生 Token 消耗，请确认是否继续？');
        if (!userAgreed) return;

        setIsTesting(true);
        try {
            if (isAgenticMode) {
                // Agentic 模式：由大模型预先生成 JSON
                const result = await preprocessor.process(testQuery);
                if (!result.success) {
                    notificationService.error(result.error || 'Agentic 预处理失败', 'Agentic RAG');
                    return;
                }
                const recalls = result.agenticRecalls ?? [];
                if (recalls.length === 0) {
                    notificationService.warning('预处理完成但未产生召回决策', 'Agentic RAG');
                    return;
                }
                setCurrentRecalls(recalls);
                setIsModalOpen(true);
            } else {
                // 普通（向量/混合）模式：先进行标准检索
                const searchResult = await retriever.search(testQuery);
                const candidates = searchResult.candidates || [];
                if (candidates.length === 0) {
                    notificationService.warning('向量检索未命中任何结果', 'RAG');
                    return;
                }
                // 把检索返回的带分数的 candidate 元素组装为相同的结构格式供 Modal 消费
                const pseudoRecalls: AgenticRecall[] = candidates.map(c => ({
                    id: c.id,
                    score: c.hybridScore ?? c.rerankScore ?? c.embeddingScore ?? 0,
                    reason: c.rerankScore != null ? 'Rerank 优化命中' : '向量检索 (TopK) 命中'
                }));
                setCurrentRecalls(pseudoRecalls);
                setIsModalOpen(true);
            }
        } catch (error) {
            notificationService.error('召回预览执行失败，请查阅控制台报错', 'RAG');
        } finally {
            setIsTesting(false);
        }
    };

    return (
        <div className="p-1 space-y-4">
            <RecallConfigForm
                config={recallConfig}
                onChange={onRecallConfigChange}
                rerankConfig={rerankConfig}
                onRerankChange={onRerankConfigChange}
            />

            {/* 快速测试区 */}
            <div className="pt-6 border-t border-border mt-6">
                <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                    {isAgenticMode ? (
                        <>
                            <BrainCircuit size={16} className="text-primary" />
                            Agentic Dry Run
                        </>
                    ) : (
                        <>
                            <Search size={16} className="text-primary" />
                            Query 快速测试
                        </>
                    )}
                </h3>

                <div className="flex gap-2">
                    <textarea
                        value={testQuery}
                        onChange={(e) => setTestQuery(e.target.value)}
                        placeholder={isAgenticMode
                            ? '输入测试文本，模拟用户输入触发 Agentic 预处理...'
                            : '输入测试文本，模拟 User Input 触发召回...'
                        }
                        className="flex-1 min-h-[80px] p-3 rounded-md bg-secondary/30 border border-border/50 text-sm focus:outline-none focus:border-primary/50 transition-colors resize-y"
                    />
                    <button
                        onClick={handlePreviewTest}
                        disabled={!testQuery.trim() || isTesting}
                        className={`
                            px-4 rounded-md font-medium text-sm transition-all flex flex-col items-center justify-center gap-1 min-w-[80px]
                            ${!testQuery.trim() || isTesting
                                ? 'bg-muted text-muted-foreground cursor-not-allowed'
                                : 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm'}
                        `}
                    >
                        {isTesting ? (
                            <>
                                <Loader2 size={18} className="animate-spin" />
                                <span className="text-xs">检索中</span>
                            </>
                        ) : (
                            <>
                                <Play size={18} fill="currentColor" />
                                <span className="text-xs">召回预览</span>
                            </>
                        )}
                    </button>
                    {isAgenticMode && currentRecalls.length > 0 && (
                        <button
                            onClick={() => setIsModalOpen(true)}
                            disabled={isTesting}
                            className={`
                                px-4 rounded-md font-medium text-sm transition-all flex flex-col items-center justify-center gap-1 min-w-[80px] border border-border bg-transparent text-muted-foreground hover:bg-muted/50
                            `}
                        >
                            <BrainCircuit size={18} />
                            <span className="text-xs">查看/编辑</span>
                        </button>
                    )}
                </div>
                <p className="text-xs text-muted-foreground mt-2 pl-1">
                    * 将执行一次完整的召回测试并弹窗确认，结果可随时在 <span className="text-foreground font-medium">Dev Log</span> 面板中复核
                    {isAgenticMode && <><br /><span className="text-amber-500/80">* 注: Agentic 模式的召回数量由提示词模板控制，不受全局 Top K 滑块限制。</span></>}
                </p>
            </div>

            {/* 统一 RAG 回顾弹窗 */}
            <RecallDecisionModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                initialRecalls={currentRecalls}
                onConfirm={async (newRecalls) => {
                    setCurrentRecalls(newRecalls);
                    try {
                        setIsTesting(true);
                        // 确认后，通过提供明确的 ID 数组强制触发最终的内容装配与记录，绕过额外的无谓检索
                        const searchResult = await retriever.agenticSearch(newRecalls);
                        notificationService.success(
                            `预览确认完成! 强一致性注入 ${searchResult.nodes?.length ?? 0} 条事件，请查看日志`,
                            'RAG'
                        );
                    } catch (error) {
                        notificationService.error('确认后重新执行内容装配失败', 'RAG');
                    } finally {
                        setIsTesting(false);
                    }
                }}
            />
        </div>
    );
};
