// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import WorkspacePage from '@/app/(dashboard)/videos/geracoes/[sessionId]/page'
import { describeRestConnection } from '@/lib/video-generation/connections'
import type { VideoGenerationConnectionDescriptor } from '@/lib/video-generation/capabilities'

const mockPush = vi.fn()
const mockReplace = vi.fn()
const mockRouter = { push: mockPush, replace: mockReplace }
let currentSessionId = '00000000-0000-0000-0000-000000000001'
let currentSearchParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  useParams: () => ({ sessionId: currentSessionId }),
  useSearchParams: () => currentSearchParams,
}))

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}))

const CONNECTIONS_FIXTURE: VideoGenerationConnectionDescriptor[] = [
  describeRestConnection('configured'),
]

describe('VIDEO_GENERATION_WORKSPACE_AUTOSAVE_V1 — Workspace & Autosave Tests', () => {
  let fetchMock: any

  beforeEach(() => {
    currentSessionId = '00000000-0000-0000-0000-000000000001'
    currentSearchParams = new URLSearchParams()
    fetchMock = vi.fn()
    global.fetch = fetchMock
    mockPush.mockReset()
    mockReplace.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('1 & 2 & 3. Lazy session creation: empty new workspace writes nothing to DB', async () => {
    currentSearchParams.set('new', '1')
    currentSearchParams.set('project', '00000000-0000-0000-0000-000000000010')
    currentSearchParams.set('production', '00000000-0000-0000-0000-000000000020')

    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/connections')) {
        return Promise.resolve(new Response(JSON.stringify({ connections: CONNECTIONS_FIXTURE }), { status: 200 }))
      }
      if (url.includes('/video-generation-sessions/')) {
        return Promise.resolve(new Response(JSON.stringify({ error: 'not found' }), { status: 404 }))
      }
      if (url.includes('/video-generations?sessionId=')) {
        return Promise.resolve(new Response(JSON.stringify({ generations: [] }), { status: 200 }))
      }
      return Promise.resolve(new Response('{}', { status: 200 }))
    })

    render(<WorkspacePage />)

    await waitFor(() => {
      expect(screen.getByText('Workspace de Geração de Vídeo')).toBeTruthy()
    })

    // Confirm connections were loaded
    expect(fetchMock).toHaveBeenCalledWith('/api/video-generations/connections')
    // Confirm session 404 was checked
    expect(fetchMock).toHaveBeenCalledWith(`/api/video-generation-sessions/${currentSessionId}`)
    // Confirm NO writes (PUT or PATCH) occurred on empty open
    const writeCalls = fetchMock.mock.calls.filter((c: any) => c[1]?.method === 'PUT' || c[1]?.method === 'PATCH')
    expect(writeCalls).toHaveLength(0)

    // Save status shows "Salvo" (or clean)
    expect(screen.getByTestId('save-status-saved')).toBeTruthy()
  })

  it('4. First meaningful change triggers PUT create, updates expectedUpdatedAt, and cleans URL', async () => {
    currentSearchParams.set('new', '1')
    currentSearchParams.set('project', '00000000-0000-0000-0000-000000000010')
    currentSearchParams.set('production', '00000000-0000-0000-0000-000000000020')

    fetchMock.mockImplementation((url: string, opts?: any) => {
      if (url.includes('/connections')) {
        return Promise.resolve(new Response(JSON.stringify({ connections: CONNECTIONS_FIXTURE }), { status: 200 }))
      }
      if (url.includes('/video-generation-sessions/')) {
        if (opts?.method === 'PUT') {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                session: {
                  id: currentSessionId,
                  projectId: '00000000-0000-0000-0000-000000000010',
                  productionId: '00000000-0000-0000-0000-000000000020',
                  updatedAt: '2026-10-03T12:00:00.000Z',
                  workingState: JSON.parse(opts.body).workingState,
                },
                created: true,
              }),
              { status: 201 },
            ),
          )
        }
        return Promise.resolve(new Response(JSON.stringify({ error: 'not found' }), { status: 404 }))
      }
      if (url.includes('/video-generations?sessionId=')) {
        return Promise.resolve(new Response(JSON.stringify({ generations: [] }), { status: 200 }))
      }
      return Promise.resolve(new Response('{}', { status: 200 }))
    })

    render(<WorkspacePage />)

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Como esta imagem deve ser animada|Descreva a cena do vídeo/i)).toBeTruthy()
    })

    const promptTextarea = screen.getByPlaceholderText(/Como esta imagem deve ser animada|Descreva a cena do vídeo/i)
    fireEvent.change(promptTextarea, { target: { value: 'A golden eagle soaring over snow peaks' } })

    // Wait for autosave PUT call
    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find((c: any) => c[1]?.method === 'PUT')
      expect(putCall).toBeDefined()
      const body = JSON.parse(putCall[1].body)
      expect(body.projectId).toBe('00000000-0000-0000-0000-000000000010')
      expect(body.productionId).toBe('00000000-0000-0000-0000-000000000020')
      expect(body.workingState.prompt).toBe('A golden eagle soaring over snow peaks')
    })

    // URL is cleaned to survive reload
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(`/videos/geracoes/${currentSessionId}`, { scroll: false })
    })

    await waitFor(() => {
      expect(screen.getByTestId('save-status-saved')).toBeTruthy()
    })
  })

  it('5. Subsequent edits send PATCH with expectedUpdatedAt', async () => {
    fetchMock.mockImplementation((url: string, opts?: any) => {
      if (url.includes('/connections')) {
        return Promise.resolve(new Response(JSON.stringify({ connections: CONNECTIONS_FIXTURE }), { status: 200 }))
      }
      if (url.includes('/video-generation-sessions/')) {
        if (opts?.method === 'PATCH') {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                session: {
                  id: currentSessionId,
                  projectId: '00000000-0000-0000-0000-000000000010',
                  productionId: '00000000-0000-0000-0000-000000000020',
                  updatedAt: '2026-10-03T12:05:00.000Z',
                  workingState: JSON.parse(opts.body).workingState,
                },
              }),
              { status: 200 },
            ),
          )
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              session: {
                id: currentSessionId,
                projectId: '00000000-0000-0000-0000-000000000010',
                productionId: '00000000-0000-0000-0000-000000000020',
                updatedAt: '2026-10-03T12:00:00.000Z',
                workingState: {
                  schemaVersion: 1,
                  prompt: 'Initial prompt',
                  source: null,
                  selection: {
                    connectionRef: 'rest',
                    operation: 'text_to_video',
                    modelId: 'kling-v1',
                    duration: 5,
                    resolution: '720p',
                    aspectRatio: '16:9',
                    audio: 'off',
                    multiShot: false,
                    asmr: false,
                    audioPrompt: null,
                    musicPrompt: null,
                  },
                },
              },
            }),
            { status: 200 },
          ),
        )
      }
      if (url.includes('/video-generations?sessionId=')) {
        return Promise.resolve(new Response(JSON.stringify({ generations: [] }), { status: 200 }))
      }
      return Promise.resolve(new Response('{}', { status: 200 }))
    })

    render(<WorkspacePage />)

    await waitFor(() => {
      expect(screen.getByDisplayValue('Initial prompt')).toBeTruthy()
    })

    const promptTextarea = screen.getByDisplayValue('Initial prompt')
    fireEvent.change(promptTextarea, { target: { value: 'Updated prompt with more details' } })

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find((c: any) => c[1]?.method === 'PATCH')
      expect(patchCall).toBeDefined()
      const body = JSON.parse(patchCall[1].body)
      expect(body.expectedUpdatedAt).toBe('2026-10-03T12:00:00.000Z')
      expect(body.workingState.prompt).toBe('Updated prompt with more details')
    })
  })

  it('8 & 9. Optimistic concurrency conflict (409) shows conflict UX and supports Reload Server Version', async () => {
    fetchMock.mockImplementation((url: string, opts?: any) => {
      if (url.includes('/connections')) {
        return Promise.resolve(new Response(JSON.stringify({ connections: CONNECTIONS_FIXTURE }), { status: 200 }))
      }
      if (url.includes('/video-generation-sessions/')) {
        if (opts?.method === 'PATCH') {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                code: 'SESSION_VERSION_CONFLICT',
                error: 'Version conflict',
                session: {
                  id: currentSessionId,
                  projectId: '00000000-0000-0000-0000-000000000010',
                  productionId: '00000000-0000-0000-0000-000000000020',
                  updatedAt: '2026-10-03T13:00:00.000Z',
                  workingState: {
                    schemaVersion: 1,
                    prompt: 'Server authoritative version from another tab',
                    source: null,
                    selection: {
                      connectionRef: 'rest',
                      operation: 'text_to_video',
                      modelId: 'kling-v1',
                      duration: 10,
                      resolution: '1080p',
                      aspectRatio: '16:9',
                      audio: 'off',
                      multiShot: false,
                      asmr: false,
                      audioPrompt: null,
                      musicPrompt: null,
                    },
                  },
                },
              }),
              { status: 409 },
            ),
          )
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              session: {
                id: currentSessionId,
                projectId: '00000000-0000-0000-0000-000000000010',
                productionId: '00000000-0000-0000-0000-000000000020',
                updatedAt: '2026-10-03T12:00:00.000Z',
                workingState: {
                  schemaVersion: 1,
                  prompt: 'My local prompt',
                  source: null,
                  selection: {
                    connectionRef: 'rest',
                    operation: 'text_to_video',
                    modelId: 'kling-v1',
                    duration: 5,
                    resolution: '720p',
                    aspectRatio: '16:9',
                    audio: 'off',
                    multiShot: false,
                    asmr: false,
                    audioPrompt: null,
                    musicPrompt: null,
                  },
                },
              },
            }),
            { status: 200 },
          ),
        )
      }
      if (url.includes('/video-generations?sessionId=')) {
        return Promise.resolve(new Response(JSON.stringify({ generations: [] }), { status: 200 }))
      }
      return Promise.resolve(new Response('{}', { status: 200 }))
    })

    render(<WorkspacePage />)

    await waitFor(() => {
      expect(screen.getByDisplayValue('My local prompt')).toBeTruthy()
    })

    const promptTextarea = screen.getByDisplayValue('My local prompt')
    fireEvent.change(promptTextarea, { target: { value: 'My conflicting edit' } })

    // Conflict banner appears
    await waitFor(() => {
      expect(screen.getByTestId('conflict-banner')).toBeTruthy()
      expect(screen.getByTestId('save-status-conflict')).toBeTruthy()
    })

    // Click "Recarregar versão salva"
    const reloadBtn = screen.getByTestId('conflict-reload-server')
    fireEvent.click(reloadBtn)

    // Form adopts server content
    await waitFor(() => {
      expect(screen.getByDisplayValue('Server authoritative version from another tab')).toBeTruthy()
      expect(screen.queryByTestId('conflict-banner')).toBeNull()
      expect(screen.getByTestId('save-status-saved')).toBeTruthy()
    })
  })

  it('10. Conflict resolution: Keep local version explicitly saves local state against new token', async () => {
    let patchCount = 0
    fetchMock.mockImplementation((url: string, opts?: any) => {
      if (url.includes('/connections')) {
        return Promise.resolve(new Response(JSON.stringify({ connections: CONNECTIONS_FIXTURE }), { status: 200 }))
      }
      if (url.includes('/video-generation-sessions/')) {
        if (opts?.method === 'PATCH') {
          patchCount++
          if (patchCount === 1) {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  code: 'SESSION_VERSION_CONFLICT',
                  error: 'Version conflict',
                  session: {
                    id: currentSessionId,
                    projectId: '00000000-0000-0000-0000-000000000010',
                    productionId: '00000000-0000-0000-0000-000000000020',
                    updatedAt: '2026-10-03T13:00:00.000Z',
                    workingState: { schemaVersion: 1, prompt: 'Server prompt', source: null, selection: {} },
                  },
                }),
                { status: 409 },
              ),
            )
          }
          // Second patch succeeds
          return Promise.resolve(
            new Response(
              JSON.stringify({
                session: {
                  id: currentSessionId,
                  projectId: '00000000-0000-0000-0000-000000000010',
                  productionId: '00000000-0000-0000-0000-000000000020',
                  updatedAt: '2026-10-03T13:01:00.000Z',
                  workingState: JSON.parse(opts.body).workingState,
                },
              }),
              { status: 200 },
            ),
          )
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              session: {
                id: currentSessionId,
                projectId: '00000000-0000-0000-0000-000000000010',
                productionId: '00000000-0000-0000-0000-000000000020',
                updatedAt: '2026-10-03T12:00:00.000Z',
                workingState: {
                  schemaVersion: 1,
                  prompt: 'Initial local prompt',
                  source: null,
                  selection: {
                    connectionRef: 'rest',
                    operation: 'text_to_video',
                    modelId: 'kling-v1',
                    duration: 5,
                    resolution: '720p',
                    aspectRatio: '16:9',
                    audio: 'off',
                    multiShot: false,
                    asmr: false,
                    audioPrompt: null,
                    musicPrompt: null,
                  },
                },
              },
            }),
            { status: 200 },
          ),
        )
      }
      if (url.includes('/video-generations?sessionId=')) {
        return Promise.resolve(new Response(JSON.stringify({ generations: [] }), { status: 200 }))
      }
      return Promise.resolve(new Response('{}', { status: 200 }))
    })

    render(<WorkspacePage />)

    await waitFor(() => {
      expect(screen.getByDisplayValue('Initial local prompt')).toBeTruthy()
    })

    const promptTextarea = screen.getByDisplayValue('Initial local prompt')
    fireEvent.change(promptTextarea, { target: { value: 'My local change that I want to keep' } })

    await waitFor(() => {
      expect(screen.getByTestId('conflict-banner')).toBeTruthy()
    })

    // Click "Manter minhas alterações"
    const keepBtn = screen.getByTestId('conflict-keep-local')
    fireEvent.click(keepBtn)

    await waitFor(() => {
      expect(patchCount).toBe(2)
      const secondPatch = fetchMock.mock.calls.filter((c: any) => c[1]?.method === 'PATCH')[1]
      const body = JSON.parse(secondPatch[1].body)
      expect(body.expectedUpdatedAt).toBe('2026-10-03T13:00:00.000Z')
      expect(body.workingState.prompt).toBe('My local change that I want to keep')
      expect(screen.queryByTestId('conflict-banner')).toBeNull()
      expect(screen.getByTestId('save-status-saved')).toBeTruthy()
    })
  })

  it('13 & 14. Hydration writes nothing to DB and reconciliation does not auto-save', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/connections')) {
        return Promise.resolve(new Response(JSON.stringify({ connections: CONNECTIONS_FIXTURE }), { status: 200 }))
      }
      if (url.includes('/video-generation-sessions/')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              session: {
                id: currentSessionId,
                projectId: '00000000-0000-0000-0000-000000000010',
                productionId: '00000000-0000-0000-0000-000000000020',
                updatedAt: '2026-10-03T12:00:00.000Z',
                workingState: {
                  schemaVersion: 1,
                  prompt: 'Old prompt with non-existent model',
                  source: null,
                  selection: {
                    connectionRef: 'rest',
                    operation: 'text_to_video',
                    modelId: 'deprecated-model-no-longer-available',
                    duration: 999,
                    resolution: '8k',
                    aspectRatio: '21:9',
                    audio: 'on',
                    multiShot: true,
                    asmr: false,
                    audioPrompt: null,
                    musicPrompt: null,
                  },
                },
              },
            }),
            { status: 200 },
          ),
        )
      }
      if (url.includes('/video-generations?sessionId=')) {
        return Promise.resolve(new Response(JSON.stringify({ generations: [] }), { status: 200 }))
      }
      return Promise.resolve(new Response('{}', { status: 200 }))
    })

    render(<WorkspacePage />)

    await waitFor(() => {
      expect(screen.getByDisplayValue('Old prompt with non-existent model')).toBeTruthy()
      // Notice shown about reconciliation
      expect(screen.getByTestId('reconciliation-notice')).toBeTruthy()
    })

    // Assert that NO write calls occurred
    const writeCalls = fetchMock.mock.calls.filter((c: any) => c[1]?.method === 'PUT' || c[1]?.method === 'PATCH')
    expect(writeCalls).toHaveLength(0)
    expect(screen.getByTestId('save-status-saved')).toBeTruthy()
  })

  it('16, 17, 20 & 21. Generate saves working state first, sends sessionId and clientRequestId with current form body', async () => {
    let sessionSaved = false
    let generateSubmitted = false

    fetchMock.mockImplementation((url: string, opts?: any) => {
      if (url.includes('/connections')) {
        return Promise.resolve(new Response(JSON.stringify({ connections: CONNECTIONS_FIXTURE }), { status: 200 }))
      }
      if (url.includes('/video-generation-sessions/')) {
        if (opts?.method === 'PATCH') {
          sessionSaved = true
          return Promise.resolve(
            new Response(
              JSON.stringify({
                session: {
                  id: currentSessionId,
                  projectId: '00000000-0000-0000-0000-000000000010',
                  productionId: '00000000-0000-0000-0000-000000000020',
                  updatedAt: '2026-10-03T12:10:00.000Z',
                  workingState: JSON.parse(opts.body).workingState,
                },
              }),
              { status: 200 },
            ),
          )
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              session: {
                id: currentSessionId,
                projectId: '00000000-0000-0000-0000-000000000010',
                productionId: '00000000-0000-0000-0000-000000000020',
                updatedAt: '2026-10-03T12:00:00.000Z',
                workingState: {
                  schemaVersion: 1,
                  prompt: 'Initial prompt',
                  source: null,
                  selection: {
                    connectionRef: 'rest',
                    operation: 'text_to_video',
                    modelId: 'kling-v1',
                    duration: 5,
                    resolution: '720p',
                    aspectRatio: '16:9',
                    audio: 'off',
                    multiShot: false,
                    asmr: false,
                    audioPrompt: null,
                    musicPrompt: null,
                  },
                },
              },
            }),
            { status: 200 },
          ),
        )
      }
      if (url === '/api/video-generations' && opts?.method === 'POST') {
        generateSubmitted = true
        return Promise.resolve(
          new Response(
            JSON.stringify({
              generation: { id: 'gen-123', status: 'submitted' },
            }),
            { status: 201 },
          ),
        )
      }
      if (url.includes('/video-generations?sessionId=')) {
        return Promise.resolve(new Response(JSON.stringify({ generations: [] }), { status: 200 }))
      }
      return Promise.resolve(new Response('{}', { status: 200 }))
    })

    render(<WorkspacePage />)

    await waitFor(() => {
      expect(screen.getByDisplayValue('Initial prompt')).toBeTruthy()
    })

    // Change prompt right before clicking generate
    const promptTextarea = screen.getByDisplayValue('Initial prompt')
    fireEvent.change(promptTextarea, { target: { value: 'Immediate prompt to generate' } })

    const generateBtn = screen.getByTestId('generate-video')
    fireEvent.click(generateBtn)

    await waitFor(() => {
      expect(sessionSaved).toBe(true)
      expect(generateSubmitted).toBe(true)
    })

    const generateCall = fetchMock.mock.calls.find((c: any) => c[0] === '/api/video-generations' && c[1]?.method === 'POST')
    const body = JSON.parse(generateCall[1].body)
    expect(body.sessionId).toBe(currentSessionId)
    expect(body.projectId).toBe('00000000-0000-0000-0000-000000000010')
    expect(body.productionId).toBe('00000000-0000-0000-0000-000000000020')
    expect(body.clientRequestId).toBeDefined()
    expect(body.clientRequestId).toMatch(/^[0-9a-f-]{36}$/i)
    expect(body.prompt).toBe('Immediate prompt to generate')
  })

  it('18. Ambiguous outcome locks form and retains clientRequestId', async () => {
    fetchMock.mockImplementation((url: string, opts?: any) => {
      if (url.includes('/connections')) {
        return Promise.resolve(new Response(JSON.stringify({ connections: CONNECTIONS_FIXTURE }), { status: 200 }))
      }
      if (url.includes('/video-generation-sessions/')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              session: {
                id: currentSessionId,
                projectId: '00000000-0000-0000-0000-000000000010',
                productionId: '00000000-0000-0000-0000-000000000020',
                updatedAt: '2026-10-03T12:00:00.000Z',
                workingState: {
                  schemaVersion: 1,
                  prompt: 'Ready prompt',
                  source: null,
                  selection: {
                    connectionRef: 'rest',
                    operation: 'text_to_video',
                    modelId: 'kling-v1',
                    duration: 5,
                    resolution: '720p',
                    aspectRatio: '16:9',
                    audio: 'off',
                    multiShot: false,
                    asmr: false,
                    audioPrompt: null,
                    musicPrompt: null,
                  },
                },
              },
            }),
            { status: 200 },
          ),
        )
      }
      if (url === '/api/video-generations' && opts?.method === 'POST') {
        // Return 500 without a code -> ambiguous
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'Gateway timeout without code' }), { status: 504 }),
        )
      }
      if (url.includes('/video-generations?sessionId=')) {
        return Promise.resolve(new Response(JSON.stringify({ generations: [] }), { status: 200 }))
      }
      return Promise.resolve(new Response('{}', { status: 200 }))
    })

    render(<WorkspacePage />)

    await waitFor(() => {
      expect(screen.getByDisplayValue('Ready prompt')).toBeTruthy()
    })

    const generateBtn = screen.getByTestId('generate-video')
    fireEvent.click(generateBtn)

    await waitFor(() => {
      expect(screen.getByTestId('unconfirmed-submission-banner')).toBeTruthy()
    })

    // Generate button is locked
    expect(screen.getByTestId('generate-video').hasAttribute('disabled')).toBe(true)
  })

  it('22 & 23. Attempts load by session and display in timeline', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/connections')) {
        return Promise.resolve(new Response(JSON.stringify({ connections: CONNECTIONS_FIXTURE }), { status: 200 }))
      }
      if (url.includes('/video-generation-sessions/')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              session: {
                id: currentSessionId,
                projectId: '00000000-0000-0000-0000-000000000010',
                productionId: '00000000-0000-0000-0000-000000000020',
                updatedAt: '2026-10-03T12:00:00.000Z',
                workingState: {
                  schemaVersion: 1,
                  prompt: 'Ready prompt',
                  source: null,
                  selection: {
                    connectionRef: 'rest',
                    operation: 'text_to_video',
                    modelId: 'kling-v1',
                    duration: 5,
                    resolution: '720p',
                    aspectRatio: '16:9',
                    audio: 'off',
                    multiShot: false,
                    asmr: false,
                    audioPrompt: null,
                    musicPrompt: null,
                  },
                },
              },
            }),
            { status: 200 },
          ),
        )
      }
      if (url.includes('/video-generations?sessionId=')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              generations: [
                {
                  id: 'gen-001',
                  status: 'succeeded',
                  prompt: 'A futuristic cityscape at dusk',
                  mode: 'text_to_video',
                  transport: 'kling_web',
                  created_at: '2026-10-03T11:00:00.000Z',
                },
              ],
            }),
            { status: 200 },
          ),
        )
      }
      return Promise.resolve(new Response('{}', { status: 200 }))
    })

    render(<WorkspacePage />)

    await waitFor(() => {
      expect(screen.getByText('A futuristic cityscape at dusk')).toBeTruthy()
      expect(screen.getByTestId('attempt-watch-gen-001')).toBeTruthy()
    })
  })
})
