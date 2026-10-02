// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { OpenInEditorButton } from './open-in-editor'

// GENERATED_MEDIA_TO_CREATIVE_EDITOR_HANDOFF_V1 — the target chooser. Every request is a mocked fetch.

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn() }) }))
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))

const fetchMock = vi.fn()
const FILE = '11111111-1111-4111-8111-111111111111'
const PROJECT = '22222222-2222-4222-8222-222222222222'

const file = (overrides: Record<string, unknown> = {}) => ({ id: FILE, name: 'gerada.png', kind: 'image', mimeType: 'image/png', projectId: PROJECT, productionId: 'prod-a', productionTitle: 'Production A', ...overrides })
const staticTarget = { channelPieceId: 'cp-1', editorialContentId: 'ec-1', title: 'Carrossel A', editorialContentTitle: 'Conteúdo A', formatLabel: 'Instagram Carousel', productionId: 'prod-a', productionTitle: 'Production A', href: `/projetos/${PROJECT}/conteudos/ec-1/channel-pieces/cp-1/editar-visual?media=${FILE}` }
const videoTarget = { draftId: 'vd-1', name: 'Rascunho A', productionId: 'prod-b', productionTitle: 'Production B', href: `/creative-editor/video/vd-1?media=${FILE}` }

let payload: Record<string, unknown>
let status = 200
beforeEach(() => {
  vi.clearAllMocks()
  status = 200
  payload = { file: file(), static: { items: [staticTarget], truncated: false }, video: { items: [videoTarget], truncated: false } }
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(payload), { status }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const open = async () => {
  render(<OpenInEditorButton libraryFileId={FILE} />)
  fireEvent.click(screen.getByTestId('open-in-editor'))
  return screen.findByTestId('open-in-editor-dialog')
}

describe('OpenInEditorButton (target chooser)', () => {
  it('costs nothing until opened: no request, no dialog', () => {
    render(<OpenInEditorButton libraryFileId={FILE} />)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByTestId('open-in-editor-dialog')).toBeNull()
  })

  it('image: offers both families, with real names, from ONE read-only request carrying only the LibraryFile id', async () => {
    await open()
    expect(await screen.findByTestId('handoff-static-target')).toBeTruthy()
    expect(screen.getByTestId('handoff-video-target')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toBe(`/api/library-files/${FILE}/handoff`)
    expect(fetchMock.mock.calls[0][1]?.method ?? 'GET').toBe('GET')
    expect(screen.getByText('Carrossel A')).toBeTruthy()
    expect(screen.getByText(/Conteúdo A · Instagram Carousel/)).toBeTruthy()
    expect(screen.getByText('Rascunho A')).toBeTruthy()
  })

  it('marks the same-Production target with text (never colour-only)', async () => {
    await open()
    await screen.findByTestId('handoff-static-target')
    expect(screen.getByText(/Production: Production A · mesma da mídia/)).toBeTruthy()
    expect(screen.getByText(/^Production: Production B$/)).toBeTruthy()
  })

  it('video: does not offer the Static editor at all', async () => {
    payload = { file: file({ kind: 'video', mimeType: 'video/mp4', name: 'clipe.mp4' }), static: { items: [], truncated: false }, video: { items: [videoTarget], truncated: false } }
    await open()
    await screen.findByTestId('handoff-video-target')
    expect(screen.queryByTestId('handoff-static-targets')).toBeNull()
    expect(screen.queryByTestId('handoff-static-target')).toBeNull()
  })

  it('navigates to the canonical editor URL carrying only the media id, then closes', async () => {
    await open()
    fireEvent.click(await screen.findByTestId('handoff-static-target'))
    expect(push).toHaveBeenCalledWith(`/projetos/${PROJECT}/conteudos/ec-1/channel-pieces/cp-1/editar-visual?media=${FILE}`)
    await waitFor(() => expect(screen.queryByTestId('open-in-editor-dialog')).toBeNull())

    cleanup()
    push.mockClear()
    await open()
    fireEvent.click(await screen.findByTestId('handoff-video-target'))
    expect(push).toHaveBeenCalledWith(`/creative-editor/video/vd-1?media=${FILE}`)
    // Navigation only: the chooser issued nothing but the one GET (no promotion, no creation).
    expect(fetchMock.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true)
  })

  it('a Project without compatible targets shows the truthful empty state and offers no target creation', async () => {
    payload = { file: file(), static: { items: [], truncated: false }, video: { items: [], truncated: false } }
    await open()
    const empty = await screen.findByTestId('handoff-empty')
    expect(empty.textContent).toContain('Nenhum destino compatível existente neste Projeto.')
    expect(screen.queryByText(/Criar/)).toBeNull()
    expect(empty.querySelector('a')?.getAttribute('href')).toBe(`/projetos/${PROJECT}`)
    expect(push).not.toHaveBeenCalled()
  })

  it('a Static family blocked by the Project Identity gate says so and keeps the Video target openable', async () => {
    payload = { file: file(), static: { items: [], truncated: false, blockedReason: 'PROJECT_IDENTITY_REQUIRED' }, video: { items: [videoTarget], truncated: false } }
    await open()
    expect((await screen.findByTestId('handoff-static-empty')).textContent).toContain('Identidade válida')
    expect(screen.queryByTestId('handoff-static-target')).toBeNull()
    fireEvent.click(screen.getByTestId('handoff-video-target'))
    expect(push).toHaveBeenCalledWith(`/creative-editor/video/vd-1?media=${FILE}`)
  })

  it('a stale / deleted / foreign file shows the server\'s bounded error and no targets', async () => {
    status = 404
    payload = { error: 'Este arquivo não foi encontrado ou foi removido de Arquivos.', code: 'NOT_FOUND' }
    await open()
    expect((await screen.findByTestId('open-in-editor-error')).textContent).toContain('removido de Arquivos')
    expect(screen.queryByTestId('handoff-static-target')).toBeNull()
  })

  it('an unsupported kind has no target and says so', async () => {
    payload = { file: file({ kind: 'audio', mimeType: 'audio/mpeg' }), static: { items: [], truncated: false }, video: { items: [], truncated: false } }
    await open()
    expect((await screen.findByTestId('handoff-unsupported')).textContent).toContain('não pode ser aberto')
    expect(screen.queryByTestId('handoff-empty')).toBeNull()
  })

  it('is a real dialog with a title, a description and labelled, keyboard-focusable targets', async () => {
    await open()
    await screen.findByTestId('handoff-static-target')
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Abrir no editor' })).toBeTruthy()
    const targetButton = screen.getByRole('button', { name: /Abrir no editor estático: Carrossel A, Instagram Carousel/ })
    targetButton.focus()
    expect(document.activeElement).toBe(targetButton)
    expect(screen.getByRole('button', { name: 'Abrir no editor de vídeo: Rascunho A' })).toBeTruthy()
  })

  it('notes truncation honestly when more targets exist than are shown', async () => {
    payload = { file: file(), static: { items: [staticTarget], truncated: true }, video: { items: [videoTarget], truncated: false } }
    await open()
    expect((await screen.findByText('Mostrando os conteúdos editoriais mais recentes.'))).toBeTruthy()
  })
})
