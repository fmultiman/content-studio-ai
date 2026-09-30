// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SaveImageToLibrary } from './save-image-to-library'
import { ImageResult } from './image-result'

// GENERATED_IMAGE_LIBRARY_PROMOTION_V1 — the "Salvar em Arquivos" action on /imagens.
// Every request is a mocked fetch: no server, storage or provider is contacted.

const toast = vi.fn()
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }))
vi.mock('next/image', () => ({ default: (props: any) => <span data-testid="next-image" data-src={props.src} /> }))

const fetchMock = vi.fn()
const FILE_ID = 'lf-1'

let serverState: { available: boolean; saved: { id: string } | null; promotable: boolean }

const createdResponse = (result = 'created') => new Response(JSON.stringify({ result, libraryFile: { id: FILE_ID } }), { status: result === 'created' ? 201 : 200 })
const stateResponse = () => new Response(JSON.stringify(serverState), { status: 200 })

beforeEach(() => {
  vi.clearAllMocks()
  serverState = { available: true, saved: null, promotable: true }
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => (init?.method === 'POST' ? createdResponse() : stateResponse()))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')
const gets = () => fetchMock.mock.calls.filter(([, init]) => !init?.method)
const button = () => screen.findByTestId('save-image-to-library')

describe('SaveImageToLibrary', () => {
  it('a generated, unsaved image shows the explicit action (state read from the server)', async () => {
    render(<SaveImageToLibrary imageId="img-1" />)
    expect((await button()).textContent).toContain('Salvar em Arquivos')
    expect(gets()[0][0]).toBe('/api/images/img-1/save-to-library')
    expect(posts()).toHaveLength(0)
  })

  it('shows nothing without an image, when unavailable, or when the image is not promotable', async () => {
    const { rerender } = render(<SaveImageToLibrary imageId={null} />)
    expect(screen.queryByTestId('save-image-to-library')).toBeNull()

    serverState = { available: false, saved: null, promotable: false }
    rerender(<SaveImageToLibrary imageId="img-1" />)
    await waitFor(() => expect(gets()).toHaveLength(1))
    expect(screen.queryByTestId('save-image-to-library')).toBeNull()
    expect(screen.queryByTestId('image-saved-to-library')).toBeNull()

    serverState = { available: true, saved: null, promotable: false }
    rerender(<SaveImageToLibrary imageId="img-2" />)
    await waitFor(() => expect(gets()).toHaveLength(2))
    expect(screen.queryByTestId('save-image-to-library')).toBeNull()
  })

  it('a failed state lookup never offers a save action', async () => {
    fetchMock.mockImplementation(async () => new Response('{}', { status: 500 }))
    render(<SaveImageToLibrary imageId="img-1" />)
    await waitFor(() => expect(gets()).toHaveLength(1))
    expect(screen.queryByTestId('save-image-to-library')).toBeNull()
  })

  it('an already-saved image (server state, i.e. after a reload) shows the persistent saved state and no armed action', async () => {
    serverState = { available: true, saved: { id: FILE_ID }, promotable: true }
    render(<SaveImageToLibrary imageId="img-1" />)
    const saved = await screen.findByTestId('image-saved-to-library')
    expect(saved.textContent).toContain('Salvo em Arquivos')
    expect(saved.getAttribute('href')).toBe('/arquivos')
    expect(screen.queryByTestId('save-image-to-library')).toBeNull()
    expect(posts()).toHaveLength(0)
  })

  it('reload preserves the saved state: a fresh mount after saving reads it from the server', async () => {
    const first = render(<SaveImageToLibrary imageId="img-1" />)
    fireEvent.click(await button())
    await screen.findByTestId('image-saved-to-library')
    first.unmount()

    serverState = { available: true, saved: { id: FILE_ID }, promotable: true }
    render(<SaveImageToLibrary imageId="img-1" />)
    expect(await screen.findByTestId('image-saved-to-library')).toBeTruthy()
  })

  it('a LibraryFile moved to Trash reads as not saved (server: saved null): the action returns', async () => {
    serverState = { available: true, saved: null, promotable: true }
    render(<SaveImageToLibrary imageId="img-1" />)
    expect(await button()).toBeTruthy()
    expect(screen.queryByTestId('image-saved-to-library')).toBeNull()
  })

  it('sends only the image id — no path, project or body', async () => {
    render(<SaveImageToLibrary imageId="img-1" />)
    fireEvent.click(await button())
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(posts()[0][0]).toBe('/api/images/img-1/save-to-library')
    expect(posts()[0][1]).toEqual({ method: 'POST' })
  })

  it('locks the action while pending; a double click sends exactly one request', async () => {
    let release!: () => void
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method !== 'POST') return Promise.resolve(stateResponse())
      return new Promise<Response>((resolve) => {
        release = () => resolve(createdResponse())
      })
    })
    render(<SaveImageToLibrary imageId="img-1" />)
    const element = await button()
    act(() => {
      element.click()
      element.click()
    })
    await waitFor(() => expect(element.hasAttribute('disabled')).toBe(true))
    expect(element.textContent).toContain('Salvando')
    fireEvent.click(element)
    expect(posts()).toHaveLength(1)
    await act(async () => release())
    await screen.findByTestId('image-saved-to-library')
    expect(posts()).toHaveLength(1)
    expect(screen.queryByTestId('save-image-to-library')).toBeNull()
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Salvo em Arquivos' }))
  })

  it('a definitive failure is reported truthfully and allows a legitimate retry', async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST' ? new Response(JSON.stringify({ code: 'OUTPUT_UNAVAILABLE' }), { status: 409 }) : stateResponse())
    render(<SaveImageToLibrary imageId="img-1" />)
    fireEvent.click(await button())
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive', description: 'O arquivo da imagem não está mais disponível.' })))
    expect(screen.queryByTestId('image-saved-to-library')).toBeNull()
    await waitFor(() => expect(screen.getByTestId('save-image-to-library').hasAttribute('disabled')).toBe(false))

    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => (init?.method === 'POST' ? createdResponse() : stateResponse()))
    fireEvent.click(screen.getByTestId('save-image-to-library'))
    await screen.findByTestId('image-saved-to-library')
  })

  it('a server "already saved" (lost a race / other tab) still ends in the saved state', async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => (init?.method === 'POST' ? createdResponse('already_saved') : stateResponse()))
    render(<SaveImageToLibrary imageId="img-1" />)
    fireEvent.click(await button())
    await screen.findByTestId('image-saved-to-library')
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Já estava em Arquivos' }))
  })

  it('a network failure is a failure state that allows retry', async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') throw new Error('offline')
      return stateResponse()
    })
    render(<SaveImageToLibrary imageId="img-1" />)
    fireEvent.click(await button())
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' })))
    await waitFor(() => expect(screen.getByTestId('save-image-to-library').hasAttribute('disabled')).toBe(false))
  })

  it('offers no editor navigation (that is a later task)', async () => {
    render(<SaveImageToLibrary imageId="img-1" />)
    await button()
    expect(document.body.textContent).not.toMatch(/Creative Editor/)
  })
})

describe('ImageResult integration — existing behaviour is unchanged', () => {
  const base = { imageUrl: 'https://cdn.example.test/x.png', status: 'draft' as const, onRegenerate: vi.fn(), onApprove: vi.fn(), isRegenerating: false, isApproving: false }

  it('without an image id it renders exactly the existing actions and makes no request', () => {
    render(<ImageResult {...base} />)
    expect(screen.getByText('Gerar Novamente')).toBeTruthy()
    expect(screen.getByText('Download')).toBeTruthy()
    expect(screen.getByText('Aprovar')).toBeTruthy()
    expect(screen.queryByTestId('save-image-to-library')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('with a persisted image it adds the save action alongside the existing ones', async () => {
    render(<ImageResult {...base} imageId="img-1" />)
    expect(await button()).toBeTruthy()
    expect(screen.getByText('Download')).toBeTruthy()
    expect(screen.getByText('Aprovar')).toBeTruthy()
  })

  it('while the image is still generating there is no save action', () => {
    render(<ImageResult {...base} status="generating" imageId="img-1" />)
    expect(screen.queryByTestId('save-image-to-library')).toBeNull()
  })
})
