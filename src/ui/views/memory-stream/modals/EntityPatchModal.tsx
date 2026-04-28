import { SimpleModal } from '@/ui/components/feedback/SimpleModal';
import { Braces } from 'lucide-react';
import React, { useEffect, useState } from 'react';

const EXAMPLE_PATCH = `{
  "patches": [
    {
      "op": "replace",
      "path": "/entities/王也/profile/status",
      "value": "三岁半幼童，已能行走说话。"
    },
    {
      "op": "add",
      "path": "/entities/王也/aliases/-",
      "value": "小丫头"
    }
  ]
}`;

interface EntityPatchModalProps {
    isOpen: boolean;
    onClose: () => void;
    onExecute: (jsonText: string) => Promise<void>;
}

export const EntityPatchModal: React.FC<EntityPatchModalProps> = ({
    isOpen,
    onClose,
    onExecute,
}) => {
    const [jsonText, setJsonText] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [isApplying, setIsApplying] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setError(null);
        }
    }, [isOpen]);

    const handleExecute = async () => {
        setError(null);

        if (!jsonText.trim()) {
            setError('请先粘贴 JSON patch 文本');
            return;
        }

        try {
            JSON.parse(jsonText);
        } catch (parseError: any) {
            setError(`JSON 格式错误: ${parseError.message || '无法解析'}`);
            return;
        }

        setIsApplying(true);
        try {
            await onExecute(jsonText);
            setJsonText('');
        } catch (executeError: any) {
            setError(executeError.message || '批量修改失败');
        } finally {
            setIsApplying(false);
        }
    };

    return (
        <SimpleModal
            isOpen={isOpen}
            onClose={isApplying ? () => undefined : onClose}
            title="JSON 批量修改实体"
            icon={<Braces size={16} />}
            maxWidth="max-w-3xl"
            footer={
                <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between w-full">
                    <div className="text-[10px] text-muted-foreground">
                        支持 add / replace / remove，路径格式：/entities/实体名/字段路径
                    </div>
                    <div className="flex justify-end gap-2">
                        <button
                            onClick={onClose}
                            disabled={isApplying}
                            className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors disabled:opacity-50"
                        >
                            取消
                        </button>
                        <button
                            onClick={handleExecute}
                            disabled={isApplying || !jsonText.trim()}
                            className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50 transition-colors"
                        >
                            {isApplying ? '执行中...' : '执行批改'}
                        </button>
                    </div>
                </div>
            }
        >
            <div className="p-4 space-y-3">
                <p className="text-xs text-muted-foreground leading-relaxed">
                    粘贴合法 JSON 后会直接写入当前聊天的实体库。实体不存在时会自动创建；修改 profile 后会自动重建实体描述 YAML。
                </p>

                <textarea
                    value={jsonText}
                    onChange={(event) => {
                        setJsonText(event.target.value);
                        if (error) { setError(null); }
                    }}
                    placeholder={EXAMPLE_PATCH}
                    className="w-full min-h-[45vh] p-3 text-xs font-mono leading-relaxed bg-background border border-border rounded outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground/60"
                    spellCheck={false}
                />

                {error && (
                    <div className="p-3 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded whitespace-pre-wrap">
                        {error}
                    </div>
                )}
            </div>
        </SimpleModal>
    );
};
