// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import GalleryPage from '@/app/(dashboard)/galeria/page'
import { accessEndpoints, GALLERY_OUTPUT_TYPES, outputKey, type GalleryOutput, type GalleryOutputType, type GalleryOutputsResponse, type GallerySourceState } from '@/lib/gallery/outputs'

// STRUCTURAL WAVE 1A-2 S2 - the REAL Gallery page (only the network, Supabase and the router are faked).

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

const PROJECT = '10000000-0000-4000-8000-000000000001'
const PROJECT_B = '10000000-0000-4000-8000-000000000002'
const PRODUCTION = '20000000-0000-4000-8000-000000000001'
const PRODUCTION_B = '20000000-0000-4000-8000-000000000002'

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: () => ({
        order: () => ({
          limit: () =>
            Promise.resolve({
              data: table === 'projects'
                ? [{ id: PROJECT, name: 'Portal Norte' }, { id: PROJECT_B, name: 'Outro Project' }]
                : [
                    { id: PRODUCTION, project_id: PROJECT, title: 'Campanha de outono', intention: null },
                    { id: PRODUCTION_B, project_id: PROJECT_B, title: 'Produção do B', intention: null },
                  ],
              error: null,
            }),
        }),
      }),
    }),
  }),
}))

// Radix Select needs layout APIs jsdom lacks: a native <select> keeps the same contract (value / onValueChange / items).
vi.mock('@/components/ui/select', () => {
  const findId = (children: React.ReactNode): string | undefined => {
    let found: string | undefined
    React.Children.forEach(children, (child) => {
      if (found || !React.isValidElement(child)) return
      const props = child.props as { id?: string; children?: React.ReactNode }
      found = props.id ?? findId(props.children)
    })
    return found
  }
  return {
    Select: ({ value, onValueChange, children }: { value: string; onValueChange: (value: string) => void; children: React.ReactNode }) => (
      <select id={findId(children)} value={value} onChange={(event) => onValueChange(event.target.value)}>{children}</select>
    ),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => <option value={value}>{children}</option>,
  }
})

// -- Fixtures ---------------------------------------------------------------------------------------------------------------------------

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ids: Record<GalleryOutputType, number> = { image: 100, video_generation: 200, video_render: 300, static_render: 400 }

function output(type: GalleryOutputType, n: number, overrides: Partial<GalleryOutput> = {}): GalleryOutput {
  const id = uuid(ids[type] + n)
  return {
    key: outputKey(type, id), type, id, mediaType: type === 'image' || type === 'static_render' ? 'image' : 'video',
    title: `${type} ${n}`, prompt: null, occurredAt: `2026-10-${String(20 - n).padStart(2, '0')}T10:00:00.000000Z`,
    occurredAtKind: type === 'video_render' || type === 'static_render' ? 'completed' : 'created',
    projectId: PROJECT, projectName: 'Portal Norte', productionId: PRODUCTION, productionName: 'Campanha de outono', productionState: 'resolved',
    productionHref: `/projetos/${PROJECT}/producoes/${PRODUCTION}`, provenance: null, status: 'generated',
    media: { mimeType: null, durationMs: null, width: null, height: null, provider: null, model: null, mode: null },
    availability: 'unverified', savedLibraryFileIds: [], sourceHref: null, access: accessEndpoints(type, id), ...overrides,
  }
}

const allOk = (): Record<GalleryOutputType, GallerySourceState> => Object.fromEntries(GALLERY_OUTPUT_TYPES.map((type) => [type, { state: 'ok', hasMore: false }])) as never
const sourcesWith = (overrides: Partial<Record<GalleryOutputType, GallerySourceState>>) => ({ ...allOk(), ...overrides })
const envelope = (items: GalleryOutput[], overrides: Partial<GalleryOutputsResponse> = {}): GalleryOutputsResponse => ({
  items, nextCursor: null, hasMore: false, partial: false, limit: 48, sources: allOk(), ...overrides,
})
const exactTotals = (bySource: Partial<Record<GalleryOutputType, number>>) => ({ bySource, global: Object.values(bySource).reduce((a, b) => a + (b ?? 0), 0), globalExact: true })

type Reply = { status?: number; body: unknown } | Promise<{ status?: number; body: unknown }>
let outputCalls: URL[]
let outputsHandler: (url: URL, index: number) => Reply
let mediaStatus: Record<string, number>
let mediaBodies: Record<string, unknown>
let mediaCalls: string[]

const toResponse = ({ status = 200, body }: { status?: number; body: unknown }) => new Response(JSON.stringify(body), { status })

beforeEach(() => {
  push.mockReset()
  outputCalls = []
  mediaStatus = {}
  mediaBodies = {}
  mediaCalls = []
  window.localStorage.clear()
  outputsHandler = () => ({ body: envelope([]) })
  global.fetch = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input), 'http://localhost')
    if (url.pathname === '/api/gallery/outputs') {
      outputCalls.push(url)
      return toResponse(await outputsHandler(url, outputCalls.length - 1))
    }
    mediaCalls.push(url.pathname + url.search)
    const key = url.pathname + url.search
    const status = mediaStatus[key] ?? mediaStatus[url.pathname] ?? 200
    if (status !== 200) return toResponse({ status, body: { error: 'x' } })
    if (mediaBodies[key]) return toResponse({ body: mediaBodies[key] })
    if (url.pathname.endsWith('/signed-url')) return toResponse({ body: { imageUrl: `https://signed.test${url.pathname}.png`, thumbnailUrl: `https://signed.test${url.pathname}.thumb.png`, publicUrl: 'https://x/pub' } })
    if (url.hostname === 'signed.test') return new Response(new Blob(['x'], { type: 'image/png' }), { status: 200 })
    return toResponse({ body: { url: `https://signed.test${url.pathname}${url.search.includes('attachment') ? '.attachment' : '.inline'}`, expiresAt: '2030-01-01T00:00:00Z' } })
  }) as unknown as typeof fetch
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const openGallery = async () => {
  render(<GalleryPage />)
  await waitFor(() => expect(outputCalls.length).toBeGreaterThan(0))
}
const cards = () => screen.queryAllByTestId('gallery-output')
const keysOnScreen = () => cards().map((card) => card.getAttribute('data-key'))
const typeChip = (name: string) => within(screen.getByTestId('gallery-type-chips')).getByRole('button', { name })

// -- The four families ------------------------------------------------------------------------------------------------------------------

describe('Gallery - all four output families, one canonical source', () => {
  it('shows AI images, AI videos, video renders and static renders, each with its own chip, from the one endpoint', async () => {
    const items = [output('image', 1), output('video_generation', 2), output('video_render', 3), output('static_render', 4)]
    outputsHandler = () => ({ body: envelope(items, { totals: exactTotals({ image: 1, video_generation: 1, video_render: 1, static_render: 1 }) }) })
    await openGallery()
    await screen.findAllByTestId('gallery-output')
    expect(keysOnScreen()).toEqual(items.map((item) => item.key))
    expect(cards().map((card) => within(card).getByTestId('gallery-type-chip').textContent)).toEqual(['Imagem IA', 'Vídeo IA', 'Render de vídeo', 'Render estático'])
    expect(outputCalls).toHaveLength(1)
    expect(outputCalls[0].searchParams.get('totals')).toBe('1')
    expect(outputCalls[0].searchParams.get('cursor')).toBeNull()
  })

  it('identifies an output by its typed key: equal ids of different families are two cards', async () => {
    const sameId = uuid(7)
    const items = [output('video_render', 1, { id: sameId, key: outputKey('video_render', sameId) }), output('static_render', 2, { id: sameId, key: outputKey('static_render', sameId) })]
    outputsHandler = () => ({ body: envelope(items) })
    await openGallery()
    await screen.findAllByTestId('gallery-output')
    expect(keysOnScreen()).toEqual([`video_render:${sameId}`, `static_render:${sameId}`])
  })

  it('a saved LibraryFile is a mark on the output, never a second card (several files, one card)', async () => {
    outputsHandler = () => ({ body: envelope([output('static_render', 1, { savedLibraryFileIds: [uuid(1), uuid(2), uuid(3)] }), output('video_render', 2, { savedLibraryFileIds: [uuid(4)] })]) })
    await openGallery()
    await screen.findAllByTestId('gallery-output')
    expect(cards()).toHaveLength(2)
    expect(within(cards()[0]).getByText('Salvo em Arquivos (3)')).toBeTruthy()
    expect(within(cards()[1]).getByText('Salvo em Arquivos')).toBeTruthy()
    expect(screen.queryByText(/Salvar em Arquivos/)).toBeNull() // the Gallery offers no save action
  })

  it('standalone historical AI videos stay visible with no fabricated Session link; Session videos open their Session', async () => {
    outputsHandler = () => ({
      body: envelope([
        output('video_generation', 1, { title: 'Histórico', provenance: { kind: 'video_standalone' }, sourceHref: null }),
        output('video_generation', 2, { title: 'Da sessão', provenance: { kind: 'video_session', sessionId: uuid(9) }, sourceHref: `/videos/geracoes/${uuid(9)}` }),
      ]),
    })
    await openGallery()
    await screen.findAllByTestId('gallery-output')
    const [standalone, session] = cards()
    expect(within(standalone).getByText('Geração avulsa')).toBeTruthy()
    expect(within(standalone).queryByRole('button', { name: /Abrir origem/ })).toBeNull()
    expect(within(standalone).getByRole('button', { name: /Ver Production/ })).toBeTruthy() // the verified Production link is still offered
    fireEvent.click(within(session).getByRole('button', { name: /Abrir origem/ }))
    expect(push).toHaveBeenCalledWith(`/videos/geracoes/${uuid(9)}`)
  })

  it('source navigation: image Session, VideoDraft / Creative Editor, ChannelPiece and Production', async () => {
    const piece = `/projetos/${PROJECT}/conteudos/${uuid(60)}/channel-pieces/${uuid(61)}/editar-visual`
    outputsHandler = () => ({
      body: envelope([
        output('image', 1, { sourceHref: `/imagens/geracoes/${uuid(50)}` }),
        output('video_render', 2, { sourceHref: `/creative-editor/video/${uuid(51)}` }),
        output('static_render', 3, { sourceHref: piece }),
      ]),
    })
    await openGallery()
    await screen.findAllByTestId('gallery-output')
    const clicked: string[] = []
    for (const card of cards()) {
      fireEvent.click(within(card).getByRole('button', { name: /Abrir origem/ }))
      clicked.push(push.mock.calls.at(-1)![0])
    }
    expect(clicked).toEqual([`/imagens/geracoes/${uuid(50)}`, `/creative-editor/video/${uuid(51)}`, piece])
    fireEvent.click(within(cards()[0]).getByRole('button', { name: /Ver Production/ }))
    expect(push).toHaveBeenLastCalledWith(`/projetos/${PROJECT}/producoes/${PRODUCTION}`)
  })

  it('outputs without a Production are shown honestly: unscoped, or conflicting records - never a guessed Production', async () => {
    outputsHandler = () => ({
      body: envelope([
        output('image', 1, { productionId: null, productionName: null, productionState: 'unscoped', productionHref: null }),
        output('image', 2, { productionId: null, productionName: null, productionState: 'conflict', productionHref: null }),
        output('image', 3, { projectId: null, projectName: null, productionId: null, productionName: null, productionState: 'unscoped', productionHref: null }),
      ]),
    })
    await openGallery()
    await screen.findAllByTestId('gallery-output')
    const [unscoped, conflict, orphan] = cards()
    expect(within(unscoped).getByText('Sem Production associada')).toBeTruthy()
    expect(within(conflict).getByText('Production indefinida (registros conflitantes)')).toBeTruthy()
    expect(within(orphan).getByText('Project não identificado')).toBeTruthy()
    for (const card of cards()) expect(within(card).queryByRole('button', { name: /Ver Production/ })).toBeNull()
  })
})

// -- Totals, empty states and honesty ---------------------------------------------------------------------------------------------------

describe('Gallery - honest totals and empty states', () => {
  it('shows exact totals only when the API says they are exact', async () => {
    outputsHandler = () => ({ body: envelope([output('image', 1)], { totals: exactTotals({ image: 5, video_generation: 2, video_render: 1, static_render: 4 }) }) })
    await openGallery()
    await screen.findAllByTestId('gallery-output')
    const totals = screen.getByLabelText('Totais')
    expect(within(totals).getByText('12')).toBeTruthy()
    expect(within(totals).getByText('Imagem IA').nextElementSibling!.textContent).toBe('5')
    expect(screen.getByTestId('gallery-count').textContent).toBe('1 de 12 outputs carregados')
  })

  it('never shows a global total from a partial answer or from missing totals', async () => {
    outputsHandler = () => ({ body: envelope([output('image', 1)], { totals: { bySource: { image: 5, video_generation: null, video_render: 1, static_render: 4 }, global: null, globalExact: false } }) })
    await openGallery()
    await screen.findAllByTestId('gallery-output')
    const totals = screen.getByLabelText('Totais')
    expect(within(totals).getByText('Total exato indisponível')).toBeTruthy()
    expect(within(totals).getByText('Vídeo IA').nextElementSibling!.textContent).toBe('—')
    expect(within(totals).getByText('Imagem IA').nextElementSibling!.textContent).toBe('5') // a per-source number the API reported is still exact
    expect(screen.getByTestId('gallery-count').textContent).not.toMatch(/no total| de \d+ outputs/)

    cleanup()
    outputsHandler = () => ({ body: envelope([output('image', 1)], { partial: true, sources: sourcesWith({ video_generation: { state: 'failed', code: 'X' } }), nextCursor: 'c1', hasMore: true, totals: exactTotals({ image: 1 }) }) })
    await openGallery()
    await screen.findAllByTestId('gallery-output')
    expect(screen.getByTestId('gallery-count').textContent).toBe('1 output carregado · lista incompleta (falha em alguma fonte)')
  })

  it('says "empty" only when every source answered, nothing failed and nothing is left to load', async () => {
    outputsHandler = () => ({ body: envelope([], { totals: exactTotals({ image: 0, video_generation: 0, video_render: 0, static_render: 0 }) }) })
    await openGallery()
    expect(await screen.findByText('Nenhum output concluído ainda')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Ir para Imagens' }))
    expect(push).toHaveBeenCalledWith('/imagens')
    fireEvent.click(screen.getByRole('button', { name: 'Ir para Vídeos' }))
    expect(push).toHaveBeenCalledWith('/videos')
  })

  it('never says "empty" when a source failed or more pages exist', async () => {
    outputsHandler = () => ({ body: envelope([], { partial: true, nextCursor: 'c1', hasMore: true, sources: sourcesWith({ video_render: { state: 'failed', code: 'RENDER_SERVICE_UNAVAILABLE' }, static_render: { state: 'failed', code: 'RENDER_SERVICE_UNAVAILABLE' } }) }) })
    await openGallery()
    expect(await screen.findByText('Ainda não há outputs carregados, mas a lista está incompleta')).toBeTruthy()
    expect(screen.queryByText('Nenhum output concluído ainda')).toBeNull()
    expect(screen.queryByText('Nenhum output encontrado')).toBeNull()
    expect(screen.getAllByText(/renders de vídeo e renders estáticos/).length).toBeGreaterThan(0)

    cleanup()
    outputsHandler = () => ({ body: envelope([], { nextCursor: 'c1', hasMore: true }) })
    await openGallery()
    expect(await screen.findByText('Ainda não há outputs carregados, mas a lista está incompleta')).toBeTruthy()
    expect(screen.getByText('Há mais outputs para carregar. A Galeria não está vazia.')).toBeTruthy()
  })

  it('a complete failure is an error with retry, not an empty Gallery - and the retry reloads', async () => {
    let attempts = 0
    outputsHandler = () => {
      attempts += 1
      return attempts === 1
        ? { status: 503, body: envelope([], { partial: true, nextCursor: 'c', hasMore: true, sources: Object.fromEntries(GALLERY_OUTPUT_TYPES.map((type) => [type, { state: 'failed', code: 'X' }])) as never }) }
        : { body: envelope([output('image', 1)]) }
    }
    await openGallery()
    expect(await screen.findByText('Falha ao carregar a Galeria')).toBeTruthy()
    expect(screen.queryByText('Nenhum output concluído ainda')).toBeNull()
    expect(screen.getByText(/Fontes com falha: imagens IA, vídeos IA, renders de vídeo e renders estáticos/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    await screen.findAllByTestId('gallery-output')
    expect(screen.queryByText('Falha ao carregar a Galeria')).toBeNull()
    expect(outputCalls).toHaveLength(2)
  })

  it('a network error is also an error, not an empty Gallery', async () => {
    outputsHandler = () => Promise.reject(new TypeError('network down'))
    await openGallery()
    expect(await screen.findByText('Falha ao carregar a Galeria')).toBeTruthy()
    expect(screen.queryByText('Nenhum output concluído ainda')).toBeNull()
  })
})

// -- Partial failure and recovery -------------------------------------------------------------------------------------------------------

describe('Gallery - partial source failure and recovery', () => {
  it('keeps the loaded outputs, names the failed sources, and the same retry recovers them in chronological place', async () => {
    const recovered = output('video_generation', 1, { title: 'Recuperado', occurredAt: '2026-10-19T10:00:00.000000Z' })
    outputsHandler = (_url, index) =>
      index === 0
        ? { body: envelope([output('image', 2), output('image', 3)], { partial: true, nextCursor: 'cursor-after-failure', hasMore: true, sources: sourcesWith({ video_generation: { state: 'failed', code: 'VIDEO_GENERATIONS_UNAVAILABLE' } }) }) }
        : { body: envelope([recovered]) }
    await openGallery()
    await screen.findAllByTestId('gallery-output')
    expect(keysOnScreen()).toHaveLength(2)
    expect(screen.getByText('Lista incompleta')).toBeTruthy()
    expect(screen.getByText(/Não foi possível carregar: vídeos IA\./)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    await waitFor(() => expect(cards()).toHaveLength(3))
    expect(outputCalls[1].searchParams.get('cursor')).toBe('cursor-after-failure') // the real continuation cursor
    expect(cards().map((card) => card.getAttribute('data-type'))).toEqual(['video_generation', 'image', 'image']) // newest first again
    expect(screen.queryByText('Lista incompleta')).toBeNull() // the source recovered
    expect(screen.getByText('Todos os outputs foram carregados.')).toBeTruthy()
  })

  it('a still-failing source keeps the banner and never turns into "all loaded"', async () => {
    outputsHandler = () => ({ body: envelope([output('image', 1)], { partial: true, nextCursor: 'c', hasMore: true, sources: sourcesWith({ static_render: { state: 'failed', code: 'X' } }) }) })
    await openGallery()
    await screen.findAllByTestId('gallery-output')
    expect(screen.getByText('Lista incompleta')).toBeTruthy()
    expect(screen.queryByText('Todos os outputs foram carregados.')).toBeNull()
  })
})

// -- Pagination, filters and stale requests -----------------------------------------------------------------------------------------------

describe('Gallery - Carregar mais, filters and in-flight requests', () => {
  it('"Carregar mais" continues with the real cursor, never repeats an output across pages, and ends when the API says so', async () => {
    const first = [output('image', 1), output('image', 2)]
    const second = [output('image', 2), output('image', 3)] // image 2 is delivered again by an overlapping page
    outputsHandler = (_url, index) => (index === 0 ? { body: envelope(first, { nextCursor: 'page-2', hasMore: true }) } : { body: envelope(second) })
    await openGallery()
    await screen.findAllByTestId('gallery-output')
    expect(screen.queryByText('Todos os outputs foram carregados.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Carregar mais' }))
    await waitFor(() => expect(cards()).toHaveLength(3))
    expect(outputCalls[1].searchParams.get('cursor')).toBe('page-2')
    expect(outputCalls[1].searchParams.get('totals')).toBeNull() // totals come from the first page only
    expect(new Set(keysOnScreen()).size).toBe(3)
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).toBeNull()
    expect(screen.getByText('Todos os outputs foram carregados.')).toBeTruthy()
  })

  it('a second click while a page is loading does not send a second request, and the button says it is busy', async () => {
    let release: (reply: { body: unknown }) => void = () => undefined
    outputsHandler = (_url, index) => (index === 0 ? { body: envelope([output('image', 1)], { nextCursor: 'p2', hasMore: true }) } : new Promise((resolve) => { release = resolve }))
    await openGallery()
    await screen.findAllByTestId('gallery-output')
    const button = screen.getByRole('button', { name: 'Carregar mais' })
    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => expect(screen.getByRole('button', { name: /Carregando…/ })).toHaveProperty('disabled', true))
    expect(outputCalls).toHaveLength(2)
    await act(async () => release({ body: envelope([output('image', 2)]) }))
    await waitFor(() => expect(cards()).toHaveLength(2))
  })

  it('a failing "Carregar mais" keeps everything loaded, says so, and can be retried with the same cursor', async () => {
    outputsHandler = (_url, index) => (index === 0 ? { body: envelope([output('image', 1)], { nextCursor: 'p2', hasMore: true }) } : index === 1 ? { status: 500, body: { error: 'x' } } : { body: envelope([output('image', 2)]) })
    await openGallery()
    await screen.findAllByTestId('gallery-output')
    fireEvent.click(screen.getByRole('button', { name: 'Carregar mais' }))
    expect(await screen.findByText('Não foi possível carregar mais outputs agora.')).toBeTruthy()
    expect(cards()).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    await waitFor(() => expect(cards()).toHaveLength(2))
    expect(outputCalls.map((url) => url.searchParams.get('cursor'))).toEqual([null, 'p2', 'p2'])
  })

  it('type chips filter on the SERVER, restart pagination and totals, and need no loaded items to work', async () => {
    outputsHandler = (url, index) => (index === 0 ? { body: envelope([output('image', 1)], { nextCursor: 'p2', hasMore: true }) } : { body: envelope([output('video_render', 2)], { totals: exactTotals({ video_render: 1 }) }) })
    await openGallery()
    await screen.findAllByTestId('gallery-output')
    fireEvent.click(typeChip('Render de vídeo'))
    await waitFor(() => expect(outputCalls).toHaveLength(2))
    expect(outputCalls[1].searchParams.get('type')).toBe('video_render')
    expect(outputCalls[1].searchParams.get('cursor')).toBeNull() // pagination reset
    expect(outputCalls[1].searchParams.get('totals')).toBe('1')
    await waitFor(() => expect(keysOnScreen()).toEqual([`video_render:${uuid(302)}`]))
    expect(typeChip('Render de vídeo').getAttribute('aria-pressed')).toBe('true')
    expect(typeChip('Todos os tipos').getAttribute('aria-pressed')).toBe('false')
  })

  it('selecting every type is the same as selecting none (no redundant filter is sent)', async () => {
    outputsHandler = () => ({ body: envelope([output('image', 1)]) })
    await openGallery()
    await screen.findAllByTestId('gallery-output')
    for (const label of ['Imagem IA', 'Vídeo IA', 'Render de vídeo', 'Render estático']) fireEvent.click(typeChip(label))
    await waitFor(() => expect(outputCalls.length).toBeGreaterThan(1))
    const last = outputCalls.at(-1)!
    expect(last.searchParams.get('type')).toBeNull()
    expect(typeChip('Todos os tipos').getAttribute('aria-pressed')).toBe('true')
  })

  it('Production is a server filter sent alone (its Project is implied) and Project changes reset an incompatible Production', async () => {
    outputsHandler = () => ({ body: envelope([output('image', 1)]) })
    await openGallery()
    await screen.findAllByTestId('gallery-output')
    await waitFor(() => expect(screen.getByLabelText('Production').querySelectorAll('option').length).toBe(3))

    fireEvent.change(screen.getByLabelText('Production'), { target: { value: PRODUCTION } })
    await waitFor(() => expect(outputCalls.at(-1)!.searchParams.get('productionId')).toBe(PRODUCTION))
    expect(outputCalls.at(-1)!.searchParams.get('projectId')).toBeNull()
    expect((screen.getByLabelText('Project') as HTMLSelectElement).value).toBe(PROJECT) // reflects the Production's Project

    fireEvent.change(screen.getByLabelText('Project'), { target: { value: PROJECT_B } })
    await waitFor(() => expect(outputCalls.at(-1)!.searchParams.get('projectId')).toBe(PROJECT_B))
    expect(outputCalls.at(-1)!.searchParams.get('productionId')).toBeNull() // PRODUCTION belongs to another Project
    expect((screen.getByLabelText('Production') as HTMLSelectElement).value).toBe('all')
    expect(Array.from(screen.getByLabelText('Production').querySelectorAll('option')).map((option) => option.getAttribute('value'))).toEqual(['all', PRODUCTION_B])
  })

  it('an empty server-filtered collection that loaded completely says nothing matches, and offers to clear', async () => {
    outputsHandler = (_url, index) => (index === 0 ? { body: envelope([output('image', 1)]) } : { body: envelope([], { totals: exactTotals({ video_generation: 0 }) }) })
    await openGallery()
    await screen.findAllByTestId('gallery-output')
    fireEvent.click(typeChip('Vídeo IA'))
    expect(await screen.findByText('Nenhum output encontrado')).toBeTruthy()
    fireEvent.click(within(screen.getByTestId('gallery-panel')).getByRole('button', { name: 'Limpar filtros' }))
    await waitFor(() => expect(outputCalls.at(-1)!.searchParams.get('type')).toBeNull())
  })

  it('a slow answer for OLD filters can never overwrite the results of newer filters', async () => {
    const releases: Array<(reply: { body: unknown }) => void> = []
    outputsHandler = () => new Promise((resolve) => { releases.push(resolve) })
    await openGallery()
    fireEvent.click(typeChip('Render estático')) // filters change while the first request is still in flight
    await waitFor(() => expect(outputCalls).toHaveLength(2))
    await act(async () => releases[1]({ body: envelope([output('static_render', 1)]) })) // the new filters answer first
    await screen.findAllByTestId('gallery-output')
    expect(keysOnScreen()).toEqual([`static_render:${uuid(401)}`])
    await act(async () => releases[0]({ body: envelope([output('image', 9)]) })) // the OLD request answers late
    expect(keysOnScreen()).toEqual([`static_render:${uuid(401)}`])
    expect(screen.queryByText('image 9')).toBeNull()
  })

  it('a "Carregar mais" in flight when the filters change is dropped, not appended to the new list', async () => {
    let releaseMore: (reply: { body: unknown }) => void = () => undefined
    outputsHandler = (url, index) => {
      if (index === 0) return { body: envelope([output('image', 1)], { nextCursor: 'p2', hasMore: true }) }
      if (url.searchParams.get('cursor') === 'p2') return new Promise((resolve) => { releaseMore = resolve })
      return { body: envelope([output('video_render', 5)]) }
    }
    await openGallery()
    await screen.findAllByTestId('gallery-output')
    fireEvent.click(screen.getByRole('button', { name: 'Carregar mais' }))
    await waitFor(() => expect(outputCalls).toHaveLength(2))
    fireEvent.click(typeChip('Render de vídeo'))
    await waitFor(() => expect(keysOnScreen()).toEqual([`video_render:${uuid(305)}`]))
    await act(async () => releaseMore({ body: envelope([output('image', 7)]) }))
    expect(keysOnScreen()).toEqual([`video_render:${uuid(305)}`])
  })
})

// -- Local search / status ------------------------------------------------------------------------------------------------------------

describe('Gallery - search and status are local and say so', () => {
  it('names the loaded-items scope and never issues a request when searching', async () => {
    outputsHandler = () => ({ body: envelope([output('image', 1, { title: 'Pôr do sol' }), output('video_render', 2, { title: 'Teaser' })], { nextCursor: 'p2', hasMore: true }) })
    await openGallery()
    await screen.findAllByTestId('gallery-output')
    expect(screen.getByLabelText('Buscar nos itens carregados')).toBeTruthy()
    expect(screen.getByLabelText('Status (itens carregados)')).toBeTruthy()
    expect(screen.getByTestId('gallery-filter-scope').textContent).toContain('Busca e status valem apenas para os outputs já carregados')
    fireEvent.change(screen.getByLabelText('Buscar nos itens carregados'), { target: { value: 'teaser' } })
    expect(cards()).toHaveLength(1)
    expect(screen.getByTestId('gallery-count').textContent).toContain('1 correspondem à busca/status')
    expect(outputCalls).toHaveLength(1)
  })

  it('a search that hides every LOADED item does not claim the Gallery is empty, and offers more when there is more', async () => {
    outputsHandler = () => ({ body: envelope([output('image', 1)], { nextCursor: 'p2', hasMore: true }) })
    await openGallery()
    await screen.findAllByTestId('gallery-output')
    fireEvent.change(screen.getByLabelText('Buscar nos itens carregados'), { target: { value: 'zzz' } })
    expect(await screen.findByText('Nenhum output carregado corresponde à busca ou ao status')).toBeTruthy()
    expect(screen.getByText(/Há mais outputs para carregar\./)).toBeTruthy()
    expect(screen.queryByText('Nenhum output concluído ainda')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Limpar busca e status' }))
    await screen.findAllByTestId('gallery-output')
  })

  it('the status filter only narrows the loaded items and derives no totals from them', async () => {
    outputsHandler = () => ({ body: envelope([output('image', 1, { status: 'approved' }), output('image', 2, { status: 'rejected' }), output('video_render', 3)], { totals: exactTotals({ image: 2, video_render: 1 }) }) })
    await openGallery()
    await screen.findAllByTestId('gallery-output')
    fireEvent.change(screen.getByLabelText('Status (itens carregados)'), { target: { value: 'approved' } })
    expect(cards()).toHaveLength(1)
    expect(screen.queryByText('Aprovadas')).toBeNull() // the old "Aprovadas / Geradas" totals (derived from a page) are gone
    expect(within(screen.getByLabelText('Totais')).getByText('3')).toBeTruthy() // the API's exact total is unchanged by a local filter
  })
})

// -- Media ------------------------------------------------------------------------------------------------------------------------------------

describe('Gallery - media through the per-item authenticated endpoints', () => {
  const lastPreview = () => screen.getByRole('dialog')

  beforeEach(() => {
    outputsHandler = () => ({
      body: envelope([
        output('image', 1, { title: 'Imagem A' }),
        output('video_generation', 2, { title: 'Vídeo B' }),
        output('video_render', 3, { title: 'Render C' }),
        output('static_render', 4, { title: 'Render D' }),
      ]),
    })
  })

  const preview = async (title: string) => {
    await screen.findAllByTestId('gallery-output')
    const card = cards().find((entry) => within(entry).queryByText(title))!
    fireEvent.click(within(card).getByRole('button', { name: /Visualizar/ }))
    await screen.findByRole('dialog')
  }

  it('thumbnails of pictures are resolved on demand from their own endpoint; videos get no thumbnail request', async () => {
    await openGallery()
    await screen.findAllByTestId('gallery-output')
    await waitFor(() => expect(cards()[0].querySelector('img')).toBeTruthy())
    expect(mediaCalls).toContain(`/api/images/${uuid(101)}/signed-url`)
    expect(mediaCalls).toContain(`/api/render-executions/${uuid(404)}/output-url`)
    expect(mediaCalls.some((path) => path.includes('/playback-url'))).toBe(false)
    expect(mediaCalls.some((path) => path.includes(`/render-executions/${uuid(303)}/`))).toBe(false)
    expect(within(cards()[1]).getByTestId('gallery-video-placeholder')).toBeTruthy()
    expect(cards()[0].querySelector('img')!.getAttribute('src')).toBe(`https://signed.test/api/images/${uuid(101)}/signed-url.thumb.png`)
  })

  it('previews an AI image as a picture from the image answer shape ({ imageUrl })', async () => {
    await openGallery()
    await preview('Imagem A')
    const image = await within(lastPreview()).findByTestId('gallery-preview-image')
    expect(image.getAttribute('src')).toBe(`https://signed.test/api/images/${uuid(101)}/signed-url.png`)
  })

  it('previews an AI video in a <video> fed by the INLINE playback URL (answer shape { url })', async () => {
    await openGallery()
    await preview('Vídeo B')
    const video = await within(lastPreview()).findByTestId('gallery-preview-video')
    expect(video.tagName).toBe('VIDEO')
    expect(video.getAttribute('src')).toBe(`https://signed.test/api/video-generations/${uuid(202)}/playback-url.inline`)
    expect(mediaCalls).toContain(`/api/video-generations/${uuid(202)}/playback-url`)
    expect(mediaCalls.some((path) => path.includes('attachment'))).toBe(false)
  })

  it('previews a rendered MP4 as video and a static PNG as a picture, both from output-url', async () => {
    await openGallery()
    await preview('Render C')
    expect((await within(lastPreview()).findByTestId('gallery-preview-video')).getAttribute('src')).toBe(`https://signed.test/api/render-executions/${uuid(303)}/output-url.inline`)
    fireEvent.keyDown(lastPreview(), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await preview('Render D')
    const picture = await within(lastPreview()).findByTestId('gallery-preview-image')
    expect(picture.tagName).toBe('IMG')
    expect(picture.getAttribute('src')).toBe(`https://signed.test/api/render-executions/${uuid(404)}/output-url.inline`)
  })

  it('unavailable media is explained in the preview, offers a retry, and the output card stays in the history', async () => {
    mediaStatus[`/api/render-executions/${uuid(303)}/output-url`] = 409
    await openGallery()
    await preview('Render C')
    expect(await within(lastPreview()).findByText(/O arquivo não está disponível agora/)).toBeTruthy()
    expect(within(lastPreview()).queryByTestId('gallery-preview-video')).toBeNull()
    mediaStatus[`/api/render-executions/${uuid(303)}/output-url`] = 200
    fireEvent.click(within(lastPreview()).getByRole('button', { name: /Tentar novamente/ }))
    expect(await within(lastPreview()).findByTestId('gallery-preview-video')).toBeTruthy()
    expect(keysOnScreen()).toContain(`video_render:${uuid(303)}`)
  })

  it('an inaccessible or failing endpoint never removes a card, and the other families keep working', async () => {
    mediaStatus[`/api/images/${uuid(101)}/signed-url`] = 404
    mediaStatus[`/api/render-executions/${uuid(404)}/output-url`] = 500
    await openGallery()
    await screen.findAllByTestId('gallery-output')
    await waitFor(() => expect(within(cards()[0]).getByText('Imagem indisponível')).toBeTruthy())
    expect(within(cards()[3]).getByText('Render indisponível')).toBeTruthy()
    expect(cards()).toHaveLength(4)
    await preview('Vídeo B')
    expect(await within(lastPreview()).findByTestId('gallery-preview-video')).toBeTruthy()
  })

  it('an expired thumbnail URL is re-requested once before the placeholder appears', async () => {
    await openGallery()
    await screen.findAllByTestId('gallery-output')
    const img = await waitFor(() => { const found = cards()[0].querySelector('img'); expect(found).toBeTruthy(); return found! })
    const before = mediaCalls.filter((path) => path === `/api/images/${uuid(101)}/signed-url`).length
    fireEvent.error(img)
    await waitFor(() => expect(mediaCalls.filter((path) => path === `/api/images/${uuid(101)}/signed-url`).length).toBe(before + 1))
    fireEvent.error(cards()[0].querySelector('img')!)
    await waitFor(() => expect(within(cards()[0]).getByText('Imagem indisponível')).toBeTruthy())
  })

  it('downloads a video, a render and a static PNG through the ATTACHMENT endpoint and navigates only to the resolved URL', async () => {
    const hrefs: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { hrefs.push(this.href) })
    await openGallery()
    await screen.findAllByTestId('gallery-output')
    for (const index of [1, 2, 3]) fireEvent.click(within(cards()[index]).getByRole('button', { name: /Baixar/ }))
    await waitFor(() => expect(hrefs).toHaveLength(3))
    expect(hrefs).toEqual([
      `https://signed.test/api/video-generations/${uuid(202)}/playback-url.attachment`,
      `https://signed.test/api/render-executions/${uuid(303)}/output-url.attachment`,
      `https://signed.test/api/render-executions/${uuid(404)}/output-url.attachment`,
    ])
    expect(hrefs.some((href) => href.includes('/api/') && !href.startsWith('https://signed.test'))).toBe(false) // never the raw endpoint
    expect(mediaCalls).toContain(`/api/video-generations/${uuid(202)}/playback-url?disposition=attachment`)
  })

  it('downloads an AI image by its resolved URL (as a named file)', async () => {
    const hrefs: string[] = []
    const names: string[] = []
    ;(window.URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:image'
    ;(window.URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => undefined
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { hrefs.push(this.href); names.push(this.download) })
    await openGallery()
    await screen.findAllByTestId('gallery-output')
    fireEvent.click(within(cards()[0]).getByRole('button', { name: /Baixar/ }))
    await waitFor(() => expect(hrefs).toEqual(['blob:image']))
    expect(names[0]).toBe('imagem-a.png')
  })

  it('a failed download is reported without touching the list', async () => {
    mediaStatus[`/api/video-generations/${uuid(202)}/playback-url`] = 404
    await openGallery()
    await screen.findAllByTestId('gallery-output')
    fireEvent.click(within(cards()[1]).getByRole('button', { name: /Baixar/ }))
    expect(await screen.findByText('Não foi possível baixar o vídeo.')).toBeTruthy()
    expect(cards()).toHaveLength(4)
  })

  it('never keeps a signed URL as the identity of an output: the list carries paths only, URLs live in the dialog/card state', async () => {
    await openGallery()
    await screen.findAllByTestId('gallery-output')
    for (const card of cards()) expect(card.getAttribute('data-key')).toMatch(/^(image|video_generation|video_render|static_render):[0-9a-f-]{36}$/)
  })
})

// -- A signed URL that does not load -------------------------------------------------------------------------------------------------------

describe('Gallery - the endpoint answers 200 but the object cannot be loaded', () => {
  const renderPath = `/api/render-executions/${uuid(303)}/output-url`
  const imagePath = `/api/images/${uuid(101)}/signed-url`
  const lastPreview = () => screen.getByRole('dialog')
  const callsTo = (path: string) => mediaCalls.filter((call) => call === path).length
  const errorText = /O arquivo não está disponível agora/

  beforeEach(() => {
    outputsHandler = () => ({
      body: envelope([
        output('image', 1, { title: 'Imagem A' }),
        output('video_generation', 2, { title: 'Vídeo B' }),
        output('video_render', 3, { title: 'Render C' }),
        output('static_render', 4, { title: 'Render D' }),
      ]),
    })
  })

  const preview = async (title: string) => {
    await screen.findAllByTestId('gallery-output')
    const card = cards().find((entry) => within(entry).queryByText(title))!
    fireEvent.click(within(card).getByRole('button', { name: /Visualizar/ }))
    await screen.findByRole('dialog')
  }

  it('a picture that fails to load shows an explicit error instead of a broken element, and the card stays', async () => {
    await openGallery()
    await preview('Imagem A')
    const image = await within(lastPreview()).findByTestId('gallery-preview-image')
    fireEvent.error(image)
    expect(await within(lastPreview()).findByText(errorText)).toBeTruthy()
    expect(within(lastPreview()).getByRole('alert')).toBeTruthy()
    expect(within(lastPreview()).queryByTestId('gallery-preview-image')).toBeNull()
    expect(within(lastPreview()).getByRole('button', { name: /Tentar novamente/ })).toBeTruthy()
    expect(cards()).toHaveLength(4)
    expect(keysOnScreen()).toContain(`image:${uuid(101)}`)
  })

  it('a video that fails to load or play shows the same explicit error - AI video and rendered MP4', async () => {
    await openGallery()
    await preview('Vídeo B')
    fireEvent.error(await within(lastPreview()).findByTestId('gallery-preview-video'))
    expect(await within(lastPreview()).findByText(errorText)).toBeTruthy()
    expect(within(lastPreview()).queryByTestId('gallery-preview-video')).toBeNull()
    fireEvent.keyDown(lastPreview(), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    await preview('Render C')
    fireEvent.error(await within(lastPreview()).findByTestId('gallery-preview-video'))
    expect(await within(lastPreview()).findByText(errorText)).toBeTruthy()
    expect(cards()).toHaveLength(4)
  })

  it('"Tentar novamente" asks the existing endpoint for a FRESH url, clears the error and restores the preview', async () => {
    await openGallery()
    await preview('Render C')
    const first = await within(lastPreview()).findByTestId('gallery-preview-video')
    expect(first.getAttribute('src')).toBe(`https://signed.test${renderPath}.inline`)
    fireEvent.error(first)
    await within(lastPreview()).findByText(errorText)
    const before = callsTo(renderPath)

    mediaBodies[renderPath] = { url: 'https://signed.test/fresh/render.mp4', expiresAt: '2030-01-01T00:00:00Z' }
    fireEvent.click(within(lastPreview()).getByRole('button', { name: /Tentar novamente/ }))
    const restored = await within(lastPreview()).findByTestId('gallery-preview-video')
    expect(callsTo(renderPath)).toBe(before + 1)
    expect(restored.getAttribute('src')).toBe('https://signed.test/fresh/render.mp4') // a new transient URL, not the failed one
    expect(within(lastPreview()).queryByText(errorText)).toBeNull()
    expect(within(lastPreview()).queryByRole('alert')).toBeNull()
    expect(mediaCalls.some((call) => call.includes('attachment'))).toBe(false) // still the inline endpoint
  })

  it('a retry that fails again shows the error again - one request per click, never an automatic loop', async () => {
    await openGallery()
    await preview('Imagem A')
    fireEvent.error(await within(lastPreview()).findByTestId('gallery-preview-image'))
    await within(lastPreview()).findByText(errorText)
    const afterFirstError = callsTo(imagePath)
    await new Promise((resolve) => setTimeout(resolve, 80)) // nothing retries by itself
    expect(callsTo(imagePath)).toBe(afterFirstError)

    fireEvent.click(within(lastPreview()).getByRole('button', { name: /Tentar novamente/ }))
    fireEvent.error(await within(lastPreview()).findByTestId('gallery-preview-image'))
    expect(await within(lastPreview()).findByText(errorText)).toBeTruthy()
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(callsTo(imagePath)).toBe(afterFirstError + 1)
    expect(cards()).toHaveLength(4)
  })

  it('a retry whose endpoint now refuses replaces the element error with the endpoint\'s own explanation (nothing stale is kept)', async () => {
    await openGallery()
    await preview('Render C')
    fireEvent.error(await within(lastPreview()).findByTestId('gallery-preview-video'))
    await within(lastPreview()).findByText(errorText)
    mediaStatus[renderPath] = 404
    fireEvent.click(within(lastPreview()).getByRole('button', { name: /Tentar novamente/ }))
    expect(await within(lastPreview()).findByText(errorText)).toBeTruthy()
    expect(within(lastPreview()).queryByTestId('gallery-preview-video')).toBeNull()
    mediaStatus[renderPath] = 200
    fireEvent.click(within(lastPreview()).getByRole('button', { name: /Tentar novamente/ }))
    expect(await within(lastPreview()).findByTestId('gallery-preview-video')).toBeTruthy()
  })

  it('switching outputs cannot retain an old error: the next output starts clean, and reopening the failed one asks again', async () => {
    await openGallery()
    await preview('Render C')
    fireEvent.error(await within(lastPreview()).findByTestId('gallery-preview-video'))
    await within(lastPreview()).findByText(errorText)
    fireEvent.keyDown(lastPreview(), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    await preview('Render D')
    expect(await within(lastPreview()).findByTestId('gallery-preview-image')).toBeTruthy()
    expect(within(lastPreview()).queryByText(errorText)).toBeNull()
    expect(within(lastPreview()).queryByRole('alert')).toBeNull()
    fireEvent.keyDown(lastPreview(), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    const before = callsTo(renderPath)
    await preview('Render C')
    expect(await within(lastPreview()).findByTestId('gallery-preview-video')).toBeTruthy() // fresh attempt, not the remembered failure
    expect(within(lastPreview()).queryByText(errorText)).toBeNull()
    expect(callsTo(renderPath)).toBe(before + 1)
  })

  it('keeps the signed URL transient: it is element state only - never an identity, a key or an attribute of the output', async () => {
    await openGallery()
    await preview('Render C')
    const video = await within(lastPreview()).findByTestId('gallery-preview-video')
    fireEvent.error(video)
    await within(lastPreview()).findByText(errorText)
    for (const card of cards()) {
      for (const name of card.getAttributeNames()) expect(card.getAttribute(name)).not.toContain('signed.test')
    }
    expect(keysOnScreen().every((key) => /^[a-z_]+:[0-9a-f-]{36}$/.test(key!))).toBe(true)
  })

  // -- Download fallback --------------------------------------------------------------------------------------------------------------

  it('image download: when the fetch fails and the browser blocks the fallback window, the failure is REPORTED, not hidden', async () => {
    mediaStatus[`${imagePath}.png`] = 500 // the blob fetch of the resolved image URL fails
    const open = vi.spyOn(window, 'open').mockReturnValue(null) // pop-up blocked
    await openGallery()
    await screen.findAllByTestId('gallery-output')
    fireEvent.click(within(cards()[0]).getByRole('button', { name: /Baixar/ }))
    expect(await screen.findByText(/o navegador bloqueou a abertura/)).toBeTruthy()
    expect(open).toHaveBeenCalledTimes(1)
    expect(cards()).toHaveLength(4)
  })

  it('image download: the fallback window counts as success only when it really opened (and is detached from the page)', async () => {
    mediaStatus[`${imagePath}.png`] = 500
    const opened = { opener: 'page' } as unknown as Window
    const open = vi.spyOn(window, 'open').mockReturnValue(opened)
    await openGallery()
    await screen.findAllByTestId('gallery-output')
    fireEvent.click(within(cards()[0]).getByRole('button', { name: /Baixar/ }))
    await waitFor(() => expect(open).toHaveBeenCalledWith(`https://signed.test${imagePath}.png`, '_blank'))
    expect(opened.opener).toBeNull()
    expect(screen.queryByText(/Ação não concluída/)).toBeNull()
  })

  it('a browser that refuses to start a video/render download is a reported failure', async () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { throw new Error('download blocked') })
    await openGallery()
    await screen.findAllByTestId('gallery-output')
    fireEvent.click(within(cards()[1]).getByRole('button', { name: /Baixar/ }))
    expect(await screen.findByText('Não foi possível baixar o vídeo.')).toBeTruthy()
    expect(cards()).toHaveLength(4)
  })

  it('a successful download clears a previous failure message', async () => {
    mediaStatus[`/api/video-generations/${uuid(202)}/playback-url`] = 404
    const hrefs: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { hrefs.push(this.href) })
    await openGallery()
    await screen.findAllByTestId('gallery-output')
    fireEvent.click(within(cards()[1]).getByRole('button', { name: /Baixar/ }))
    await screen.findByText('Não foi possível baixar o vídeo.')
    mediaStatus[`/api/video-generations/${uuid(202)}/playback-url`] = 200
    fireEvent.click(within(cards()[1]).getByRole('button', { name: /Baixar/ }))
    await waitFor(() => expect(screen.queryByText('Não foi possível baixar o vídeo.')).toBeNull())
    expect(hrefs).toHaveLength(1)
  })
})

// -- Layouts ------------------------------------------------------------------------------------------------------------------------------

describe('Gallery - Cards and Lista', () => {
  it('both modes show the same outputs with the same actions', async () => {
    outputsHandler = () => ({ body: envelope([output('image', 1, { sourceHref: `/imagens/geracoes/${uuid(1)}` }), output('video_render', 2)]) })
    await openGallery()
    await screen.findAllByTestId('gallery-output')
    const names = (scope: HTMLElement) => within(scope).getAllByRole('button').map((button) => button.textContent?.trim())
    const cardActions = cards().map((card) => names(card))
    fireEvent.click(screen.getByRole('button', { name: 'Lista' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lista' }).getAttribute('aria-pressed')).toBe('true'))
    expect(keysOnScreen()).toEqual([`image:${uuid(101)}`, `video_render:${uuid(302)}`])
    expect(cards().map((card) => names(card))).toEqual(cardActions)
    expect(screen.getByText('Mídia')).toBeTruthy() // the list header
  })
})
