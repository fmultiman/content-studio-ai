// @vitest-environment jsdom
import { Component, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, configure, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ImagesPageShell } from '@/app/(dashboard)/imagens/page'
import { GenerationSessionNavigationProvider } from '@/components/generation-session/session-navigation-guard'
import { installBrowserFaithfulTimers } from '@/lib/generation-session/__tests__/browser-timers'

// FUTURE-058 - the real /imagens shell with only network, auth/Supabase and router faked.
//
// The mock server mirrors the two server contracts that caused the defect:
//   * app/api/image-generation-sessions/[id] PATCH: `expectedRevision !== revision` -> 409 SESSION_VERSION_CONFLICT + session;
//   * lib/image-generation/execution.ts linkImageOutput: a completed generation advances the Session revision and sets the
//     output pointer WITHOUT telling the browser (OpenAI route and NanoBanana status sync alike).
// No provider is ever called.

const SESSION_ID = '00000000-0000-0000-0000-0000000000aa'
const PROJECT_ID = '00000000-0000-0000-0000-000000000010'
const PRODUCTION_ID = '00000000-0000-0000-0000-000000000020'
const DESCRIPTION = 'Uma montanha antiga ao amanhecer'
const GENERATED = 'An ancient mountain at dawn, golden mist, soft natural light, highly detailed.'

const ROUTER = { push: vi.fn(), replace: vi.fn() }
const PARAMS = { sessionId: SESSION_ID }
const SEARCH = new URLSearchParams()
vi.mock('next/navigation', () => ({ useRouter: () => ROUTER, useParams: () => PARAMS, useSearchParams: () => SEARCH }))
const toastMock = vi.hoisted(() => vi.fn())
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: toastMock }) }))

let settingsRow: Record<string, unknown> = { automation_enabled: false, default_image_model: 'gpt-image-2' }
const chainFor = (table: string) => {
  const chain: any = {
    select: () => chain, order: () => chain, eq: () => chain, in: () => chain,
    single: () => Promise.resolve({ data: table === 'user_settings' ? settingsRow : null, error: null }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
  }
  return chain
}
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: (t: string) => chainFor(t), auth: { getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } } }) } }) }))

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <div data-testid="error-boundary">crashed</div> : this.props.children }
}

type Call = { url: string; method: string; body: any; status?: number }

function installServer(options: { selectedModel?: string; providers?: Record<string, { status: string }> } = {}) {
  let revision = 4
  let stored = {
    workingPrompt: DESCRIPTION,
    workingState: {
      schemaVersion: 1, generatedPrompt: null, generatedPromptPt: null, promptDetails: null, autoMode: false,
      selectedModel: options.selectedModel ?? 'gpt-image-2', imageStatus: 'draft', currentAttempt: 1, currentImageId: null as string | null,
      sourceReferences: [], generationConfig: { size: '1024x1024', quality: 'medium', aspectRatio: '1:1', style: null, providerOptions: {} }, legacyImageUrl: null,
    } as Record<string, any>,
  }
  let extraBumpsOnPatch = 0
  const calls: Call[] = []
  const imageResolvers: Array<() => void> = []
  const assistanceResolvers: Array<() => void> = []
  const session = () => ({ id: SESSION_ID, projectId: PROJECT_ID, productionId: PRODUCTION_ID, currentImageId: stored.workingState.currentImageId, revision, workingPrompt: stored.workingPrompt, workingState: stored.workingState, legacyCurrentEvaluation: null })
  // linkImageOutput: advance the revision and set the output pointer. The browser is not told.
  const linkOutput = (id: string) => { revision += 1; stored = { ...stored, workingState: { ...stored.workingState, currentImageId: id, imageStatus: 'draft' } } }
  const fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : null
    const call: Call = { url, method, body }
    calls.push(call)
    const json = (payload: unknown, status = 200) => { call.status = status; return Promise.resolve(new Response(JSON.stringify(payload), { status })) }
    if (url === '/api/prompt-assistance') {
      return new Promise<Response>((resolve) => assistanceResolvers.push(() => resolve(new Response(JSON.stringify({ suggestedPrompt: GENERATED, provider: 'openai', model: 'gpt-4o-mini', operation: 'create', usage: null }), { status: 200 }))))
    }
    if (url === '/api/openai/generate-image') {
      return new Promise<Response>((resolve) => imageResolvers.push(() => {
        linkOutput('img-openai')
        resolve(new Response(JSON.stringify({ imageUrl: 'https://img.test/o.png', image: { id: 'img-openai' }, attemptId: 'att-o' }), { status: 200 }))
      }))
    }
    if (url === '/api/nanobanana/generate') return json({ taskId: 'task-1' })
    if (url.startsWith('/api/nanobanana/status/')) {
      linkOutput('img-nano') // syncNanoImageAttempt -> linkImageOutput on completion
      return json({ status: 'completed', imageUrl: 'https://img.test/n.png', image: { id: 'img-nano' } })
    }
    if (url.startsWith(`/api/image-generation-sessions/${SESSION_ID}`)) {
      if (method === 'PATCH') {
        if (extraBumpsOnPatch > 0) { extraBumpsOnPatch -= 1; revision += 1 } // a server-owned write racing THIS save
        if (body.expectedRevision !== revision) return json({ error: 'conflict', code: 'SESSION_VERSION_CONFLICT', session: session() }, 409)
        stored = { workingPrompt: body.workingPrompt, workingState: body.workingState }
        revision += 1
        return json({ session: session() })
      }
      return json({ session: session() })
    }
    if (url.startsWith('/api/image-generation-attempts')) return json({ attempts: [] })
    if (url.startsWith('/api/image-generation-sessions')) return json({ sessions: [] })
    if (url.startsWith('/api/image-drafts')) return json({ drafts: [] })
    if (url.startsWith('/api/settings/providers')) return json({ providers: options.providers ?? { openai: { status: 'configured' } } })
    if (url.startsWith('/api/productions/')) return json({ production: { title: 'Criação', project_id: PROJECT_ID } })
    return json({})
  })
  const to = (url: string, method?: string) => calls.filter((c) => c.url === url && (!method || c.method === method))
  return {
    fetchMock, calls,
    patches: () => calls.filter((c) => c.method === 'PATCH'),
    providerCalls: () => calls.filter((c) => c.method === 'POST' && /prompt-assistance|generate-image|nanobanana\/generate/.test(c.url)),
    imageCalls: () => to('/api/openai/generate-image', 'POST'),
    nanoCalls: () => to('/api/nanobanana/generate', 'POST'),
    assistanceCalls: () => to('/api/prompt-assistance', 'POST'),
    completeImage: () => imageResolvers.shift()!(),
    completeAssistance: () => assistanceResolvers.shift()!(),
    stored: () => stored,
    revision: () => revision,
    /** Another writer changes an AUTHORED field. */
    anotherTabEdits: (prompt: string) => { stored = { ...stored, workingPrompt: prompt }; revision += 1 },
    raceNextPatches: (n: number) => { extraBumpsOnPatch = n },
  }
}

let restoreTimers: () => void
let server: ReturnType<typeof installServer>

function mount(options: Parameters<typeof installServer>[0] = {}, keepServer = false) {
  if (!keepServer) server = installServer(options)
  global.fetch = server.fetchMock as unknown as typeof fetch
  render(<Boundary><GenerationSessionNavigationProvider><ImagesPageShell canonicalSessionId={SESSION_ID} /></GenerationSessionNavigationProvider></Boundary>)
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  restoreTimers = installBrowserFaithfulTimers()
  configure({ asyncUtilTimeout: 6000 })
  settingsRow = { automation_enabled: false, default_image_model: 'gpt-image-2' }
  toastMock.mockClear()
})
afterEach(() => { cleanup(); restoreTimers(); vi.clearAllMocks() })
vi.setConfig({ testTimeout: 40_000 })

const status = () => document.querySelector('[data-testid^="save-status-"]')?.getAttribute('data-testid')
const editor = () => document.getElementById('generated-prompt') as HTMLTextAreaElement
const description = () => screen.findByDisplayValue(DESCRIPTION) as Promise<HTMLTextAreaElement>
// Stable handle for the description field once its value has been edited.
const descField = () => screen.getByRole('textbox', { name: 'Sua descrição' }) as HTMLTextAreaElement
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const createImage = () => screen.getByRole('button', { name: /Criar Imagem|Criando/ }) as HTMLButtonElement

async function generateManually(prompt: string, kind: 'openai' | 'nano') {
  await description()
  await waitFor(() => expect(screen.getByTestId('workflow-mode-manual')).toBeTruthy())
  fireEvent.click(screen.getByTestId('workflow-mode-manual'))
  fireEvent.change(editor(), { target: { value: prompt } })
  await waitFor(() => expect(createImage().disabled).toBe(false))
  fireEvent.click(createImage())
  if (kind === 'openai') {
    await waitFor(() => expect(server.imageCalls()).toHaveLength(1))
    server.completeImage()
  } else {
    await waitFor(() => expect(server.nanoCalls()).toHaveLength(1))
  }
  await waitFor(() => expect(screen.getByText('Gerar Novamente')).toBeTruthy())
  await waitFor(() => expect(status()).toBe('save-status-saved'))
}

describe.each([
  ['OpenAI', 'openai', {}],
  ['NanoBanana', 'nano', { selectedModel: 'nanobanana-v2', providers: { openai: { status: 'configured' }, nano_banana: { status: 'configured' } } }],
] as const)('post-generation autosave — %s success path', (_label, kind, serverOptions) => {
  it('the first edit after a generation persists on its own (benign 409 reconciled, one retry), without any provider call or user action', async () => {
    mount(serverOptions)
    await generateManually('a first authored prompt', kind)
    const generated = server.providerCalls().length
    const patchesBefore = server.patches().length
    expect(server.revision()).toBeGreaterThan(server.patches().at(-1)!.body.expectedRevision + 1) // the server moved on; the browser was not told

    fireEvent.change(descField(), { target: { value: `${DESCRIPTION} - edited after generation` } })
    await waitFor(() => expect(server.stored().workingPrompt).toContain('edited after generation'), { timeout: 6000 })
    await waitFor(() => expect(status()).toBe('save-status-saved'))

    const newPatches = server.patches().slice(patchesBefore)
    expect(newPatches.map((p) => p.status)).toEqual([409, 200]) // exactly one automatic retry
    expect(newPatches[1].body.expectedRevision).toBeGreaterThan(newPatches[0].body.expectedRevision) // with the adopted revision
    expect(newPatches[1].body.workingPrompt).toBe(newPatches[0].body.workingPrompt) // the SAME snapshot
    expect(screen.queryByTestId('save-status-conflict')).toBeNull()
    expect(server.providerCalls()).toHaveLength(generated) // reconciliation caused no provider request
    expect(kind === 'openai' ? server.imageCalls() : server.nanoCalls()).toHaveLength(1)
  })

  it('a following edit saves normally (single PATCH) and "edit prompt then generate again" is no longer refused', async () => {
    mount(serverOptions)
    await generateManually('prompt one', kind)
    fireEvent.change(descField(), { target: { value: `${DESCRIPTION} - edit 1` } })
    await waitFor(() => expect(status()).toBe('save-status-saved'))
    await waitFor(() => expect(server.stored().workingPrompt).toContain('edit 1'))
    const patchesAfterFirst = server.patches().length

    fireEvent.change(descField(), { target: { value: `${DESCRIPTION} - edit 2` } })
    await waitFor(() => expect(server.stored().workingPrompt).toContain('edit 2'))
    expect(server.patches().slice(patchesAfterFirst).map((p) => p.status)).toEqual([200]) // token stayed in sync: no further 409

    // refine the prompt and generate again: the pre-submit save must succeed and the second request must be sent
    fireEvent.change(editor(), { target: { value: 'a refined prompt after the first image' } })
    await waitFor(() => expect(createImage().disabled).toBe(false))
    fireEvent.click(createImage())
    if (kind === 'openai') {
      await waitFor(() => expect(server.imageCalls()).toHaveLength(2))
      expect(server.imageCalls()[1].body.prompt).toBe('a refined prompt after the first image')
      server.completeImage()
    } else {
      await waitFor(() => expect(server.nanoCalls()).toHaveLength(2))
      expect(server.nanoCalls()[1].body.prompt).toBe('a refined prompt after the first image')
    }
    expect(toastMock.mock.calls.some((c) => /conflito de salvamento/.test(String(c[0]?.description)))).toBe(false)
    expect(screen.queryByTestId('save-status-conflict')).toBeNull()
  })

  it('an acknowledged post-generation save survives reload / navigation: a fresh mount shows the persisted edit', async () => {
    mount(serverOptions)
    await generateManually('prompt before reload', kind)
    fireEvent.change(descField(), { target: { value: `${DESCRIPTION} - saved before reload` } })
    await waitFor(() => expect(status()).toBe('save-status-saved'))
    await waitFor(() => expect(server.stored().workingPrompt).toContain('saved before reload'))
    cleanup() // leave the workspace
    mount(serverOptions, true)
    expect(await screen.findByDisplayValue(`${DESCRIPTION} - saved before reload`)).toBeTruthy()
    expect(screen.queryByTestId('save-status-conflict')).toBeNull()
  })
})

describe('post-generation autosave — real conflicts and the retry limit stay visible', () => {
  it('a genuine authored divergence is NOT auto-merged: conflict shown, one PATCH, server value intact, "Manter minhas alterações" recovers', async () => {
    mount()
    await generateManually('a prompt', 'openai')
    server.anotherTabEdits('changed by another tab')
    const patchesBefore = server.patches().length
    fireEvent.change(descField(), { target: { value: `${DESCRIPTION} - my local edit` } })
    await waitFor(() => expect(status()).toBe('save-status-conflict'))
    expect(server.patches().slice(patchesBefore).map((p) => p.status)).toEqual([409])
    expect(server.stored().workingPrompt).toBe('changed by another tab') // never silently overwritten
    expect(descField().value).toContain('my local edit') // local edit preserved

    fireEvent.click(screen.getByRole('button', { name: /Manter minhas alterações/ }))
    await waitFor(() => expect(status()).toBe('save-status-saved'))
    expect(server.stored().workingPrompt).toContain('my local edit')
  })

  it('if the single automatic retry also receives 409 the conflict is surfaced after exactly two PATCHes (no loop)', async () => {
    mount()
    await generateManually('a prompt', 'openai')
    const patchesBefore = server.patches().length
    server.raceNextPatches(2)
    fireEvent.change(descField(), { target: { value: `${DESCRIPTION} - racing edit` } })
    await waitFor(() => expect(status()).toBe('save-status-conflict'))
    await wait(2500)
    expect(server.patches().slice(patchesBefore).map((p) => p.status)).toEqual([409, 409])
    expect(descField().value).toContain('racing edit')
  })
})

describe('post-generation autosave — Automatic workflow semantics are unchanged', () => {
  it('one text call + one image submission, and the first edit after the automatic run persists', async () => {
    settingsRow = { automation_enabled: true, default_image_model: 'gpt-image-2' }
    mount()
    await description()
    await waitFor(() => expect((screen.getByTestId('workflow-mode-automatic') as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByTestId('workflow-mode-automatic'))
    fireEvent.click(await screen.findByTestId('automatic-run-start'))
    await waitFor(() => expect(server.assistanceCalls()).toHaveLength(1))
    server.completeAssistance()
    await waitFor(() => expect(server.imageCalls()).toHaveLength(1))
    expect(server.imageCalls()[0].body.prompt).toBe(GENERATED)
    server.completeImage()
    await waitFor(() => expect(screen.getByText('Gerar Novamente')).toBeTruthy())
    await waitFor(() => expect(status()).toBe('save-status-saved'))

    fireEvent.change(await screen.findByDisplayValue(DESCRIPTION), { target: { value: `${DESCRIPTION} - after the automatic run` } })
    await waitFor(() => expect(server.stored().workingPrompt).toContain('after the automatic run'), { timeout: 6000 })
    await waitFor(() => expect(status()).toBe('save-status-saved'))
    expect(screen.queryByTestId('save-status-conflict')).toBeNull()
    expect(server.assistanceCalls()).toHaveLength(1)
    expect(server.imageCalls()).toHaveLength(1)
  })
})
