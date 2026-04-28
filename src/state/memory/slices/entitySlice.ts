import { generateShortUUID } from '@/core/utils';
import { EntityType, type EntityNode } from '@/data/types/graph';
import * as jsonpatch from 'fast-json-patch';
import yaml from 'js-yaml';
import type { StateCreator } from 'zustand';
import { getCurrentDb, tryGetCurrentDb } from './coreSlice';

interface EntityPatchOperation {
    op: 'add' | 'replace' | 'remove';
    path: string;
    value?: unknown;
}

interface EntityPatchDocument {
    patches: EntityPatchOperation[];
}

interface BatchEntityPatchResult {
    created: number;
    updated: number;
    operations: number;
}

function profileToYaml(name: string, type: string, profile: Record<string, unknown>): string {
    try {
        const yamlContent = yaml.dump({ profile }, {
            indent: 2,
            lineWidth: -1,
            noRefs: true,
            sortKeys: false,
        });
        return `${name}\n${yamlContent.trim()}`;
    } catch {
        return `${name} (${type})\n${JSON.stringify(profile, null, 2)}`;
    }
}

function decodePointerSegment(segment: string): string {
    return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

function normalizeEntityType(value: unknown): EntityNode['type'] {
    if (Object.values(EntityType).includes(value as EntityType)) {
        return value as EntityType;
    }
    return EntityType.Unknown;
}

function createEntityFromPatch(name: string, value?: unknown): EntityNode {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Partial<EntityNode> : {};
    const profile = source.profile && typeof source.profile === 'object' && !Array.isArray(source.profile)
        ? source.profile as Record<string, unknown>
        : {};
    const type = normalizeEntityType(source.type);

    return {
        aliases: Array.isArray(source.aliases) ? [...new Set(source.aliases.filter((alias): alias is string => typeof alias === 'string' && alias.trim().length > 0).map(alias => alias.trim()))] : [],
        description: typeof source.description === 'string' ? source.description : profileToYaml(name, type, profile),
        id: generateShortUUID('ent_'),
        is_archived: Boolean(source.is_archived),
        is_locked: Boolean(source.is_locked),
        last_updated_at: Date.now(),
        name,
        profile,
        type,
    };
}

function parseEntityPatchDocument(jsonText: string): EntityPatchDocument {
    const parsed = JSON.parse(jsonText);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.patches)) {
        throw new Error('JSON 根对象必须包含 patches 数组');
    }

    parsed.patches.forEach((patch: unknown, index: number) => {
        if (!patch || typeof patch !== 'object') {
            throw new Error(`patches[${index}] 必须是对象`);
        }
        const op = patch as Partial<EntityPatchOperation>;
        if (op.op !== 'add' && op.op !== 'replace' && op.op !== 'remove') {
            throw new Error(`patches[${index}].op 只支持 add、replace、remove`);
        }
        if (typeof op.path !== 'string' || !op.path.startsWith('/entities/')) {
            throw new Error(`patches[${index}].path 必须以 /entities/ 开头`);
        }
    });

    return parsed as EntityPatchDocument;
}

function buildEntityPatchOperation(patch: EntityPatchOperation): { name: string; relativePath: string; value?: unknown; op: EntityPatchOperation['op']; isWholeEntity: boolean } {
    const parts = patch.path.split('/').slice(1).map(decodePointerSegment);
    const name = parts[1];
    if (!name) {
        throw new Error(`无效实体路径: ${patch.path}`);
    }

    if (parts.length === 2) {
        return { isWholeEntity: true, name, op: patch.op, relativePath: '', value: patch.value };
    }

    return {
        isWholeEntity: false,
        name,
        op: patch.op,
        relativePath: `/${parts.slice(2).map(part => part.replace(/~/g, '~0').replace(/\//g, '~1')).join('/')}`,
        value: patch.value,
    };
}

function preparePatchTarget(target: Record<string, unknown>, path: string): { exists: boolean } {
    const parts = path.split('/').slice(1).map(decodePointerSegment);
    let cursor: any = target;

    for (let index = 0; index < parts.length - 1; index += 1) {
        const key = parts[index];
        const nextKey = parts[index + 1];
        if (Array.isArray(cursor)) {
            const arrayIndex = key === '-' ? cursor.length : Number(key);
            if (!Number.isInteger(arrayIndex) || arrayIndex < 0) {
                throw new Error(`无效数组路径: ${path}`);
            }
            if (cursor[arrayIndex] === undefined) {
                cursor[arrayIndex] = nextKey === '-' || /^\d+$/.test(nextKey) ? [] : {};
            }
            cursor = cursor[arrayIndex];
            continue;
        }

        if (!cursor[key] || typeof cursor[key] !== 'object') {
            cursor[key] = nextKey === '-' || /^\d+$/.test(nextKey) ? [] : {};
        }
        cursor = cursor[key];
    }

    const finalKey = parts.at(-1);
    if (finalKey === undefined) {
        return { exists: true };
    }

    if (Array.isArray(cursor)) {
        if (finalKey === '-') {
            return { exists: false };
        }
        const arrayIndex = Number(finalKey);
        return { exists: Number.isInteger(arrayIndex) && arrayIndex >= 0 && arrayIndex < cursor.length };
    }

    return { exists: Object.prototype.hasOwnProperty.call(cursor, finalKey) };
}

export interface EntityState {
    // V0.9 实体相关
    getAllEntities: () => Promise<EntityNode[]>;
    saveEntity: (entity: Omit<EntityNode, 'id' | 'last_updated_at'>) => Promise<EntityNode>;
    saveEntities: (entities: Omit<EntityNode, 'id' | 'last_updated_at'>[]) => Promise<EntityNode[]>;
    updateEntity: (entityId: string, updates: Partial<EntityNode>) => Promise<void>;
    updateEntities: (updates: { id: string, updates: Partial<EntityNode> }[]) => Promise<void>;
    applyEntityPatchesFromJSON: (jsonText: string) => Promise<BatchEntityPatchResult>;
    deleteEntity: (entityId: string) => Promise<void>;
    deleteEntities: (entityIds: string[]) => Promise<void>;
    findEntityByName: (name: string) => Promise<EntityNode | null>;
    archiveEntities: (entityIds: string[]) => Promise<void>;
    toggleEntityLock: (entityId: string) => Promise<boolean>;
    getEntityStates: (ids?: string[]) => Promise<string>;
}

export const createEntitySlice: StateCreator<any, [], [], EntityState> = (set, get) => ({
    archiveEntities: async (entityIds: string[]) => {
        if (entityIds.length === 0) return;
        const db = getCurrentDb();
        if (!db) return;
        try {
            await db.entities.where('id').anyOf(entityIds).modify({ is_archived: true });
            console.log(`[MemoryStore] Archived ${entityIds.length} entities`);
        } catch (e) {
            console.error('[MemoryStore] Failed to archive entities:', e);
        }
    },

    applyEntityPatchesFromJSON: async (jsonText: string) => {
        const db = getCurrentDb();
        if (!db) throw new Error('[MemoryStore] No current chat');

        const document = parseEntityPatchDocument(jsonText);
        if (document.patches.length === 0) {
            return { created: 0, operations: 0, updated: 0 };
        }

        const operations = document.patches.map(buildEntityPatchOperation);
        let created = 0;
        const touchedIds = new Set<string>();

        await db.transaction('rw', db.entities, async () => {
            const allEntities = await db.entities.toArray();
            const byName = new Map(allEntities.map(entity => [entity.name, entity]));
            const byAlias = new Map<string, EntityNode>();
            for (const entity of allEntities) {
                for (const alias of entity.aliases || []) {
                    if (!byAlias.has(alias)) {
                        byAlias.set(alias, entity);
                    }
                }
            }

            for (const operation of operations) {
                let entity = byName.get(operation.name) || byAlias.get(operation.name) || null;

                if (operation.isWholeEntity) {
                    if (operation.op === 'remove') {
                        if (entity) {
                            await db.entities.delete(entity.id);
                            byName.delete(entity.name);
                            touchedIds.delete(entity.id);
                        }
                        continue;
                    }

                    const nextEntity = createEntityFromPatch(operation.name, operation.value);
                    if (entity) {
                        const merged: EntityNode = {
                            ...entity,
                            ...nextEntity,
                            id: entity.id,
                            last_updated_at: Date.now(),
                        };
                        if (!merged.description) {
                            merged.description = profileToYaml(merged.name, merged.type, merged.profile || {});
                        }
                        await db.entities.put(merged);
                        byName.set(merged.name, merged);
                        touchedIds.add(merged.id);
                    } else {
                        await db.entities.add(nextEntity);
                        byName.set(nextEntity.name, nextEntity);
                        touchedIds.add(nextEntity.id);
                        created += 1;
                    }
                    continue;
                }

                if (!entity) {
                    entity = createEntityFromPatch(operation.name);
                    await db.entities.add(entity);
                    byName.set(entity.name, entity);
                    touchedIds.add(entity.id);
                    created += 1;
                }

                const target = structuredClone(entity) as EntityNode;
                const prepared = preparePatchTarget(target as unknown as Record<string, unknown>, operation.relativePath);
                const effectiveOp = operation.op === 'replace' && !prepared.exists ? 'add' : operation.op;

                jsonpatch.applyOperation(target, {
                    op: effectiveOp,
                    path: operation.relativePath,
                    value: operation.value,
                } as jsonpatch.Operation, false, true);

                target.aliases = Array.isArray(target.aliases)
                    ? [...new Set(target.aliases.filter((alias): alias is string => typeof alias === 'string' && alias.trim().length > 0).map(alias => alias.trim()))]
                    : [];
                target.profile = target.profile && typeof target.profile === 'object' && !Array.isArray(target.profile) ? target.profile : {};
                target.type = normalizeEntityType(target.type);
                target.last_updated_at = Date.now();
                target.description = profileToYaml(target.name, target.type, target.profile || {});

                await db.entities.put(target);
                byName.delete(entity.name);
                byName.set(target.name, target);
                touchedIds.add(target.id);
            }
        });

        const updated = Math.max(0, touchedIds.size - created);
        console.log(`[MemoryStore] Applied ${document.patches.length} entity JSON patches: ${created} created, ${updated} updated`);
        return { created, operations: document.patches.length, updated };
    },

    deleteEntities: async (entityIds: string[]) => {
        if (entityIds.length === 0) return;
        const db = getCurrentDb();
        if (!db) return;

        try {
            await db.entities.bulkDelete(entityIds);
            console.log(`[MemoryStore] Deleted ${entityIds.length} entities`);
        } catch (e) {
            console.error('[MemoryStore] Failed to delete entities:', e);
            throw e;
        }
    },

    deleteEntity: async (entityId) => {
        if (!entityId) return;
        const db = getCurrentDb();
        if (!db) return;

        try {
            await db.entities.bulkDelete([entityId]);
            console.log(`[MemoryStore] Deleted entity: ${entityId}`);
        } catch (e) {
            console.error('[MemoryStore] Failed to delete entity:', e);
            throw e;
        }
    },

    findEntityByName: async (name) => {
        const db = getCurrentDb();
        if (!db) return null;

        try {
            const exactMatch = await db.entities.where('name').equals(name).first();
            if (exactMatch) return exactMatch;

            const aliasMatch = await db.entities.where('aliases').equals(name).first();
            return aliasMatch || null;
        } catch (e) {
            console.error('[MemoryStore] Failed to find entity by name:', e);
            return null;
        }
    },

    getAllEntities: async () => {
        const db = getCurrentDb();
        if (!db) return [];

        try {
            return await db.entities.toArray();
        } catch (e) {
            console.error('[MemoryStore] Failed to get all entities:', e);
            return [];
        }
    },

    getEntityStates: async (ids?: string[]) => {
        const db = tryGetCurrentDb();
        if (!db) return '';

        try {
            let fullEntities: EntityNode[] = [];
            let summaryEntities: EntityNode[] = [];

            const all = await db.entities.toArray();

            if (ids && ids.length > 0) {
                // 情况 A: 有召回 ID 列表
                // 详细展示：活跃实体 + 被召回的归档实体
                // 简略展示：未被召回的归档实体
                fullEntities = all.filter(e => !e.is_archived || ids.includes(e.id));
                summaryEntities = all.filter(e => e.is_archived && !ids.includes(e.id));
            } else {
                // 情况 B: 无召回 ID 列表
                // 详细展示：所有活跃实体
                // 简略展示：所有归档实体
                fullEntities = all.filter(e => !e.is_archived);
                summaryEntities = all.filter(e => e.is_archived);
            }

            if (fullEntities.length === 0 && summaryEntities.length === 0) return '';

            const groups: Record<string, EntityNode[]> = {
                char: [],
                loc: [],
                item: [],
                concept: [],
                unknown: [],
            };

            for (const entity of fullEntities) {
                const typeKey = entity.type || 'unknown';
                if (groups[typeKey]) {
                    groups[typeKey].push(entity);
                } else {
                    groups.unknown.push(entity);
                }
            }

            const tagMap: Record<string, string> = {
                char: 'character_state',
                loc: 'scene_state',
                item: 'item_state',
                concept: 'concept_state',
                unknown: 'entity_state',
            };

            const sections: string[] = [];

            for (const [typeKey, entityList] of Object.entries(groups)) {
                if (entityList.length === 0) continue;

                const tag = tagMap[typeKey];
                const contents = entityList
                    .map(e => e.description || `# ${e.name}\n(无详细信息)`)
                    .join('\n---\n');

                sections.push(`<${tag}>\n${contents}\n</${tag}>`);
            }

            // 补充未登场/未召回的已归档实体（仅提供极简特征作为防遗忘和防重提醒）
            if (summaryEntities.length > 0) {
                const yamlLines = ['<archived_entities>', '以下实体目前未出场，但需要你保持对其设定的认知，请勿重复创建新实体:'];
                for (const e of summaryEntities) {
                    const identity = e.profile?.identity ?? '未知身份';
                    const description = e.profile?.description ?? '无具体备注';
                    yamlLines.push(`${e.name}:`);
                    yamlLines.push(`  identity: ${identity}`);
                    yamlLines.push(`  description: ${description}`);
                }
                yamlLines.push('</archived_entities>');
                sections.push(yamlLines.join('\n'));
            }

            return sections.join('\n\n');
        } catch (e) {
            console.error('[MemoryStore] Failed to get entity states:', e);
            return '';
        }
    },

    saveEntities: async (entitiesData) => {
        const db = getCurrentDb();
        if (!db) throw new Error('[MemoryStore] No current chat');
        if (entitiesData.length === 0) return [];

        const entities: EntityNode[] = entitiesData.map(data => ({
            ...data,
            id: generateShortUUID('ent_'),
            last_updated_at: Date.now(),
            aliases: data.aliases || [],
            profile: data.profile || {},
        }));

        await db.entities.bulkAdd(entities);
        console.log(`[MemoryStore] Bulk saved ${entities.length} entities`);
        return entities;
    },

    saveEntity: async (entityData) => {
        const db = getCurrentDb();
        if (!db) throw new Error('[MemoryStore] No current chat');

        const entity: EntityNode = {
            ...entityData,
            id: generateShortUUID('ent_'),
            last_updated_at: Date.now(),
            aliases: entityData.aliases || [],
            profile: entityData.profile || {},
        };

        await db.entities.add(entity);
        console.log(`[MemoryStore] Saved entity: ${entity.name}`);
        return entity;
    },

    toggleEntityLock: async (entityId: string) => {
        if (!entityId) return false;
        const db = getCurrentDb();
        if (!db) return false;

        try {
            const existing = await db.entities.get(entityId);
            if (!existing) return false;

            const newLockState = !existing.is_locked;
            await db.entities.update(entityId, { is_locked: newLockState });
            console.log(`[MemoryStore] Toggled entity lock: ${entityId} -> ${newLockState}`);
            return newLockState;
        } catch (e) {
            console.error('[MemoryStore] Failed to toggle entity lock:', e);
            return false;
        }
    },

    updateEntities: async (updatesList) => {
        if (updatesList.length === 0) return;
        const db = getCurrentDb();
        if (!db) return;

        try {
            await db.transaction('rw', db.entities, async () => {
                const now = Date.now();
                for (const { id, updates } of updatesList) {
                    const { id: _id, ...safeUpdates } = updates as any;
                    const existing = await db.entities.get(id);
                    if (existing) {
                        await db.entities.put({
                            ...existing,
                            ...safeUpdates,
                            last_updated_at: now,
                        });
                    }
                }
            });
            console.log(`[MemoryStore] Batch updated ${updatesList.length} entities`);
        } catch (e) {
            console.error('[MemoryStore] Failed to batch update entities:', e);
            throw e;
        }
    },

    updateEntity: async (entityId, updates) => {
        if (!entityId) return;
        const db = getCurrentDb();
        if (!db) return;

        try {
            const { id: _id, ...safeUpdates } = updates as any;

            const existing = await db.entities.get(entityId);
            if (!existing) {
                console.warn(`[MemoryStore] Entity not found for update: ${entityId}`);
                return;
            }

            const merged = {
                ...existing,
                ...safeUpdates,
                last_updated_at: Date.now(),
            };

            await db.entities.put(merged);
            console.log(`[MemoryStore] Put completed for entity: ${entityId}`);
        } catch (e) {
            console.error('[MemoryStore] Failed to update entity:', e);
            throw e;
        }
    }
});
