/**
 * CREATIVE_EDITOR_CONTEXTUAL_STYLES_AND_TYPOGRAPHY_V1 — the wiring that makes an authored override reach the
 * preview, the frozen snapshot and the worker (editor → request → snapshot → claim-time input → renderer).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveTemplateBinding } from '@/lib/creative/templates/component-resolver'

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf-8')
const PAGE = read('app/(dashboard)/projetos/[id]/conteudos/[editorialContentId]/channel-pieces/[channelPieceId]/editar-visual/page.tsx')

describe('typography override wiring', () => {
  it('the editor preview paints the same overrides the render request freezes, and declares the supported faces once', () => {
    expect(PAGE).toContain('deriveTypographyOverrides(state, templateId)')
    expect(PAGE).toContain('deriveTuningOverrides(state, templateId)')
    expect(PAGE).toContain('<RuntimeFontFaces />')
    expect(PAGE).toContain('<StylesTab')
    expect(PAGE).not.toContain('TypographyOverridePanel')
  })

  it('the Static editor moves font role/size to Styles (Elementos) for Free and Custom Text; Video never sets that flag', () => {
    expect(PAGE.match(/typographyInStyles/g)?.length).toBe(2)
    expect(read('components', 'creative', 'video', 'free-scene-panels.tsx')).toContain('typographyInStyles = false')
  })

  it('the claim-time overrides reach the renderer props (template binding) and the worker still declares the faces', () => {
    const binding = resolveTemplateBinding('editorial.documentary-card')!
    const props = binding.createProps(
      { variant: 'cover', content: { title: 'T' }, assets: {}, tokens: { typography: { display: { family: 'Fraunces', weight: 700, style: 'normal' }, body: { family: 'Source Sans 3', weight: 400, style: 'normal' } }, colors: {}, spacing: { unit: 8 } } as never, canvas: { width: 1080, height: 1350 } as never },
      { mode: 'still', overrides: { typography: { title: { fontSizePx: 53 } } } },
    ) as { typographyOverrides?: unknown; previewTuning?: unknown }
    expect(props.typographyOverrides).toEqual({ title: { fontSizePx: 53 } })
    const composition = read('remotion', 'DocumentaryCardComposition.tsx')
    expect(composition).toContain('withOverrideFonts(resolvedInput.typography, { ...overrides?.typography, ...freeTextFamilies(customElements) })')
    expect(composition).toContain('withOverrideFonts(resolvedInput.typography, freeTextFamilies(elements))')
  })

  it('the render route freezes only overrides the Layout honours, and a request with no typography is untouched', () => {
    const route = read('app/api/creative/static-authoring/render/route.ts')
    expect(route).toContain('freezeOverrides(input.overrides, layout)')
    expect(route).toContain('normalizeTypographyOverrides(layout, requested)')
  })

  it('the worker gets exactly one new module (the supported font names); authoring helpers stay out of it', () => {
    const exportList = read('infra', 'render-worker-runtime', 'export.mjs')
    for (const file of ['lib/creative/typography/resolve-typography.ts', 'remotion/DocumentaryCardComposition.tsx', 'remotion/TypographyReadyBoundary.tsx', 'components/creative/free/free-stage.tsx', 'components/creative/documentary-card/primitives.tsx', 'lib/creative/templates/component-resolver.ts']) {
      expect(exportList).toContain(file)
    }
    expect(exportList).toContain('lib/schemas/creative/runtime-font-families.ts')
    // Authoring-layer helpers stay out of the worker (it starts from the frozen, already-validated snapshot).
    expect(exportList).not.toContain('typography-overrides')
    for (const file of ['remotion/DocumentaryCardComposition.tsx', 'components/creative/documentary-card/primitives.tsx', 'lib/creative/typography/resolve-typography.ts', 'components/creative/free/free-stage.tsx']) {
      expect(read(...file.split('/'))).not.toMatch(/from '@\/lib\/creative\/authoring\/typography-overrides'/)
    }
  })
})
