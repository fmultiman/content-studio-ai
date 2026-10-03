// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ProductionDetailPage from '@/app/(dashboard)/projetos/[id]/producoes/[productionId]/page'

const mockPush = vi.fn()
const PROJECT_ID = '10000000-0000-4000-8000-000000000001'
const PRODUCTION_ID = '20000000-0000-4000-8000-000000000001'

const SESSION_1 = '30000000-0000-4000-8000-000000000001'
const LEGACY_GEN_1 = '40000000-0000-4000-8000-000000000001'
const SESSION_OWNED_GEN = '40000000-0000-4000-8000-000000000002'
const DRAFT_1 = '50000000-0000-4000-8000-000000000001'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useParams: () => ({ id: PROJECT_ID, productionId: PRODUCTION_ID }),
}))

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({
            data: table === 'projects' ? { id: PROJECT_ID, name: 'Projeto Alpha', identity: null } : null,
            error: null,
          }),
        }),
      }),
    }),
  }),
}))

describe('036D — Production Page Video Visibility', () => {
  let fetchMock: any

  beforeEach(() => {
    fetchMock = vi.fn()
    global.fetch = fetchMock
    mockPush.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  function setupProductionData({
    sessions = [],
    generations = [],
    drafts = [],
  }: {
    sessions?: any[]
    generations?: any[]
    drafts?: any[]
  }) {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes(`/api/productions/${PRODUCTION_ID}`)) {
        return Promise.resolve(new Response(JSON.stringify({
          production: {
            id: PRODUCTION_ID,
            project_id: PROJECT_ID,
            title: 'Produção Alpha',
            intention: 'Objetivo de teste',
            type: 'campaign',
            updated_at: '2026-10-03T10:00:00Z',
          },
        }), { status: 200 }))
      }
      if (url.includes('/api/image-drafts')) {
        return Promise.resolve(new Response(JSON.stringify({ drafts: [] }), { status: 200 }))
      }
      if (url.includes('/api/editorial-contents')) {
        return Promise.resolve(new Response(JSON.stringify({ editorialContents: [] }), { status: 200 }))
      }
      if (url.includes('/api/channel-pieces')) {
        return Promise.resolve(new Response(JSON.stringify({ channelPieces: [] }), { status: 200 }))
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
      if (url.includes('/api/video-generations')) {
        return Promise.resolve(new Response(JSON.stringify({ generations }), { status: 200 }))
      }
      return Promise.resolve(new Response('{}', { status: 200 }))
    })
  }

  async function openVideosTab() {
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Vídeos/i })).toBeTruthy()
    })
    const tab = screen.getByRole('tab', { name: /Vídeos/i })
    fireEvent.mouseDown(tab, { button: 0 })
    fireEvent.click(tab)
  }

  it('1. Production with Session only: Gerações IA visible, Edições empty state', async () => {
    setupProductionData({
      sessions: [
        {
          id: SESSION_1,
          projectId: PROJECT_ID,
          productionId: PRODUCTION_ID,
          updatedAt: '2026-10-03T10:00:00Z',
          workingState: { prompt: 'Solo Session Prompt' },
        },
      ],
      generations: [],
      drafts: [],
    })

    render(<ProductionDetailPage />)
    await openVideosTab()

    await waitFor(() => {
      expect(screen.getByTestId('production-ai-group')).toBeTruthy()
      expect(screen.getByTestId('production-editions-group')).toBeTruthy()
    })

    expect(screen.getByText('Solo Session Prompt')).toBeTruthy()
    expect(screen.getByTestId('production-editions-empty')).toBeTruthy()
    expect(screen.queryByTestId('production-ai-empty')).toBeNull()
  })

  it('2. Production with VideoDraft only: Edições visible, Gerações IA empty state', async () => {
    setupProductionData({
      sessions: [],
      generations: [],
      drafts: [
        {
          id: DRAFT_1,
          project_id: PROJECT_ID,
          production_id: PRODUCTION_ID,
          name: 'Solo VideoDraft',
          updated_at: '2026-10-02T10:00:00Z',
          scenes: [],
        },
      ],
    })

    render(<ProductionDetailPage />)
    await openVideosTab()

    await waitFor(() => {
      expect(screen.getByText('Solo VideoDraft')).toBeTruthy()
    })

    expect(screen.getByTestId('production-ai-empty')).toBeTruthy()
    expect(screen.queryByTestId('production-editions-empty')).toBeNull()
  })

  it('3, 4 & 5. Production with Session + Legacy Attempt + VideoDraft: all groups visible, session-owned attempt not duplicated', async () => {
    setupProductionData({
      sessions: [
        {
          id: SESSION_1,
          projectId: PROJECT_ID,
          productionId: PRODUCTION_ID,
          updatedAt: '2026-10-03T10:00:00Z',
          workingState: { prompt: 'Session In Production' },
        },
      ],
      generations: [
        {
          id: LEGACY_GEN_1,
          session_id: null,
          project_id: PROJECT_ID,
          production_id: PRODUCTION_ID,
          prompt: 'Legacy Attempt In Production',
          status: 'succeeded',
          mode: 'text_to_video',
          created_at: '2026-10-01T10:00:00Z',
          updated_at: '2026-10-01T10:05:00Z',
        },
        {
          id: SESSION_OWNED_GEN,
          session_id: SESSION_1,
          project_id: PROJECT_ID,
          production_id: PRODUCTION_ID,
          prompt: 'Session Attempt Hidden',
          status: 'processing',
          mode: 'text_to_video',
          created_at: '2026-10-03T10:05:00Z',
          updated_at: '2026-10-03T10:05:00Z',
        },
      ],
      drafts: [
        {
          id: DRAFT_1,
          project_id: PROJECT_ID,
          production_id: PRODUCTION_ID,
          name: 'Draft In Production',
          updated_at: '2026-10-02T10:00:00Z',
          scenes: [],
        },
      ],
    })

    render(<ProductionDetailPage />)
    await openVideosTab()

    await waitFor(() => {
      expect(screen.getByText('Session In Production')).toBeTruthy()
      expect(screen.getByText('Legacy Attempt In Production')).toBeTruthy()
      expect(screen.getByText('Draft In Production')).toBeTruthy()
    })

    // Session-owned attempt is summarized inside session, not duplicated as separate card
    expect(screen.queryByTestId(`production-card-generation-${SESSION_OWNED_GEN}`)).toBeNull()
  })

  it('6 & 7. Routing actions: Session "Continuar" routes to workspace; legacy "Reutilizar configurações" routes to new UUID workspace', async () => {
    setupProductionData({
      sessions: [
        {
          id: SESSION_1,
          projectId: PROJECT_ID,
          productionId: PRODUCTION_ID,
          updatedAt: '2026-10-03T10:00:00Z',
          workingState: { prompt: 'Continuable Session' },
        },
      ],
      generations: [
        {
          id: LEGACY_GEN_1,
          session_id: null,
          project_id: PROJECT_ID,
          production_id: PRODUCTION_ID,
          prompt: 'Reusable Legacy Attempt',
          status: 'succeeded',
          mode: 'text_to_video',
          created_at: '2026-10-01T10:00:00Z',
          updated_at: '2026-10-01T10:05:00Z',
        },
      ],
      drafts: [
        {
          id: DRAFT_1,
          project_id: PROJECT_ID,
          production_id: PRODUCTION_ID,
          name: 'Editable Draft',
          updated_at: '2026-10-02T10:00:00Z',
          scenes: [],
        },
      ],
    })

    render(<ProductionDetailPage />)
    await openVideosTab()

    await waitFor(() => {
      expect(screen.getByTestId('production-continue-session')).toBeTruthy()
      expect(screen.getByTestId('production-reuse-generation')).toBeTruthy()
      expect(screen.getByTestId('production-open-video-draft')).toBeTruthy()
    })

    // 6. Session "Continuar" routes to workspace
    fireEvent.click(screen.getByTestId('production-continue-session'))
    expect(mockPush).toHaveBeenCalledWith(`/videos/geracoes/${SESSION_1}`)

    // 7. Legacy "Reutilizar configurações" routes to new UUID workspace
    fireEvent.click(screen.getByTestId('production-reuse-generation'))
    const lastCall = mockPush.mock.calls[mockPush.mock.calls.length - 1][0]
    expect(lastCall).toMatch(/^\/videos\/geracoes\/[0-9a-f-]{36}\?new=1/)
    expect(lastCall).toContain(`project=${encodeURIComponent(PROJECT_ID)}`)
    expect(lastCall).toContain(`production=${encodeURIComponent(PRODUCTION_ID)}`)
    expect(lastCall).toContain(`reuseGenerationId=${encodeURIComponent(LEGACY_GEN_1)}`)

    // 8. VideoDraft opens Creative Editor
    fireEvent.click(screen.getByTestId('production-open-video-draft'))
    expect(mockPush).toHaveBeenCalledWith(`/creative-editor/video/${DRAFT_1}`)
  })

  it('9 & 10. Production scoping: API requests pass productionId and prevent leakage', async () => {
    setupProductionData({ sessions: [], generations: [], drafts: [] })

    render(<ProductionDetailPage />)
    await openVideosTab()

    await waitFor(() => {
      expect(screen.getByTestId('production-ai-empty')).toBeTruthy()
    })

    // Confirms requests used exact productionId query parameter and never all=true
    const sessionReqs = fetchMock.mock.calls.filter(([url]: [string]) => url.includes('/api/video-generation-sessions'))
    expect(sessionReqs.length).toBeGreaterThan(0)
    expect(sessionReqs[0][0]).toContain(`productionId=${PRODUCTION_ID}`)
    expect(sessionReqs[0][0]).not.toContain('all=true')

    const genReqs = fetchMock.mock.calls.filter(([url]: [string]) => url.includes('/api/video-generations?'))
    expect(genReqs.length).toBeGreaterThan(0)
    expect(genReqs[0][0]).toContain(`productionId=${PRODUCTION_ID}`)
  })
})
