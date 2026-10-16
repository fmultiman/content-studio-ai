// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import ProductionDetailPage from '@/app/(dashboard)/projetos/[id]/producoes/[productionId]/page'

// STRUCTURAL_WAVE_1A1 - the REAL Production workspace (only network, Supabase and router are faked): the Images tab shows the canonical
// generation Sessions, never lists a legacy draft twice, resumes through the canonical route, and says "could not load" instead of
// "nothing here" when a source fails. The Videos tab keeps Sessions, historical generations and VideoDrafts, and is honest on failure.

const PROJECT = '10000000-0000-4000-8000-000000000001'
const OTHER_PROJECT = '10000000-0000-4000-8000-0000000000ff'
const PRODUCTION = '20000000-0000-4000-8000-000000000001'
const OTHER_PRODUCTION = '20000000-0000-4000-8000-0000000000ff'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useParams: () => ({ id: PROJECT, productionId: PRODUCTION }),
}))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({ single: () => Promise.resolve({ data: table === 'projects' ? { id: PROJECT, name: 'Projeto Alfa', identity: null } : null, error: null }) }),
      }),
    }),
  }),
}))

type Source = { status?: number; body?: unknown }
let calls: string[]
let sources: {
  imageSessions: Source
  imageDrafts: Source
  videoSessions: Source
  videoGenerations: Source
  videoDrafts: Source
  editorial: Source
}

const ok = (body: unknown): Source => ({ status: 200, body })
const failing = (): Source => ({ status: 503, body: { error: 'unavailable' } })

const imageSession = (id: string, overrides: Record<string, unknown> = {}) => ({
  id, projectId: PROJECT, productionId: PRODUCTION, name: null, workingPrompt: `Prompt ${id}`, workingState: { imageStatus: 'draft' }, currentImageId: null,
  status: 'active', revision: 1, legacyImageDraftId: null, createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-05T10:00:00.000Z', thumbnailUrl: null, ...overrides,
})
const legacyDraft = (id: string, overrides: Record<string, unknown> = {}) => ({
  id, project_id: PROJECT, production_id: PRODUCTION, name: `Rascunho ${id}`, user_input: 'um retrato', generated_prompt: 'x', image_status: 'draft', updated_at: '2026-10-02T10:00:00.000Z', ...overrides,
})
const videoSession = (id: string, overrides: Record<string, unknown> = {}) => ({
  id, projectId: PROJECT, productionId: PRODUCTION, updatedAt: '2026-10-06T10:00:00.000Z', workingState: { prompt: `Vídeo ${id}` }, ...overrides,
})
const videoDraft = (id: string) => ({ id, project_id: PROJECT, production_id: PRODUCTION, name: `Edição ${id}`, updated_at: '2026-10-03T10:00:00.000Z', scenes: [] })
const generation = (id: string, status: string, sessionId: string | null) => ({
  id, session_id: sessionId, project_id: PROJECT, production_id: PRODUCTION, prompt: `Geração ${id}`, status, mode: 'text_to_video', provider: 'kling',
  created_at: '2026-10-01T10:00:00.000Z', updated_at: '2026-10-01T10:05:00.000Z',
})

function reply(source: Source) {
  return Promise.resolve(new Response(JSON.stringify(source.body ?? {}), { status: source.status ?? 200 }))
}

beforeEach(() => {
  calls = []
  push.mockReset()
  sources = {
    imageSessions: ok({ sessions: [], hasMore: false }),
    imageDrafts: ok({ drafts: [] }),
    videoSessions: ok({ sessions: [], hasMore: false }),
    videoGenerations: ok({ generations: [] }),
    videoDrafts: ok({ drafts: [] }),
    editorial: ok({ editorialContents: [] }),
  }
  global.fetch = vi.fn((input: string | URL | Request) => {
    const url = String(input)
    calls.push(url)
    if (url.includes(`/api/productions/${PRODUCTION}`)) {
      return Promise.resolve(new Response(JSON.stringify({
        production: { id: PRODUCTION, project_id: PROJECT, title: 'Produção Alfa', intention: 'Objetivo de teste', type: 'campaign', updated_at: '2026-10-03T10:00:00Z' },
      }), { status: 200 }))
    }
    if (url.includes('/api/image-generation-sessions')) return reply(sources.imageSessions)
    if (url.includes('/api/image-drafts')) return reply(sources.imageDrafts)
    if (url.includes('/api/editorial-contents')) return reply(sources.editorial)
    if (url.includes('/api/channel-pieces')) return reply(ok({ channelPieces: [] }))
    if (url.includes('/api/video-generations/connections')) return reply(ok({ connections: [] }))
    if (url.includes('/api/video-drafts')) return reply(sources.videoDrafts)
    if (url.includes('/api/video-generation-sessions')) return reply(sources.videoSessions)
    if (url.includes('/api/video-generations')) return reply(sources.videoGenerations)
    return reply(ok({}))
  }) as unknown as typeof fetch
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

async function open(tab: 'overview' | 'images' | 'videos' = 'images') {
  render(<ProductionDetailPage />)
  const trigger = await screen.findByRole('tab', { name: tab === 'images' ? /Imagens/ : tab === 'videos' ? /Vídeos/ : /Visão Geral/ })
  fireEvent.mouseDown(trigger, { button: 0 })
  fireEvent.click(trigger)
  // The workspace sources have finished when the loading message is gone.
  await waitFor(() => expect(screen.queryByText(/Carregando/i)).toBeNull())
}

describe('Images tab - canonical Sessions', () => {
  it('lists a new Session that has no legacy draft at all, with title, status, update date and project/production context', async () => {
    sources.imageSessions = ok({ sessions: [imageSession('s-new', { workingPrompt: 'Retrato de estúdio', workingState: { imageStatus: 'generating' } })], hasMore: false })
    await open('images')
    const card = await screen.findByTestId('image-session-card')
    expect(within(card).getByText('Retrato de estúdio')).toBeTruthy()
    expect(within(card).getByTestId('image-session-status').textContent).toBe('Gerando')
    expect(card.textContent).toContain('Projeto Alfa')
    expect(card.textContent).toContain('05/10/2026')
    expect(screen.queryByTestId('production-legacy-image-drafts')).toBeNull()
    expect(screen.queryByTestId('production-images-empty')).toBeNull()
  })

  it('"Continuar" opens the canonical Session route', async () => {
    sources.imageSessions = ok({ sessions: [imageSession('s-resume')], hasMore: false })
    await open('images')
    fireEvent.click(await screen.findByRole('button', { name: /Continuar/ }))
    expect(push).toHaveBeenCalledWith('/imagens/geracoes/s-resume')
  })

  it('asks for the Sessions of THIS Project and THIS Production only', async () => {
    await open('images')
    const request = calls.find((url) => url.startsWith('/api/image-generation-sessions'))!
    expect(request).toBe(`/api/image-generation-sessions?projectId=${PROJECT}&productionId=${PRODUCTION}`)
  })

  it('a legacy draft carried by a Session is NOT shown a second time', async () => {
    sources.imageSessions = ok({ sessions: [imageSession('s-1', { legacyImageDraftId: 'd-1' })], hasMore: false })
    sources.imageDrafts = ok({ drafts: [legacyDraft('d-1')] })
    await open('images')
    await screen.findByTestId('image-session-card')
    expect(screen.getAllByTestId('image-session-card')).toHaveLength(1)
    expect(screen.queryByTestId('production-legacy-image-drafts')).toBeNull()
    expect(screen.queryByText('Rascunho d-1')).toBeNull()
    expect(screen.getByTestId('images-tab-summary').textContent).toBe('1 sessão de imagem.')
  })

  it('a legacy draft that no Session carries is still reachable, on its own legacy list, through its existing route', async () => {
    sources.imageSessions = ok({ sessions: [imageSession('s-1', { legacyImageDraftId: 'd-1' })], hasMore: false })
    sources.imageDrafts = ok({ drafts: [legacyDraft('d-1'), legacyDraft('d-orphan')] })
    await open('images')
    const legacy = await screen.findByTestId('production-legacy-image-drafts')
    expect(within(legacy).getAllByText(/Rascunho d-/)).toHaveLength(1)
    expect(within(legacy).getByText('Rascunho d-orphan')).toBeTruthy()
    fireEvent.click(within(legacy).getByRole('button', { name: /Abrir/ }))
    expect(push).toHaveBeenCalledWith(`/imagens?draft=d-orphan&project=${PROJECT}&production=${PRODUCTION}`)
    expect(screen.getByTestId('images-tab-summary').textContent).toBe('1 sessão de imagem · 1 rascunho legado.')
  })

  it('never shows a Session that belongs to another Production or Project, even if the endpoint returned it', async () => {
    sources.imageSessions = ok({
      sessions: [
        imageSession('mine'),
        imageSession('other-production', { productionId: OTHER_PRODUCTION }),
        imageSession('other-project', { projectId: OTHER_PROJECT }),
        imageSession('unscoped', { projectId: null, productionId: null }),
        imageSession('archived', { status: 'archived' }),
      ],
      hasMore: false,
    })
    await open('images')
    await screen.findByTestId('image-session-card')
    expect(screen.getAllByTestId('image-session-card').map((card) => card.getAttribute('data-session-id'))).toEqual(['mine'])
  })

  it('orders Sessions by recency', async () => {
    sources.imageSessions = ok({ sessions: [imageSession('old', { updatedAt: '2026-09-01T10:00:00.000Z' }), imageSession('new', { updatedAt: '2026-10-09T10:00:00.000Z' })], hasMore: false })
    await open('images')
    await screen.findAllByTestId('image-session-card')
    expect(screen.getAllByTestId('image-session-card').map((card) => card.getAttribute('data-session-id'))).toEqual(['new', 'old'])
  })

  it('says so when the list was cut by its cap (the count carries a "+")', async () => {
    sources.imageSessions = ok({ sessions: [imageSession('s-1')], hasMore: true })
    await open('images')
    expect(await screen.findByTestId('images-sessions-truncated')).toBeTruthy()
    expect(screen.getByTestId('images-tab-summary').textContent).toContain('1+ sessão de imagem')
  })
})

describe('Images tab - empty and failure states', () => {
  it('a truncated page containing only archived Sessions cannot claim that the Production is empty', async () => {
    sources.imageSessions = ok({ sessions: [imageSession('archived', { status: 'archived' })], hasMore: true })
    await open('images')
    expect(screen.queryByTestId('production-images-empty')).toBeNull()
    expect(screen.getByTestId('images-tab-summary').textContent).toBe('Lista parcial de imagens vinculadas.')
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Visão Geral' }), { button: 0 })
    expect(screen.getByTestId('overview-images').textContent).toBe('Lista parcial de sessões de imagem')
  })
  it('does not resurrect a legacy draft whose Session is outside the displayed page or has moved scope', async () => {
    sources.imageSessions = ok({ sessions: [imageSession('recent')], hasMore: true })
    sources.imageDrafts = ok({ drafts: [legacyDraft('linked-outside')], linkedLegacyDraftIds: ['linked-outside'] })
    await open('images')
    expect(screen.queryByTestId('production-legacy-image-drafts')).toBeNull()
    expect(screen.getAllByTestId('image-session-card')).toHaveLength(1)
  })

  it('unknown legacy linkage does not hide Sessions or invent an orphan', async () => {
    sources.imageSessions = ok({ sessions: [imageSession('recent')], hasMore: false })
    sources.imageDrafts = ok({ drafts: [legacyDraft('unknown')], linkedLegacyDraftIds: null })
    await open('images')
    expect(screen.getByTestId('images-legacy-error')).toBeTruthy()
    expect(screen.queryByTestId('production-legacy-image-drafts')).toBeNull()
    expect(screen.getByTestId('image-session-card')).toBeTruthy()
  })

  it('a failed legacy source never produces an empty claim when no Sessions exist', async () => {
    sources.imageDrafts = failing()
    await open('images')
    expect(screen.queryByTestId('production-images-empty')).toBeNull()
    expect(screen.getByTestId('images-tab-summary').textContent).toContain('indisponíveis')
  })
  it('a Production with nothing shows the honest empty state and no error', async () => {
    await open('images')
    expect(await screen.findByTestId('production-images-empty')).toBeTruthy()
    expect(screen.queryByTestId('images-sessions-error')).toBeNull()
    expect(screen.getByTestId('images-tab-summary').textContent).toBe('Nenhuma imagem vinculada.')
  })

  it('a failed Sessions request is NOT presented as "nothing here"; legacy drafts are withheld (linkage unknown) and a retry works', async () => {
    sources.imageSessions = failing()
    sources.imageDrafts = ok({ drafts: [legacyDraft('d-1')] })
    await open('images')
    expect(await screen.findByTestId('images-sessions-error')).toBeTruthy()
    expect(screen.queryByTestId('production-images-empty')).toBeNull()
    expect(screen.queryByTestId('production-legacy-image-drafts')).toBeNull()
    expect(screen.queryByText('Rascunho d-1')).toBeNull()
    expect(screen.getByTestId('images-tab-summary').textContent).toBe('Não foi possível carregar as sessões de imagem.')

    sources.imageSessions = ok({ sessions: [imageSession('s-back')], hasMore: false })
    fireEvent.click(within(screen.getByTestId('images-sessions-error')).getByRole('button', { name: 'Tentar novamente' }))
    expect(await screen.findByTestId('image-session-card')).toBeTruthy()
    expect(screen.queryByTestId('images-sessions-error')).toBeNull()
    expect(calls.filter((url) => url.startsWith('/api/image-generation-sessions'))).toHaveLength(2)
  })

  it('a network failure (the request rejects) is handled the same way, and the other tabs keep their data', async () => {
    const original = global.fetch
    global.fetch = vi.fn((input: string | URL | Request) => (String(input).includes('/api/image-generation-sessions') ? Promise.reject(new TypeError('network down')) : (original as typeof fetch)(input))) as unknown as typeof fetch
    sources.editorial = ok({ editorialContents: [{ id: 'ec-1', project_id: PROJECT, production_id: PRODUCTION, title: 'Lançamento', status: 'draft', updated_at: '2026-10-02T10:00:00Z' }] })
    await open('images')
    expect(await screen.findByTestId('images-sessions-error')).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Conteúdos editoriais \(1\)/ })).toBeTruthy()
  })

  it('a failed legacy-drafts request does not hide the Sessions and is mentioned', async () => {
    sources.imageSessions = ok({ sessions: [imageSession('s-1')], hasMore: false })
    sources.imageDrafts = failing()
    await open('images')
    await screen.findByTestId('image-session-card')
    expect(screen.getByTestId('images-legacy-error')).toBeTruthy()
  })
})

describe('Overview counters: one number per entity, never one merged total', () => {
  it('a Production with several kinds of media reports each kind on its own', async () => {
    sources.imageSessions = ok({ sessions: [imageSession('i1'), imageSession('i2'), imageSession('i3', { legacyImageDraftId: 'd-1' })], hasMore: false })
    sources.imageDrafts = ok({ drafts: [legacyDraft('d-1'), legacyDraft('d-orphan')] })
    sources.videoSessions = ok({ sessions: [videoSession('v1'), videoSession('v2')], hasMore: false })
    sources.videoDrafts = ok({ drafts: [videoDraft('vd-1')] })
    sources.videoGenerations = ok({ generations: [generation('g-owned', 'succeeded', 'v1'), generation('g-standalone', 'succeeded', null)] })
    sources.editorial = ok({ editorialContents: [{ id: 'ec-1', project_id: PROJECT, production_id: PRODUCTION, title: 'Conteúdo', status: 'draft', updated_at: '2026-10-02T10:00:00Z' }] })
    await open('overview')
    await waitFor(() => expect(screen.getByTestId('overview-images').textContent).toBe('3 sessões de imagem · 1 rascunho legado'))
    expect(screen.getByTestId('overview-videos').textContent).toBe('2 sessões de geração · 1 edição de vídeo · 1 geração avulsa (histórico)')
    expect(screen.getByRole('tab', { name: 'Imagens' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Conteúdos editoriais \(1\)/ })).toBeTruthy()
    // The Videos tab carries no merged number: it lists three different entities.
    expect(screen.getByRole('tab', { name: 'Vídeos' })).toBeTruthy()
  })

  it('an empty Production says so, per kind', async () => {
    await open('overview')
    await waitFor(() => expect(screen.getByTestId('overview-images').textContent).toBe('Sem imagens vinculadas'))
    expect(screen.getByTestId('overview-videos').textContent).toBe('Sem vídeos vinculados')
  })

  it('failed sources are shown as unavailable, not as zero', async () => {
    sources.imageSessions = failing()
    sources.videoSessions = failing()
    await open('overview')
    await waitFor(() => expect(screen.getByTestId('overview-images').textContent).toBe('Indisponível agora'))
    expect(screen.getByTestId('overview-videos').textContent).toBe('Contagem parcial indisponível agora')
  })
})

describe('Videos tab - Sessions, historical generations and VideoDrafts keep coexisting', () => {
  it('a capped Attempt history does not claim a Session has no Attempts', async () => {
    sources.videoSessions = ok({ sessions: [videoSession('older')], hasMore: false })
    sources.videoGenerations = ok({ generations: [], hasMore: true })
    await open('videos')
    const card = screen.getByTestId('production-card-session-older')
    expect(within(card).getByTestId('generation-status').textContent).toBe('Sem status')
    expect(screen.getByTestId('videos-history-truncated')).toBeTruthy()
  })

  it('lists the Session, the standalone historical generation and the VideoDraft, each with its own action and destination', async () => {
    sources.videoSessions = ok({ sessions: [videoSession('vs-1')], hasMore: false })
    sources.videoGenerations = ok({ generations: [generation('g-standalone', 'failed', null)] })
    sources.videoDrafts = ok({ drafts: [videoDraft('vd-1')] })
    await open('videos')
    expect(await screen.findByTestId('production-card-session-vs-1')).toBeTruthy()
    expect(screen.getByTestId('production-card-generation-g-standalone')).toBeTruthy()
    expect(screen.getByTestId('production-card-draft-vd-1')).toBeTruthy()
    fireEvent.click(screen.getByTestId('production-continue-session'))
    expect(push).toHaveBeenCalledWith('/videos/geracoes/vs-1')
    fireEvent.click(screen.getByTestId('production-open-video-draft'))
    expect(push).toHaveBeenCalledWith('/creative-editor/video/vd-1')
    // Wave 0 is preserved: the stored status reads in Portuguese.
    expect(within(screen.getByTestId('production-card-generation-g-standalone')).getByTestId('generation-status').textContent).toBe('Falhou')
  })

  it('never lists a video Session that belongs to another Production or Project', async () => {
    sources.videoSessions = ok({ sessions: [videoSession('mine'), videoSession('other-production', { productionId: OTHER_PRODUCTION }), videoSession('other-project', { projectId: OTHER_PROJECT })], hasMore: false })
    await open('videos')
    await screen.findByTestId('production-card-session-mine')
    expect(screen.queryByTestId('production-card-session-other-production')).toBeNull()
    expect(screen.queryByTestId('production-card-session-other-project')).toBeNull()
  })

  it('a failed Sessions request is not reported as "no generation here"; the VideoDrafts still show; a retry works', async () => {
    sources.videoSessions = failing()
    sources.videoDrafts = ok({ drafts: [videoDraft('vd-1')] })
    await open('videos')
    expect(await screen.findByTestId('videos-load-error')).toBeTruthy()
    expect(screen.queryByTestId('production-ai-empty')).toBeNull()
    expect(screen.getByTestId('production-card-draft-vd-1')).toBeTruthy()
    sources.videoSessions = ok({ sessions: [videoSession('vs-back')], hasMore: false })
    fireEvent.click(within(screen.getByTestId('videos-load-error')).getByRole('button', { name: 'Tentar novamente' }))
    expect(await screen.findByTestId('production-card-session-vs-back')).toBeTruthy()
    expect(screen.queryByTestId('videos-load-error')).toBeNull()
  })

  it('a failed VideoDrafts request is not reported as "no edition here"', async () => {
    sources.videoDrafts = failing()
    sources.videoSessions = ok({ sessions: [videoSession('vs-1')], hasMore: false })
    await open('videos')
    expect(await screen.findByTestId('videos-load-error')).toBeTruthy()
    expect(screen.queryByTestId('production-editions-empty')).toBeNull()
    expect(screen.getByTestId('production-card-session-vs-1')).toBeTruthy()
  })

  it('says so when the video Session list was cut by its cap', async () => {
    sources.videoSessions = ok({ sessions: [videoSession('vs-1')], hasMore: true })
    await open('videos')
    expect(await screen.findByTestId('video-sessions-truncated')).toBeTruthy()
  })

  it('empty Production: both groups show their honest empty state and there is no error', async () => {
    await open('videos')
    expect(await screen.findByTestId('production-ai-empty')).toBeTruthy()
    expect(screen.getByTestId('production-editions-empty')).toBeTruthy()
    expect(screen.queryByTestId('videos-load-error')).toBeNull()
  })
})

describe('Wave 0 contextual creation is preserved', () => {
  it('"Criar Imagem" still opens /imagens with this Project and Production (no Session is created from here)', async () => {
    await open('images')
    fireEvent.click(await screen.findByRole('button', { name: /Criar Imagem/ }))
    expect(push).toHaveBeenCalledWith(`/imagens?project=${PROJECT}&production=${PRODUCTION}`)
    // Nothing was written: every request this page made is a read.
    const writes = (global.fetch as unknown as { mock: { calls: Array<[unknown, RequestInit | undefined]> } }).mock.calls.filter(([, init]) => init?.method && init.method !== 'GET')
    expect(writes).toEqual([])
  })
})
