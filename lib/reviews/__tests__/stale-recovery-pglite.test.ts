import { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { findActiveReviewByArtifact, findActiveReviewByAttempt, insertPendingReview, markReviewCompleted, markReviewFailed, markReviewRunning, markReviewStaleFailed, toReviewRecord, type MediaReviewRow } from '../repository'
import { recoverStaleActiveReview } from '../stale-recovery'
import { REVIEW_STALE_AFTER_MS, REVIEW_STALE_FAILURE_CODE, REVIEW_STALE_FAILURE_MESSAGE } from '../stale-policy'
import { createMigratedReviewDb } from './pglite-review-schema'
import { createPgliteSupabase } from './pglite-supabase-shim'

// REVIEW_STALE_RUNNING_RECOVERY_V1 (FUTURE-046) — the guarded recovery against the REAL migration history
// (054, 056, 057, 058, 060) executed by PGlite. The repository's own supabase-js calls are translated to SQL, so
// the guarded predicate, the lifecycle trigger, the failed-requires-code CHECK and the partial unique in-flight
// indexes are PostgreSQL's, not a JavaScript imitation. PGlite is a single session: it proves predicate and
// index semantics (and sequentially-interleaved races), while true row-lock behavior across connections is
// PostgreSQL's documented READ COMMITTED re-evaluation of the WHERE clause on the locked row.

const OWNER = '11111111-1111-4111-8111-111111111111'
const OTHER = '99999999-9999-4999-8999-999999999999'
const MIN = 60_000

let pg: PGlite
let db: ReturnType<typeof createPgliteSupabase>
let serial = 0
const uuid = (prefix: string) => { serial += 1; return `${prefix}${String(serial).padStart(7, '0')}-0000-4000-8000-000000000000` }

async function videoArtifact() {
  const id = uuid('c')
  await pg.query(
    `INSERT INTO public.media_artifacts (id, user_id, media_type, identity_mode, storage_provider, storage_path, content_hash, identity_fingerprint, version, mime_type)
     VALUES ($1,$2,'video','sha256','s3',$3,$4,$5,1,'video/mp4')`,
    [id, OWNER, `p/${id}`, id.replace(/[^0-9a-f]/g, '').padEnd(64, '0'), `fp-${id}`],
  )
  return id
}

async function imageSubject() {
  const imageId = uuid('d'); const attemptId = uuid('e'); const artifactId = uuid('a')
  await pg.query(`INSERT INTO public.images (id, user_id) VALUES ($1,$2)`, [imageId, OWNER])
  await pg.query(`INSERT INTO public.image_generation_attempts (id, user_id, result_image_id) VALUES ($1,$2,$3)`, [attemptId, OWNER, imageId])
  await pg.query(
    `INSERT INTO public.media_artifacts (id, user_id, media_type, identity_mode, storage_provider, storage_path, content_hash, identity_fingerprint, version, mime_type)
     VALUES ($1,$2,'image','sha256','s3',$3,$4,$5,1,'image/png')`,
    [artifactId, OWNER, `p/${artifactId}`, artifactId.replace(/[^0-9a-f]/g, '').padEnd(64, '0'), `fp-${artifactId}`],
  )
  return { imageId, attemptId, artifactId }
}

/** Inserts a Review whose lifecycle clock (`updated_at`) is `idleMs` ago. INSERT does not fire the updated_at trigger, so the age is exact. */
async function seedReview(o: { kind: 'video' | 'image'; artifact: string; attempt?: string; output?: string; status: string; idleMs: number }) {
  const id = uuid('f')
  const updated = new Date(Date.now() - o.idleMs).toISOString()
  await pg.query(
    `INSERT INTO public.media_reviews (id, user_id, subject_media_type, image_attempt_id, image_output_id, media_artifact_id, adapter_key, adapter_version,
       status, client_request_id, request_fingerprint, failure_code, started_at, completed_at, failed_at, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,'test','1',$7,$8,'fp',$9,$10,$11,$12,$13,$13)`,
    [id, OWNER, o.kind, o.attempt ?? null, o.output ?? null, o.artifact, o.status, uuid('9'),
      o.status === 'failed' ? 'provider_error' : null,
      o.status === 'pending' ? null : updated, o.status === 'completed' ? updated : null, o.status === 'failed' ? updated : null, updated],
  )
  return id
}

const rowOf = async (id: string) => (await pg.query<Record<string, any>>(`SELECT * FROM public.media_reviews WHERE id = $1`, [id])).rows[0]
const xminOf = async (id: string) => (await pg.query<{ x: string }>(`SELECT xmin::text AS x FROM public.media_reviews WHERE id = $1`, [id])).rows[0].x
async function activeRow(id: string): Promise<MediaReviewRow> {
  const r = await db.from('media_reviews').select('*').eq('id', id).maybeSingle()
  return r.data as MediaReviewRow
}
const recover = async (id: string, nowMs = Date.now()) => recoverStaleActiveReview(db, await activeRow(id), { userId: OWNER, nowMs })

let warn: ReturnType<typeof vi.spyOn>
beforeAll(async () => {
  pg = await createMigratedReviewDb()
  await pg.exec(`INSERT INTO auth.users VALUES ('${OWNER}'), ('${OTHER}')`)
  db = createPgliteSupabase(pg)
}, 120_000)
afterAll(async () => { await pg?.close() })
beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined) })
afterEach(() => { warn.mockRestore() })

describe.each(['video', 'image'] as const)('%s Review: guarded stale recovery on the real schema', (kind) => {
  async function subject() {
    if (kind === 'video') return { artifact: await videoArtifact() }
    const s = await imageSubject()
    return { artifact: s.artifactId, attempt: s.attemptId, output: s.imageId }
  }
  const seed = async (status: string, idleMs: number) => {
    const s = await subject()
    return { ...s, id: await seedReview({ kind, ...s, status, idleMs }) }
  }

  it.each(['pending', 'running'])('does NOT reap a fresh %s Review (inside the provider envelope, even at 29 min)', async (status) => {
    const { id } = await seed(status, 29 * MIN)
    const before = await xminOf(id)
    expect(await recover(id)).toBe('in_flight')
    expect((await rowOf(id)).status).toBe(status)
    expect(await xminOf(id)).toBe(before)
    expect(warn).not.toHaveBeenCalled()
  })

  it.each(['pending', 'running'])('recovers a stale %s Review into a truthful terminal failure', async (status) => {
    const { id } = await seed(status, REVIEW_STALE_AFTER_MS + 5 * MIN)
    expect(await recover(id)).toBe('recovered')
    const row = await rowOf(id)
    expect(row.status).toBe('failed')
    expect(row.failure_code).toBe(REVIEW_STALE_FAILURE_CODE)
    expect(row.failure_details.message).toBe(REVIEW_STALE_FAILURE_MESSAGE)
    expect(row.failure_details.recovery).toMatchObject({ reason: 'execution_stale', previousStatus: status, thresholdMs: REVIEW_STALE_AFTER_MS })
    expect(row.failure_details.recovery.staleAgeMs).toBeGreaterThan(REVIEW_STALE_AFTER_MS)
    expect(row.failed_at).toBeInstanceOf(Date)
    expect(row.completed_at).toBeNull()
    // The message never blames a provider, the media, or the user.
    expect(JSON.stringify(row.failure_details)).not.toMatch(/gemini|openai|cancel|invalid media/i)
    const record = toReviewRecord(await activeRow(id))
    expect(record.failure).toMatchObject({ code: 'execution_stale', message: REVIEW_STALE_FAILURE_MESSAGE })
    expect(warn).toHaveBeenCalledWith('[reviews] stale in-flight Review recovered', expect.objectContaining({ reviewId: id, mediaType: kind, previousStatus: status, outcome: 'recovered' }))
  })

  it.each(['completed', 'failed'])('never touches an old %s Review (immutable historical evidence)', async (status) => {
    const { id } = await seed(status, 400 * 24 * 60 * MIN)
    const before = await xminOf(id)
    const snapshot = JSON.stringify(await rowOf(id))
    // Even calling the guarded UPDATE directly with a far-future cutoff cannot match a terminal row.
    const direct = await markReviewStaleFailed(db, { id, userId: OWNER, cutoffIso: new Date(Date.now() + 1000 * MIN).toISOString(), code: 'execution_stale', message: 'x', details: {} })
    expect(direct).toEqual({ data: null, error: null })
    expect(await recover(id)).toBe('in_flight')
    expect(await xminOf(id)).toBe(before)
    expect(JSON.stringify(await rowOf(id))).toBe(snapshot)
  })

  it('a Review that completed between SELECT and UPDATE is not overwritten', async () => {
    const { id } = await seed('running', REVIEW_STALE_AFTER_MS + 5 * MIN)
    const read = await activeRow(id) // the request has read a stale running row...
    const completed = await markReviewCompleted(db, id, { overall_score: 80, overall_assessment: 'strong', summary: 'ok', result_payload: {} })
    expect(completed.data?.status).toBe('completed') // ...and the live process finishes before the recovery UPDATE.
    const outcome = await recoverStaleActiveReview(db, read, { userId: OWNER, nowMs: Date.now() })
    expect(outcome).toBe('settled')
    const row = await rowOf(id)
    expect(row.status).toBe('completed')
    expect(row.failure_code).toBeNull()
    expect(Number(row.overall_score)).toBe(80)
  })

  it('a Review that made progress between SELECT and UPDATE is not reaped (updated_at is part of the predicate)', async () => {
    const { id } = await seed('pending', REVIEW_STALE_AFTER_MS + 5 * MIN)
    const read = await activeRow(id)
    const running = await markReviewRunning(db, id, { evaluator_provider: 'gemini' })
    expect(running.data?.status).toBe('running')
    expect(await recoverStaleActiveReview(db, read, { userId: OWNER, nowMs: Date.now() })).toBe('in_flight')
    expect((await rowOf(id)).status).toBe('running')
  })

  it('concurrent recovery attempts are idempotent: exactly one transitions, the others settle', async () => {
    const { id } = await seed('running', REVIEW_STALE_AFTER_MS + 5 * MIN)
    const read = await activeRow(id)
    const outcomes = await Promise.all([1, 2, 3].map(() => recoverStaleActiveReview(db, read, { userId: OWNER, nowMs: Date.now() })))
    expect(outcomes.filter((o) => o === 'recovered')).toHaveLength(1)
    expect(outcomes.filter((o) => o === 'settled')).toHaveLength(2)
    expect(warn).toHaveBeenCalledTimes(1)
    expect((await rowOf(id)).status).toBe('failed')
  })

  it("recovering another user's Review is impossible (owner-scoped predicate)", async () => {
    const { id } = await seed('running', REVIEW_STALE_AFTER_MS + 5 * MIN)
    const read = await activeRow(id)
    // Not found for the other user => the re-read finds nothing => 'settled'; the row itself is untouched.
    expect(await recoverStaleActiveReview(db, read, { userId: OTHER, nowMs: Date.now() })).toBe('settled')
    expect((await rowOf(id)).status).toBe('running')
  })

  it('after recovery a new Review can become active, and the unique in-flight index still refuses a second one', async () => {
    const s = await subject()
    const staleId = await seedReview({ kind, ...s, status: 'running', idleMs: REVIEW_STALE_AFTER_MS + 5 * MIN })
    const newValues = () => ({
      user_id: OWNER, subject_media_type: kind, image_attempt_id: s.attempt ?? null, image_output_id: s.output ?? null, media_artifact_id: s.artifact,
      adapter_key: 'test', adapter_version: '1', client_request_id: uuid('8'), request_fingerprint: 'fp',
    })
    // The stale lock still blocks BEFORE recovery: the real index is the authority.
    const blocked = await insertPendingReview(db, newValues())
    expect(blocked.error?.code).toBe('23505')
    expect(await recover(staleId)).toBe('recovered')
    // Two requests race to start the replacement: exactly one wins, the other hits the index.
    const [a, b] = await Promise.all([insertPendingReview(db, newValues()), insertPendingReview(db, newValues())])
    expect([a, b].filter((r) => r.data).length).toBe(1)
    const loser = [a, b].find((r) => r.error)!
    expect(loser.error?.code).toBe('23505')
    expect(loser.error?.message).toMatch(kind === 'video' ? /media_reviews_active_video_artifact_key/ : /media_reviews_active_attempt_key/)
    const active = kind === 'video' ? await findActiveReviewByArtifact(db, OWNER, s.artifact) : await findActiveReviewByAttempt(db, OWNER, s.attempt!)
    expect(active.data?.status).toBe('pending')
    // History is intact: the recovered failure remains next to the new in-flight Review.
    const all = await pg.query(`SELECT status FROM public.media_reviews WHERE media_artifact_id = $1 ORDER BY status`, [s.artifact])
    expect(all.rows).toEqual([{ status: 'failed' }, { status: 'pending' }])
  })
})

describe('database invariants the recovery relies on', () => {
  it('the lifecycle trigger still forbids rewriting a terminal Review (recovery does not need to bypass it)', async () => {
    const artifact = await videoArtifact()
    const id = await seedReview({ kind: 'video', artifact, status: 'failed', idleMs: 5 * MIN })
    await expect(pg.query(`UPDATE public.media_reviews SET status = 'running' WHERE id = $1`, [id])).rejects.toThrow(/MEDIA_REVIEW_TERMINAL_IMMUTABLE/)
  })

  it('a failed Review requires a failure code, and the stale code satisfies it without a migration', async () => {
    const artifact = await videoArtifact()
    const id = await seedReview({ kind: 'video', artifact, status: 'running', idleMs: 1 })
    await expect(pg.query(`UPDATE public.media_reviews SET status = 'failed' WHERE id = $1`, [id])).rejects.toThrow(/media_reviews_failed_requires_code/)
    await expect(pg.query(`UPDATE public.media_reviews SET status = 'failed', failure_code = $2 WHERE id = $1`, [id, REVIEW_STALE_FAILURE_CODE])).resolves.toBeTruthy()
  })

  it('a recovered Review sits next to existing completed evidence (history, not a lock)', async () => {
    const artifact = await videoArtifact()
    await seedReview({ kind: 'video', artifact, status: 'completed', idleMs: 90 * MIN })
    const stale = await seedReview({ kind: 'video', artifact, status: 'running', idleMs: 90 * MIN })
    expect(await recover(stale)).toBe('recovered')
    const rows = await pg.query(`SELECT status FROM public.media_reviews WHERE media_artifact_id = $1 ORDER BY status`, [artifact])
    expect(rows.rows).toEqual([{ status: 'completed' }, { status: 'failed' }])
  })

  it("the live process's own terminal writes cannot resurrect or overwrite a recovered Review", async () => {
    const artifact = await videoArtifact()
    const id = await seedReview({ kind: 'video', artifact, status: 'running', idleMs: REVIEW_STALE_AFTER_MS + MIN })
    expect(await recover(id)).toBe('recovered')
    // The zombie request finally finishes: both of its terminal writes are guarded and match nothing.
    const completed = await markReviewCompleted(db, id, { overall_score: 90, overall_assessment: 'strong', summary: 's', result_payload: {} })
    const failed = await markReviewFailed(db, id, 'provider_error', 'late')
    expect(completed.data).toBeNull()
    expect(failed.data).toBeNull()
    const row = await rowOf(id)
    expect(row.status).toBe('failed')
    expect(row.failure_code).toBe(REVIEW_STALE_FAILURE_CODE)
  })
})
