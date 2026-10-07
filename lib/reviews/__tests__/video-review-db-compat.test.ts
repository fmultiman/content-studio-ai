import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'

// GEMINI_VIDEO_REVIEW_ADAPTER_V1 — database compatibility proof.
//
// The Video Review service runs end to end against the in-memory test database; every
// artifact, provenance and Review statement it issues is then REPLAYED, in order, into the
// REAL migration history (054, 056, 057, 058, 060) executed by PGlite. If the service wrote
// anything the real constraints, triggers or CHECKs reject (shape, scope, provenance key,
// refined-prompt consistency, lifecycle), this test fails. No Supabase, no network.

const mocks = vi.hoisted(() => ({ resolveProvider: vi.fn() }))
vi.mock('@/lib/credentials/provider-execution', () => ({ resolveProviderExecution: mocks.resolveProvider }))
vi.mock('@/lib/storage/s3', () => ({
  readS3Object: vi.fn(async () => { throw new Error('WHOLE_OBJECT_READ_FORBIDDEN') }),
  openS3ObjectStream: vi.fn(async () => { throw new Error('DEFAULT_S3_OPEN_FORBIDDEN') }),
}))

import { createMigratedReviewDb } from './pglite-review-schema'
import { EXEC, FILE, GEN, GEN_SOURCE, LIB_SOURCE, OWNER, PRODUCTION, PROJECT, RENDER_SOURCE, REQ, API_KEY, setup } from './video-review-harness'

let pg: PGlite

type LogEntry = { op: string; table: string; values?: Record<string, unknown>; id?: string }

async function replay(entries: LogEntry[]) {
  const tables = new Set(['media_artifacts', 'media_artifact_provenance', 'media_reviews'])
  for (const entry of entries.filter((e) => tables.has(e.table) && e.values)) {
    const values = entry.values as Record<string, unknown>
    const columns = Object.keys(values)
    const params = columns.map((column) => {
      const value = values[column]
      return value !== null && typeof value === 'object' ? JSON.stringify(value) : value
    })
    const cast = (column: string, index: number) => (values[column] !== null && typeof values[column] === 'object' ? `$${index + 1}::jsonb` : `$${index + 1}`)
    if (entry.op === 'update') {
      const sets = columns.map((column, index) => `${column} = ${cast(column, index)}`).join(', ')
      await pg.query(`UPDATE public.${entry.table} SET ${sets} WHERE id = $${columns.length + 1}`, [...params, entry.id])
    } else {
      await pg.query(
        `INSERT INTO public.${entry.table} (${columns.join(', ')}) VALUES (${columns.map((c, i) => cast(c, i)).join(', ')})`,
        params,
      )
    }
  }
}

beforeAll(async () => {
  mocks.resolveProvider.mockResolvedValue({ status: 'ready', provider: 'gemini', executionMode: 'user_byok', credentialSource: 'user', secret: API_KEY })
  pg = await createMigratedReviewDb()
  await pg.exec(`
    INSERT INTO auth.users VALUES ('${OWNER}');
    INSERT INTO public.projects VALUES ('${PROJECT}', '${OWNER}');
    INSERT INTO public.productions VALUES ('${PRODUCTION}', '${OWNER}', '${PROJECT}');
    INSERT INTO public.video_generations VALUES ('${GEN}', '${OWNER}', '${PROJECT}', '${PRODUCTION}');
    INSERT INTO public.render_executions VALUES ('${EXEC}', '${OWNER}', '${PROJECT}');
    INSERT INTO public.library_files VALUES ('${FILE}', '${OWNER}', NULL, NULL);
  `)
}, 120_000)

afterAll(async () => { await pg?.close() })

describe('statements issued by the Video Review service satisfy the real schema', () => {
  it('accepts a completed Review for each source family (artifact, provenance, pending -> running -> completed)', async () => {
    let n = 100
    for (const source of [GEN_SOURCE, RENDER_SOURCE, LIB_SOURCE]) {
      n += 1
      const t = setup()
      await t.run(source, n)
      await replay(t.db.log)
    }
    const reviews = await pg.query(`SELECT subject_media_type, image_attempt_id, image_output_id, status, project_id, production_id, refined_prompt FROM public.media_reviews ORDER BY created_at`)
    expect(reviews.rows).toHaveLength(3)
    expect(reviews.rows.every((r: any) => r.subject_media_type === 'video' && r.image_attempt_id === null && r.image_output_id === null && r.status === 'completed')).toBe(true)
    // Scope equals the artifact scope: project+production for generation and render, none for the Library video.
    expect(reviews.rows.map((r: any) => [r.project_id, r.production_id])).toEqual([[PROJECT, PRODUCTION], [PROJECT, PRODUCTION], [null, null]])
    // Only a prompt-driven generation carries a refinement.
    expect(reviews.rows.map((r: any) => r.refined_prompt !== null)).toEqual([true, false, false])

    const linked = await pg.query(`
      SELECT count(*)::int AS n FROM public.media_reviews r
        JOIN public.media_artifacts a ON a.id = r.media_artifact_id AND a.media_type = 'video' AND a.user_id = r.user_id
        JOIN public.media_artifact_provenance p ON p.artifact_id = a.id`)
    expect((linked.rows[0] as { n: number }).n).toBe(3)
    const kinds = await pg.query(`SELECT provenance_kind FROM public.media_artifact_provenance ORDER BY provenance_kind`)
    expect(kinds.rows).toEqual([{ provenance_kind: 'render_execution' }, { provenance_kind: 'upload' }, { provenance_kind: 'video_generation' }])
  })

  it('accepts a second Review of the same artifact once the first is terminal (history repeats, one in flight at a time)', async () => {
    const t = setup()
    await t.run(GEN_SOURCE, 201)
    await t.run(GEN_SOURCE, 202)
    // Replaying into a database that already holds this artifact must reuse it; here we only replay the two Review chains.
    const reviewEntries = t.db.log.filter((e: LogEntry) => e.table === 'media_reviews')
    const artifactRow = (t.db.tables.media_artifacts[0] as { id: string })
    const existing = await pg.query(`SELECT id FROM public.media_artifacts WHERE storage_path = $1`, [(t.db.tables.media_artifacts[0] as { storage_path: string }).storage_path])
    const artifactId = (existing.rows[0] as { id: string }).id
    for (const entry of reviewEntries) {
      if (entry.op === 'insert' && entry.values) (entry.values as Record<string, unknown>).media_artifact_id = artifactId
    }
    expect(artifactRow.id).toBeTruthy()
    await replay(reviewEntries)
    const count = await pg.query(`SELECT count(*)::int AS n FROM public.media_reviews WHERE media_artifact_id = $1 AND status = 'completed'`, [artifactId])
    expect((count.rows[0] as { n: number }).n).toBe(3)
  })

  it('accepts a failed Review written by the service (failure code, details, terminal state)', async () => {
    const t = setup({ gemini: { modelText: 'not json' } })
    await expect(t.run(GEN_SOURCE, 301)).rejects.toMatchObject({ code: 'REVIEW_INVALID_EVALUATOR_RESPONSE' })
    const reviewEntries = t.db.log.filter((e: LogEntry) => e.table === 'media_reviews')
    const existing = await pg.query(`SELECT id FROM public.media_artifacts WHERE storage_path = $1`, [(t.db.tables.media_artifacts[0] as { storage_path: string }).storage_path])
    const artifactId = (existing.rows[0] as { id: string }).id
    for (const entry of reviewEntries) {
      if (entry.op === 'insert' && entry.values) (entry.values as Record<string, unknown>).media_artifact_id = artifactId
    }
    await replay(reviewEntries)
    const failed = await pg.query(`SELECT status, failure_code, failure_details FROM public.media_reviews WHERE client_request_id = $1`, [REQ(301)])
    expect(failed.rows).toEqual([{ status: 'failed', failure_code: 'invalid_evaluator_response', failure_details: expect.objectContaining({ message: expect.any(String) }) }])
  })

  it('the real database refuses the shapes the service must never write', async () => {
    const artifact = await pg.query(`SELECT id FROM public.media_artifacts WHERE media_type = 'video' AND project_id IS NULL LIMIT 1`)
    const artifactId = (artifact.rows[0] as { id: string }).id
    const insert = (extra: string, value: string) => pg.query(
      `INSERT INTO public.media_reviews (user_id, subject_media_type, media_artifact_id, ${extra} adapter_key, adapter_version, client_request_id, request_fingerprint)
       VALUES ('${OWNER}', 'video', '${artifactId}', ${value} 'video', 'video-review-v1', gen_random_uuid(), 'fp')`)
    await expect(insert('image_attempt_id,', `'${GEN}',`)).rejects.toThrow()
    await expect(insert('', '')).resolves.toBeTruthy()
  })
})
