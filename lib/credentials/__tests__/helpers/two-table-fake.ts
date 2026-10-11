import type { SupabaseClient } from '@supabase/supabase-js'

// Test-only: a minimal PostgREST-shaped in-memory fake of the two credential tables (user_settings and
// provider_api_credentials). Shared by the store tests and the Settings/resolver compatibility tests. Dummy data only.

export const LEAK = 'sk-DUMMY-LEAK-IN-DB-MESSAGE'

export type Row = Record<string, any>
export type Tables = { user_settings: Row[]; provider_api_credentials: Row[] }
export type Failure = { table: keyof Tables; op: 'select' | 'upsert' | 'update' | 'delete'; times?: number }
export type Access = { client: string; table: string; op: string }

/** Minimal PostgREST-shaped in-memory fake for the two tables. `sessionUser` emulates the own-row RLS read of user_settings. */
export function makeDb(name: string, tables: Tables, access: Access[], options: { sessionUser?: string; failures?: Failure[] } = {}) {
  const failures = options.failures ?? []
  const fail = (table: keyof Tables, op: Failure['op']) => {
    const hit = failures.find((f) => f.table === table && f.op === op && (f.times === undefined || f.times > 0))
    if (!hit) return null
    if (hit.times !== undefined) hit.times -= 1
    return { message: LEAK }
  }
  const visible = (table: keyof Tables) => (options.sessionUser && table === 'user_settings' ? tables[table].filter((r) => r.user_id === options.sessionUser) : tables[table])
  const project = (row: Row, columns: string) => (columns === '*' ? { ...row } : Object.fromEntries(columns.split(',').map((c) => c.trim()).map((c) => [c, row[c]])))

  return {
    from(table: string) {
      const t = table as keyof Tables
      if (!(t in tables)) throw new Error(`unexpected table ${table}`)
      const record = (op: string) => access.push({ client: name, table, op })
      return {
        select(columns: string) {
          const filters: Record<string, unknown> = {}
          const run = () => {
            record('select')
            const error = fail(t, 'select')
            if (error) return { data: null, error }
            return { data: visible(t).filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v)).map((r) => project(r, columns)), error: null }
          }
          const builder: any = {
            eq(column: string, value: unknown) { filters[column] = value; return builder },
            async maybeSingle() { const r = run(); return r.error ? r : { data: (r.data as Row[])[0] ?? null, error: null } },
            then(resolve: (v: unknown) => unknown) { return Promise.resolve(run()).then(resolve) },
          }
          return builder
        },
        async upsert(payload: Row, opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
          record('upsert')
          const error = fail(t, 'upsert')
          if (error) return { error }
          const keys = (opts.onConflict ?? 'id').split(',')
          const existing = tables[t].find((r) => keys.every((k) => r[k] === payload[k]))
          if (existing) { if (!opts.ignoreDuplicates) Object.assign(existing, payload) } else tables[t].push({ id: `${t}-${tables[t].length + 1}`, ...payload })
          return { error: null }
        },
        update(payload: Row) {
          return { async eq(column: string, value: unknown) {
            record('update')
            const error = fail(t, 'update')
            if (error) return { error }
            for (const r of tables[t]) if (r[column] === value) Object.assign(r, payload)
            return { error: null }
          } }
        },
        delete() {
          const filters: Record<string, unknown> = {}
          const builder: any = {
            eq(column: string, value: unknown) { filters[column] = value; return builder },
            then(resolve: (v: unknown) => unknown) {
              record('delete')
              const error = fail(t, 'delete')
              if (error) return Promise.resolve({ error }).then(resolve)
              tables[t] = tables[t].filter((r) => !Object.entries(filters).every(([k, v]) => r[k] === v))
              return Promise.resolve({ error: null }).then(resolve)
            },
          }
          return builder
        },
      }
    },
  } as unknown as SupabaseClient
}

