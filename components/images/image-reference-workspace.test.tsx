// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ImagesPageShell } from '@/app/(dashboard)/imagens/page'
import { GenerationSessionNavigationProvider } from '@/components/generation-session/session-navigation-guard'
import { imageReferenceModelReason } from './image-reference'

const SESSION = '00000000-0000-0000-0000-000000000001'
const PROJECT = '00000000-0000-0000-0000-000000000002'
const IMAGE = '00000000-0000-0000-0000-000000000003'
const LIBRARY = '00000000-0000-0000-0000-000000000004'
const OUTPUT = '00000000-0000-0000-0000-000000000005'
const search = new URLSearchParams()
const router = { push: vi.fn(), replace: vi.fn() }
vi.mock('next/navigation', () => ({ useRouter: () => router, useSearchParams: () => search }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({
  auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) },
  from: (table: string) => {
    const chain: any = { select: () => chain, order: () => chain, eq: () => chain, in: () => chain,
      single: async () => ({ data: table === 'user_settings' ? { automation_enabled: true } : null }),
      then: (resolve: any) => Promise.resolve({ data: table === 'images' ? [{ id: OUTPUT, image_url: 'https://display.test/output.png' }] : [], error: null }).then(resolve) }
    return chain
  },
}) }))

// The shared browser has its own integration tests. Here only its selection/upload boundary is mocked.
vi.mock('@/components/videos/i2v-source-browser', () => ({ I2vSourceBrowser: (props: any) => <div data-testid="reference-browser" data-profile={props.profile}>
  {['ai', 'gallery', 'library', 'upload'].map((category) => <button key={category} disabled={props.locked} onClick={() => props.onSelect({
    source: { type: category === 'ai' ? 'generated' : 'library', id: category === 'ai' ? IMAGE : LIBRARY },
    summary: { category, label: `${category} reference`, thumbnailUrl: 'https://display.test/temporary-signed.png', productionName: null, folder: null },
  })}>Pick {category}</button>)}
  <button onClick={() => props.onUploadBusyChange(true)}>Start upload</button>
  <button onClick={() => props.onUploadBusyChange(false)}>Finish upload</button>
</div> }))

type Call = { url: string; method: string; body: any }
function server(options: { model?: string; refs?: any[]; mode?: string; attempts?: any[]; project?: string | null; saveFailure?: boolean; size?: string; quality?: string; deduplicatePaid?: boolean } = {}) {
  let revision = 1
  let state: any = {
    schemaVersion: 1, generatedPrompt: 'The exact canonical prompt', generatedPromptPt: null, promptDetails: null,
    autoMode: options.mode === 'automatic', workflowMode: options.mode || 'assisted', selectedModel: options.model || 'gemini-nb-2.1',
    imageStatus: 'draft', currentAttempt: 1, currentImageId: null, sourceReferences: options.refs || [],
    generationConfig: { size: options.size || '1024x1024', quality: options.quality || 'medium', aspectRatio: '1:1', style: null, providerOptions: {} }, legacyImageUrl: null,
  }
  const calls: Call[] = []
  let networkFailure = false
  let generationReply: { status: number; payload: unknown } | null = null
  // Simulates the server's durable request-ID boundary after a provider accepted the request.
  // This counter is entirely mocked; no provider or billing endpoint is called.
  const acceptedPaidRequests = new Set<string>()
  const session = () => ({ id: SESSION, projectId: options.project === undefined ? PROJECT : options.project, productionId: null,
    currentImageId: options.attempts?.length ? OUTPUT : null, workingPrompt: 'A mountain', workingState: state, revision })
  const json = (data: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(data), { status }))
  global.fetch = vi.fn((input: unknown, init?: RequestInit) => {
    const url = String(input), method = init?.method || 'GET', body = init?.body ? JSON.parse(String(init.body)) : null
    calls.push({ url, method, body })
    if (url === `/api/image-generation-sessions/${SESSION}`) {
      if (method === 'PATCH') {
        if (options.saveFailure) return json({ error: 'conflict', code: 'SESSION_REVISION_CONFLICT' }, 409)
        state = body.workingState; revision += 1
      }
      return json({ session: session() })
    }
    if (url.startsWith('/api/image-generation-attempts')) return json({ attempts: options.attempts || [] })
    if (url.startsWith('/api/image-generation-sessions')) return json({ sessions: [] })
    if (url.startsWith('/api/image-drafts')) return json({ drafts: [] })
    if (url.startsWith('/api/settings/providers')) return json({ providers: { openai: { status: 'configured' }, gemini: { status: 'configured' } }, imageGeneration: { gemini: { available: true, reason: 'available' } } })
    if (url.startsWith('/api/images/')) return json({ imageUrl: 'https://display.test/generated.png' })
    if (url.includes('/display?')) return json({ file: { name: 'Saved Library reference', public_url: 'https://display.test/library.png', origin: 'upload' } })
    if (url === '/api/prompt-assistance') return json({ suggestedPrompt: 'The assisted canonical prompt', operation: body.operation, provider: 'openai', model: 'gpt-4o-mini' })
    if (url === '/api/gemini/generate-image' || url === '/api/openai/generate-image') {
      if (options.deduplicatePaid) {
        if (acceptedPaidRequests.has(body.clientRequestId)) return json({ replayed: true, status: 'failed', outcome_unknown: true, attemptId: 'accepted-attempt' })
        acceptedPaidRequests.add(body.clientRequestId)
      }
      if (networkFailure) return Promise.reject(new TypeError('network'))
      if (generationReply) return json(generationReply.payload, generationReply.status)
      return json({ imageUrl: 'https://display.test/output.png', image: { id: OUTPUT }, attemptId: 'attempt' })
    }
    return json({})
  }) as typeof fetch
  return { calls, state: () => state, paidSubmissions: () => acceptedPaidRequests.size, failNetwork: () => { networkFailure = true }, reply: (payload: unknown, status = 200) => { networkFailure = false; generationReply = { status, payload } } }
}
function mount() { render(<GenerationSessionNavigationProvider><ImagesPageShell canonicalSessionId={SESSION} /></GenerationSessionNavigationProvider>) }
async function ready() { await screen.findByTestId('image-reference-picker'); await waitFor(() => expect((screen.getByTestId('workflow-mode-automatic') as HTMLButtonElement).disabled).toBe(false)) }
async function pick(category: string, profile = 'image-reference') {
  fireEvent.click(screen.getByRole('button', { name: /Escolher referência|Trocar referência/ }))
  expect(screen.getByTestId('reference-browser').getAttribute('data-profile')).toBe(profile)
  fireEvent.click(screen.getByRole('button', { name: `Pick ${category}` }))
}
const imageCalls = (calls: Call[], provider = 'gemini') => calls.filter((c) => c.url === `/api/${provider}/generate-image`)
const generationCalls = (calls: Call[]) => calls.filter((c) => /generate-image|nanobanana\/generate/.test(c.url))
const create = () => screen.getByRole('button', { name: 'Criar Imagem' }) as HTMLButtonElement
async function chooseOption(label: string, option: RegExp) {
  fireEvent.pointerDown(screen.getByLabelText(label), { button: 0, ctrlKey: false, pointerType: 'mouse' })
  const list = await screen.findByRole('listbox')
  fireEvent.click(within(list).getByRole('option', { name: option }))
}
async function submit() { await waitFor(() => expect(create().disabled).toBe(false)); fireEvent.click(create()) }

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  const proto = HTMLElement.prototype as any
  proto.hasPointerCapture = () => false; proto.setPointerCapture = () => undefined; proto.releasePointerCapture = () => undefined
  ;(globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
})

describe('GPT Image 2 reference workflow', () => {
  it.each(['manual', 'assisted', 'automatic'])('sends one saved reference and bounded config in %s; assistance sees no image', async (mode) => {
    const s = server({ model: 'gpt-image-2', mode, refs: [{ type: 'library_file', id: LIBRARY }], size: '1536x1024', quality: 'high' })
    mount(); await ready(); await screen.findByText('Saved Library reference')
    expect(screen.getByTestId('image-reference-limits').textContent).toContain('20 MB')
    expect(screen.getByTestId('image-reference-limits').textContent).toContain('16384 px')
    expect(screen.getByTestId('image-reference-limits').textContent).toContain('67.108.864 pixels')
    expect(screen.getByTestId('openai-reference-cost-notice').textContent).toContain('tokens da imagem de referência')
    expect(screen.getByTestId('openai-reference-cost-notice').textContent).toContain('alta fidelidade automaticamente')
    if (mode === 'automatic') {
      fireEvent.click(screen.getByTestId('automatic-run-start'))
      fireEvent.click(await screen.findByTestId('automatic-run-confirm-accept'))
    } else {
      if (mode === 'assisted') {
        fireEvent.click(screen.getByRole('button', { name: 'Melhorar com IA' }))
        fireEvent.click(await screen.findByTestId('prompt-assistance-apply'))
      }
      await submit()
    }
    await waitFor(() => expect(imageCalls(s.calls, 'openai')).toHaveLength(1))
    const call = imageCalls(s.calls, 'openai')[0]
    expect(call.body).toEqual({ prompt: mode === 'manual' ? 'The exact canonical prompt' : 'The assisted canonical prompt', model: 'gpt-image-2', size: '1536x1024', quality: 'high', sourceReferences: [{ type: 'library_file', id: LIBRARY }], sessionId: SESSION, clientRequestId: expect.any(String) })
    expect(call.body).not.toHaveProperty('input_fidelity')
    expect(imageCalls(s.calls)).toHaveLength(0)
    const saved = s.calls.slice(0, s.calls.indexOf(call)).filter((c) => c.method === 'PATCH').at(-1)?.body.workingState || s.state()
    expect(saved.sourceReferences).toEqual(call.body.sourceReferences)
    expect(saved.generationConfig).toMatchObject({ size: call.body.size, quality: call.body.quality })
    for (const assistance of s.calls.filter((c) => c.url === '/api/prompt-assistance')) {
      expect(JSON.stringify(assistance.body)).not.toContain(LIBRARY)
      expect(assistance.body).not.toHaveProperty('sourceReferences')
      expect(JSON.stringify(assistance.body)).not.toContain('display.test')
    }
  })

  it('selects, replaces, reloads and switches GPT2/Gemini limits/profile while retaining the same durable reference', async () => {
    const s = server({ model: 'gpt-image-2' }); mount(); await ready(); await pick('ai', 'openai-image-reference')
    await pick('upload', 'openai-image-reference')
    await waitFor(() => expect(s.state().sourceReferences).toEqual([{ type: 'library_file', id: LIBRARY }]), { timeout: 3000 })
    cleanup(); mount(); await ready(); await screen.findByText('Saved Library reference')
    await chooseOption('Modelo de imagem', /Nano Banana 2 Lite/)
    expect(screen.getByTestId('image-reference-limits').textContent).toContain('10 MB')
    expect(screen.getByTestId('image-reference-limits').textContent).toContain('8192 px')
    expect(screen.queryByTestId('openai-reference-cost-notice')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Trocar referência' }))
    expect(screen.getByTestId('reference-browser').getAttribute('data-profile')).toBe('image-reference')
    await chooseOption('Modelo de imagem', /^GPT Image 2$/)
    expect(screen.getByTestId('reference-browser').getAttribute('data-profile')).toBe('openai-image-reference')
    expect(screen.getByText('Saved Library reference')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remover referência' }))
    await waitFor(() => expect(s.state().sourceReferences).toEqual([]), { timeout: 3000 })
    expect(screen.queryByTestId('openai-reference-output-controls')).toBeNull()
    expect(screen.queryByTestId('openai-reference-cost-notice')).toBeNull()
    expect(generationCalls(s.calls)).toHaveLength(0)
  })

  it('preserves actual network retry ID and rotates it for changed source, size, quality or prompt', async () => {
    const s = server({ model: 'gpt-image-2', mode: 'manual' }); s.failNetwork(); mount(); await ready(); await pick('ai', 'openai-image-reference')
    const send = async (count: number) => { await submit(); await waitFor(() => expect(imageCalls(s.calls, 'openai')).toHaveLength(count)); await waitFor(() => expect(create().disabled).toBe(false)) }
    await send(1); await send(2)
    expect(imageCalls(s.calls, 'openai')[1].body.clientRequestId).toBe(imageCalls(s.calls, 'openai')[0].body.clientRequestId)
    await pick('library', 'openai-image-reference'); await send(3)
    await chooseOption('Tamanho da imagem', /1536 × 1024/); await send(4)
    await chooseOption('Qualidade da imagem', /^Alta$/); await send(5)
    fireEvent.change(document.getElementById('generated-prompt')!, { target: { value: 'A newly authored exact prompt' } }); await send(6)
    const calls = imageCalls(s.calls, 'openai')
    for (let index = 2; index < calls.length; index++) expect(calls[index].body.clientRequestId).not.toBe(calls[index - 1].body.clientRequestId)
    expect(calls[3].body.size).toBe('1536x1024'); expect(calls[4].body.quality).toBe('high'); expect(calls[5].body.prompt).toBe('A newly authored exact prompt')
    for (const call of calls) {
      const snapshot = s.calls.slice(0, s.calls.indexOf(call)).filter((c) => c.method === 'PATCH').at(-1)!.body.workingState
      expect(snapshot.sourceReferences).toEqual(call.body.sourceReferences)
      expect(snapshot.generationConfig).toMatchObject({ size: call.body.size, quality: call.body.quality })
    }
  })

  it('keeps T2I body exactly at default size/quality with no reference or fidelity fields after removing', async () => {
    const s = server({ model: 'gpt-image-2', mode: 'manual', refs: [{ type: 'image', id: IMAGE }], size: '1024x1536', quality: 'low' }); mount(); await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Remover referência' })); await submit()
    await waitFor(() => expect(imageCalls(s.calls, 'openai')).toHaveLength(1))
    expect(imageCalls(s.calls, 'openai')[0].body).toEqual({ prompt: 'The exact canonical prompt', model: 'gpt-image-2', size: '1024x1024', quality: 'medium', sessionId: SESSION, clientRequestId: expect.any(String) })
  })

  it('keeps ID on in-progress replay and rotates it after a failed immutable replay', async () => {
    const s = server({ model: 'gpt-image-2', mode: 'manual', refs: [{ type: 'image', id: IMAGE }] }); s.failNetwork(); mount(); await ready()
    await submit(); await waitFor(() => expect(imageCalls(s.calls, 'openai')).toHaveLength(1))
    s.reply({ replayed: true, status: 'processing' }); await submit(); await waitFor(() => expect(imageCalls(s.calls, 'openai')).toHaveLength(2))
    s.reply({ replayed: true, status: 'failed', outcome_unknown: false }); await submit(); await waitFor(() => expect(imageCalls(s.calls, 'openai')).toHaveLength(3))
    await submit(); await waitFor(() => expect(imageCalls(s.calls, 'openai')).toHaveLength(4))
    const calls = imageCalls(s.calls, 'openai')
    expect(calls[1].body.clientRequestId).toBe(calls[0].body.clientRequestId)
    expect(calls[2].body.clientRequestId).toBe(calls[0].body.clientRequestId)
    expect(calls[3].body.clientRequestId).not.toBe(calls[0].body.clientRequestId)
  })

  it('Automatic retries only the image with the same ID after network failure, then rotates when output config changes', async () => {
    const s = server({ model: 'gpt-image-2', mode: 'automatic', refs: [{ type: 'image', id: IMAGE }] }); s.failNetwork(); mount(); await ready()
    fireEvent.click(screen.getByTestId('automatic-run-start'))
    fireEvent.click(await screen.findByTestId('automatic-run-confirm-accept'))
    await screen.findByTestId('automatic-run-image-failed')
    fireEvent.click(screen.getByTestId('automatic-run-retry-image'))
    await waitFor(() => expect(imageCalls(s.calls, 'openai')).toHaveLength(2))
    await screen.findByTestId('automatic-run-image-failed')
    await chooseOption('Qualidade da imagem', /^Baixa$/)
    fireEvent.click(screen.getByTestId('automatic-run-retry-image'))
    await waitFor(() => expect(imageCalls(s.calls, 'openai')).toHaveLength(3))
    const calls = imageCalls(s.calls, 'openai')
    expect(calls[1].body.clientRequestId).toBe(calls[0].body.clientRequestId)
    expect(calls[2].body.clientRequestId).not.toBe(calls[0].body.clientRequestId)
    expect(calls[2].body.quality).toBe('low')
    expect(s.calls.filter((c) => c.url === '/api/prompt-assistance')).toHaveLength(1)
  })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })
vi.setConfig({ testTimeout: 20_000 })

const RETRY_PROVIDERS = [
  { model: 'gpt-image-2', provider: 'openai' },
  { model: 'gemini-nb-2.1', provider: 'gemini' },
] as const

const UNKNOWN_HTTP_OUTCOMES = [
  { status: 504, payload: { error: 'The request timed out', code: 'PROVIDER_TIMEOUT' } },
  { status: 504, payload: { error: 'The request timed out', code: 'PROVIDER_TIMEOUT', outcome_unknown: true } },
  { status: 502, payload: { error: 'Provider response lost', code: 'PROVIDER_UNAVAILABLE', outcome_unknown: true } },
  { status: 503, payload: { error: 'Output storage failed after provider acceptance', code: 'STORAGE_UNAVAILABLE', outcome_unknown: true } },
  { status: 502, payload: { error: 'Provider response lost', code: 'PROVIDER_UNAVAILABLE' } },
  { status: 503, payload: { error: 'Output storage failed after provider acceptance', code: 'STORAGE_UNAVAILABLE' } },
] as const

describe.each(RETRY_PROVIDERS)('$provider uncertain paid outcomes', ({ model, provider }) => {
  it.each(UNKNOWN_HTTP_OUTCOMES)('Manual HTTP $status recovery keeps the original identity through an uncertain failed replay', async ({ status, payload }) => {
    const s = server({ model, mode: 'manual', refs: [{ type: 'image', id: IMAGE }], deduplicatePaid: true })
    s.reply(payload, status); mount(); await ready()
    for (let count = 1; count <= 3; count++) { await submit(); await waitFor(() => expect(imageCalls(s.calls, provider)).toHaveLength(count)) }
    const ids = imageCalls(s.calls, provider).map((call) => call.body.clientRequestId)
    expect(new Set(ids).size).toBe(1)
    expect(s.paidSubmissions()).toBe(1)
    expect(s.calls.filter((c) => c.url === '/api/prompt-assistance')).toHaveLength(0)
  })

  it.each(UNKNOWN_HTTP_OUTCOMES.slice(0, 4))('Automatic HTTP $status retry spends once and calls assistance only once', async ({ status, payload }) => {
    const s = server({ model, mode: 'automatic', refs: [{ type: 'image', id: IMAGE }], deduplicatePaid: true })
    s.reply(payload, status); mount(); await ready()
    fireEvent.click(screen.getByTestId('automatic-run-start'))
    fireEvent.click(await screen.findByTestId('automatic-run-confirm-accept'))
    for (let count = 2; count <= 3; count++) {
      await screen.findByTestId('automatic-run-image-failed')
      fireEvent.click(screen.getByTestId('automatic-run-retry-image'))
      await waitFor(() => expect(imageCalls(s.calls, provider)).toHaveLength(count))
    }
    expect(new Set(imageCalls(s.calls, provider).map((call) => call.body.clientRequestId)).size).toBe(1)
    expect(s.paidSubmissions()).toBe(1)
    expect(s.calls.filter((c) => c.url === '/api/prompt-assistance')).toHaveLength(1)
  })

  it.each([true, undefined])('lost network response followed by failed replay outcome_unknown=%s preserves identity', async (outcomeUnknown) => {
    const s = server({ model, mode: 'manual', refs: [{ type: 'image', id: IMAGE }] }); s.failNetwork(); mount(); await ready()
    await submit(); await waitFor(() => expect(imageCalls(s.calls, provider)).toHaveLength(1))
    s.reply({ replayed: true, status: 'failed', ...(outcomeUnknown === undefined ? {} : { outcome_unknown: outcomeUnknown }) })
    await submit(); await waitFor(() => expect(imageCalls(s.calls, provider)).toHaveLength(2))
    await submit(); await waitFor(() => expect(imageCalls(s.calls, provider)).toHaveLength(3))
    expect(new Set(imageCalls(s.calls, provider).map((call) => call.body.clientRequestId)).size).toBe(1)
  })

  it.each([
    { status: 400, payload: { error: 'Invalid source', code: 'INVALID_IMAGE_MODEL', outcome_unknown: false } },
    { status: 400, payload: { error: 'Invalid source', code: 'INVALID_IMAGE_MODEL' } },
    { status: 503, payload: { error: 'Pre-provider validation unavailable', code: 'PROVIDER_CREDENTIAL_UNAVAILABLE', outcome_unknown: false } },
  ])('definitive pre-provider HTTP $status rejection still rotates identity', async ({ status, payload }) => {
    const s = server({ model, mode: 'manual', refs: [{ type: 'image', id: IMAGE }] }); s.reply(payload, status); mount(); await ready()
    await submit(); await waitFor(() => expect(imageCalls(s.calls, provider)).toHaveLength(1))
    await submit(); await waitFor(() => expect(imageCalls(s.calls, provider)).toHaveLength(2))
    expect(imageCalls(s.calls, provider)[1].body.clientRequestId).not.toBe(imageCalls(s.calls, provider)[0].body.clientRequestId)
  })

  it('Gerar Novamente explicitly starts a fresh generation after an uncertain submission', async () => {
    const s = server({ model, mode: 'manual', refs: [{ type: 'image', id: IMAGE }], attempts: [{ id: 'old-attempt', sequence: 1, resultImageId: OUTPUT, submittedPrompt: 'old prompt', model, sourceSnapshot: { references: [] } }], deduplicatePaid: true })
    s.reply({ error: 'timeout', code: 'PROVIDER_TIMEOUT' }, 504); mount(); await ready()
    await submit(); await waitFor(() => expect(imageCalls(s.calls, provider)).toHaveLength(1))
    await waitFor(() => expect(create().disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Gerar Novamente' }))
    await waitFor(() => expect(imageCalls(s.calls, provider)).toHaveLength(2))
    expect(imageCalls(s.calls, provider)[1].body.clientRequestId).not.toBe(imageCalls(s.calls, provider)[0].body.clientRequestId)
    expect(s.paidSubmissions()).toBe(2) // Explicit new generation, not a recovery retry.
  })
})

describe('Image reference workspace', () => {
  it('selects project AI, replaces via Gallery/Library/upload, persists only one durable ID and removes', async () => {
    const s = server(); mount(); await ready()
    expect(screen.getByTestId('image-reference-picker').className).toContain('min-w-0')
    expect(screen.getByTestId('image-reference-actions').className).toContain('flex-wrap')
    for (const category of ['ai', 'gallery', 'library', 'upload']) {
      await pick(category)
      await waitFor(() => expect(s.state().sourceReferences).toEqual([{ type: category === 'ai' ? 'image' : 'library_file', id: category === 'ai' ? IMAGE : LIBRARY }]), { timeout: 3000 })
      expect(JSON.stringify(s.state())).not.toContain('display.test')
      expect(screen.queryByTestId('reference-browser')).toBeNull()
    }
    fireEvent.click(screen.getByRole('button', { name: 'Remover referência' }))
    await waitFor(() => expect(s.state().sourceReferences).toEqual([]), { timeout: 3000 })
    expect(generationCalls(s.calls)).toHaveLength(0)
  })

  it.each(['manual', 'assisted', 'automatic'])('hydrates and preserves references in %s and sends them only to the image API after saving', async (mode) => {
    const s = server({ mode, refs: [{ type: 'library_file', id: LIBRARY }] }); mount(); await ready()
    await screen.findByText('Saved Library reference')
    expect(Boolean(screen.queryByTestId('image-reference-text-ai-note'))).toBe(mode !== 'manual')
    if (mode === 'automatic') {
      fireEvent.click(screen.getByTestId('automatic-run-start'))
      fireEvent.click(await screen.findByTestId('automatic-run-confirm-accept'))
    } else {
      if (mode === 'assisted') {
        fireEvent.click(screen.getByRole('button', { name: 'Melhorar com IA' }))
        fireEvent.click(await screen.findByTestId('prompt-assistance-apply'))
      }
      await waitFor(() => expect(create().disabled).toBe(false)); fireEvent.click(create())
    }
    await waitFor(() => expect(imageCalls(s.calls)).toHaveLength(1))
    const generation = imageCalls(s.calls)[0]
    expect(generation.body.sourceReferences).toEqual([{ type: 'library_file', id: LIBRARY }])
    expect(generation.body.prompt).toBe(mode === 'manual' ? 'The exact canonical prompt' : 'The assisted canonical prompt')
    const submitted = s.calls.indexOf(generation)
    const saved = s.calls.slice(0, submitted).filter((c) => c.method === 'PATCH').at(-1)!
    // Manual with an already acknowledged state need not issue a new PATCH.
    expect(saved?.body.workingState.sourceReferences || s.state().sourceReferences).toEqual(generation.body.sourceReferences)
    expect(saved?.body.workingState.generatedPrompt || s.state().generatedPrompt).toBe(generation.body.prompt)
    for (const call of s.calls.filter((c) => c.url === '/api/prompt-assistance')) expect(JSON.stringify(call.body)).not.toContain(LIBRARY)
  })

  it('flushes a newly selected reference before generation; changes retry identity when references change', async () => {
    const s = server({ mode: 'manual' }); s.failNetwork(); mount(); await ready(); await pick('ai')
    fireEvent.click(create()); await waitFor(() => expect(imageCalls(s.calls)).toHaveLength(1))
    await waitFor(() => expect(create().disabled).toBe(false)); fireEvent.click(create())
    await waitFor(() => expect(imageCalls(s.calls)).toHaveLength(2))
    expect(imageCalls(s.calls)[1].body.clientRequestId).toBe(imageCalls(s.calls)[0].body.clientRequestId)
    await waitFor(() => expect(create().disabled).toBe(false)); await pick('library'); fireEvent.click(create())
    await waitFor(() => expect(imageCalls(s.calls)).toHaveLength(3))
    expect(imageCalls(s.calls)[2].body.clientRequestId).not.toBe(imageCalls(s.calls)[0].body.clientRequestId)
    for (const call of imageCalls(s.calls)) {
      const before = s.calls.slice(0, s.calls.indexOf(call)).filter((c) => c.method === 'PATCH').at(-1)!
      expect(before.body.workingState.sourceReferences).toEqual(call.body.sourceReferences)
    }
  })

  it('reloads persisted reference IDs and blocks an incompatible saved model while keeping the reference', async () => {
    const s = server({ model: 'gpt-image-1.5', refs: [{ type: 'library_file', id: LIBRARY }] }); mount(); await ready()
    await screen.findByText('Saved Library reference'); expect(create().disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Trocar referência' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Remover referência' }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByTestId('create-disabled-reason').textContent).toContain('não envia referências')
    for (const mode of ['manual', 'automatic', 'assisted']) fireEvent.click(screen.getByTestId(`workflow-mode-${mode}`))
    expect(screen.getByText('Saved Library reference')).toBeTruthy()
    cleanup(); mount(); await ready(); await screen.findByText('Saved Library reference')
    expect(s.state().sourceReferences).toEqual([{ type: 'library_file', id: LIBRARY }])
    expect(generationCalls(s.calls)).toHaveLength(0)
    fireEvent.pointerDown(screen.getByLabelText('Modelo de imagem'), { button: 0, ctrlKey: false, pointerType: 'mouse' })
    const list = await screen.findByRole('listbox')
    for (const option of within(list).getAllByRole('option')) {
      if (!option.textContent?.includes('Google Gemini') && !option.textContent?.includes('GPT Image 2')) expect(option.getAttribute('aria-disabled')).toBe('true')
    }
    fireEvent.click(within(list).getByRole('option', { name: /Nano Banana 2 Lite/ }))
    await waitFor(() => expect(create().disabled).toBe(false))
    expect(screen.getByText('Saved Library reference')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Trocar referência' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Remover referência' }))
    await waitFor(() => expect(s.state().sourceReferences).toEqual([]), { timeout: 3000 })
  })

  it('requires a project before reference choice or submission', async () => {
    const s = server({ project: null, refs: [{ type: 'image', id: IMAGE }] }); mount(); await ready()
    expect((screen.getByRole('button', { name: 'Trocar referência' }) as HTMLButtonElement).disabled).toBe(true)
    expect(create().disabled).toBe(true)
    expect(screen.getByTestId('create-disabled-reason').textContent).toContain('Selecione um projeto')
    expect(generationCalls(s.calls)).toHaveLength(0)
  })

  it('prevents generation while uploading or when autosave conflicts', async () => {
    const s = server({ saveFailure: true }); mount(); await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Escolher referência' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start upload' })); expect(create().disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Finish upload' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pick ai' })); fireEvent.click(create())
    await screen.findByTestId('save-status-conflict')
    expect(generationCalls(s.calls)).toHaveLength(0)
  })

  it.each(['gemini-nb-2.1', 'gpt-image-2'])('shows immutable attempt reference separately and reuses result/history image IDs for %s', async (model) => {
    const s = server({ model, refs: [{ type: 'library_file', id: LIBRARY }], attempts: [{ id: 'attempt', sequence: 1, submittedPrompt: 'old prompt', resultImageId: OUTPUT, model, sourceSnapshot: { references: [{ type: 'image', id: IMAGE }] } }] })
    mount(); await ready(); await screen.findAllByTestId('image-attempt-references')
    const buttons = screen.getAllByRole('button', { name: 'Usar como referência' })
    expect(buttons).toHaveLength(2)
    for (const button of buttons) {
      fireEvent.click(button)
      await waitFor(() => expect(s.state().sourceReferences).toEqual([{ type: 'image', id: OUTPUT }]), { timeout: 3000 })
    }
    expect(screen.getAllByTestId('image-attempt-references')).toHaveLength(2)
    expect(generationCalls(s.calls)).toHaveLength(0)
  })

  it('allows both Gemini aliases and GPT Image 2; blocks all other catalog models with a reference', () => {
    for (const model of ['gemini-nb-2.1', 'gemini-nb-lite', 'gpt-image-2']) expect(imageReferenceModelReason(model, [{ type: 'image', id: IMAGE }])).toBeNull()
    for (const model of ['gpt-image-1', 'gpt-image-1.5', 'gpt-image-1-mini', 'nanobanana-v1', 'nanobanana-v2', 'unknown']) expect(imageReferenceModelReason(model, [{ type: 'image', id: IMAGE }])).toContain('não envia referências')
    expect(imageReferenceModelReason('gpt-image-2', [])).toBeNull()
  })
})
