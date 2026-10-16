// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import VideosPage from '@/app/(dashboard)/videos/page'
import { describeGeminiConnection, describeRestConnection } from '@/lib/video-generation/connections'
import { accountConnectionRef } from '@/lib/video-generation/connection-ref'
import type { VideoGenerationConnectionDescriptor } from '@/lib/video-generation/capabilities'

// STRUCTURAL_WAVE_0 (D9 + D22) - the REAL /videos hub, only network/Supabase/router faked: generation states read in Portuguese
// (the stored values are unchanged), the status filter covers the real generation states WITHOUT dropping Creative Editor drafts,
// and the "no provider" warning no longer assumes Kling.

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))

const PROJ = '10000000-0000-4000-8000-000000000001'
const PROD = '20000000-0000-4000-8000-000000000001'
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: () => ({
        order: () => Promise.resolve({
          data: table === 'projects' ? [{ id: PROJ, name: 'Projeto Alfa' }] : table === 'productions' ? [{ id: PROD, project_id: PROJ, title: 'Producao Alfa' }] : [],
          error: null,
        }),
      }),
    }),
  }),
}))

const generation = (id: string, status: string, sessionId: string | null = null, extra: Record<string, unknown> = {}) => ({
  id, session_id: sessionId, project_id: PROJ, production_id: PROD, prompt: `Geração ${status}`, status, mode: 'text_to_video',
  provider: 'kling', created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:05:00Z', ...extra,
})
const STANDALONE = ['queued', 'submitted', 'processing', 'succeeded', 'failed'] as const
const SESSION_EMPTY = '30000000-0000-4000-8000-00000000000a'
const SESSION_FAILED = '30000000-0000-4000-8000-00000000000b'
const DRAFT = '50000000-0000-4000-8000-000000000001'

// The connection descriptors the server authority (GET /api/video-generations/connections) returns. `connectionsBehaviour` lets a
// test make that request fail.
let connections: VideoGenerationConnectionDescriptor[]
let connectionsBehaviour: 'ok' | 'unavailable' | 'network-error'
const mcpAccount = (overrides: Partial<VideoGenerationConnectionDescriptor> = {}): VideoGenerationConnectionDescriptor => ({
  ref: accountConnectionRef('00000000-0000-4000-8000-0000000000aa'), provider: 'kling', connectionMethod: 'mcp_oauth', transport: 'mcp', label: 'Minha conta Kling',
  detail: 'MCP · usa os créditos da sua conta Kling (web)', funding: 'kling_web_credits', status: 'connected', canGenerate: true, needsGenerationAuthorization: false,
  accountLabel: 'Pro', capabilitiesFreshness: 'fresh', capabilitiesCheckedAt: '2026-10-14T10:00:00Z', operations: [], ...overrides,
})
let connectionCalls: string[]
let providerStatusCalls: string[]

function installData() {
  const generations = [
    ...STANDALONE.map((status) => generation(`gen-${status}`, status)),
    generation('gen-owned', 'failed', SESSION_FAILED),
  ]
  global.fetch = vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
    if (url.includes('/api/settings/providers')) { providerStatusCalls.push(url); return json({ providers: {} }) }
    if (url.includes('/api/video-generations/connections')) {
      connectionCalls.push(url)
      if (connectionsBehaviour === 'network-error') throw new TypeError('network down')
      if (connectionsBehaviour === 'unavailable') return new Response(JSON.stringify({ error: 'x', code: 'CONNECTIONS_UNAVAILABLE' }), { status: 503 })
      return json({ connections })
    }
    if (url.includes('/api/video-drafts')) return json({ drafts: [{ id: DRAFT, project_id: PROJ, production_id: PROD, name: 'Edição Alfa', updated_at: '2026-10-02T10:00:00Z', scenes: [] }] })
    if (url.includes('/api/video-generation-sessions')) {
      return json({ sessions: [
        { id: SESSION_EMPTY, projectId: PROJ, productionId: PROD, updatedAt: '2026-10-03T10:00:00Z', workingState: { schemaVersion: 1, prompt: 'Sessão vazia' } },
        { id: SESSION_FAILED, projectId: PROJ, productionId: PROD, updatedAt: '2026-10-03T11:00:00Z', workingState: { schemaVersion: 1, prompt: 'Sessão com falha' } },
      ] })
    }
    if (url === '/api/video-generations') return json({ generations })
    return json({})
  }) as unknown as typeof fetch
}

beforeEach(() => {
  // Default: a configured Kling API connection that can generate, so the hub shows no provider notice.
  connections = [describeRestConnection('configured'), describeGeminiConnection('missing', true)]
  connectionsBehaviour = 'ok'
  connectionCalls = []
  providerStatusCalls = []
  push.mockReset()
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => undefined
  Element.prototype.releasePointerCapture ??= () => undefined
  Element.prototype.scrollIntoView ??= () => undefined
  installData()
})
afterEach(() => cleanup())

const statusOf = (testId: string) => {
  const badge = within(screen.getByTestId(testId)).getByTestId('generation-status')
  return { label: badge.textContent, stored: badge.getAttribute('data-status') }
}
async function loaded() {
  await screen.findByTestId('card-generation-gen-queued')
}
async function chooseStatus(label: string) {
  fireEvent.keyDown(document.getElementById('video-filter-status') as HTMLElement, { key: 'Enter' })
  fireEvent.click(await screen.findByRole('option', { name: label }))
}

describe('D9 - generation states in the /videos hub', () => {
  it('reads every real state in Portuguese while keeping the stored value on the card', async () => {
    render(<VideosPage />)
    await loaded()
    expect(statusOf('card-generation-gen-queued')).toEqual({ label: 'Na fila', stored: 'queued' })
    expect(statusOf('card-generation-gen-submitted')).toEqual({ label: 'Enviado', stored: 'submitted' })
    expect(statusOf('card-generation-gen-processing')).toEqual({ label: 'Processando', stored: 'processing' })
    expect(statusOf('card-generation-gen-succeeded')).toEqual({ label: 'Concluído', stored: 'succeeded' })
    expect(statusOf('card-generation-gen-failed')).toEqual({ label: 'Falhou', stored: 'failed' })
  })

  it('a Session shows its latest Attempt state, or "Sem tentativas"', async () => {
    render(<VideosPage />)
    await loaded()
    expect(statusOf(`card-session-${SESSION_EMPTY}`)).toEqual({ label: 'Sem tentativas', stored: 'no_attempts' })
    expect(statusOf(`card-session-${SESSION_FAILED}`)).toEqual({ label: 'Falhou', stored: 'failed' })
  })

  it('no card prints a raw English state as its status text', async () => {
    render(<VideosPage />)
    await loaded()
    for (const badge of screen.getAllByTestId('generation-status')) {
      expect(badge.textContent).not.toMatch(/^(queued|submitted|processing|succeeded|failed|no_attempts)$/)
    }
  })

  it('the action button of a generation that is not ready says the Portuguese state; a finished one says "Assistir"', async () => {
    render(<VideosPage />)
    await loaded()
    const watch = (id: string) => within(screen.getByTestId(`card-generation-${id}`)).getByTestId('watch-generation').textContent
    expect(watch('gen-queued')).toContain('Na fila')
    expect(watch('gen-processing')).toContain('Processando')
    expect(watch('gen-failed')).toContain('Falhou')
    expect(watch('gen-succeeded')).toContain('Assistir')
  })

  it('the status filter offers the draft state and every real generation state', async () => {
    render(<VideosPage />)
    await loaded()
    fireEvent.keyDown(document.getElementById('video-filter-status') as HTMLElement, { key: 'Enter' })
    const options = (await screen.findAllByRole('option')).map((option) => option.textContent)
    expect(options).toEqual(['Todos os status', 'Rascunho', 'Na fila', 'Enviado', 'Processando', 'Concluído', 'Falhou', 'Sem tentativas'])
  })

  it('filtering by a generation state shows those generations (and Sessions in that state) and hides the other kinds', async () => {
    render(<VideosPage />)
    await loaded()
    await chooseStatus('Falhou')
    await waitFor(() => expect(screen.queryByTestId('card-generation-gen-queued')).toBeNull())
    expect(screen.getByTestId('card-generation-gen-failed')).toBeTruthy()
    expect(screen.getByTestId(`card-session-${SESSION_FAILED}`)).toBeTruthy()
    expect(screen.queryByTestId(`card-session-${SESSION_EMPTY}`)).toBeNull()
    expect(screen.queryByTestId(`card-draft-${DRAFT}`)).toBeNull()
  })

  it('"Concluído" keeps only finished generations', async () => {
    render(<VideosPage />)
    await loaded()
    await chooseStatus('Concluído')
    await waitFor(() => expect(screen.queryByTestId('card-generation-gen-failed')).toBeNull())
    expect(screen.getByTestId('card-generation-gen-succeeded')).toBeTruthy()
  })

  it('"Rascunho" still isolates the Creative Editor drafts - they were not eliminated by the new options', async () => {
    render(<VideosPage />)
    await loaded()
    expect(screen.getByTestId(`card-draft-${DRAFT}`)).toBeTruthy()
    await chooseStatus('Rascunho')
    await waitFor(() => expect(screen.queryByTestId('card-generation-gen-succeeded')).toBeNull())
    expect(screen.getByTestId(`card-draft-${DRAFT}`)).toBeTruthy()
    expect(screen.getByTestId('ai-generations-empty')).toBeTruthy()
  })

  it('"Sem tentativas" finds the Session that has not generated yet', async () => {
    render(<VideosPage />)
    await loaded()
    await chooseStatus('Sem tentativas')
    await waitFor(() => expect(screen.queryByTestId('card-generation-gen-queued')).toBeNull())
    expect(screen.getByTestId(`card-session-${SESSION_EMPTY}`)).toBeTruthy()
  })

  it('"Todos os status" restores everything', async () => {
    render(<VideosPage />)
    await loaded()
    await chooseStatus('Falhou')
    await waitFor(() => expect(screen.queryByTestId('card-generation-gen-queued')).toBeNull())
    await chooseStatus('Todos os status')
    await waitFor(() => expect(screen.getByTestId('card-generation-gen-queued')).toBeTruthy())
    expect(screen.getByTestId(`card-draft-${DRAFT}`)).toBeTruthy()
  })
})

describe('D22 - the provider notice follows the connection descriptors (existing authority), never assumes Kling', () => {
  const notice = () => screen.queryByTestId('video-providers-notice')
  const NONE = /Nenhum provedor de vídeo configurado/
  const BLOCKED = /Nenhuma conexão de vídeo disponível para gerar agora/

  it('1. only a Kling MCP account connected and usable: no notice (it used to say "nenhum provedor")', async () => {
    connections = [describeRestConnection('missing'), describeGeminiConnection('missing', true), mcpAccount()]
    render(<VideosPage />)
    await loaded()
    expect(notice()).toBeNull()
    expect(screen.queryByText(NONE)).toBeNull()
    expect(screen.queryByText(BLOCKED)).toBeNull()
  })

  it('2a. MCP connected but blocked (read-only grant): says it exists but cannot generate, with the descriptor\'s own reason', async () => {
    connections = [
      describeRestConnection('missing'), describeGeminiConnection('missing', true),
      mcpAccount({ canGenerate: false, blockedReason: 'generation_authorization_required', needsGenerationAuthorization: true }),
    ]
    render(<VideosPage />)
    await loaded()
    const element = notice()!
    expect(element.getAttribute('data-state')).toBe('blocked')
    expect(element.textContent).toMatch(BLOCKED)
    expect(element.textContent).toContain('Minha conta Kling — Pro é somente leitura. Autorize a geração em Configurações.')
    // Never the false claim that nothing is configured.
    expect(screen.queryByText(NONE)).toBeNull()
  })

  it.each([
    ['authorization_required', 'authorization_required', 'precisa ser reautorizada em Configurações.'],
    ['connection_error', 'error', 'está com erro. Verifique-a em Configurações.'],
    ['capabilities_missing', 'connected', 'ainda não teve as capacidades carregadas. Atualize a conexão em Configurações.'],
    ['capabilities_expired', 'connected', 'está com as capacidades desatualizadas. Atualize a conexão em Configurações.'],
    ['no_supported_models', 'connected', 'não oferece modelos de vídeo compatíveis com o Content Studio.'],
  ] as const)('2b. MCP blocked by %s keeps that real reason', async (reason, status, sentence) => {
    connections = [
      describeRestConnection('missing'), describeGeminiConnection('missing', true),
      mcpAccount({ status, canGenerate: false, blockedReason: reason }),
    ]
    render(<VideosPage />)
    await loaded()
    expect(notice()!.getAttribute('data-state')).toBe('blocked')
    expect(notice()!.textContent).toContain(`Minha conta Kling — Pro ${sentence}`)
    expect(screen.getByRole('button', { name: 'Abrir Configurações' })).toBeTruthy()
  })

  it('2c. a blocked connection next to a usable one is not a problem: usable wins, no notice', async () => {
    connections = [describeRestConnection('configured'), describeGeminiConnection('missing', true), mcpAccount({ status: 'error', canGenerate: false, blockedReason: 'connection_error' })]
    render(<VideosPage />)
    await loaded()
    expect(notice()).toBeNull()
  })

  it('3. only Google Veo available: no notice', async () => {
    connections = [describeRestConnection('missing'), describeGeminiConnection('configured', true)]
    render(<VideosPage />)
    await loaded()
    expect(notice()).toBeNull()
    expect(screen.queryByText(/Kling API não configurada/)).toBeNull()
  })

  it('3b. Google Veo configured but not released here: blocked with the release reason, and no useless "open settings" action', async () => {
    connections = [describeRestConnection('missing'), describeGeminiConnection('configured', false)]
    render(<VideosPage />)
    await loaded()
    expect(notice()!.getAttribute('data-state')).toBe('blocked')
    expect(notice()!.textContent).toContain('Google Veo ainda não foi liberado neste ambiente.')
    expect(screen.queryByRole('button', { name: 'Abrir Configurações' })).toBeNull()
  })

  it('4. nothing configured: the neutral "no provider" notice, naming both options, opening the API tab', async () => {
    connections = [describeRestConnection('missing'), describeGeminiConnection('missing', true)]
    render(<VideosPage />)
    await loaded()
    expect(notice()!.getAttribute('data-state')).toBe('none')
    expect(await screen.findByText('Nenhum provedor de vídeo configurado')).toBeTruthy()
    expect(screen.queryByText(/Kling API não configurada/)).toBeNull()
    expect(screen.getByText(/Google Gemini \(Google Veo\)/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir Configurações' }))
    expect(push).toHaveBeenCalledWith('/configuracoes?tab=api')
  })

  it('4b. an empty connection list is also "none configured"', async () => {
    connections = []
    render(<VideosPage />)
    await loaded()
    expect(notice()!.getAttribute('data-state')).toBe('none')
  })

  it.each([['unavailable' as const], ['network-error' as const]])('5. failure reading the connections (%s): the hub still loads and does NOT claim the user has no provider', async (behaviour) => {
    connectionsBehaviour = behaviour
    connections = [describeRestConnection('missing'), describeGeminiConnection('missing', true)]
    render(<VideosPage />)
    await loaded()
    expect(notice()).toBeNull()
    expect(screen.queryByText(NONE)).toBeNull()
    expect(screen.queryByText(BLOCKED)).toBeNull()
    // Everything else is intact: cards, create actions.
    expect(screen.getByTestId('card-generation-gen-succeeded')).toBeTruthy()
    expect(screen.getByTestId('generate-ai-video-btn')).toBeTruthy()
    expect(screen.queryByText('Não foi possível carregar os dados de vídeo')).toBeNull()
    expect(connectionCalls).toHaveLength(1)
  })

  it('reads the existing authority once, with no other provider-status request', async () => {
    connections = [describeRestConnection('configured'), describeGeminiConnection('missing', true)]
    render(<VideosPage />)
    await loaded()
    expect(connectionCalls).toEqual(['/api/video-generations/connections'])
    expect(providerStatusCalls).toEqual([])
  })

  it('MCP generations in the history still show the connection name taken from the same response', async () => {
    connections = [describeRestConnection('missing'), describeGeminiConnection('missing', true), mcpAccount()]
    const original = global.fetch
    global.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === '/api/video-generations') {
        return new Response(JSON.stringify({ generations: [generation('gen-mcp', 'succeeded', null, { transport: 'mcp', connection_id: '00000000-0000-4000-8000-0000000000aa' })] }), { status: 200 })
      }
      return original(input, init)
    }) as unknown as typeof fetch
    render(<VideosPage />)
    await screen.findByTestId('card-generation-gen-mcp')
    expect(within(screen.getByTestId('card-generation-gen-mcp')).getByTestId('generation-provenance').textContent).toContain('Minha conta Kling — Pro')
    expect(connectionCalls).toHaveLength(1)
  })
})
