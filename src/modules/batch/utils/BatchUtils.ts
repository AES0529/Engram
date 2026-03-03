import { getBuiltInTemplateByCategory } from '@/config/types/defaults';
import { Logger, LogModule } from '@/core/logger';
import { llmAdapter } from '@/integrations/llm/Adapter';

export class BatchUtils {
    /**
     * 将长文本切分为带重叠区的小块
     */
    static chunkText(text: string, chunkSize: number, overlapSize: number): string[] {
        // 防御性校验：overlapSize >= chunkSize 会导致 start 指针无法前进（死循环）
        if (overlapSize >= chunkSize) {
            Logger.warn(LogModule.BATCH, `overlapSize(${overlapSize}) >= chunkSize(${chunkSize})，强制修正`, {});
            overlapSize = Math.max(0, chunkSize - 1);
        }

        const chunks: string[] = [];
        let start = 0;
        while (start < text.length) {
            const end = Math.min(start + chunkSize, text.length);
            chunks.push(text.slice(start, end));
            start = end - overlapSize;
            if (start >= text.length - overlapSize) break;
        }
        return chunks;
    }

    /**
     * V0.9.7: 调用 LLM 对单个文本块生成结构化摘要
     */
    static async summarizeChunk(chunk: string, chunkIndex: number): Promise<string> {
        const template = getBuiltInTemplateByCategory('summary');
        const systemPrompt = template?.systemPrompt || '';
        const userPrompt = `请对以下外部导入的文本片段进行结构化摘要，按照系统提示的格式输出 JSON：

---
${chunk}
---`;

        try {
            const response = await llmAdapter.generate({ systemPrompt, userPrompt });
            if (response.success && response.content) {
                Logger.debug(LogModule.BATCH, `分块 ${chunkIndex} 总结完成`);
                return response.content;
            }
        } catch (error) {
            Logger.warn(LogModule.BATCH, `分块 ${chunkIndex} 总结失败`, { error });
        }
        // 降级：返回空，让调用方使用原文
        return '';
    }
}
