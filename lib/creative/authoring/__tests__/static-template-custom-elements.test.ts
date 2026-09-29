import { describe, expect, it } from 'vitest'
import {
  authoringStateToPersistedSlide,
  persistedSlideToAuthoringState,
  type PersistedAuthoredSlide,
} from '../carousel-state'
import {
  deriveManifestFromState,
  resolvePreviewInput,
} from '../authoring-state'
import { createFreeScene, addFreeTextElement, addFreeImageElement, freeElements } from '@/lib/creative/video-editor/free-composition'
import type { AuthoringProductContext, AuthoringState } from '../types'

const dummyContext: AuthoringProductContext = {
  projectId: 'test-project',
  projectName: 'Test Project',
  productionId: 'test-production',
  productionTitle: 'Test Production',
  channelPieceId: 'test-piece',
  editorialContentId: 'test-editorial',
  editorialContentTitle: 'Test Editorial',
  channel: 'instagram',
  format: 'feed',
  projectIdentity: {} as any,
  identitySnapshot: {
    schema_version: 'visual-tokens.v0',
    snapshot_ref: 'fixture:identity:comunidades-alternativas:v1',
    typography: { display: { family: 'Display', weight: 700, style: 'normal' }, body: { family: 'Body', weight: 400, style: 'normal' } },
    colors: { background: '#000', foreground: '#FFF' },
    spacing: { unit: 8 },
  },
}

describe('STATIC_TEMPLATE_CUSTOM_ELEMENTS_V1', () => {

  it('1. legacy Template slide without custom elements is preserved untouched', () => {
    const state: AuthoringState = {
      variant: 'cover',
      identity: 'a',
      canvas: 'portrait',
      appearance: 'dark',
      contentOverride: { eyebrow: 'E', title: 'T', subtitle: 'S', source_line: 'src' },
      primitiveSelection: {},
      primitiveTransforms: { paper: {}, tape: {} } as any,
      tuning: { hero: { offsetX: 0, offsetY: 0, rotation: 0, scale: 1 }, title: { offsetX: 0, offsetY: 0, rotation: 0 }, source: { offsetX: 0, offsetY: 0, rotation: 0 } },
      productContext: dummyContext,
      debugPanelOpen: false,
    }

    const persisted = authoringStateToPersistedSlide(state, 'slide-1', 0)
    expect(persisted.elements).toBeUndefined()

    const manifest = deriveManifestFromState(state)
    expect(manifest.elements).toBeUndefined()

    const preview = resolvePreviewInput(state)
    expect(preview.manifest.elements).toBeUndefined()
  })

  it('2. custom elements translate into persisted shape and manifest overlays', () => {
    // create a free scene to get some elements easily via existing free-composition API
    let freeScene = createFreeScene(0, 'scene-1', 5)
    freeScene = addFreeTextElement(freeScene, 'elem-text-1')
    freeScene = addFreeImageElement(freeScene, 'elem-image-1', 'lib-file-123')

    const elements = freeElements(freeScene)

    const state: AuthoringState = {
      variant: 'cover',
      identity: 'a',
      canvas: 'portrait',
      appearance: 'dark',
      contentOverride: { eyebrow: 'E', title: 'T', subtitle: 'S', source_line: 'src' },
      primitiveSelection: {},
      primitiveTransforms: { paper: {}, tape: {} } as any,
      tuning: { hero: { offsetX: 0, offsetY: 0, rotation: 0, scale: 1 }, title: { offsetX: 0, offsetY: 0, rotation: 0 }, source: { offsetX: 0, offsetY: 0, rotation: 0 } },
      productContext: dummyContext,
      debugPanelOpen: false,
      elements,
    }

    const persisted = authoringStateToPersistedSlide(state, 'slide-1', 0)
    expect(persisted.elements).toBeDefined()
    expect(persisted.elements?.length).toBe(2)
    expect(persisted.elements?.[0].id).toBe('elem-text-1')
    expect(persisted.elements?.[1].id).toBe('elem-image-1')

    // test reload
    const reloaded = persistedSlideToAuthoringState(persisted, dummyContext, 'portrait')
    expect(reloaded.elements).toBeDefined()
    expect(reloaded.elements?.length).toBe(2)
    expect(reloaded.elements?.[0].id).toBe('elem-text-1')
    
    // test manifest
    const manifest = deriveManifestFromState(state)
    expect(manifest.elements).toBeDefined()
    expect(manifest.elements?.length).toBe(2)
    expect(manifest.elements?.[0].element_id).toBe('elem-text-1') // payload shape uses element_id
    expect(manifest.elements?.[1].element_id).toBe('elem-image-1')

    // test asset injection
    expect(manifest.assets).toBeDefined()
    expect(manifest.assets['library_file:lib-file-123']).toMatchObject({
      type: 'library_file',
      ref: 'lib-file-123',
    })
  })
})