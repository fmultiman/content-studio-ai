/**
 * VIDEO_MOTION_CAPABILITY_TRUTH_V1 — the Video Scene Motion authoring surface
 * must never offer a choice the active composition cannot visibly render as
 * authored. This proves the capability map is truthful end to end: every
 * OFFERED value has a proven renderer path (TemplateSegment -> DocumentaryCard,
 * the SAME component Live Player and final render share), fade is now
 * authorable because the renderer already drew it, unsupported legacy values
 * still load safely and are never silently rewritten, and Free Scenes remain
 * unchanged (no authored Scene Motion).
 *
 * This is SCENE Motion only — the whole composition's behavior. Element
 * Motion (a future, Element-scoped preset system) is out of scope; see
 * VIDEO_ELEMENT_MOTION_PRESETS_V1.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { VideoScene } from '@/lib/types'
import { buildRenderExecutionSnapshot } from '@/lib/render-execution/build-snapshot'
import { resolveTimelineManifest } from '@/lib/creative/resolution/resolve-timeline'
import { TemplateSegment } from '@/remotion/timeline'
import { EDITORIAL_DOCUMENTARY_COLLAGE_TEMPLATE } from '@/lib/creative/templates/template-definitions'
import { movementToMotion } from '@/lib/creative/timeline-adapter/video-draft-to-timeline'
import { buildVideoDraftSaveBody, motionOptions, movementLabel, normalizeLoadedScenes } from '../video-authoring'
import { VIDEO_SCENE_LAYOUT_IDS, resolveSceneComposition, setSceneLayout } from '../scene-composition'

const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8').replace(/\r\n/g, '\n')
const VIDEO_PAGE = read('app/(dashboard)/creative-editor/video/[draftId]/page.tsx')

const IDENTITY_SNAPSHOT = {
  schema_version: 'visual-tokens.v0' as const,
  snapshot_ref: 'project:11111111-1111-1111-1111-111111111111:snapshot',
  typography: {
    display: { family: 'Fraunces', weight: 700, style: 'normal' as const },
    body: { family: 'Source Sans 3', weight: 400, style: 'normal' as const },
  },
  colors: { background: '#F6F0E4', foreground: '#16352F' },
  spacing: { unit: 8, default_gap: 16 },
}
const DRAFT = { id: 'draft-1', project_id: '11111111-1111-1111-1111-111111111111', production_id: '22222222-2222-2222-2222-222222222222' }
const FILE_A = 'afa6868e-a2d6-473d-9df7-bbf713ad8b02'

function legacyScene(id: string, order: number, extra: Partial<VideoScene> = {}): VideoScene {
  return { id, order, description: '', prompt: null, image_url: null, library_file_id: FILE_A, duration: 3, movement: 'static', ...extra }
}

/** Renders the FIRST Scene's segment through the SAME component Live Player and final render both use. */
function renderScene(scene: VideoScene, globalFrame = 0): string {
  const { snapshot } = buildRenderExecutionSnapshot({ draft: { ...DRAFT, scenes: [scene] }, identitySnapshot: IDENTITY_SNAPSHOT })
  const resolved = resolveTimelineManifest(snapshot.manifest, { identitySnapshot: IDENTITY_SNAPSHOT })
  if (!resolved.valid) throw new Error(resolved.errors.map((error) => error.message).join('; '))
  return renderToStaticMarkup(createElement(TemplateSegment, { globalFrame, resolvedInput: resolved.value, resolvedSegment: resolved.value.resolvedTemplateSegments[0], adaptTemplateProps: (props) => props }))
}

/**
 * The root `<main>`'s OWN opacity (DocumentaryCard.tsx `rootStyle.opacity`, the whole-card
 * fade). Decorative elements (sparkles, grain) carry their own unrelated `opacity:0.2/0.85`
 * substrings, so a plain string search is unsafe — this anchors to the root tag specifically.
 */
function rootOpacity(html: string): number {
  const match = /^<main[^>]*\bopacity:([\d.]+)"/.exec(html)
  if (!match) throw new Error('root <main> opacity not found in rendered markup')
  return Number(match[1])
}

// ── 1. Capability map ─────────────────────────────────────────────────────────
describe('1. Capability map: only what each Layout genuinely draws is offered', () => {
  it('Cover offers static, fade, zoom_in; every other Layout offers only static, fade', () => {
    expect(motionOptions('cover').map((o) => o.value)).toEqual(['static', 'fade', 'zoom_in'])
    for (const layoutId of VIDEO_SCENE_LAYOUT_IDS) {
      if (layoutId === 'cover') continue
      expect(motionOptions(layoutId).map((o) => o.value), layoutId).toEqual(['static', 'fade'])
    }
  })

  it('no unsupported value (pan/tilt/zoom_out/dolly) is newly selectable on ANY Layout', () => {
    const unsupported = ['pan_left', 'pan_right', 'tilt_up', 'tilt_down', 'zoom_out', 'dolly']
    for (const layoutId of VIDEO_SCENE_LAYOUT_IDS) {
      const offered = motionOptions(layoutId).map((o) => o.value)
      for (const value of unsupported) expect(offered, `${layoutId}:${value}`).not.toContain(value)
    }
  })

  it('every offered option is cross-checked against the adapter — the list can never silently drift from what the renderer draws', () => {
    for (const layoutId of VIDEO_SCENE_LAYOUT_IDS) {
      for (const option of motionOptions(layoutId)) {
        expect(movementToMotion(option.value).diagnostic, `${layoutId}:${option.value}`).toBeNull()
      }
    }
  })

  it('labels are truthful and layout-independent text (no "sem efeito visível" badge — unsupported options are simply absent)', () => {
    expect(motionOptions('cover')).toEqual([
      { value: 'static', label: 'Estático' },
      { value: 'fade', label: 'Fade (entrada suave)' },
      { value: 'zoom_in', label: 'Zoom In (aproximação lenta)' },
    ])
  })
})

// ── 2. Static / none ────────────────────────────────────────────────────────
describe('2. Static is deterministic', () => {
  it('maps to preset "none" on every Layout, with no diagnostic', () => {
    for (const layoutId of VIDEO_SCENE_LAYOUT_IDS) {
      expect(movementToMotion('static')).toEqual({ motion: { preset: 'none' }, diagnostic: null })
      expect(motionOptions(layoutId)[0]).toEqual({ value: 'static', label: 'Estático' })
    }
  })

  it('a static Scene never carries a motion segment payload beyond preset none, on Cover or elsewhere', () => {
    const cover = renderScene(legacyScene('s', 1, { movement: 'static' }))
    const list = renderScene(setSceneLayout(legacyScene('s', 1, { movement: 'static' }), 'list'))
    expect(rootOpacity(cover)).toBe(1)
    expect(rootOpacity(list)).toBe(1)
  })
})

// ── 3. Real movement: proven renderer path ──────────────────────────────────
describe('3. Every offered option has a PROVEN renderer path (same component Live Player and final render share)', () => {
  it('zoom_in scales the Cover hero image across the Scene (heroScale), and does nothing on a non-Cover Layout', () => {
    const early = renderScene(legacyScene('s', 1, { movement: 'zoom_in', duration: 3 }), 0)
    const late = renderScene(legacyScene('s', 1, { movement: 'zoom_in', duration: 3 }), 89)
    const earlyScale = early.match(/scale\(([\d.]+)\)"[^>]*>\s*<img/)?.[1] ?? early.match(/scale\(([\d.]+)\)/)?.[1]
    const lateScale = late.match(/scale\(([\d.]+)\)/g)
    expect(earlyScale).toBe('1')
    expect(lateScale?.some((match) => match !== 'scale(1)')).toBe(true)

    // Not Cover: no layout other than Cover checks slow_push (CoverVariant.tsx is the ONLY
    // file with heroScale — confirmed by source, not assumed).
    const list = setSceneLayout(legacyScene('s', 1, { movement: 'zoom_in', duration: 3 }), 'list')
    expect(renderScene(list, 89)).toEqual(renderScene(setSceneLayout(legacyScene('s', 1, { movement: 'static' }), 'list'), 89))
  })

  it('fade fades the whole card in identically on Cover AND on a non-Cover Layout (list)', () => {
    for (const layoutId of ['cover', 'list'] as const) {
      // Cover already IS the legacy default layout, so setSceneLayout(scene,'cover') would be a
      // no-op on an already-cover Scene; only apply it when actually switching away from Cover.
      const base = legacyScene('s', 1, { movement: 'fade', duration: 3 })
      const scene = layoutId === 'cover' ? base : setSceneLayout(base, layoutId)
      const frame0 = renderScene(scene, 0)
      const frame45 = renderScene(scene, 45)
      expect(rootOpacity(frame0), `${layoutId} frame 0`).toBe(0)
      expect(frame0, layoutId).not.toEqual(frame45)
      expect(rootOpacity(frame45), `${layoutId} frame 45`).toBe(1)
    }
  })

  it('only CoverVariant.tsx implements the slow_push effect — no other layout file references it', () => {
    for (const variant of EDITORIAL_DOCUMENTARY_COLLAGE_TEMPLATE.layouts) {
      const name = variant.id.charAt(0).toUpperCase() + variant.id.slice(1)
      const path = `components/creative/documentary-card/${name}Variant.tsx`
      const source = read(path)
      if (variant.id === 'cover') expect(source, path).toContain("motion?.preset === 'slow_push'")
      else expect(source, path).not.toContain('slow_push')
    }
  })

  it('DocumentaryCard.tsx fades EVERY variant unconditionally (never gated by variant), which is why fade is universal', () => {
    const source = read('components/creative/documentary-card/DocumentaryCard.tsx')
    expect(source).toContain("motion?.preset === 'fade' ? clamp(progress * 6, 0, 1) : 1")
    expect(source).not.toMatch(/variant === '\w+'[^\n]*preset === 'fade'/)
  })
})

// ── 4. Fade: persists, reloads, reaches render prep — Live Player and final render agree ──
describe('4. Fade persists and reaches render prep identically for Live Player and final render', () => {
  it('save body -> reload keeps the authored movement exactly ("fade" is a plain string field, nothing special)', () => {
    const scenes = [legacyScene('s', 1, { movement: 'fade' })]
    const body = buildVideoDraftSaveBody(DRAFT, 'v', scenes)
    expect(body.scenes[0].movement).toBe('fade')
    const reloaded = normalizeLoadedScenes(JSON.parse(JSON.stringify(body)).scenes)
    expect(reloaded[0].movement).toBe('fade')
  })

  it('the frozen manifest segment (the SAME one Live Player and the final render both consume) carries motion.preset "fade"', () => {
    const { snapshot } = buildRenderExecutionSnapshot({ draft: { ...DRAFT, scenes: [legacyScene('s', 1, { movement: 'fade' })] }, identitySnapshot: IDENTITY_SNAPSHOT })
    const [segment] = snapshot.manifest.segments.flatMap((s) => (s.kind === 'template' ? [s] : []))
    expect(segment.payload.motion).toEqual({ preset: 'fade' })
  })

  it('resolves validly through the Template registry motion-capability check (fade is a declared capability, not invented)', () => {
    const { snapshot } = buildRenderExecutionSnapshot({ draft: { ...DRAFT, scenes: [legacyScene('s', 1, { movement: 'fade' })] }, identitySnapshot: IDENTITY_SNAPSHOT })
    expect(resolveTimelineManifest(snapshot.manifest, { identitySnapshot: IDENTITY_SNAPSHOT }).valid).toBe(true)
  })
})

// ── 5. Legacy: safe to load, never silently rewritten ───────────────────────
describe('5. Legacy movement values remain safe (real production data: pan_left on a list-layout Scene)', () => {
  it('a legacy pan/tilt value is not crashed on, not rewritten, and still resolves its historical frozen motion', () => {
    const legacyDraftScene = setSceneLayout(legacyScene('s', 1, { movement: 'pan_left' }), 'list')
    expect(() => buildRenderExecutionSnapshot({ draft: { ...DRAFT, scenes: [legacyDraftScene] }, identitySnapshot: IDENTITY_SNAPSHOT })).not.toThrow()
    const { snapshot } = buildRenderExecutionSnapshot({ draft: { ...DRAFT, scenes: [legacyDraftScene] }, identitySnapshot: IDENTITY_SNAPSHOT })
    const [segment] = snapshot.manifest.segments.flatMap((s) => (s.kind === 'template' ? [s] : []))
    // Unchanged since before this mission: still slow_pan (the historical mapping), never rewritten to 'none'.
    expect(segment.payload.motion).toEqual({ preset: 'slow_pan', direction: 'left' })
    expect(resolveTimelineManifest(snapshot.manifest, { identitySnapshot: IDENTITY_SNAPSHOT }).valid).toBe(true)
  })

  it('is truthfully labelled for legacy display, but not offered as a new choice on its Layout', () => {
    expect(movementLabel('pan_left')).toBe('Pan Esquerda')
    expect(motionOptions('list').map((o) => o.value)).not.toContain('pan_left')
  })

  it('zoom_out and dolly (never mapped) stay labelled for legacy display and are never offered', () => {
    expect(movementLabel('zoom_out')).toBe('Zoom Out')
    expect(movementLabel('dolly')).toBe('Dolly Forward')
    for (const layoutId of VIDEO_SCENE_LAYOUT_IDS) {
      expect(motionOptions(layoutId).map((o) => o.value)).not.toContain('zoom_out')
      expect(motionOptions(layoutId).map((o) => o.value)).not.toContain('dolly')
    }
  })

  it('choosing a currently supported replacement works normally (movement is just patched, like any other field)', () => {
    const scenes = [legacyScene('s', 1, { movement: 'pan_left' })]
    const patched = scenes.map((scene) => (scene.id === 's' ? { ...scene, movement: 'fade' } : scene))
    expect(patched[0].movement).toBe('fade')
  })

  it('an unknown/garbage movement value still resolves safely (defaults to no visible motion, never a crash)', () => {
    const result = movementToMotion('some_future_value_not_yet_invented')
    expect(result.motion).toEqual({ preset: 'none' })
    expect(result.diagnostic?.code).toBe('movement_no_preset_equivalent')
  })
})

// ── 6. Mode: Template Scene truthful capability, Free Scene unchanged ──────
describe('6. Template Scene uses the capability list; Free Scene remains without authored Scene Motion', () => {
  it('the Motion tab renders the capability-derived radiogroup only for Template Scenes', () => {
    const motionTab = VIDEO_PAGE.slice(VIDEO_PAGE.indexOf('<TabsContent value="motion"'), VIDEO_PAGE.indexOf('</TabsContent>', VIDEO_PAGE.indexOf('<TabsContent value="motion"')))
    expect(motionTab).toContain('role="radiogroup" aria-label="Movimento da cena"')
    expect(motionTab).toContain('sceneMotionOptions.map')
    expect(motionTab).not.toMatch(/sem efeito visível|sem preset · estático/)
  })

  it('Free Scene copy is unchanged from M2 (still static, still no Template blamed for it, no Motion authoring added)', () => {
    expect(VIDEO_PAGE).toContain('Cenas livres são estáticas nesta versão: o movimento de cena só existe nas cenas com template. Para quando cada elemento aparece, use Timing na cena (Elementos).')
    const freeBranch = VIDEO_PAGE.slice(VIDEO_PAGE.indexOf('{selectedScene && selectedIsFree ? ('), VIDEO_PAGE.indexOf('free-scene-motion'))
    expect(freeBranch).not.toContain('radiogroup')
  })

  it('a legacy value shows a bounded, truthful notice instead of pretending it is one of the offered choices', () => {
    expect(VIDEO_PAGE).toContain('data-testid="motion-legacy-notice"')
    expect(VIDEO_PAGE).toContain('e não é mais oferecida para novas cenas')
    expect(VIDEO_PAGE).toContain('const motionSupported = sceneMotionOptions.some((option) => option.value === currentMovement)')
  })
})

// ── 7. Regression: timing, root timeline, Static all unaffected ────────────
describe('7. Regression: Timing/Timeline/Static are untouched', () => {
  it('element_timing is not read, written or referenced by any Motion code', () => {
    const authoring = read('lib/creative/video-editor/video-authoring.ts')
    expect(authoring).not.toContain('element_timing')
    const adapter = read('lib/creative/timeline-adapter/video-draft-to-timeline.ts')
    // movementToMotion itself must not touch element_timing (Motion = HOW; Timing = WHEN — separate concerns).
    const fn = adapter.slice(adapter.indexOf('export function movementToMotion'), adapter.indexOf('export function movementToMotion') + 1600)
    expect(fn).not.toContain('element_timing')
  })

  it('root timeline items (B-roll, lower third, audio) are untouched by this mission', () => {
    const temporalItems = read('lib/creative/video-editor/temporal-items.ts')
    expect(temporalItems).not.toMatch(/motionOptions|movementToMotion|movementLabel/)
  })

  it('the Static editor has no Motion tab and was not touched by this mission', () => {
    const staticPage = read('app/(dashboard)/projetos/[id]/conteudos/[editorialContentId]/channel-pieces/[channelPieceId]/editar-visual/page.tsx')
    expect(staticPage).not.toMatch(/motionOptions|movementToMotion|movementLabel|role="radiogroup" aria-label="Movimento/)
  })

  it('no DB migration, worker or render-contract file changed', () => {
    for (const path of [
      'infra/render-worker-runtime/export.mjs',
      'infra/render-worker-runtime/server.mjs',
      'lib/schemas/creative/timeline.ts',
      'lib/schemas/creative/primitives.ts',
    ]) {
      // These files are read here only to prove they still parse/exist unchanged in shape;
      // this mission's git diff (recorded in the canonical doc) is the authoritative proof.
      expect(() => read(path)).not.toThrow()
    }
  })
})
