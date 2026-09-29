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
}

const DEFAULT_UNIQUE: Record<string, string[][]> = {
  provider_connections: [['id'], ['user_id', 'provider', 'connection_method']],
  provider_connection_secrets: [['connection_id']],
  provider_oauth_clients: [['provider', 'issuer', 'redirect_uri']],
  provider_oauth_authorizations: [['state_hash']],
  user_settings: [['user_id']],
  video_generations: [['id']],
}

const DEFAULT_GENERATED_ID = ['provider_connections', 'provider_oauth_clients', 'video_generations']

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
  const generatedId = options.generatedId ?? DEFAULT_GENERATED_ID
  const log: string[] = []

  const rowsOf = (table: string) => (tables[table] ??= [])

  const matches = (row: Row, filters: Array<[string, string, any]>) =>
    filters.every(([column, op, value]) => {
      if (op === 'eq') return row[column] === value
      if (op === 'lt') return row[column] < value
      if (op === 'lte') return row[column] !== null && row[column] !== undefined && row[column] <= value
      if (op === 'in') return (value as any[]).includes(row[column])
      if (op === 'is') return (row[column] ?? null) === value
      return true
    })

  const violatesUnique = (table: string, candidate: Row, ignore?: Row) =>
    (unique[table] ?? []).some((cols) =>
      rowsOf(table).some(
        (existing) => existing !== ignore && cols.every((col) => candidate[col] !== undefined && existing[col] === candidate[col]),
      ),
    )

  function from(table: string) {
    let op: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select'
    let payload: Row = {}
    let onConflict: string[] = []
    const filters: Array<[string, string, any]> = []
    let returning = false

    const execute = (): { data: Row[] | null; error: any } => {
      log.push(`${op}:${table}`)
      const rows = rowsOf(table)

      if (op === 'select') {
        return { data: rows.filter((row) => matches(row, filters)).map((row) => ({ ...row })), error: null }
      }

      if (op === 'insert' || op === 'upsert') {
        const row: Row = { ...payload }
        if (generatedId.includes(table) && row.id === undefined) row.id = randomUUID()
        row.created_at ??= new Date().toISOString()

        if (op === 'upsert' && onConflict.length > 0) {
          const existing = rows.find((candidate) => onConflict.every((col) => candidate[col] === row[col]))
          if (existing) {
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
        for (const row of targets) Object.assign(row, payload)
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
      upsert(row: Row, opts?: { onConflict?: string }) {
        op = 'upsert'
        payload = row
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
      lte(column: string, value: any) {
        filters.push([column, 'lte', value])
        return builder
      },
      in(column: string, value: any[]) {
        filters.push([column, 'in', value])
        return builder
      },
      is(column: string, value: any) {
        filters.push([column, 'is', value])
        return builder
      },
      order() {
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
