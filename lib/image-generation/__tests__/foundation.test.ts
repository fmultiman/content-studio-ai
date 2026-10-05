import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generateImageAttemptFingerprint } from '@/lib/image-generation/idempotency'
import { ImageGenerationWorkingStateV1Schema, parseWorkingState } from '@/lib/image-generation/session'

const migration = readFileSync(resolve(process.cwd(), 'scripts/050_create_image_generation_session_attempts.sql'), 'utf8')
const backfill = readFileSync(resolve(process.cwd(), 'scripts/051_backfill_image_generation_sessions_and_attempts.sql'), 'utf8')
const sessionRoute = readFileSync(resolve(process.cwd(), 'app/api/image-generation-sessions/[id]/route.ts'), 'utf8')
const attemptRoute = readFileSync(resolve(process.cwd(), 'app/api/image-generation-attempts/route.ts'), 'utf8')
const inventory = JSON.parse(readFileSync(resolve(process.cwd(), 'docs/migrations/image-generation-session-attempt-foundation-v1-inventory.json'), 'utf8')) as {
  summary: { imageDrafts: number; migrate: number; migrateWithPartialHistory: number; discarded: number }
  rows: Array<{ id: string; disposition: string }>
}

describe('Image generation session and attempt foundation', () => {
  it('accepts the V1 working contract and defaults fields absent from legacy state without inventing values', () => {
    const parsed = ImageGenerationWorkingStateV1Schema.parse({
      schemaVersion: 1,
      autoMode: false,
    })
    expect(parsed.generatedPrompt).toBeNull()
    expect(parsed.sourceReferences).toEqual([])
    expect(parsed.generationConfig.providerOptions).toEqual({})
  })

  it('rejects oversized working state before persistence', () => {
    const result = parseWorkingState({
      schemaVersion: 1,
      autoMode: false,
      generatedPrompt: 'x'.repeat(20_001),
      generationConfig: { providerOptions: {} },
    })
    expect(result.success).toBe(false)
  })

  it('fingerprints the exact submitted request independent of object key order', () => {
    const base = {
      sessionId: '00000000-0000-0000-0000-000000000001',
      submittedPrompt: 'a precise image',
      provider: 'openai',
      model: 'gpt-image-1',
      submittedConfig: { quality: 'high', size: '1024x1024' },
      sourceSnapshot: { metadata: { source: 'library' }, references: [] },
    }
    expect(generateImageAttemptFingerprint(base)).toBe(generateImageAttemptFingerprint({
      ...base,
      submittedConfig: { size: '1024x1024', quality: 'high' },
      sourceSnapshot: { references: [], metadata: { source: 'library' } },
    }))
    expect(generateImageAttemptFingerprint({ ...base, submittedPrompt: 'a different image' })).not.toBe(generateImageAttemptFingerprint(base))
  })

  it('has explicit database protections for owner scope, CAS revision, immutable submission, and RLS', () => {
    expect(migration).toContain('validate_image_generation_session_scope')
    expect(migration).toContain('guard_image_generation_session_revision')
expect(migration).toContain('guard_image_generation_attempt_immutability')
    expect(migration).toContain('new.submitted_at is distinct from old.submitted_at')
    expect(migration).toContain('using ((select auth.uid()) = user_id)')
    expect(migration).toContain('revoke all on table public.image_generation_sessions from anon, authenticated')
    expect(migration).toContain('revoke all on table public.image_generation_attempts from anon, authenticated')
  })

  it('wires authenticated ownership into server-owned routes without invoking a provider', () => {
    expect(sessionRoute).toContain('authenticateImageGenerationRequest')
    expect(sessionRoute).toContain('createServiceRoleSupabase')
    expect(sessionRoute).toContain(".eq('user_id', user.id)")
    expect(sessionRoute).toContain('SESSION_VERSION_CONFLICT')
    expect(attemptRoute).toContain('authenticateImageGenerationRequest')
    expect(attemptRoute).toContain('createServiceRoleSupabase')
    expect(attemptRoute).toContain(".eq('user_id', user.id)")
    expect(attemptRoute).toContain('IDEMPOTENCY_CONFLICT')
    expect(attemptRoute).not.toMatch(/openai|replicate|nanobanana|fetch\(/i)
  })

  it('keeps the preserving inventory numerically closed before data migration', () => {
    expect(inventory.summary.imageDrafts).toBe(29)
    expect(inventory.rows).toHaveLength(29)
    expect(inventory.summary.migrate + inventory.summary.migrateWithPartialHistory).toBe(29)
    expect(inventory.summary.discarded).toBe(0)
    expect(backfill).toContain('image_drafts are never updated or deleted')
    expect(backfill).toContain('IMAGE_SESSION_BACKFILL_RECONCILIATION_FAILED')
    expect(backfill).toContain('IMAGE_ATTEMPT_BACKFILL_RECONCILIATION_FAILED')
  })
})
