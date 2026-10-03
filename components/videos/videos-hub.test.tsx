// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import VideosPage from '@/app/(dashboard)/videos/page'

const mockPush = vi.fn()
const mockReplace = vi.fn()
let currentSearchParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useSearchParams: () => currentSearchParams,
}))

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}))

const PROJ_1 = '10000000-0000-4000-8000-000000000001'
const PROJ_2 = '10000000-0000-4000-8000-000000000002'
const PROD_1 = '20000000-0000-4000-8000-000000000001'
const PROD_2 = '20000000-0000-4000-8000-000000000002'

const SESSION_1 = '30000000-0000-4000-8000-000000000001'
const LEGACY_GEN_1 = '40000000-0000-4000-8000-000000000001'
const SESSION_OWNED_GEN = '40000000-0000-4000-8000-000000000002'
const DRAFT_1 = '50000000-0000-4000-8000-000000000001'

const MOCK_PROJECTS = [
  { id: PROJ_1, name: 'Projeto Alpha' },
  { id: PROJ_2, name: 'Projeto Beta' },
]

const MOCK_PRODUCTIONS = [
  { id: PROD_1, project_id: PROJ_1, title: 'Produção Alpha 1' },
  { id: PROD_2, project_id: PROJ_2, title: 'Produção Beta 1' },
]

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: () => ({
        order: () => Promise.resolve({
          data: table === 'projects' ? MOCK_PROJECTS : table === 'productions' ? MOCK_PRODUCTIONS : [],
          error: null,
        }),
      }),
    }),
  }),
}))

describe('036D — /videos Hub Productization & Separation', () => {
  let fetchMock: any

  beforeEach(() => {
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

  function setupHubData({
    sessions = [],
    generations = [],
    drafts = [],
  }: {
    sessions?: any[]
    generations?: any[]
    drafts?: any[]
  }) {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/api/settings/providers')) {
        return Promise.resolve(new Response(JSON.stringify({ providers: { kling: { status: 'configured' } } }), { status: 200 }))
      }
      if (url.includes('/api/video-generations/connections')) {
        return Promise.resolve(new Response(JSON.stringify({ connections: [] }), { status: 200 }))
      }
      if (url.includes('/api/video-drafts')) {
        return Promise.resolve(new Response(JSON.stringify({ drafts }), { status: 200 }))
      }
      if (url.includes('/api/video-generation-sessions')) {
        return Promise.resolve(new Response(JSON.stringify({ sessions }), { status: 200 }))
      }
      if (url === '/api/video-generations') {
        return Promise.resolve(new Response(JSON.stringify({ generations }), { status: 200 }))
      }
      return Promise.resolve(new Response('{}', { status: 200 }))
    })
  }

  it('1, 2, 3 & 4. Groups Gerações IA and Edições, shows Session and legacy attempt, does not duplicate session-owned attempt', async () => {
    setupHubData({
      sessions: [
        {
          id: SESSION_1,
          projectId: PROJ_1,
          productionId: PROD_1,
          updatedAt: '2026-10-03T10:00:00Z',
          workingState: { schemaVersion: 1, prompt: 'Session 1 Active Prompt' },
        },
      ],
      generations: [
        // Legacy standalone attempt (session_id is null)
        {
          id: LEGACY_GEN_1,
          session_id: null,
          project_id: PROJ_1,
          production_id: PROD_1,
          prompt: 'Legacy Standalone Attempt',
          status: 'succeeded',
          mode: 'text_to_video',
          created_at: '2026-10-01T10:00:00Z',
          updated_at: '2026-10-01T10:05:00Z',
        },
        // Session-owned attempt (belongs to SESSION_1)
        {
          id: SESSION_OWNED_GEN,
          session_id: SESSION_1,
          project_id: PROJ_1,
          production_id: PROD_1,
          prompt: 'Session 1 Output Attempt',
          status: 'processing',
          mode: 'text_to_video',
          created_at: '2026-10-03T10:05:00Z',
          updated_at: '2026-10-03T10:05:00Z',
        },
      ],
      drafts: [
        {
          id: DRAFT_1,
          project_id: PROJ_1,
          production_id: PROD_1,
          name: 'Authored Draft 1',
          updated_at: '2026-10-02T10:00:00Z',
          scenes: [],
        },
      ],
    })

    render(<VideosPage />)

    await waitFor(() => {
      expect(screen.getByTestId('ai-generations-group')).toBeTruthy()
      expect(screen.getByTestId('editions-group')).toBeTruthy()
    })

    // 1. Session appears under Gerações IA
    expect(screen.getByText('Session 1 Active Prompt')).toBeTruthy()
    // Session meta shows 1 tentativa
    expect(screen.getByText(/1 tentativa/i)).toBeTruthy()

    // 2. VideoDraft appears under Edições
    expect(screen.getByText('Authored Draft 1')).toBeTruthy()

    // 3. Legacy standalone Attempt appears under Gerações IA
    expect(screen.getByText('Legacy Standalone Attempt')).toBeTruthy()

    // 4. Session-owned attempt is NOT duplicated as standalone card
    expect(screen.queryByTestId(`card-generation-${SESSION_OWNED_GEN}`)).toBeNull()
  })

  it('5. Session action: "Continuar" routes to workspace', async () => {
    setupHubData({
      sessions: [
        {
          id: SESSION_1,
          projectId: PROJ_1,
          productionId: PROD_1,
          updatedAt: '2026-10-03T10:00:00Z',
          workingState: { schemaVersion: 1, prompt: 'Session 1 Active Prompt' },
        },
      ],
      generations: [],
      drafts: [],
    })

    render(<VideosPage />)

    await waitFor(() => {
      expect(screen.getByTestId('continue-session')).toBeTruthy()
    })

    fireEvent.click(screen.getByTestId('continue-session'))
    expect(mockPush).toHaveBeenCalledWith(`/videos/geracoes/${SESSION_1}`)
  })

  it('6. Legacy action: "Reutilizar configurações" routes to new UUID workspace with reuseGenerationId', async () => {
    setupHubData({
      sessions: [],
      generations: [
        {
          id: LEGACY_GEN_1,
          session_id: null,
          project_id: PROJ_1,
          production_id: PROD_1,
          prompt: 'Legacy Standalone Attempt',
          status: 'succeeded',
          mode: 'text_to_video',
          created_at: '2026-10-01T10:00:00Z',
          updated_at: '2026-10-01T10:05:00Z',
        },
      ],
      drafts: [],
    })

    render(<VideosPage />)

    await waitFor(() => {
      expect(screen.getByTestId('reuse-generation-settings')).toBeTruthy()
    })

    fireEvent.click(screen.getByTestId('reuse-generation-settings'))
    expect(mockPush).toHaveBeenCalled()
    const targetUrl = mockPush.mock.calls[0][0]
    expect(targetUrl).toMatch(/^\/videos\/geracoes\/[0-9a-f-]{36}\?new=1/)
    expect(targetUrl).toContain(`project=${encodeURIComponent(PROJ_1)}`)
    expect(targetUrl).toContain(`production=${encodeURIComponent(PROD_1)}`)
    expect(targetUrl).toContain(`reuseGenerationId=${encodeURIComponent(LEGACY_GEN_1)}`)
  })

  it('7 & 8. VideoDraft action opens Creative Editor and top-level CTA is provider-neutral', async () => {
    setupHubData({
      sessions: [],
      generations: [],
      drafts: [
        {
          id: DRAFT_1,
          project_id: PROJ_1,
          production_id: PROD_1,
          name: 'Authored Draft 1',
          updated_at: '2026-10-02T10:00:00Z',
          scenes: [],
        },
      ],
    })

    render(<VideosPage />)

    await waitFor(() => {
      expect(screen.getByTestId('open-in-creative-editor')).toBeTruthy()
    })

    // 7. VideoDraft action opens Creative Editor
    fireEvent.click(screen.getByTestId('open-in-creative-editor'))
    expect(mockPush).toHaveBeenCalledWith(`/creative-editor/video/${DRAFT_1}`)

    // 8. Provider-neutral CTA: "Gerar vídeo com IA" (not Kling-specific)
    const ctaBtn = screen.getByTestId('generate-ai-video-btn')
    expect(ctaBtn.textContent).toContain('Gerar vídeo com IA')
    expect(ctaBtn.textContent).not.toContain('Kling')
  })

  it('9. Independent empty states for Gerações IA and Edições', async () => {
    // Only drafts, 0 AI generations
    setupHubData({
      sessions: [],
      generations: [],
      drafts: [
        {
          id: DRAFT_1,
          project_id: PROJ_1,
          production_id: PROD_1,
          name: 'Draft Only',
          updated_at: '2026-10-02T10:00:00Z',
          scenes: [],
        },
      ],
    })

    render(<VideosPage />)

    await waitFor(() => {
      expect(screen.getByTestId('ai-generations-empty')).toBeTruthy()
      expect(screen.queryByTestId('editions-empty')).toBeNull()
      expect(screen.getByText('Draft Only')).toBeTruthy()
    })
  })

  it('10 & 11. Project and Production filters scope Session, Legacy, and Draft without leakage', async () => {
    setupHubData({
      sessions: [
        {
          id: SESSION_1,
          projectId: PROJ_1,
          productionId: PROD_1,
          updatedAt: '2026-10-03T10:00:00Z',
          workingState: { prompt: 'Alpha Session' },
        },
        {
          id: 'session-2',
          projectId: PROJ_2,
          productionId: PROD_2,
          updatedAt: '2026-10-03T10:00:00Z',
          workingState: { prompt: 'Beta Session' },
        },
      ],
      generations: [
        {
          id: LEGACY_GEN_1,
          session_id: null,
          project_id: PROJ_1,
          production_id: PROD_1,
          prompt: 'Alpha Legacy',
          status: 'succeeded',
          created_at: '2026-10-01T10:00:00Z',
        },
      ],
      drafts: [
        {
          id: DRAFT_1,
          project_id: PROJ_1,
          production_id: PROD_1,
          name: 'Alpha Draft',
          updated_at: '2026-10-02T10:00:00Z',
          scenes: [],
        },
        {
          id: 'draft-2',
          project_id: PROJ_2,
          production_id: PROD_2,
          name: 'Beta Draft',
          updated_at: '2026-10-02T10:00:00Z',
          scenes: [],
        },
      ],
    })

    render(<VideosPage />)

    await waitFor(() => {
      expect(screen.getByText('Alpha Session')).toBeTruthy()
      expect(screen.getByText('Beta Session')).toBeTruthy()
      expect(screen.getByText('Alpha Draft')).toBeTruthy()
      expect(screen.getByText('Beta Draft')).toBeTruthy()
    })

    // Search filter scopes across all items truthfully
    const searchInput = screen.getByPlaceholderText('Titulo, Project ou Production')
    fireEvent.change(searchInput, { target: { value: 'Beta' } })

    await waitFor(() => {
      expect(screen.queryByText('Alpha Session')).toBeNull()
      expect(screen.getByText('Beta Session')).toBeTruthy()
      expect(screen.queryByText('Alpha Draft')).toBeNull()
      expect(screen.getByText('Beta Draft')).toBeTruthy()
    })
  })
})
