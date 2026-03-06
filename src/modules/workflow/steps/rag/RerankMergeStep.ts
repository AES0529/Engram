import type { RecallConfig } from '@/config/types/rag';
import { Logger, LogModule } from '@/core/logger';
import { mergeResults, scoreAndSort, type ScoredEvent } from '@/modules/rag/retrieval/HybridScorer';
import { rerankService } from '@/modules/rag/retrieval/Reranker';
import { JobContext } from '../../core/JobContext';
import { IStep } from '../../core/Step';

export class RerankMergeStep implements IStep {
    name = 'RerankMergeStep';

    async execute(context: JobContext): Promise<void> {
        context.data = context.data || {};
        let candidates: ScoredEvent[] = context.data.candidates || [];
        const config: RecallConfig | undefined = context.data.recallConfig;

        if (!config || candidates.length === 0) {
            return;
        }

        context.data.originalCandidateCount = candidates.length;

        // 2. Rerank 重排序 (如果启用且服务可用)
        let finalCandidates = candidates;
        let rerankTime = 0;

        if (config.useRerank && rerankService.isEnabled()) {
            context.data.rerankStartTime = Date.now();
            const query = context.input?.query as string;
            const unifiedQueries = context.input?.unifiedQueries as string[] | undefined;
            const rerankQuery = unifiedQueries?.[0] || query;
            const documents = candidates.map(c => c.summary);

            try {
                const rerankResults = await rerankService.rerank(rerankQuery, documents);
                rerankTime = Date.now() - context.data.rerankStartTime;

                const embeddingMap = new Map(candidates.map(c => [c.id, c]));
                const alpha = rerankService.getHybridAlpha();

                finalCandidates = mergeResults(
                    embeddingMap,
                    rerankResults,
                    candidates,
                    alpha
                );
            } catch (e: any) {
                Logger.warn(LogModule.RAG_RETRIEVE, 'Rerank 失败，退回纯 Embedding 排序', { error: e.message });
                finalCandidates = scoreAndSort(candidates, 0);
            }
        } else {
            // 仅使用 Embedding 分数排序
            finalCandidates = scoreAndSort(candidates, 0);
        }

        context.data.candidates = finalCandidates;
        context.data.rerankTime = rerankTime;
    }
}
