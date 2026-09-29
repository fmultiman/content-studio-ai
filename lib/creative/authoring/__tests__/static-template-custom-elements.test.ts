import { describe, expect, it } from 'vitest'
import {
  authoringStateToPersistedSlide,
  persistedSlideToAuthoringState,
} from '../carousel-state'
import {
  createInitialAuthoringState,
  deriveManifestFromState,
  resolvePreviewInput,
} from '../authoring-state'
import { createFreeScene, addFreeTextElement, addFreeImageElement, freeElements } from '@/lib/creative/video-editor/free-composition'
import type { AuthoringState } from '../types'
import { buildStaticRenderExecutionSnapshot } from '@/lib/render-execution/static-snapshot'
import { resolveStaticRuntimeInput } from '@/lib/render-execution/resolve-static-runtime-input'
import { IDENTITY_FIXTURES } from '@/lib/creative/identity/fixtures'

// Real fixture identity that passes typography resolution at claim time.
const identitySnapshot = IDENTITY_FIXTURES[0]

function makeState(extra: Partial<AuthoringState> = {}): AuthoringState {
  return { ...createInitialAuthoringState('cover'), ...extra }
}

describe('STATIC_TEMPLATE_CUSTOM_ELEMENTS_V1', () => {

  it('1. legacy Template slide without custom elements is preserved untouched', () => {
    const state = makeState()

    const persisted = authoringStateToPersistedSlide(state, 'slide-1', 0)
    expect(persisted.elements).toBeUndefined()

    const manifest = deriveManifestFromState(state)
    expect(manifest.elements).toBeUndefined()

    const preview = resolvePreviewInput(state)
    expect(preview.manifest.elements).toBeUndefined()
  })

  it('2. custom elements translate into persisted shape and manifest overlays', () => {
    let freeScene = createFreeScene(0, 'scene-1', 5)
    freeScene = addFreeTextElement(freeScene, 'elem-text-1')
    freeScene = addFreeImageElement(freeScene, 'elem-image-1', 'lib-file-123')

    const state = makeState({ elements: freeElements(freeScene) })

    const persisted = authoringStateToPersistedSlide(state, 'slide-1', 0)
    expect(persisted.elements).toBeDefined()
    expect(persisted.elements?.length).toBe(2)
    expect(persisted.elements?.[0].id).toBe('elem-text-1')
    expect(persisted.elements?.[1].id).toBe('elem-image-1')

    // save/reload round-trip: authored state never contains resolved/signed URL
    const reloaded = persistedSlideToAuthoringState(persisted, {
      projectId: 'p', projectName: 'P', productionId: null, productionTitle: null,
      channelPieceId: 'cp', editorialContentId: 'ec', editorialContentTitle: 'EC',
      channel: 'instagram', format: 'feed', projectIdentity: {} as any,
      identitySnapshot,
    }, 'portrait')
    expect(reloaded.elements).toBeDefined()
    expect(reloaded.elements?.length).toBe(2)
    expect(reloaded.elements?.[0].id).toBe('elem-text-1')

    // manifest carries elements in FreeSegmentPayload shape (element_id, not id)
    const manifest = deriveManifestFromState(state)
    expect(manifest.elements).toBeDefined()
    expect(manifest.elements?.length).toBe(2)
    expect(manifest.elements?.[0].element_id).toBe('elem-text-1')
    expect(manifest.elements?.[1].element_id).toBe('elem-image-1')

    // manifest.assets contains the library_file ref for images — semantic role only, no signed URL
    const customImageAsset = manifest.assets['library_file:lib-file-123']
    expect(customImageAsset).toMatchObject({ type: 'library_file', ref: 'lib-file-123' })
    expect(JSON.stringify(customImageAsset)).not.toContain('https://')
  })

  it('3. worker claim-time: custom image library_file assets are presigned for template stills (P0 fix)', async () => {
    const LIB_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    let freeScene = createFreeScene(0, 'scene-1', 5)
    freeScene = addFreeImageElement(freeScene, 'elem-image-1', LIB_ID)

    const state = makeState({ elements: freeElements(freeScene) })
    const manifest = deriveManifestFromState(state)

    // The library_file asset key must be present with no signed URL
    const assetKey = `library_file:${LIB_ID}`
    expect(manifest.assets[assetKey]).toMatchObject({ type: 'library_file', ref: LIB_ID })
    expect(JSON.stringify(manifest.assets[assetKey])).not.toContain('https://')

    const snapshot = buildStaticRenderExecutionSnapshot({
      manifest,
      identitySnapshot,
      slide: null,
    })

    // Happy path: claim-time presigns the asset and it appears in resolvedAssets
    const ok = await resolveStaticRuntimeInput({
      rawSnapshot: JSON.parse(JSON.stringify(snapshot)),
      libraryFiles: [{ id: LIB_ID, storage_path: 'u/p/img.jpg', deleted_at: null }],
      createPresignedReadUrl: async (storagePath) => `https://signed.example/${storagePath}`,
    })
    if (!ok.ok) throw new Error(`Expected ok=true but got: code=${(ok as any).code} message=${(ok as any).message}`)
    expect(ok.staticInput.resolvedInput.resolvedAssets[assetKey]?.url)
      .toBe('https://signed.example/u/p/img.jpg')

    // The original manifest/snapshot is never mutated with signed URLs
    expect(JSON.stringify(snapshot)).not.toContain('https://')

    // Missing file returns specific error code (not silent broken URL)
    const missing = await resolveStaticRuntimeInput({
      rawSnapshot: JSON.parse(JSON.stringify(snapshot)),
      libraryFiles: [],
      createPresignedReadUrl: async () => 'x',
    })
    expect(missing).toMatchObject({ ok: false, code: 'CUSTOM_IMAGE_UNAVAILABLE' })
  })
})
