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
function server(options: { model?: string; refs?: any[]; mode?: string; attempts?: any[]; project?: string | null; saveFailure?: boolean } = {}) {
  let revision = 1
  let state: any = {
    schemaVersion: 1, generatedPrompt: 'The exact canonical prompt', generatedPromptPt: null, promptDetails: null,
    autoMode: options.mode === 'automatic', workflowMode: options.mode || 'assisted', selectedModel: options.model || 'gemini-nb-2.1',
    imageStatus: 'draft', currentAttempt: 1, currentImageId: null, sourceReferences: options.refs || [],
    generationConfig: { size: '1024x1024', quality: 'medium', aspectRatio: '1:1', style: null, providerOptions: {} }, legacyImageUrl: null,
  }
  const calls: Call[] = []
  let networkFailure = false
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
    if (url === '/api/gemini/generate-image') {
      if (networkFailure) return Promise.reject(new TypeError('network'))
      return json({ imageUrl: 'https://display.test/output.png', image: { id: OUTPUT }, attemptId: 'attempt' })
    }
    return json({})
  }) as typeof fetch
  return { calls, state: () => state, failNetwork: () => { networkFailure = true } }
}
function mount() { render(<GenerationSessionNavigationProvider><ImagesPageShell canonicalSessionId={SESSION} /></GenerationSessionNavigationProvider>) }
async function ready() { await screen.findByTestId('image-reference-picker'); await waitFor(() => expect((screen.getByTestId('workflow-mode-automatic') as HTMLButtonElement).disabled).toBe(false)) }
async function pick(category: string) {
  fireEvent.click(screen.getByRole('button', { name: /Escolher referência|Trocar referência/ }))
  expect(screen.getByTestId('reference-browser').getAttribute('data-profile')).toBe('image-reference')
  fireEvent.click(screen.getByRole('button', { name: `Pick ${category}` }))
}
const imageCalls = (calls: Call[]) => calls.filter((c) => c.url === '/api/gemini/generate-image')
const generationCalls = (calls: Call[]) => calls.filter((c) => /generate-image|nanobanana\/generate/.test(c.url))
const create = () => screen.getByRole('button', { name: 'Criar Imagem' }) as HTMLButtonElement

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  const proto = HTMLElement.prototype as any
  proto.hasPointerCapture = () => false; proto.setPointerCapture = () => undefined; proto.releasePointerCapture = () => undefined
  ;(globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
})
afterEach(() => { cleanup(); vi.clearAllMocks() })
vi.setConfig({ testTimeout: 20_000 })

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
    const s = server({ model: 'gpt-image-2', refs: [{ type: 'library_file', id: LIBRARY }] }); mount(); await ready()
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
      if (!option.textContent?.includes('Google Gemini')) expect(option.getAttribute('aria-disabled')).toBe('true')
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

  it('shows immutable attempt reference separately and reuses result/history image IDs', async () => {
    const s = server({ refs: [{ type: 'library_file', id: LIBRARY }], attempts: [{ id: 'attempt', sequence: 1, submittedPrompt: 'old prompt', resultImageId: OUTPUT, model: 'gemini-nb-2.1', sourceSnapshot: { references: [{ type: 'image', id: IMAGE }] } }] })
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

  it('allows both Gemini aliases and blocks every other catalog model with a reference', () => {
    for (const model of ['gemini-nb-2.1', 'gemini-nb-lite']) expect(imageReferenceModelReason(model, [{ type: 'image', id: IMAGE }])).toBeNull()
    for (const model of ['gpt-image-2', 'gpt-image-1', 'gpt-image-1.5', 'gpt-image-1-mini', 'nanobanana-v1', 'nanobanana-v2', 'unknown']) expect(imageReferenceModelReason(model, [{ type: 'image', id: IMAGE }])).toContain('não envia referências')
    expect(imageReferenceModelReason('gpt-image-2', [])).toBeNull()
  })
})
