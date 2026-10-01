// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { normalizeKlingMcpVideoCapabilities } from '@/lib/provider-connections/kling-mcp-video-capabilities'
import { whoAmIFixture } from '@/lib/__tests__/helpers/kling-who-am-i-fixture'
import { describeMcpConnection, describeRestConnection } from '@/lib/video-generation/connections'
import type { VideoGenerationConnectionDescriptor } from '@/lib/video-generation/capabilities'
import type { ProviderConnectionRow } from '@/lib/provider-connections/types'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        neq: () => chain,
        order: () => chain,
        limit: () => Promise.resolve({ data: [{ id: 'img-1', image_url: 'https://img.example.test/a.png', user_input: 'A fox' }] }),
      }
      return chain
    },
  }),
}))

import { CreateVideoGenerationDialog } from './create-video-generation-dialog'

const MCP_ID = '11111111-1111-4111-8111-111111111111'
const NOW = new Date()

function mcpDescriptor(scopes: string[], overrides: Partial<ProviderConnectionRow> = {}): VideoGenerationConnectionDescriptor {
  const row: ProviderConnectionRow = {
    id: MCP_ID,
    user_id: 'u',
    provider: 'kling',
    connection_method: 'mcp_oauth',
    status: 'connected',
    scopes,
    external_account_id: null,
    capabilities: { membership: { label: 'Pro' }, video: normalizeKlingMcpVideoCapabilities(whoAmIFixture()) },
    last_checked_at: NOW.toISOString(),
    last_error_code: null,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    ...overrides,
  }
  return describeMcpConnection(row, NOW)
}

const GENERATION_SCOPES = ['generation.read', 'account.credit.read', 'generation.create']
const READ_ONLY_SCOPES = ['generation.read', 'account.credit.read']

let connectionsPayload: { connections: VideoGenerationConnectionDescriptor[] } | { status: number }
const fetchMock = vi.fn()

beforeAll(() => {
  // Radix Select/Tabs need a few DOM APIs jsdom does not implement.
  const proto = window.HTMLElement.prototype as any
  proto.hasPointerCapture ??= () => false
  proto.setPointerCapture ??= () => undefined
  proto.releasePointerCapture ??= () => undefined
  proto.scrollIntoView ??= () => undefined
  ;(window as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }
})

beforeEach(() => {
  vi.clearAllMocks()
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/video-generations/connections') {
      if ('status' in connectionsPayload) return new Response('{}', { status: connectionsPayload.status })
      return new Response(JSON.stringify(connectionsPayload), { status: 200 })
    }
    if (url === '/api/video-generations' && init?.method === 'POST') return new Response(JSON.stringify({ generation: { id: 'g1' } }), { status: 200 })
    return new Response('{}', { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const openSelect = (trigger: HTMLElement) => {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' })
}

async function selectOption(triggerTestId: string, optionName: RegExp | string) {
  openSelect(screen.getByTestId(triggerTestId))
  const option = await screen.findByRole('option', { name: optionName })
  fireEvent.pointerUp(option, { button: 0, pointerType: 'mouse' })
  fireEvent.click(option)
}

const chooseConnection = (transport: 'api' | 'mcp') => {
  fireEvent.click(screen.getByTestId(`video-connection-option-${transport}`))
}

const renderDialog = () =>
  render(<CreateVideoGenerationDialog open onOpenChange={() => undefined} projectId="proj-1" productionId="prod-1" />)

const submittedBody = () => {
  const call = fetchMock.mock.calls.find(([url, init]) => url === '/api/video-generations' && init?.method === 'POST')
  return call ? JSON.parse(call[1].body as string) : null
}

describe('CreateVideoGenerationDialog — connection-driven generation form', () => {
  it('shows a loading state, then Kling API selected by default with its funding disclosure (REST stays the default)', async () => {
    connectionsPayload = { connections: [describeRestConnection('configured'), mcpDescriptor(GENERATION_SCOPES)] }
    renderDialog()

    expect(screen.getByTestId('video-connections-loading')).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('video-connection-toggle')).toBeTruthy())

    expect(screen.getByTestId('video-connection-option-api').getAttribute('aria-checked')).toBe('true')
    // The standalone "Conexão" dropdown is gone; funding is truthful.
    expect(screen.getByTestId('video-connection-detail').textContent).toMatch(/pacote de recursos da sua API Kling/)
    expect(screen.queryByTestId('video-connection-blocked')).toBeNull()
    expect(screen.getByTestId('generate-video').hasAttribute('disabled')).toBe(false)
  })

  it('REST controls are exactly what REST supports: two durations, two resolutions, audio, multi-shot, and aspect only for text', async () => {
    connectionsPayload = { connections: [describeRestConnection('configured')] }
    renderDialog()
    await waitFor(() => expect(screen.getByTestId('video-model-select')).toBeTruthy())

    // Default operation is image_to_video → no aspect-ratio control.
    expect(screen.queryByTestId('video-aspect-select')).toBeNull()
    expect(screen.getByTestId('video-audio-select')).toBeTruthy()
    expect(screen.getByTestId('video-multishot-select')).toBeTruthy()
    expect(screen.getByTestId('video-model-select').textContent).toContain('Kling 3.0')

    fireEvent.mouseDown(screen.getByTestId('operation-text_to_video'))
    fireEvent.click(screen.getByTestId('operation-text_to_video'))
    await waitFor(() => expect(screen.getByTestId('video-aspect-select')).toBeTruthy())

    openSelect(screen.getByTestId('video-duration-select'))
    const options = (await screen.findAllByRole('option')).map((option) => option.textContent)
    expect(options).toEqual(['5 segundos', '10 segundos'])
  })

  it('REST multi-model capabilities: Kling 3.0 exposes multi-shot, Kling 2.6 does not, switching models clears and keeps false on return', async () => {
    connectionsPayload = { connections: [describeRestConnection('configured')] }
    renderDialog()
    await waitFor(() => expect(screen.getByTestId('video-model-select')).toBeTruthy())

    // 1. Initial REST default is Kling 3.0 -> multi-shot is available
    expect(screen.getByTestId('video-model-select').textContent).toContain('Kling 3.0')
    expect(screen.getByTestId('video-multishot-select')).toBeTruthy()
    expect(screen.getByTestId('video-model-summary').textContent).toContain('multi-shot')

    // Turn multi-shot ON for Kling 3.0
    await selectOption('video-multishot-select', 'Ligado (multi-shot)')
    expect(screen.getByTestId('video-multishot-select').textContent).toContain('Ligado (multi-shot)')

    // 2. Switch to Kling 2.6 -> multi-shot select disappears and note is shown
    await selectOption('video-model-select', 'Kling 2.6')
    await waitFor(() => expect(screen.queryByTestId('video-multishot-select')).toBeNull())
    expect(screen.getByTestId('video-multishot-unsupported-note').textContent).toMatch(/Kling 2.6 não oferece Multi-shot/)
    expect(screen.getByTestId('video-model-summary').textContent).not.toContain('multi-shot')

    // 3. Switch back to Kling 3.0 -> multi-shot reappears, but value is Desligado (not kept true)
    await selectOption('video-model-select', 'Kling 3.0')
    await waitFor(() => expect(screen.getByTestId('video-multishot-select')).toBeTruthy())
    expect(screen.getByTestId('video-multishot-select').textContent).toContain('Desligado')
  })

  it('switching to the MCP account updates models and controls from ITS capabilities; unsupported controls disappear', async () => {
    connectionsPayload = { connections: [describeRestConnection('configured'), mcpDescriptor(GENERATION_SCOPES)] }
    renderDialog()
    await waitFor(() => expect(screen.getByTestId('video-connection-toggle')).toBeTruthy())

    chooseConnection('mcp')

    await waitFor(() => expect(screen.getByTestId('video-connection-detail').textContent).toMatch(/créditos da sua conta Kling/))
    await waitFor(() => expect(screen.getByTestId('video-model-select').textContent).toContain('Kling 3.0'))

    // The model list is the account's (I2V exposes only single-source models).
    openSelect(screen.getByTestId('video-model-select'))
    const models = (await screen.findAllByRole('option')).map((option) => option.textContent)
    expect(models).toEqual(['Kling 2.5', 'Kling 2.6', 'Kling 3.0', 'Kling 3.0 Turbo'])
  })

  it('a model-specific control disappears when the model lacks it (Turbo has no audio / multi-shot) and values reset truthfully', async () => {
    connectionsPayload = { connections: [mcpDescriptor(GENERATION_SCOPES)] }
    renderDialog()
    await waitFor(() => expect(screen.getByTestId('video-model-select')).toBeTruthy())
    expect(screen.getByTestId('video-audio-select')).toBeTruthy()
    expect(screen.getByTestId('video-multishot-select')).toBeTruthy()

    await selectOption('video-model-select', 'Kling 3.0 Turbo')

    await waitFor(() => expect(screen.queryByTestId('video-audio-select')).toBeNull())
    expect(screen.queryByTestId('video-multishot-select')).toBeNull()
    // Explicit defaults are what is shown.
    expect(screen.getByTestId('video-resolution-select').textContent).toContain('720p')
    expect(screen.getByTestId('video-duration-select').textContent).toContain('5 segundos')
  })

  it('submits ONLY the visible controls, with explicit values and the selected connection reference', async () => {
    connectionsPayload = { connections: [describeRestConnection('configured'), mcpDescriptor(GENERATION_SCOPES)] }
    renderDialog()
    await waitFor(() => expect(screen.getByTestId('video-connection-toggle')).toBeTruthy())
    chooseConnection('mcp')
    await waitFor(() => expect(screen.getByTestId('video-connection-detail').textContent).toMatch(/créditos/))

    fireEvent.mouseDown(screen.getByTestId('operation-text_to_video'))
    fireEvent.click(screen.getByTestId('operation-text_to_video'))
    await selectOption('video-model-select', 'Kling 3.0 Turbo')
    await waitFor(() => expect(screen.queryByTestId('video-audio-select')).toBeNull())

    fireEvent.change(screen.getByPlaceholderText(/Descreva a cena/), { target: { value: 'a red fox' } })
    fireEvent.click(screen.getByTestId('generate-video'))

    await waitFor(() => expect(submittedBody()).not.toBeNull())
    const body = submittedBody()
    expect(body).toMatchObject({
      projectId: 'proj-1',
      productionId: 'prod-1',
      connectionRef: `kling:account:${MCP_ID}`,
      mode: 'text_to_video',
      model: 'kling-video-v3_0_turbo',
      prompt: 'a red fox',
      duration: 5,
      resolution: '720p',
      aspect_ratio: '16:9',
    })
    // Hidden controls are never submitted, and the client never sends transport/credit/execution fields.
    for (const forbidden of ['audio', 'multi_shot', 'transport', 'executionMode', 'connection_id', 'provider']) expect(body).not.toHaveProperty(forbidden)
  })

  it('a read-only account can be explored but generation is disabled, with a truthful authorization CTA', async () => {
    connectionsPayload = { connections: [mcpDescriptor(READ_ONLY_SCOPES)] }
    renderDialog()
    await waitFor(() => expect(screen.getByTestId('video-connection-blocked')).toBeTruthy())

    const blocked = screen.getByTestId('video-connection-blocked')
    expect(blocked.getAttribute('data-reason')).toBe('generation_authorization_required')
    expect(blocked.textContent).toMatch(/somente leitura/)
    expect(screen.getByTestId('authorize-generation')).toBeTruthy()
    expect(screen.getByTestId('generate-video').hasAttribute('disabled')).toBe(true)
    // Models are still listed for exploration.
    expect(screen.getByTestId('video-model-select').textContent).toContain('Kling 3.0')
  })

  it('the authorization CTA starts the generation-intent flow ONLY when clicked, and never merely by selecting the connection', async () => {
    connectionsPayload = { connections: [describeRestConnection('configured'), mcpDescriptor(READ_ONLY_SCOPES)] }
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/video-generations/connections') return new Response(JSON.stringify(connectionsPayload), { status: 200 })
      if (url === '/api/provider-connections/kling/mcp/connect') return new Response(JSON.stringify({ authorizationUrl: 'https://kling.ai/auth/authorize?state=abc' }), { status: 200 })
      return new Response('{}', { status: 200 })
    })
    renderDialog()
    await waitFor(() => expect(screen.getByTestId('video-connection-toggle')).toBeTruthy())

    chooseConnection('mcp')
    await waitFor(() => expect(screen.getByTestId('authorize-generation')).toBeTruthy())
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/provider-connections/kling/mcp/connect')).toBe(false)
    expect(assign).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('authorize-generation'))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://kling.ai/auth/authorize?state=abc'))
    const connectCall = fetchMock.mock.calls.find(([url]) => url === '/api/provider-connections/kling/mcp/connect')!
    expect(JSON.parse(connectCall[1].body)).toEqual({ intent: 'generation' })
  })

  it('REST generation stays enabled when configured, even if the account connection is read-only', async () => {
    connectionsPayload = { connections: [describeRestConnection('configured'), mcpDescriptor(READ_ONLY_SCOPES)] }
    renderDialog()
    await waitFor(() => expect(screen.getByTestId('video-connection-toggle')).toBeTruthy())
    expect(screen.getByTestId('generate-video').hasAttribute('disabled')).toBe(false)
    expect(screen.queryByTestId('video-connection-blocked')).toBeNull()
  })

  it('Kling API not configured: explains how to configure it instead of showing "no models"', async () => {
    connectionsPayload = { connections: [describeRestConnection('missing')] }
    renderDialog()
    await waitFor(() => expect(screen.getByTestId('video-connection-blocked')).toBeTruthy())
    expect(screen.getByTestId('video-connection-blocked').getAttribute('data-reason')).toBe('not_configured')
    expect(screen.queryByTestId('video-model-select')).toBeNull()
    expect(screen.getByTestId('generate-video').hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /Abrir Configurações/ }))
    expect(push).toHaveBeenCalledWith('/configuracoes?tab=api')
  })

  it.each([
    ['capabilities_missing', { capabilities: {} }, /Capacidades ainda não carregadas/, 'refresh-capabilities'],
    ['authorization_required', { status: 'authorization_required' as const }, /Reautorização necessária/, null],
    ['connection_error', { status: 'error' as const }, /Erro na conexão/, null],
  ])('%s is shown as its own truth', async (reason, overrides, copy, actionTestId) => {
    connectionsPayload = { connections: [mcpDescriptor(GENERATION_SCOPES, overrides as Partial<ProviderConnectionRow>)] }
    renderDialog()
    await waitFor(() => expect(screen.getByTestId('video-connection-blocked')).toBeTruthy())
    expect(screen.getByTestId('video-connection-blocked').getAttribute('data-reason')).toBe(reason)
    expect(screen.getByTestId('video-connection-blocked').textContent).toMatch(copy)
    if (actionTestId) expect(screen.getByTestId(actionTestId)).toBeTruthy()
    expect(screen.getByTestId('generate-video').hasAttribute('disabled')).toBe(true)
  })

  it('a capability-load FAILURE is not presented as "no connections" or "no models" and offers a retry', async () => {
    connectionsPayload = { status: 503 }
    renderDialog()
    await waitFor(() => expect(screen.getByTestId('video-connections-failed')).toBeTruthy())
    expect(screen.getByTestId('video-connections-failed').textContent).toMatch(/falha temporária/)
    expect(screen.queryByTestId('video-model-select')).toBeNull()
    expect(screen.queryByTestId('video-connection-blocked')).toBeNull()
    expect(screen.getByTestId('generate-video').hasAttribute('disabled')).toBe(true)

    connectionsPayload = { connections: [describeRestConnection('configured')] }
    fireEvent.click(within(screen.getByTestId('video-connections-failed')).getByRole('button', { name: /Tentar novamente/ }))
    await waitFor(() => expect(screen.getByTestId('video-model-select')).toBeTruthy())
  })

  it('stale capabilities keep working but offer a refresh', async () => {
    const staleAt = new Date(NOW.getTime() - 30 * 3600_000).toISOString()
    connectionsPayload = { connections: [mcpDescriptor(GENERATION_SCOPES, { last_checked_at: staleAt })] }
    renderDialog()
    await waitFor(() => expect(screen.getByTestId('video-capabilities-stale')).toBeTruthy())
    expect(screen.getByTestId('video-capabilities-stale').textContent).toMatch(/há 30 h/)
    expect(screen.getByTestId('generate-video').hasAttribute('disabled')).toBe(false)
  })

  it('an unconfirmed (possibly billed) submission LOCKS the form and tells the user not to retry', async () => {
    connectionsPayload = { connections: [describeRestConnection('configured')] }
    const onSuccess = vi.fn()
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/video-generations/connections') return new Response(JSON.stringify(connectionsPayload), { status: 200 })
      if (url === '/api/video-generations' && init?.method === 'POST') {
        return new Response(JSON.stringify({ error: 'A Kling aceitou a geração, mas não conseguimos registrá-la. NÃO tente de novo.', code: 'SUBMISSION_UNRECORDED', outcomeUnknown: true }), { status: 502 })
      }
      return new Response('{}', { status: 200 })
    })
    render(<CreateVideoGenerationDialog open onOpenChange={() => undefined} projectId="proj-1" productionId="prod-1" onSuccess={onSuccess} />)
    await waitFor(() => expect(screen.getByTestId('video-model-select')).toBeTruthy())

    fireEvent.click(screen.getByTestId('operation-text_to_video'))
    fireEvent.mouseDown(screen.getByTestId('operation-text_to_video'))
    await waitFor(() => expect(screen.getByPlaceholderText(/Descreva a cena/)).toBeTruthy())
    fireEvent.change(screen.getByPlaceholderText(/Descreva a cena/), { target: { value: 'a fox' } })
    fireEvent.click(screen.getByTestId('generate-video'))

    await waitFor(() => expect(screen.getByTestId('video-submission-unconfirmed')).toBeTruthy())
    expect(screen.getByTestId('video-submission-unconfirmed').textContent).toMatch(/não tente de novo/i)
    expect(screen.getByTestId('generate-video').hasAttribute('disabled')).toBe(true)
    expect(onSuccess).toHaveBeenCalledTimes(1)
    const posts = fetchMock.mock.calls.filter(([url, init]) => url === '/api/video-generations' && init?.method === 'POST')
    expect(posts).toHaveLength(1)
  })

  it.each([
    ['a network drop after the request was sent', () => { throw new TypeError('Failed to fetch') }],
    ['a gateway timeout with an HTML body', () => new Response('<html>504</html>', { status: 504 })],
    ['a server error without a definitive code', () => new Response(JSON.stringify({ error: 'boom' }), { status: 500 })],
  ])('%s may already have been billed: the form locks instead of inviting a retry', async (_name, respond) => {
    connectionsPayload = { connections: [describeRestConnection('configured')] }
    const onSuccess = vi.fn()
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/video-generations/connections') return new Response(JSON.stringify(connectionsPayload), { status: 200 })
      if (url === '/api/video-generations' && init?.method === 'POST') return respond()
      return new Response('{}', { status: 200 })
    })
    render(<CreateVideoGenerationDialog open onOpenChange={() => undefined} projectId="proj-1" productionId="prod-1" onSuccess={onSuccess} />)
    await waitFor(() => expect(screen.getByTestId('video-model-select')).toBeTruthy())
    fireEvent.click(screen.getByTestId('operation-text_to_video'))
    fireEvent.mouseDown(screen.getByTestId('operation-text_to_video'))
    await waitFor(() => expect(screen.getByPlaceholderText(/Descreva a cena/)).toBeTruthy())
    fireEvent.change(screen.getByPlaceholderText(/Descreva a cena/), { target: { value: 'a fox' } })
    fireEvent.click(screen.getByTestId('generate-video'))

    await waitFor(() => expect(screen.getByTestId('video-submission-unconfirmed')).toBeTruthy())
    expect(screen.getByTestId('generate-video').hasAttribute('disabled')).toBe(true)
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })

  it('a DEFINITIVE rejection (with a code) does not lock the form', async () => {
    connectionsPayload = { connections: [describeRestConnection('configured')] }
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/video-generations/connections') return new Response(JSON.stringify(connectionsPayload), { status: 200 })
      if (url === '/api/video-generations' && init?.method === 'POST') return new Response(JSON.stringify({ error: 'Rejected', code: 'PROVIDER_CONTENT_REJECTED', outcomeUnknown: false }), { status: 422 })
      return new Response('{}', { status: 200 })
    })
    render(<CreateVideoGenerationDialog open onOpenChange={() => undefined} projectId="proj-1" productionId="prod-1" />)
    await waitFor(() => expect(screen.getByTestId('video-model-select')).toBeTruthy())
    fireEvent.click(screen.getByTestId('operation-text_to_video'))
    fireEvent.mouseDown(screen.getByTestId('operation-text_to_video'))
    await waitFor(() => expect(screen.getByPlaceholderText(/Descreva a cena/)).toBeTruthy())
    fireEvent.change(screen.getByPlaceholderText(/Descreva a cena/), { target: { value: 'a fox' } })
    fireEvent.click(screen.getByTestId('generate-video'))

    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => url === '/api/video-generations' && init?.method === 'POST')).toBe(true))
    await waitFor(() => expect(screen.getByTestId('generate-video').hasAttribute('disabled')).toBe(false))
    expect(screen.queryByTestId('video-submission-unconfirmed')).toBeNull()
  })

  it('never renders provider secrets, raw schema keys or account identifiers', async () => {
    connectionsPayload = { connections: [describeRestConnection('configured'), mcpDescriptor(GENERATION_SCOPES)] }
    const { container } = renderDialog()
    await waitFor(() => expect(screen.getByTestId('video-connection-toggle')).toBeTruthy())
    const html = container.ownerDocument.body.innerHTML
    for (const forbidden of ['allowedValues', 'enable_audio', 'prefer_multi_shots', 'imageCount', 'access_token', 'refresh_token']) expect(html).not.toContain(forbidden)
  })
})
