// @vitest-environment jsdom
import { Component, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import WorkspacePage from '@/app/(dashboard)/videos/geracoes/[sessionId]/page'
import { GenerationSessionNavigationProvider } from '@/components/generation-session/session-navigation-guard'
import { describeRestConnection } from '@/lib/video-generation/connections'
import { installBrowserFaithfulTimers } from '@/lib/generation-session/__tests__/browser-timers'

// GENERATION_WORKSPACE_INTERACTION_CRASH_V1 — Video side.
// The real route page is rendered with only network, router and toast faked, and the global timers behave
// like a browser's (receiver-checked). Selecting Kling 2.6 used to fall into the Next.js error boundary
// because the shared autosave controller called a detached `setTimeout` ("Illegal invocation").

const SESSION_ID = '00000000-0000-0000-0000-000000000001'
const PROJECT_ID = '00000000-0000-0000-0000-000000000010'
const PRODUCTION_ID = '00000000-0000-0000-0000-000000000020'

const mockRouter = { push: vi.fn(), replace: vi.fn() }
vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  useParams: () => ({ sessionId: SESSION_ID }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))

class RecordingBoundary extends Component<{ children: ReactNode; onError: (error: Error) => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error) { this.props.onError(error) }
  render() { return this.state.failed ? <div data-testid="error-boundary">This page couldn’t load</div> : this.props.children }
}

const workingState = (overrides: Record<string, unknown> = {}, prompt = 'Initial prompt') => ({
  schemaVersion: 1,
  prompt,
  source: null,
  selection: {
    connectionRef: 'kling:api',
    operation: 'text_to_video',
    modelId: 'kling-v3',
    duration: 5,
    resolution: '720p',
    aspectRatio: '16:9',
    audio: 'off',
    multiShot: false,
    asmr: null,
    audioPrompt: null,
    musicPrompt: null,
    ...overrides,
  },
})

type FetchCall = { url: string; method: string; body: any }

function installServer() {
  let version = 0
  let stored: any = workingState()
  const calls: FetchCall[] = []
  const stamp = () => `2026-10-08T12:00:0${version}.000Z`
  const session = () => ({ id: SESSION_ID, projectId: PROJECT_ID, productionId: PRODUCTION_ID, updatedAt: stamp(), workingState: stored })
  const fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : null
    calls.push({ url, method, body })
    const json = (payload: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(payload), { status }))
    if (url.includes('/connections')) return json({ connections: [describeRestConnection('configured')] })
    if (url.includes('/video-generation-sessions/')) {
      if (method === 'PATCH') {
        if (body.expectedUpdatedAt !== stamp()) return json({ code: 'SESSION_VERSION_CONFLICT', error: 'conflict', session: session() }, 409)
        stored = body.workingState
        version += 1
        return json({ session: session() })
      }
      return json({ session: session() })
    }
    if (url.includes('/video-generations?sessionId=')) return json({ generations: [] })
    return json({})
  })
  return { fetchMock, calls, current: () => stored }
}

function mount() {
  const errors: Error[] = []
  render(
    <RecordingBoundary onError={(error) => errors.push(error)}>
      <GenerationSessionNavigationProvider><WorkspacePage /></GenerationSessionNavigationProvider>
    </RecordingBoundary>,
  )
  return errors
}

async function openModelMenu() {
  const trigger = await screen.findByTestId('video-model-select')
  fireEvent.keyDown(trigger, { key: 'Enter' })
  return trigger
}

async function chooseModel(label: string) {
  await openModelMenu()
  fireEvent.click(await screen.findByRole('option', { name: label }))
}

const patches = (calls: FetchCall[]) => calls.filter((call) => call.method === 'PATCH')

let restoreTimers: () => void
let server: ReturnType<typeof installServer>

beforeEach(() => {
  restoreTimers = installBrowserFaithfulTimers()
  // jsdom lacks the pointer/scroll APIs Radix Select calls while opening its menu.
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => undefined
  Element.prototype.releasePointerCapture ??= () => undefined
  Element.prototype.scrollIntoView ??= () => undefined
  server = installServer()
  global.fetch = server.fetchMock as unknown as typeof fetch
  mockRouter.push.mockReset()
  mockRouter.replace.mockReset()
})

afterEach(() => {
  cleanup()
  restoreTimers()
  vi.clearAllMocks()
})

// Four sequential 800ms debounces plus Radix menu work: give the file headroom under full-suite CPU load.
vi.setConfig({ testTimeout: 20_000 })

describe('GENERATION_WORKSPACE_INTERACTION_CRASH_V1 — Video Generation workspace mutations', () => {
  it('11/12. renders the workspace and opens the model dropdown with both Kling models', async () => {
    const errors = mount()
    await screen.findByDisplayValue('Initial prompt')
    expect(screen.getByTestId('video-model-select').textContent).toContain('Kling 3.0')
    await openModelMenu()
    expect(await screen.findByRole('option', { name: 'Kling 3.0' })).toBeTruthy()
    expect(await screen.findByRole('option', { name: 'Kling 2.6' })).toBeTruthy()
    expect(errors).toHaveLength(0)
  })

  it('13/14/15/18/19/23. Kling 3.0 → Kling 2.6 does not crash, reaches form state, autosaves, never generates', async () => {
    const errors = mount()
    await screen.findByDisplayValue('Initial prompt')

    await chooseModel('Kling 2.6')

    expect(screen.queryByTestId('error-boundary')).toBeNull()
    expect(errors).toHaveLength(0)
    await waitFor(() => expect(screen.getByTestId('video-model-select').textContent).toContain('Kling 2.6'))
    // Dirty (or already saving) immediately after the mutation — never the idle "saved" label, never a crash.
    expect(screen.queryByTestId('save-status-saved')).toBeNull()

    await waitFor(() => expect(patches(server.calls)).toHaveLength(1), { timeout: 3000 })
    const [patch] = patches(server.calls)
    expect(patch.body.workingState.selection.modelId).toBe('kling-v2-6')
    expect(patch.body.workingState.prompt).toBe('Initial prompt')
    expect(patch.body.expectedUpdatedAt).toBe('2026-10-08T12:00:00.000Z')
    await waitFor(() => expect(screen.getByTestId('save-status-saved')).toBeTruthy())

    // 19: the connection choice is untouched by a model change.
    expect(screen.getByRole('radio', { name: /Kling API/ }).getAttribute('aria-checked')).toBe('true')
    // 18: no provider/generation traffic.
    expect(server.calls.filter((call) => call.method === 'POST')).toHaveLength(0)
    expect(server.calls.some((call) => /video-generations(?!\?sessionId)/.test(call.url) && call.method !== 'GET')).toBe(false)
  })

  it('16/17. Kling 2.6 → Kling 3.0 restores the original model and prompt edits stay safe afterwards', async () => {
    const errors = mount()
    await screen.findByDisplayValue('Initial prompt')

    await chooseModel('Kling 2.6')
    await waitFor(() => expect(patches(server.calls)).toHaveLength(1), { timeout: 3000 })
    await waitFor(() => expect(screen.getByTestId('save-status-saved')).toBeTruthy())

    await chooseModel('Kling 3.0')
    await waitFor(() => expect(patches(server.calls)).toHaveLength(2), { timeout: 3000 })
    expect(patches(server.calls)[1].body.workingState.selection.modelId).toBe('kling-v3')
    expect(patches(server.calls)[1].body.expectedUpdatedAt).toBe('2026-10-08T12:00:01.000Z')
    await waitFor(() => expect(screen.getByTestId('save-status-saved')).toBeTruthy())

    const prompt = screen.getByDisplayValue('Initial prompt')
    fireEvent.change(prompt, { target: { value: 'Initial prompt + temp' } })
    await waitFor(() => expect(patches(server.calls)).toHaveLength(3), { timeout: 3000 })
    expect(patches(server.calls)[2].body.workingState.prompt).toBe('Initial prompt + temp')
    await waitFor(() => expect(screen.getByTestId('save-status-saved')).toBeTruthy())

    fireEvent.change(screen.getByDisplayValue('Initial prompt + temp'), { target: { value: 'Initial prompt' } })
    await waitFor(() => expect(patches(server.calls)).toHaveLength(4), { timeout: 3000 })
    expect(server.current()).toEqual(workingState())
    expect(screen.queryByTestId('error-boundary')).toBeNull()
    expect(errors).toHaveLength(0)
    expect(server.calls.filter((call) => call.method === 'POST')).toHaveLength(0)
  })

  it('20. an unsupported model value in a saved session degrades to a valid model instead of crashing', async () => {
    const stored = workingState({ modelId: 'kling-does-not-exist' })
    server.fetchMock.mockImplementation((input: unknown, init?: RequestInit) => {
      const url = String(input)
      const json = (payload: unknown) => Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }))
      if (url.includes('/connections')) return json({ connections: [describeRestConnection('configured')] })
      if (url.includes('/video-generation-sessions/') && (init?.method ?? 'GET') === 'GET') {
        return json({ session: { id: SESSION_ID, projectId: PROJECT_ID, productionId: PRODUCTION_ID, updatedAt: '2026-10-08T12:00:00.000Z', workingState: stored } })
      }
      if (url.includes('/video-generations?sessionId=')) return json({ generations: [] })
      return json({})
    })
    const errors = mount()
    await screen.findByTestId('video-model-select')
    expect(screen.getByTestId('video-model-select').textContent).toMatch(/Kling (3\.0|2\.6)/)
    expect(errors).toHaveLength(0)
  })
})
