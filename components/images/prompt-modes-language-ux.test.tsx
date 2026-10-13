// @vitest-environment jsdom
import { Component, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ImagesPageShell } from '@/app/(dashboard)/imagens/page'
import { GenerationSessionNavigationProvider } from '@/components/generation-session/session-navigation-guard'
import { installBrowserFaithfulTimers } from '@/lib/generation-session/__tests__/browser-timers'

// GENERATION_PROMPT_MODES_LANGUAGE_UX_CONVERGENCE_V1: real /imagens shell, only network/auth/router faked.
// Manual has one prompt field; the Portuguese tab is an explicit, read-only, prompt-bound view.

const SESSION_ID = '00000000-0000-0000-0000-0000000000aa'
const PROJECT_ID = '00000000-0000-0000-0000-000000000010'
const PRODUCTION_ID = '00000000-0000-0000-0000-000000000020'
const INTENT = 'Uma montanha antiga'
const PROMPT = 'An ancient mountain at dawn, soft mist, documentary light.'

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
type SessionOptions = { generatedPrompt?: string | null; generatedPromptPt?: string | null; workflowMode?: string | null; autoMode?: boolean; openai?: boolean }

function installServer(options: SessionOptions = {}) {
  let revision = 4
  const calls: FetchCall[] = []
  const pendingTranslation: Array<(response: Response) => void> = []
  let stored: any = {
    workingPrompt: INTENT,
    workingState: {
      schemaVersion: 1, generatedPrompt: options.generatedPrompt ?? null, generatedPromptPt: options.generatedPromptPt ?? null, promptDetails: null,
      autoMode: options.autoMode ?? false, ...(options.workflowMode !== undefined ? { workflowMode: options.workflowMode } : {}),
      selectedModel: 'gpt-image-2', imageStatus: 'draft', currentAttempt: 1, currentImageId: null,
      sourceReferences: [], generationConfig: { size: '1024x1024', quality: 'medium', aspectRatio: '1:1', style: null, providerOptions: {} },
      legacyImageUrl: null,
    },
  }
  const session = () => ({
    id: SESSION_ID, projectId: PROJECT_ID, productionId: PRODUCTION_ID, currentImageId: null, revision,
    workingPrompt: stored.workingPrompt, workingState: stored.workingState, legacyCurrentEvaluation: null,
  })
  const fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : null
    calls.push({ url, method, body })
    const json = (payload: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(payload), { status }))
    if (url === '/api/prompts/translate') return new Promise<Response>((resolve) => { pendingTranslation.push(resolve) })
    if (url.startsWith(`/api/image-generation-sessions/${SESSION_ID}`)) {
      if (method === 'PATCH') {
        revision += 1
        stored = { workingPrompt: body.workingPrompt ?? stored.workingPrompt, workingState: body.workingState ?? stored.workingState }
        return json({ session: session() })
      }
      return json({ session: session() })
    }
    if (url.startsWith('/api/image-generation-attempts')) return json({ attempts: [] })
    if (url.startsWith('/api/image-generation-sessions')) return json({ sessions: [] })
    if (url.startsWith('/api/image-drafts')) return json({ drafts: [] })
    if (url.startsWith('/api/settings/providers')) return json({ providers: { openai: { status: options.openai === false ? 'missing' : 'configured' } } })
    if (url.startsWith('/api/productions/')) return json({ production: { title: 'Criação', project_id: PROJECT_ID } })
    return json({})
  })
  const translateCalls = () => calls.filter((call) => call.url === '/api/prompts/translate')
  const patches = () => calls.filter((call) => call.method === 'PATCH')
  const replyTranslation = (index: number, translatedPrompt: string) =>
    pendingTranslation[index](new Response(JSON.stringify({ translatedPrompt, model: 'gpt-4o-mini' }), { status: 200 }))
  return { fetchMock, calls, translateCalls, patches, replyTranslation }
}

let restoreTimers: () => void
let server: ReturnType<typeof installServer>

function mount(options: SessionOptions = {}) {
  server = installServer(options)
  global.fetch = server.fetchMock as unknown as typeof fetch
  render(
    <RecordingBoundary>
      <GenerationSessionNavigationProvider><ImagesPageShell canonicalSessionId={SESSION_ID} /></GenerationSessionNavigationProvider>
    </RecordingBoundary>,
  )
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  restoreTimers = installBrowserFaithfulTimers()
  mockRouter.push.mockReset()
  mockRouter.replace.mockReset()
})
afterEach(() => { cleanup(); restoreTimers(); vi.clearAllMocks() })
vi.setConfig({ testTimeout: 20_000 })

const promptField = () => document.getElementById('generated-prompt') as HTMLTextAreaElement
const tab = (name: 'prompt' | 'pt') => screen.getByTestId(`image-prompt-tab-${name}`)
const openTab = (name: 'prompt' | 'pt') => { fireEvent.mouseDown(tab(name), { button: 0 }); fireEvent.click(tab(name)) }

describe('Prompt modes + language convergence — Images', () => {
  it('Manual has a single prompt field; the briefing is preserved and reused only by an explicit click', async () => {
    mount({ workflowMode: 'manual' })
    await screen.findByTestId('image-briefing-preserved')
    expect(screen.queryByRole('textbox', { name: 'Sua descrição' })).toBeNull()
    expect(promptField().value).toBe('')
    expect(screen.queryByRole('button', { name: /Criar com IA/ })).toBeNull()
    fireEvent.click(screen.getByTestId('image-use-description-as-prompt'))
    await waitFor(() => expect(promptField().value).toBe(INTENT))
    expect(screen.queryByTestId('image-briefing-preserved')).toBeNull()
    expect(server.translateCalls()).toHaveLength(0)
  })

  it('the selected mode is persisted, so Manual survives a reload with the briefing kept', async () => {
    mount()
    await screen.findByDisplayValue(INTENT)
    fireEvent.click(screen.getByTestId('workflow-mode-manual'))
    await waitFor(() => expect(server.patches().some((call) => call.body.workingState?.workflowMode === 'manual')).toBe(true))
    expect(server.patches().at(-1)!.body.workingPrompt).toBe(INTENT)
  })

  it('Assisted explains why Create and Improve are unavailable', async () => {
    mount({ workflowMode: 'assisted' })
    await screen.findByDisplayValue(INTENT)
    expect(screen.getByTestId('image-assistance-disabled-reason').textContent).toMatch(/Melhorar com IA: escreva ou aplique um prompt/)
    expect((screen.getByRole('button', { name: /Melhorar com IA/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('opening the Portuguese tab never translates; one explicit click does, once, as a read-only view', async () => {
    mount({ generatedPrompt: PROMPT, workflowMode: 'manual' })
    await waitFor(() => expect(promptField()?.value).toBe(PROMPT))
    openTab('pt')
    await screen.findByTestId('image-prompt-translation-empty')
    expect(screen.getByTestId('image-prompt-translation-cost').textContent).toMatch(/BYOK/)
    expect(server.translateCalls()).toHaveLength(0)
    fireEvent.click(screen.getByTestId('image-prompt-translate'))
    await waitFor(() => expect(server.translateCalls()).toHaveLength(1))
    expect(server.translateCalls()[0].body).toEqual({ prompt: PROMPT })
    server.replyTranslation(0, 'Uma montanha antiga ao amanhecer.')
    const output = await screen.findByTestId('image-prompt-translation-output') as HTMLTextAreaElement
    expect(output.value).toBe('Uma montanha antiga ao amanhecer.')
    expect(output.readOnly).toBe(true)
    openTab('prompt'); openTab('pt')
    expect(((await screen.findByTestId('image-prompt-translation-output')) as HTMLTextAreaElement).value).toBe('Uma montanha antiga ao amanhecer.')
    expect(server.translateCalls()).toHaveLength(1)
    openTab('prompt')
    expect(promptField().value).toBe(PROMPT)
  })

  it('editing the generation prompt discards the translation; a late response for the old prompt is dropped', async () => {
    mount({ generatedPrompt: PROMPT, workflowMode: 'manual' })
    await waitFor(() => expect(promptField()?.value).toBe(PROMPT))
    openTab('pt')
    fireEvent.click(await screen.findByTestId('image-prompt-translate'))
    await waitFor(() => expect(server.translateCalls()).toHaveLength(1))
    openTab('prompt')
    fireEvent.change(promptField(), { target: { value: `${PROMPT} Wide angle.` } })
    server.replyTranslation(0, 'Tradução antiga')
    openTab('pt')
    await screen.findByTestId('image-prompt-translation-empty')
    expect(screen.queryByTestId('image-prompt-translation-output')).toBeNull()
  })

  it('a saved translation of the saved prompt is shown without any provider call', async () => {
    mount({ generatedPrompt: PROMPT, generatedPromptPt: 'Uma montanha antiga ao amanhecer.', workflowMode: 'manual' })
    await waitFor(() => expect(promptField()?.value).toBe(PROMPT))
    openTab('pt')
    expect(((await screen.findByTestId('image-prompt-translation-output')) as HTMLTextAreaElement).value).toBe('Uma montanha antiga ao amanhecer.')
    expect(server.translateCalls()).toHaveLength(0)
  })

  it('translation is unavailable and explained without an OpenAI key', async () => {
    mount({ generatedPrompt: PROMPT, workflowMode: 'manual', openai: false })
    await waitFor(() => expect(promptField()?.value).toBe(PROMPT))
    openTab('pt')
    expect((await screen.findByTestId('image-prompt-translation-unavailable')).textContent).toMatch(/Tradução indisponível/)
    expect((screen.getByTestId('image-prompt-translate') as HTMLButtonElement).disabled).toBe(true)
    expect(server.translateCalls()).toHaveLength(0)
  })
})
