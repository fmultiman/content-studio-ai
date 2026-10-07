import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// MEDIA_REVIEWS_VIDEO_SCHEMA_EXTENSION_V1
//
// Executes the REAL migration scripts (054, 056, 057, 058, then 060) against an
// isolated in-process PostgreSQL (PGlite). Nothing here touches Supabase, Preview
// or Production. Only the tables the migrations reference are stubbed, with the
// columns the trigger functions actually read.

const ROOT = process.cwd()
const script = (name: string) => readFileSync(join(ROOT, 'scripts', name), 'utf8')

const U1 = '11111111-1111-4111-8111-111111111111'
const U2 = '22222222-2222-4222-8222-222222222222'
const P1 = 'a1111111-1111-4111-8111-111111111111'
const P2 = 'a2222222-2222-4222-8222-222222222222'
const P3 = 'a3333333-3333-4333-8333-333333333333' // owned by U2
const PR1 = 'b1111111-1111-4111-8111-111111111111' // in P1
const PR2 = 'b2222222-2222-4222-8222-222222222222' // in P2

const STUBS = `
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
  CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;
  CREATE TABLE public.projects (id uuid PRIMARY KEY, user_id uuid NOT NULL);
  CREATE TABLE public.productions (id uuid PRIMARY KEY, user_id uuid NOT NULL, project_id uuid);
  CREATE TABLE public.images (
    id uuid PRIMARY KEY, user_id uuid NOT NULL, project_id uuid,
    storage_provider text, storage_path text, mime_type text, file_size integer, updated_at timestamptz DEFAULT now());
  CREATE TABLE public.image_generation_attempts (
    id uuid PRIMARY KEY, user_id uuid NOT NULL, project_id uuid, production_id uuid, result_image_id uuid);
  CREATE TABLE public.video_generations (id uuid PRIMARY KEY, user_id uuid NOT NULL, project_id uuid, production_id uuid);
  CREATE TABLE public.render_executions (id uuid PRIMARY KEY, user_id uuid NOT NULL, project_id uuid);
  CREATE TABLE public.library_files (id uuid PRIMARY KEY, user_id uuid NOT NULL, project_id uuid, production_id uuid);
`

let db: PGlite
let serial = 0
const uuid = (prefix: string) => {
  serial += 1
  return `${prefix}${String(serial).padStart(7, '0')}-0000-4000-8000-000000000000`
}

async function insertArtifact(o: { user?: string; type: 'image' | 'video'; project?: string | null; production?: string | null }) {
  const id = uuid('c')
  await db.query(
    `INSERT INTO public.media_artifacts (id, user_id, project_id, production_id, media_type, identity_mode, storage_provider,
       storage_path, content_hash, identity_fingerprint, version, mime_type)
     VALUES ($1,$2,$3,$4,$5,'sha256','s3',$6,$7,$8,1,$9)`,
    [id, o.user ?? U1, o.project ?? null, o.production ?? null, o.type, `path/${id}`, id.replace(/[^0-9a-f]/g, '').padEnd(64, '0'), `fp-${id}`, o.type === 'video' ? 'video/mp4' : 'image/png'],
  )
  return id
}

async function insertImageSubject(o: { user?: string; project?: string | null; production?: string | null }) {
  const imageId = uuid('d')
  const attemptId = uuid('e')
  await db.query(`INSERT INTO public.images (id, user_id, project_id) VALUES ($1,$2,$3)`, [imageId, o.user ?? U1, o.project ?? null])
  await db.query(
    `INSERT INTO public.image_generation_attempts (id, user_id, project_id, production_id, result_image_id) VALUES ($1,$2,$3,$4,$5)`,
    [attemptId, o.user ?? U1, o.project ?? null, o.production ?? null, imageId],
  )
  return { imageId, attemptId }
}

type ReviewInput = {
  user?: string
  type: 'image' | 'video'
  artifact: string | null
  attempt?: string | null
  output?: string | null
  project?: string | null
  production?: string | null
  status?: string
}

async function insertReview(o: ReviewInput) {
  const id = uuid('f')
  await db.query(
    `INSERT INTO public.media_reviews (id, user_id, subject_media_type, image_attempt_id, image_output_id, media_artifact_id,
       project_id, production_id, adapter_key, adapter_version, status, client_request_id, request_fingerprint, failure_code)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'test','1',$9,$10,'fp',$11)`,
    [id, o.user ?? U1, o.type, o.attempt ?? null, o.output ?? null, o.artifact, o.project ?? null, o.production ?? null,
      o.status ?? 'pending', uuid('9'), o.status === 'failed' ? 'provider_error' : null],
  )
  return id
}

async function insertImageReview(o: { artifactUser?: string; user?: string; project?: string | null; production?: string | null; artifactType?: 'image' | 'video'; status?: string; attempt?: string | null; output?: string | null; artifact?: string }) {
  const subject = await insertImageSubject({ user: o.user, project: o.project ?? null, production: o.production ?? null })
  const artifact = o.artifact ?? await insertArtifact({ user: o.artifactUser ?? o.user, type: o.artifactType ?? 'image', project: o.project ?? null, production: o.production ?? null })
  return insertReview({
    user: o.user, type: 'image', artifact,
    attempt: o.attempt === undefined ? subject.attemptId : o.attempt,
    output: o.output === undefined ? subject.imageId : o.output,
    project: o.project ?? null, production: o.production ?? null, status: o.status,
  })
}

async function rejects(promise: Promise<unknown>, pattern: RegExp) {
  const error = await promise.then(() => null, (e: Error) => e)
  expect(error, 'statement should have been rejected').not.toBeNull()
  expect(String(error!.message)).toMatch(pattern)
}

async function advance(id: string, to: 'running' | 'completed' | 'failed') {
  const extra = to === 'failed' ? `, failure_code = 'provider_error'` : ''
  await db.query(`UPDATE public.media_reviews SET status = $2${extra} WHERE id = $1`, [id, to])
}

let before: { rows: unknown[]; xmin: unknown[] }
const snapshot = async () => ({
  rows: (await db.query(`SELECT to_jsonb(r) AS j FROM public.media_reviews r ORDER BY id`)).rows,
  xmin: (await db.query(`SELECT id, xmin::text FROM public.media_reviews ORDER BY id`)).rows,
})

beforeAll(async () => {
  db = new PGlite()
  await db.exec(STUBS)
  await db.exec(`INSERT INTO auth.users VALUES ('${U1}'), ('${U2}');
    INSERT INTO public.projects VALUES ('${P1}','${U1}'), ('${P2}','${U1}'), ('${P3}','${U2}');
    INSERT INTO public.productions VALUES ('${PR1}','${U1}','${P1}'), ('${PR2}','${U1}','${P2}');`)

  // Real history: 054 creates the Image-only table, legacy Image Reviews exist, then 056/057/058 bridge them.
  await db.exec(script('054_create_media_reviews.sql'))
  for (let i = 0; i < 3; i += 1) {
    const { imageId, attemptId } = await insertImageSubject({ project: i === 0 ? P1 : null, production: i === 0 ? PR1 : null })
    await db.query(`UPDATE public.images SET storage_provider='s3', storage_path=$2, mime_type='image/png', file_size=10 WHERE id=$1`, [imageId, `users/${U1}/images/${imageId}/original.png`])
    await db.query(
      `INSERT INTO public.media_reviews (user_id, image_attempt_id, image_output_id, project_id, production_id, adapter_key, adapter_version, client_request_id, request_fingerprint, status, started_at, completed_at, overall_score, overall_assessment, summary, result_payload)
       VALUES ($1,$2,$3,$4,$5,'image','1',$6,'fp','completed', now(), now(), 80, 'strong', 'ok', '{"k":"v"}'::jsonb)`,
      [U1, attemptId, imageId, i === 0 ? P1 : null, i === 0 ? PR1 : null, uuid('8')],
    )
  }
  await db.exec(script('056_create_media_artifacts.sql'))
  await db.exec(script('057_create_media_artifact_provenance.sql'))
  await db.exec(script('058_extend_media_reviews_with_artifacts.sql'))

  before = await snapshot()
  await db.exec(script('060_extend_media_reviews_for_video.sql'))
}, 120_000)

afterAll(async () => { await db?.close() })

describe('migration 060: existing data safety', () => {
  it('rewrites no existing Review row (same rows, same tuple versions, same payloads)', async () => {
    const after = await snapshot()
    expect(before.rows).toHaveLength(3)
    expect(after.rows).toEqual(before.rows)
    // xmin changes if a tuple was updated or rewritten; identical xmin proves the rows were never touched.
    expect(after.xmin).toEqual(before.xmin)
  })

  it('leaves every existing Image Review valid under the new constraints', async () => {
    const result = await db.query(`SELECT count(*)::int AS n FROM public.media_reviews WHERE subject_media_type = 'image' AND image_attempt_id IS NOT NULL AND image_output_id IS NOT NULL AND media_artifact_id IS NOT NULL`)
    expect((result.rows[0] as { n: number }).n).toBe(3)
    // Re-validating every constraint against existing rows is a no-op.
    await db.exec(`ALTER TABLE public.media_reviews VALIDATE CONSTRAINT media_reviews_subject_shape`)
  })

  it('adds only metadata: no DML, no table drops, no second Review table, existing Image index untouched', () => {
    const sql = script('060_extend_media_reviews_for_video.sql').replace(/--.*$/gm, '')
    expect(sql).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+public|DELETE\s+FROM|TRUNCATE|DROP\s+TABLE|DROP\s+COLUMN|CREATE\s+TABLE)\b/i)
    expect(sql).not.toMatch(/media_reviews_active_attempt_key/)
    expect(sql).toMatch(/^\s*BEGIN;[\s\S]*COMMIT;\s*$/)
  })

  it('is safe to re-run (idempotent) and still atomic', async () => {
    await db.exec(script('060_extend_media_reviews_for_video.sql'))
    const after = await snapshot()
    expect(after.rows).toEqual(before.rows)
  })
})

describe('migration 060: subject_media_type and discriminated shape', () => {
  it('accepts image and video and nothing else', async () => {
    await rejects(db.query(`UPDATE public.media_reviews SET subject_media_type = 'audio' WHERE false`).then(async () => {
      const artifact = await insertArtifact({ type: 'video' })
      await db.query(
        `INSERT INTO public.media_reviews (user_id, subject_media_type, media_artifact_id, adapter_key, adapter_version, client_request_id, request_fingerprint)
         VALUES ($1,'audio',$2,'t','1',$3,'fp')`, [U1, artifact, uuid('9')])
    }), /subject_media_type_check|UNSUPPORTED_SUBJECT/)
  })

  it('1. still accepts a valid Image Review', async () => {
    await expect(insertImageReview({ project: P1, production: PR1 })).resolves.toBeTruthy()
    await expect(insertImageReview({})).resolves.toBeTruthy()
  })

  it('2. rejects an Image Review without image_attempt_id', async () => {
    const subject = await insertImageSubject({})
    const artifact = await insertArtifact({ type: 'image' })
    await rejects(insertReview({ type: 'image', artifact, attempt: null, output: subject.imageId }), /ATTEMPT_NOT_FOUND|subject_shape/)
  })

  it('3. rejects an Image Review without image_output_id', async () => {
    const subject = await insertImageSubject({})
    const artifact = await insertArtifact({ type: 'image' })
    await rejects(insertReview({ type: 'image', artifact, attempt: subject.attemptId, output: null }), /ATTEMPT_SCOPE_MISMATCH|subject_shape/)
  })

  it('4. rejects a Video Review with image_attempt_id populated', async () => {
    const subject = await insertImageSubject({})
    const artifact = await insertArtifact({ type: 'video' })
    await rejects(insertReview({ type: 'video', artifact, attempt: subject.attemptId }), /subject_shape/)
  })

  it('5. rejects a Video Review with image_output_id populated', async () => {
    const subject = await insertImageSubject({})
    const artifact = await insertArtifact({ type: 'video' })
    await rejects(insertReview({ type: 'video', artifact, output: subject.imageId }), /subject_shape/)
  })

  it('6. rejects a Video Review without media_artifact_id', async () => {
    await rejects(insertReview({ type: 'video', artifact: null }), /ARTIFACT_REQUIRED|null value|subject_shape/)
  })

  it('7. rejects a Video Review whose artifact is an image, and an Image Review whose artifact is a video', async () => {
    const imageArtifact = await insertArtifact({ type: 'image' })
    await rejects(insertReview({ type: 'video', artifact: imageArtifact }), /ARTIFACT_SCOPE_MISMATCH/)
    await rejects(insertImageReview({ artifactType: 'video' }), /ARTIFACT_SCOPE_MISMATCH/)
  })

  it('8. accepts a Video Review with a video artifact', async () => {
    const artifact = await insertArtifact({ type: 'video' })
    await expect(insertReview({ type: 'video', artifact })).resolves.toBeTruthy()
  })

  it('9. rejects a foreign-owner artifact (video and image)', async () => {
    const foreignVideo = await insertArtifact({ user: U2, type: 'video' })
    await rejects(insertReview({ type: 'video', artifact: foreignVideo }), /ARTIFACT_SCOPE_MISMATCH/)
    await rejects(insertImageReview({ artifactUser: U2 }), /ARTIFACT_SCOPE_MISMATCH/)
  })

  it('rejects an unknown artifact id', async () => {
    await rejects(insertReview({ type: 'video', artifact: '99999999-9999-4999-8999-999999999999' }), /media_artifact_id_fkey|ARTIFACT_SCOPE_MISMATCH/)
  })
})

describe('migration 060: Project / Production scope (Video)', () => {
  it('12. accepts Library-style media with NULL Project and NULL Production', async () => {
    const artifact = await insertArtifact({ type: 'video', project: null, production: null })
    await expect(insertReview({ type: 'video', artifact })).resolves.toBeTruthy()
  })

  it('accepts a Project-only artifact and a Project+Production artifact when the Review matches', async () => {
    const projectOnly = await insertArtifact({ type: 'video', project: P1 })
    await expect(insertReview({ type: 'video', artifact: projectOnly, project: P1 })).resolves.toBeTruthy()
    const full = await insertArtifact({ type: 'video', project: P1, production: PR1 })
    await expect(insertReview({ type: 'video', artifact: full, project: P1, production: PR1 })).resolves.toBeTruthy()
  })

  it('10. rejects a Project that differs from the artifact (both sides carry Project)', async () => {
    const artifact = await insertArtifact({ type: 'video', project: P1 })
    await rejects(insertReview({ type: 'video', artifact, project: P2 }), /ARTIFACT_SCOPE_MISMATCH/)
  })

  it('rejects a Review that claims a Project the artifact does not have, or omits the one it has', async () => {
    const noScope = await insertArtifact({ type: 'video' })
    await rejects(insertReview({ type: 'video', artifact: noScope, project: P1 }), /ARTIFACT_SCOPE_MISMATCH/)
    const scoped = await insertArtifact({ type: 'video', project: P1 })
    await rejects(insertReview({ type: 'video', artifact: scoped, project: null }), /ARTIFACT_SCOPE_MISMATCH/)
  })

  it('11. rejects a Production that differs from the artifact (both sides carry Production)', async () => {
    const artifact = await insertArtifact({ type: 'video', project: P1, production: PR1 })
    await rejects(insertReview({ type: 'video', artifact, project: P1, production: PR2 }), /ARTIFACT_SCOPE_MISMATCH/)
  })

  it('rejects a Production without its Project and a Project owned by someone else', async () => {
    const artifact = await insertArtifact({ type: 'video', project: P1, production: PR1 })
    await rejects(insertReview({ type: 'video', artifact, project: null, production: PR1 }), /ARTIFACT_SCOPE_MISMATCH/)
    // Foreign Project: the artifact itself cannot exist with it, and a Review cannot claim it either.
    await rejects(insertArtifact({ type: 'video', project: P3 }), /PROJECT_SCOPE_MISMATCH/)
  })
})

describe('migration 060: in-flight uniqueness', () => {
  it('13 + 14. allows the first in-flight Video Review and rejects a second for the same artifact (pending or running)', async () => {
    const artifact = await insertArtifact({ type: 'video' })
    const first = await insertReview({ type: 'video', artifact, status: 'pending' })
    await rejects(insertReview({ type: 'video', artifact, status: 'pending' }), /media_reviews_active_video_artifact_key/)
    await advance(first, 'running')
    await rejects(insertReview({ type: 'video', artifact, status: 'running' }), /media_reviews_active_video_artifact_key/)
    await rejects(insertReview({ type: 'video', artifact, status: 'pending' }), /media_reviews_active_video_artifact_key/)
  })

  it('15. a completed or failed Video Review never blocks later Reviews (history is repeatable)', async () => {
    const artifact = await insertArtifact({ type: 'video' })
    const first = await insertReview({ type: 'video', artifact, status: 'pending' })
    await advance(first, 'running')
    await advance(first, 'completed')
    const second = await insertReview({ type: 'video', artifact, status: 'pending' })
    await advance(second, 'failed')
    const third = await insertReview({ type: 'video', artifact, status: 'pending' })
    await advance(third, 'running')
    await advance(third, 'completed')
    await insertReview({ type: 'video', artifact, status: 'completed' })
    const count = await db.query(`SELECT count(*)::int AS n FROM public.media_reviews WHERE media_artifact_id = $1`, [artifact])
    expect((count.rows[0] as { n: number }).n).toBe(4)
  })

  it('in-flight Reviews of different artifacts do not conflict', async () => {
    const a = await insertArtifact({ type: 'video' })
    const b = await insertArtifact({ type: 'video' })
    await insertReview({ type: 'video', artifact: a, status: 'pending' })
    await expect(insertReview({ type: 'video', artifact: b, status: 'pending' })).resolves.toBeTruthy()
  })

  it('the Video index is scoped to video rows and the two in-flight states only', async () => {
    const index = await db.query(`SELECT indexdef FROM pg_indexes WHERE indexname = 'media_reviews_active_video_artifact_key'`)
    expect(String((index.rows[0] as { indexdef: string }).indexdef)).toMatch(/subject_media_type = 'video'/)
    expect(String((index.rows[0] as { indexdef: string }).indexdef)).toMatch(/'pending'.*'running'/)
  })

  it('16. keeps the existing Image active-attempt uniqueness', async () => {
    const subject = await insertImageSubject({})
    const artifact = await insertArtifact({ type: 'image' })
    const first = await insertReview({ type: 'image', artifact, attempt: subject.attemptId, output: subject.imageId, status: 'pending' })
    const otherArtifact = await insertArtifact({ type: 'image' })
    await rejects(insertReview({ type: 'image', artifact: otherArtifact, attempt: subject.attemptId, output: subject.imageId, status: 'pending' }), /media_reviews_active_attempt_key/)
    await advance(first, 'running')
    await advance(first, 'completed')
    await expect(insertReview({ type: 'image', artifact: otherArtifact, attempt: subject.attemptId, output: subject.imageId, status: 'pending' })).resolves.toBeTruthy()
  })

  it('Video rows can never collide on the image-attempt index (NULLs are distinct) and the index definition is unchanged', async () => {
    const index = await db.query(`SELECT indexdef FROM pg_indexes WHERE indexname = 'media_reviews_active_attempt_key'`)
    expect(String((index.rows[0] as { indexdef: string }).indexdef)).toBe(
      "CREATE UNIQUE INDEX media_reviews_active_attempt_key ON public.media_reviews USING btree (image_attempt_id) WHERE (status = ANY (ARRAY['pending'::text, 'running'::text]))")
  })
})

describe('migration 060: lifecycle and physical shape', () => {
  it('keeps Video Reviews immutable once created and terminal states terminal', async () => {
    const artifact = await insertArtifact({ type: 'video' })
    const review = await insertReview({ type: 'video', artifact, status: 'pending' })
    const other = await insertArtifact({ type: 'video' })
    await rejects(db.query(`UPDATE public.media_reviews SET media_artifact_id = $2 WHERE id = $1`, [review, other]), /IMMUTABLE_SUBJECT/)
    await advance(review, 'running')
    await advance(review, 'completed')
    await rejects(advance(review, 'failed'), /TERMINAL_IMMUTABLE/)
  })

  it('makes the image FK columns physically nullable and keeps their foreign keys', async () => {
    const cols = await db.query(`SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name='media_reviews' AND column_name IN ('image_attempt_id','image_output_id','media_artifact_id') ORDER BY column_name`)
    expect(cols.rows).toEqual([
      { column_name: 'image_attempt_id', is_nullable: 'YES' },
      { column_name: 'image_output_id', is_nullable: 'YES' },
      { column_name: 'media_artifact_id', is_nullable: 'NO' },
    ])
    const fks = await db.query(`SELECT conname FROM pg_constraint WHERE conrelid='public.media_reviews'::regclass AND contype='f' ORDER BY conname`)
    expect((fks.rows as Array<{ conname: string }>).map((r) => r.conname)).toEqual(expect.arrayContaining([
      'media_reviews_image_attempt_id_fkey', 'media_reviews_image_output_id_fkey', 'media_reviews_media_artifact_id_fkey',
    ]))
  })
})
