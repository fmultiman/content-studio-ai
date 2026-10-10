// @vitest-environment jsdom
import { Component, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ImagesPageShell } from '@/app/(dashboard)/imagens/page'
import { GenerationSessionNavigationProvider } from '@/components/generation-session/session-navigation-guard'
import { installBrowserFaithfulTimers } from '@/lib/generation-session/__tests__/browser-timers'

// FUTURE-053 Slice 1 — the real /imagens shell with only network, auth/Supabase and router faked.
// Prompt Assistance must stay a suggestion: Apply/Discard are the only ways it touches the authored prompt,
// stale responses are dropped, and no assistance action may reach an image provider (Auto Mode included).

const SESSION_ID = '00000000-0000-0000-0000-0000000000aa'
const PROJECT_ID = '00000000-0000-0000-0000-000000000010'
const PRODUCTION_ID = '00000000-0000-0000-0000-000000000020'
const INTENT = 'Uma montanha antiga'
const SUGGESTION = 'An ancient mountain at dawn, soft mist, documentary light.'

const mockRouter = { push: vi.fn(), replace: vi.fn() }
const SEARCH_PARAMS = new URLSearchParams()
const ROUTE_PARAMS = { sessionId: SESSION_ID }
vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  useParams: () => ROUTE_PARAMS,
  useSearchParams: () => SEARCH_PARAMS,
}))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))

const supabaseQuery = (rows: unknown[] = []) => {
  const result = { data: rows, error: null }
  const chain: any = {
    select: () => chain,
    order: () => chain,
    eq: () => chain,
    in: () => chain,
    single: () => Promise.resolve({ data: null, error: null }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
  }
  return chain
}
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => supabaseQuery(),
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } } }) },
  }),
}))

class RecordingBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <div data-testid="error-boundary">crashed</div> : this.props.children }
}

type FetchCall = { url: string; method: string; body: any }
type AssistanceReply = { status: number; payload: unknown }

function installServer(options: { providersFail?: boolean } = {}) {
  let revision = 4
  const calls: FetchCall[] = []
  const pending: Array<(reply: AssistanceReply) => void> = []
  const session = () => ({
    id: SESSION_ID, projectId: PROJECT_ID, productionId: PRODUCTION_ID, currentImageId: null,
    revision, workingPrompt: INTENT,
    workingState: {
      schemaVersion: 1, generatedPrompt: null, generatedPromptPt: null, promptDetails: null, autoMode: true,
      selectedModel: 'gpt-image-2', imageStatus: 'draft', currentAttempt: 1, currentImageId: null,
      sourceReferences: [], generationConfig: { size: '1024x1024', quality: 'medium', aspectRatio: '1:1', style: null, providerOptions: {} },
      legacyImageUrl: null,
    },
    legacyCurrentEvaluation: null,
  })
  const fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : null
    calls.push({ url, method, body })
    const json = (payload: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(payload), { status }))
    if (url === '/api/prompt-assistance') {
      return new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        pending.push((reply) => resolve(new Response(JSON.stringify(reply.payload), { status: reply.status })))
      })
    }
    if (url.startsWith(`/api/image-generation-sessions/${SESSION_ID}`)) {
      if (method === 'PATCH') { revision += 1; return json({ session: session() }) }
      return json({ session: session() })
    }
    if (url.startsWith('/api/image-generation-attempts')) return json({ attempts: [] })
    if (url.startsWith('/api/image-generation-sessions')) return json({ sessions: [] })
    if (url.startsWith('/api/image-drafts')) return json({ drafts: [] })
    if (url.startsWith('/api/settings/providers')) {
      if (options.providersFail) return Promise.reject(new Error('network down'))
      return json({ providers: { openai: { status: 'configured' } } })
    }
    if (url.startsWith('/api/productions/')) return json({ production: { title: 'Criação', project_id: PROJECT_ID } })
    return json({})
  })
  const assistanceCalls = () => calls.filter((call) => call.url === '/api/prompt-assistance')
  return { fetchMock, calls, pending, assistanceCalls }
}

const FORBIDDEN = /\/api\/(openai\/generate-image|nanobanana|reviews\/image|evaluate-image|prompts\/generate-image-prompt|prompts\/translate|image-generation-attempts$)/
const nonAssistancePosts = (calls: FetchCall[]) => calls.filter((call) => call.method === 'POST' && call.url !== '/api/prompt-assistance')

let restoreTimers: () => void
let server: ReturnType<typeof installServer>

function mount(options: { providersFail?: boolean } = {}) {
  server = installServer(options)
  global.fetch = server.fetchMock as unknown as typeof fetch
  render(
    <RecordingBoundary>
      <GenerationSessionNavigationProvider><ImagesPageShell canonicalSessionId={SESSION_ID} /></GenerationSessionNavigationProvider>
    </RecordingBoundary>,
  )
}

beforeEach(() => {
  // jsdom has no layout; the page scrolls the suggestion into view.
  Element.prototype.scrollIntoView = vi.fn()
  restoreTimers = installBrowserFaithfulTimers()
  mockRouter.push.mockReset()
  mockRouter.replace.mockReset()
})

afterEach(() => {
  cleanup()
  restoreTimers()
  vi.clearAllMocks()
})

vi.setConfig({ testTimeout: 20_000 })

const intentField = () => screen.findByDisplayValue(INTENT) as Promise<HTMLTextAreaElement>
const createButton = () => screen.getByRole('button', { name: /Criar com IA|Gerando/ }) as HTMLButtonElement
const reply = (index: number, status: number, payload: unknown) => server.pending[index]({ status, payload })
const success = (suggestedPrompt = SUGGESTION) => ({ suggestedPrompt, provider: 'openai', model: 'gpt-4o-mini', operation: 'create', usage: null })

async function startCreate() {
  const field = await intentField()
  await waitFor(() => expect(createButton().disabled).toBe(false))
  fireEvent.click(createButton())
  await waitFor(() => expect(server.assistanceCalls()).toHaveLength(1))
  return field
}

describe('FUTURE-053 Prompt Assistance — /imagens workspace', () => {
  it('shows an unapplied suggestion, sends only identifiers (never Identity or context) and never generates media', async () => {
    mount()
    await startCreate()
    const [call] = server.assistanceCalls()
    expect(call.body).toMatchObject({
      projectId: PROJECT_ID, productionId: PRODUCTION_ID, mediaType: 'image', operation: 'create',
      originalText: INTENT, provider: 'openai', model: 'gpt-4o-mini',
    })
    expect(Object.keys(call.body)).not.toEqual(expect.arrayContaining(['identity', 'projectContext']))

    reply(0, 200, success())
    const card = await screen.findByTestId('prompt-assistance-suggestion')
    expect((screen.getByLabelText('Sugestão de prompt') as HTMLTextAreaElement).value).toBe(SUGGESTION)
    expect(card.textContent).toContain('Não aplicada')
    // Nothing was applied: there is still no editable generated prompt and no image button.
    expect(screen.queryByRole('button', { name: /Criar Imagem/ })).toBeNull()
    expect(nonAssistancePosts(server.calls)).toHaveLength(0)
    expect(server.calls.filter((c) => FORBIDDEN.test(c.url))).toHaveLength(0)
  })

  it('Auto Mode is shown as unavailable and enabling it cannot make assistance submit an image request', async () => {
    mount()
    await startCreate()
    // The session was persisted with autoMode: true.
    const autoMode = screen.getByRole('switch') as HTMLButtonElement
    expect(autoMode.disabled).toBe(true)
    expect(screen.getByText(/nunca gera imagem automaticamente/)).toBeTruthy()

    reply(0, 200, success())
    await screen.findByTestId('prompt-assistance-suggestion')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(nonAssistancePosts(server.calls)).toHaveLength(0)
    expect(server.calls.filter((c) => FORBIDDEN.test(c.url))).toHaveLength(0)
  })

  it('Apply writes the suggestion into the editable prompt only; Discard leaves authored state untouched', async () => {
    mount()
    const field = await startCreate()
    reply(0, 200, success())
    fireEvent.click(await screen.findByTestId('prompt-assistance-discard'))
    expect(screen.queryByTestId('prompt-assistance-suggestion')).toBeNull()
    expect(field.value).toBe(INTENT)
    expect(screen.queryByRole('button', { name: /Criar Imagem/ })).toBeNull()

    await waitFor(() => expect(createButton().disabled).toBe(false))
    fireEvent.click(createButton())
    await waitFor(() => expect(server.assistanceCalls()).toHaveLength(2))
    reply(1, 200, success())
    fireEvent.click(await screen.findByTestId('prompt-assistance-apply'))

    expect(screen.queryByTestId('prompt-assistance-suggestion')).toBeNull()
    const prompt = await screen.findByDisplayValue(SUGGESTION) as HTMLTextAreaElement
    expect(prompt.id).toBe('generated-prompt')
    expect(prompt.readOnly).toBe(false)
    expect(field.value).toBe(INTENT)
    expect(nonAssistancePosts(server.calls)).toHaveLength(0)
  })

  it('drops a response whose source text changed while it was in flight', async () => {
    mount()
    const field = await startCreate()
    fireEvent.change(field, { target: { value: `${INTENT} em ruínas` } })
    reply(0, 200, success())
    await waitFor(() => expect(createButton().disabled).toBe(false))
    expect(screen.queryByTestId('prompt-assistance-suggestion')).toBeNull()
    expect(field.value).toBe(`${INTENT} em ruínas`)
  })

  it('blocks a second request while one is in flight and accepts a new one after the first settles', async () => {
    mount()
    await startCreate()
    expect(createButton().disabled).toBe(true)
    reply(0, 200, success())
    fireEvent.click(await screen.findByTestId('prompt-assistance-discard'))
    await waitFor(() => expect(createButton().disabled).toBe(false))
    fireEvent.click(createButton())
    await waitFor(() => expect(server.assistanceCalls()).toHaveLength(2))
    reply(1, 200, success('Second suggestion.'))
    expect((await screen.findByLabelText('Sugestão de prompt') as HTMLTextAreaElement).value).toBe('Second suggestion.')
  })

  it('a typed provider error shows no suggestion, keeps authored text and re-enables the action', async () => {
    mount()
    const field = await startCreate()
    reply(0, 429, { code: 'PROVIDER_RATE_LIMITED', message: 'limitado' })
    await waitFor(() => expect(createButton().disabled).toBe(false))
    expect(screen.queryByTestId('prompt-assistance-suggestion')).toBeNull()
    expect(field.value).toBe(INTENT)
    expect(screen.queryByTestId('error-boundary')).toBeNull()
    expect(nonAssistancePosts(server.calls)).toHaveLength(0)
  })

  it('does not advertise assistance capability when the provider-status lookup fails', async () => {
    mount({ providersFail: true })
    await intentField()
    await waitFor(() => expect(server.calls.some((c) => c.url.startsWith('/api/settings/providers'))).toBe(true))
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(createButton().disabled).toBe(true)
    fireEvent.click(createButton())
    expect(server.assistanceCalls()).toHaveLength(0)
  })
})
