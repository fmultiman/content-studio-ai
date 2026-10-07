// Test-only in-memory stand-in for the Supabase tables the Video Review flow touches.
// It mirrors the database rules the flow depends on (migrations 056-060): artifact identity
// uniqueness, the provenance unique key, the per-user clientRequestId key, the single in-flight
// Video Review per artifact, and terminal Review immutability. Not a general query engine.

import { randomUUID } from 'node:crypto'

export type Row = Record<string, any>

export type FakeDbOptions = {
  /** Fail the Review insert (persistence failure). */
  failReviewInsert?: boolean
  /** Fail the UPDATE that would mark a Review with this status. */
  failUpdateToStatus?: string
  beforeInsert?: (table: string, tables: Record<string, Row[]>) => void
}

export function createReviewTestDb(seed: Record<string, Row[]> = {}, options: FakeDbOptions = {}) {
  const tables: Record<string, Row[]> = {}
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((row) => ({ ...row }))
  const log: Array<{ op: string; table: string; values?: Row; id?: string }> = []

  function uniqueViolation(table: string, row: Row, ignoreId?: string): { code: string; message: string } | null {
    const rows = (tables[table] ?? []).filter((other) => other.id !== ignoreId)
    if (table === 'media_artifacts') {
      const clash = rows.some((o) => o.user_id === row.user_id && o.media_type === row.media_type && o.storage_provider === row.storage_provider
        && o.storage_path === row.storage_path && (o.version === row.version || (row.content_hash && o.content_hash === row.content_hash)))
      return clash ? { code: '23505', message: 'duplicate key value violates unique constraint "media_artifacts_storage_version_key"' } : null
    }
    if (table === 'media_reviews') {
      if (rows.some((o) => o.user_id === row.user_id && o.client_request_id === row.client_request_id)) {
        return { code: '23505', message: 'duplicate key value violates unique constraint "media_reviews_user_client_request_key"' }
      }
      if (row.subject_media_type === 'image' && ['pending', 'running'].includes(row.status)
        && rows.some((o) => o.subject_media_type === 'image' && o.image_attempt_id === row.image_attempt_id && ['pending', 'running'].includes(o.status))) {
        return { code: '23505', message: 'duplicate key value violates unique constraint "media_reviews_active_attempt_key"' }
      }
      if (row.subject_media_type === 'video' && ['pending', 'running'].includes(row.status)
        && rows.some((o) => o.subject_media_type === 'video' && o.media_artifact_id === row.media_artifact_id && ['pending', 'running'].includes(o.status))) {
        return { code: '23505', message: 'duplicate key value violates unique constraint "media_reviews_active_video_artifact_key"' }
      }
    }
    return null
  }

  function applyShape(table: string, row: Row): { code?: string; message: string } | null {
    if (table !== 'media_reviews') return null
    // media_reviews_subject_shape (migration 060)
    const image = row.subject_media_type === 'image' && row.image_attempt_id && row.image_output_id && row.media_artifact_id
    const video = row.subject_media_type === 'video' && !row.image_attempt_id && !row.image_output_id && row.media_artifact_id
    return image || video ? null : { code: '23514', message: 'new row violates check constraint "media_reviews_subject_shape"' }
  }

  return {
    tables,
    log,
    from(table: string) {
      const eqs: Array<[string, unknown]> = []
      const ins: Array<[string, unknown[]]> = []
      const lts: Array<[string, string]> = []
      let op: 'select' | 'insert' | 'update' = 'select'
      let values: Row = {}
      let orderBy: { column: string; ascending: boolean } | null = null
      let limitTo: number | null = null
      const match = () => {
        let rows = (tables[table] ?? []).filter((row) => eqs.every(([k, v]) => row[k] === v) && ins.every(([k, vs]) => vs.includes(row[k])) && lts.every(([k, v]) => row[k] < v))
        if (orderBy) {
          const { column, ascending } = orderBy
          rows = [...rows].sort((a, b) => (a[column] === b[column] ? 0 : (a[column] > b[column] ? 1 : -1) * (ascending ? 1 : -1)))
        }
        return limitTo === null ? rows : rows.slice(0, limitTo)
      }

      function run(): { data: Row | null; error: any } {
        if (op === 'insert') {
          options.beforeInsert?.(table, tables)
          if (table === 'media_reviews' && options.failReviewInsert) return { data: null, error: { code: 'XX000', message: 'insert failed' } }
          const reviewDefaults: Row = table === 'media_reviews' ? {
            evaluator_provider: null, evaluator_model: null, evaluator_prompt_version: null, overall_score: null,
            overall_assessment: null, summary: null, refined_prompt: null, failure_code: null, failure_details: null,
            legacy_source_key: null, started_at: null, completed_at: null, failed_at: null,
          } : {}
          const row: Row = {
            id: randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
            ...reviewDefaults,
            ...values,
          }
          const shape = applyShape(table, row)
          if (shape) return { data: null, error: shape }
          const clash = uniqueViolation(table, row)
          if (clash) return { data: null, error: clash }
          ;(tables[table] ??= []).push(row)
          log.push({ op: 'insert', table, values: { ...row } })
          return { data: row, error: null }
        }
        if (op === 'update') {
          const targets = match()
          if (!targets.length) return { data: null, error: { code: 'PGRST116', message: 'no rows' } }
          const target = targets[0]
          if (table === 'media_reviews') {
            if (['completed', 'failed'].includes(target.status)) return { data: null, error: { message: 'MEDIA_REVIEW_TERMINAL_IMMUTABLE' } }
            if (options.failUpdateToStatus && values.status === options.failUpdateToStatus) return { data: null, error: { code: 'XX000', message: 'update failed' } }
          }
          Object.assign(target, values, { updated_at: new Date().toISOString() })
          log.push({ op: 'update', table, values: { ...values }, id: target.id })
          return { data: target, error: null }
        }
        return { data: match()[0] ?? null, error: null }
      }

      const builder: any = {
        select: () => builder,
        eq: (column: string, value: unknown) => { eqs.push([column, value]); return builder },
        in: (column: string, vs: unknown[]) => { ins.push([column, vs]); return builder },
        lt: (column: string, value: string) => { lts.push([column, value]); return builder },
        order: (column: string, options?: { ascending?: boolean }) => { orderBy = { column, ascending: options?.ascending !== false }; return builder },
        limit: (count: number) => { limitTo = count; return builder },
        maybeSingle: async () => {
          const result = run()
          // PostgREST: `.maybeSingle()` on zero rows is a normal null, never PGRST116 (only `.single()` errors).
          return op === 'update' && result.error?.code === 'PGRST116' ? { data: null, error: null } : result
        },
        single: async () => {
          const result = run()
          return op === 'select' && !result.data ? { data: null, error: { code: 'PGRST116', message: 'no rows' } } : result
        },
        then: (resolve: (value: unknown) => unknown) => resolve({ data: match(), error: null }),
        insert: (v: Row) => { op = 'insert'; values = v; return builder },
        update: (v: Row) => { op = 'update'; values = v; return builder },
        upsert: async (v: Row, opts: { onConflict: string }) => {
          if (table === 'media_artifact_provenance') {
            if (!v.provenance_key) return { error: { code: '23502', message: 'null provenance_key' } }
            if (opts.onConflict !== 'artifact_id,provenance_key') return { error: { code: '42P10', message: 'no unique constraint matches' } }
            if ((tables[table] ?? []).some((r) => r.artifact_id === v.artifact_id && r.provenance_key === v.provenance_key)) return { error: null }
          }
          ;(tables[table] ??= []).push({ ...v })
          log.push({ op: 'upsert', table, values: v })
          return { error: null }
        },
      }
      return builder
    },
  } as any
}
