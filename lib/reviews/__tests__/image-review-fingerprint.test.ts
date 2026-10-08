import { describe, expect, it, vi } from 'vitest'

// IMAGE_REVIEW_IDEMPOTENCY_FINGERPRINT_CAPTUREDAT_V1 (FUTURE-040) — the semantic projection and its guard rails.

vi.mock('@/lib/storage/image-storage', () => ({ presignImageObject: vi.fn(async () => 'https://signed.example/x') }))

import {
  IMAGE_REVIEW_CONTEXT_OBSERVATIONAL_FIELDS,
  IMAGE_REVIEW_CONTEXT_SEMANTIC_FIELDS,
  buildRequestFingerprint,
  canonicalJson,
  fingerprintImageReviewContext,
  resolveImageReviewContext,
  semanticImageReviewContext,
} from '../context'
import type { ImageReviewContext } from '../contracts'
import { createReviewTestDb } from './review-test-db'

const base = (): ImageReviewContext => ({
  schemaVersion: 1,
  capturedAt: '2026-10-08T12:00:00.000Z',
  project: { id: 'p1', context: 'Brand X', evaluationMode: 'default', identity: { schema_version: 1, foundation: { purpose: 'Premium' } } },
  production: { id: 'pr1', title: 'Spring', intention: 'Promote', type: 'image' },
})

describe('semanticImageReviewContext', () => {
  it('is an explicit allow-list: exactly the semantic fields, never capturedAt', () => {
    const projection = semanticImageReviewContext(base())
    expect(Object.keys(projection).sort()).toEqual([...IMAGE_REVIEW_CONTEXT_SEMANTIC_FIELDS].sort())
    expect(JSON.stringify(projection)).not.toContain('2026-10-08T12:00:00')
    expect(JSON.stringify(projection)).not.toContain('capturedAt')
  })

  it('does not copy unknown extra fields (an allow-list, not a deny-list)', () => {
    const polluted = { ...base(), debugResolvedAt: 'x', project: { ...base().project, fetchedAt: 'y' } } as unknown as ImageReviewContext
    expect(JSON.stringify(semanticImageReviewContext(polluted))).not.toMatch(/debugResolvedAt|fetchedAt/)
    expect(fingerprintImageReviewContext(polluted)).toBe(fingerprintImageReviewContext(base()))
  })
})

describe('fingerprintImageReviewContext', () => {
  it('is independent of capturedAt (regression guard: adding capturedAt back into the projection fails this test)', () => {
    const a = fingerprintImageReviewContext(base())
    for (const capturedAt of ['2026-10-08T12:00:01.000Z', '1999-01-01T00:00:00.000Z', '', 'not-a-date']) {
      expect(fingerprintImageReviewContext({ ...base(), capturedAt })).toBe(a)
    }
  })

  it('changes with every semantic input', () => {
    const a = fingerprintImageReviewContext(base())
    const variants: ImageReviewContext[] = [
      { ...base(), schemaVersion: 2 as never },
      { ...base(), project: { ...base().project, id: 'p2' } },
      { ...base(), project: { ...base().project, context: 'Brand Y' } },
      { ...base(), project: { ...base().project, evaluationMode: 'strict' } },
      { ...base(), project: { ...base().project, identity: null } },
      { ...base(), project: { ...base().project, identity: { schema_version: 1, foundation: { purpose: 'Other' } } } },
      { ...base(), production: null },
      { ...base(), production: { ...base().production!, id: 'pr2' } },
      { ...base(), production: { ...base().production!, title: 'Autumn' } },
      { ...base(), production: { ...base().production!, intention: 'Retain' } },
      { ...base(), production: { ...base().production!, type: 'video' } },
    ]
    const hashes = variants.map(fingerprintImageReviewContext)
    expect(hashes.every((h) => h !== a)).toBe(true)
    expect(new Set(hashes).size).toBe(hashes.length)
  })

  it('does not depend on object property order', () => {
    const reordered: ImageReviewContext = {
      production: { type: 'image', intention: 'Promote', title: 'Spring', id: 'pr1' },
      project: { identity: { foundation: { purpose: 'Premium' }, schema_version: 1 }, evaluationMode: 'default', context: 'Brand X', id: 'p1' },
      capturedAt: 'later',
      schemaVersion: 1,
    }
    expect(fingerprintImageReviewContext(reordered)).toBe(fingerprintImageReviewContext(base()))
  })
})

describe('buildRequestFingerprint', () => {
  const stable = fingerprintImageReviewContext(base())
  it('is deterministic and sensitive to attempt, output, artifact and context', () => {
    const a = buildRequestFingerprint('att', 'out', stable, 'art')
    expect(buildRequestFingerprint('att', 'out', stable, 'art')).toBe(a)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(buildRequestFingerprint('att2', 'out', stable, 'art')).not.toBe(a)
    expect(buildRequestFingerprint('att', 'out2', stable, 'art')).not.toBe(a)
    expect(buildRequestFingerprint('att', 'out', stable, 'art2')).not.toBe(a)
    expect(buildRequestFingerprint('att', 'out', stable)).not.toBe(a)
    expect(buildRequestFingerprint('att', 'out', 'other', 'art')).not.toBe(a)
  })
})

describe('canonicalJson', () => {
  it('sorts keys at every depth and keeps array order', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 1], c: null } })).toBe('{"a":{"c":null,"d":[3,1]},"b":1}')
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}')
  })
})

describe('field classification guard (the resolved context must not grow an unclassified field)', () => {
  it('every key of a REAL resolved context is either semantic or observational', async () => {
    const db = createReviewTestDb({
      image_generation_attempts: [{ id: 'a', user_id: 'u', project_id: 'p', production_id: 'pr', sequence: 1, submitted_prompt: 'x', provider: 'openai', model: 'm', submitted_config: {}, source_snapshot: null, status: 'succeeded', result_image_id: 'o' }],
      images: [{ id: 'o', user_id: 'u', project_id: 'p', image_url: 'https://example.test/i.png', storage_path: null, storage_provider: null, thumbnail_path: null, file_size: 1, mime_type: 'image/png', updated_at: 't', metadata: {} }],
      projects: [{ id: 'p', user_id: 'u', context: 'c', evaluation_mode: 'default', identity: null }],
      productions: [{ id: 'pr', user_id: 'u', project_id: 'p', title: 't', intention: 'i', type: 'image' }],
    })
    const { context, contextFingerprint } = await resolveImageReviewContext(db, 'u', 'a')
    const classified = new Set<string>([...IMAGE_REVIEW_CONTEXT_SEMANTIC_FIELDS, ...IMAGE_REVIEW_CONTEXT_OBSERVATIONAL_FIELDS])
    expect(Object.keys(context).filter((key) => !classified.has(key))).toEqual([])
    expect(IMAGE_REVIEW_CONTEXT_OBSERVATIONAL_FIELDS).toEqual(['capturedAt'])
    expect(context.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(contextFingerprint).toBe(fingerprintImageReviewContext(context))
  })

  it('two real resolutions at different instants share one fingerprint but keep their own capture time', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const seed = () => ({
        image_generation_attempts: [{ id: 'a', user_id: 'u', project_id: null, production_id: null, sequence: 1, submitted_prompt: 'x', provider: 'openai', model: 'm', submitted_config: {}, source_snapshot: null, status: 'succeeded', result_image_id: 'o' }],
        images: [{ id: 'o', user_id: 'u', project_id: null, image_url: 'https://example.test/i.png', storage_path: null, storage_provider: null, thumbnail_path: null, file_size: 1, mime_type: 'image/png', updated_at: 't', metadata: {} }],
      })
      const db = createReviewTestDb(seed())
      vi.setSystemTime(Date.parse('2026-10-08T12:00:00.000Z'))
      const first = await resolveImageReviewContext(db, 'u', 'a')
      vi.setSystemTime(Date.parse('2026-10-08T12:30:00.000Z'))
      const second = await resolveImageReviewContext(db, 'u', 'a')
      expect(first.context.capturedAt).not.toBe(second.context.capturedAt)
      expect(first.contextFingerprint).toBe(second.contextFingerprint)
    } finally {
      vi.useRealTimers()
    }
  })
})
