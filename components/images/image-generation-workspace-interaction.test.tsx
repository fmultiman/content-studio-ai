// @vitest-environment jsdom
import { Component, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ImagesPageShell } from '@/app/(dashboard)/imagens/page'
import { GenerationSessionNavigationProvider } from '@/components/generation-session/session-navigation-guard'
import { installBrowserFaithfulTimers } from '@/lib/generation-session/__tests__/browser-timers'

// GENERATION_WORKSPACE_INTERACTION_CRASH_V1 — Image side.
// Typing a single character into the prompt of /imagens/geracoes/[sessionId] fell into the Next.js error
// boundary ("This page couldn’t load") because the shared autosave controller called a detached
// `setTimeout`. The real shell is rendered here with only network, auth/Supabase and router faked, and the
// global timers behave like a browser's (receiver-checked).

const SESSION_ID = '00000000-0000-0000-0000-0000000000aa'
const PROJECT_ID = '00000000-0000-0000-0000-000000000010'
const PRODUCTION_ID = '00000000-0000-0000-0000-000000000020'

const mockRouter = { push: vi.fn(), replace: vi.fn() }
// Next returns a referentially stable object; the page's load effect depends on it.
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
    auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
  }),
}))

class RecordingBoundary extends Component<{ children: ReactNode; onError: (error: Error) => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error) { this.props.onError(error) }
  render() { return this.state.failed ? <div data-testid="error-boundary">This page couldn’t load</div> : this.props.children }
}

const ORIGINAL_PROMPT = 'Uma montanha antiga'

type FetchCall = { url: string; method: string; body: any }

function installServer() {
  let revision = 4
  let stored: any = {
    workingPrompt: ORIGINAL_PROMPT,
    workingState: {
      schemaVersion: 1, generatedPrompt: null, generatedPromptPt: null, promptDetails: null, autoMode: false,
      selectedModel: 'gpt-image-2', imageStatus: 'draft', currentAttempt: 1, currentImageId: null,
      sourceReferences: [], generationConfig: { size: '1024x1024', quality: 'medium', aspectRatio: '1:1', style: null, providerOptions: {} },
      legacyImageUrl: null,
    },
  }
  const calls: FetchCall[] = []
  const session = () => ({
    id: SESSION_ID, projectId: PROJECT_ID, productionId: PRODUCTION_ID, currentImageId: null,
    revision, workingPrompt: stored.workingPrompt, workingState: stored.workingState, legacyCurrentEvaluation: null,
  })
  const fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : null
    calls.push({ url, method, body })
    const json = (payload: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(payload), { status }))
    if (url.startsWith(`/api/image-generation-sessions/${SESSION_ID}`)) {
      if (method === 'PATCH') {
        if (body.expectedRevision !== revision) return json({ code: 'SESSION_REVISION_CONFLICT', error: 'conflict', session: session() }, 409)
        stored = { workingPrompt: body.workingPrompt, workingState: body.workingState }
        revision += 1
        return json({ session: session() })
      }
      return json({ session: session() })
    }
    if (url.startsWith('/api/image-generation-attempts')) return json({ attempts: [] })
    if (url.startsWith('/api/image-generation-sessions')) return json({ sessions: [] })
    if (url.startsWith('/api/image-drafts')) return json({ drafts: [] })
    if (url.startsWith('/api/settings/providers')) return json({ providers: {} })
    if (url.startsWith('/api/productions/')) return json({ production: { title: 'Criação de vídeo', project_id: PROJECT_ID } })
    return json({})
  })
  return { fetchMock, calls, current: () => stored, revision: () => revision }
}

function mount() {
  const errors: Error[] = []
  render(
    <RecordingBoundary onError={(error) => errors.push(error)}>
      <GenerationSessionNavigationProvider><ImagesPageShell canonicalSessionId={SESSION_ID} /></GenerationSessionNavigationProvider>
    </RecordingBoundary>,
  )
  return errors
}

const patches = (calls: FetchCall[]) => calls.filter((call) => call.method === 'PATCH')
const FORBIDDEN = /\/api\/(openai\/generate-image|nanobanana|reviews\/image|evaluate-image|prompts\/generate-image-prompt|prompts\/translate)/

let restoreTimers: () => void
let server: ReturnType<typeof installServer>

beforeEach(() => {
  restoreTimers = installBrowserFaithfulTimers()
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

vi.setConfig({ testTimeout: 20_000 })

const promptField = () => screen.findByDisplayValue(ORIGINAL_PROMPT) as Promise<HTMLTextAreaElement>

describe('GENERATION_WORKSPACE_INTERACTION_CRASH_V1 — Image Generation workspace prompt editing', () => {
  it('1/2/4/5/6/9/10. the first typed character does not crash, marks dirty, autosaves the prompt and returns to saved', async () => {
    const errors = mount()
    const field = await promptField()
    expect(screen.getByTestId('save-status-saved')).toBeTruthy()

    fireEvent.change(field, { target: { value: `${ORIGINAL_PROMPT}x` } })

    expect(screen.queryByTestId('error-boundary')).toBeNull()
    expect(errors).toHaveLength(0)
    expect((screen.getByDisplayValue(`${ORIGINAL_PROMPT}x`) as HTMLTextAreaElement).value).toBe(`${ORIGINAL_PROMPT}x`)
    expect(screen.queryByTestId('save-status-saved')).toBeNull()

    await waitFor(() => expect(patches(server.calls)).toHaveLength(1), { timeout: 3000 })
    const [patch] = patches(server.calls)
    expect(patch.body.workingPrompt).toBe(`${ORIGINAL_PROMPT}x`)
    expect(patch.body.expectedRevision).toBe(4)
    await waitFor(() => expect(screen.getByTestId('save-status-saved')).toBeTruthy())
    expect(server.current().workingPrompt).toBe(`${ORIGINAL_PROMPT}x`)

    // 9 + 10: editing never reaches a provider, the Review service, or navigation.
    expect(server.calls.filter((call) => FORBIDDEN.test(call.url))).toHaveLength(0)
    expect(server.calls.filter((call) => call.method === 'POST')).toHaveLength(0)
    expect(mockRouter.push).not.toHaveBeenCalled()
    expect(mockRouter.replace).not.toHaveBeenCalled()
  })

  it('3/7. several characters and rapid edits keep the newest value and coalesce saves', async () => {
    const errors = mount()
    const field = await promptField()
    let value = ORIGINAL_PROMPT
    for (const ch of ' sagrada') {
      value += ch
      fireEvent.change(field, { target: { value } })
    }
    expect(errors).toHaveLength(0)
    expect(screen.queryByTestId('error-boundary')).toBeNull()

    await waitFor(() => expect(screen.getByTestId('save-status-saved')).toBeTruthy(), { timeout: 4000 })
    expect(patches(server.calls).length).toBeGreaterThanOrEqual(1)
    expect(patches(server.calls).length).toBeLessThan(' sagrada'.length)
    expect(patches(server.calls).at(-1)?.body.workingPrompt).toBe(`${ORIGINAL_PROMPT} sagrada`)
    expect(server.current().workingPrompt).toBe(`${ORIGINAL_PROMPT} sagrada`)
    expect(screen.getByDisplayValue(`${ORIGINAL_PROMPT} sagrada`)).toBeTruthy()
  })

  it('8. deleting the whole prompt is safe and persisted, then the original is restored exactly', async () => {
    const errors = mount()
    const field = await promptField()

    fireEvent.change(field, { target: { value: '' } })
    expect(screen.queryByTestId('error-boundary')).toBeNull()
    await waitFor(() => expect(patches(server.calls)).toHaveLength(1), { timeout: 3000 })
    expect(patches(server.calls)[0].body.workingPrompt).toBe('')
    await waitFor(() => expect(screen.getByTestId('save-status-saved')).toBeTruthy())

    fireEvent.change(document.querySelector('textarea') as HTMLTextAreaElement, { target: { value: ORIGINAL_PROMPT } })
    await waitFor(() => expect(patches(server.calls)).toHaveLength(2), { timeout: 3000 })
    expect(patches(server.calls)[1].body.expectedRevision).toBe(5)
    await waitFor(() => expect(screen.getByTestId('save-status-saved')).toBeTruthy())
    expect(server.current().workingPrompt).toBe(ORIGINAL_PROMPT)
    expect(errors).toHaveLength(0)
    expect(server.calls.filter((call) => FORBIDDEN.test(call.url))).toHaveLength(0)
  })

  it('22. a revision conflict is reported as a conflict, not a crash', async () => {
    const errors = mount()
    const field = await promptField()
    const original = server.fetchMock.getMockImplementation()!
    server.fetchMock.mockImplementation((input: unknown, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'PATCH') {
        return Promise.resolve(new Response(JSON.stringify({ code: 'SESSION_REVISION_CONFLICT', error: 'conflict' }), { status: 409 }))
      }
      return original(input, init)
    })
    fireEvent.change(field, { target: { value: `${ORIGINAL_PROMPT}!` } })
    await waitFor(() => expect(screen.getByTestId('save-status-conflict')).toBeTruthy(), { timeout: 3000 })
    expect(screen.queryByTestId('error-boundary')).toBeNull()
    expect(errors).toHaveLength(0)
  })
})
