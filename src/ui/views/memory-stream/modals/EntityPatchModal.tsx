import { SimpleModal } from '@/ui/components/feedback/SimpleModal';
import type { EntityPatchPreview, EntityPatchPreviewDiff } from '@/state/memory/slices/entitySlice';
import { Braces, Check, ChevronDown, ChevronRight, Eye } from 'lucide-react';
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
    onPreview: (jsonText: string) => Promise<EntityPatchPreview>;
    onExecute: (jsonText: string) => Promise<void>;
}

function formatValue(value: unknown): string {
    if (value === undefined) {
        return '(不存在)';
    }
    if (typeof value === 'string') {
        return value;
    }
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

function getActionLabel(action: string): string {
    switch (action) {
        case 'create': return '新增';
        case 'update': return '更新';
        case 'delete': return '删除';
        default: return '无变化';
    }
}

function getActionClassName(action: string): string {
    switch (action) {
        case 'create': return 'text-green-600 dark:text-green-400 border-green-500/30 bg-green-500/10';
        case 'update': return 'text-amber-600 dark:text-amber-400 border-amber-500/30 bg-amber-500/10';
        case 'delete': return 'text-destructive border-destructive/30 bg-destructive/10';
        default: return 'text-muted-foreground border-border bg-muted/30';
    }
}

const DiffRow: React.FC<{ diff: EntityPatchPreviewDiff }> = ({ diff }) => (
    <div className="rounded border border-border/50 bg-background/50 p-2 space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="px-1.5 py-0.5 rounded border border-border bg-muted/30 uppercase text-muted-foreground">
                {diff.op}{diff.effectiveOp !== diff.op ? ` -> ${diff.effectiveOp}` : ''}
            </span>
            <span className="font-mono text-foreground break-all">{diff.path}</span>
        </div>

        {diff.isWholeEntity ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
                <div>
                    <div className="mb-1 text-destructive">修改前</div>
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-destructive/5 border border-destructive/10 p-2 text-muted-foreground">
                        {formatValue(diff.oldValue)}
                    </pre>
                </div>
                <div>
                    <div className="mb-1 text-green-600 dark:text-green-400">修改后</div>
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-green-500/5 border border-green-500/10 p-2 text-foreground">
                        {formatValue(diff.newValue)}
                    </pre>
                </div>
            </div>
        ) : (
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-2 text-[11px] items-stretch">
                <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-all rounded bg-destructive/5 border border-destructive/10 p-2 text-destructive line-through decoration-destructive/40">
                    {formatValue(diff.oldValue)}
                </pre>
                <div className="hidden md:flex items-center text-muted-foreground">-&gt;</div>
                <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-all rounded bg-green-500/5 border border-green-500/10 p-2 text-green-700 dark:text-green-300">
                    {formatValue(diff.newValue)}
                </pre>
            </div>
        )}
    </div>
);

export const EntityPatchModal: React.FC<EntityPatchModalProps> = ({
    isOpen,
    onClose,
    onPreview,
    onExecute,
}) => {
    const [jsonText, setJsonText] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [preview, setPreview] = useState<EntityPatchPreview | null>(null);
    const [expandedEntities, setExpandedEntities] = useState<Set<string>>(new Set());
    const [isApplying, setIsApplying] = useState(false);
    const [isPreviewing, setIsPreviewing] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setError(null);
        } else {
            setPreview(null);
            setExpandedEntities(new Set());
        }
    }, [isOpen]);

    const validateJsonText = (): boolean => {
        setError(null);

        if (!jsonText.trim()) {
            setError('请先粘贴 JSON patch 文本');
            return false;
        }

        try {
            JSON.parse(jsonText);
        } catch (parseError: any) {
            setError(`JSON 格式错误: ${parseError.message || '无法解析'}`);
            return false;
        }

        return true;
    };

    const handlePreview = async () => {
        if (!validateJsonText()) {
            return;
        }

        setIsPreviewing(true);
        try {
            const nextPreview = await onPreview(jsonText);
            setPreview(nextPreview);
            setExpandedEntities(new Set(nextPreview.items.map((item, index) => `${item.entityId || item.entityName}-${index}`)));
        } catch (previewError: any) {
            setError(previewError.message || '生成预览失败');
        } finally {
            setIsPreviewing(false);
        }
    };

    const handleExecute = async () => {
        if (!preview && !validateJsonText()) {
            return;
        }

        setIsApplying(true);
        try {
            await onExecute(jsonText);
            setJsonText('');
            setPreview(null);
        } catch (executeError: any) {
            setError(executeError.message || '批量修改失败');
        } finally {
            setIsApplying(false);
        }
    };

    const handleBackToEdit = () => {
        setPreview(null);
        setExpandedEntities(new Set());
    };

    const toggleEntity = (key: string) => {
        setExpandedEntities(prev => {
            const next = new Set(prev);
            if (next.has(key)) {
                next.delete(key);
            } else {
                next.add(key);
            }
            return next;
        });
    };

    return (
        <SimpleModal
            isOpen={isOpen}
            onClose={isApplying || isPreviewing ? () => undefined : onClose}
            title={preview ? '确认实体批改预览' : 'JSON 批量修改实体'}
            icon={<Braces size={16} />}
            maxWidth="max-w-3xl"
            footer={
                <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between w-full">
                    <div className="text-[10px] text-muted-foreground">
                        {preview ? `预览：${preview.operations} 个操作，新增 ${preview.created}，更新 ${preview.updated}，删除 ${preview.deleted}` : '支持 add / replace / remove，路径格式：/entities/实体名/字段路径'}
                    </div>
                    <div className="flex justify-end gap-2">
                        <button
                            onClick={preview ? handleBackToEdit : onClose}
                            disabled={isApplying || isPreviewing}
                            className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors disabled:opacity-50"
                        >
                            {preview ? '返回修改' : '取消'}
                        </button>
                        {preview ? (
                            <button
                                onClick={handleExecute}
                                disabled={isApplying || preview.operations === 0}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50 transition-colors"
                            >
                                <Check size={12} />
                                {isApplying ? '执行中...' : '确认执行'}
                            </button>
                        ) : (
                            <button
                                onClick={handlePreview}
                                disabled={isPreviewing || !jsonText.trim()}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50 transition-colors"
                            >
                                <Eye size={12} />
                                {isPreviewing ? '生成中...' : '生成预览'}
                            </button>
                        )}
                    </div>
                </div>
            }
        >
            <div className="p-4 space-y-3">
                {!preview ? (
                    <>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                            粘贴合法 JSON 后先生成预览，不会立刻写入。预览确认后才会真正修改当前聊天的实体库。
                        </p>

                        <textarea
                            value={jsonText}
                            onChange={(event) => {
                                setJsonText(event.target.value);
                                setPreview(null);
                                if (error) { setError(null); }
                            }}
                            placeholder={EXAMPLE_PATCH}
                            className="w-full min-h-[45vh] p-3 text-xs font-mono leading-relaxed bg-background border border-border rounded outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground/60"
                            spellCheck={false}
                        />
                    </>
                ) : (
                    <div className="space-y-3">
                        <div className="grid grid-cols-4 gap-2 text-center">
                            <div className="rounded border border-border bg-muted/20 p-2">
                                <div className="text-lg font-semibold text-foreground">{preview.operations}</div>
                                <div className="text-[10px] text-muted-foreground">操作</div>
                            </div>
                            <div className="rounded border border-green-500/20 bg-green-500/5 p-2">
                                <div className="text-lg font-semibold text-green-600 dark:text-green-400">{preview.created}</div>
                                <div className="text-[10px] text-muted-foreground">新增</div>
                            </div>
                            <div className="rounded border border-amber-500/20 bg-amber-500/5 p-2">
                                <div className="text-lg font-semibold text-amber-600 dark:text-amber-400">{preview.updated}</div>
                                <div className="text-[10px] text-muted-foreground">更新</div>
                            </div>
                            <div className="rounded border border-destructive/20 bg-destructive/5 p-2">
                                <div className="text-lg font-semibold text-destructive">{preview.deleted}</div>
                                <div className="text-[10px] text-muted-foreground">删除</div>
                            </div>
                        </div>

                        {preview.items.length === 0 ? (
                            <div className="p-4 border border-dashed border-border rounded text-center text-sm text-muted-foreground bg-muted/20">
                                没有可预览的实体变更
                            </div>
                        ) : (
                            <div className="space-y-2 max-h-[55vh] overflow-auto pr-1">
                                {preview.items.map((item, index) => {
                                    const key = `${item.entityId || item.entityName}-${index}`;
                                    const expanded = expandedEntities.has(key);
                                    return (
                                        <div key={key} className="rounded-lg border border-border bg-muted/10 overflow-hidden">
                                            <button
                                                onClick={() => toggleEntity(key)}
                                                className="w-full flex items-center justify-between gap-3 p-3 text-left hover:bg-muted/20 transition-colors"
                                            >
                                                <div className="flex items-center gap-2 min-w-0">
                                                    {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                                    <span className="font-medium text-sm text-foreground truncate">{item.entityName}</span>
                                                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${getActionClassName(item.action)}`}>
                                                        {getActionLabel(item.action)}
                                                    </span>
                                                </div>
                                                <div className="text-[10px] text-muted-foreground shrink-0">{item.diffs.length} 项变更</div>
                                            </button>

                                            {expanded && (
                                                <div className="p-3 pt-0 space-y-2">
                                                    {item.diffs.map(diff => (
                                                        <DiffRow key={`${diff.index}-${diff.path}`} diff={diff} />
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

                {error && (
                    <div className="p-3 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded whitespace-pre-wrap">
                        {error}
                    </div>
                )}
            </div>
        </SimpleModal>
    );
};
