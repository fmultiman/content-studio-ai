import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Creative Editor Video Foundation V1 — surface responsibility + authority wiring.
const root = process.cwd()
const read = (path: string) => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n')

const editor = read('app/(dashboard)/creative-editor/video/[draftId]/page.tsx')
const hub = read('app/(dashboard)/videos/page.tsx')
const timeline = read('components/creative/video/scene-timeline.tsx')
const strip = read('components/creative/video/scene-strip.tsx')
const player = read('remotion/player/LiveTimelinePlayer.tsx')
const templateSegment = read('remotion/timeline/TemplateSegment.tsx')

describe('Creative Editor Video shell', () => {
  it('reuses the Static Creative Editor workbench, floating Inspector and header language', () => {
    expect(editor).toContain('CreativeWorkbench')
    expect(editor).toContain('StackedWorkbench')
    expect(editor).toContain('useFloatingWorkbench')
    expect(editor).toContain('<h1 className="shrink-0 text-base font-semibold">Creative Editor</h1>')
    expect(editor).toContain('Voltar ao salvo')
    expect(editor).toContain('VIDEO_INSPECTOR_SECTIONS')
  })

  it('offers CENAS and TIMELINE as two views of the same scenes state', () => {
    expect(editor).toContain("lowerMode === 'scenes'")
    expect(editor).toMatch(/<SceneStrip[\s\S]*scenes=\{scenes\}/)
    expect(editor).toMatch(/<SceneTimeline[\s\S]*scenes=\{scenes\}/)
  })
})

describe('Live Player vs Output Player', () => {
  it('Live Authoring Player comes only from the remotion/ adapter and paints authored state', () => {
    expect(editor).toContain("import('@/remotion/player/LiveTimelinePlayer')")
    expect(editor).not.toMatch(/from ['"](remotion|@remotion\/[^'"]+)['"]/)
    expect(editor).toContain('buildLivePreviewInput')
    expect(player).toContain("from '@remotion/player'")
    expect(player).toContain('TimelineComposition')
    expect(player).toContain('controls={false}')
  })

  it('completed MP4 is consumed by a separate Output Player', () => {
    expect(editor).toContain('data-testid="output-player"')
    expect(editor).toContain('/output-url')
    expect(editor).toMatch(/<video src=\{outputUrl\}/)
    expect(player).not.toContain('<video')
  })

  it('final render keeps the existing server path and TimelineComposition default URL step', () => {
    expect(editor).toContain('`/api/video-drafts/${draft.id}/render`')
    expect(editor).not.toMatch(/JSON\.stringify\(\{[^)]*manifest/)
    expect(templateSegment).toContain('adaptTemplateProps = remotionTemplateProps')
  })
})

describe('One temporal cursor, one authoring authority', () => {
  it('currentFrame is fed by the Player and every seek goes through the Player', () => {
    expect(editor).toContain('onFrame={cursor.set}')
    expect(editor).toMatch(/const seek = useCallback\(\(target: number\) => \{[\s\S]*playerRef\.current\?\.seekTo\(next\)\s+cursor\.set\(next\)/)
    // the cursor is never part of the authored snapshot
    expect(editor).not.toMatch(/persistedVideoSnapshot\([^)]*cursor/)
    expect(editor).toContain('onSeek={seek}')
  })

  it('persists only through the existing VideoDraft PATCH', () => {
    expect(editor).toMatch(/fetch\('\/api\/video-drafts', \{\s+method: 'PATCH'/)
    expect(editor).toContain('buildVideoDraftSaveBody(draft, name, scenes)')
  })

  it('Timeline/CENAS views never fetch or persist; viewport state stays local', () => {
    for (const source of [timeline, strip]) {
      expect(source).not.toContain('fetch(')
      expect(source).not.toContain('localStorage')
    }
    expect(timeline).toContain('useState(DEFAULT_PIXELS_PER_FRAME)')
    expect(timeline).toContain('onReorder(gesture.index, gesture.target)')
    expect(timeline).toContain('onDurationChange(scene.id, framesToSeconds(gesture.frames))')
  })
})

describe('route / entry boundary', () => {
  it('Creative Editor Video lives on a neutral route, not under /videos, and is auth-protected', () => {
    expect(existsSync(join(root, 'app/(dashboard)/creative-editor/video/[draftId]/page.tsx'))).toBe(true)
    expect(existsSync(join(root, 'app/(dashboard)/videos/[draftId]'))).toBe(false)
    expect(read('lib/supabase/middleware.ts')).toContain("'/creative-editor'")
  })
})

describe('/videos remains the Hub', () => {
  it('keeps the draft hub and launches the Creative Editor for a VideoDraft', () => {
    expect(hub).toContain('Rascunhos recentes')
    // Hub cards carry the canonical editor href (lib/draft-hub.ts draftRoute).
    expect(hub).toContain('router.push(draft.href)')
    expect(hub).toContain('Criar no Creative Editor')
    // VIDEO_DRAFT_SINGLE_WRITER_AND_CANONICAL_ENTRY_V1: the classic workspace is retired.
    expect(hub).not.toContain('Abrir (clássico)')
    expect(hub).not.toContain('<SceneCard')
  })
})
