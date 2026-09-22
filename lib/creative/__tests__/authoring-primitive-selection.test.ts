import { describe, expect, it } from 'vitest'
import {
  createInitialAuthoringState,
  derivePrimitiveSelectionRequest,
  derivePrimitiveTransformsRequest,
  deriveManifestFromState,
  projectRefForIdentity,
} from '@/lib/creative/authoring/authoring-state'
import {
  DEFAULT_PRIMITIVE_TRANSFORMS,
  DEFAULT_PRIMITIVE_TRANSFORMS_STATE,
} from '@/lib/creative/authoring/types'
import { PORTAL_PROJECT_REF } from '@/lib/creative/primitives/discovery'

describe('createInitialAuthoringState — Phase 2C fields', () => {
  it('initialises with paper and tape keys selected for identity a', () => {
    const state = createInitialAuthoringState('cover', 'a', 'portrait')
    expect(state.primitiveSelection.paper).toBe('paper-card-light-01')
    expect(state.primitiveSelection.tape).toBe('tape-kraft-short-01')
  })

  it('primitive transforms initialise to defaults', () => {
    const state = createInitialAuthoringState()
    expect(state.primitiveTransforms).toEqual(DEFAULT_PRIMITIVE_TRANSFORMS_STATE)
    expect(state.primitiveTransforms.paper).toEqual(DEFAULT_PRIMITIVE_TRANSFORMS)
    expect(state.primitiveTransforms.tape).toEqual(DEFAULT_PRIMITIVE_TRANSFORMS)
  })

  it('does NOT store signed URLs in initial state', () => {
    const state = createInitialAuthoringState()
    const serialized = JSON.stringify(state)
    expect(serialized).not.toContain('signed')
    expect(serialized).not.toContain('Signature')
    expect(serialized).not.toContain('storage_path')
    expect(serialized).not.toContain('s3.amazonaws')
  })
})

describe('projectRefForIdentity', () => {
  it('identity a maps to portal project ref', () => {
    expect(projectRefForIdentity('a')).toBe(PORTAL_PROJECT_REF)
  })

  it('identity b has no project primitive catalog', () => {
    expect(projectRefForIdentity('b')).toBeNull()
  })
})

describe('derivePrimitiveSelectionRequest', () => {
  it('returns request with paper and tape for identity a with selection', () => {
    const state = createInitialAuthoringState('cover', 'a', 'portrait')
    const req = derivePrimitiveSelectionRequest(state)
    expect(req).not.toBeUndefined()
    expect(req!.projectRef).toBe(PORTAL_PROJECT_REF)
    expect(req!.paper).toBe('paper-card-light-01')
    expect(req!.tape).toBe('tape-kraft-short-01')
  })

  it('returns undefined for identity b (no catalog)', () => {
    const state = createInitialAuthoringState('cover', 'b', 'portrait')
    const req = derivePrimitiveSelectionRequest(state)
    expect(req).toBeUndefined()
  })

  it('returns undefined when no primitives selected', () => {
    const state = {
      ...createInitialAuthoringState('cover', 'a', 'portrait'),
      primitiveSelection: {},
    }
    const req = derivePrimitiveSelectionRequest(state)
    expect(req).toBeUndefined()
  })

  it('omits undefined slots from request', () => {
    const state = {
      ...createInitialAuthoringState('cover', 'a', 'portrait'),
      primitiveSelection: { paper: 'paper-card-light-01', tape: undefined },
    }
    const req = derivePrimitiveSelectionRequest(state)
    expect(req).not.toBeUndefined()
    expect(req!.paper).toBe('paper-card-light-01')
    expect('tape' in req!).toBe(false)
  })

  it('request never contains signed URLs or storage paths', () => {
    const state = createInitialAuthoringState()
    const req = derivePrimitiveSelectionRequest(state)
    const serialized = JSON.stringify(req)
    expect(serialized).not.toContain('signed')
    expect(serialized).not.toContain('storage_path')
    expect(serialized).not.toContain('s3.amazonaws')
  })

  it('keeps default transforms absent from the request', () => {
    const state = createInitialAuthoringState()
    expect(derivePrimitiveTransformsRequest(state)).toBeUndefined()
  })

  it('serializes adjusted paper and tape transforms without signed URLs', () => {
    const state = createInitialAuthoringState()
    const adjusted = {
      ...state,
      primitiveTransforms: {
        paper: { offsetX: 64, offsetY: -38, rotation: 11, scale: 1.24, opacity: 1 },
        tape: { offsetX: -27, offsetY: 19, rotation: -8, scale: 0.82, opacity: 0.63 },
      },
    }
    const request = derivePrimitiveTransformsRequest(adjusted)
    expect(request).toEqual(adjusted.primitiveTransforms)
    expect(JSON.stringify(request)).not.toContain('signed')
    expect(JSON.stringify(request)).not.toContain('storage')
  })
})

describe('deriveManifestFromState — manifest boundary', () => {
  it('manifest never contains PrimitiveRef', () => {
    const state = createInitialAuthoringState()
    const manifest = deriveManifestFromState(state)
    const serialized = JSON.stringify(manifest)
    expect(serialized).not.toContain('PrimitiveRef')
    expect(serialized).not.toContain('primitive_ref')
    expect(serialized).not.toContain('primitiveRef')
    // Primitive selection is NOT in the manifest — it travels separately
    expect(serialized).not.toContain('paper-card-light-01')
    expect(serialized).not.toContain('tape-kraft-short-01')
  })

  it('manifest remains a valid StaticRenderManifest structure', () => {
    const state = createInitialAuthoringState()
    const manifest = deriveManifestFromState(state)
    expect(manifest.schema_version).toBe('static-render.v0')
    expect(manifest.template.id).toBe('editorial.documentary-card')
    expect(manifest.canvas.width).toBe(1080)
  })
})

describe('primitive selection state: persistence and reset', () => {
  it('can change paper selection', () => {
    const state = createInitialAuthoringState()
    const updated = {
      ...state,
      primitiveSelection: { ...state.primitiveSelection, paper: undefined },
    }
    expect(updated.primitiveSelection.paper).toBeUndefined()
    expect(updated.primitiveSelection.tape).toBe('tape-kraft-short-01')
  })

  it('can reset paper to default', () => {
    const base = createInitialAuthoringState()
    const state = {
      ...base,
      primitiveSelection: { paper: undefined, tape: 'tape-kraft-short-01' as string | undefined },
    }
    expect(state.primitiveSelection.paper).toBeUndefined()
    // Reset means putting back the default key
    const reset = {
      ...state,
      primitiveSelection: { ...state.primitiveSelection, paper: 'paper-card-light-01' as string | undefined },
      primitiveTransforms: {
        ...state.primitiveTransforms,
        paper: { ...DEFAULT_PRIMITIVE_TRANSFORMS },
      },
    }
    expect(reset.primitiveSelection.paper).toBe('paper-card-light-01')
    expect(reset.primitiveTransforms.paper).toEqual(DEFAULT_PRIMITIVE_TRANSFORMS)
  })

  it('transforms reset to defaults', () => {
    const state = createInitialAuthoringState()
    const modified = {
      ...state,
      primitiveTransforms: {
        ...state.primitiveTransforms,
        paper: { offsetX: 30, offsetY: -15, rotation: 4, scale: 1.2, opacity: 0.8 },
      },
    }
    expect(modified.primitiveTransforms.paper.offsetX).toBe(30)
    const reset = {
      ...modified,
      primitiveTransforms: {
        ...modified.primitiveTransforms,
        paper: { ...DEFAULT_PRIMITIVE_TRANSFORMS },
      },
    }
    expect(reset.primitiveTransforms.paper).toEqual(DEFAULT_PRIMITIVE_TRANSFORMS)
  })
})

describe('render request schema — Phase 2C extension', () => {
  it('primitiveSelectionSchema validates correct selection', async () => {
    const { primitiveSelectionSchema } = await import('@/lib/creative/authoring/render-request')
    const result = primitiveSelectionSchema.safeParse({
      projectRef: PORTAL_PROJECT_REF,
      paper: 'paper-card-light-01',
      tape: 'tape-kraft-short-01',
    })
    expect(result.success).toBe(true)
  })

  it('primitiveSelectionSchema rejects empty projectRef', async () => {
    const { primitiveSelectionSchema } = await import('@/lib/creative/authoring/render-request')
    const result = primitiveSelectionSchema.safeParse({ projectRef: '' })
    expect(result.success).toBe(false)
  })

  it('authoringRenderRequestSchema accepts primitiveSelection alongside manifest', async () => {
    const { authoringRenderRequestSchema } = await import('@/lib/creative/authoring/render-request')
    const manifest = deriveManifestFromState(createInitialAuthoringState())
    const result = authoringRenderRequestSchema.safeParse({
      manifest,
      primitiveSelection: {
        projectRef: PORTAL_PROJECT_REF,
        paper: 'paper-card-light-01',
        tape: 'tape-kraft-short-01',
      },
    })
    expect(result.success).toBe(true)
  })

  it('authoringRenderRequestSchema still valid without primitiveSelection (backward compat)', async () => {
    const { authoringRenderRequestSchema } = await import('@/lib/creative/authoring/render-request')
    const manifest = deriveManifestFromState(createInitialAuthoringState())
    const result = authoringRenderRequestSchema.safeParse({ manifest })
    expect(result.success).toBe(true)
  })

  it('authoringRenderRequestSchema preserves primitive transforms beside the manifest', async () => {
    const { authoringRenderRequestSchema } = await import('@/lib/creative/authoring/render-request')
    const manifest = deriveManifestFromState(createInitialAuthoringState())
    const result = authoringRenderRequestSchema.safeParse({
      manifest,
      primitiveTransforms: {
        paper: { offsetX: 64, offsetY: -38, rotation: 11, scale: 1.24, opacity: 1 },
        tape: { offsetX: -27, offsetY: 19, rotation: -8, scale: 0.82, opacity: 0.63 },
      },
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.primitiveTransforms?.paper?.offsetX).toBe(64)
  })

  it('rejects transforms outside the deterministic bounds', async () => {
    const { authoringRenderRequestSchema } = await import('@/lib/creative/authoring/render-request')
    const manifest = deriveManifestFromState(createInitialAuthoringState())
    const result = authoringRenderRequestSchema.safeParse({
      manifest,
      primitiveTransforms: { paper: { offsetX: 999, offsetY: 0, rotation: 0, scale: 1, opacity: 1 } },
    })
    expect(result.success).toBe(false)
  })
})
