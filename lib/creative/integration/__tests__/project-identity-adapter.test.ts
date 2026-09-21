import { describe, it, expect } from 'vitest'
import { adaptProjectIdentityToVisualTokens, CREATIVE_IDENTITY_DEFAULTS } from '../project-identity-adapter'
import type { ProjectIdentity } from '@/lib/schemas/project-identity'

describe('Productization Phase 1A: Project Identity Adapter', () => {
  it('should adapt a valid canonical ProjectIdentity into a VisualTokensSnapshot', () => {
    // 1. Arrange: A valid canonical ProjectIdentity V1
    const canonicalIdentity: ProjectIdentity = {
      schema_version: 1,
      foundation: {
        purpose: 'To share sustainable living practices.',
      },
      expression: {
        visual_identity: 'Earthy, warm, and natural.',
        voice: 'Friendly and educational.',
      },
    }

    const projectId = 'proj-1234'

    // 2. Act: Adapt it through the product integration boundary
    const snapshot = adaptProjectIdentityToVisualTokens(projectId, canonicalIdentity)

    // 3. Assert: The snapshot must be valid and contain explicit defaults
    expect(snapshot.schema_version).toBe('visual-tokens.v0')
    expect(snapshot.snapshot_ref).toBe(`project:${projectId}:snapshot`)
    
    // It should not invent data, but map to safe creative defaults
    expect(snapshot.typography.display.family).toBe(CREATIVE_IDENTITY_DEFAULTS.typography.display.family)
    expect(snapshot.colors.background).toBe(CREATIVE_IDENTITY_DEFAULTS.colors.background)
  })

  it('should handle completely empty (but valid) ProjectIdentity objects gracefully', () => {
    const emptyIdentity: ProjectIdentity = {
      schema_version: 1,
    }

    const snapshot = adaptProjectIdentityToVisualTokens('proj-empty', emptyIdentity)

    expect(snapshot.snapshot_ref).toBe('project:proj-empty:snapshot')
    expect(snapshot.typography.display.family).toBe('Fraunces')
  })
})
