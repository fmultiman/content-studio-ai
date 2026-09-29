import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// The still composition only needs Remotion's <Img> and delayRender handles to
// exist; the boundaries release in effects, which server rendering never runs.
vi.mock('remotion', () => ({
  Img: (props: { src: string; alt?: string }) => createElement('img', props),
  delayRender: () => 1,
  continueRender: () => undefined,
  cancelRender: () => undefined,
  useCurrentFrame: () => 0,
  useVideoConfig: () => ({ width: 1080, height: 1350, fps: 30, durationInFrames: 1 }),
}))

import { StaticRenderManifestStillComposition } from '@/remotion/DocumentaryCardComposition'
import { createInitialAuthoringState, deriveManifestFromState } from '../authoring-state'
import { addFreeImageElement, addFreeTextElement, createFreeScene, freeElements } from '@/lib/creative/video-editor/free-composition'
import { buildStaticRenderExecutionSnapshot } from '@/lib/render-execution/static-snapshot'
import { resolveStaticRuntimeInput } from '@/lib/render-execution/resolve-static-runtime-input'
import { IDENTITY_FIXTURES } from '@/lib/creative/identity/fixtures'
import { FreeStage } from '@/components/creative/free/free-stage'
import type { AuthoringState } from '../types'

const LIB_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const SIGNED = 'https://signed.example/u/p/img.jpg'

async function resolveTemplateStill(state: AuthoringState) {
  const snapshot = buildStaticRenderExecutionSnapshot({ manifest: deriveManifestFromState(state), identitySnapshot: IDENTITY_FIXTURES[0], slide: null })
  const result = await resolveStaticRuntimeInput({
    rawSnapshot: JSON.parse(JSON.stringify(snapshot)),
    libraryFiles: [{ id: LIB_ID, storage_path: 'u/p/img.jpg', deleted_at: null }],
    createPresignedReadUrl: async () => SIGNED,
  })
  if (!result.ok) throw new Error(`claim-time resolution failed: ${result.code}`)
  return result.staticInput.resolvedInput
}

describe('STATIC_TEMPLATE_CUSTOM_ELEMENTS_V1 — the still RENDER draws the custom overlay', () => {
  it('Template base + Custom Text + Custom Image are all in the rendered still, overlay above the base', async () => {
    let scene = createFreeScene(0, 'scene-1', 5)
    scene = addFreeTextElement(scene, 'elem-text-1')
    scene = addFreeImageElement(scene, 'elem-image-1', LIB_ID)
    const withElements = await resolveTemplateStill({ ...createInitialAuthoringState('cover'), elements: freeElements(scene) })
    const legacy = await resolveTemplateStill(createInitialAuthoringState('cover'))

    const legacyMarkup = renderToStaticMarkup(createElement(StaticRenderManifestStillComposition, { resolvedInput: legacy }))
    const markup = renderToStaticMarkup(createElement(StaticRenderManifestStillComposition, { resolvedInput: withElements }))

    // Custom Text + Custom Image are drawn, the image from the claim-time presigned URL.
    expect(markup).toContain('data-free-element="elem-text-1"')
    expect(markup).toContain('data-free-kind="text"')
    expect(markup).toContain('data-free-element="elem-image-1"')
    expect(markup).toContain(`src="${SIGNED}"`)
    // Exactly one image element (no duplicate rendering).
    expect(markup.match(/data-free-element="elem-image-1"/g)).toHaveLength(1)

    // The Template base is still there, byte-identical, and painted BEFORE the overlay.
    const baseOnly = legacyMarkup.replace(/^<style[\s\S]*?<\/style>/, '')
    expect(baseOnly.length).toBeGreaterThan(200)
    expect(markup).toContain(baseOnly)
    expect(markup.indexOf(baseOnly)).toBeLessThan(markup.indexOf('data-kind="template-custom-elements"'))

    // The overlay is a transparent plane — it must never blank the Template base.
    expect(markup).toMatch(/data-kind="template-custom-elements"/)
    expect(markup).toMatch(/background:transparent[^"]*"[^>]*data-kind="template-custom-elements"/)
  })

  it('a Template still with ZERO custom elements renders no overlay wrapper (legacy tree unchanged)', async () => {
    const legacy = await resolveTemplateStill(createInitialAuthoringState('cover'))
    const markup = renderToStaticMarkup(createElement(StaticRenderManifestStillComposition, { resolvedInput: legacy }))
    expect(markup).not.toContain('template-custom-elements')
    expect(markup).not.toContain('data-custom-elements-overlay')
    expect(markup).not.toContain('data-free-element')
  })

  it('FreeStage stays an opaque canvas by default (Free/Video unchanged) and is transparent only as an overlay', async () => {
    const resolved = await resolveTemplateStill(createInitialAuthoringState('cover'))
    const props = { elements: [], width: 1080, height: 1350, tokens: resolved.tokens, imageUrl: () => undefined, ImageComponent: () => null }
    expect(renderToStaticMarkup(createElement(FreeStage, props))).not.toContain('background:transparent')
    expect(renderToStaticMarkup(createElement(FreeStage, { ...props, overlay: true }))).toContain('background:transparent')
  })
})
