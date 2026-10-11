import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

// Test-only: a minimal PostgREST-shaped in-memory fake of the two credential tables (user_settings and
// provider_api_credentials) and of the Slice 3B backfill function. Shared by the store, Settings/resolver, backfill and sweep
// tests. Dummy data only. It models the DECISION LOGIC of the SQL function (hash compare, insert-on-conflict-do-nothing); the
// row-lock semantics that make it race-safe are proven separately against a real PostgreSQL (PGlite for the logic, the opt-in
// local-stack suite for true concurrency).

export const LEAK = 'sk-DUMMY-LEAK-IN-DB-MESSAGE'

export type Row = Record<string, any>
export type Tables = { user_settings: Row[]; provider_api_credentials: Row[] }
export type Failure = { table: keyof Tables; op: 'select' | 'upsert' | 'update' | 'delete' | 'rpc'; times?: number; /** rpc only: fail just the calls this returns true for */ match?: (args: Record<string, unknown>) => boolean }
export type Access = { client: string; table: string; op: string }

const LEGACY_COLUMN: Record<string, string> = { openai: 'openai_api_key', gemini: 'gemini_api_key', nano_banana: 'nanobanana_api_key', kling: 'kling_api_key' }

export interface FakeOptions {
  sessionUser?: string
  failures?: Failure[]
  /**
   * Runs INSIDE the backfill function call, before its row lock is "taken" — i.e. after the application read the legacy value
   * and before the database decides. Use it to simulate a concurrent removal/replacement/encrypted write.
   */
  beforeBackfill?: (args: Record<string, unknown>, tables: Tables) => void
}

/** Minimal PostgREST-shaped in-memory fake. `sessionUser` emulates the own-row RLS read of user_settings. */
export function makeDb(name: string, tables: Tables, access: Access[], options: FakeOptions = {}) {
  const failures = options.failures ?? []
  const fail = (table: keyof Tables, op: Failure['op'], args?: Record<string, unknown>) => {
    const hit = failures.find((f) => f.table === table && f.op === op && (f.times === undefined || f.times > 0) && (!f.match || (args !== undefined && f.match(args))))
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
          const eq: Array<[string, unknown]> = []
          const inFilters: Array<[string, unknown[]]> = []
          let after: [string, string] | null = null
          let orderBy: { column: string; ascending: boolean } | null = null
          let limit: number | null = null
          const run = () => {
            record('select')
            const error = fail(t, 'select')
            if (error) return { data: null, error }
            let result = visible(t).filter((r) => eq.every(([k, v]) => r[k] === v) && inFilters.every(([k, vs]) => vs.includes(r[k])) && (!after || String(r[after[0]]) > after[1]))
            if (orderBy) {
              const { column, ascending } = orderBy
              result = [...result].sort((a, b) => (a[column] < b[column] ? -1 : a[column] > b[column] ? 1 : 0) * (ascending ? 1 : -1))
            }
            if (limit !== null) result = result.slice(0, limit)
            return { data: result.map((r) => project(r, columns)), error: null }
          }
          const builder: any = {
            eq(column: string, value: unknown) { eq.push([column, value]); return builder },
            in(column: string, values: unknown[]) { inFilters.push([column, values]); return builder },
            gt(column: string, value: string) { after = [column, value]; return builder },
            order(column: string, opts: { ascending?: boolean } = {}) { orderBy = { column, ascending: opts.ascending !== false }; return builder },
            limit(n: number) { limit = n; return builder },
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

    /** The Slice 3B function: lock the settings row, refuse unless the legacy hash is unchanged, insert ON CONFLICT DO NOTHING. */
    async rpc(fn: string, args: Record<string, any>) {
      access.push({ client: name, table: 'provider_api_credentials', op: `rpc:${fn}` })
      const error = fail('provider_api_credentials', 'rpc', args)
      if (error) return { data: null, error }
      if (fn !== 'backfill_provider_api_credential') return { data: null, error: { message: 'function not found' } }
      options.beforeBackfill?.(args, tables)
      const settings = tables.user_settings.find((r) => r.user_id === args.p_user_id)
      if (!settings) return { data: 'no_settings_row', error: null }
      const current = settings[LEGACY_COLUMN[args.p_provider]]
      if (typeof current !== 'string' || createHash('sha256').update(current, 'utf8').digest('hex') !== args.p_expected_legacy_sha256) return { data: 'legacy_changed', error: null }
      if (tables.provider_api_credentials.some((r) => r.user_id === args.p_user_id && r.provider === args.p_provider)) return { data: 'exists', error: null }
      tables.provider_api_credentials.push({
        id: `provider_api_credentials-${tables.provider_api_credentials.length + 1}`,
        user_id: args.p_user_id, provider: args.p_provider, ciphertext: args.p_ciphertext, key_id: args.p_key_id,
        format_version: args.p_format_version, secret_version: 1, source: 'legacy_backfill',
      })
      return { data: 'inserted', error: null }
    },
  } as unknown as SupabaseClient
}
