import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { legacyVideoAuthoringRedirect, videoCreativeEditorHref } from '../video-routes'
import { createVideoDraftForCreativeEditor } from '../video-draft-entry'
import { buildVideoDraftHubCards, draftRoute } from '@/lib/draft-hub'
import { buildRecentWorkItems } from '@/lib/dashboard-continuation'
import { buildGalleryOutputs } from '@/lib/gallery-output-library'

// VIDEO_DRAFT_SINGLE_WRITER_AND_CANONICAL_ENTRY_V1
const updateSession = vi.fn(async () => new Response(null, { status: 200 }))
vi.mock('@/lib/supabase/middleware', () => ({ updateSession: (...args: unknown[]) => updateSession(...(args as [])) }))

const DRAFT = '7b12b65d-4d8a-4f33-9f65-0aedf961c6e9'
const root = process.cwd()
const read = (path: string) => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n')
/** Source without comments: explanatory comments may name the retired workspace. */
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('legacy /videos?draft= is no longer an authoring URL', () => {
  it('maps a valid draft id to the canonical Creative Editor and ignores other context params', () => {
    expect(legacyVideoAuthoringRedirect('/videos', new URLSearchParams(`draft=${DRAFT}&project=p&production=q`))).toBe(`/creative-editor/video/${DRAFT}`)
    expect(legacyVideoAuthoringRedirect('/videos/', new URLSearchParams(`draft=${DRAFT.toUpperCase()}`))).toBe(`/creative-editor/video/${DRAFT}`)
  })

  it('never builds an editor URL from a malformed id, and leaves non-authoring URLs alone', () => {
    expect(legacyVideoAuthoringRedirect('/videos', new URLSearchParams('draft=../../etc'))).toBe('/videos')
    expect(legacyVideoAuthoringRedirect('/videos', new URLSearchParams('draft='))).toBe('/videos')
    expect(legacyVideoAuthoringRedirect('/videos', new URLSearchParams('project=p&production=q'))).toBeNull()
    expect(legacyVideoAuthoringRedirect('/videos', new URLSearchParams())).toBeNull()
    expect(legacyVideoAuthoringRedirect('/videos/rascunhos', new URLSearchParams(`draft=${DRAFT}`))).toBeNull()
    expect(legacyVideoAuthoringRedirect('/imagens', new URLSearchParams(`draft=${DRAFT}`))).toBeNull()
  })
})

describe('proxy redirect (runtime)', () => {
  beforeEach(() => updateSession.mockClear())

  it('redirects /videos?draft=<id> to the protected canonical route before any rendering', async () => {
    const { proxy } = await import('@/proxy')
    const response = await proxy(new NextRequest(`https://studio.example/videos?draft=${DRAFT}&production=x`))
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(`https://studio.example/creative-editor/video/${DRAFT}`)
    expect(updateSession).not.toHaveBeenCalled()
  })

  it('keeps every other request on the normal authenticated session path (no bypass)', async () => {
    const { proxy } = await import('@/proxy')
    await proxy(new NextRequest('https://studio.example/videos'))
    await proxy(new NextRequest(`https://studio.example/creative-editor/video/${DRAFT}`))
    expect(updateSession).toHaveBeenCalledTimes(2)
  })

  it('the canonical target is itself an auth-protected path with an owner-scoped, non-leaking load', () => {
    expect(read('lib/supabase/middleware.ts')).toContain("'/creative-editor'")
    expect(read('app/api/video-drafts/route.ts')).toMatch(/\.eq\('id', id\)\s*\n\s*\.eq\('user_id', user\.id\)/)
    expect(read('app/(dashboard)/creative-editor/video/[draftId]/page.tsx')).toContain("throw new Error('Rascunho de vídeo não encontrado ou sem acesso.')")
  })
})

describe('creation hands off to the canonical editor', () => {
  it('creates through POST /api/video-drafts and returns the canonical href', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('/api/video-drafts')
      expect(init?.method).toBe('POST')
      const body = JSON.parse(String(init?.body))
      expect(body).toMatchObject({ projectId: 'p', productionId: 'q', name: 'Novo vídeo' })
      expect(body.scenes).toHaveLength(1)
      return new Response(JSON.stringify({ draft: { id: DRAFT } }), { status: 201 })
    })
    const result = await createVideoDraftForCreativeEditor({ projectId: 'p', productionId: 'q', fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(result).toEqual({ ok: true, draftId: DRAFT, href: videoCreativeEditorHref(DRAFT) })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('reports the API error and never navigates to an editor without an id', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: 'Production obrigatória.' }), { status: 422 }))
    expect(await createVideoDraftForCreativeEditor({ projectId: 'p', productionId: '', fetchImpl: fetchImpl as unknown as typeof fetch })).toEqual({ ok: false, error: 'Production obrigatória.' })
  })
})

describe('every "open draft" entry targets the canonical editor', () => {
  const draft = { id: DRAFT, project_id: 'p', production_id: 'q', name: 'Vídeo', scenes: [], updated_at: '2026-09-25T00:00:00Z' }

  it('draft hub cards (/videos hub) and draftRoute', () => {
    expect(draftRoute('video', DRAFT, 'p', 'q')).toBe(`/creative-editor/video/${DRAFT}`)
    expect(buildVideoDraftHubCards({ drafts: [draft], projects: [], productions: [] })[0].href).toBe(`/creative-editor/video/${DRAFT}`)
    expect(draftRoute('image', 'img', 'p', 'q')).toBe('/imagens?draft=img&project=p&production=q')
  })

  it('dashboard continuation', () => {
    const items = buildRecentWorkItems({ imageDrafts: [], videoDrafts: [draft], editorialContents: [], projects: [], productions: [] })
    expect(items.find((item) => item.type === 'video')?.href).toBe(`/creative-editor/video/${DRAFT}`)
  })

  it('Gallery: "Abrir origem" opens the draft; viewing/downloading the MP4 stays on output endpoints', () => {
    const [item] = buildGalleryOutputs({
      images: [],
      executions: [{ id: 'exec-1', video_draft_id: DRAFT, status: 'completed', completed_at: '2026-09-25T00:00:00Z', queued_at: '2026-09-25T00:00:00Z', kind: 'video' }],
      videoDrafts: [{ ...draft }],
    })
    expect(item.sourceHref).toBe(`/creative-editor/video/${DRAFT}`)
    expect(item.videoPreviewEndpoint).toBe('/api/render-executions/exec-1/output-url')
    expect(item.downloadUrl).toBe('/api/render-executions/exec-1/output-url?disposition=attachment')
  })

  it('Production, /videos/rascunhos and the hub no longer link to the legacy workspace', () => {
    for (const path of ['app/(dashboard)/projetos/[id]/producoes/[productionId]/page.tsx', 'app/(dashboard)/videos/rascunhos/page.tsx', 'app/(dashboard)/videos/page.tsx', 'lib/dashboard-continuation.ts', 'lib/draft-hub.ts', 'lib/gallery-output-library.ts']) {
      expect(code(path), path).not.toMatch(/\/videos\?draft=/)
    }
    const production = read('app/(dashboard)/projetos/[id]/producoes/[productionId]/page.tsx')
    expect(production).toContain('router.push(videoCreativeEditorHref(draft.id))')
    
    // NEW INVARIANT: Production navigates contextual creation to the Gen AI workspace,
    // and no longer creates a VideoDraft implicitly.
    expect(production).not.toContain('createVideoDraftForCreativeEditor({')
    expect(production).toMatch(/router\.push\(`\/videos\?project=\$\{projectId\}&production=\$\{productionId\}`\)/)
  })
})

describe('single writer (structural)', () => {
  function sourceFiles(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '.next' || entry === '__tests__') continue
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) sourceFiles(full, acc)
      else if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) acc.push(full)
    }
    return acc
  }

  it('only the canonical Creative Editor PATCHes VideoDraft content; the only other PATCH is the Production unlink (linkOnly)', () => {
    const writers = ['app', 'components', 'lib']
      .flatMap((dir) => sourceFiles(join(root, dir)))
      .map((file) => ({ file: relative(root, file).replace(/\\/g, '/'), source: readFileSync(file, 'utf8').replace(/\r\n/g, '\n') }))
      .filter(({ file, source }) => !file.startsWith('app/api/') && /\/api\/video-drafts/.test(source) && /method:\s*'PATCH'/.test(source))
      .map(({ file, source }) => ({ file, source }))
    expect(writers.map((writer) => writer.file).sort()).toEqual([
      'app/(dashboard)/creative-editor/video/[draftId]/page.tsx',
      'app/(dashboard)/projetos/[id]/producoes/[productionId]/page.tsx',
    ])
    const production = writers.find((writer) => writer.file.includes('producoes'))!.source
    expect(production).toContain('body: JSON.stringify({ id: unlinkTarget.id, productionId: null, linkOnly: true })')
    const unlink = production.slice(production.indexOf("method: 'PATCH'"), production.indexOf('linkOnly: true') + 20)
    expect(unlink).not.toMatch(/scenes/)
    expect(production.match(/method:\s*'PATCH'/g)).toHaveLength(1)
  })

  it('the /videos hub mounts no authoring state, autosave, scene UI or render', () => {
    const hub = code('app/(dashboard)/videos/page.tsx')
    for (const forbidden of ["method: 'PATCH'", 'beforeunload', 'setScenes', 'SceneCard', 'StoryboardModal', '/render`', 'updateVideoSceneLibraryFile', 'handleSaveDraft', 'setTimeout(autoSaveDraft']) {
      expect(hub, forbidden).not.toContain(forbidden)
    }
    expect(existsSync(join(root, 'components/videos/scene-card.tsx'))).toBe(false)
    expect(existsSync(join(root, 'components/videos/storyboard-modal.tsx'))).toBe(false)
    // Client fallback for the proxy redirect; creation hands off; publication stays non-authoring.
    expect(hub).toContain('if (legacyTarget) router.replace(legacyTarget)')
    expect(hub).toContain('createVideoDraftForCreativeEditor(')
    expect(hub).toContain('<QuickFlowDialog')
  })
})
