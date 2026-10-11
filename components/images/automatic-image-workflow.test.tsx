// @vitest-environment jsdom
import { Component, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ImagesPageShell } from '@/app/(dashboard)/imagens/page'
import { GenerationSessionNavigationProvider } from '@/components/generation-session/session-navigation-guard'
import { installBrowserFaithfulTimers } from '@/lib/generation-session/__tests__/browser-timers'

// FUTURE-057 Slice A — Manual, Assisted and Automatic flows of the REAL /imagens shell. Only network, auth/Supabase
// and router are faked; no provider is ever called.

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
const dbWrites: string[] = []
const supabaseQuery = (table: string) => {
  const result = { data: [] as unknown[], error: null }
  const chain: any = {
    select: () => chain,
    order: () => chain,
    eq: () => chain,
    in: () => chain,
    insert: () => { dbWrites.push(`insert:${table}`); return chain },
    update: () => { dbWrites.push(`update:${table}`); return chain },
    upsert: () => { dbWrites.push(`upsert:${table}`); return chain },
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
type ServerOptions = {
  providers?: Record<string, { status: string }>
  workingPrompt?: string
  generatedPrompt?: string | null
  autoMode?: boolean
  /** The image model saved in the session (a saved session model wins over the Settings default). */
  selectedModel?: string
  /** When true the assistance mock ignores AbortSignal, so a paid answer can arrive after the user cancelled. */
  ignoreAbort?: boolean
}

function installServer(options: ServerOptions = {}) {
  let revision = 4
  // The mock server stores what the client PATCHes and echoes it back (as the real session API does).
  let stored: { workingPrompt: string; workingState: Record<string, unknown> } | null = null
  const calls: Call[] = []
  const assistance: Array<(reply: Reply) => void> = []
  const images: Array<(reply: Reply) => void> = []
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
        if (!options.ignoreAbort) init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        assistance.push((reply) => resolve(new Response(JSON.stringify(reply.payload), { status: reply.status })))
      })
    }
    if (url === '/api/openai/generate-image') {
      return new Promise<Response>((resolve) => {
        images.push((reply) => resolve(new Response(JSON.stringify(reply.payload), { status: reply.status })))
      })
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
    if (url.startsWith('/api/settings/providers')) return json({ providers: options.providers ?? { openai: { status: 'configured' } } })
    if (url.startsWith('/api/productions/')) return json({ production: { title: 'Criação', project_id: PROJECT_ID } })
    return json({})
  })
  const to = (url: string) => calls.filter((call) => call.url === url)
  return {
    fetchMock,
    calls,
    assistanceCalls: () => to('/api/prompt-assistance'),
    imageCalls: () => to('/api/openai/generate-image'),
    nanoCalls: () => to('/api/nanobanana/generate'),
    replyAssistance: (index: number, status: number, payload: unknown) => assistance[index]({ status, payload }),
    replyImage: (index: number, status: number, payload: unknown) => images[index]({ status, payload }),
    nextImageId: () => `img-${++imageCount}`,
  }
}

const assistanceOk = (suggestedPrompt = GENERATED, provider = 'openai', model = 'gpt-4o-mini') => ({ suggestedPrompt, provider, model, operation: 'create', usage: null })
const imageOk = (id: string) => ({ imageUrl: `https://img.test/${id}.png`, image: { id, user_id: 'user-1', status: 'draft' }, attemptId: `attempt-${id}` })

// Requests an Automatic run must never make: evaluation, refinement, library or draft writes.
const FORBIDDEN = /\/api\/(reviews\/image|evaluate-image|prompts\/generate-image-prompt|prompts\/translate|image-drafts$)/

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

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  restoreTimers = installBrowserFaithfulTimers()
  settingsRow = { automation_enabled: true, default_image_model: 'gpt-image-2', image_evaluator_enabled: true, max_refinement_iterations: 3 }
  dbWrites.length = 0
  mockRouter.push.mockReset()
  mockRouter.replace.mockReset()
})

afterEach(() => {
  cleanup()
  restoreTimers()
  vi.clearAllMocks()
})

vi.setConfig({ testTimeout: 20_000 })
// Pre-submit flush and provider-status loading run on the real (browser-faithful) autosave timers.
configure({ asyncUtilTimeout: 5000 })

const description = () => screen.findByDisplayValue(DESCRIPTION) as Promise<HTMLTextAreaElement>
const promptEditor = () => document.getElementById('generated-prompt') as HTMLTextAreaElement
const modeButton = (mode: 'manual' | 'assisted' | 'automatic') => screen.getByTestId(`workflow-mode-${mode}`) as HTMLButtonElement
const startButton = () => screen.getByTestId('automatic-run-start') as HTMLButtonElement
const createImageButton = () => screen.getByRole('button', { name: /Criar Imagem|Criando/ }) as HTMLButtonElement
const nonGetWrites = () => server.calls.filter((call) => call.method !== 'GET' && !call.url.startsWith(`/api/image-generation-sessions/${SESSION_ID}`))

async function ready() {
  const field = await description()
  await waitFor(() => expect(screen.getByTestId('workflow-mode-control')).toBeTruthy())
  // Provider status + settings are loaded asynchronously: wait until Automatic is selectable.
  await waitFor(() => expect(modeButton('automatic').disabled).toBe(false))
  return field
}

async function selectAutomatic() {
  await ready()
  fireEvent.click(modeButton('automatic'))
  await waitFor(() => expect(screen.getByTestId('automatic-run-panel')).toBeTruthy())
}

describe('MANUAL — direct prompt authoring from an empty state', () => {
  it('shows an editable prompt field and the image-model selector with no generated prompt, and generates only on the explicit click', async () => {
    mount()
    await ready()
    fireEvent.click(modeButton('manual'))
    // Empty state: the editor exists and is editable; nothing was generated or requested.
    expect(promptEditor()).toBeTruthy()
    expect(promptEditor().value).toBe('')
    expect(promptEditor().disabled).toBe(false)
    expect(screen.getByLabelText('Modelo de imagem')).toBeTruthy()
    expect(createImageButton().disabled).toBe(true)
    // Manual hides every assistance control.
    expect(screen.queryByRole('button', { name: /Criar com IA/ })).toBeNull()
    expect(screen.queryByLabelText('Modelo de assistência')).toBeNull()

    fireEvent.change(promptEditor(), { target: { value: AUTHORED } })
    expect(server.imageCalls()).toHaveLength(0)
    await waitFor(() => expect(createImageButton().disabled).toBe(false))
    fireEvent.click(createImageButton())
    await waitFor(() => expect(server.imageCalls()).toHaveLength(1))
    expect(server.imageCalls()[0].body).toMatchObject({ prompt: AUTHORED, model: 'gpt-image-2', sessionId: SESSION_ID })
    expect(server.imageCalls()[0].body.clientRequestId).toMatch(/^[0-9a-f-]{36}$/)
    expect(server.assistanceCalls()).toHaveLength(0)
    server.replyImage(0, 200, imageOk(server.nextImageId()))
    await waitFor(() => expect(screen.getByText('Gerar Novamente')).toBeTruthy())
  })

  it('the image-model selector is visible even when the global automation preference is ON (it used to disappear)', async () => {
    mount()
    await ready()
    expect(settingsRow?.automation_enabled).toBe(true)
    expect(screen.getByLabelText('Modelo de imagem')).toBeTruthy()
  })
})

describe('ASSISTED — suggestions never generate media', () => {
  it('Create, Apply and Discard issue zero image requests; the suggestion stays isolated until Apply', async () => {
    mount()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: /Criar com IA/ }))
    await waitFor(() => expect(server.assistanceCalls()).toHaveLength(1))
    expect(server.assistanceCalls()[0].body).toMatchObject({ operation: 'create', workflow: 'assisted', provider: 'openai', model: 'gpt-4o-mini', projectId: PROJECT_ID, productionId: PRODUCTION_ID })
    server.replyAssistance(0, 200, assistanceOk())
    await screen.findByTestId('prompt-assistance-suggestion')
    expect(promptEditor().value).toBe('')
    fireEvent.click(screen.getByTestId('prompt-assistance-apply'))
    await waitFor(() => expect(promptEditor().value).toBe(GENERATED))
    expect(server.imageCalls()).toHaveLength(0)
    expect(server.nanoCalls()).toHaveLength(0)
    expect(server.calls.filter((call) => FORBIDDEN.test(call.url))).toHaveLength(0)
  })

  it('applying a CREATE suggestion over an authored prompt asks first, and cancelling keeps the authored prompt', async () => {
    mount({ generatedPrompt: AUTHORED })
    await ready()
    fireEvent.click(screen.getByRole('button', { name: /Criar com IA/ }))
    await waitFor(() => expect(server.assistanceCalls()).toHaveLength(1))
    server.replyAssistance(0, 200, assistanceOk())
    await screen.findByTestId('prompt-assistance-suggestion')
    fireEvent.click(screen.getByTestId('prompt-assistance-apply'))
    expect(await screen.findByTestId('prompt-assistance-apply-confirm')).toBeTruthy()
    expect(promptEditor().value).toBe(AUTHORED)
    fireEvent.click(screen.getByTestId('prompt-assistance-apply-cancel'))
    expect(promptEditor().value).toBe(AUTHORED)
    fireEvent.click(screen.getByTestId('prompt-assistance-apply'))
    fireEvent.click(await screen.findByTestId('prompt-assistance-apply-confirmed'))
    await waitFor(() => expect(promptEditor().value).toBe(GENERATED))
    expect(server.imageCalls()).toHaveLength(0)
  })
})

describe('AUTOMATIC — one explicit start, one text call, one image submission', () => {
  it('runs description -> /api/prompt-assistance -> the EXACT resulting prompt -> one idempotent image submit, with no Review or draft write', async () => {
    mount()
    await selectAutomatic()
    expect(server.assistanceCalls()).toHaveLength(0)
    fireEvent.click(startButton())

    await waitFor(() => expect(server.assistanceCalls()).toHaveLength(1))
    expect(server.assistanceCalls()[0].body).toEqual({
      projectId: PROJECT_ID, productionId: PRODUCTION_ID, mediaType: 'image', operation: 'create', workflow: 'automatic',
      originalText: DESCRIPTION, provider: 'openai', model: 'gpt-4o-mini',
    })
    expect(screen.getByTestId('automatic-stage-prompt').getAttribute('data-state')).toBe('active')
    expect(server.imageCalls()).toHaveLength(0) // the image stage waits for the validated prompt

    server.replyAssistance(0, 200, assistanceOk())
    await waitFor(() => expect(server.imageCalls()).toHaveLength(1))
    const [image] = server.imageCalls()
    // The prompt that was sent is the assistance output — never the description, never a stale value.
    expect(image.body).toMatchObject({ prompt: GENERATED, model: 'gpt-image-2', sessionId: SESSION_ID })
    expect(image.body.prompt).not.toBe(DESCRIPTION)
    expect(image.body.clientRequestId).toMatch(/^[0-9a-f-]{36}$/)
    expect(promptEditor().value).toBe(GENERATED)
    expect(screen.getByTestId('automatic-stage-image').getAttribute('data-state')).toBe('active')

    server.replyImage(0, 200, imageOk(server.nextImageId()))
    await waitFor(() => expect(screen.getByText('Gerar Novamente')).toBeTruthy())
    expect(screen.queryByTestId('automatic-run-progress')).toBeNull()

    // Exactly 1 text call + 1 image submission; nothing else paid, evaluated, refined or written to history.
    expect(server.assistanceCalls()).toHaveLength(1)
    expect(server.imageCalls()).toHaveLength(1)
    expect(server.calls.filter((call) => FORBIDDEN.test(call.url))).toHaveLength(0)
    expect(dbWrites.filter((write) => /prompts|image_drafts|user_settings/.test(write))).toEqual([])
    expect(nonGetWrites().map((call) => call.url).sort()).toEqual(['/api/openai/generate-image', '/api/prompt-assistance'])
  })

  it('uses the selected NanoBanana image model with the generated prompt (never the description)', async () => {
    mount({ selectedModel: 'nanobanana-v2', providers: { openai: { status: 'configured' }, nano_banana: { status: 'configured' } } })
    await selectAutomatic()
    fireEvent.click(startButton())
    await waitFor(() => expect(server.assistanceCalls()).toHaveLength(1))
    server.replyAssistance(0, 200, assistanceOk())
    await waitFor(() => expect(server.nanoCalls()).toHaveLength(1))
    expect(server.nanoCalls()[0].body).toMatchObject({ prompt: GENERATED, model: 'v2', sessionId: SESSION_ID, projectId: PROJECT_ID })
    expect(server.imageCalls()).toHaveLength(0)
    expect(server.assistanceCalls()).toHaveLength(1)
  })

  it('uses Gemini as the assistant when it is the only configured text provider (explicit provider/model in the request)', async () => {
    mount({ selectedModel: 'nanobanana-v1', providers: { gemini: { status: 'configured' }, nano_banana: { status: 'configured' } } })
    await selectAutomatic()
    fireEvent.click(startButton())
    await waitFor(() => expect(server.assistanceCalls()).toHaveLength(1))
    expect(server.assistanceCalls()[0].body).toMatchObject({ provider: 'gemini', model: 'gemini-3.5-flash', workflow: 'automatic', operation: 'create' })
    server.replyAssistance(0, 200, assistanceOk(GENERATED, 'gemini', 'gemini-3.5-flash'))
    await waitFor(() => expect(server.nanoCalls()).toHaveLength(1))
    expect(server.nanoCalls()[0].body).toMatchObject({ prompt: GENERATED, model: 'v1' })
  })

  it('does not offer a start when the selected image model has no configured provider, and sends nothing', async () => {
    mount({ providers: { gemini: { status: 'configured' }, openai: { status: 'missing' } } })
    await selectAutomatic()
    // OpenAI is missing, so the default image model (gpt-image-2) is not ready: the start is disabled with a reason.
    expect(startButton().disabled).toBe(true)
    expect(screen.getByTestId('automatic-run-disabled-reason').textContent).toMatch(/provedor do modelo de imagem/)
    fireEvent.click(startButton())
    expect(server.assistanceCalls()).toHaveLength(0)
  })

  it('a response that does not come from the selected model is not accepted (no silent substitution) and requests no image', async () => {
    mount()
    await selectAutomatic()
    fireEvent.click(startButton())
    await waitFor(() => expect(server.assistanceCalls()).toHaveLength(1))
    server.replyAssistance(0, 200, assistanceOk(GENERATED, 'gemini', 'gemini-3.5-flash'))
    await screen.findByTestId('automatic-run-prompt-failed')
    expect(server.imageCalls()).toHaveLength(0)
    expect(promptEditor().value).toBe('')
  })

  it('synchronous double-click starts exactly one run', async () => {
    mount()
    await selectAutomatic()
    const button = startButton() // the panel swaps the button for the progress view after the first click
    fireEvent.click(button)
    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => expect(server.assistanceCalls()).toHaveLength(1))
    server.replyAssistance(0, 200, assistanceOk())
    await waitFor(() => expect(server.imageCalls()).toHaveLength(1))
    server.replyImage(0, 200, imageOk(server.nextImageId()))
    await waitFor(() => expect(screen.getByText('Gerar Novamente')).toBeTruthy())
    expect(server.assistanceCalls()).toHaveLength(1)
    expect(server.imageCalls()).toHaveLength(1)
  })

  it('the run id is the image clientRequestId, and a new run gets a new one', async () => {
    mount()
    await selectAutomatic()
    fireEvent.click(startButton())
    await waitFor(() => expect(server.assistanceCalls()).toHaveLength(1))
    server.replyAssistance(0, 200, assistanceOk())
    await waitFor(() => expect(server.imageCalls()).toHaveLength(1))
    server.replyImage(0, 200, imageOk(server.nextImageId()))
    await waitFor(() => expect(screen.getByTestId('automatic-run-start')).toBeTruthy())
    // The workspace now holds a prompt: a second run needs the overwrite confirmation.
    fireEvent.click(startButton())
    fireEvent.click(await screen.findByTestId('automatic-run-confirm-accept'))
    await waitFor(() => expect(server.assistanceCalls()).toHaveLength(2))
    server.replyAssistance(1, 200, assistanceOk('A second exact prompt.'))
    await waitFor(() => expect(server.imageCalls()).toHaveLength(2))
    const ids = server.imageCalls().map((call) => call.body.clientRequestId)
    expect(new Set(ids).size).toBe(2)
    expect(server.imageCalls()[1].body.prompt).toBe('A second exact prompt.')
  })

  it('locks the description, the prompt, the models and the mode while the run is in flight', async () => {
    mount()
    const field = await ready()
    fireEvent.click(modeButton('automatic'))
    await screen.findByTestId('automatic-run-panel')
    fireEvent.click(startButton())
    await waitFor(() => expect(screen.getByTestId('automatic-stage-prompt').getAttribute('data-state')).toBe('active'))
    expect(field.readOnly).toBe(true)
    expect(promptEditor().disabled).toBe(true)
    expect(modeButton('manual').disabled).toBe(true)
    expect(createImageButton().disabled).toBe(true)
    fireEvent.change(field, { target: { value: 'edited mid flight' } })
    fireEvent.click(modeButton('manual'))
    server.replyAssistance(0, 200, assistanceOk())
    await waitFor(() => expect(server.imageCalls()).toHaveLength(1))
    // The request-time snapshot is what was sent, whatever the user tried to change.
    expect(server.assistanceCalls()[0].body.originalText).toBe(DESCRIPTION)
    server.replyImage(0, 200, imageOk(server.nextImageId()))
  })
})

describe('AUTOMATIC — overwrite confirmation', () => {
  it('asks before replacing an existing prompt; cancelling sends nothing and keeps it', async () => {
    mount({ generatedPrompt: AUTHORED })
    await selectAutomatic()
    fireEvent.click(startButton())
    expect(await screen.findByTestId('automatic-run-confirm')).toBeTruthy()
    expect(server.assistanceCalls()).toHaveLength(0)
    fireEvent.click(screen.getByTestId('automatic-run-confirm-cancel'))
    expect(screen.queryByTestId('automatic-run-confirm')).toBeNull()
    expect(promptEditor().value).toBe(AUTHORED)
    expect(server.assistanceCalls()).toHaveLength(0)
    expect(server.imageCalls()).toHaveLength(0)
  })

  it('confirming runs the pipeline and replaces the prompt only after a valid result', async () => {
    mount({ generatedPrompt: AUTHORED })
    await selectAutomatic()
    fireEvent.click(startButton())
    fireEvent.click(await screen.findByTestId('automatic-run-confirm-accept'))
    await waitFor(() => expect(server.assistanceCalls()).toHaveLength(1))
    expect(promptEditor().value).toBe(AUTHORED) // untouched until the text stage succeeds
    server.replyAssistance(0, 200, assistanceOk())
    await waitFor(() => expect(server.imageCalls()).toHaveLength(1))
    expect(promptEditor().value).toBe(GENERATED)
  })

  it('a prompt-stage failure preserves the authored prompt that was about to be replaced', async () => {
    mount({ generatedPrompt: AUTHORED })
    await selectAutomatic()
    fireEvent.click(startButton())
    fireEvent.click(await screen.findByTestId('automatic-run-confirm-accept'))
    await waitFor(() => expect(server.assistanceCalls()).toHaveLength(1))
    server.replyAssistance(0, 429, { code: 'PROVIDER_RATE_LIMITED', message: 'limitado' })
    await screen.findByTestId('automatic-run-prompt-failed')
    expect(promptEditor().value).toBe(AUTHORED)
    expect(server.imageCalls()).toHaveLength(0)
  })
})

describe('AUTOMATIC — failures, cancellation and recovery', () => {
  it('a prompt-provider failure requests no image, keeps the description and offers an explicit retry only', async () => {
    mount()
    const field = await ready()
    fireEvent.click(modeButton('automatic'))
    await screen.findByTestId('automatic-run-panel')
    fireEvent.click(startButton())
    await waitFor(() => expect(server.assistanceCalls()).toHaveLength(1))
    server.replyAssistance(0, 422, { code: 'PROVIDER_NOT_CONFIGURED', message: 'credencial recusada' })
    const failed = await screen.findByTestId('automatic-run-prompt-failed')
    expect(within(failed).getByText(/credencial recusada/)).toBeTruthy()
    expect(server.imageCalls()).toHaveLength(0)
    expect(field.value).toBe(DESCRIPTION)
    expect(field.readOnly).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(server.assistanceCalls()).toHaveLength(1) // no hidden retry
  })

  it('an image failure after a successful prompt keeps the prompt, and "Tentar só a imagem" re-submits ONLY the image with a new request id', async () => {
    mount()
    await selectAutomatic()
    fireEvent.click(startButton())
    await waitFor(() => expect(server.assistanceCalls()).toHaveLength(1))
    server.replyAssistance(0, 200, assistanceOk())
    await waitFor(() => expect(server.imageCalls()).toHaveLength(1))
    server.replyImage(0, 500, { error: 'provider down' })
    const failed = await screen.findByTestId('automatic-run-image-failed')
    expect(promptEditor().value).toBe(GENERATED)
    expect(promptEditor().disabled).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(server.imageCalls()).toHaveLength(1) // no hidden image retry
    expect(server.assistanceCalls()).toHaveLength(1)

    fireEvent.click(within(failed).getByTestId('automatic-run-retry-image'))
    await waitFor(() => expect(server.imageCalls()).toHaveLength(2))
    expect(server.imageCalls()[1].body.prompt).toBe(GENERATED)
    expect(server.imageCalls()[1].body.clientRequestId).not.toBe(server.imageCalls()[0].body.clientRequestId)
    expect(server.assistanceCalls()).toHaveLength(1) // the text step is not repeated
    server.replyImage(1, 200, imageOk(server.nextImageId()))
    await waitFor(() => expect(screen.getByText('Gerar Novamente')).toBeTruthy())
  })

  it('cancelling during the prompt stage prevents the image and keeps authored state', async () => {
    mount()
    const field = await ready()
    fireEvent.click(modeButton('automatic'))
    await screen.findByTestId('automatic-run-panel')
    fireEvent.click(startButton())
    await waitFor(() => expect(server.assistanceCalls()).toHaveLength(1))
    fireEvent.click(screen.getByTestId('automatic-run-cancel'))
    expect(await screen.findByTestId('automatic-run-cancelled')).toBeTruthy()
    expect(server.imageCalls()).toHaveLength(0)
    expect(field.value).toBe(DESCRIPTION)
    expect(promptEditor().value).toBe('')
    expect(field.readOnly).toBe(false)
  })

  it('a paid text answer that arrives AFTER cancellation is shown as an unapplied suggestion and requests no image', async () => {
    mount({ ignoreAbort: true })
    await selectAutomatic()
    fireEvent.click(startButton())
    await waitFor(() => expect(server.assistanceCalls()).toHaveLength(1))
    fireEvent.click(screen.getByTestId('automatic-run-cancel'))
    server.replyAssistance(0, 200, assistanceOk())
    const card = await screen.findByTestId('prompt-assistance-suggestion')
    expect(card.textContent).toContain('Não aplicada')
    expect(promptEditor().value).toBe('')
    expect(server.imageCalls()).toHaveLength(0)
  })

  it('leaving the workspace mid-run never starts the image stage', async () => {
    mount({ ignoreAbort: true })
    await selectAutomatic()
    fireEvent.click(startButton())
    await waitFor(() => expect(server.assistanceCalls()).toHaveLength(1))
    cleanup()
    server.replyAssistance(0, 200, assistanceOk())
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(server.imageCalls()).toHaveLength(0)
  })
})

describe('AUTOMATIC — never starts by itself and respects the preference', () => {
  it('a persisted Automatic selection plus the opt-in produces ZERO requests on load, hydration and autosave', async () => {
    mount({ autoMode: true })
    await description()
    await waitFor(() => expect(modeButton('automatic').getAttribute('aria-checked')).toBe('true'))
    await new Promise((resolve) => setTimeout(resolve, 1500)) // past the autosave debounce
    expect(server.assistanceCalls()).toHaveLength(0)
    expect(server.imageCalls()).toHaveLength(0)
    expect(server.nanoCalls()).toHaveLength(0)
    expect(server.calls.filter((call) => FORBIDDEN.test(call.url))).toHaveLength(0)
  })

  it('with the global preference OFF, Automatic is unavailable even if the session was saved as automatic, and nothing runs', async () => {
    settingsRow = { ...settingsRow, automation_enabled: false }
    mount({ autoMode: true })
    await description()
    await waitFor(() => expect(modeButton('automatic').disabled).toBe(true))
    expect(modeButton('assisted').getAttribute('aria-checked')).toBe('true')
    expect(screen.queryByTestId('automatic-run-panel')).toBeNull()
    expect(screen.getByTestId('workflow-mode-hint').textContent).toMatch(/Permitir o modo Autom/)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(nonGetWrites()).toHaveLength(0)
  })

  it('switching modes or changing the preference never runs anything', async () => {
    mount()
    await ready()
    for (const mode of ['manual', 'assisted', 'automatic', 'assisted'] as const) fireEvent.click(modeButton(mode))
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(nonGetWrites()).toHaveLength(0)
  })
})

describe('Gerar Novamente — exact prompt, no template simulator', () => {
  it('regenerates from the complete current prompt (no truncation, no appended phrases) without any text call', async () => {
    mount()
    await ready()
    fireEvent.click(modeButton('manual'))
    fireEvent.change(promptEditor(), { target: { value: AUTHORED } })
    await waitFor(() => expect(createImageButton().disabled).toBe(false))
    fireEvent.click(createImageButton())
    await waitFor(() => expect(server.imageCalls()).toHaveLength(1))
    server.replyImage(0, 200, imageOk(server.nextImageId()))
    const regenerate = await screen.findByText('Gerar Novamente')
    fireEvent.click(regenerate)
    await waitFor(() => expect(server.imageCalls()).toHaveLength(2))
    expect(server.imageCalls()[1].body.prompt).toBe(AUTHORED)
    expect(server.imageCalls()[1].body.prompt).not.toMatch(/masterpiece|trending on artstation/)
    expect(server.imageCalls()[1].body.clientRequestId).not.toBe(server.imageCalls()[0].body.clientRequestId)
    expect(server.assistanceCalls()).toHaveLength(0)
    expect(promptEditor().value).toBe(AUTHORED)
    server.replyImage(1, 200, imageOk(server.nextImageId()))
  })

  it('a double click on Criar Imagem submits once', async () => {
    mount()
    await ready()
    fireEvent.click(modeButton('manual'))
    fireEvent.change(promptEditor(), { target: { value: AUTHORED } })
    await waitFor(() => expect(createImageButton().disabled).toBe(false))
    const button = createImageButton()
    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => expect(server.imageCalls()).toHaveLength(1))
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(server.imageCalls()).toHaveLength(1)
    server.replyImage(0, 200, imageOk(server.nextImageId()))
  })
})
