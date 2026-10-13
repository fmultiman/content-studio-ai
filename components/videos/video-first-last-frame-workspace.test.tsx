// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import WorkspacePage from '@/app/(dashboard)/videos/geracoes/[sessionId]/page'
import { GenerationSessionNavigationProvider } from '@/components/generation-session/session-navigation-guard'
import { describeGeminiConnection, describeRestConnection } from '@/lib/video-generation/connections'
import type { VideoGenerationWorkingStateV1 } from '@/lib/video-generation/working-state'
import type { VideoGenerationConnectionDescriptor } from '@/lib/video-generation/capabilities'

// VEO_KLING_FIRST_LAST_FRAME_V1 — the real /videos workspace, mocked network only. No provider is ever contacted.

const SESSION = '00000000-0000-4000-8000-000000000001'
const PROJECT = '00000000-0000-4000-8000-000000000010'
const PRODUCTION = '00000000-0000-4000-8000-000000000020'
const IMG_A = '00000000-0000-4000-8000-0000000000a1'
const IMG_B = '00000000-0000-4000-8000-0000000000b2'
const LIB_B = '00000000-0000-4000-8000-0000000000c3'
const toast = vi.fn()
const router = { push: vi.fn(), replace: vi.fn() }
vi.mock('next/navigation', () => ({ useRouter: () => router, useParams: () => ({ sessionId: SESSION }), useSearchParams: () => new URLSearchParams('') }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }))

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
type Call = { url: string; method: string; body: any }
let calls: Call[]
let state: VideoGenerationWorkingStateV1
let version: number
let connections: VideoGenerationConnectionDescriptor[]
let attempts: any[]

const klingSelection = (overrides: Record<string, unknown> = {}) => ({
  connectionRef: 'kling:api', operation: 'image_to_video' as const, modelId: 'kling-v3', duration: 5, resolution: '720p' as const, aspectRatio: null,
  audio: 'off' as const, multiShot: false, asmr: null, audioPrompt: null, musicPrompt: null, ...overrides,
})
const veoSelection = (overrides: Record<string, unknown> = {}) => ({
  connectionRef: 'google:gemini', operation: 'image_to_video' as const, modelId: 'veo-3.1-fast-generate-preview', duration: 8, resolution: '720p' as const,
  aspectRatio: '16:9' as const, audio: null, multiShot: null, asmr: null, audioPrompt: null, musicPrompt: null, ...overrides,
})
const frames = (overrides: Partial<VideoGenerationWorkingStateV1> = {}): VideoGenerationWorkingStateV1 => ({
  schemaVersion: 1, prompt: 'A door opens onto a garden', source: { type: 'generated', id: IMG_A }, lastFrame: { type: 'library', id: LIB_B }, selection: klingSelection(), ...overrides,
})

const videoCalls = () => calls.filter((call) => call.url === '/api/video-generations' && call.method === 'POST')
const sessionPatches = () => calls.filter((call) => call.url.startsWith('/api/video-generation-sessions/') && call.method !== 'GET')
const mount = () => render(<GenerationSessionNavigationProvider><WorkspacePage /></GenerationSessionNavigationProvider>)
const ready = async () => { mount(); await screen.findByDisplayValue(state.prompt); await screen.findByTestId('generate-video') }

beforeEach(() => {
  sessionStorage.clear()
  calls = []; version = 0; attempts = []
  connections = [describeRestConnection('configured'), describeGeminiConnection('configured', true)]
  router.replace.mockReset()
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => undefined
  Element.prototype.releasePointerCapture ??= () => undefined
  Element.prototype.scrollIntoView ??= () => undefined
  state = frames()
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input); const method = init?.method ?? 'GET'; const body = init?.body ? JSON.parse(String(init.body)) : null
    calls.push({ url, method, body })
    if (url === '/api/settings/providers') return json({ providers: { openai: { status: 'configured' }, gemini: { status: 'configured' } }, automationEnabled: false, executionPolicy: { paidExecution: 'allowed' } })
    if (url.endsWith('/connections')) return json({ connections })
    if (url.startsWith('/api/video-generation-sessions/')) {
      if (method !== 'GET') { state = body.workingState; version += 1 }
      return json({ session: { id: SESSION, projectId: PROJECT, productionId: PRODUCTION, updatedAt: `version-${version}`, workingState: state } })
    }
    if (url.startsWith('/api/video-generations?')) return json({ generations: attempts })
    if (url === '/api/video-generations' && method === 'POST') {
      attempts = [...attempts, { id: crypto.randomUUID(), prompt: body.prompt, status: 'submitted', client_request_id: body.clientRequestId, mode: body.mode, model: body.model }]
      return json({ generation: attempts.at(-1) }, 201)
    }
    if (method === 'GET') return json({ items: [], files: [], images: [] })
    throw new Error(`Unexpected non-mocked request: ${method} ${url}`)
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('first/last frame — the real /videos workspace', () => {
  it('shows image A (required) and image B (optional) with thumbnails/summaries, and "Prompt de movimento e transição"', async () => {
    await ready()
    expect(screen.getByText('Imagem inicial (A)')).toBeTruthy()
    expect(screen.getByText('Imagem final (B) — opcional')).toBeTruthy()
    expect(within(screen.getByTestId('i2v-source-summary')).getByText('Imagem selecionada')).toBeTruthy()
    expect(within(screen.getByTestId('i2v-last-frame-summary')).getByText('Imagem final selecionada')).toBeTruthy()
    expect(screen.getByTestId('i2v-last-frame-change')).toBeTruthy()
    expect(screen.getByTestId('i2v-last-frame-clear')).toBeTruthy()
    expect(screen.getByLabelText('Prompt de movimento e transição')).toBeTruthy()
    // The two slots are different things from "reference images".
    expect(screen.getByTestId('video-last-frame-explainer').textContent).toMatch(/Não são imagens de referência/)
  })

  it('submits BOTH durable ids (first + last) in one request, exactly once, with no URL', async () => {
    await ready()
    fireEvent.click(screen.getByTestId('generate-video'))
    fireEvent.click(screen.getByTestId('generate-video'))
    await waitFor(() => expect(videoCalls()).toHaveLength(1))
    expect(videoCalls()[0].body).toMatchObject({
      mode: 'image_to_video', sourceImageId: IMG_A, lastFrameLibraryFileId: LIB_B, model: 'kling-v3', connectionRef: 'kling:api', sessionId: SESSION,
    })
    expect(videoCalls()[0].body).not.toHaveProperty('sourceLibraryFileId')
    expect(videoCalls()[0].body).not.toHaveProperty('lastFrameImageId')
    expect(JSON.stringify(videoCalls()[0].body)).not.toMatch(/https?:|storage|signed/i)
  })

  it('a generated image can be the last frame (type generated -> lastFrameImageId); no last frame sends none', async () => {
    state = frames({ lastFrame: { type: 'generated', id: IMG_B } })
    await ready()
    fireEvent.click(screen.getByTestId('generate-video'))
    await waitFor(() => expect(videoCalls()).toHaveLength(1))
    expect(videoCalls()[0].body).toMatchObject({ lastFrameImageId: IMG_B })

    cleanup(); calls = []; sessionStorage.clear()
    state = frames({ lastFrame: undefined })
    delete (state as { lastFrame?: unknown }).lastFrame
    await ready()
    expect(screen.queryByTestId('i2v-last-frame-summary')).toBeNull()
    expect(screen.getByTestId('i2v-last-frame-choose')).toBeTruthy()
    fireEvent.click(screen.getByTestId('generate-video'))
    await waitFor(() => expect(videoCalls()).toHaveLength(1))
    expect(videoCalls()[0].body).not.toHaveProperty('lastFrameImageId')
    expect(videoCalls()[0].body).not.toHaveProperty('lastFrameLibraryFileId')
  })

  it('removing B returns to a single-image request and autosaves a state without the lastFrame key', async () => {
    await ready()
    fireEvent.click(screen.getByTestId('i2v-last-frame-clear'))
    await waitFor(() => expect(sessionPatches().length).toBeGreaterThan(0), { timeout: 4000 })
    await waitFor(() => expect('lastFrame' in state).toBe(false), { timeout: 4000 })
    expect(screen.getByLabelText('Prompt de geração (como animar a imagem)')).toBeTruthy()
    fireEvent.click(screen.getByTestId('generate-video'))
    await waitFor(() => expect(videoCalls()).toHaveLength(1))
    expect(videoCalls()[0].body).not.toHaveProperty('lastFrameLibraryFileId')
  })

  it('B and its Session survive a reload: the second mount restores both frames from the server state', async () => {
    await ready()
    cleanup()
    await ready()
    expect(screen.getByTestId('i2v-source-summary')).toBeTruthy()
    expect(screen.getByTestId('i2v-last-frame-summary')).toBeTruthy()
    expect(state.lastFrame).toEqual({ type: 'library', id: LIB_B })
  })

  it('an incompatible model keeps B in the draft, explains why, and BLOCKS the submit (never dropped silently)', async () => {
    state = frames({ selection: klingSelection({ modelId: 'kling-v2-6', resolution: '720p' }) })
    await ready()
    expect(screen.getByTestId('i2v-last-frame-summary')).toBeTruthy()
    expect(screen.getByTestId('i2v-last-frame-note').textContent).toMatch(/Kling 2\.6 só aceita imagem final em 1080p/)
    expect((screen.getByTestId('generate-video') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByTestId('generate-video'))
    expect(videoCalls()).toHaveLength(0)
    expect(state.lastFrame).toEqual({ type: 'library', id: LIB_B })

    // The user fixes it EXPLICITLY (choosing 1080p); only then can it be sent.
    fireEvent.keyDown(screen.getByTestId('video-resolution-select'), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('option', { name: 'Alta (1080p)' }))
    await waitFor(() => expect((screen.getByTestId('generate-video') as HTMLButtonElement).disabled).toBe(false))
    expect(screen.queryByTestId('i2v-last-frame-note')).toBeNull()
  })

  it('the same image as first and last frame is blocked with its own reason', async () => {
    state = frames({ lastFrame: { type: 'generated', id: IMG_A } })
    await ready()
    expect((screen.getByTestId('generate-video') as HTMLButtonElement).disabled).toBe(true)
    expect(videoCalls()).toHaveLength(0)
  })

  it('Text-to-Video shows NO first/last-frame slots, sends neither frame, but keeps the draft', async () => {
    state = frames({ selection: klingSelection({ operation: 'text_to_video', aspectRatio: '16:9' }) })
    await ready()
    expect(screen.queryByTestId('i2v-source-picker')).toBeNull()
    expect(screen.queryByTestId('i2v-last-frame-picker')).toBeNull()
    fireEvent.click(screen.getByTestId('generate-video'))
    await waitFor(() => expect(videoCalls()).toHaveLength(1))
    for (const key of ['sourceImageId', 'sourceLibraryFileId', 'lastFrameImageId', 'lastFrameLibraryFileId']) expect(videoCalls()[0].body).not.toHaveProperty(key)
    expect(state.lastFrame).toEqual({ type: 'library', id: LIB_B })
  })
})

describe('Google Veo in the same workspace', () => {
  it('Veo accepts A + B, shows its own controls (aspect ratio, 8 s at 1080p, native audio) and sends the Google connection', async () => {
    state = frames({ selection: veoSelection() })
    await ready()
    expect(screen.queryByTestId('i2v-last-frame-note')).toBeNull()
    expect(screen.getByTestId('video-aspect-select')).toBeTruthy()
    expect(screen.queryByTestId('video-audio-select')).toBeNull()
    expect(screen.getByTestId('video-native-audio-note').textContent).toMatch(/sempre gera o áudio/)
    expect(screen.getByTestId('video-model-summary').textContent).toMatch(/primeiro e último quadro/)
    expect(screen.getByTestId('video-connection-detail').textContent).toMatch(/Google cobra por segundo/)
    expect(screen.getByTestId('video-connection-option-veo')).toBeTruthy()
    fireEvent.click(screen.getByTestId('generate-video'))
    await waitFor(() => expect(videoCalls()).toHaveLength(1))
    expect(videoCalls()[0].body).toMatchObject({
      connectionRef: 'google:gemini', model: 'veo-3.1-fast-generate-preview', mode: 'image_to_video', sourceImageId: IMG_A, lastFrameLibraryFileId: LIB_B,
      duration: 8, resolution: '720p', aspect_ratio: '16:9',
    })
    expect(videoCalls()[0].body).not.toHaveProperty('audio')
    expect(videoCalls()[0].body).not.toHaveProperty('multi_shot')
  })

  it('Veo A+B below 8 s is blocked with its reason, then sendable once the user picks 8 s (explicit, never silent)', async () => {
    state = frames({ selection: veoSelection({ duration: 4 }) })
    await ready()
    expect(screen.getByTestId('i2v-last-frame-note').textContent).toMatch(/só aceita imagem final em vídeos de 8 segundos/)
    expect((screen.getByTestId('generate-video') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByTestId('generate-video'))
    expect(videoCalls()).toHaveLength(0)
    expect(state.lastFrame).toEqual({ type: 'library', id: LIB_B })
    fireEvent.keyDown(screen.getByTestId('video-duration-select'), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('option', { name: '8 segundos' }))
    await waitFor(() => expect((screen.getByTestId('generate-video') as HTMLButtonElement).disabled).toBe(false))
    expect(screen.queryByTestId('i2v-last-frame-note')).toBeNull()
  })

  it('choosing 1080p leaves 8 s as the only duration (Google rule), explained next to the controls', async () => {
    state = frames({ selection: veoSelection({ duration: 6 }) })
    await ready()
    fireEvent.keyDown(screen.getByTestId('video-resolution-select'), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('option', { name: 'Alta (1080p)' }))
    await waitFor(() => expect(screen.getByTestId('video-duration-resolution-note').textContent).toMatch(/apenas vídeos de 8 segundos/))
    expect(screen.getByTestId('video-duration-select').textContent).toMatch(/8 segundos/)
  })

  it('before its release Veo is visible but cannot generate: the form says so and the button is disabled', async () => {
    connections = [describeRestConnection('configured'), describeGeminiConnection('configured', false)]
    state = frames({ selection: veoSelection() })
    await ready()
    expect(screen.getByTestId('video-connection-blocked').textContent).toMatch(/ainda não foi liberado/)
    expect((screen.getByTestId('generate-video') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByTestId('generate-video'))
    expect(videoCalls()).toHaveLength(0)
  })

  it('switching from Veo to a Kling model keeps both frames and re-evaluates compatibility', async () => {
    state = frames({ selection: veoSelection() })
    await ready()
    fireEvent.click(screen.getByTestId('video-connection-option-api'))
    await waitFor(() => expect(screen.getByTestId('video-connection-option-api').getAttribute('data-selected')).toBe('true'))
    expect(screen.getByTestId('i2v-source-summary')).toBeTruthy()
    expect(screen.getByTestId('i2v-last-frame-summary')).toBeTruthy()
  })
})
