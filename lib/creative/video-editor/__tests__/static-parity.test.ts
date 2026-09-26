import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { VideoScene } from '@/lib/types'
import {
  COLLAPSE_SNAP_BODY, DOCK_BAR_HEIGHT, INITIAL_DOCK_STATE, MIN_DOCK_BODY, MIN_PREVIEW_AREA, dockHeight, dockPresetHeight,
  maxDockHeight, resizeDock, sequenceSummary, setDockMode, toggleDockCollapsed,
} from '../bottom-dock'
import { VIDEO_INSPECTOR_SECTIONS, sceneHeroSlotState, videoSceneComposition } from '../video-workspace'
import { buildVideoDraftSaveBody } from '../video-authoring'
import { VIEWPORT_ZOOM_LEVELS, stepViewportZoom } from '@/lib/creative/authoring/viewport'
import { resolveSlotResource, type SlotLibraryFile } from '@/lib/creative/authoring/asset-slots'
import { resolveElementStack } from '@/lib/creative/templates/element-stack'
import { DEFAULT_TEMPLATE_ID } from '@/lib/creative/templates/template-definitions'
import { resolveAsset } from '@/lib/creative/assets/resolve-asset'
import { DEFAULT_HERO_ASSET_REF } from '@/lib/creative/timeline-adapter/video-draft-to-timeline'

const root = process.cwd()
const read = (path: string) => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n')
const videoPage = read('app/(dashboard)/creative-editor/video/[draftId]/page.tsx')
const staticPage = read('app/(dashboard)/projetos/[id]/conteudos/[editorialContentId]/channel-pieces/[channelPieceId]/editar-visual/page.tsx')

function scene(id: string, extra: Partial<VideoScene> = {}): VideoScene {
  return { id, order: 1, description: '', prompt: null, image_url: null, library_file_id: null, duration: 3, movement: 'static', ...extra }
}

describe('bottom authoring dock (UI state only)', () => {
  it('collapsed keeps only the bar; normal/expanded are derived from the workbench and never starve the Player', () => {
    for (const workbench of [480, 620, 760, 900]) {
      const normal = dockPresetHeight('normal', workbench)
      const expanded = dockPresetHeight('expanded', workbench)
      expect(dockPresetHeight('collapsed', workbench)).toBe(DOCK_BAR_HEIGHT)
      expect(normal).toBeGreaterThanOrEqual(DOCK_BAR_HEIGHT + MIN_DOCK_BODY)
      expect(expanded).toBeGreaterThanOrEqual(normal)
      expect(expanded).toBeLessThanOrEqual(maxDockHeight(workbench))
      expect(workbench - maxDockHeight(workbench)).toBeGreaterThanOrEqual(Math.min(MIN_PREVIEW_AREA, workbench - DOCK_BAR_HEIGHT - MIN_DOCK_BODY))
    }
    expect(dockPresetHeight('expanded', 900)).toBeGreaterThan(dockPresetHeight('normal', 900))
  })

  it('handle resize clamps, collapses below the snap threshold and reports expanded at the top', () => {
    expect(resizeDock(DOCK_BAR_HEIGHT + COLLAPSE_SNAP_BODY - 1, 800)).toEqual({ mode: 'collapsed', height: null })
    expect(resizeDock(DOCK_BAR_HEIGHT + COLLAPSE_SNAP_BODY + 1, 800)).toEqual({ mode: 'normal', height: DOCK_BAR_HEIGHT + MIN_DOCK_BODY })
    expect(resizeDock(5000, 800)).toEqual({ mode: 'expanded', height: maxDockHeight(800) })
    expect(dockHeight({ mode: 'normal', height: 9999 }, 700)).toBe(maxDockHeight(700))
    expect(dockHeight(setDockMode('collapsed'), 700)).toBe(DOCK_BAR_HEIGHT)
    expect(toggleDockCollapsed(INITIAL_DOCK_STATE)).toEqual({ mode: 'collapsed', height: null })
    expect(toggleDockCollapsed({ mode: 'collapsed', height: null })).toEqual({ mode: 'normal', height: null })
  })

  it('dock state never enters the VideoDraft save body', () => {
    const body = buildVideoDraftSaveBody({ id: 'd', project_id: 'p', production_id: 'q' }, 'n', [scene('a')])
    const serialized = JSON.stringify(body)
    for (const key of ['dock', 'collapsed', 'expanded', 'height', 'zoom', 'pan']) expect(serialized).not.toContain(`"${key}"`)
    expect(sequenceSummary([scene('a'), scene('b')], 5.5)).toBe('2 cenas · 5.5s')
  })

  it('the dock lives INSIDE the workbench preview panel (Inspector keeps the full workbench height)', () => {
    expect(videoPage).toMatch(/const canvas = \([\s\S]*<AuthoringDock[\s\S]*<\/AuthoringDock>[\s\S]*\n  \)\n/)
    expect(videoPage).not.toContain('{lower}')
    expect(videoPage).toContain('<StackedWorkbench canvas={canvas} inspector={inspector} />')
  })
})

describe('shared Preview Surface viewport (Static authority)', () => {
  it('zoom steps are shared and identical to the proven Static levels', () => {
    expect([...VIEWPORT_ZOOM_LEVELS]).toEqual([0.25, 0.33, 0.4, 0.5, 0.75, 1, 1.25, 1.5])
    expect(stepViewportZoom(0.31, 1)).toBe(0.4)
    expect(stepViewportZoom(0.31, -1)).toBe(0.25)
    expect(stepViewportZoom(1.5, 1)).toBe(1.5)
    expect(stepViewportZoom(0.25, -1)).toBe(0.25)
  })

  it('Static and Video both use the same viewport hook and zoom controls (no second implementation)', () => {
    for (const page of [staticPage, videoPage]) {
      expect(page).toContain("from '@/components/creative/editor/use-preview-viewport'")
      expect(page).toContain('<ViewportZoomControls')
      expect(page).toContain('{...viewport.panHandlers}')
      expect(page).not.toMatch(/const ZOOM_LEVELS|PREVIEW_ZOOM_LEVELS/)
    }
    expect(staticPage).toContain('data-testid="canvas-viewport"')
    expect(videoPage).toContain('data-testid="live-player-viewport"')
  })

  it('the Player never takes pointer input (drag pans like the Canvas) and viewport state is not authoring', () => {
    expect(read('remotion/player/LiveTimelinePlayer.tsx')).toContain('clickToPlay={false}')
    expect(videoPage).toContain("pointerEvents: 'none' }} data-testid=\"live-player\"")
    expect(videoPage).not.toMatch(/persistedVideoSnapshot\([^)]*viewport/)
    expect(videoPage).not.toMatch(/buildVideoDraftSaveBody\([^)]*(dock|viewport)/)
  })
})

describe('Inspector information architecture', () => {
  it('Template · Conteúdo · Assets · Estilo · Elementos + Video-only Motion; no Timing tab', () => {
    expect(VIDEO_INSPECTOR_SECTIONS.map((section) => section.label)).toEqual(['Template', 'Conteúdo', 'Assets', 'Estilo', 'Elementos', 'Motion'])
    expect(VIDEO_INSPECTOR_SECTIONS.map((section) => section.value)).not.toContain('timing')
    expect(videoPage).toContain('data-inspector-tabs={VIDEO_INSPECTOR_SECTIONS.length}')
  })

  it('Template/Elementos show the selected Scene composition the video render actually paints', () => {
    const composition = videoSceneComposition()
    expect(composition.template.id).toBe(DEFAULT_TEMPLATE_ID)
    expect(composition.layout.id).toBe('cover')
    // A Scene without authored composition (VIDEO_SCENE_COMPOSITION_PARITY_V1) = default stack of `cover`.
    expect(composition.stackOrder).toEqual(resolveElementStack(undefined, 'cover', undefined).order)
    expect(composition.stackOrder).toEqual(composition.layout.defaultStackOrder)
    expect(composition.heroUsedBy).toEqual(['Imagem principal'])
    expect(videoPage).toContain('<TemplateFamilyAnatomy template={sceneView.template} />')
    // Camadas are authored per Scene now: order + visibility, same component as Static.
    expect(videoPage).not.toMatch(/<ElementLayers\s+readOnly/)
    expect(videoPage).toContain('onToggleVisibility={(id) => editSelectedScene((scene) => toggleSceneElementVisibility(scene, id))}')
  })
})

describe('Assets parity: Scene hero = Static hero slot semantics', () => {
  const files = new Map<string, SlotLibraryFile>([
    ['f1', { id: 'f1', name: 'foto.png', public_url: 'https://signed/foto.png', thumbnail_url: null, mime_type: 'image/png' }],
    ['g1', { id: 'g1', name: 'slide.png', public_url: 'https://signed/slide.png', thumbnail_url: null, mime_type: 'image/png', origin: 'studio_render' }],
  ])
  const slot = videoSceneComposition().heroSlot

  it('no binding = Template default, which is the SAME file the render adapter uses', () => {
    const resource = resolveSlotResource(slot, sceneHeroSlotState(scene('a')), files, [])
    expect(resource).toMatchObject({ origin: 'template', replaced: false })
    const adapterHero = resolveAsset(DEFAULT_HERO_ASSET_REF)
    expect(adapterHero.valid && adapterHero.value.url).toBe(resource.thumbnailUrl)
  })

  it('library_file_id = Projeto / Imagem gerada override (Trocar / Usar padrão), missing is flagged', () => {
    expect(resolveSlotResource(slot, sceneHeroSlotState(scene('a', { library_file_id: 'f1' })), files, [])).toMatchObject({ origin: 'project', replaced: true, name: 'foto.png' })
    expect(resolveSlotResource(slot, sceneHeroSlotState(scene('a', { library_file_id: 'g1' })), files, [])).toMatchObject({ origin: 'generated', replaced: true })
    expect(resolveSlotResource(slot, sceneHeroSlotState(scene('a', { library_file_id: 'gone' })), files, [])).toMatchObject({ missing: true })
    expect(videoPage).toContain('<AssetSlotCard')
    expect(videoPage).toContain('onUseDefault={() => patchSelectedScene({ library_file_id: null })}')
  })
})
