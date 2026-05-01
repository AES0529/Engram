import type { EventNode } from '@/data/types/graph';
import type { EventJSONImportPreview } from '@/state/memory/slices/eventSlice';
import { SimpleModal } from '@/ui/components/feedback/SimpleModal';
import { Braces, Check, ChevronDown, ChevronRight, Eye } from 'lucide-react';
import React, { useEffect, useState } from 'react';

const EXAMPLE_EVENTS = `{
  "events": [
    {
      "summary": "王也自02月04日起每日清晨在后院老槐树下以前世武当浑圆桩站桩。",
      "meta": {
        "time_anchor": "0008年02月04日-07日 清晨至辰时",
        "role": ["王也", "翠儿", "叶心柳", "黄猫"],
        "location": ["七玄门·王家内宅·后院", "正房"],
        "event": "站桩日课确立·观察链闭合·母女首面",
        "logic": ["前世武学物理接续", "极端天气心性验证"],
        "causality": "连日极寒不辍证明心性过关，叶心柳决定传授内家功底。"
      },
      "significance_score": 0.7
    }
  ]
}`;

interface EventImportModalProps {
    isOpen: boolean;
    onClose: () => void;
    onPreview: (jsonText: string) => Promise<EventJSONImportPreview>;
    onExecute: (jsonText: string) => Promise<void>;
}

function formatList(values: string[]): string {
    return values.length > 0 ? values.join('、') : '(空)';
}

const EventPreviewCard: React.FC<{ event: EventNode; index: number }> = ({ event, index }) => {
    const [expanded, setExpanded] = useState(index < 3);
    const kv = event.structured_kv;

    return (
        <div className="rounded-lg border border-green-500/25 bg-green-500/5 overflow-hidden">
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full flex items-center justify-between gap-3 p-3 text-left hover:bg-green-500/10 transition-colors"
            >
                <div className="flex items-center gap-2 min-w-0">
                    {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <span className="text-[10px] px-1.5 py-0.5 rounded border border-green-500/30 text-green-600 dark:text-green-400 bg-green-500/10">
                        新增事件 #{index + 1}
                    </span>
                    <span className="text-sm font-medium text-foreground truncate">{kv.event || event.summary}</span>
                </div>
                <div className="text-[10px] text-muted-foreground shrink-0">score {event.significance_score.toFixed(2)}</div>
            </button>

            {expanded && (
                <div className="p-3 pt-0 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
                        <div className="rounded border border-border/50 bg-background/50 p-2">
                            <div className="text-muted-foreground mb-1">时间</div>
                            <div className="text-foreground break-all">{kv.time_anchor || '(空)'}</div>
                        </div>
                        <div className="rounded border border-border/50 bg-background/50 p-2">
                            <div className="text-muted-foreground mb-1">地点</div>
                            <div className="text-foreground break-all">{formatList(kv.location)}</div>
                        </div>
                        <div className="rounded border border-border/50 bg-background/50 p-2">
                            <div className="text-muted-foreground mb-1">角色</div>
                            <div className="text-foreground break-all">{formatList(kv.role)}</div>
                        </div>
                        <div className="rounded border border-border/50 bg-background/50 p-2">
                            <div className="text-muted-foreground mb-1">逻辑</div>
                            <div className="text-foreground break-all">{formatList(kv.logic)}</div>
                        </div>
                    </div>

                    {kv.causality && (
                        <div className="rounded border border-border/50 bg-background/50 p-2 text-[11px]">
                            <div className="text-muted-foreground mb-1">因果</div>
                            <div className="text-foreground whitespace-pre-wrap break-all">{kv.causality}</div>
                        </div>
                    )}

                    <div className="rounded border border-green-500/20 bg-background/50 p-2 text-[11px]">
                        <div className="text-green-600 dark:text-green-400 mb-1">摘要正文</div>
                        <div className="text-foreground whitespace-pre-wrap break-all leading-relaxed">{event.summary}</div>
                    </div>
                </div>
            )}
        </div>
    );
};

export const EventImportModal: React.FC<EventImportModalProps> = ({
    isOpen,
    onClose,
    onPreview,
    onExecute,
}) => {
    const [jsonText, setJsonText] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [preview, setPreview] = useState<EventJSONImportPreview | null>(null);
    const [isPreviewing, setIsPreviewing] = useState(false);
    const [isApplying, setIsApplying] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setError(null);
        } else {
            setPreview(null);
        }
    }, [isOpen]);

    const validateJsonText = (): boolean => {
        setError(null);
        if (!jsonText.trim()) {
            setError('请先粘贴 JSON 事件文本');
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
        if (!validateJsonText()) { return; }
        setIsPreviewing(true);
        try {
            setPreview(await onPreview(jsonText));
        } catch (previewError: any) {
            setError(previewError.message || '生成预览失败');
        } finally {
            setIsPreviewing(false);
        }
    };

    const handleExecute = async () => {
        if (!preview && !validateJsonText()) { return; }
        setIsApplying(true);
        try {
            await onExecute(jsonText);
            setJsonText('');
            setPreview(null);
        } catch (executeError: any) {
            setError(executeError.message || '导入事件失败');
        } finally {
            setIsApplying(false);
        }
    };

    return (
        <SimpleModal
            isOpen={isOpen}
            onClose={isApplying || isPreviewing ? () => undefined : onClose}
            title={preview ? '确认事件导入预览' : 'JSON 批量导入事件'}
            icon={<Braces size={16} />}
            maxWidth="max-w-3xl"
            footer={
                <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between w-full">
                    <div className="text-[10px] text-muted-foreground">
                        {preview ? `预览：将新增 ${preview.total} 条记忆事件` : '格式：{ "events": [{ summary, meta, significance_score }] }'}
                    </div>
                    <div className="flex justify-end gap-2">
                        <button
                            onClick={preview ? () => setPreview(null) : onClose}
                            disabled={isApplying || isPreviewing}
                            className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors disabled:opacity-50"
                        >
                            {preview ? '返回修改' : '取消'}
                        </button>
                        {preview ? (
                            <button
                                onClick={handleExecute}
                                disabled={isApplying || preview.total === 0}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50 transition-colors"
                            >
                                <Check size={12} />
                                {isApplying ? '生成中...' : '确认生成事件'}
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
                            粘贴合法 JSON 后先预览，不会立刻写入。确认生成后会把每条 events 记录新增为当前聊天的记忆事件。
                        </p>
                        <textarea
                            value={jsonText}
                            onChange={(event) => {
                                setJsonText(event.target.value);
                                setPreview(null);
                                if (error) { setError(null); }
                            }}
                            placeholder={EXAMPLE_EVENTS}
                            className="w-full min-h-[45vh] p-3 text-xs font-mono leading-relaxed bg-background border border-border rounded outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground/60"
                            spellCheck={false}
                        />
                    </>
                ) : (
                    <div className="space-y-3">
                        <div className="rounded border border-green-500/20 bg-green-500/5 p-3 text-sm">
                            <span className="text-muted-foreground">即将新增：</span>
                            <span className="font-semibold text-green-600 dark:text-green-400"> {preview.total} </span>
                            <span className="text-muted-foreground">条记忆事件</span>
                        </div>
                        {preview.events.length === 0 ? (
                            <div className="p-4 border border-dashed border-border rounded text-center text-sm text-muted-foreground bg-muted/20">
                                没有可生成的事件
                            </div>
                        ) : (
                            <div className="space-y-2 max-h-[58vh] overflow-auto pr-1">
                                {preview.events.map((event, index) => (
                                    <EventPreviewCard key={`${event.id}-${index}`} event={event} index={index} />
                                ))}
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
