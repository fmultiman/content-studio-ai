import type { SupabaseClient } from '@supabase/supabase-js'

// A RECORDING fake of the Supabase query builder for read-only data-layer tests.
//   * It enforces every filter it receives (`eq`, `in`), so a query that forgets its `user_id` filter would leak another user's rows;
//   * `head` count queries return the exact filtered count, list queries honour `order`/`limit` like the real thing;
//   * every write method throws, so a test proves a loader is read-only;
//   * `failing` tables answer with an error for every query; `failingHeadOnly` tables only for `head` (count) queries.

export type Row = Record<string, any>
export type Recorded = { table: string; filters: Array<[string, string, unknown]>; head: boolean; limit?: number; orderBy: string[] }

export function createRecordingSupabase(tables: Record<string, Row[]>, failing: Set<string> = new Set(), failingHeadOnly: Set<string> = new Set()) {
  const log: Recorded[] = []
  const client = {
    from(table: string) {
      const q: Recorded = { table, filters: [], head: false, orderBy: [] }
      const builder: any = {
        select(_columns: string, options?: { head?: boolean }) { q.head = Boolean(options?.head); return builder },
        eq(column: string, value: unknown) { q.filters.push(['eq', column, value]); return builder },
        in(column: string, values: unknown[]) { q.filters.push(['in', column, values]); return builder },
        order(column: string) { q.orderBy.push(column); return builder },
        limit(n: number) { q.limit = n; return builder },
        insert() { throw new Error('write attempted: insert') },
        update() { throw new Error('write attempted: update') },
        upsert() { throw new Error('write attempted: upsert') },
        delete() { throw new Error('write attempted: delete') },
        then(resolve: (value: unknown) => unknown) {
          log.push(q)
          if (failing.has(table) || (q.head && failingHeadOnly.has(table))) return resolve({ data: null, error: { message: 'boom' }, count: null })
          let rows = (tables[table] ?? []).filter((row) => q.filters.every(([kind, column, value]) => (
            kind === 'eq' ? row[column] === value : (value as unknown[]).includes(row[column])
          )))
          const sortKey = q.orderBy.includes('updated_at') ? 'updated_at' : q.orderBy.includes('created_at') ? 'created_at' : null
          if (sortKey) rows = [...rows].sort((a, b) => new Date(b[sortKey]).getTime() - new Date(a[sortKey]).getTime())
          if (q.head) return resolve({ data: null, error: null, count: rows.length })
          return resolve({ data: q.limit ? rows.slice(0, q.limit) : rows, error: null, count: null })
        },
      }
      return builder
    },
  }
  return { supabase: client as unknown as SupabaseClient, log }
}
