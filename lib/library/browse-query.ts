// MEDIA_LIBRARY_PRODUCTION_SCOPING_V1
//
// Pure pieces of the scalable Library browse boundary (GET /api/library-files/browse).
//
// Sort contract: newest first by (created_at DESC, id DESC). `created_at` never changes after creation
// (unlike updated_at, which a move bumps), so a page boundary cannot shift under the reader; `id` breaks ties
// so the order is total and the keyset cursor is exact. The cursor is opaque to callers.

import { isUuid } from '@/lib/library/production-scope'

export const BROWSE_DEFAULT_LIMIT = 48
export const BROWSE_MAX_LIMIT = 100
export const BROWSE_MAX_SEARCH_LENGTH = 100

export const BROWSE_KINDS = ['image', 'video', 'audio', 'document', 'other'] as const
export type BrowseKind = (typeof BROWSE_KINDS)[number]

export type ProductionFilter = { mode: 'all' } | { mode: 'unscoped' } | { mode: 'one'; productionId: string }

export function clampLimit(raw: string | null): number {
  const parsed = Number(raw)
  if (!raw || !Number.isFinite(parsed) || parsed < 1) return BROWSE_DEFAULT_LIMIT
  return Math.min(Math.floor(parsed), BROWSE_MAX_LIMIT)
}

/** `all` (default) | `unscoped` ("Sem Production") | a Production uuid. Anything else is invalid. */
export function parseProductionFilter(raw: string | null): ProductionFilter | null {
  if (raw === null || raw === '' || raw === 'all') return { mode: 'all' }
  if (raw === 'unscoped') return { mode: 'unscoped' }
  return isUuid(raw) ? { mode: 'one', productionId: raw } : null
}

export function parseKind(raw: string | null): BrowseKind | 'all' | null {
  if (raw === null || raw === '' || raw === 'all') return 'all'
  return (BROWSE_KINDS as readonly string[]).includes(raw) ? (raw as BrowseKind) : null
}

/** LIKE wildcards in the user's text are literals, never patterns. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}

export function normalizeSearch(raw: string | null): string | null {
  const trimmed = (raw ?? '').trim().slice(0, BROWSE_MAX_SEARCH_LENGTH)
  return trimmed.length > 0 ? trimmed : null
}

const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/

export interface BrowseCursor {
  createdAt: string
  id: string
}

export function encodeCursor(cursor: BrowseCursor): string {
  return Buffer.from(JSON.stringify([cursor.createdAt, cursor.id]), 'utf8').toString('base64url')
}

/** null for anything that is not exactly a cursor this endpoint produced (validated before it reaches a filter); 'none' when absent. */
export function decodeCursor(raw: string | null): BrowseCursor | null | 'none' {
  if (raw === null || raw === '') return 'none'
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    if (!Array.isArray(parsed) || parsed.length !== 2) return null
    const [createdAt, id] = parsed
    if (typeof createdAt !== 'string' || !TIMESTAMP_RE.test(createdAt) || !isUuid(id)) return null
    return { createdAt, id }
  } catch {
    return null
  }
}

/** PostgREST logic-tree filter selecting rows strictly AFTER the cursor in (created_at DESC, id DESC) order. */
export function keysetFilter(cursor: BrowseCursor): string {
  return `created_at.lt."${cursor.createdAt}",and(created_at.eq."${cursor.createdAt}",id.lt.${cursor.id})`
}

/** Several `or(...)` groups must AND together; PostgREST takes one `or` expression, so they are nested in an `and`. */
export function combineOrGroups(groups: string[]): string | null {
  if (groups.length === 0) return null
  if (groups.length === 1) return groups[0]
  return `and(${groups.map((group) => `or(${group})`).join(',')})`
}
