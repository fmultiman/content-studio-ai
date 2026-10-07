import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { resolveAuthorizedReviewMedia } from '../media'
import { REVIEW_IMAGE_MAX_BYTES, REVIEW_VIDEO_MAX_BYTES, REVIEW_VIDEO_MAX_DURATION_MS } from '../media-limits'

const OWNER = '11111111-1111-4111-8111-111111111111'
const OTHER = '99999999-9999-4999-8999-999999999999'
const PROJECT = '44444444-4444-4444-8444-444444444444'
const BLOB = '22222222-2222-4222-8222-222222222222'
const ARTIFACT = '33333333-3333-4333-8333-333333333333'

const bytes = new Uint8Array([1, 2, 3, 4])
const hash = createHash('sha256').update(bytes).digest('hex')

type Artifact = Record<string, unknown>

function artifact(overrides: Artifact = {}): Artifact {
  return {
    id: ARTIFACT, user_id: OWNER, project_id: PROJECT, production_id: null, media_type: 'image', identity_mode: 'sha256',
    storage_provider: 's3', storage_path: `users/${OWNER}/images/${BLOB}/original.png`, content_hash: hash, version: 1,
    mime_type: 'image/png', byte_size: 4, width: 10, height: 10, duration_ms: null, ...overrides,
  }
}

/** Minimal Supabase stub that honours the .eq() ownership filters the resolver applies. */
function db(rows: Artifact[], error: unknown = null) {
  return {
    from: () => {
      const filters: Record<string, unknown> = {}
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => { filters[column] = value; return builder },
        maybeSingle: async () => ({
          data: rows.find((row) => Object.entries(filters).every(([k, v]) => row[k] === v)) ?? null,
          error,
        }),
      }
      return builder
    },
  } as never
}

describe('resolveAuthorizedReviewMedia', () => {
  it('resolves an owned image artifact and loads verified bytes through the server reader', async () => {
    const readObject = vi.fn(async () => ({ bytes, contentType: 'image/png' }))
    const media = await resolveAuthorizedReviewMedia(db([artifact()]), { userId: OWNER, artifactId: ARTIFACT, expectedKind: 'image', readObject })
    expect(media).toMatchObject({ kind: 'image', artifactId: ARTIFACT, mimeType: 'image/png', byteSize: 4 })
    expect(await media.load()).toBe(bytes)
    expect(readObject).toHaveBeenCalledWith(`users/${OWNER}/images/${BLOB}/original.png`, { maxBytes: REVIEW_IMAGE_MAX_BYTES })
  })

  it('does not expose another user\'s artifact (cross-user is indistinguishable from not found)', async () => {
    const readObject = vi.fn()
    await expect(resolveAuthorizedReviewMedia(db([artifact()]), { userId: OTHER, artifactId: ARTIFACT, readObject }))
      .rejects.toMatchObject({ code: 'REVIEW_SUBJECT_NOT_FOUND', status: 404 })
    expect(readObject).not.toHaveBeenCalled()
  })

  it('rejects untrusted storage paths, arbitrary URLs and foreign namespaces', async () => {
    for (const storage_path of [
      'https://evil.example/x.png',
      `users/${OTHER}/images/${BLOB}/original.png`,
      `users/${OWNER}/images/${BLOB}/../../x/original.png`,
      '/etc/passwd',
    ]) {
      await expect(resolveAuthorizedReviewMedia(db([artifact({ storage_path })]), { userId: OWNER, artifactId: ARTIFACT, readObject: vi.fn() }))
        .rejects.toMatchObject({ code: 'REVIEW_OUTPUT_UNAVAILABLE' })
    }
    await expect(resolveAuthorizedReviewMedia(db([artifact({ storage_provider: 'external' })]), { userId: OWNER, artifactId: ARTIFACT }))
      .rejects.toMatchObject({ code: 'REVIEW_OUTPUT_UNAVAILABLE' })
  })

  it('accepts an owned tenant video path and enforces size/duration guardrails before any read', async () => {
    const videoPath = `${OWNER}/videos/ai/${PROJECT}/gen-1.mp4`
    const base = { media_type: 'video', storage_path: videoPath, mime_type: 'video/mp4', byte_size: 1000, duration_ms: 30_000, content_hash: null, identity_mode: 'legacy_storage_snapshot' }
    const ok = await resolveAuthorizedReviewMedia(db([artifact(base)]), { userId: OWNER, artifactId: ARTIFACT, expectedKind: 'video', readObject: vi.fn() })
    expect(ok).toMatchObject({ kind: 'video', durationMs: 30_000 })

    const readObject = vi.fn()
    for (const bad of [
      { byte_size: REVIEW_VIDEO_MAX_BYTES + 1 },
      { duration_ms: REVIEW_VIDEO_MAX_DURATION_MS + 1 },
      { byte_size: null },
      { duration_ms: null },
    ]) {
      await expect(resolveAuthorizedReviewMedia(db([artifact({ ...base, ...bad })]), { userId: OWNER, artifactId: ARTIFACT, readObject }))
        .rejects.toMatchObject({ kind: 'media_limit_exceeded' })
    }
    expect(readObject).not.toHaveBeenCalled()
    await expect(resolveAuthorizedReviewMedia(db([artifact({ ...base, storage_path: `${OTHER}/videos/ai/${PROJECT}/gen-1.mp4` })]), { userId: OWNER, artifactId: ARTIFACT }))
      .rejects.toMatchObject({ code: 'REVIEW_OUTPUT_UNAVAILABLE' })
  })

  it('rejects a media-kind mismatch so video is never sent where image is expected', async () => {
    const video = artifact({ media_type: 'video', storage_path: `${OWNER}/videos/ai/${PROJECT}/gen-1.mp4`, byte_size: 10, duration_ms: 1000 })
    await expect(resolveAuthorizedReviewMedia(db([video]), { userId: OWNER, artifactId: ARTIFACT, expectedKind: 'image' }))
      .rejects.toMatchObject({ kind: 'unsupported_capability' })
  })

  it('refuses bytes that no longer match an immutable sha256 artifact and unreadable storage', async () => {
    const changed = await resolveAuthorizedReviewMedia(db([artifact()]), { userId: OWNER, artifactId: ARTIFACT, readObject: async () => ({ bytes: new Uint8Array([9, 9]), contentType: 'image/png' }) })
    await expect(changed.load()).rejects.toMatchObject({ code: 'REVIEW_OUTPUT_UNAVAILABLE' })
    const missing = await resolveAuthorizedReviewMedia(db([artifact()]), { userId: OWNER, artifactId: ARTIFACT, readObject: async () => null })
    await expect(missing.load()).rejects.toMatchObject({ code: 'REVIEW_OUTPUT_UNAVAILABLE' })
    const throwing = await resolveAuthorizedReviewMedia(db([artifact()]), { userId: OWNER, artifactId: ARTIFACT, readObject: async () => { throw new Error('s3 down') } })
    await expect(throwing.load()).rejects.toMatchObject({ code: 'REVIEW_OUTPUT_UNAVAILABLE' })
  })

  it('reports a storage lookup failure as unavailable, not as missing media', async () => {
    await expect(resolveAuthorizedReviewMedia(db([], { message: 'db' }), { userId: OWNER, artifactId: ARTIFACT }))
      .rejects.toMatchObject({ code: 'REVIEW_STORE_UNAVAILABLE' })
  })
})

describe('streaming video access', () => {
  const videoBytes = new Uint8Array(3000).fill(5)
  const videoHash = createHash('sha256').update(videoBytes).digest('hex')
  const videoPath = `${OWNER}/videos/ai/${PROJECT}/gen-1.mp4`
  const videoRow = (overrides: Artifact = {}) => artifact({
    media_type: 'video', storage_path: videoPath, mime_type: 'video/mp4', byte_size: 3000, duration_ms: 30_000,
    content_hash: videoHash, ...overrides,
  })
  function opener(chunks: Uint8Array[], extra: { contentLength?: number | null; failAfter?: Error } = {}) {
    const destroy = vi.fn()
    const open = vi.fn(async (_path: string) => ({
      stream: Object.assign({
        async *[Symbol.asyncIterator]() {
          for (const chunk of chunks) yield chunk
          if (extra.failAfter) throw extra.failAfter
        },
      }, { destroy }),
      contentLength: extra.contentLength === undefined ? chunks.reduce((n, c) => n + c.byteLength, 0) : extra.contentLength,
      contentType: 'video/mp4',
    }))
    return { open, destroy }
  }
  async function drain(chunks: AsyncIterable<Uint8Array>) {
    let total = 0
    for await (const chunk of chunks) total += chunk.byteLength
    return total
  }

  it('streams an owned video artifact in verified chunks without calling the whole-object reader', async () => {
    const readObject = vi.fn()
    const { open } = opener([videoBytes.subarray(0, 1000), videoBytes.subarray(1000, 2000), videoBytes.subarray(2000)])
    const media = await resolveAuthorizedReviewMedia(db([videoRow()]), { userId: OWNER, artifactId: ARTIFACT, expectedKind: 'video', readObject, openObject: open })
    const stream = await media.openStream!()
    expect(stream.byteLength).toBe(3000)
    expect(await drain(stream.chunks)).toBe(3000)
    expect(open).toHaveBeenCalledWith(videoPath)
    expect(readObject).not.toHaveBeenCalled()
  })

  it('refuses to load a video whole', async () => {
    const readObject = vi.fn()
    const media = await resolveAuthorizedReviewMedia(db([videoRow()]), { userId: OWNER, artifactId: ARTIFACT, readObject })
    await expect(media.load()).rejects.toMatchObject({ code: 'REVIEW_OUTPUT_UNAVAILABLE' })
    expect(readObject).not.toHaveBeenCalled()
  })

  it('fails the stream when the stored bytes no longer match the immutable hash', async () => {
    const { open } = opener([new Uint8Array(3000).fill(6)])
    const media = await resolveAuthorizedReviewMedia(db([videoRow()]), { userId: OWNER, artifactId: ARTIFACT, openObject: open })
    await expect((async () => drain((await media.openStream!()).chunks))()).rejects.toMatchObject({ code: 'REVIEW_OUTPUT_UNAVAILABLE' })
  })

  it('rejects an object whose reported length differs from the artifact, and releases the connection', async () => {
    const { open, destroy } = opener([videoBytes], { contentLength: 4000 })
    const media = await resolveAuthorizedReviewMedia(db([videoRow()]), { userId: OWNER, artifactId: ARTIFACT, openObject: open })
    await expect(media.openStream!()).rejects.toMatchObject({ code: 'REVIEW_OUTPUT_UNAVAILABLE' })
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it('normalizes missing storage and mid-stream storage failures without leaking details', async () => {
    const missing = await resolveAuthorizedReviewMedia(db([videoRow()]), { userId: OWNER, artifactId: ARTIFACT, openObject: async () => null })
    await expect(missing.openStream!()).rejects.toMatchObject({ code: 'REVIEW_OUTPUT_UNAVAILABLE' })
    const throwing = await resolveAuthorizedReviewMedia(db([videoRow()]), { userId: OWNER, artifactId: ARTIFACT, openObject: async () => { throw new Error(`s3 ${videoPath}`) } })
    await expect(throwing.openStream!()).rejects.toMatchObject({ code: 'REVIEW_OUTPUT_UNAVAILABLE' })

    const { open } = opener([videoBytes.subarray(0, 100)], { contentLength: 3000, failAfter: new Error(`reset ${videoPath}`) })
    const media = await resolveAuthorizedReviewMedia(db([videoRow()]), { userId: OWNER, artifactId: ARTIFACT, openObject: open })
    const error = await drain((await media.openStream!()).chunks).catch((e) => e)
    expect(error).toMatchObject({ code: 'REVIEW_OUTPUT_UNAVAILABLE' })
    expect(String(error.message)).not.toContain(videoPath)
  })

  it('abort() releases the storage stream', async () => {
    const { open, destroy } = opener([videoBytes])
    const media = await resolveAuthorizedReviewMedia(db([videoRow()]), { userId: OWNER, artifactId: ARTIFACT, openObject: open })
    ;(await media.openStream!()).abort()
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it('never opens storage for another user, an untrusted key, or an over-limit video', async () => {
    const { open } = opener([videoBytes])
    await expect(resolveAuthorizedReviewMedia(db([videoRow()]), { userId: OTHER, artifactId: ARTIFACT, openObject: open }))
      .rejects.toMatchObject({ code: 'REVIEW_SUBJECT_NOT_FOUND' })
    await expect(resolveAuthorizedReviewMedia(db([videoRow({ storage_path: 'https://evil.example/v.mp4' })]), { userId: OWNER, artifactId: ARTIFACT, openObject: open }))
      .rejects.toMatchObject({ code: 'REVIEW_OUTPUT_UNAVAILABLE' })
    await expect(resolveAuthorizedReviewMedia(db([videoRow({ byte_size: REVIEW_VIDEO_MAX_BYTES + 1 })]), { userId: OWNER, artifactId: ARTIFACT, openObject: open }))
      .rejects.toMatchObject({ kind: 'media_limit_exceeded' })
    await expect(resolveAuthorizedReviewMedia(db([videoRow({ duration_ms: REVIEW_VIDEO_MAX_DURATION_MS + 1 })]), { userId: OWNER, artifactId: ARTIFACT, openObject: open }))
      .rejects.toMatchObject({ kind: 'media_limit_exceeded' })
    expect(open).not.toHaveBeenCalled()
  })

  it('trusts a completed render scratch key for its own owner and no other scratch key', async () => {
    const exec = '55555555-5555-4555-8555-555555555555'
    const own = `users/${OWNER}/renders/scratch/${exec}/output.mp4`
    const ok = await resolveAuthorizedReviewMedia(db([videoRow({ storage_path: own })]), { userId: OWNER, artifactId: ARTIFACT, expectedKind: 'video' })
    expect(ok.kind).toBe('video')
    for (const storage_path of [
      `users/${OTHER}/renders/scratch/${exec}/output.mp4`,
      `users/${OWNER}/renders/scratch/${exec}/output.png`,
      `users/${OWNER}/renders/scratch/${exec}/../other/output.mp4`,
      `users/${OWNER}/renders/scratch/not-a-uuid/output.mp4`,
    ]) {
      await expect(resolveAuthorizedReviewMedia(db([videoRow({ storage_path })]), { userId: OWNER, artifactId: ARTIFACT }))
        .rejects.toMatchObject({ code: 'REVIEW_OUTPUT_UNAVAILABLE' })
    }
  })
})
