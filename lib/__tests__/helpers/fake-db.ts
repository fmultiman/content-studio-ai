// Test-only in-memory stand-in for the slice of the Supabase query builder used
// by lib/provider-connections. It implements real semantics that the code under
// test depends on: filters, unique constraints, upsert-on-conflict, and an
// atomic delete-that-returns-the-deleted-row (single-use OAuth state).

import { randomUUID } from 'node:crypto'

type Row = Record<string, any>

export interface FakeDbOptions {
  seed?: Record<string, Row[]>
  /** Unique column sets per table, e.g. { provider_oauth_authorizations: [['state_hash']] } */
  unique?: Record<string, string[][]>
  /** Tables whose rows get a generated `id` when missing. */
  generatedId?: string[]
  /** UNIQUE ... WHERE partial indexes: a row only counts toward (and is checked against) the index when `where` holds. */
  uniquePartial?: Record<string, Array<{ columns: string[]; where: (row: Record<string, any>) => boolean }>>
  /** Column defaults / triggers: runs on a row just before it is inserted (e.g. updated_at DEFAULT). */
  onInsert?: Record<string, (row: Record<string, any>) => void>
  /** BEFORE UPDATE triggers: runs on every row an update touches, after the patch is applied (e.g. updated_at). */
  onUpdate?: Record<string, (row: Record<string, any>) => void>
}

const DEFAULT_UNIQUE: Record<string, string[][]> = {
  provider_connections: [['id'], ['user_id', 'provider', 'connection_method']],
  provider_connection_secrets: [['connection_id']],
  provider_oauth_clients: [['provider', 'issuer', 'redirect_uri']],
  provider_oauth_authorizations: [['state_hash']],
  user_settings: [['user_id']],
  video_generations: [['id']],
  video_generation_sessions: [['id']],
  provider_usage_events: [['idempotency_key']],
}

// Partial unique indexes that exist in the real schema (scripts/049): one logical Generate submit per (user, key).
const DEFAULT_UNIQUE_PARTIAL: Record<string, Array<{ columns: string[]; where: (row: Record<string, any>) => boolean }>> = {
  video_generations: [{ columns: ['user_id', 'client_request_id'], where: (row) => row.client_request_id !== null && row.client_request_id !== undefined }],
}

const DEFAULT_GENERATED_ID = ['provider_connections', 'provider_oauth_clients', 'video_generations', 'provider_usage_events']

export interface FakeDb {
  from: (table: string) => any
  tables: Record<string, Row[]>
  /** Every operation issued, in order: `${op}:${table}`. */
  log: string[]
}

export function createFakeDb(options: FakeDbOptions = {}): FakeDb {
  const tables: Record<string, Row[]> = {}
  for (const [table, rows] of Object.entries(options.seed ?? {})) tables[table] = rows.map((row) => ({ ...row }))
  const unique = { ...DEFAULT_UNIQUE, ...(options.unique ?? {}) }
  const uniquePartial = { ...DEFAULT_UNIQUE_PARTIAL, ...(options.uniquePartial ?? {}) }
  const generatedId = options.generatedId ?? DEFAULT_GENERATED_ID
  const log: string[] = []

  const rowsOf = (table: string) => (tables[table] ??= [])

  const matches = (row: Row, filters: Array<[string, string, any]>) =>
    filters.every(([column, op, value]) => {
      if (op === 'eq') return row[column] === value
      if (op === 'lt') return row[column] < value
      if (op === 'gt') return row[column] !== null && row[column] !== undefined && row[column] > value
      if (op === 'lte') return row[column] !== null && row[column] !== undefined && row[column] <= value
      if (op === 'in') return (value as any[]).includes(row[column])
      if (op === 'is') return (row[column] ?? null) === value
      if (op === 'notnull') return row[column] !== null && row[column] !== undefined
      // PostgREST `.or('col.eq.value,col2.eq.value2')` (equality terms only): the row matches when ANY term does.
      if (op === 'or') return (value as Array<[string, string]>).some(([orColumn, orValue]) => String(row[orColumn]) === orValue)
      if (op === 'contains') {
        // jsonb @> for an array of objects: every wanted element is matched by some stored element.
        const stored = row[column]
        return Array.isArray(stored) && (value as any[]).every((wanted) => stored.some((entry: any) => entry && typeof entry === 'object' && Object.entries(wanted).every(([k, v]) => entry[k] === v)))
      }
      return true
    })

  const violatesUnique = (table: string, candidate: Row, ignore?: Row) =>
    (unique[table] ?? []).some((cols) =>
      rowsOf(table).some(
        (existing) => existing !== ignore && cols.every((col) => candidate[col] !== undefined && existing[col] === candidate[col]),
      ),
    ) ||
    (uniquePartial[table] ?? []).some(
      ({ columns, where }) =>
        where(candidate) &&
        rowsOf(table).some((existing) => existing !== ignore && where(existing) && columns.every((col) => existing[col] === candidate[col])),
    )

  function from(table: string) {
    let op: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select'
    let payload: Row = {}
    let onConflict: string[] = []
    let ignoreDuplicates = false
    const filters: Array<[string, string, any]> = []
    let returning = false
    const orderBy: Array<[string, boolean]> = []

    const execute = (): { data: Row[] | null; error: any } => {
      log.push(`${op}:${table}`)
      const rows = rowsOf(table)

      if (op === 'select') {
        const selected = rows.filter((row) => matches(row, filters)).map((row) => ({ ...row }))
        // Honors .order(); without it rows keep insertion order, as before.
        selected.sort((a, b) => {
          for (const [column, ascending] of orderBy) {
            if (a[column] === b[column]) continue
            return (a[column] < b[column] ? -1 : 1) * (ascending ? 1 : -1)
          }
          return 0
        })
        return { data: selected, error: null }
      }

      if (op === 'insert' || op === 'upsert') {
        const row: Row = { ...payload }
        if (generatedId.includes(table) && row.id === undefined) row.id = randomUUID()
        row.created_at ??= new Date().toISOString()
        options.onInsert?.[table]?.(row)

        if (op === 'upsert' && onConflict.length > 0) {
          const existing = rows.find((candidate) => onConflict.every((col) => candidate[col] === row[col]))
          if (existing) {
            // ON CONFLICT DO NOTHING keeps the original row untouched and returns nothing.
            if (ignoreDuplicates) return { data: [], error: null }
            Object.assign(existing, payload)
            return { data: [{ ...existing }], error: null }
          }
        }
        if (violatesUnique(table, row)) return { data: null, error: { code: '23505', message: 'duplicate key' } }
        rows.push(row)
        return { data: [{ ...row }], error: null }
      }

      if (op === 'update') {
        const targets = rows.filter((row) => matches(row, filters))
        for (const row of targets) {
          Object.assign(row, payload)
          options.onUpdate?.[table]?.(row)
        }
        return { data: returning ? targets.map((row) => ({ ...row })) : null, error: null }
      }

      // delete: atomic delete-and-return
      const removed = rows.filter((row) => matches(row, filters))
      tables[table] = rows.filter((row) => !removed.includes(row))
      return { data: returning ? removed.map((row) => ({ ...row })) : null, error: null }
    }

    const builder: any = {
      select() {
        returning = true
        return builder
      },
      insert(row: Row) {
        op = 'insert'
        payload = row
        return builder
      },
      upsert(row: Row, opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
        op = 'upsert'
        payload = row
        ignoreDuplicates = opts?.ignoreDuplicates === true
        onConflict = opts?.onConflict ? opts.onConflict.split(',').map((column) => column.trim()) : []
        return builder
      },
      update(patch: Row) {
        op = 'update'
        payload = patch
        return builder
      },
      delete() {
        op = 'delete'
        return builder
      },
      eq(column: string, value: any) {
        filters.push([column, 'eq', value])
        return builder
      },
      lt(column: string, value: any) {
        filters.push([column, 'lt', value])
        return builder
      },
      gt(column: string, value: any) {
        filters.push([column, 'gt', value])
        return builder
      },
      lte(column: string, value: any) {
        filters.push([column, 'lte', value])
        return builder
      },
      in(column: string, value: any[]) {
        filters.push([column, 'in', value])
        return builder
      },
      or(expression: string) {
        const terms = expression.split(',').map((term) => {
          const match = /^([A-Za-z0-9_]+)\.eq\.(.*)$/.exec(term.trim())
          if (!match) throw new Error(`fake-db or(): only equality terms are supported, got "${term}"`)
          return [match[1], match[2]] as [string, string]
        })
        filters.push(['', 'or', terms])
        return builder
      },
      is(column: string, value: any) {
        filters.push([column, 'is', value])
        return builder
      },
      /** `.not(col, 'is', null)` only. */
      not(column: string, operator: string, value: any) {
        if (operator === 'is' && value === null) filters.push([column, 'notnull', null])
        return builder
      },
      contains(column: string, value: any) {
        // Mirrors postgrest-js serialization: a JS array becomes a Postgres ARRAY literal `{a,b}` (wrong for jsonb
        // objects), so a jsonb containment must be handed over as a JSON string (`cs.[...]`).
        if (typeof value === 'string') return filters.push([column, 'contains', JSON.parse(value)]), builder
        if (Array.isArray(value) && value.some((entry) => entry !== null && typeof entry === 'object')) {
          throw new Error('contains(): an array of objects is serialized as a Postgres array literal; pass JSON.stringify(...) for jsonb')
        }
        filters.push([column, 'contains', value])
        return builder
      },
      order(column: string, opts?: { ascending?: boolean }) {
        orderBy.push([column, opts?.ascending !== false])
        return builder
      },
      limit() {
        return builder
      },
      maybeSingle() {
        const { data, error } = execute()
        return Promise.resolve({ data: data?.[0] ?? null, error })
      },
      single() {
        const { data, error } = execute()
        return Promise.resolve({ data: data?.[0] ?? null, error: error ?? (data?.[0] ? null : { message: 'no rows' }) })
      },
      then(resolve: (value: any) => any, reject?: (reason: any) => any) {
        try {
          return Promise.resolve(execute()).then(resolve, reject)
        } catch (error) {
          return Promise.reject(error).then(resolve, reject)
        }
      },
    }
    return builder
  }

  return { from, tables, log }
}

/** 32 zero-entropy-irrelevant bytes: a TEST-ONLY key, never used outside tests. */
export const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
export const OTHER_TEST_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64')

export function useTestConnectionEnv() {
  process.env.PROVIDER_CONNECTION_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY
  delete process.env.PROVIDER_CONNECTION_ENCRYPTION_KEY_ID
  delete process.env.PROVIDER_CONNECTION_ENCRYPTION_KEY_PREVIOUS
  delete process.env.PROVIDER_CONNECTION_ENCRYPTION_KEY_PREVIOUS_ID
  process.env.NEXT_PUBLIC_APP_URL = 'https://content.example.test'
}

export function clearTestConnectionEnv() {
  delete process.env.PROVIDER_CONNECTION_ENCRYPTION_KEY
  delete process.env.PROVIDER_CONNECTION_ENCRYPTION_KEY_ID
  delete process.env.PROVIDER_CONNECTION_ENCRYPTION_KEY_PREVIOUS
  delete process.env.PROVIDER_CONNECTION_ENCRYPTION_KEY_PREVIOUS_ID
}
