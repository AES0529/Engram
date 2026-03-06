import { WorkflowDefinition } from '../core/WorkflowEngine';
import { BrainRecallStep } from '../steps/rag/BrainRecallStep';
import { RecordRecallLogStep } from '../steps/rag/RecordRecallLogStep';
import { RerankMergeStep } from '../steps/rag/RerankMergeStep';
import { VectorRetrieveStep } from '../steps/rag/VectorRetrieveStep';

export const createRetrievalWorkflow = (): WorkflowDefinition => ({
    name: 'RetrievalWorkflow',
    steps: [
        new VectorRetrieveStep(),
        new RerankMergeStep(),
        new BrainRecallStep(),
        new RecordRecallLogStep()
    ]
});
