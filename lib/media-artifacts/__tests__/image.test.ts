import { describe, expect, it, vi } from 'vitest'
import { resolveImageArtifact, sha256Bytes } from '../image'

const USER = '11111111-1111-4111-8111-111111111111'
const PROJECT = '22222222-2222-4222-8222-222222222222'
const ATTEMPT = '33333333-3333-4333-8333-333333333333'
const OUTPUT = '44444444-4444-4444-8444-444444444444'
const ARTIFACT = '55555555-5555-4555-8555-555555555555'
const STORAGE = `users/${USER}/images/66666666-6666-4666-8666-666666666666/original.png`

function artifactRow() {
  return {
    id: ARTIFACT,
    user_id: USER,
    project_id: PROJECT,
    production_id: null,
    media_type: 'image',
    identity_mode: 'sha256',
    storage_provider: 's3',
    storage_path: STORAGE,
    content_hash: sha256Bytes(new Uint8Array([1, 2, 3])),
    identity_fingerprint: 'fingerprint',
    version: 1,
    mime_type: 'image/png',
    byte_size: 3,
    width: null,
    height: null,
    duration_ms: null,
    created_at: '2026-10-06T00:00:00.000Z',
    updated_at: '2026-10-06T00:00:00.000Z',
  }
}

function makeDb(options: { existingProvenance?: boolean; existingArtifact?: boolean } = {}) {
  const upsert = vi.fn().mockResolvedValue({ error: null })
  const insert = vi.fn().mockResolvedValue({ data: artifactRow(), error: null })
  const calls: string[] = []
  return {
    calls,
    upsert,
    insert,
    from(table: string) {
      calls.push(table)
      const state: { filters: Record<string, unknown>; selected: string | null } = { filters: {}, selected: null }
      const chain = {
        select(columns: string) { state.selected = columns; return chain },
        eq(column: string, value: unknown) { state.filters[column] = value; return chain },
        maybeSingle: vi.fn(async () => {
          if (table === 'media_artifact_provenance' && options.existingProvenance) {
            return { data: { artifact_id: ARTIFACT, media_artifacts: artifactRow() }, error: null }
          }
          if (table === 'media_artifacts' && options.existingArtifact) return { data: artifactRow(), error: null }
          return { data: null, error: null }
        }),
        insert(values: unknown) { insert(values); return { select: () => ({ single: async () => ({ data: artifactRow(), error: null }) }) } },
        upsert(values: unknown, options: unknown) { upsert(values, options); return Promise.resolve({ error: null }) },
      }
      return chain
    },
  } as any
}

const input = {
  userId: USER,
  projectId: PROJECT,
  productionId: null,
  attemptId: ATTEMPT,
  outputId: OUTPUT,
  storageProvider: 's3',
  storagePath: STORAGE,
  mimeType: 'image/png',
  fileSize: 3,
  metadata: {},
}

vi.mock('@/lib/storage/s3', () => ({
  readS3Object: vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), contentType: 'image/png' })),
}))

describe('image media artifact resolver', () => {
  it('hashes exact bytes with SHA-256', () => {
    expect(sha256Bytes(new Uint8Array([1, 2, 3]))).toBe('039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81')
  })

  it('creates and attaches one verified artifact for a server-owned image', async () => {
    const db = makeDb()
    const result = await resolveImageArtifact(db, input)
    expect(result.id).toBe(ARTIFACT)
    expect(db.insert).toHaveBeenCalled()
    expect(db.upsert).toHaveBeenCalledWith(expect.objectContaining({
      artifact_id: ARTIFACT,
      image_generation_attempt_id: ATTEMPT,
      image_output_id: OUTPUT,
      provenance_key: `image_generation:${ATTEMPT}:${OUTPUT}`,
    }), { onConflict: 'artifact_id,provenance_key', ignoreDuplicates: true })
  })

  it('reuses provenance before reading or creating a duplicate artifact', async () => {
    const db = makeDb({ existingProvenance: true })
    const result = await resolveImageArtifact(db, input)
    expect(result.id).toBe(ARTIFACT)
    expect(db.insert).not.toHaveBeenCalled()
    expect(db.upsert).not.toHaveBeenCalled()
  })

  it('rejects a storage key outside the authenticated owner namespace', async () => {
    const db = makeDb()
    await expect(resolveImageArtifact(db, { ...input, storagePath: 'users/other/images/x/original.png' }))
      .rejects.toThrow('MEDIA_ARTIFACT_UNTRUSTED_STORAGE_PATH')
  })
})
