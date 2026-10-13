// @vitest-environment jsdom
import { Component, type ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ImagesPageShell } from '@/app/(dashboard)/imagens/page'
import { GenerationSessionNavigationProvider } from '@/components/generation-session/session-navigation-guard'
import { installBrowserFaithfulTimers } from '@/lib/generation-session/__tests__/browser-timers'

// FUTURE-064 Slice B — the REAL /imagens shell with the official Google Gemini ("Nano Banana") models. Only network,
// auth/Supabase and router are faked: no provider is ever called, no image is ever generated.

const SESSION_ID = '00000000-0000-0000-0000-0000000000aa'
const PROJECT_ID = '00000000-0000-0000-0000-000000000010'
const PRODUCTION_ID = '00000000-0000-0000-0000-000000000020'
const DESCRIPTION = 'Uma montanha antiga ao amanhecer'
const GENERATED = 'An ancient mountain at dawn, golden mist, wide documentary framing, soft natural light, highly detailed.'
const AUTHORED = 'My own exact prompt, with several, comma separated, segments and a final detail.'

const mockRouter = { push: vi.fn(), replace: vi.fn() }
const SEARCH_PARAMS = new URLSearchParams()
const ROUTE_PARAMS = { sessionId: SESSION_ID }
vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  useParams: () => ROUTE_PARAMS,
  useSearchParams: () => SEARCH_PARAMS,
}))
const toastMock = vi.hoisted(() => vi.fn())
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: toastMock }) }))

let settingsRow: Record<string, unknown> | null = null
const supabaseQuery = (table: string) => {
  const result = { data: [] as unknown[], error: null }
  const chain: any = {
    select: () => chain,
    order: () => chain,
    eq: () => chain,
    in: () => chain,
    insert: () => chain,
    update: () => chain,
    upsert: () => chain,
    single: () => Promise.resolve({ data: table === 'user_settings' ? settingsRow : null, error: null }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
  }
  return chain
}
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => supabaseQuery(table),
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } } }) },
  }),
}))

class RecordingBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <div data-testid="error-boundary">crashed</div> : this.props.children }
}

type Call = { url: string; method: string; body: any }
type Reply = { status: number; payload: unknown }
type Availability = { available: boolean; reason: string }
type ServerOptions = {
  providers?: Record<string, { status: string }>
  /** `undefined` = the server did not send the signal at all (older/failed lookup). */
  availability?: Availability | undefined
  workingPrompt?: string
  generatedPrompt?: string | null
  autoMode?: boolean
  selectedModel?: string
}

const ON: Availability = { available: true, reason: 'available' }
const OFF: Availability = { available: false, reason: 'release_switch_off' }
const BLOCKED: Availability = { available: false, reason: 'environment_blocked' }
const ALL_CONFIGURED = { openai: { status: 'configured' }, gemini: { status: 'configured' }, nano_banana: { status: 'configured' } }

function installServer(options: ServerOptions = {}) {
  let revision = 4
  let stored: { workingPrompt: string; workingState: Record<string, unknown> } | null = null
  const calls: Call[] = []
  const assistance: Array<(reply: Reply) => void> = []
  const gemini: Array<(reply: Reply) => void> = []
  const openai: Array<(reply: Reply) => void> = []
  let imageCount = 0
  const session = () => ({
    id: SESSION_ID, projectId: PROJECT_ID, productionId: PRODUCTION_ID, currentImageId: null,
    revision, workingPrompt: stored?.workingPrompt ?? options.workingPrompt ?? DESCRIPTION,
    workingState: stored?.workingState ?? {
      schemaVersion: 1, generatedPrompt: options.generatedPrompt ?? null, generatedPromptPt: null, promptDetails: null, autoMode: options.autoMode ?? false,
      selectedModel: options.selectedModel ?? 'gpt-image-2', imageStatus: 'draft', currentAttempt: 1, currentImageId: null,
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
        assistance.push((reply) => resolve(new Response(JSON.stringify(reply.payload), { status: reply.status })))
      })
    }
    if (url === '/api/gemini/generate-image') {
      return new Promise<Response>((resolve) => { gemini.push((reply) => resolve(new Response(JSON.stringify(reply.payload), { status: reply.status }))) })
    }
    if (url === '/api/openai/generate-image') {
      return new Promise<Response>((resolve) => { openai.push((reply) => resolve(new Response(JSON.stringify(reply.payload), { status: reply.status }))) })
    }
    if (url === '/api/nanobanana/generate') return json({ taskId: 'task-1' })
    if (url.startsWith('/api/nanobanana/status/')) return json({ status: 'completed', imageUrl: 'https://img.test/nb.png', image: { id: 'img-nb' } })
    if (url.startsWith(`/api/image-generation-sessions/${SESSION_ID}`)) {
      if (method === 'PATCH') { stored = { workingPrompt: body.workingPrompt, workingState: body.workingState }; revision += 1; return json({ session: session() }) }
      return json({ session: session() })
    }
    if (url.startsWith('/api/image-generation-attempts')) return json({ attempts: [] })
    if (url.startsWith('/api/image-generation-sessions')) return json({ sessions: [] })
    if (url.startsWith('/api/image-drafts')) return json({ drafts: [] })
    if (url.startsWith('/api/settings/providers')) {
      return json({
        providers: options.providers ?? ALL_CONFIGURED,
        ...('availability' in options && options.availability === undefined ? {} : { imageGeneration: { gemini: options.availability ?? OFF } }),
      })
    }
    if (url.startsWith('/api/productions/')) return json({ production: { title: 'Criação', project_id: PROJECT_ID } })
    return json({})
  })
  const to = (url: string) => calls.filter((call) => call.url === url)
  return {
    fetchMock, calls,
    assistanceCalls: () => to('/api/prompt-assistance'),
    geminiCalls: () => to('/api/gemini/generate-image'),
    openaiCalls: () => to('/api/openai/generate-image'),
    nanoCalls: () => to('/api/nanobanana/generate'),
    patches: () => calls.filter((call) => call.method === 'PATCH'),
    replyAssistance: (index: number, status: number, payload: unknown) => assistance[index]({ status, payload }),
    replyGemini: (index: number, status: number, payload: unknown) => gemini[index]({ status, payload }),
    replyOpenai: (index: number, status: number, payload: unknown) => openai[index]({ status, payload }),
    nextImageId: () => `img-${++imageCount}`,
  }
}

const assistanceOk = (suggestedPrompt = GENERATED, provider = 'openai', model = 'gpt-4o-mini') => ({ suggestedPrompt, provider, model, operation: 'create', usage: null })
const geminiOk = (id: string, model = 'gemini-nb-2.1', providerModel = 'gemini-nano-banana-2.1') => ({
  imageUrl: `https://img.test/${id}.png`, image: { id, user_id: 'user-1', status: 'draft' }, attemptId: `attempt-${id}`,
  provider: 'gemini', model, providerModel, replayed: false,
})
const openaiOk = (id: string) => ({ imageUrl: `https://img.test/${id}.png`, image: { id, user_id: 'user-1', status: 'draft' }, attemptId: `attempt-${id}` })

let restoreTimers: () => void
let server: ReturnType<typeof installServer>

function mount(options: ServerOptions = {}) {
  server = installServer(options)
  global.fetch = server.fetchMock as unknown as typeof fetch
  render(
    <RecordingBoundary>
      <GenerationSessionNavigationProvider><ImagesPageShell canonicalSessionId={SESSION_ID} /></GenerationSessionNavigationProvider>
    </RecordingBoundary>,
  )
}

beforeAll(() => {
  // Radix Select needs a few DOM APIs jsdom does not implement.
  const proto = window.HTMLElement.prototype as any
  proto.hasPointerCapture ??= () => false
  proto.setPointerCapture ??= () => undefined
  proto.releasePointerCapture ??= () => undefined
  ;(window as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }
})

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  restoreTimers = installBrowserFaithfulTimers()
  settingsRow = { automation_enabled: true, default_image_model: 'gpt-image-2', image_evaluator_enabled: true, max_refinement_iterations: 3 }
  mockRouter.push.mockReset()
  mockRouter.replace.mockReset()
  toastMock.mockReset()
})

afterEach(() => {
  cleanup()
  restoreTimers()
  vi.clearAllMocks()
})

vi.setConfig({ testTimeout: 20_000 })
configure({ asyncUtilTimeout: 5000 })

const description = () => screen.findByDisplayValue(DESCRIPTION) as Promise<HTMLTextAreaElement>
const promptEditor = () => document.getElementById('generated-prompt') as HTMLTextAreaElement
const modeButton = (mode: 'manual' | 'assisted' | 'automatic') => screen.getByTestId(`workflow-mode-${mode}`) as HTMLButtonElement
const startButton = () => screen.getByTestId('automatic-run-start') as HTMLButtonElement
const createImageButton = () => screen.getByRole('button', { name: /Criar Imagem|Criando/ }) as HTMLButtonElement
const modelTrigger = () => screen.getByLabelText('Modelo de imagem') as HTMLElement
const toastDescriptions = () => toastMock.mock.calls.map(([arg]) => String((arg as { description?: string }).description ?? ''))

async function ready() {
  const field = await description()
  await waitFor(() => expect(screen.getByTestId('workflow-mode-control')).toBeTruthy())
  await waitFor(() => expect(modeButton('automatic').disabled).toBe(false))
  return field
}
async function selectAutomatic() {
  await ready()
  fireEvent.click(modeButton('automatic'))
  await waitFor(() => expect(screen.getByTestId('automatic-run-panel')).toBeTruthy())
}
async function openModelSelect() {
  fireEvent.pointerDown(modelTrigger(), { button: 0, ctrlKey: false, pointerType: 'mouse' })
  return screen.findByRole('listbox')
}
async function manualWithPrompt(prompt = AUTHORED) {
  await ready()
  fireEvent.click(modeButton('manual'))
  fireEvent.change(promptEditor(), { target: { value: prompt } })
  await waitFor(() => expect(promptEditor().value).toBe(prompt))
}
async function clickCreate() {
  await waitFor(() => expect(createImageButton().disabled).toBe(false))
  fireEvent.click(createImageButton())
}

describe('release switch OFF (the Production state): Google models are visibly disabled, nothing else changes', () => {
  it('lists three distinct providers, disables the Google models with an accurate reason, and keeps OpenAI and legacy third-party selectable', async () => {
    mount({ availability: OFF })
    await ready()
    const listbox = await openModelSelect()
    const labels = Array.from(listbox.querySelectorAll('[role="group"]')).map((group) => group.textContent ?? '')
    expect(labels.some((text) => /OpenAI/.test(text))).toBe(true)
    expect(labels.some((text) => /Google Gemini \(oficial\)/.test(text))).toBe(true)
    expect(labels.some((text) => /NanoBananaAPI\.ai \(terceiros — legado\)/.test(text))).toBe(true)

    const google21 = screen.getByRole('option', { name: 'Google Gemini — Nano Banana 2.1 (oficial)' })
    const googleLite = screen.getByRole('option', { name: 'Google Gemini — Nano Banana 2 Lite (oficial)' })
    expect(google21.getAttribute('aria-disabled')).toBe('true')
    expect(googleLite.getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByRole('option', { name: 'GPT Image 2' }).getAttribute('aria-disabled')).not.toBe('true')
    expect(screen.getByRole('option', { name: 'NanoBananaAPI.ai V1 (terceiros — legado)' }).getAttribute('aria-disabled')).not.toBe('true')
    expect(screen.getByRole('option', { name: 'NanoBananaAPI.ai V2 (terceiros — legado)' }).getAttribute('aria-disabled')).not.toBe('true')
    // The legacy labels no longer read as if they were the official API.
    expect(document.body.textContent).not.toMatch(/NanoBanana V1|NanoBanana V2/)

    const note = screen.getByTestId('google-model-note').textContent ?? ''
    expect(note).toMatch(/ainda não foi habilitada neste ambiente/)
    expect(note).not.toMatch(/chave|configure/i) // a disabled capability is not a missing credential
  })

  it('a saved Google model while the switch is OFF: Criar Imagem is blocked, nothing is POSTed, and the reason is the capability (not the key)', async () => {
    mount({ availability: OFF, selectedModel: 'gemini-nb-2.1', generatedPrompt: AUTHORED })
    await ready()
    await waitFor(() => expect(screen.getByTestId('create-disabled-reason')).toBeTruthy())
    const reason = screen.getByTestId('create-disabled-reason').textContent ?? ''
    expect(reason).toMatch(/ainda não foi habilitada/)
    expect(reason).not.toMatch(/chave|Configure/i)
    expect(createImageButton().disabled).toBe(true)
    fireEvent.click(createImageButton())
    expect(server.geminiCalls()).toHaveLength(0)
    expect(server.openaiCalls()).toHaveLength(0)
    expect(server.nanoCalls()).toHaveLength(0)
    // No substitution: the selection is still the Google model.
    expect(modelTrigger().textContent).toMatch(/Nano Banana 2\.1/)
  })

  it('with the key configured the OFF state still never implies availability (key readiness does not enable the capability)', async () => {
    mount({ availability: OFF, selectedModel: 'gemini-nb-lite', generatedPrompt: AUTHORED, providers: { gemini: { status: 'configured' }, openai: { status: 'configured' } } })
    await ready()
    expect(screen.getByTestId('create-disabled-reason').textContent).toMatch(/não foi habilitada/)
    expect(createImageButton().disabled).toBe(true)
  })

  it.each([
    ['environment blocked (Preview/local)', BLOCKED, /desativada neste ambiente/],
    ['signal missing from the response', undefined, /Não foi possível verificar/],
  ])('treats %s as unavailable', async (_name, availability, text) => {
    mount({ availability, selectedModel: 'gemini-nb-2.1', generatedPrompt: AUTHORED })
    await ready()
    expect(screen.getByTestId('create-disabled-reason').textContent).toMatch(text)
    expect(createImageButton().disabled).toBe(true)
    fireEvent.click(createImageButton())
    expect(server.geminiCalls()).toHaveLength(0)
  })

  it('AUTOMATIC cannot start with a Google model while OFF: zero text calls, zero image calls', async () => {
    mount({ availability: OFF, selectedModel: 'gemini-nb-2.1' })
    await selectAutomatic()
    expect(startButton().disabled).toBe(true)
    expect(screen.getByTestId('automatic-run-disabled-reason').textContent).toMatch(/não foi habilitada/)
    fireEvent.click(startButton())
    expect(server.assistanceCalls()).toHaveLength(0)
    expect(server.geminiCalls()).toHaveLength(0)
  })

  it('OpenAI generation still works end to end with the switch OFF', async () => {
    mount({ availability: OFF })
    await manualWithPrompt()
    await clickCreate()
    await waitFor(() => expect(server.openaiCalls()).toHaveLength(1))
    expect(server.openaiCalls()[0].body).toMatchObject({ prompt: AUTHORED, model: 'gpt-image-2', sessionId: SESSION_ID })
    server.replyOpenai(0, 200, openaiOk(server.nextImageId()))
    await waitFor(() => expect(screen.getByText('Gerar Novamente')).toBeTruthy())
    expect(server.geminiCalls()).toHaveLength(0)
  })

  it('the legacy third-party NanoBananaAPI.ai models still generate with the switch OFF', async () => {
    mount({ availability: OFF, selectedModel: 'nanobanana-v2' })
    await manualWithPrompt()
    await clickCreate()
    await waitFor(() => expect(server.nanoCalls()).toHaveLength(1))
    expect(server.nanoCalls()[0].body).toMatchObject({ prompt: AUTHORED, model: 'v2', sessionId: SESSION_ID })
    expect(server.geminiCalls()).toHaveLength(0)
    expect(server.openaiCalls()).toHaveLength(0)
  })

  it('does not use "all non-OpenAI is NanoBanana": a Google model never reaches the NanoBanana route', async () => {
    mount({ availability: OFF, selectedModel: 'gemini-nb-2.1', generatedPrompt: AUTHORED })
    await ready()
    fireEvent.click(createImageButton())
    expect(server.nanoCalls()).toHaveLength(0)
    expect(server.calls.some((call) => call.url.startsWith('/api/nanobanana/status'))).toBe(false)
  })
})

describe('release switch ON (mocked): the Google path', () => {
  it.each(['gemini-nb-2.1', 'gemini-nb-lite'] as const)('MANUAL: sends exactly { prompt, model, aspectRatio, sessionId, clientRequestId } to /api/gemini/generate-image and shows the image (%s)', async (model) => {
    mount({ availability: ON, selectedModel: model })
    await manualWithPrompt()
    expect(screen.getByTestId('google-cost-notice').textContent).toMatch(/pode gerar cobrança na sua conta Google/)
    await clickCreate()
    await waitFor(() => expect(server.geminiCalls()).toHaveLength(1))
    const [call] = server.geminiCalls()
    expect(Object.keys(call.body).sort()).toEqual(['aspectRatio', 'clientRequestId', 'model', 'prompt', 'sessionId'])
    expect(call.body).toMatchObject({ prompt: AUTHORED, model, aspectRatio: '1:1', sessionId: SESSION_ID })
    expect(call.body.clientRequestId).toMatch(/^[0-9a-f-]{36}$/)
    // No source image, no size/quality, no official model id, no provider field.
    expect(JSON.stringify(call.body)).not.toMatch(/inlineData|"size"|"quality"|gemini-nano-banana|providerModel|"provider"|imageUrl|sourceReferences/)
    expect(server.openaiCalls()).toHaveLength(0)
    expect(server.nanoCalls()).toHaveLength(0)
    expect(server.assistanceCalls()).toHaveLength(0)

    server.replyGemini(0, 200, geminiOk(server.nextImageId()))
    await waitFor(() => expect(screen.getByText('Gerar Novamente')).toBeTruthy())
    expect(screen.queryByTestId('error-boundary')).toBeNull()
  })

  it('preserves a saved Lite model through an explicit manual generation', async () => {
    mount({ availability: ON, selectedModel: 'gemini-nb-lite' })
    await manualWithPrompt()
    await clickCreate()
    await waitFor(() => expect(server.geminiCalls()).toHaveLength(1))
    expect(server.geminiCalls()[0].body.model).toBe('gemini-nb-lite')
    expect(modelTrigger().textContent).toMatch(/Nano Banana 2 Lite/)
    expect(server.patches().every((patch) => patch.body.workingState.selectedModel === 'gemini-nb-lite')).toBe(true)
    server.replyGemini(0, 200, geminiOk(server.nextImageId()))
    await waitFor(() => expect(screen.getByText('Gerar Novamente')).toBeTruthy())
  })

  it('persists only approved aliases that fit varchar(20)', async () => {
    mount({ availability: ON, selectedModel: 'gemini-nb-2.1' })
    await manualWithPrompt()
    await clickCreate()
    await waitFor(() => expect(server.geminiCalls()).toHaveLength(1))
    for (const patch of server.patches()) {
      const model = patch.body.workingState.selectedModel as string
      expect(['gpt-image-2', 'gemini-nb-2.1', 'gemini-nb-lite']).toContain(model)
      expect(model.length).toBeLessThanOrEqual(20)
    }
  })

  it('selecting a Google model in the selector is enabled when the capability is available, and the cost notice appears', async () => {
    mount({ availability: ON })
    await ready()
    expect(screen.queryByTestId('google-cost-notice')).toBeNull()
    await openModelSelect()
    const lite = screen.getByRole('option', { name: 'Google Gemini — Nano Banana 2 Lite (oficial)' })
    expect(lite.getAttribute('aria-disabled')).not.toBe('true')
    const option = screen.getByRole('option', { name: 'Google Gemini — Nano Banana 2.1 (oficial)' })
    expect(option.getAttribute('aria-disabled')).not.toBe('true')
    fireEvent.pointerUp(option, { button: 0, pointerType: 'mouse' })
    fireEvent.click(option)
    await waitFor(() => expect(modelTrigger().textContent).toMatch(/Nano Banana 2.1/))
    expect(screen.getByTestId('google-cost-notice').textContent).not.toMatch(/gr[aá]tis|free|\$\s?0|R\$\s?0/i)
    expect(server.geminiCalls()).toHaveLength(0) // selecting is never generating
    expect(screen.queryByTestId('google-model-note')).toBeNull()
  })

  it('a disabled Google option cannot be selected when the switch is OFF', async () => {
    mount({ availability: OFF })
    await ready()
    await openModelSelect()
    const option = screen.getByRole('option', { name: 'Google Gemini — Nano Banana 2.1 (oficial)' })
    fireEvent.pointerUp(option, { button: 0, pointerType: 'mouse' })
    fireEvent.click(option)
    expect(modelTrigger().textContent).toMatch(/GPT Image 2/)
  })

  it('Google key missing while the capability is available: blocked with a credential reason, zero POSTs', async () => {
    mount({ availability: ON, selectedModel: 'gemini-nb-2.1', generatedPrompt: AUTHORED, providers: { openai: { status: 'configured' }, gemini: { status: 'missing' } } })
    await ready()
    const reason = screen.getByTestId('create-disabled-reason').textContent ?? ''
    expect(reason).toMatch(/chave do Google Gemini/)
    expect(reason).not.toMatch(/habilitada/)
    expect(createImageButton().disabled).toBe(true)
    fireEvent.click(createImageButton())
    expect(server.geminiCalls()).toHaveLength(0)
  })

  it('per-provider readiness is independent: a NanoBananaAPI.ai key does not make a Google model ready, and a Google key does not make NanoBanana ready', async () => {
    mount({ availability: ON, selectedModel: 'gemini-nb-2.1', generatedPrompt: AUTHORED, providers: { openai: { status: 'configured' }, nano_banana: { status: 'configured' } } })
    await ready()
    expect(screen.getByTestId('create-disabled-reason').textContent).toMatch(/chave do Google Gemini/)
    cleanup()
    mount({ availability: ON, selectedModel: 'nanobanana-v1', generatedPrompt: AUTHORED, providers: { openai: { status: 'configured' }, gemini: { status: 'configured' } } })
    await selectAutomatic()
    expect(startButton().disabled).toBe(true)
    expect(screen.getByTestId('automatic-run-disabled-reason').textContent).toMatch(/NanoBananaAPI\.ai/)
  })

  it('a failed attempt is retried only by a NEW click with a NEW request id; success also rotates the id', async () => {
    mount({ availability: ON, selectedModel: 'gemini-nb-2.1' })
    await manualWithPrompt()
    await clickCreate()
    await waitFor(() => expect(server.geminiCalls()).toHaveLength(1))
    server.replyGemini(0, 502, { error: 'x', code: 'PROVIDER_UNAVAILABLE', outcome_unknown: false })
    await waitFor(() => expect(createImageButton().disabled).toBe(false))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(server.geminiCalls()).toHaveLength(1) // no hidden retry
    await clickCreate()
    await waitFor(() => expect(server.geminiCalls()).toHaveLength(2))
    expect(server.geminiCalls()[1].body.clientRequestId).not.toBe(server.geminiCalls()[0].body.clientRequestId)
    server.replyGemini(1, 200, geminiOk(server.nextImageId()))
    await waitFor(() => expect(screen.getByText('Gerar Novamente')).toBeTruthy())
  })

  it('a network failure keeps the SAME request id so a retry replays instead of paying twice', async () => {
    mount({ availability: ON, selectedModel: 'gemini-nb-2.1' })
    await manualWithPrompt()
    const original = server.fetchMock.getMockImplementation()!
    server.fetchMock.mockImplementation((input: unknown, init?: RequestInit) =>
      String(input) === '/api/gemini/generate-image' && !server.geminiCalls().length
        ? (original(input, init), Promise.reject(new TypeError('network down')))
        : original(input, init))
    await clickCreate()
    await waitFor(() => expect(server.geminiCalls()).toHaveLength(1))
    await waitFor(() => expect(toastDescriptions().some((text) => /Falha de rede/.test(text))).toBe(true))
    await waitFor(() => expect(createImageButton().disabled).toBe(false))
    await clickCreate()
    await waitFor(() => expect(server.geminiCalls()).toHaveLength(2))
    expect(server.geminiCalls()[1].body.clientRequestId).toBe(server.geminiCalls()[0].body.clientRequestId)
  })

  describe('Slice A error mapping', () => {
    const cases: Array<[number, string, RegExp, RegExp?]> = [
      [403, 'GEMINI_IMAGE_GENERATION_DISABLED', /ainda não foi habilitada/, /chave/i],
      [403, 'PROVIDER_EXECUTION_DISABLED_IN_ENVIRONMENT', /desativada neste ambiente/, /chave/i],
      [400, 'INVALID_IMAGE_MODEL', /não aceitou o modelo/],
      [400, 'PROVIDER_NOT_CONFIGURED', /Configure a chave do Google Gemini/],
      [503, 'PROVIDER_CREDENTIAL_UNAVAILABLE', /Tente novamente em instantes/, /Configure a chave/],
      [400, 'PROVIDER_CREDENTIAL_REJECTED', /recusou a chave/],
      [429, 'PROVIDER_RATE_LIMITED', /Limite ou cota/],
      [422, 'PROVIDER_CONTENT_BLOCKED', /bloqueou este conteúdo/],
      [400, 'SOURCE_NOT_SUPPORTED', /imagens de referência/],
      [504, 'PROVIDER_TIMEOUT', /demorou demais/],
      [502, 'PROVIDER_UNAVAILABLE', /cobrança pode ter ocorrido/],
      [502, 'EMPTY_PROVIDER_RESULT', /não retornou uma imagem/],
      [503, 'STORAGE_UNAVAILABLE', /armazenamento está indisponível/],
    ]
    it.each(cases)('HTTP %i %s is reported accurately', async (status, code, message, notMessage) => {
      mount({ availability: ON, selectedModel: 'gemini-nb-2.1' })
      await manualWithPrompt()
      await clickCreate()
      await waitFor(() => expect(server.geminiCalls()).toHaveLength(1))
      server.replyGemini(0, status, { error: 'server text', code })
      await waitFor(() => expect(toastDescriptions().some((text) => message.test(text))).toBe(true))
      if (notMessage) expect(toastDescriptions().some((text) => notMessage.test(text))).toBe(false)
      expect(screen.queryByText('Gerar Novamente')).toBeNull()
      expect(server.geminiCalls()).toHaveLength(1)
    })

    it('a disabled-route answer flips the workspace to "capability off" (never "missing credential") and stops offering Google generation', async () => {
      mount({ availability: ON, selectedModel: 'gemini-nb-2.1' })
      await manualWithPrompt()
      await clickCreate()
      await waitFor(() => expect(server.geminiCalls()).toHaveLength(1))
      server.replyGemini(0, 403, { error: 'x', code: 'GEMINI_IMAGE_GENERATION_DISABLED' })
      await waitFor(() => expect(screen.getByTestId('create-disabled-reason').textContent).toMatch(/ainda não foi habilitada/))
      expect(createImageButton().disabled).toBe(true)
      expect(toastDescriptions().some((text) => /chave/i.test(text))).toBe(false)
    })

    it('a replayed succeeded request shows the image; a replayed failed request explains it and rotates the id', async () => {
      mount({ availability: ON, selectedModel: 'gemini-nb-2.1' })
      await manualWithPrompt()
      await clickCreate()
      await waitFor(() => expect(server.geminiCalls()).toHaveLength(1))
      server.replyGemini(0, 200, { attemptId: 'a1', status: 'failed', replayed: true, error: 'old', outcome_unknown: false })
      await waitFor(() => expect(toastDescriptions().some((text) => /tentativa anterior falhou/.test(text))).toBe(true))
      expect(screen.queryByText('Gerar Novamente')).toBeNull()
      await clickCreate()
      await waitFor(() => expect(server.geminiCalls()).toHaveLength(2))
      expect(server.geminiCalls()[1].body.clientRequestId).not.toBe(server.geminiCalls()[0].body.clientRequestId)
      server.replyGemini(1, 200, { ...geminiOk(server.nextImageId()), status: 'succeeded', replayed: true })
      await waitFor(() => expect(screen.getByText('Gerar Novamente')).toBeTruthy())
    })

    it('a replay that is still in progress does not claim success and does not rotate the id (no second charge)', async () => {
      mount({ availability: ON, selectedModel: 'gemini-nb-2.1' })
      await manualWithPrompt()
      await clickCreate()
      await waitFor(() => expect(server.geminiCalls()).toHaveLength(1))
      server.replyGemini(0, 200, { attemptId: 'a1', status: 'submitted', replayed: true })
      await waitFor(() => expect(toastDescriptions().some((text) => /em andamento ou foi interrompida/.test(text))).toBe(true))
      await clickCreate()
      await waitFor(() => expect(server.geminiCalls()).toHaveLength(2))
      expect(server.geminiCalls()[1].body.clientRequestId).toBe(server.geminiCalls()[0].body.clientRequestId)
    })
  })
})

describe('ASSISTED with a Google model: suggestions never generate media', () => {
  it.each(['gemini-nb-2.1', 'gemini-nb-lite'] as const)('Create, Apply and Discard issue zero image requests; generation happens only on the explicit click (%s)', async (model) => {
    mount({ availability: ON, selectedModel: model })
    await ready()
    fireEvent.click(screen.getByRole('button', { name: /Criar com IA/ }))
    await waitFor(() => expect(server.assistanceCalls()).toHaveLength(1))
    server.replyAssistance(0, 200, assistanceOk())
    await screen.findByTestId('prompt-assistance-suggestion')
    expect(promptEditor().value).toBe('')
    fireEvent.click(screen.getByTestId('prompt-assistance-apply'))
    await waitFor(() => expect(promptEditor().value).toBe(GENERATED))
    expect(server.geminiCalls()).toHaveLength(0)

    // Discard path
    fireEvent.click(screen.getByRole('button', { name: /Melhorar com IA/ }))
    await waitFor(() => expect(server.assistanceCalls()).toHaveLength(2))
    server.replyAssistance(1, 200, { ...assistanceOk('A different improved prompt, more detailed.'), operation: 'improve' })
    await screen.findByTestId('prompt-assistance-suggestion')
    fireEvent.click(screen.getByTestId('prompt-assistance-discard'))
    await waitFor(() => expect(screen.queryByTestId('prompt-assistance-suggestion')).toBeNull())
    expect(promptEditor().value).toBe(GENERATED)
    expect(server.geminiCalls()).toHaveLength(0)
    expect(server.openaiCalls()).toHaveLength(0)
    expect(server.nanoCalls()).toHaveLength(0)

    await clickCreate()
    await waitFor(() => expect(server.geminiCalls()).toHaveLength(1))
    expect(server.geminiCalls()[0].body).toMatchObject({ prompt: GENERATED, model })
  })
})

describe('AUTOMATIC with a Google model: one click, one text call, one image attempt', () => {
  it.each([['gemini-nb-2.1', 'network'], ['gemini-nb-2.1', 'in_progress'], ['gemini-nb-lite', 'network'], ['gemini-nb-lite', 'in_progress']] as const)('preserves the request id after an Automatic %s %s outcome for explicit image-only recovery', async (model, outcome) => {
    mount({ availability: ON, selectedModel: model })
    await selectAutomatic()
    if (outcome === 'network') {
      const original = server.fetchMock.getMockImplementation()!
      server.fetchMock.mockImplementation((input: unknown, init?: RequestInit) =>
        String(input) === '/api/gemini/generate-image' && !server.geminiCalls().length
          ? (original(input, init), Promise.reject(new TypeError('network down')))
          : original(input, init))
    }
    fireEvent.click(startButton())
    await waitFor(() => expect(server.assistanceCalls()).toHaveLength(1))
    server.replyAssistance(0, 200, assistanceOk())
    await waitFor(() => expect(server.geminiCalls()).toHaveLength(1))
    if (outcome === 'in_progress') server.replyGemini(0, 200, { attemptId: 'a1', status: 'submitted', replayed: true })
    const failed = await screen.findByTestId('automatic-run-image-failed')
    expect(server.geminiCalls()).toHaveLength(1)
    fireEvent.click(within(failed).getByTestId('automatic-run-retry-image'))
    await waitFor(() => expect(server.geminiCalls()).toHaveLength(2))
    expect(server.geminiCalls()[1].body.clientRequestId).toBe(server.geminiCalls()[0].body.clientRequestId)
    expect(server.geminiCalls()[1].body.prompt).toBe(GENERATED)
    expect(server.assistanceCalls()).toHaveLength(1)
    server.replyGemini(1, 200, { ...geminiOk(server.nextImageId()), status: 'succeeded', replayed: true })
    await waitFor(() => expect(screen.getByText('Gerar Novamente')).toBeTruthy())
  })

  it.each(['gemini-nb-2.1', 'gemini-nb-lite'] as const)('manual recovery of an Automatic in-progress response also retains the same id (%s)', async (model) => {
    mount({ availability: ON, selectedModel: model })
    await selectAutomatic()
    fireEvent.click(startButton())
    await waitFor(() => expect(server.assistanceCalls()).toHaveLength(1))
    server.replyAssistance(0, 200, assistanceOk())
    await waitFor(() => expect(server.geminiCalls()).toHaveLength(1))
    server.replyGemini(0, 200, { attemptId: 'a1', status: 'submitted', replayed: true })
    await screen.findByTestId('automatic-run-image-failed')
    fireEvent.click(modeButton('manual'))
    await clickCreate()
    await waitFor(() => expect(server.geminiCalls()).toHaveLength(2))
    expect(server.geminiCalls()[1].body.clientRequestId).toBe(server.geminiCalls()[0].body.clientRequestId)
    expect(server.assistanceCalls()).toHaveLength(1)
  })
  it.each(['gemini-nb-2.1', 'gemini-nb-lite'] as const)('runs description -> /api/prompt-assistance (independent text model) -> the exact prompt -> ONE Google submission using the run id (%s)', async (model) => {
    mount({ availability: ON, selectedModel: model })
    await selectAutomatic()
    expect(screen.getByTestId('automatic-run-panel').textContent).toMatch(/Nano Banana .*\(oficial\)/)
    expect(screen.getByTestId('automatic-run-panel').textContent).toMatch(/cobrança na sua conta Google/)
    expect(server.assistanceCalls()).toHaveLength(0)
    const start = startButton()
    fireEvent.click(start)
    fireEvent.click(start) // synchronous double-click lock; one explicit run

    await waitFor(() => expect(server.assistanceCalls()).toHaveLength(1))
    // The text assistance model is configured independently of the Gemini IMAGE model.
    expect(server.assistanceCalls()[0].body).toMatchObject({ mediaType: 'image', operation: 'create', workflow: 'automatic', originalText: DESCRIPTION, provider: 'openai', model: 'gpt-4o-mini' })
    expect(server.geminiCalls()).toHaveLength(0)
    server.replyAssistance(0, 200, assistanceOk())
    await waitFor(() => expect(server.geminiCalls()).toHaveLength(1))
    expect(server.geminiCalls()[0].body).toMatchObject({ prompt: GENERATED, model, aspectRatio: '1:1', sessionId: SESSION_ID })
    expect(Object.keys(server.geminiCalls()[0].body).sort()).toEqual(['aspectRatio', 'clientRequestId', 'model', 'prompt', 'sessionId'])
    server.replyGemini(0, 200, geminiOk(server.nextImageId()))
    await waitFor(() => expect(screen.getByText('Gerar Novamente')).toBeTruthy())
    expect(server.assistanceCalls()).toHaveLength(1)
    expect(server.geminiCalls()).toHaveLength(1)
    expect(server.openaiCalls()).toHaveLength(0)
    expect(server.nanoCalls()).toHaveLength(0)
  })

  it('blocks Automatic for Lite without Gemini BYOK before text or image execution', async () => {
    mount({ availability: ON, selectedModel: 'gemini-nb-lite', providers: { openai: { status: 'configured' }, gemini: { status: 'not_configured' } } })
    await selectAutomatic()
    expect(startButton().disabled).toBe(true)
    expect(screen.getByTestId('automatic-run-disabled-reason').textContent).toMatch(/chave do Google Gemini/)
    fireEvent.click(startButton())
    expect(server.assistanceCalls()).toHaveLength(0)
    expect(server.geminiCalls()).toHaveLength(0)
    expect(server.openaiCalls()).toHaveLength(0)
    expect(server.nanoCalls()).toHaveLength(0)
  })

  it('a Google failure after the prompt is applied does NOT retry or fall back: the prompt stays and "Tentar só a imagem" is a new explicit action', async () => {
    mount({ availability: ON, selectedModel: 'gemini-nb-2.1' })
    await selectAutomatic()
    fireEvent.click(startButton())
    await waitFor(() => expect(server.assistanceCalls()).toHaveLength(1))
    server.replyAssistance(0, 200, assistanceOk())
    await waitFor(() => expect(server.geminiCalls()).toHaveLength(1))
    server.replyGemini(0, 429, { error: 'x', code: 'PROVIDER_RATE_LIMITED' })
    await waitFor(() => expect(screen.getByTestId('automatic-run-image-failed')).toBeTruthy())
    expect(promptEditor().value).toBe(GENERATED)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(server.geminiCalls()).toHaveLength(1)
    expect(server.openaiCalls()).toHaveLength(0)
    expect(server.nanoCalls()).toHaveLength(0)
    expect(server.assistanceCalls()).toHaveLength(1)
  })
})

describe('unrecognized saved model: surfaced, never silently replaced, never submitted', () => {
  it('a saved unknown id does not become gpt-image-2: no selection is shown, generation is blocked, no provider is called, and the saved value is not rewritten', async () => {
    mount({ availability: ON, selectedModel: 'banana-9000', generatedPrompt: AUTHORED })
    await ready()
    expect(screen.getByTestId('create-disabled-reason').textContent).toMatch(/“banana-9000”\) não é reconhecido/)
    expect(modelTrigger().textContent).not.toMatch(/GPT Image/)
    expect(createImageButton().disabled).toBe(true)
    fireEvent.click(createImageButton())
    expect(server.openaiCalls()).toHaveLength(0)
    expect(server.geminiCalls()).toHaveLength(0)
    expect(server.nanoCalls()).toHaveLength(0)
    // any autosave while it stands keeps the stored value untouched
    for (const patch of server.patches()) expect(patch.body.workingState.selectedModel).toBe('banana-9000')
  })

  it('Automatic is also blocked with an unrecognized model (zero text calls)', async () => {
    mount({ availability: ON, selectedModel: 'banana-9000' })
    await selectAutomatic()
    expect(startButton().disabled).toBe(true)
    expect(screen.getByTestId('automatic-run-disabled-reason').textContent).toMatch(/não é reconhecido/)
    expect(server.assistanceCalls()).toHaveLength(0)
  })

  it('an explicit choice resolves it: the user picks GPT Image 2 and generation works', async () => {
    mount({ availability: ON, selectedModel: 'banana-9000', generatedPrompt: AUTHORED })
    await ready()
    await openModelSelect()
    const option = screen.getByRole('option', { name: 'GPT Image 2' })
    fireEvent.pointerUp(option, { button: 0, pointerType: 'mouse' })
    fireEvent.click(option)
    await waitFor(() => expect(screen.queryByTestId('create-disabled-reason')).toBeNull())
    await clickCreate()
    await waitFor(() => expect(server.openaiCalls()).toHaveLength(1))
    expect(server.openaiCalls()[0].body.model).toBe('gpt-image-2')
  })

  it('the legacy stored value "openai" is still read as GPT Image 2 (existing defaults unchanged)', async () => {
    settingsRow = { ...settingsRow, default_image_model: 'openai' }
    mount({ availability: OFF })
    await ready()
    expect(modelTrigger().textContent).toMatch(/GPT Image 2/)
    expect(screen.queryByTestId('create-disabled-reason')).toBeNull()
  })
})

describe('existing sessions and history are preserved', () => {
  it('a saved legacy NanoBananaAPI.ai session keeps its model, prompt and selection after Slice B', async () => {
    mount({ availability: OFF, selectedModel: 'nanobanana-v1', generatedPrompt: AUTHORED })
    await ready()
    expect(promptEditor().value).toBe(AUTHORED)
    expect(modelTrigger().textContent).toMatch(/NanoBananaAPI\.ai V1 \(terceiros — legado\)/)
    expect(screen.queryByTestId('create-disabled-reason')).toBeNull()
  })

  it('a legacy NanoBananaAPI.ai session shows its models even when its key is not configured (the saved choice stays visible)', async () => {
    mount({ availability: OFF, selectedModel: 'nanobanana-v2', providers: { openai: { status: 'configured' } } })
    await ready()
    expect(modelTrigger().textContent).toMatch(/NanoBananaAPI\.ai V2/)
    expect(screen.getByText(/NanoBananaAPI\.ai \(terceiros — legado\) indisponível neste workspace/)).toBeTruthy()
  })
})
