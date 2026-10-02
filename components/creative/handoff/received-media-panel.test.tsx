// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReceivedMediaPanel, type ReceivedMediaAction } from './received-media-panel'
import type { LibraryFile } from '@/lib/types'
import type { ReceivingTarget } from '@/lib/creative/handoff/media-handoff'

// GENERATED_MEDIA_TO_CREATIVE_EDITOR_HANDOFF_V1 — the receiving side. Every request is a mocked fetch:
// no server, storage or provider is contacted. The invariant under test: OPEN != USE.

const MEDIA_ID = '11111111-1111-4111-8111-111111111111'
const PROJECT_ID = '22222222-2222-4222-8222-222222222222'
const DRAFT_ID = '55555555-5555-4555-8555-555555555555'
const CONTENT_ID = '33333333-3333-4333-8333-333333333333'
const PIECE_ID = '44444444-4444-4444-8444-444444444444'

let search = `media=${MEDIA_ID}`
const replace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => '/creative-editor/video/draft-1',
  useSearchParams: () => new URLSearchParams(search),
}))

const fetchMock = vi.fn()
const image = { id: MEDIA_ID, name: 'capa-gerada.png', kind: 'image', mime_type: 'image/png', project_id: PROJECT_ID, public_url: 'https://signed.example/a.png', thumbnail_url: 'https://signed.example/a.png' } as unknown as LibraryFile
const video = { ...image, name: 'clipe.mp4', kind: 'video', mime_type: 'video/mp4', public_url: 'https://signed.example/v.mp4', thumbnail_url: null } as unknown as LibraryFile

let reply: () => Response
beforeEach(() => {
  vi.clearAllMocks()
  search = `media=${MEDIA_ID}`
  reply = () => new Response(JSON.stringify({ file: image }), { status: 200 })
  fetchMock.mockImplementation(async () => reply())
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const run = vi.fn()
const actions = (): ReceivedMediaAction[] => [{ key: 'add', label: 'Adicionar', hint: 'Adiciona o arquivo', run: (file) => run(file) }]
const VIDEO_TARGET = { editor: 'video', draftId: DRAFT_ID } as const
const STATIC_TARGET = { editor: 'static', projectId: PROJECT_ID, editorialContentId: CONTENT_ID, channelPieceId: PIECE_ID } as const
const mount = (props: Partial<{ target: ReceivingTarget | null }> = {}) =>
  render(<ReceivedMediaPanel target={props.target === undefined ? VIDEO_TARGET : props.target} actionsFor={actions} />)
const onlyReads = () => fetchMock.mock.calls.every(([, request]) => !request?.method || request.method === 'GET')

describe('ReceivedMediaPanel — opening is read-only', () => {
  it('validates through ONE GET (the real editor target, not a bare Project) and applies nothing', async () => {
    mount()
    expect((await screen.findByTestId('received-media-name')).textContent).toBe('capa-gerada.png')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(`/api/library-files/${MEDIA_ID}/handoff-media?editor=video&draftId=${DRAFT_ID}`)
    expect(init?.method ?? 'GET').toBe('GET')
    // No authoring action ran, nothing was written, and the panel states that plainly.
    expect(run).not.toHaveBeenCalled()
    expect(onlyReads()).toBe(true)
    expect(screen.getByTestId('received-media-kind').textContent).toContain('ainda não usada')
    expect(replace).not.toHaveBeenCalled()
  })

  it('refresh / re-open shows the same state again and still applies nothing (no duplicate insertion)', async () => {
    const first = mount()
    await screen.findByTestId('received-media-name')
    first.unmount()
    mount()
    await screen.findByTestId('received-media-name')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(run).not.toHaveBeenCalled()
    expect(onlyReads()).toBe(true)
  })

  it('does nothing without a media param, with a malformed one, or before the editor has its target', () => {
    search = ''
    const a = mount()
    expect(a.container.innerHTML).toBe('')
    a.unmount()
    search = 'media=not-a-uuid'
    const b = mount()
    expect(b.container.innerHTML).toBe('')
    b.unmount()
    search = `media=${MEDIA_ID}`
    const c = mount({ target: null })
    expect(c.container.innerHTML).toBe('')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows a received video with its kind and the compatible action', async () => {
    reply = () => new Response(JSON.stringify({ file: video }), { status: 200 })
    mount()
    expect((await screen.findByTestId('received-media-name')).textContent).toBe('clipe.mp4')
    expect(screen.getByTestId('received-media-kind').textContent).toContain('Vídeo')
    expect(screen.getByTestId('received-media-action-add')).toBeTruthy()
  })

  it('asks the server with the full Static target chain, so the Project is derived there', async () => {
    mount({ target: STATIC_TARGET })
    await screen.findByTestId('received-media-name')
    expect(String(fetchMock.mock.calls[0][0])).toBe(`/api/library-files/${MEDIA_ID}/handoff-media?editor=static&projectId=${PROJECT_ID}&editorialContentId=${CONTENT_ID}&channelPieceId=${PIECE_ID}`)
  })

  it('does not re-validate when the parent re-renders with an equal (new object) target', async () => {
    const view = mount({ target: { ...VIDEO_TARGET } })
    await screen.findByTestId('received-media-name')
    view.rerender(<ReceivedMediaPanel target={{ ...VIDEO_TARGET }} actionsFor={actions} />)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('ReceivedMediaPanel — explicit use', () => {
  it('runs the editor-supplied action exactly once, with the validated file, and keeps a truthful confirmation', async () => {
    mount()
    fireEvent.click(await screen.findByTestId('received-media-action-add'))
    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith(image)
    // The param is cleared for UX only (replace, not push); correctness never depends on it.
    expect(replace).toHaveBeenCalledWith('/creative-editor/video/draft-1', { scroll: false })
    expect(screen.getByTestId('received-media').getAttribute('data-phase')).toBe('used')
    expect(screen.getByTestId('received-media-kind').textContent).toContain('Clique em Salvar para persistir')
    expect(screen.queryByTestId('received-media-action-add')).toBeNull()
  })

  it('issues no write request itself when the action runs (use is the editor responsibility, not the panel)', async () => {
    mount()
    fireEvent.click(await screen.findByTestId('received-media-action-add'))
    expect(onlyReads()).toBe(true)
  })
})

describe('ReceivedMediaPanel — invalid, stale and dismissed media', () => {
  it.each([
    ['deleted / unknown', 404, 'Este arquivo não foi encontrado ou foi removido de Arquivos.'],
    ['other Project', 409, 'Este arquivo pertence a outro Projeto e não pode ser usado aqui.'],
    ['unsupported kind', 422, 'Este tipo de arquivo não pode ser usado neste editor.'],
  ])('%s shows a bounded alert, offers no use action, and never calls the editor', async (_label, status, message) => {
    reply = () => new Response(JSON.stringify({ error: message, code: 'X' }), { status })
    mount()
    const alert = await screen.findByTestId('received-media-error')
    expect(alert.textContent).toContain(message)
    expect(screen.queryByTestId('received-media-action-add')).toBeNull()
    expect(run).not.toHaveBeenCalled()
  })

  it('a network failure is a bounded error, not a crash', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    mount()
    expect((await screen.findByTestId('received-media-error')).textContent).toContain('Não foi possível validar a mídia recebida.')
  })

  it('can be dismissed by a keyboard-reachable control; it clears the param and stays dismissed', async () => {
    mount()
    await screen.findByTestId('received-media-name')
    const dismiss = screen.getByRole('button', { name: 'Dispensar mídia recebida' })
    dismiss.focus()
    expect(document.activeElement).toBe(dismiss)
    fireEvent.click(dismiss)
    expect(screen.queryByTestId('received-media')).toBeNull()
    expect(replace).toHaveBeenCalledWith('/creative-editor/video/draft-1', { scroll: false })
    expect(run).not.toHaveBeenCalled()
  })

  it('keeps other query params when clearing the media param', async () => {
    search = `foo=bar&media=${MEDIA_ID}`
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Dispensar mídia recebida' }))
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/creative-editor/video/draft-1?foo=bar', { scroll: false }))
  })

  it('is exposed as a labelled region with the name and kind as text (never colour-only)', async () => {
    mount()
    await screen.findByTestId('received-media-name')
    expect(screen.getByRole('region', { name: 'Mídia recebida' })).toBeTruthy()
    expect(screen.getByTestId('received-media-kind').textContent).toContain('Imagem')
  })
})
