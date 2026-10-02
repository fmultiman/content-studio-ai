import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// GENERATED_MEDIA_TO_CREATIVE_EDITOR_HANDOFF_V1 — how the two editors consume the handoff. The behaviour of the
// panel itself is proven in received-media-panel.test.tsx; these assertions pin the wiring that makes the
// invariants structural: the editors keep ONE intake path per role, the incoming media never enters authored
// state, and nothing outside the panel/helper reads the query parameter.

const read = (...segments: string[]) => readFileSync(join(process.cwd(), ...segments), 'utf-8').replace(/\r\n/g, '\n')
const staticPage = read('app', '(dashboard)', 'projetos', '[id]', 'conteudos', '[editorialContentId]', 'channel-pieces', '[channelPieceId]', 'editar-visual', 'page.tsx')
const videoPage = read('app', '(dashboard)', 'creative-editor', 'video', '[draftId]', 'page.tsx')
const count = (source: string, needle: string | RegExp) => (source.match(typeof needle === 'string' ? new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g') : needle) ?? []).length

describe('Static Creative Editor — received media', () => {
  it('mounts the panel with the editor real target chain (the server derives the Project from it)', () => {
    expect(staticPage).toContain("<ReceivedMediaPanel target={{ editor: 'static', projectId: context.project.id, editorialContentId: context.editorialContent.id, channelPieceId: context.channelPiece.id }} actionsFor={receivedMediaActions} />")
    expect(count(staticPage, '{receivedMedia}')).toBe(2) // stacked + floating layouts
  })

  it('uses ONE existing image-application path: the Library picker and "Mídia recebida" call the same function', () => {
    expect(count(staticPage, 'applyLibraryImageToComposition(')).toBe(3) // definition + picker + received action
    expect(staticPage).toMatch(/run: \(file\) => applyLibraryImageToComposition\(file, \{ mode: 'add' \}\)/)
    expect(staticPage).toMatch(/applyLibraryImageToComposition\(file, freeImagePicker\)/)
  })

  it('offers a single canonical role (add as an element) — the handoff invents no Static role', () => {
    expect(count(staticPage, /key: '[a-z-]+',\n\s+label: isCarousel/)).toBe(1)
  })

  it('never creates ChannelPieceMedia and the incoming media never reaches the persisted snapshot', () => {
    expect(staticPage).not.toMatch(/channel_piece_media|\/api\/channel-piece-media/)
    const persisted = staticPage.slice(staticPage.indexOf('function persistedBodyFields'), staticPage.indexOf('export default function'))
    expect(persisted).not.toMatch(/received|handoff|media=/i)
    expect(staticPage).not.toMatch(/useSearchParams|searchParams\.get\(/)
  })
})

describe('Video Creative Editor — received media', () => {
  it('mounts the panel with the VideoDraft id only (the server derives the Project from the owner-scoped draft)', () => {
    expect(videoPage).toContain("<ReceivedMediaPanel target={{ editor: 'video', draftId: draft.id }} actionsFor={receivedMediaActions} />")
    expect(count(videoPage, '{receivedMedia}')).toBe(2)
    expect(videoPage).not.toMatch(/useSearchParams|searchParams\.get\(/)
  })

  it('reuses the three EXISTING intake paths (scene hero, free image, B-roll) from both the pickers and the panel', () => {
    expect(count(videoPage, 'applyFreeSceneImage(')).toBe(3) // definition + picker + received action
    expect(count(videoPage, 'applySceneHero')).toBe(3) // definition + picker (onSelect) + received action
    expect(count(videoPage, 'applyTimelineMedia(')).toBe(3) // definition + picker + received action
  })

  it('image roles: free-scene image | Scene hero (only where the Scene draws one) | B-roll; video role: B-roll only', () => {
    const block = videoPage.slice(videoPage.indexOf('const receivedMediaActions'), videoPage.indexOf('const receivedMedia ='))
    expect(block).toMatch(/file\.kind === 'image' && selectedScene/)
    expect(block).toMatch(/isFreeScene\(selectedScene\)/)
    expect(block).toMatch(/resolveSceneComposition\(selectedScene\)\.usesHero/)
    // B-roll is the only action outside the image-only branch.
    const afterImageBranch = block.slice(block.indexOf("actions.push({ key: 'broll'"))
    expect(afterImageBranch).toContain("applyTimelineMedia(received, { mode: 'add', kind: 'visual' })")
    expect(count(block, "key: '")).toBe(3)
  })

  it('does not auto-add a timeline item, auto-create a scene, auto-set the hero or auto-save from the handoff', () => {
    const block = videoPage.slice(videoPage.indexOf('const receivedMediaActions'), videoPage.indexOf('const receivedMedia ='))
    // The only places those functions are invoked from the handoff block are the explicit `run:` callbacks.
    for (const call of ['addScene(', 'saveNow(', 'insertVideoScene(']) expect(block).not.toContain(call)
    expect(count(block, 'run:')).toBe(3)
  })

  it('autosave and dirty derive from authored state only (the received media is not part of them)', () => {
    const dirtyLine = videoPage.split('\n').find((line) => line.startsWith('  const dirty ')) ?? ''
    expect(dirtyLine).toContain('persistedVideoSnapshot(name, scenes, timeline, videoCanvas)')
    expect(dirtyLine).not.toMatch(/received|handoff/i)
    const autosave = videoPage.slice(videoPage.indexOf('if (skipNextAutosaveRef.current)'), videoPage.indexOf('/** Authored stage change'))
    expect(autosave).not.toMatch(/received|handoff|media/i)
  })
})

describe('the query parameter has one owner', () => {
  it('only the panel (through the shared parser) reads ?media=; no editor or component scatters it', () => {
    const panel = read('components', 'creative', 'handoff', 'received-media-panel.tsx')
    expect(panel).toContain('parseIncomingMediaParam(searchParams.get(HANDOFF_MEDIA_PARAM))')
    for (const source of [staticPage, videoPage]) expect(source).not.toMatch(/get\('media'\)|HANDOFF_MEDIA_PARAM/)
  })
})
