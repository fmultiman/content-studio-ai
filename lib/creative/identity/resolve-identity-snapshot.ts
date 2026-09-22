import type { IdentitySnapshotRef, VisualTokensSnapshot } from '@/lib/schemas/creative/primitives'
import { IDENTITY_FIXTURES } from './fixtures'

export type IdentityResolutionResult =
  | { valid: true; value: VisualTokensSnapshot }
  | { valid: false; error: { code: 'identity_not_found'; message: string; path: 'identity.snapshot_ref' } }

export function resolveIdentitySnapshot(ref: IdentitySnapshotRef): IdentityResolutionResult {
  const snapshot = IDENTITY_FIXTURES.find((fixture) => fixture.snapshot_ref === ref.snapshot_ref)
  if (!snapshot) {
    return {
      valid: false,
      error: {
        code: 'identity_not_found',
        message: `Identity snapshot "${ref.snapshot_ref}" is not available in the local fixture resolver`,
        path: 'identity.snapshot_ref',
      },
    }
  }
  return { valid: true, value: snapshot }
}
