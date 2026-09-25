/**
 * Creative Editor Template Foundation V1 — Template registry, element stack
 * normalization, asset slots and the frozen render contract.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_TEMPLATE_ID,
  EDITORIAL_DOCUMENTARY_COLLAGE_TEMPLATE,
  ELEMENT_TRANSFORM_KEYS,
  getTemplateDefinition,
  getTemplateLayout,
  isAppearanceSupported,
  layoutAssetSlots,
  listTemplateDefinitions,
  resolveAuthoringTemplate,
} from '../template-definitions'
import { elementStackFromOrder, isDefaultElementOrder, moveElementInOrder, normalizeElementOrder, resolveElementStack } from '../element-stack'
import { materialUrl } from '@/components/creative/documentary-card/primitives'
import { authoringRenderRequestSchema } from '@/lib/creative/authoring/render-request'
import { buildStaticRenderExecutionSnapshot, parseStaticRenderExecutionSnapshot } from '@/lib/render-execution/static-snapshot'
import { resolveStaticRuntimeInput } from '@/lib/render-execution/resolve-static-runtime-input'
import { createInitialAuthoringState, deriveManifestFromState } from '@/lib/creative/authoring/authoring-state'
import { IDENTITY_FIXTURES } from '@/lib/creative/identity/fixtures'

const template = EDITORIAL_DOCUMENTARY_COLLAGE_TEMPLATE
const cover = getTemplateLayout(template, 'cover')!
const info = getTemplateLayout(template, 'info')!

describe('Template registry', () => {
  it('registers the first platform Template with a project-neutral id', () => {
    expect(DEFAULT_TEMPLATE_ID).toBe('editorial-documentary-collage-v1')
    expect(getTemplateDefinition(DEFAULT_TEMPLATE_ID)?.name).toBe('Editorial Documentary Collage')
    expect(listTemplateDefinitions().map((definition) => definition.id)).toEqual([DEFAULT_TEMPLATE_ID])
    expect(DEFAULT_TEMPLATE_ID).not.toMatch(/portal|comunidades/i)
  })

  it('is code-backed by the DocumentaryCard renderer identity', () => {
    expect(template.renderer).toEqual({ componentKey: 'editorial.documentary-card', templateRef: { id: 'editorial.documentary-card', version: '0.1.0', scope: 'system' } })
  })

  it('owns its layouts (Cover, Info, Lista + Completion V1) as template-scoped layouts', () => {
    expect(template.layouts.map((layout) => layout.id)).toEqual(['cover', 'info', 'list', 'grid', 'map', 'network', 'quote', 'closing'])
    expect(getTemplateLayout(template, 'gallery')).toBeNull()
    expect(getTemplateLayout(template, 'timeline')).toBeNull()
  })

  it('exposes Template family anatomy from registry metadata separately from layout anatomy', () => {
    expect(template.anatomy.map((region) => region.id)).toEqual(['editorial-content', 'content-image', 'collage-materials', 'source-credit'])
    expect(template.anatomy.every((region) => region.label && region.description)).toBe(true)
    expect(template.anatomy.map((region) => region.label)).not.toEqual(cover.elements.map((element) => element.label))
  })

  it('treats appearance as an axis of a layout, not a template', () => {
    expect(isAppearanceSupported(template, 'cover', 'dark')).toBe(true)
    expect(isAppearanceSupported(template, 'cover', 'light')).toBe(true)
    expect(isAppearanceSupported(template, 'info', 'light')).toBe(true)
    expect(isAppearanceSupported(template, 'info', 'sepia')).toBe(false)
    expect(isAppearanceSupported(template, 'gallery', 'light')).toBe(false)
    expect(cover.defaultAppearance).toBe('dark')
    expect(info.defaultAppearance).toBe('light')
  })

  it('resolves legacy (missing) templateIds to the first Template and falls back safely on unknown ids', () => {
    expect(resolveAuthoringTemplate(undefined)).toEqual({ template, fallback: false })
    expect(resolveAuthoringTemplate(null)).toEqual({ template, fallback: false })
    expect(resolveAuthoringTemplate('editorial-documentary-collage-v1')).toEqual({ template, fallback: false })
    expect(resolveAuthoringTemplate('some-future-template')).toEqual({ template, fallback: true })
    expect(getTemplateDefinition('some-future-template')).toBeNull()
  })

  it('declares every layout element exactly once in its default stack', () => {
    for (const layout of template.layouts) {
      const ids = layout.elements.map((element) => element.id)
      expect(new Set(ids).size).toBe(ids.length)
      expect([...layout.defaultStackOrder].sort()).toEqual([...ids].sort())
    }
  })

  it('never exposes raw element ids as product labels', () => {
    for (const layout of template.layouts) {
      for (const element of layout.elements) {
        expect(element.label).not.toMatch(/^(tape|pin|card)\d$/)
        expect(element.label).not.toBe(element.id)
      }
    }
  })

  it('backs every transform-controlled element with a known persisted channel', () => {
    for (const layout of template.layouts) {
      for (const element of layout.elements) {
        if (element.control.type === 'transform') expect(ELEMENT_TRANSFORM_KEYS).toContain(element.control.key)
      }
    }
  })
})

describe('Asset slots', () => {
  it('lets several elements share one slot (all tapes use the tape slot)', () => {
    const tape = layoutAssetSlots(template, info).find(({ slot }) => slot.id === 'tape')
    expect(tape?.elements.map((element) => element.id)).toEqual(['tape1', 'tape2', 'tape3'])
    expect(tape?.slot.defaultAsset.key).toBe('tape-kraft-short-01')
  })

  it('keeps distinct slots independent (Cartão 1 dark paper vs Cartão 2 light paper)', () => {
    const slots = layoutAssetSlots(template, info)
    expect(slots.find(({ slot }) => slot.id === 'paperDark')?.elements.map((element) => element.id)).toEqual(['paperDark', 'card1'])
    expect(slots.find(({ slot }) => slot.id === 'paper')?.elements.map((element) => element.id)).toEqual(['paper'])
  })

  it('selects slot files: template defaults unless a Project primitive fills the slot', () => {
    expect(materialUrl('ornament')).toBe('/creative-fixtures/pack-b/ornament-celestial-gold-01.png')
    expect(materialUrl('paperDark', '/public/creative-fixtures')).toBe('/public/creative-fixtures/pack-b/paper-card-dark-01.png')
    expect(materialUrl('tape', undefined, { tape: 'https://signed.example/tape.png' })).toBe('https://signed.example/tape.png')
    expect(materialUrl('ornament', undefined, { tape: 'https://signed.example/tape.png' })).toBe('/creative-fixtures/pack-b/ornament-celestial-gold-01.png')
  })

  it('marks only paper and tape as Project-selectable (the uploaded Portal LibraryFiles)', () => {
    const selectable = Object.values(template.assetSlots).filter((slot) => slot.projectCategory).map((slot) => slot.id)
    expect(selectable).toEqual(['paper', 'tape'])
  })
})

describe('normalizeElementOrder', () => {
  it('missing / non-array → template default', () => {
    expect(normalizeElementOrder(cover, undefined)).toEqual([...cover.defaultStackOrder])
    expect(normalizeElementOrder(cover, 'hero')).toEqual([...cover.defaultStackOrder])
    expect(normalizeElementOrder(cover, [])).toEqual([...cover.defaultStackOrder])
  })

  it('keeps a complete authored order as-is', () => {
    const authored = [...cover.defaultStackOrder].reverse()
    expect(normalizeElementOrder(cover, authored)).toEqual(authored)
  })

  it('drops duplicates (first wins) and unknown ids', () => {
    const order = normalizeElementOrder(cover, ['title', 'title', 'ghost', 42, 'hero'])
    expect(new Set(order).size).toBe(order.length)
    expect(order).not.toContain('ghost')
    expect(order.indexOf('title')).toBeLessThan(order.indexOf('hero'))
  })

  it('inserts an element the template gained later right after its default-order predecessor', () => {
    // Persisted before `note` existed: note must land after tape1 (its default predecessor).
    const legacy = cover.defaultStackOrder.filter((id) => id !== 'note')
    const order = normalizeElementOrder(cover, legacy)
    expect(order.indexOf('note')).toBe(order.indexOf('tape1') + 1)
    expect(order).toHaveLength(cover.defaultStackOrder.length)
    // Deterministic.
    expect(normalizeElementOrder(cover, legacy)).toEqual(order)
  })

  it('puts a gained element with no present predecessor at the back', () => {
    const order = normalizeElementOrder(cover, cover.defaultStackOrder.filter((id) => id !== 'ornament'))
    expect(order[0]).toBe('ornament')
  })

  it('reports default vs authored stacks', () => {
    expect(isDefaultElementOrder(cover, [...cover.defaultStackOrder])).toBe(true)
    expect(isDefaultElementOrder(cover, moveElementInOrder(cover.defaultStackOrder, 0, 1))).toBe(false)
  })

  it('maps paint order to strictly increasing z-index back → front', () => {
    const stack = elementStackFromOrder(['a', 'b', 'c'])
    expect(stack.zIndex.a).toBeLessThan(stack.zIndex.b)
    expect(stack.zIndex.b).toBeLessThan(stack.zIndex.c)
  })

  it('resolveElementStack is layout-scoped and tolerant of unknown templates/layouts', () => {
    expect(resolveElementStack(undefined, 'info', undefined).order).toEqual([...info.defaultStackOrder])
    expect(resolveElementStack('unknown-template', 'cover', undefined).order).toEqual([])
    expect(resolveElementStack(DEFAULT_TEMPLATE_ID, 'gallery', undefined).order).toEqual([])
  })

  it('moveElementInOrder moves one element and ignores out-of-range moves', () => {
    expect(moveElementInOrder(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
    expect(moveElementInOrder(['a', 'b', 'c'], 0, 5)).toEqual(['a', 'b', 'c'])
  })
})

describe('Render contract — frozen template + stack + asset identity', () => {
  const tokens = { value: IDENTITY_FIXTURES[0] }
  const manifest = deriveManifestFromState(createInitialAuthoringState('cover'), { index: 1, total: 2 })
  const frozenPaper = { libraryFileId: 'afa6868e-a2d6-473d-9df7-bbf713ad8b02', mimeType: 'image/png' as const, width: 1254, height: 1254, checksum: '169da9d67c85ff7ca741313849dd43df7df48c4b2609dcc91b8804236ac9bdd5', version: '0.1.0' }

  it('accepts templateId + elementOrder on the render request and rejects an unknown template', () => {
    const base = { manifest, elementOrder: [...cover.defaultStackOrder] }
    expect(authoringRenderRequestSchema.safeParse({ ...base, templateId: DEFAULT_TEMPLATE_ID }).success).toBe(true)
    expect(authoringRenderRequestSchema.safeParse({ ...base, templateId: 'nope' }).success).toBe(false)
  })

  it('freezes the normalized order in the snapshot; later edits to the source array cannot change it', () => {
    const order = normalizeElementOrder(cover, ['tape1', 'hero'])
    const snapshot = buildStaticRenderExecutionSnapshot({ manifest, identitySnapshot: tokens.value, templateId: DEFAULT_TEMPLATE_ID, elementOrder: order, slide: { id: 'slide-1', index: 1, total: 2 } })
    order.reverse()
    expect(snapshot.elementOrder).toEqual(normalizeElementOrder(cover, ['tape1', 'hero']))
    const parsed = parseStaticRenderExecutionSnapshot(JSON.parse(JSON.stringify(snapshot)))
    expect(parsed.ok && parsed.snapshot.templateId).toBe(DEFAULT_TEMPLATE_ID)
  })

  it('still parses snapshots frozen before templateId/elementOrder existed', () => {
    const legacy = buildStaticRenderExecutionSnapshot({ manifest, identitySnapshot: tokens.value, slide: null })
    expect(parseStaticRenderExecutionSnapshot(JSON.parse(JSON.stringify(legacy))).ok).toBe(true)
  })

  it('claim-time resolution refreshes URLs but never changes the frozen LibraryFile identity or stack', async () => {
    const order = [...cover.defaultStackOrder].reverse()
    const snapshot = JSON.parse(JSON.stringify(buildStaticRenderExecutionSnapshot({ manifest, identitySnapshot: tokens.value, primitiveAssets: { paper: frozenPaper }, templateId: DEFAULT_TEMPLATE_ID, elementOrder: order, slide: null })))
    const files = [
      { id: frozenPaper.libraryFileId, storage_path: 'users/u/library/paper-card-light-01.png', deleted_at: null },
      // A newer same-name file in the project must never be picked instead.
      { id: '11111111-1111-4111-8111-111111111111', storage_path: 'users/u/library/paper-card-light-02.png', deleted_at: null },
    ]
    const first = await resolveStaticRuntimeInput({ rawSnapshot: snapshot, libraryFiles: files, createPresignedReadUrl: async (path) => `https://signed.example/${path}?t=1` })
    const second = await resolveStaticRuntimeInput({ rawSnapshot: snapshot, libraryFiles: files, createPresignedReadUrl: async (path) => `https://signed.example/${path}?t=2` })
    if (!first.ok || !second.ok) throw new Error('resolution failed')
    expect(first.staticInput.primitiveMaterials?.paper?.ref).toBe(frozenPaper.libraryFileId)
    expect(second.staticInput.primitiveMaterials?.paper?.ref).toBe(frozenPaper.libraryFileId)
    expect(first.staticInput.primitiveMaterials?.paper?.url).not.toBe(second.staticInput.primitiveMaterials?.paper?.url)
    expect(first.staticInput.elementOrder).toEqual(order)
    expect(first.staticInput.templateId).toBe(DEFAULT_TEMPLATE_ID)
  })
})

describe('Preview / worker parity wiring (one normalizer, one renderer)', () => {
  const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf-8')
  const page = read('app', '(dashboard)', 'projetos', '[id]', 'conteudos', '[editorialContentId]', 'channel-pieces', '[channelPieceId]', 'editar-visual', 'page.tsx')

  it('DocumentaryCard normalizes the stack itself (so preview and renderStill share it)', () => {
    expect(read('components', 'creative', 'documentary-card', 'DocumentaryCard.tsx')).toMatch(/const stack = resolveElementStack\(templateId, variant, elementOrder\)/)
  })

  it('the Editor preview passes the slide templateId + elementOrder to DocumentaryCard', () => {
    expect(page).toMatch(/templateId, elementOrder: state\.elementOrder, hiddenElements: deriveHiddenElementsRequest\(state, templateId\)/)
  })

  it('Gerar PNG sends the full normalized order and templateId', () => {
    expect(page).toMatch(/templateId,\s*\n\s*elementOrder: deriveElementOrderRequest\(state, templateId\),/)
  })

  it('the enqueue route re-normalizes and freezes the order into the snapshot', () => {
    const route = read('app', 'api', 'creative', 'static-authoring', 'render', 'route.ts')
    expect(route).toMatch(/const elementOrder = normalizeElementOrder\(layout, input\.elementOrder\)/)
    expect(route).toMatch(/templateId,\s*\n\s*elementOrder,\s*\n\s*hiddenElements,\s*\n\s*assetOverrides,\s*\n\s*slide,/)
    expect(route).toMatch(/template\.renderer\.templateRef\.id !== input\.manifest\.template\.id/)
  })

  it('the worker composition forwards templateId + elementOrder to the same binding', () => {
    expect(read('infra', 'render-worker-runtime', 'server.mjs')).toMatch(/templateId: staticInput\.templateId,\s*\n\s*elementOrder: staticInput\.elementOrder,/)
    expect(read('remotion', 'DocumentaryCardComposition.tsx')).toMatch(/templateId,\s*\n\s*elementOrder,\s*\n\s*hiddenElements,\s*\n\s*\}, \{ mode: 'still', overrides \}\)/)
  })

  it('the exported worker ships the registry modules and every Pack B slot asset', () => {
    const exporter = read('infra', 'render-worker-runtime', 'export.mjs')
    expect(exporter).toContain("'lib/creative/templates/template-definitions.ts'")
    expect(exporter).toContain("'lib/creative/templates/element-stack.ts'")
    for (const slot of Object.values(template.assetSlots)) {
      expect(exporter).toContain(`'public/creative-fixtures/${slot.defaultAsset.path}'`)
    }
  })
})
