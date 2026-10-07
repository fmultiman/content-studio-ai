import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getVideoReviewHistory } from '../video-history'
import { createReviewTestDb, type Row } from './review-test-db'

// VIDEO_REVIEW_UI_AND_HISTORY_V1 — the history read is READ-ONLY, owner-scoped and returns a safe DTO.

const OWNER = '11111111-1111-4111-8111-111111111111'
const OTHER = '99999999-9999-4999-8999-999999999999'
const GEN = '44444444-4444-4444-8444-444444444444'
const FILE = '77777777-7777-4777-8777-777777777777'
const EXEC = '55555555-5555-4555-8555-555555555555'
const ART_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ART_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const STORAGE_PATH = `users/${OWNER}/library/88888888-8888-4888-8888-888888888888/secret-clip.mp4`
const HASH = 'f'.repeat(64)

function completedPayload(summary: string) {
  return {
    schemaVersion: 1, status: 'completed', adapter: { key: 'video', version: 'video-review-v1' },
    overall: { score: 70, assessment: 'mixed' }, summary,
    criteria: [
      { key: 'visual_consistency', label: 'Consistência visual', score: 90, assessment: 'strong', evidence: ['estável'], applicable: true },
      { key: 'prompt_adherence', label: 'Aderência ao prompt', score: 0, assessment: 'insufficient_evidence', evidence: [], applicable: false },
    ],
    strengths: ['Cores'], issues: ['Estático'], recommendations: ['Animar'], refinedPrompt: 'mais movimento',
    adapterResult: { analyzed: 'visual_only', artifactId: ART_A, durationMs: 3051, sourceKind: 'library_file', evaluationMode: 'default' },
  }
}

function review(id: string, createdAt: string, overrides: Row = {}): Row {
  return {
    id, user_id: OWNER, subject_media_type: 'video', image_attempt_id: null, image_output_id: null, media_artifact_id: ART_A,
    project_id: null, production_id: null, adapter_key: 'video', adapter_version: 'video-review-v1', review_schema_version: 1, origin: 'live',
    status: 'completed', client_request_id: `00000000-0000-4000-8000-${id.slice(-12)}`, request_fingerprint: 'fp',
    subject_snapshot: { artifact: { contentHash: HASH }, source: { kind: 'library_file', id: FILE } }, context_snapshot: { fingerprint: 'ctx-secret' },
    evaluator_provider: 'gemini', evaluator_model: 'gemini-3.5-flash', evaluator_prompt_version: 'video-review-prompt-v1',
    overall_score: 70, overall_assessment: 'mixed', summary: 's', result_payload: completedPayload('Resumo'), refined_prompt: 'mais movimento',
    failure_code: null, failure_details: null, legacy_source_key: null,
    created_at: createdAt, started_at: createdAt, completed_at: createdAt, failed_at: null, updated_at: createdAt,
    ...overrides,
  }
}

/** A client that can ONLY read: any write method throws, so a write would fail the test. */
function readOnly(seed: Record<string, Row[]>) {
  const base = createReviewTestDb(seed)
  const reads: Array<{ table: string }> = []
  return {
    reads,
    base,
    from(table: string) {
      reads.push({ table })
      const builder = base.from(table)
      for (const method of ['insert', 'update', 'upsert', 'delete']) {
        builder[method] = () => { throw new Error(`WRITE_FORBIDDEN:${method}`) }
      }
      return builder
    },
  } as any
}

function world(extra: Record<string, Row[]> = {}) {
  return {
    video_generations: [{ id: GEN, user_id: OWNER }],
    render_executions: [{ id: EXEC, user_id: OWNER }],
    library_files: [{ id: FILE, user_id: OWNER }],
    media_artifact_provenance: [{ artifact_id: ART_A, user_id: OWNER, library_file_id: FILE, provenance_key: `library:${FILE}` }],
    media_reviews: [],
    ...extra,
  }
}

describe('getVideoReviewHistory', () => {
  it('returns an empty history truthfully when the source has no artifact yet, and writes nothing', async () => {
    const db = readOnly(world({ media_artifact_provenance: [] }))
    const result = await getVideoReviewHistory({ db, userId: OWNER, source: { kind: 'library_file', id: FILE } })
    expect(result).toEqual({ items: [] })
    expect(db.base.log).toEqual([])
    // It stopped at provenance: it never even queried reviews or artifacts.
    expect(db.reads.map((r: { table: string }) => r.table)).toEqual(['library_files', 'media_artifact_provenance'])
  })

  it('returns owner Reviews newest first as a safe DTO (no storage, hash, artifact, fingerprint or prompt version)', async () => {
    const db = readOnly(world({
      media_reviews: [
        review('00000000-0000-4000-8000-000000000001', '2026-10-01T10:00:00Z'),
        review('00000000-0000-4000-8000-000000000003', '2026-10-03T10:00:00Z', { result_payload: completedPayload('Mais recente') }),
        review('00000000-0000-4000-8000-000000000002', '2026-10-02T10:00:00Z', { status: 'failed', failure_code: 'provider_timeout', failure_details: { message: 'Review provider timed out.' }, result_payload: {}, refined_prompt: null, overall_score: null, overall_assessment: null }),
      ],
    }))
    const { items } = await getVideoReviewHistory({ db, userId: OWNER, source: { kind: 'library_file', id: FILE } })
    expect(items.map((i) => i.id.slice(-1))).toEqual(['3', '2', '1'])
    expect(items[0]).toMatchObject({
      status: 'completed', evaluator: { provider: 'gemini', model: 'gemini-3.5-flash' },
      result: { overall: { score: 70, assessment: 'mixed' }, summary: 'Mais recente', refinedPrompt: 'mais movimento', analyzed: 'visual_only', strengths: ['Cores'], issues: ['Estático'], recommendations: ['Animar'] },
      failure: null,
    })
    expect(items[0].result?.criteria.map((c) => [c.key, c.applicable])).toEqual([['visual_consistency', true], ['prompt_adherence', false]])
    expect(items[1]).toMatchObject({ status: 'failed', result: null, failure: { code: 'provider_timeout' } })

    const text = JSON.stringify(items)
    for (const secret of [STORAGE_PATH, HASH, ART_A, 'ctx-secret', 'video-review-prompt-v1', 'contentHash', 'storage', 'artifactId', 'contextFingerprint', 'adapterResult']) {
      expect(text).not.toContain(secret)
    }
    expect(Object.keys(items[0]).sort()).toEqual(['completedAt', 'createdAt', 'evaluator', 'failure', 'id', 'result', 'status'])
    expect(db.base.log).toEqual([])
  })

  it('exposes pending and running Reviews as such', async () => {
    const db = readOnly(world({
      media_reviews: [
        review('00000000-0000-4000-8000-000000000005', '2026-10-05T10:00:00Z', { status: 'running', result_payload: {}, completed_at: null, overall_score: null, overall_assessment: null, refined_prompt: null }),
      ],
    }))
    const { items } = await getVideoReviewHistory({ db, userId: OWNER, source: { kind: 'library_file', id: FILE } })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ status: 'running', result: null, failure: null })
  })

  it('works for every typed source family through its own provenance column', async () => {
    const provenance = [
      { artifact_id: ART_A, user_id: OWNER, video_generation_id: GEN, provenance_key: `video_generation:${GEN}` },
      { artifact_id: ART_B, user_id: OWNER, render_execution_id: EXEC, provenance_key: `render_execution:${EXEC}` },
    ]
    const reviews = [
      review('00000000-0000-4000-8000-000000000001', '2026-10-01T10:00:00Z', { media_artifact_id: ART_A }),
      review('00000000-0000-4000-8000-000000000002', '2026-10-02T10:00:00Z', { media_artifact_id: ART_B }),
    ]
    const db = readOnly(world({ media_artifact_provenance: provenance, media_reviews: reviews }))
    const generation = await getVideoReviewHistory({ db, userId: OWNER, source: { kind: 'video_generation', id: GEN } })
    const render = await getVideoReviewHistory({ db, userId: OWNER, source: { kind: 'render_execution', id: EXEC } })
    expect(generation.items.map((i) => i.id.slice(-1))).toEqual(['1'])
    expect(render.items.map((i) => i.id.slice(-1))).toEqual(['2'])
  })

  it('treats another user\'s source exactly like a missing one and never touches provenance or Reviews', async () => {
    const db = readOnly(world({ media_reviews: [review('00000000-0000-4000-8000-000000000001', '2026-10-01T10:00:00Z')] }))
    for (const source of [{ kind: 'library_file', id: FILE }, { kind: 'video_generation', id: GEN }, { kind: 'render_execution', id: EXEC }] as const) {
      await expect(getVideoReviewHistory({ db, userId: OTHER, source })).rejects.toMatchObject({ status: 404, code: 'REVIEW_SUBJECT_NOT_FOUND' })
    }
    await expect(getVideoReviewHistory({ db, userId: OWNER, source: { kind: 'library_file', id: '12345678-1234-4234-8234-123456789012' } }))
      .rejects.toMatchObject({ status: 404 })
    expect(db.reads.map((r: { table: string }) => r.table).filter((t: string) => t === 'media_reviews' || t === 'media_artifact_provenance')).toEqual([])
  })

  it('never returns another user\'s Reviews even if they point at the same artifact', async () => {
    const db = readOnly(world({
      media_reviews: [
        review('00000000-0000-4000-8000-000000000001', '2026-10-01T10:00:00Z'),
        review('00000000-0000-4000-8000-000000000009', '2026-10-09T10:00:00Z', { user_id: OTHER }),
      ],
    }))
    const { items } = await getVideoReviewHistory({ db, userId: OWNER, source: { kind: 'library_file', id: FILE } })
    expect(items.map((i) => i.id.slice(-1))).toEqual(['1'])
  })

  it('ignores Image Reviews and caps the list', async () => {
    const many = Array.from({ length: 60 }, (_, i) => review(`00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString()))
    const image = review('00000000-0000-4000-8000-0000000000ff', '2026-10-30T10:00:00Z', { subject_media_type: 'image', image_attempt_id: ART_B, image_output_id: ART_B })
    const db = readOnly(world({ media_reviews: [...many, image] }))
    const { items } = await getVideoReviewHistory({ db, userId: OWNER, source: { kind: 'library_file', id: FILE } })
    expect(items).toHaveLength(50)
    expect(items.some((i) => i.id.endsWith('ff'))).toBe(false)
  })

  it('reports a storage failure as unavailable, not as empty', async () => {
    const failing = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'db down' } }) }) }) }) }) } as any
    await expect(getVideoReviewHistory({ db: failing, userId: OWNER, source: { kind: 'library_file', id: FILE } })).rejects.toMatchObject({ status: 503, code: 'REVIEW_STORE_UNAVAILABLE' })
  })
})

describe('the history module is structurally read-only', () => {
  const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

  it('imports nothing that could register an artifact, read media, use a credential or call a provider', () => {
    for (const file of ['lib/reviews/video-history.ts', 'lib/reviews/video-review-dto.ts']) {
      const code = read(file)
      expect(code, file).not.toMatch(/registerVideoArtifact|ensureVideoArtifact|attachArtifactProvenance|openS3ObjectStream|readS3Object|resolveProviderExecution|createServiceRoleSupabase|createGeminiClient|providers\/gemini|storage\/s3/)
      expect(code, file).not.toMatch(/\.(insert|update|upsert|delete)\s*\(/)
    }
  })

  it('the GET handler uses the caller\'s session client, not a service-role client', () => {
    const code = read('app/api/reviews/video/route.ts')
    const get = code.slice(code.indexOf('export async function GET'), code.indexOf('export async function POST'))
    expect(get).toMatch(/createClient\(\)/)
    expect(get).not.toMatch(/createServiceRoleSupabase|createVideoReviewExecution|ensureVideoArtifact/)
  })
})
