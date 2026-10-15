// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import WorkspacePage from '@/app/(dashboard)/videos/geracoes/[sessionId]/page'
import { GenerationSessionNavigationProvider } from '@/components/generation-session/session-navigation-guard'
import { describeRestConnection } from '@/lib/video-generation/connections'
import type { VideoGenerationWorkingStateV1 } from '@/lib/video-generation/working-state'
import type { VideoGenerationConnectionDescriptor } from '@/lib/video-generation/capabilities'

const SESSION = '00000000-0000-4000-8000-000000000001'
const PROJECT = '00000000-0000-4000-8000-000000000010'
const PRODUCTION = '00000000-0000-4000-8000-000000000020'
const GENERATION = '00000000-0000-4000-8000-000000000030'
const toast = vi.fn()
const router = { push: vi.fn(), replace: vi.fn() }
let search = ''
vi.mock('next/navigation', () => ({ useRouter: () => router, useParams: () => ({ sessionId: SESSION }), useSearchParams: () => new URLSearchParams(search) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }))

const initialState = (): VideoGenerationWorkingStateV1 => ({
  schemaVersion: 1, prompt: 'Authored manual prompt', source: null,
  selection: { connectionRef: 'kling:api', operation: 'text_to_video', modelId: 'kling-v3', duration: 5,
    resolution: '720p', aspectRatio: '16:9', audio: 'off', multiShot: false, asmr: null, audioPrompt: null, musicPrompt: null },
})
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
type Call = { url: string; method: string; body: any }
let state: VideoGenerationWorkingStateV1
let calls: Call[]
let version: number
let automation: boolean
let allowed: boolean
let configured: boolean
let connections: VideoGenerationConnectionDescriptor[]
let attempts: any[]
let assistance: (body: any) => Promise<Response>
let submit: (body: any) => Promise<Response>
let translate: (body: any) => Promise<Response>
let save: ((body: any) => Promise<Response>) | null
let exists: boolean
const textCalls = () => calls.filter((call) => call.url === '/api/prompt-assistance')
const translateCalls = () => calls.filter((call) => call.url === '/api/prompts/translate')
const videoCalls = () => calls.filter((call) => call.url === '/api/video-generations' && call.method === 'POST')
const session = () => ({ id: SESSION, projectId: PROJECT, productionId: PRODUCTION, updatedAt: `version-${version}`, workingState: state })
const review = () => ({ id: 'review-one', status: 'completed', createdAt: '2026-10-10T12:00:00Z', completedAt: '2026-10-10T12:01:00Z',
  evaluator: { provider: 'gemini', model: 'gemini-3.5-flash' }, failure: null,
  result: { overall: { score: 80, assessment: 'strong' }, summary: 'Visual review', criteria: [], strengths: [], issues: [], recommendations: [],
    refinedPrompt: '  Refined motion and camera prompt  ', analyzed: 'visual_only' } })
const mount = () => render(<GenerationSessionNavigationProvider><WorkspacePage /></GenerationSessionNavigationProvider>)
const ready = async () => { mount(); await screen.findByDisplayValue(state.prompt); await waitFor(() => expect(screen.getByTestId('workflow-mode-automatic').hasAttribute('disabled')).toBe(false)) }
const chooseAssisted = async () => { await ready(); fireEvent.click(screen.getByTestId('workflow-mode-assisted')); fireEvent.change(screen.getByLabelText('Sua descrição'), { target: { value: 'A coastal sunrise with a slow camera pan' } }) }
const chooseAutomatic = async () => { await ready(); fireEvent.click(screen.getByTestId('workflow-mode-automatic')); fireEvent.change(screen.getByLabelText('Sua descrição'), { target: { value: 'A coastal sunrise with a slow camera pan' } }) }
const beginAutomatic = () => { fireEvent.click(screen.getByTestId('video-automatic-start')); fireEvent.click(screen.getByTestId('video-automatic-confirm-accept')) }

beforeEach(() => {
  sessionStorage.clear()
  state = initialState(); calls = []; version = 0; automation = true; configured = true; allowed = true; exists = true; search = ''
  router.replace.mockReset()
  connections = [describeRestConnection('configured')]; attempts = []; save = null
  translate = async (body) => json({ translatedPrompt: `PT: ${body.prompt}`, model: 'gpt-4o-mini' })
  assistance = async (body) => json({ suggestedPrompt: 'Suggested temporal scene prompt', provider: body.provider, model: body.model, operation: body.operation, usage: null })
  submit = async (body) => { attempts = [...attempts, { id: crypto.randomUUID(), prompt: body.prompt, status: 'submitted', client_request_id: body.clientRequestId, mode: body.mode, model: body.model }]; return json({ generation: attempts.at(-1) }, 201) }
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => undefined
  Element.prototype.releasePointerCapture ??= () => undefined
  Element.prototype.scrollIntoView ??= () => undefined
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input); const method = init?.method ?? 'GET'; const body = init?.body ? JSON.parse(String(init.body)) : null
    calls.push({ url, method, body })
    if (url === '/api/settings/providers') return json({ providers: { openai: { status: configured ? 'configured' : 'missing' }, gemini: { status: 'configured' } }, automationEnabled: automation, executionPolicy: { paidExecution: allowed ? 'allowed' : 'blocked' } })
    if (url.endsWith('/connections')) return json({ connections })
    if (url.startsWith('/api/video-generation-sessions/')) {
      if (method === 'GET' && !exists) return json({}, 404)
      if (method !== 'GET') {
        if (save) return save(body)
        state = body.workingState; version += 1; exists = true
      }
      return json({ session: session() })
    }
    if (url.startsWith('/api/video-generations?')) return json({ generations: attempts })
    if (url.startsWith('/api/reviews/video?')) return json({ items: [review()] })
    if (url === '/api/prompt-assistance') return assistance(body)
    if (url === '/api/prompts/translate') return translate(body)
    if (url === '/api/video-generations' && method === 'POST') return submit(body)
    if (method === 'GET') return json({ items: [], files: [], images: [] })
    throw new Error(`Unexpected non-mocked request: ${method} ${url}`)
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('Generation + Review workspace parity V1 — real Video workspace, mocked network only', () => {
  it('keeps Manual first-class, leaves old sessions unchanged and requires a generate gesture', async () => {
    await ready()
    expect(screen.queryByTestId('video-assistance-create')).toBeNull()
    expect(textCalls()).toHaveLength(0); expect(videoCalls()).toHaveLength(0)
    expect(state.assistance).toBeUndefined()
    fireEvent.click(screen.getByTestId('generate-video'))
    fireEvent.click(screen.getByTestId('generate-video'))
    await waitFor(() => expect(videoCalls()).toHaveLength(1))
    expect(videoCalls()[0].body).toMatchObject({ sessionId: SESSION, projectId: PROJECT, productionId: PRODUCTION, prompt: 'Authored manual prompt', model: 'kling-v3', duration: 5, resolution: '720p', audio: 'off' })
    expect(videoCalls()[0].body.clientRequestId).toMatch(/^[0-9a-f-]{36}$/i)
    expect(textCalls()).toHaveLength(0)
  })

  it('Create and Improve are suggestions: explicit discard/apply never submits or edits history', async () => {
    await chooseAssisted()
    fireEvent.click(screen.getByTestId('video-assistance-create'))
    await screen.findByTestId('video-prompt-suggestion')
    expect((screen.getByLabelText('Prompt de geração') as HTMLTextAreaElement).value).toBe('Authored manual prompt')
    expect(textCalls()[0].body).toMatchObject({ mediaType: 'video', videoMode: 'text_to_video', operation: 'create', workflow: 'assisted', provider: 'openai', model: 'gpt-4o-mini' })
    expect(textCalls()[0].body).not.toHaveProperty('currentText')
    fireEvent.click(screen.getByTestId('video-assistance-discard'))
    expect(screen.queryByTestId('video-prompt-suggestion')).toBeNull()
    fireEvent.click(screen.getByTestId('video-assistance-improve'))
    await screen.findByTestId('video-prompt-suggestion')
    expect(textCalls()[1].body.currentText).toBe('Authored manual prompt')
    fireEvent.click(screen.getByTestId('video-assistance-apply'))
    expect((screen.getByLabelText('Prompt de geração') as HTMLTextAreaElement).value).toBe('Authored manual prompt')
    fireEvent.click(screen.getByTestId('video-assistance-apply'))
    expect((screen.getByLabelText('Prompt de geração') as HTMLTextAreaElement).value).toBe('Suggested temporal scene prompt')
    expect(videoCalls()).toHaveLength(0)
    // STRUCTURAL_WAVE_0 (D22): the notice is provider-neutral (it also applies to Google Veo).
    expect(screen.getByTestId('video-assistance-cost-notice').textContent).toMatch(/BYOK.*conexão de vídeo.*parciais/)
    expect(screen.getByTestId('video-assistance-cost-notice').textContent).not.toMatch(/Kling/)
    await waitFor(() => expect(state.assistance?.mode).toBe('assisted'))
    expect(state.assistance?.description).toContain('coastal sunrise')
  })

  it('selects Gemini explicitly and restores assistance drafts without calling providers', async () => {
    await chooseAssisted()
    fireEvent.keyDown(screen.getByLabelText('Modelo de assistência'), { key: 'Enter' })
    const option = await screen.findByRole('option', { name: /Gemini.*3.5 Flash$/ })
    fireEvent.click(option)
    fireEvent.click(screen.getByTestId('video-assistance-create'))
    await screen.findByTestId('video-prompt-suggestion')
    expect(textCalls()[0].body.provider).toBe('gemini')
    await waitFor(() => expect(state.assistance?.provider).toBe('gemini'))
    cleanup(); calls = []; mount()
    await screen.findByLabelText('Sua descrição')
    expect((screen.getByLabelText('Sua descrição') as HTMLTextAreaElement).value).toBe('A coastal sunrise with a slow camera pan')
    expect(textCalls()).toHaveLength(0); expect(videoCalls()).toHaveLength(0)
  })

  it('I2V assistance sends motion semantics without source media, while submission retains the source and controls', async () => {
    state.selection.operation = 'image_to_video'; state.source = { type: 'generated', id: 'source-image' }
    await chooseAssisted()
    fireEvent.click(screen.getByTestId('video-assistance-improve'))
    await screen.findByTestId('video-prompt-suggestion')
    expect(textCalls()[0].body.videoMode).toBe('image_to_video')
    expect(textCalls()[0].body).not.toHaveProperty('sourceReference')
    expect(JSON.stringify(textCalls()[0].body)).not.toContain('source-image')
    fireEvent.click(screen.getByTestId('video-assistance-apply')); fireEvent.click(screen.getByTestId('video-assistance-apply'))
    fireEvent.click(screen.getByTestId('generate-video'))
    await waitFor(() => expect(videoCalls()).toHaveLength(1))
    expect(videoCalls()[0].body).toMatchObject({ mode: 'image_to_video', sourceImageId: 'source-image', duration: 5, resolution: '720p', audio: 'off' })
  })

  it('manual edits invalidate a late assistance response without overwriting or generating', async () => {
    const pending = deferred<Response>(); assistance = () => pending.promise
    await chooseAssisted(); fireEvent.click(screen.getByTestId('video-assistance-create'))
    await waitFor(() => expect(textCalls()).toHaveLength(1))
    fireEvent.change(screen.getByLabelText('Prompt de geração'), { target: { value: 'User revision while waiting' } })
    pending.resolve(json({ suggestedPrompt: 'Late response', provider: 'openai', model: 'gpt-4o-mini', operation: 'create' }))
    await waitFor(() => expect(screen.queryByText('Gerando sugestão…')).toBeNull())
    expect(screen.queryByTestId('video-prompt-suggestion')).toBeNull()
    expect((screen.getByLabelText('Prompt de geração') as HTMLTextAreaElement).value).toBe('User revision while waiting')
    expect(videoCalls()).toHaveLength(0)
  })

  it.each(['provider failure', 'invalid response'])('preserves the authored prompt on %s and never retries', async (kind) => {
    assistance = async () => kind === 'provider failure' ? json({ error: 'Rate limited' }, 429) : json({ suggestedPrompt: ' ', provider: 'openai', model: 'gpt-4o-mini', operation: 'create' })
    await chooseAssisted(); fireEvent.click(screen.getByTestId('video-assistance-create'))
    await screen.findByTestId('video-assistance-error')
    expect((screen.getByLabelText('Prompt de geração') as HTMLTextAreaElement).value).toBe('Authored manual prompt')
    expect(textCalls()).toHaveLength(1); expect(videoCalls()).toHaveLength(0)
  })

  it('missing BYOK and blocked environments fail closed for assistance while Manual stays independent', async () => {
    configured = false
    mount(); await screen.findByDisplayValue(state.prompt)
    fireEvent.click(screen.getByTestId('workflow-mode-assisted'))
    fireEvent.change(screen.getByLabelText('Sua descrição'), { target: { value: 'Scene' } })
    await waitFor(() => expect(screen.getByTestId('video-assistance-create').hasAttribute('disabled')).toBe(true))
    expect(screen.getByTestId('video-assistance-disabled-reason').textContent).toMatch(/BYOK/)
    expect(screen.getByTestId('generate-video').hasAttribute('disabled')).toBe(false)
    expect(textCalls()).toHaveLength(0)
    cleanup(); configured = true; allowed = false
    mount(); await screen.findByDisplayValue(state.prompt); fireEvent.click(screen.getByTestId('workflow-mode-assisted'))
    await screen.findByText('A assistência paga está bloqueada neste ambiente.')
    expect(textCalls()).toHaveLength(0)
  })

  it('requires Automatic opt-in and never resumes a saved Automatic draft by itself', async () => {
    automation = false
    state.assistance = { description: 'Scene', provider: 'openai', model: 'gpt-4o-mini', mode: 'automatic' }
    mount(); await screen.findByTestId('workflow-mode-hint')
    // Convergence V1: an unusable Automatic is shown as Assisted (the saved selection is kept), never as a dead panel.
    expect(screen.queryByTestId('video-automatic-panel')).toBeNull()
    expect(screen.getByTestId('video-assistance-create')).toBeTruthy()
    expect(screen.getByTestId('workflow-mode-hint').textContent).toMatch(/Configurações/)
    expect(textCalls()).toHaveLength(0); expect(videoCalls()).toHaveLength(0)
  })

  it('Automatic confirms overwrite, then performs exactly one text call and one frozen video submission', async () => {
    await chooseAutomatic()
    fireEvent.click(screen.getByTestId('video-automatic-start'))
    expect(textCalls()).toHaveLength(0)
    fireEvent.click(screen.getByText('Manter o prompt atual'))
    expect(textCalls()).toHaveLength(0)
    fireEvent.click(screen.getByTestId('video-automatic-start'))
    const confirm = screen.getByTestId('video-automatic-confirm-accept')
    fireEvent.click(confirm); fireEvent.click(confirm)
    await waitFor(() => expect(videoCalls()).toHaveLength(1))
    expect(textCalls()).toHaveLength(1)
    expect(textCalls()[0].body).toMatchObject({ operation: 'create', workflow: 'automatic' })
    expect(state.prompt).toBe('Suggested temporal scene prompt')
    expect(videoCalls()[0].body.prompt).toBe(state.prompt)
    expect(videoCalls()[0].body).toMatchObject({ duration: 5, resolution: '720p', audio: 'off', connectionRef: 'kling:api' })
    await screen.findByText(/Vídeo enviado\. Acompanhe/)
    expect(calls.some((call) => call.method === 'POST' && call.url.startsWith('/api/reviews'))).toBe(false)
  })

  it('cancels before video; even an ignored AbortSignal and late prompt cannot submit', async () => {
    const pending = deferred<Response>(); assistance = () => pending.promise
    await chooseAutomatic(); beginAutomatic()
    await screen.findByTestId('video-automatic-cancel')
    fireEvent.click(screen.getByTestId('video-automatic-cancel'))
    pending.resolve(json({ suggestedPrompt: 'Late auto prompt', provider: 'openai', model: 'gpt-4o-mini', operation: 'create' }))
    await screen.findByText(/Cancelado antes do envio/)
    expect((screen.getByLabelText('Prompt de geração') as HTMLTextAreaElement).value).toBe('Authored manual prompt')
    expect(videoCalls()).toHaveLength(0); expect(textCalls()).toHaveLength(1)
  })

  it('failed persistence stops Automatic before the video submission', async () => {
    save = async () => json({ code: 'STORE_UNAVAILABLE' }, 503)
    await chooseAutomatic(); beginAutomatic()
    await screen.findByText(/O envio não foi confirmado ou foi rejeitado/)
    expect(textCalls()).toHaveLength(1); expect(videoCalls()).toHaveLength(0)
    expect((screen.getByLabelText('Prompt de geração') as HTMLTextAreaElement).value).toBe('Suggested temporal scene prompt')
  })

  it('without a Kling connection the manual prompt remains editable and saved, with generation blocked', async () => {
    connections = []
    mount(); await screen.findByDisplayValue('Authored manual prompt')
    expect(screen.getByTestId('generate-video').hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByLabelText('Prompt de geração'), { target: { value: 'Draft before configuring Kling' } })
    await waitFor(() => expect(state.prompt).toBe('Draft before configuring Kling'), { timeout: 3000 })
    expect(textCalls()).toHaveLength(0); expect(videoCalls()).toHaveLength(0)
  })

  it('keeps an expired MCP draft editable and lets the user explicitly recover through REST without generation', async () => {
    const rest = connections[0]
    const expired = { ...rest, ref: 'kling:account:00000000-0000-4000-8000-000000000099', transport: 'mcp' as const, connectionMethod: 'mcp_oauth' as const,
      label: 'Minha conta Kling', funding: 'kling_web_credits' as const, canGenerate: false, capabilitiesFreshness: 'stale' as const, operations: [] }
    connections = [rest, expired]
    state.selection.connectionRef = expired.ref
    mount(); await screen.findByDisplayValue('Authored manual prompt')
    expect(screen.getByTestId('generate-video').hasAttribute('disabled')).toBe(true)
    expect(screen.getByTestId('workflow-mode-automatic').hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByLabelText('Prompt de geração'), { target: { value: 'Preserved expired-connection draft' } })
    await waitFor(() => expect(state.prompt).toBe('Preserved expired-connection draft'), { timeout: 3000 })
    fireEvent.pointerDown(screen.getByTestId('video-unavailable-connection-select'), { button: 0, ctrlKey: false, pointerType: 'mouse' })
    fireEvent.click(await screen.findByRole('option', { name: 'Kling API (API)' }))
    await screen.findByTestId('video-model-select')
    expect((screen.getByLabelText('Prompt de geração (como animar a imagem)') as HTMLTextAreaElement).value).toBe('Preserved expired-connection draft')
    expect(screen.getByTestId('video-connection-option-api').getAttribute('aria-checked')).toBe('true')
    expect(textCalls()).toHaveLength(0); expect(videoCalls()).toHaveLength(0)
  })

  it.each(['description saved first', 'prompt saved first'])('new-session URL normalization preserves an explicitly started Automatic run (%s)', async (order) => {
    exists = false; state.prompt = ''
    search = `new=1&project=${PROJECT}&production=${PRODUCTION}`
    router.replace.mockImplementation(() => { search = '' })
    const pendingText = deferred<Response>(); assistance = () => pendingText.promise
    mount(); await screen.findByTestId('video-model-select')
    // A fresh session reconciles to I2V first. Choose T2V explicitly instead of assuming a stored draft exists.
    fireEvent.mouseDown(screen.getByTestId('operation-text_to_video'), { button: 0, ctrlKey: false })
    await waitFor(() => expect(screen.getByTestId('workflow-mode-automatic').hasAttribute('disabled')).toBe(false))
    fireEvent.click(screen.getByTestId('workflow-mode-automatic'))
    fireEvent.change(screen.getByLabelText('Sua descrição'), { target: { value: 'A new scene' } })
    fireEvent.click(screen.getByTestId('video-automatic-start'))
    if (order === 'description saved first') {
      await waitFor(() => expect(calls.some((call) => call.method === 'PUT')).toBe(true), { timeout: 3000 })
      await waitFor(() => expect(router.replace).toHaveBeenCalled())
      expect(screen.getByTestId('video-automatic-cancel')).toBeTruthy()
    }
    pendingText.resolve(json({ suggestedPrompt: 'Created new-session prompt', provider: 'openai', model: 'gpt-4o-mini', operation: 'create' }))
    await waitFor(() => expect(videoCalls()).toHaveLength(1))
    await screen.findByText(/Vídeo enviado\. Acompanhe/)
    expect(textCalls()).toHaveLength(1)
    // Canonicalizing ?new/project/production must not issue a stale hydration GET or reset save waiters.
    expect(calls.filter((call) => call.url.startsWith('/api/video-generation-sessions/') && call.method === 'GET')).toHaveLength(1)
    expect(videoCalls()[0].body.prompt).toBe('Created new-session prompt')
    expect(videoCalls()[0].body).toMatchObject({ projectId: PROJECT, productionId: PRODUCTION, sessionId: SESSION })
  })

  it.each(['cancel', 'navigate', 'unmount'])('a pending autosave is still cancellable before video (%s)', async (action) => {
    const pendingSave = deferred<Response>()
    save = () => pendingSave.promise
    await chooseAutomatic(); beginAutomatic()
    await screen.findByText('Salvando o prompt. O vídeo ainda não foi enviado.')
    if (action === 'cancel') fireEvent.click(screen.getByTestId('video-automatic-cancel'))
    else if (action === 'navigate') fireEvent.click(screen.getByRole('button', { name: 'Voltar para a Produção' }))
    else cleanup()
    pendingSave.resolve(json({ session: { ...session(), workingState: { ...state, prompt: 'Suggested temporal scene prompt' } } }))
    await waitFor(() => expect(textCalls()).toHaveLength(1))
    // Allow the resolved save continuation to run before asserting no POST.
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(videoCalls()).toHaveLength(0)
    expect(sessionStorage.getItem(`video-pending-submit:${SESSION}`)).toBeNull()
  })

  it.each(['lost response', 'unknown replay', 'unreadable response'])('retains the same uncertain submit across remount (%s), with no new paid action', async (kind) => {
    submit = async () => {
      if (kind === 'lost response') throw new Error('network lost')
      if (kind === 'unreadable response') return new Response('not-json', { status: 200 })
      return json({ generation: { id: GENERATION, status: 'failed' }, idempotentReplay: true, outcomeUnknown: true })
    }
    await chooseAutomatic(); beginAutomatic()
    await screen.findByTestId('unconfirmed-submission-banner')
    const key = videoCalls()[0].body.clientRequestId
    expect(sessionStorage.getItem(`video-pending-submit:${SESSION}`)).toBe(key)
    fireEvent.click(screen.getByTestId('generate-video'))
    cleanup(); mount()
    await screen.findByTestId('unconfirmed-submission-banner')
    expect(screen.getByTestId('generate-video').hasAttribute('disabled')).toBe(true)
    expect(videoCalls()).toHaveLength(1); expect(textCalls()).toHaveLength(1)
    expect(sessionStorage.getItem(`video-pending-submit:${SESSION}`)).toBe(key)
  })

  it('read-only history reconciles an uncertain submit and never resubmits it', async () => {
    submit = async (body) => { attempts = [{ id: GENERATION, status: 'succeeded', task_id: 'accepted-task', prompt: body.prompt, client_request_id: body.clientRequestId }]; throw new Error('lost reply') }
    await ready(); fireEvent.click(screen.getByTestId('generate-video'))
    await waitFor(() => expect(videoCalls()).toHaveLength(1))
    await waitFor(() => expect(sessionStorage.getItem(`video-pending-submit:${SESSION}`)).toBeNull())
    expect(videoCalls()).toHaveLength(1)
    await waitFor(() => expect(screen.getByTestId('generate-video').hasAttribute('disabled')).toBe(false))
    expect(screen.getByTestId(`attempt-card-${GENERATION}`)).toBeTruthy()
  })

  it('an interrupted orphan without a provider task remains uncertain on history refresh', async () => {
    submit = async (body) => {
      attempts = [{ id: GENERATION, status: 'failed', prompt: body.prompt, client_request_id: body.clientRequestId, task_id: null, error_details: { code: 'SUBMISSION_INTERRUPTED' } }]
      return json({ code: 'SUBMISSION_UNRECORDED', outcomeUnknown: true }, 502)
    }
    await ready(); fireEvent.click(screen.getByTestId('generate-video'))
    await screen.findByTestId('unconfirmed-submission-banner')
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar tentativas' }))
    await waitFor(() => expect(screen.getByTestId(`attempt-card-${GENERATION}`)).toBeTruthy())
    expect(screen.getByTestId('generate-video').hasAttribute('disabled')).toBe(true)
    expect(sessionStorage.getItem(`video-pending-submit:${SESSION}`)).toBe(videoCalls()[0].body.clientRequestId)
    expect(videoCalls()).toHaveLength(1)
  })

  it('Review → use refined prompt → edit → generate retains immutable Review and previous Attempt', async () => {
    const previous = { id: GENERATION, status: 'succeeded', public_url: 'https://storage.example/video.mp4', prompt: 'Immutable previous attempt', mode: 'text_to_video', model: 'kling-v3' }
    attempts = [previous]
    const immutable = JSON.stringify(previous); const immutableReview = JSON.stringify(review())
    await ready()
    fireEvent.click(screen.getByTestId('video-review-open'))
    await screen.findByText('Visual review')
    expect(screen.getByText(/áudio.*não/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Usar prompt refinado' }))
    expect((screen.getByLabelText('Prompt de geração') as HTMLTextAreaElement).value).toBe('Refined motion and camera prompt')
    expect(videoCalls()).toHaveLength(0); expect(textCalls()).toHaveLength(0)
    fireEvent.change(screen.getByLabelText('Prompt de geração'), { target: { value: 'Refined motion and camera prompt, user edit' } })
    fireEvent.click(screen.getByTestId('generate-video'))
    await waitFor(() => expect(videoCalls()).toHaveLength(1))
    expect(videoCalls()[0].body.prompt).toContain('user edit')
    expect(JSON.stringify(previous)).toBe(immutable); expect(JSON.stringify(review())).toBe(immutableReview)
    await waitFor(() => expect(screen.getAllByTestId(/^attempt-card-/)).toHaveLength(2))
    expect(calls.some((call) => call.url === '/api/reviews/video' && call.method === 'POST')).toBe(false)
  })

  it('MCP keeps its selected connection, model, duration, resolution and account-credit notice', async () => {
    const base = describeRestConnection('configured')
    const ref = 'kling:account:00000000-0000-4000-8000-000000000099'
    connections = [{ ...base, ref, transport: 'mcp', connectionMethod: 'mcp_oauth', label: 'Minha conta Kling', funding: 'kling_web_credits', capabilitiesFreshness: 'fresh' }]
    state.selection.connectionRef = ref
    await chooseAutomatic(); beginAutomatic()
    await waitFor(() => expect(videoCalls()).toHaveLength(1))
    expect(videoCalls()[0].body.connectionRef).toBe(ref)
    expect(screen.getByTestId('video-connection-detail').textContent).toMatch(/créditos/)
  })
})

// GENERATION_PROMPT_MODES_LANGUAGE_UX_CONVERGENCE_V1
describe('Prompt modes + language convergence — Video', () => {
  it('Manual shows one prompt field; the briefing is preserved and can be reused only by an explicit click', async () => {
    state.prompt = ''
    state.assistance = { description: 'Scene brief written earlier', provider: 'openai', model: 'gpt-4o-mini', mode: 'manual' }
    mount(); await screen.findByTestId('video-briefing-preserved')
    expect(screen.queryByLabelText('Sua descrição')).toBeNull()
    expect(screen.getAllByLabelText('Prompt de geração')).toHaveLength(1)
    expect((screen.getByLabelText('Prompt de geração') as HTMLTextAreaElement).value).toBe('')
    fireEvent.click(screen.getByTestId('video-use-description-as-prompt'))
    await waitFor(() => expect((screen.getByLabelText('Prompt de geração') as HTMLTextAreaElement).value).toBe('Scene brief written earlier'))
    expect(screen.queryByTestId('video-briefing-preserved')).toBeNull()
    expect(textCalls()).toHaveLength(0); expect(translateCalls()).toHaveLength(0); expect(videoCalls()).toHaveLength(0)
  })

  it('Assisted explains why Improve is unavailable without a generation prompt', async () => {
    state.prompt = ''
    mount(); await screen.findByTestId('workflow-mode-assisted')
    fireEvent.click(screen.getByTestId('workflow-mode-assisted'))
    const reason = await screen.findByTestId('video-assistance-input-reason')
    expect(reason.textContent).toMatch(/Melhorar com IA: escreva ou aplique um prompt/)
    expect((screen.getByTestId('video-assistance-improve') as HTMLButtonElement).disabled).toBe(true)
  })

  it('Portuguese tab never translates by itself; one explicit click translates once as a read-only view', async () => {
    await ready()
    fireEvent.mouseDown(screen.getByTestId('video-prompt-tab-pt'), { button: 0 })
    fireEvent.click(screen.getByTestId('video-prompt-tab-pt'))
    await screen.findByTestId('video-prompt-translation-empty')
    expect(screen.getByTestId('video-prompt-translation-cost').textContent).toMatch(/BYOK/)
    expect(translateCalls()).toHaveLength(0)
    fireEvent.click(screen.getByTestId('video-prompt-translate'))
    const output = await screen.findByTestId('video-prompt-translation-output') as HTMLTextAreaElement
    expect(output.value).toBe('PT: Authored manual prompt')
    expect(output.readOnly).toBe(true)
    expect(translateCalls()).toHaveLength(1)
    // Switching views is free: no new request, and the generation prompt is unchanged.
    fireEvent.mouseDown(screen.getByTestId('video-prompt-tab-prompt'), { button: 0 }); fireEvent.click(screen.getByTestId('video-prompt-tab-prompt'))
    fireEvent.mouseDown(screen.getByTestId('video-prompt-tab-pt'), { button: 0 }); fireEvent.click(screen.getByTestId('video-prompt-tab-pt'))
    expect((await screen.findByTestId('video-prompt-translation-output') as HTMLTextAreaElement).value).toBe('PT: Authored manual prompt')
    expect(translateCalls()).toHaveLength(1)
    expect(state.prompt).toBe('Authored manual prompt')
    // The video is generated from the original prompt, never from the translation.
    fireEvent.click(screen.getByTestId('generate-video'))
    await waitFor(() => expect(videoCalls()).toHaveLength(1))
    expect(videoCalls()[0].body.prompt).toBe('Authored manual prompt')
  })

  it('editing the prompt discards the translation and a late response for an older prompt is dropped', async () => {
    const late = deferred<Response>()
    translate = () => late.promise
    await ready()
    fireEvent.mouseDown(screen.getByTestId('video-prompt-tab-pt'), { button: 0 }); fireEvent.click(screen.getByTestId('video-prompt-tab-pt'))
    fireEvent.click(await screen.findByTestId('video-prompt-translate'))
    await waitFor(() => expect(translateCalls()).toHaveLength(1))
    fireEvent.mouseDown(screen.getByTestId('video-prompt-tab-prompt'), { button: 0 }); fireEvent.click(screen.getByTestId('video-prompt-tab-prompt'))
    fireEvent.change(screen.getByLabelText('Prompt de geração'), { target: { value: 'A different authored prompt' } })
    late.resolve(json({ translatedPrompt: 'PT: old prompt', model: 'gpt-4o-mini' }))
    fireEvent.mouseDown(screen.getByTestId('video-prompt-tab-pt'), { button: 0 }); fireEvent.click(screen.getByTestId('video-prompt-tab-pt'))
    await screen.findByTestId('video-prompt-translation-empty')
    expect(screen.queryByTestId('video-prompt-translation-output')).toBeNull()
    expect(translateCalls()).toHaveLength(1)
  })

  it('translation is unavailable (and explained) without an OpenAI key', async () => {
    configured = false
    mount(); await screen.findByDisplayValue(state.prompt)
    await waitFor(() => expect(calls.some((call) => call.url === '/api/settings/providers')).toBe(true))
    fireEvent.mouseDown(screen.getByTestId('video-prompt-tab-pt'), { button: 0 }); fireEvent.click(screen.getByTestId('video-prompt-tab-pt'))
    expect((await screen.findByTestId('video-prompt-translation-unavailable')).textContent).toMatch(/Tradução indisponível/)
    expect((screen.getByTestId('video-prompt-translate') as HTMLButtonElement).disabled).toBe(true)
    expect(translateCalls()).toHaveLength(0)
  })

  it('Automatic shows both models, owns generation (no competing button) and keeps the prompt read-only', async () => {
    await chooseAutomatic()
    expect(screen.queryByTestId('generate-video')).toBeNull()
    const summary = screen.getByTestId('video-automatic-summary').textContent ?? ''
    expect(summary).toMatch(/GPT-4o mini/); expect(summary).toMatch(/Kling/)
    expect((screen.getByLabelText('Prompt de geração') as HTMLTextAreaElement).readOnly).toBe(true)
    expect(screen.getByTestId('video-prompt-hint').textContent).toMatch(/somente leitura/)
    expect(textCalls()).toHaveLength(0); expect(videoCalls()).toHaveLength(0)
  })
})
