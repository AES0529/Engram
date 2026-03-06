import { Logger, LogModule } from '@/core/logger';
import { RecallLogService } from '@/core/logger/RecallLogger';
import type { ScoredEvent } from '@/modules/rag/retrieval/HybridScorer';
import { JobContext } from '../../core/JobContext';
import { IStep } from '../../core/Step';

export class RecordRecallLogStep implements IStep {
    name = 'RecordRecallLogStep';

    async execute(context: JobContext): Promise<void> {
        context.data = context.data || {};
        let candidates: ScoredEvent[] = context.data.candidates || [];
        const query = context.input?.query as string;
        const unifiedQueries = context.input?.unifiedQueries as string[] | undefined;
        const mode = (context.input?.mode as string) || 'hybrid';

        let totalTime = 0;
        if (context.data.vectorRetrieveTime) totalTime += context.data.vectorRetrieveTime;
        if (context.data.rerankTime) totalTime += context.data.rerankTime;

        RecallLogService.log({
            query: query || '',
            preprocessedQuery: unifiedQueries?.[0],
            mode: mode as 'hybrid' | 'agentic',
            results: candidates.map(c => ({
                eventId: c.id,
                summary: c.summary,
                category: c.node?.structured_kv?.event || 'unknown',
                embeddingScore: c.embeddingScore || 0,
                rerankScore: c.rerankScore,
                hybridScore: c.hybridScore,
                isTopK: true,
                isReranked: c.rerankScore != null,
                sourceFloor: c.node?.source_range?.start_index,
            })),
            stats: {
                totalCandidates: context.data.originalCandidateCount || candidates.length,
                topKCount: candidates.length,
                rerankCount: candidates.length,
                latencyMs: totalTime,
            },
            brainStats: context.data.brainStats,
        });

        // 整理输出结构匹配原 Retriever 的 RetrievalResult
        const nodes = candidates
            .filter(c => c.node)
            .map(c => c.node!);

        const entries = candidates.map(c => c.summary);

        Logger.info(LogModule.RAG_RETRIEVE, '召回完成', {
            useEmbedding: context.data.recallConfig?.useEmbedding,
            useRerank: context.data.recallConfig?.useRerank,
            totalTime,
            resultCount: nodes.length,
        });

        context.output = { entries, nodes, candidates };
    }
}
