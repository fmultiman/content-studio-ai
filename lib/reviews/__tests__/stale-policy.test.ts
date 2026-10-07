import { describe, expect, it } from 'vitest'
import {
  GEMINI_CLEANUP_TIMEOUT_MS,
  GEMINI_FILE_PROCESSING_TIMEOUT_MS,
  GEMINI_GENERATE_TIMEOUT_MS,
  GEMINI_UPLOAD_TIMEOUT_MS,
  GEMINI_UPLOAD_TOTAL_TIMEOUT_MS,
} from '@/lib/providers/gemini/client'
import { OPENAI_REVIEW_DEFAULT_TIMEOUT_MS } from '../providers/openai'
import { REVIEW_STALE_AFTER_MS, REVIEW_STALE_FAILURE_CODE, isReviewStale, reviewIdleMs } from '../stale-policy'
import { VIDEO_REVIEW_STALE_MS } from '../video-review-presentation'

// REVIEW_STALE_RUNNING_RECOVERY_V1 (FUTURE-046) — the stale threshold is DERIVED from the executing provider
// envelope, not copied from the UI. If a provider timeout is ever raised, this test fails until the policy is
// reconsidered.

/** Status check inside the file-processing wait (`getFile` is hard-bounded at 30 s in the Gemini client). */
const GEMINI_STATUS_CHECK_MS = 30_000
const MIN = 60_000

// Worst case of one Gemini VIDEO Review between its insert and its terminal write.
//  - upload: the 600 s total deadline is checked BETWEEN chunks, so the last chunk may still run its own request timeout.
//  - processing: wait deadline + one final status check.
const GEMINI_VIDEO_ENVELOPE_MS =
  GEMINI_UPLOAD_TOTAL_TIMEOUT_MS + GEMINI_UPLOAD_TIMEOUT_MS +
  GEMINI_FILE_PROCESSING_TIMEOUT_MS + GEMINI_STATUS_CHECK_MS +
  GEMINI_GENERATE_TIMEOUT_MS +
  GEMINI_CLEANUP_TIMEOUT_MS
const GEMINI_IMAGE_ENVELOPE_MS = GEMINI_GENERATE_TIMEOUT_MS
const OPENAI_IMAGE_ENVELOPE_MS = OPENAI_REVIEW_DEFAULT_TIMEOUT_MS

describe('stale threshold derivation', () => {
  it('measures the provider envelopes from the real constants', () => {
    expect(GEMINI_VIDEO_ENVELOPE_MS).toBe(1_245_000) // 20.75 min
    expect(GEMINI_IMAGE_ENVELOPE_MS).toBe(120_000)
    expect(OPENAI_IMAGE_ENVELOPE_MS).toBe(60_000)
  })

  it('is greater than the longest legitimate provider envelope with at least a 5 minute safety margin', () => {
    const longest = Math.max(GEMINI_VIDEO_ENVELOPE_MS, GEMINI_IMAGE_ENVELOPE_MS, OPENAI_IMAGE_ENVELOPE_MS)
    expect(REVIEW_STALE_AFTER_MS).toBeGreaterThanOrEqual(longest + 5 * MIN)
  })

  it('is not the old 15 minute UI warning (which is shorter than the Gemini video envelope)', () => {
    expect(15 * MIN).toBeLessThan(GEMINI_VIDEO_ENVELOPE_MS)
    expect(REVIEW_STALE_AFTER_MS).not.toBe(15 * MIN)
  })

  it('is the single number the UI warning uses, so the UI never promises more than the backend does', () => {
    expect(VIDEO_REVIEW_STALE_MS).toBe(REVIEW_STALE_AFTER_MS)
  })

  it('uses a normalized lowercase failure code like every other persisted code', () => {
    expect(REVIEW_STALE_FAILURE_CODE).toBe('execution_stale')
  })
})

describe('isReviewStale', () => {
  const now = Date.parse('2026-10-07T12:00:00.000Z')
  const ago = (ms: number) => new Date(now - ms).toISOString()

  it.each(['pending', 'running'])('%s is stale only strictly past the threshold', (status) => {
    expect(isReviewStale({ status, updated_at: ago(REVIEW_STALE_AFTER_MS - 1) }, now)).toBe(false)
    expect(isReviewStale({ status, updated_at: ago(REVIEW_STALE_AFTER_MS) }, now)).toBe(false)
    expect(isReviewStale({ status, updated_at: ago(REVIEW_STALE_AFTER_MS + 1) }, now)).toBe(true)
  })

  it.each(['completed', 'failed'])('terminal %s is never stale, however old', (status) => {
    expect(isReviewStale({ status, updated_at: ago(10 * REVIEW_STALE_AFTER_MS) }, now)).toBe(false)
  })

  it('fails safe on an unreadable timestamp (never reaps what it cannot date)', () => {
    expect(reviewIdleMs({ updated_at: 'garbage' }, now)).toBeNull()
    expect(isReviewStale({ status: 'running', updated_at: 'garbage' }, now)).toBe(false)
  })

  it('reads PostgREST timestamptz strings with offsets and microseconds', () => {
    expect(isReviewStale({ status: 'running', updated_at: '2026-10-07T10:00:00.123456+00:00' }, now)).toBe(true)
    expect(isReviewStale({ status: 'running', updated_at: '2026-10-07T11:59:00.123456+00:00' }, now)).toBe(false)
  })
})
