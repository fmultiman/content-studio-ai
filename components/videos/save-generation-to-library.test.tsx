// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SaveGenerationToLibrary, type SaveableGeneration } from './save-generation-to-library'

// VIDEO_GENERATION_LIBRARY_PROMOTION_V1 — the "Salvar em Arquivos" action on a generation card.
// Every request is a mocked fetch: no server, storage or provider is contacted.

const toast = vi.fn()
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }))

const fetchMock = vi.fn()
const LIBRARY_FILE_ID = 'lf-1'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ result: 'created', libraryFile: { id: LIBRARY_FILE_ID } }), { status: 201 }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// Mirrors the /videos page: the saved state lives in the list that the server re-supplies.
function Card({ initial }: { initial: SaveableGeneration }) {
  const [generation, setGeneration] = useState(initial)
  return <SaveGenerationToLibrary generation={generation} size="sm" onSaved={(_, libraryFileId) => setGeneration({ ...generation, library_file_id: libraryFileId })} />
}

const succeeded: SaveableGeneration = { id: 'gen-1', status: 'succeeded', library_file_id: null }
const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')

describe('SaveGenerationToLibrary', () => {
  it('a succeeded, unsaved generation shows the explicit action', () => {
    render(<Card initial={succeeded} />)
    expect(screen.getByTestId('save-generation-to-library').textContent).toContain('Salvar em Arquivos')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['queued', 'submitted', 'processing', 'failed'])('a %s generation offers no promotion action', (status) => {
    render(<Card initial={{ ...succeeded, status }} />)
    expect(screen.queryByTestId('save-generation-to-library')).toBeNull()
    expect(screen.queryByTestId('generation-saved-to-library')).toBeNull()
  })

  it('sends only the generation id — no storage path, project or body', async () => {
    render(<Card initial={succeeded} />)
    fireEvent.click(screen.getByTestId('save-generation-to-library'))
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(posts()[0][0]).toBe('/api/video-generations/gen-1/save-to-library')
    expect(posts()[0][1]).toEqual({ method: 'POST' })
  })

  it('locks the action while pending, and a double click sends exactly one request', async () => {
    let release!: () => void
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => {
      release = () => resolve(new Response(JSON.stringify({ result: 'created', libraryFile: { id: LIBRARY_FILE_ID } }), { status: 201 }))
    }))
    render(<Card initial={succeeded} />)
    const button = screen.getByTestId('save-generation-to-library')
    act(() => {
      button.click()
      button.click()
    })
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(true))
    expect(button.textContent).toContain('Salvando')
    fireEvent.click(button)
    expect(posts()).toHaveLength(1)
    await act(async () => release())
    await waitFor(() => expect(screen.getByTestId('generation-saved-to-library')).toBeTruthy())
    expect(posts()).toHaveLength(1)
  })

  it('on success it shows the saved state and no longer offers an armed save action', async () => {
    render(<Card initial={succeeded} />)
    fireEvent.click(screen.getByTestId('save-generation-to-library'))
    await waitFor(() => expect(screen.getByTestId('generation-saved-to-library')).toBeTruthy())
    expect(screen.getByTestId('generation-saved-to-library').textContent).toContain('Salvo em Arquivos')
    expect(screen.queryByTestId('save-generation-to-library')).toBeNull()
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Salvo em Arquivos' }))
  })

  it('an already-promoted generation (server state, e.g. after a reload) never shows an armed save action', () => {
    render(<Card initial={{ ...succeeded, library_file_id: LIBRARY_FILE_ID }} />)
    expect(screen.getByTestId('generation-saved-to-library')).toBeTruthy()
    expect(screen.queryByTestId('save-generation-to-library')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('the saved state links to Arquivos', () => {
    render(<Card initial={{ ...succeeded, library_file_id: LIBRARY_FILE_ID }} />)
    expect(screen.getByTestId('generation-saved-to-library').getAttribute('href')).toBe('/arquivos')
  })

  it('a server-side "already saved" is reported as such, and still ends in the saved state', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ result: 'already_saved', libraryFile: { id: LIBRARY_FILE_ID } }), { status: 200 }))
    render(<Card initial={succeeded} />)
    fireEvent.click(screen.getByTestId('save-generation-to-library'))
    await waitFor(() => expect(screen.getByTestId('generation-saved-to-library')).toBeTruthy())
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Já estava em Arquivos' }))
  })

  it('a failed promotion is reported truthfully and can be retried legitimately', async () => {
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ code: 'OUTPUT_UNAVAILABLE' }), { status: 409 }))
    render(<Card initial={succeeded} />)
    fireEvent.click(screen.getByTestId('save-generation-to-library'))
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Não foi possível salvar em Arquivos', variant: 'destructive' })))
    expect(screen.queryByTestId('generation-saved-to-library')).toBeNull()

    const retry = screen.getByTestId('save-generation-to-library')
    await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(false))
    fireEvent.click(retry)
    await waitFor(() => expect(screen.getByTestId('generation-saved-to-library')).toBeTruthy())
    expect(posts()).toHaveLength(2)
  })

  it('a network failure is also a failure state that allows retry', async () => {
    fetchMock.mockImplementationOnce(async () => { throw new Error('offline') })
    render(<Card initial={succeeded} />)
    fireEvent.click(screen.getByTestId('save-generation-to-library'))
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' })))
    await waitFor(() => expect(screen.getByTestId('save-generation-to-library').hasAttribute('disabled')).toBe(false))
  })
})

// GENERATED_MEDIA_TO_CREATIVE_EDITOR_HANDOFF_V1 — "Abrir no editor" exists only for a succeeded generation that is
// already saved as a LibraryFile.
describe('SaveGenerationToLibrary — editor handoff entry point', () => {
  it('an unsaved succeeded generation never exposes the handoff', () => {
    render(<Card initial={succeeded} />)
    expect(screen.queryByTestId('open-in-editor')).toBeNull()
  })

  it('a saved generation exposes the handoff next to the saved state', () => {
    render(<Card initial={{ ...succeeded, library_file_id: LIBRARY_FILE_ID }} />)
    expect(screen.getByTestId('generation-saved-to-library')).toBeTruthy()
    expect(screen.getByTestId('open-in-editor').textContent).toContain('Abrir no editor')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('an explicit save reveals the handoff afterwards (promotion and handoff stay two separate actions)', async () => {
    render(<Card initial={succeeded} />)
    expect(screen.queryByTestId('open-in-editor')).toBeNull()
    fireEvent.click(screen.getByTestId('save-generation-to-library'))
    await screen.findByTestId('open-in-editor')
    expect(posts()).toHaveLength(1)
  })

  it.each(['queued', 'submitted', 'processing', 'failed'])('a %s generation never exposes the handoff, even if it carries a stale pointer', (status) => {
    render(<Card initial={{ ...succeeded, status, library_file_id: LIBRARY_FILE_ID }} />)
    expect(screen.queryByTestId('open-in-editor')).toBeNull()
  })
})
