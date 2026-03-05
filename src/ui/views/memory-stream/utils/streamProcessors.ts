import { SettingsManager } from '@/config/settings';
import type { EntityNode, EventNode } from '@/data/types/graph';
import type { GroupedEvent, SortOrder } from '../hooks/useMemoryStream';

/**
 * 过滤事件列表
 */
export function filterEvents(
    events: EventNode[],
    pendingChanges: Map<string, Partial<EventNode>>,
    searchQuery: string,
    showActiveOnly: boolean,
    activeIds: Set<string>,
    sortOrder: SortOrder
): EventNode[] {
    let result = events.map(e => {
        const pending = pendingChanges.get(e.id);
        return pending ? { ...e, ...pending } as EventNode : e;
    });

    if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        result = result.filter(e =>
            e.summary.toLowerCase().includes(q) ||
            e.structured_kv.event?.toLowerCase().includes(q) ||
            e.structured_kv.role?.some(r => r.toLowerCase().includes(q))
        );
    }

    if (showActiveOnly) {
        result = result.filter(e => activeIds.has(e.id));
    }

    return result.sort((a, b) =>
        sortOrder === 'asc' ? a.timestamp - b.timestamp : b.timestamp - a.timestamp
    );
}

/**
 * 将事件按楼层分组
 */
export function groupEvents(
    filteredEvents: EventNode[],
    sortOrder: SortOrder
): GroupedEvent[] {
    const interval = SettingsManager.get('summarizerConfig')?.floorInterval || 10;
    const groups = new Map<number, { title: string, events: EventNode[] }>();

    filteredEvents.forEach(event => {
        const startIndex = event.source_range?.start_index || 0;
        const groupKey = Math.floor(startIndex / interval) * interval;

        if (!groups.has(groupKey)) {
            const displayStart = groupKey === 0 ? 1 : groupKey + 1;
            const displayEnd = groupKey + interval;
            groups.set(groupKey, {
                title: `第 ${displayStart} - ${displayEnd} 楼`,
                events: []
            });
        }
        groups.get(groupKey)!.events.push(event);
    });

    const sortedKeys = Array.from(groups.keys()).sort((a, b) =>
        sortOrder === 'asc' ? a - b : b - a
    );

    return sortedKeys.map((key) => {
        const group = groups.get(key)!;
        group.events.sort((a, b) => {
            if (a.level !== b.level) {
                return b.level - a.level;
            }
            return sortOrder === 'asc' ? a.timestamp - b.timestamp : b.timestamp - a.timestamp;
        });
        return {
            key,
            title: group.title,
            events: group.events,
            startIndex: 0,
        };
    });
}

/**
 * 过滤实体列表
 */
export function filterEntities(
    entities: EntityNode[],
    pendingChanges: Map<string, Partial<EntityNode>>,
    searchQuery: string
): EntityNode[] {
    let result = entities.map(e => {
        const pending = pendingChanges.get(e.id);
        return pending ? { ...e, ...pending } as EntityNode : e;
    });

    if (!searchQuery.trim()) return result;

    const q = searchQuery.toLowerCase();
    return result.filter(e =>
        e.name.toLowerCase().includes(q) ||
        e.aliases?.some((a: string) => a.toLowerCase().includes(q)) ||
        e.description?.toLowerCase().includes(q)
    );
}
