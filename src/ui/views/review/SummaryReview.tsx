import { Plus, X } from 'lucide-react';
import React, { useEffect, useState } from 'react';

interface SummaryReviewProps {
    content: string; // Generic text content (fallback)
    data?: { events?: string[] } | string[]; // Expecting list of events
    onChange: (content: string, data: any) => void;
}

export const SummaryReview: React.FC<SummaryReviewProps> = ({ content, data, onChange }) => {
    // Parse input data to list of events
    const parseEvents = (): any[] => {
        // 1. Try from parsed data object
        if (Array.isArray(data)) return data;
        if (data && typeof data === 'object' && Array.isArray(data.events)) {
            return data.events;
        }

        // 2. Try to parse content as JSON if data is missing or malformed
        if (content) {
            try {
                // Remove markdown code blocks if any
                const cleanContent = content.replace(/```(json)?/g, '').trim();
                const parsed = JSON.parse(cleanContent);
                if (Array.isArray(parsed)) return parsed;
                if (parsed && typeof parsed === 'object' && Array.isArray(parsed.events)) {
                    return parsed.events;
                }
            } catch (e) {
                // Ignore parse errors, fallback to text splitting
            }

            // 3. Last fallback: split content by newlines assuming it's a plain list
            return content.split('\n')
                .map(l => l.trim())
                .filter(l => l.length > 0 && !l.startsWith('{') && !l.startsWith('}') && !l.startsWith('[') && !l.startsWith(']'));
        }
        return [];
    };

    const [events, setEvents] = useState<any[]>([]);

    // Notify parent of changes
    const notifyChange = (newEvents: any[]) => {
        const newContent = JSON.stringify({ events: newEvents }, null, 2);
        onChange(newContent, { events: newEvents });
    };

    useEffect(() => {
        const parsed = parseEvents();
        setEvents(parsed);
        // Only trigger sync up on initial load if `data.events` is missing
        const parentHasEvents = data && !Array.isArray(data) && typeof data === 'object' && Array.isArray((data as any).events);
        if (!parentHasEvents && parsed.length > 0) {
            onChange(parsed.join('\n'), { events: parsed });
        }
    }, [data, content]);

    const handleChangeEvent = (index: number, val: string) => {
        const next = [...events];
        if (typeof next[index] === 'object' && next[index] !== null) {
            next[index] = { ...next[index], summary: val };
        } else {
            next[index] = val;
        }
        setEvents(next);
        notifyChange(next);
    };

    const handleRemoveEvent = (index: number) => {
        const next = events.filter((_, i) => i !== index);
        setEvents(next);
        notifyChange(next);
    };

    const handleAddEvent = () => {
        const isObjectFormat = events.length > 0 && typeof events[0] === 'object';
        const newItem = isObjectFormat ? { summary: '', meta: {}, significance_score: 0.5 } : '';
        const next = [...events, newItem];
        setEvents(next);
        notifyChange(next);
    };

    // Render KV display
    const renderKV = (evt: any) => {
        if (typeof evt !== 'object' || !evt) return null;
        const kv = evt.structured_kv || evt.meta || {};
        const hasData = kv.time_anchor || kv.location || (kv.role && kv.role.length > 0);
        if (!hasData) return null;

        const locStr = Array.isArray(kv.location) ? kv.location.join(', ') : String(kv.location || '');

        return (
            <div className="flex flex-wrap items-center gap-1.5 text-[10px] mb-2 px-1">
                {kv.time_anchor && (
                    <span className="text-value bg-value/5 px-1 py-0.5 rounded border border-value/20">({kv.time_anchor})</span>
                )}
                {locStr && (
                    <span className="text-value bg-value/5 px-1 py-0.5 rounded border border-value/20">@{locStr}</span>
                )}
                {kv.role && kv.role.length > 0 && (
                    <span className="text-emphasis bg-emphasis/5 px-1 py-0.5 rounded border border-emphasis/20">[{kv.role.join(', ')}]</span>
                )}
            </div>
        );
    };

    return (
        <div className="flex flex-col gap-4">
            <div className="text-sm text-muted-foreground bg-muted/20 p-3 rounded-md border border-border/50">
                请确认生成的摘要事件列表。您可以修改表述或删除不重要的事件。
            </div>

            <div className="space-y-3 pr-2">
                {events.map((evt, idx) => {
                    const isObject = typeof evt === 'object' && evt !== null;
                    const displayTitle = isObject ? (evt.structured_kv?.event || evt.meta?.event || `Event ${idx + 1}`) : `Event ${idx + 1}`;

                    return (
                        <div key={idx} className="relative group bg-card border border-border/50 rounded-lg p-3 shadow-sm hover:border-primary/40 transition-colors">
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                    <div className="w-1.5 h-1.5 rounded-full bg-primary/60 shrink-0" />
                                    <span className="text-xs font-medium text-heading truncate uppercase tracking-wider">{displayTitle}</span>
                                </div>
                                <button
                                    onClick={() => handleRemoveEvent(idx)}
                                    className="p-1 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity bg-background/50 rounded"
                                    title="移除此片段"
                                >
                                    <X size={14} />
                                </button>
                            </div>

                            {renderKV(evt)}

                            <textarea
                                value={isObject ? (evt.summary || '') : evt}
                                onChange={(e) => handleChangeEvent(idx, e.target.value)}
                                className="w-full min-h-[60px] p-2 bg-muted/20 border border-transparent hover:border-border focus:border-primary focus:bg-background rounded-md text-sm resize-none focus:outline-none transition-colors custom-scrollbar"
                                rows={Math.max(2, Math.ceil((isObject ? (evt.summary || '').length : evt.length) / 40))}
                            />
                        </div>
                    );
                })}

                {events.length === 0 && (
                    <div className="text-center py-8 text-muted-foreground text-sm italic">
                        暂无事件记录
                    </div>
                )}

                <button
                    onClick={handleAddEvent}
                    className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-primary hover:bg-muted/50 rounded-md transition-colors w-full justify-center border border-dashed border-border hover:border-primary/30"
                >
                    <Plus size={14} />
                    添加事件
                </button>
            </div>
        </div >
    );
};
