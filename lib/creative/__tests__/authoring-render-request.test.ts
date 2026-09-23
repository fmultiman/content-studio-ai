import { describe, expect, it } from 'vitest'
import {
  createInitialAuthoringState,
  deriveManifestFromState,
  parseAuthoringRenderRequest,
} from '@/lib/creative/authoring'

describe('AuthoringRenderRequest runtime boundary', () => {
  it('carries tuning beside a pure derived manifest', () => {
    const state = createInitialAuthoringState()
    const tuning = {
      hero: { offsetX: 42, offsetY: -24, rotation: 2, scale: 1.08 },
      title: { offsetX: 9, offsetY: 4, rotation: -1 },
      source: { offsetX: -5, offsetY: 3, rotation: 0.5 },
    }
    const request = parseAuthoringRenderRequest({
      manifest: deriveManifestFromState({ ...state, tuning }),
      overrides: { documentaryCard: tuning },
    })

    expect(request.overrides?.documentaryCard).toStrictEqual(tuning)
    expect(JSON.stringify(request.manifest)).not.toContain('offsetX')
    expect(JSON.stringify(request.manifest)).not.toContain('previewTuning')
  })

  it('accepts a manifest-only request for Wave 5 default behavior', () => {
    const request = parseAuthoringRenderRequest({ manifest: deriveManifestFromState(createInitialAuthoringState()) })
    expect(request.overrides).toBeUndefined()
  })

  it('rejects invalid tuning and client-controlled execution fields', () => {
    const manifest = deriveManifestFromState(createInitialAuthoringState())
    expect(() => parseAuthoringRenderRequest({
      manifest,
      output_path: 'C:/arbitrary.png',
      overrides: { documentaryCard: { hero: { offsetX: 999, offsetY: 0, rotation: 0, scale: 1 }, title: { offsetX: 0, offsetY: 0, rotation: 0 } } },
    })).toThrow()
    expect(() => parseAuthoringRenderRequest({ manifest, command: 'rm -rf .' })).toThrow()
  })
})
