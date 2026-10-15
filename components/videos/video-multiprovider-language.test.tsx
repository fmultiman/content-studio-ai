// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import WorkspacePage from '@/app/(dashboard)/videos/geracoes/[sessionId]/page'
import { GenerationSessionNavigationProvider } from '@/components/generation-session/session-navigation-guard'
import { describeGeminiConnection, describeRestConnection } from '@/lib/video-generation/connections'
import type { VideoGenerationWorkingStateV1 } from '@/lib/video-generation/working-state'
import type { VideoGenerationConnectionDescriptor } from '@/lib/video-generation/capabilities'

// STRUCTURAL_WAVE_0 (D22 + D9) - the real /videos workspace, mocked network only. A user who selected Google Veo is never told
// about "a Kling"; a Kling user still reads Kling. Provider routing, capabilities, costs and credentials are not touched here.

const SESSION = '00000000-0000-4000-8000-000000000001'
const PROJECT = '00000000-0000-4000-8000-000000000010'
const PRODUCTION = '00000000-0000-4000-8000-000000000020'
const toast = vi.fn()
const router = { push: vi.fn(), replace: vi.fn() }
vi.mock('next/navigation', () => ({ useRouter: () => router, useParams: () => ({ sessionId: SESSION }), useSearchParams: () => new URLSearchParams('') }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }))

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => { resolve = yes })
  return { promise, resolve }
}
type Call = { url: string; method: string; body: any }
let calls: Call[]
let state: VideoGenerationWorkingStateV1
let version: number
let connections: VideoGenerationConnectionDescriptor[]
let attempts: any[]
let submit: (body: any) => Promise<Response>

const klingSelection = () => ({
  connectionRef: 'kling:api', operation: 'text_to_video' as const, modelId: 'kling-v3', duration: 5, resolution: '720p' as const, aspectRatio: '16:9' as const,
  audio: 'off' as const, multiShot: false, asmr: null, audioPrompt: null, musicPrompt: null,
})
const veoSelection = () => ({
  connectionRef: 'google:gemini', operation: 'text_to_video' as const, modelId: 'veo-3.1-fast-generate-preview', duration: 8, resolution: '720p' as const,
  aspectRatio: '16:9' as const, audio: null, multiShot: null, asmr: null, audioPrompt: null, musicPrompt: null,
})
const initial = (selection: VideoGenerationWorkingStateV1['selection']): VideoGenerationWorkingStateV1 => ({ schemaVersion: 1, prompt: 'A door opens onto a garden', source: null, selection })
const attempt = (id: string, status: string, provider: 'kling' | 'gemini', extra: Record<string, unknown> = {}) => ({
  id, prompt: `Tentativa ${status}`, status, provider, transport: 'rest', mode: 'text_to_video', created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:05:00Z', ...extra,
})

const videoCalls = () => calls.filter((call) => call.url === '/api/video-generations' && call.method === 'POST')
const mount = () => render(<GenerationSessionNavigationProvider><WorkspacePage /></GenerationSessionNavigationProvider>)
const ready = async () => { mount(); await screen.findByDisplayValue(state.prompt); await waitFor(() => expect(screen.getByTestId('workflow-mode-automatic').hasAttribute('disabled')).toBe(false)) }
const chooseAutomatic = async () => {
  await ready()
  fireEvent.click(screen.getByTestId('workflow-mode-automatic'))
  fireEvent.change(screen.getByLabelText('Sua descrição'), { target: { value: 'A coastal sunrise with a slow camera pan' } })
}
const beginAutomatic = () => { fireEvent.click(screen.getByTestId('video-automatic-start')); fireEvent.click(screen.getByTestId('video-automatic-confirm-accept')) }

beforeEach(() => {
  sessionStorage.clear()
  calls = []; version = 0; attempts = []
  connections = [describeRestConnection('configured'), describeGeminiConnection('configured', true)]
  submit = async (body) => { attempts = [...attempts, attempt(crypto.randomUUID(), 'submitted', 'kling', { client_request_id: body.clientRequestId })]; return json({ generation: attempts.at(-1) }, 201) }
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => undefined
  Element.prototype.releasePointerCapture ??= () => undefined
  Element.prototype.scrollIntoView ??= () => undefined
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input); const method = init?.method ?? 'GET'; const body = init?.body ? JSON.parse(String(init.body)) : null
    calls.push({ url, method, body })
    if (url === '/api/settings/providers') return json({ providers: { openai: { status: 'configured' }, gemini: { status: 'configured' } }, automationEnabled: true, executionPolicy: { paidExecution: 'allowed' } })
    if (url.endsWith('/connections')) return json({ connections })
    if (url.startsWith('/api/video-generation-sessions/')) {
      if (method !== 'GET') { state = body.workingState; version += 1 }
      return json({ session: { id: SESSION, projectId: PROJECT, productionId: PRODUCTION, updatedAt: `version-${version}`, workingState: state } })
    }
    if (url.startsWith('/api/video-generations?')) return json({ generations: attempts })
    if (url === '/api/prompt-assistance') return json({ suggestedPrompt: 'Suggested temporal scene prompt', provider: body.provider, model: body.model, operation: body.operation, usage: null })
    if (url === '/api/video-generations' && method === 'POST') return submit(body)
    if (method === 'GET') return json({ items: [], files: [], images: [] })
    throw new Error(`Unexpected non-mocked request: ${method} ${url}`)
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('D22 - Google Veo selected: no Kling-only wording', () => {
  it('the assistance cost notice speaks of "a conexão de vídeo escolhida", with Veo or Kling', async () => {
    state = initial(veoSelection())
    await ready()
    fireEvent.click(screen.getByTestId('workflow-mode-assisted'))
    const notice = screen.getByTestId('video-assistance-cost-notice').textContent ?? ''
    expect(notice).toContain('conexão de vídeo escolhida')
    expect(notice).not.toMatch(/Kling/)
  })

  it('Automatic sending announces Google Veo (not Kling) while the video is being sent', async () => {
    state = initial(veoSelection())
    const hold = deferred<Response>()
    submit = () => hold.promise
    await chooseAutomatic()
    beginAutomatic()
    const status = await screen.findByText('Enviando um vídeo para o Google Veo.')
    expect(status.textContent).not.toMatch(/Kling/)
    hold.resolve(json({ generation: attempt('g-1', 'submitted', 'gemini') }, 201))
    await waitFor(() => expect(screen.getByTestId('video-automatic-status').textContent).toMatch(/Vídeo enviado/))
    expect(videoCalls()).toHaveLength(1)
  })

  it('Automatic sending with Kling still announces Kling', async () => {
    state = initial(klingSelection())
    const hold = deferred<Response>()
    submit = () => hold.promise
    await chooseAutomatic()
    beginAutomatic()
    expect(await screen.findByText('Enviando um vídeo para a Kling.')).toBeTruthy()
    hold.resolve(json({ generation: attempt('g-1', 'submitted', 'kling') }, 201))
    await waitFor(() => expect(screen.getByTestId('video-automatic-status').textContent).toMatch(/Vídeo enviado/))
  })

  it('an unconfirmed submission without a server message names Google Veo', async () => {
    state = initial(veoSelection())
    submit = async () => json({ outcomeUnknown: true }, 502)
    await ready()
    fireEvent.click(screen.getByTestId('generate-video'))
    const banner = await screen.findByTestId('unconfirmed-submission-banner')
    expect(banner.textContent).toContain('Não foi possível confirmar o envio ao Google Veo.')
    expect(banner.textContent).not.toMatch(/Kling/)
  })

  it('an unconfirmed submission without a server message names Kling for a Kling connection', async () => {
    state = initial(klingSelection())
    submit = async () => json({ outcomeUnknown: true }, 502)
    await ready()
    fireEvent.click(screen.getByTestId('generate-video'))
    const banner = await screen.findByTestId('unconfirmed-submission-banner')
    expect(banner.textContent).toContain('Não foi possível confirmar o envio à Kling.')
  })

  it('a server message is shown as the server wrote it (the server already names the right provider)', async () => {
    state = initial(veoSelection())
    submit = async () => json({ outcomeUnknown: true, error: 'Não foi possível confirmar o envio ao Google Veo. Verifique a sua conta Google antes de tentar novamente.' }, 502)
    await ready()
    fireEvent.click(screen.getByTestId('generate-video'))
    const banner = await screen.findByTestId('unconfirmed-submission-banner')
    expect(banner.textContent).toContain('Verifique a sua conta Google')
  })

  it('without a usable connection the form asks for "uma conexão de vídeo", not a Kling one', async () => {
    connections = []
    state = initial(klingSelection())
    mount()
    const prompt = await screen.findByDisplayValue(state.prompt)
    expect(prompt.getAttribute('placeholder')).toBe('Escreva seu prompt enquanto configura uma conexão de vídeo.')
    expect(await screen.findByText(/Configure uma conexão de vídeo em Configurações/)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/conexão Kling/)
  })
})

describe('D9/D22 - attempts history of the workspace', () => {
  it('shows the Portuguese state, keeps the stored one, and explains a failed Veo attempt with Veo', async () => {
    state = initial(veoSelection())
    attempts = [
      attempt('a-queued', 'queued', 'gemini'),
      attempt('a-processing', 'processing', 'gemini'),
      attempt('a-ok', 'succeeded', 'gemini'),
      attempt('a-veo-failed', 'failed', 'gemini', { error_details: null }),
      attempt('a-kling-failed', 'failed', 'kling', { error_details: null }),
    ]
    await ready()
    const label = (id: string) => within(screen.getByTestId(`attempt-card-${id}`)).getByTestId('generation-status')
    expect(label('a-queued').textContent).toBe('Na fila')
    expect(label('a-processing').textContent).toBe('Processando')
    expect(label('a-ok').textContent).toBe('Concluído')
    expect(label('a-veo-failed').textContent).toBe('Falhou')
    expect(label('a-veo-failed').getAttribute('data-status')).toBe('failed')

    expect(screen.getByTestId('attempt-watch-a-processing').textContent).toContain('Processando')
    expect(screen.getByTestId('attempt-watch-a-ok').textContent).toContain('Assistir')

    fireEvent.click(screen.getByTestId('attempt-watch-a-veo-failed'))
    expect(toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'A geração falhou', description: 'O Google Veo não concluiu esta geração.' }))
    fireEvent.click(screen.getByTestId('attempt-watch-a-kling-failed'))
    expect(toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'A geração falhou', description: 'A Kling não concluiu esta geração.' }))
  })
})
