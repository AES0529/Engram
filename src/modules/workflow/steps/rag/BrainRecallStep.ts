import { DEFAULT_BRAIN_RECALL_CONFIG } from '@/config/types/defaults';
import type { BrainRecallConfig, RecallConfig } from '@/config/types/rag';
import { Logger, LogModule } from '@/core/logger';
import { brainRecallCache, type RecallCandidate } from '@/modules/rag/retrieval/BrainRecallCache';
import type { ScoredEvent } from '@/modules/rag/retrieval/HybridScorer';
import { JobContext } from '../../core/JobContext';
import { IStep } from '../../core/Step';

export class BrainRecallStep implements IStep {
    name = 'BrainRecallStep';

    async execute(context: JobContext): Promise<void> {
        context.data = context.data || {};
        let candidates: ScoredEvent[] = context.data.candidates || [];
        const config: RecallConfig | undefined = context.data.recallConfig;

        if (!config || candidates.length === 0) return;

        const brainConfig: BrainRecallConfig = config.brainRecall || DEFAULT_BRAIN_RECALL_CONFIG;

        if (brainConfig.enabled) {
            brainRecallCache.setConfig(brainConfig);
            brainRecallCache.nextRound();

            // 转换为 RecallCandidate 格式
            const mappedCandidates: RecallCandidate[] = candidates.map(c => {
                let rerankScore = c.rerankScore;
                if (rerankScore === undefined && config.useRerank) {
                    const baseScore = typeof c.embeddingScore === 'number' ? c.embeddingScore : 0;
                    rerankScore = Math.min(0.8, baseScore);
                }

                return {
                    id: c.id,
                    label: c.node?.structured_kv?.event || c.summary.slice(0, 10),
                    embeddingScore: c.embeddingScore || 0,
                    rerankScore: rerankScore,
                    embeddingVector: c.node?.embedding,
                };
            });

            const brainResults = brainRecallCache.process(mappedCandidates);

            const candidateMap = new Map(candidates.map(c => [c.id, c]));
            context.data.candidates = brainResults
                .filter(slot => candidateMap.has(slot.id))
                .map(slot => {
                    const original = candidateMap.get(slot.id)!;
                    return {
                        ...original,
                        hybridScore: slot.finalScore,
                    };
                });

            Logger.info(LogModule.RAG_RETRIEVE, '类脑召回已应用', {
                inputCount: mappedCandidates.length,
                outputCount: context.data.candidates.length,
                round: brainRecallCache.getCurrentRound(),
            });

            context.data.brainStats = {
                round: brainRecallCache.getCurrentRound(),
                snapshot: brainRecallCache.getShortTermSnapshot()
            };
        }
    }
}
