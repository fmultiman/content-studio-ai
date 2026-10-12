// Shared in-memory fake of the service-role database used by the Gemini image route tests (FUTURE-064 Slices A and C).
// It runs the REAL Attempt lifecycle code (lib/image-generation/execution.ts) and enforces the constraints that matter to
// the tests: the unique (user_id, client_request_id) of Attempts and — for provider_usage_events — the UNIQUE
// idempotency_key (ON CONFLICT DO NOTHING), the quantity/unit/measurement_source shape check and the unit allow-list of
// scripts/044, applied all-or-none per statement exactly like the real single-statement upsert.

export type Row = Record<string, unknown>
export type FakeDb = ReturnType<typeof createFakeDb>
export type Injected = { code?: string; message: string } | undefined

export const USAGE_UNITS = ['credits', 'units', 'tokens', 'input_tokens', 'output_tokens', 'images', 'seconds', 'requests', 'characters']
export const MEASUREMENT_SOURCES = ['provider_reported', 'balance_delta', 'estimated', 'derived', 'manual_import', 'unknown']

function usageRowViolation(row: Row): string | null {
  for (const column of ['provider', 'transport', 'operation', 'resource_type', 'idempotency_key']) {
    if (typeof row[column] !== 'string' || !(row[column] as string).length) return `${column} check`
  }
  if (!MEASUREMENT_SOURCES.includes(row.measurement_source as string)) return 'measurement_source check'
  if (row.unit != null && !USAGE_UNITS.includes(row.unit as string)) return 'unit check'
  if (row.quantity != null && !(typeof row.quantity === 'number' && row.quantity >= 0)) return 'quantity check'
  const unknown = row.quantity == null && row.unit == null && row.measurement_source === 'unknown'
  const known = row.quantity != null && row.unit != null && row.measurement_source !== 'unknown'
  if (!unknown && !known) return 'quantity_shape check'
  if (row.resource_id != null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(row.resource_id))) return 'resource_id uuid'
  return null
}

export function createFakeDb(seed: Record<string, Row[]> = {}, failOn: (table: string, op: string) => Injected = () => undefined) {
  const tables: Record<string, Row[]> = {
    image_generation_sessions: [], projects: [], productions: [], image_generation_attempts: [], images: [], provider_usage_events: [],
    ...Object.fromEntries(Object.entries(seed).map(([name, rows]) => [name, rows.map((row) => ({ ...row }))])),
  }
  const writes: Array<{ table: string; op: string }> = []
  function from(table: string) {
    const rows = tables[table] ?? (tables[table] = [])
    const state = {
      op: 'select', filters: [] as Array<(row: Row) => boolean>, row: null as Row | Row[] | null, patch: null as Row | null, returning: false,
      single: null as null | 'maybe' | 'one', order: null as null | [string, boolean], limit: null as number | null, ignoreDuplicates: false,
    }
    const builder: Record<string, unknown> = {}
    const chain = (fn: () => void) => () => { fn(); return builder }
    builder.select = chain(() => { if (state.op !== 'select') state.returning = true })
    builder.insert = (row: Row) => { state.op = 'insert'; state.row = row; return builder }
    builder.update = (patch: Row) => { state.op = 'update'; state.patch = patch; return builder }
    builder.upsert = (row: Row | Row[], opts?: { ignoreDuplicates?: boolean }) => { state.op = 'upsert'; state.row = row; state.ignoreDuplicates = !!opts?.ignoreDuplicates; return builder }
    builder.eq = (column: string, value: unknown) => { state.filters.push((row) => row[column] === value); return builder }
    builder.in = (column: string, values: unknown[]) => { state.filters.push((row) => values.includes(row[column])); return builder }
    builder.order = (column: string, opts: { ascending: boolean }) => { state.order = [column, opts.ascending]; return builder }
    builder.limit = (n: number) => { state.limit = n; return builder }
    builder.maybeSingle = () => { state.single = 'maybe'; return run() }
    builder.single = () => { state.single = 'one'; return run() }
    builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => run().then(resolve, reject)

    async function run() {
      await Promise.resolve()
      if (state.op !== 'select') writes.push({ table, op: state.op })
      const injected = failOn(table, state.op)
      if (injected) return { data: null, error: injected }
      const matches = () => rows.filter((row) => state.filters.every((filter) => filter(row)))
      let result: Row[]
      if (table === 'provider_usage_events' && state.op === 'upsert') {
        // One statement: every row is validated first (a violation rejects the WHOLE statement), then duplicates are skipped.
        const incoming = (Array.isArray(state.row) ? state.row : [state.row!]).map((row) => ({ ...row }))
        for (const row of incoming) {
          const violation = usageRowViolation(row)
          if (violation) return { data: null, error: { code: '23514', message: violation } }
        }
        for (const row of incoming) {
          if (rows.some((existing) => existing.idempotency_key === row.idempotency_key)) continue
          rows.push({ id: crypto.randomUUID(), created_at: new Date().toISOString(), occurred_at: new Date().toISOString(), ...row })
        }
        return { data: null, error: null }
      }
      if (state.op === 'insert' || state.op === 'upsert') {
        const incoming = { ...(state.row as Row) }
        const clash = table === 'image_generation_attempts'
          ? rows.find((row) => row.user_id === incoming.user_id && row.client_request_id === incoming.client_request_id)
          : table === 'images' ? rows.find((row) => row.id === incoming.id) : undefined
        if (clash) {
          if (state.op === 'upsert' && state.ignoreDuplicates) return finish([])
          if (state.op === 'insert') return { data: null, error: { code: '23505', message: 'duplicate key' } }
        }
        const stored = { id: crypto.randomUUID(), created_at: new Date().toISOString(), result_image_id: null, provider_task_id: null, failure_details: null, result_metadata: null, completed_at: null, ...incoming }
        rows.push(stored)
        result = [stored]
      } else if (state.op === 'update') {
        result = matches()
        for (const row of result) Object.assign(row, state.patch)
      } else {
        result = matches()
        if (state.order) { const [column, ascending] = state.order; result = [...result].sort((a, b) => (Number(a[column]) - Number(b[column])) * (ascending ? 1 : -1)) }
        if (state.limit !== null) result = result.slice(0, state.limit)
      }
      return finish(result)
    }
    function finish(result: Row[]) {
      if (state.op === 'update' && !state.returning) return { data: null, error: null }
      if (state.single === 'maybe') return { data: result[0] ? { ...result[0] } : null, error: null }
      if (state.single === 'one') return result[0] ? { data: { ...result[0] }, error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } }
      return { data: result.map((row) => ({ ...row })), error: null }
    }
    return builder
  }
  return { from, tables, writes }
}
