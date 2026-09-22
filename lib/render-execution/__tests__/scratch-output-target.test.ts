/**
 * Phase 2I-B3 — deterministic scratch output target tests (Task 14).
 */
import { describe, expect, it } from 'vitest'
import {
  RENDER_EXECUTION_SCRATCH_BUCKET_DEFAULT,
  buildScratchOutputKey,
  buildScratchOutputTarget,
  getExpectedScratchBucket,
  isExpectedScratchOutputTarget,
} from '@/lib/render-execution/scratch-output-target'

const USER_A = '11111111-1111-1111-1111-111111111111'
const USER_B = '22222222-2222-2222-2222-222222222222'
const EXEC_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const EXEC_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

describe('buildScratchOutputKey — deterministic namespace', () => {
  it('produces the exact B0 §11 convention', () => {
    expect(buildScratchOutputKey({ userId: USER_A, executionId: EXEC_A })).toBe(
      `users/${USER_A}/renders/scratch/${EXEC_A}/output.mp4`,
    )
  })

  it('same execution retried produces the SAME key', () => {
    const first = buildScratchOutputKey({ userId: USER_A, executionId: EXEC_A })
    const second = buildScratchOutputKey({ userId: USER_A, executionId: EXEC_A })
    expect(first).toBe(second)
  })

  it('a new execution for the same user produces a DIFFERENT key', () => {
    const a = buildScratchOutputKey({ userId: USER_A, executionId: EXEC_A })
    const b = buildScratchOutputKey({ userId: USER_A, executionId: EXEC_B })
    expect(a).not.toBe(b)
  })

  it('different users never collide, even with the same execution id shape', () => {
    const a = buildScratchOutputKey({ userId: USER_A, executionId: EXEC_A })
    const b = buildScratchOutputKey({ userId: USER_B, executionId: EXEC_A })
    expect(a).not.toBe(b)
    expect(a).toContain(USER_A)
    expect(b).toContain(USER_B)
  })

  it('rejects a non-UUID userId (defense against accidental raw input)', () => {
    expect(() => buildScratchOutputKey({ userId: '../../etc/passwd', executionId: EXEC_A })).toThrow()
  })

  it('rejects a non-UUID executionId', () => {
    expect(() => buildScratchOutputKey({ userId: USER_A, executionId: '../../etc/passwd' })).toThrow()
  })

  it('rejects path-traversal-shaped input even if UUID-length', () => {
    expect(() => buildScratchOutputKey({ userId: '../../../../etc/passwd/////', executionId: EXEC_A })).toThrow()
  })

  it('the produced key never contains ".." or a leading slash', () => {
    const key = buildScratchOutputKey({ userId: USER_A, executionId: EXEC_A })
    expect(key.includes('..')).toBe(false)
    expect(key.startsWith('/')).toBe(false)
  })
})

describe('getExpectedScratchBucket', () => {
  it('defaults to the B0 §11 bucket name when no env override is set', () => {
    expect(getExpectedScratchBucket({})).toBe(RENDER_EXECUTION_SCRATCH_BUCKET_DEFAULT)
  })

  it('prefers RENDER_EXECUTION_SCRATCH_BUCKET when set', () => {
    expect(getExpectedScratchBucket({ RENDER_EXECUTION_SCRATCH_BUCKET: 'custom-bucket' })).toBe(
      'custom-bucket',
    )
  })

  it('falls back to the existing S3_BUCKET_NAME convention', () => {
    expect(getExpectedScratchBucket({ S3_BUCKET_NAME: 'legacy-bucket' })).toBe('legacy-bucket')
  })
})

describe('buildScratchOutputTarget / isExpectedScratchOutputTarget', () => {
  it('builds a full { bucket, key } target', () => {
    const target = buildScratchOutputTarget({ userId: USER_A, executionId: EXEC_A }, {})
    expect(target.bucket).toBe(RENDER_EXECUTION_SCRATCH_BUCKET_DEFAULT)
    expect(target.key).toBe(`users/${USER_A}/renders/scratch/${EXEC_A}/output.mp4`)
  })

  it('accepts an exact match', () => {
    const target = buildScratchOutputTarget({ userId: USER_A, executionId: EXEC_A }, {})
    expect(
      isExpectedScratchOutputTarget(
        { userId: USER_A, executionId: EXEC_A, bucket: target.bucket, key: target.key },
        {},
      ),
    ).toBe(true)
  })

  it('rejects an arbitrary bucket (Task 1/8 — no arbitrary S3 object as output)', () => {
    expect(
      isExpectedScratchOutputTarget(
        {
          userId: USER_A,
          executionId: EXEC_A,
          bucket: 'attacker-controlled-bucket',
          key: `users/${USER_A}/renders/scratch/${EXEC_A}/output.mp4`,
        },
        {},
      ),
    ).toBe(false)
  })

  it('rejects a cross-user destination', () => {
    expect(
      isExpectedScratchOutputTarget(
        {
          userId: USER_A,
          executionId: EXEC_A,
          bucket: RENDER_EXECUTION_SCRATCH_BUCKET_DEFAULT,
          key: `users/${USER_B}/renders/scratch/${EXEC_A}/output.mp4`,
        },
        {},
      ),
    ).toBe(false)
  })

  it('rejects a cross-execution destination (would overwrite another execution)', () => {
    expect(
      isExpectedScratchOutputTarget(
        {
          userId: USER_A,
          executionId: EXEC_A,
          bucket: RENDER_EXECUTION_SCRATCH_BUCKET_DEFAULT,
          key: `users/${USER_A}/renders/scratch/${EXEC_B}/output.mp4`,
        },
        {},
      ),
    ).toBe(false)
  })

  it('rejects a path-traversal key even if it happens to still contain the right prefix', () => {
    expect(
      isExpectedScratchOutputTarget(
        {
          userId: USER_A,
          executionId: EXEC_A,
          bucket: RENDER_EXECUTION_SCRATCH_BUCKET_DEFAULT,
          key: `users/${USER_A}/renders/scratch/${EXEC_A}/../../../output.mp4`,
        },
        {},
      ),
    ).toBe(false)
  })

  it('rejects malformed userId/executionId gracefully (returns false, never throws)', () => {
    expect(() =>
      isExpectedScratchOutputTarget(
        { userId: 'not-a-uuid', executionId: EXEC_A, bucket: RENDER_EXECUTION_SCRATCH_BUCKET_DEFAULT, key: 'x' },
        {},
      ),
    ).not.toThrow()
    expect(
      isExpectedScratchOutputTarget(
        { userId: 'not-a-uuid', executionId: EXEC_A, bucket: RENDER_EXECUTION_SCRATCH_BUCKET_DEFAULT, key: 'x' },
        {},
      ),
    ).toBe(false)
  })
})
