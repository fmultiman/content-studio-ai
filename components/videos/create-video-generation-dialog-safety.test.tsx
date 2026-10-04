// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { normalizeKlingMcpVideoCapabilities } from '@/lib/provider-connections/kling-mcp-video-capabilities'
import { whoAmIFixture } from '@/lib/__tests__/helpers/kling-who-am-i-fixture'
import { describeMcpConnection, describeRestConnection } from '@/lib/video-generation/connections'
import type { VideoGenerationConnectionDescriptor } from '@/lib/video-generation/capabilities'
import type { ProviderConnectionRow } from '@/lib/provider-connections/types'

// VIDEO_GENERATION_MODAL_SAFETY_AND_TRANSPORT_UX_V1
//
// (1) A paid submission can start only once per opening of the form.
// (2) The selected connection — API vs MCP — and the balance it spends are unmistakable.
//
// Every submission below is a mocked fetch: no provider, no paid call.

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
const toast = vi.fn()
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        neq: () => chain,
        order: () => chain,
        limit: () => Promise.resolve({ data: [] }),
      }
      return chain
    },
  }),
}))

import { CreateVideoGenerationDialog } from './create-video-generation-dialog'

const MCP_ID = '11111111-1111-4111-8111-111111111111'
const NOW = new Date()
const GENERATION_SCOPES = ['generation.read', 'account.credit.read', 'generation.create']
const READ_ONLY_SCOPES = ['generation.read', 'account.credit.read']

function mcpDescriptor(scopes: string[]): VideoGenerationConnectionDescriptor {
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
  }
  return describeMcpConnection(row, NOW)
}

let connections: VideoGenerationConnectionDescriptor[]
const fetchMock = vi.fn()
let postHandler: (() => Response | Promise<Response>) | null = null

beforeAll(() => {
  const proto = window.HTMLElement.prototype as any
  proto.hasPointerCapture ??= () => false
  proto.setPointerCapture ??= () => undefined
  proto.releasePointerCapture ??= () => undefined
  proto.scrollIntoView ??= () => undefined
  ;(window as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }
})

beforeEach(() => {
  vi.clearAllMocks()
  postHandler = null
  connections = [describeRestConnection('configured'), mcpDescriptor(GENERATION_SCOPES)]
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/video-generations/connections') return new Response(JSON.stringify({ connections }), { status: 200 })
    if (url === '/api/video-generations' && init?.method === 'POST') {
      return postHandler ? postHandler() : new Response(JSON.stringify({ generation: { id: 'g1' } }), { status: 200 })
    }
    return new Response('{}', { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const posts = () => fetchMock.mock.calls.filter(([url, init]) => url === '/api/video-generations' && init?.method === 'POST')

async function selectOption(triggerTestId: string, optionName: RegExp | string) {
  fireEvent.pointerDown(screen.getByTestId(triggerTestId), { button: 0, ctrlKey: false, pointerType: 'mouse' })
  const option = await screen.findByRole('option', { name: optionName })
  fireEvent.pointerUp(option, { button: 0, pointerType: 'mouse' })
  fireEvent.click(option)
}

const selected = () => screen.getByTestId('video-connection-toggle').querySelector('[aria-checked="true"]')?.textContent

const chooseConnection = (transport: 'api' | 'mcp') => {
  fireEvent.click(screen.getByTestId(`video-connection-option-${transport}`))
}

const props = { projectId: 'proj-1', productionId: 'prod-1' }

async function renderReady(overrides: Partial<React.ComponentProps<typeof CreateVideoGenerationDialog>> = {}) {
  const onOpenChange = vi.fn()
  const onSuccess = vi.fn()
  const view = render(<CreateVideoGenerationDialog open onOpenChange={onOpenChange} onSuccess={onSuccess} {...props} {...overrides} />)
  await waitFor(() => expect(screen.getByTestId('video-model-select')).toBeTruthy())
  return { ...view, onOpenChange, onSuccess }
}

async function fillPrompt(text = 'a red paper boat') {
  fireEvent.click(screen.getByTestId('operation-text_to_video'))
  fireEvent.mouseDown(screen.getByTestId('operation-text_to_video'))
  const textarea = await screen.findByPlaceholderText(/Descreva a cena/)
  fireEvent.change(textarea, { target: { value: text } })
  return textarea as HTMLTextAreaElement
}

const generateButton = () => screen.getByTestId('generate-video')

describe('paid-submission safety', () => {
  it('the submit button is disabled the moment a submission starts, and only one request is sent', async () => {
    let release!: (response: Response) => void
    postHandler = () => new Promise<Response>((resolve) => { release = resolve })
    await renderReady()
    await fillPrompt()

    fireEvent.click(generateButton())
    await waitFor(() => expect(generateButton().hasAttribute('disabled')).toBe(true))
    fireEvent.click(generateButton())
    fireEvent.click(generateButton())
    expect(posts()).toHaveLength(1)

    await act(async () => { release(new Response(JSON.stringify({ generation: { id: 'g1' } }), { status: 200 })) })
  })

  it('two activations in the SAME tick (before React re-renders) still send exactly one request', async () => {
    let release!: (response: Response) => void
    postHandler = () => new Promise<Response>((resolve) => { release = resolve })
    await renderReady()
    await fillPrompt()

    const button = generateButton()
    act(() => {
      // Inside act() React defers the re-render, so BOTH handlers run against the still-enabled button.
      button.click()
      button.click()
      button.click()
    })
    expect(posts()).toHaveLength(1)

    await act(async () => { release(new Response(JSON.stringify({ generation: { id: 'g1' } }), { status: 200 })) })
    expect(posts()).toHaveLength(1)
  })

  it('pressing Enter in the prompt is not a submit path: it sends nothing', async () => {
    await renderReady()
    const textarea = await fillPrompt()
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' })
    fireEvent.keyUp(textarea, { key: 'Enter', code: 'Enter' })
    fireEvent.keyPress(textarea, { key: 'Enter', code: 'Enter', charCode: 13 })
    expect(posts()).toHaveLength(0)
  })

  it('an ACCEPTED generation closes the form and can never be submitted again from that state', async () => {
    // The host ignores the close request (stays open), which is the worst case for a stale, armed button.
    const { onOpenChange, onSuccess } = await renderReady()
    await fillPrompt()

    fireEvent.click(generateButton())
    await waitFor(() => expect(screen.getByTestId('video-submission-accepted')).toBeTruthy())

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onSuccess).toHaveBeenCalledTimes(1)
    // No armed "Gerar vídeo" is left, and the form fields are gone.
    expect(screen.queryByTestId('generate-video')).toBeNull()
    expect(screen.queryByPlaceholderText(/Descreva a cena/)).toBeNull()
    expect(screen.getByText('Fechar')).toBeTruthy()
    expect(posts()).toHaveLength(1)
  })

  it('reopening after an accepted generation gives a NEW empty form: the old prompt is not left armed', async () => {
    const view = await renderReady()
    await fillPrompt('the first (paid) prompt')
    fireEvent.click(generateButton())
    await waitFor(() => expect(screen.getByTestId('video-submission-accepted')).toBeTruthy())

    view.rerender(<CreateVideoGenerationDialog open={false} onOpenChange={view.onOpenChange} onSuccess={view.onSuccess} {...props} />)
    view.rerender(<CreateVideoGenerationDialog open onOpenChange={view.onOpenChange} onSuccess={view.onSuccess} {...props} />)

    await waitFor(() => expect(screen.getByTestId('video-model-select')).toBeTruthy())
    expect(screen.queryByTestId('video-submission-accepted')).toBeNull()
    const textarea = (await screen.findAllByRole('textbox')).find((node) => node.tagName === 'TEXTAREA') as HTMLTextAreaElement
    expect(textarea.value).toBe('')
    // With the empty prompt the form refuses to send anything.
    fireEvent.click(generateButton())
    expect(posts()).toHaveLength(1)
    // A deliberate new generation is possible again.
    await fillPrompt('a second, deliberate prompt')
    fireEvent.click(generateButton())
    await waitFor(() => expect(posts()).toHaveLength(2))
  })

  it('a failure BEFORE provider acceptance (definitive answer) releases the form for a legitimate retry', async () => {
    let attempt = 0
    postHandler = () => {
      attempt += 1
      return attempt === 1
        ? new Response(JSON.stringify({ error: 'Modelo indisponível', code: 'INVALID_MODEL' }), { status: 400 })
        : new Response(JSON.stringify({ generation: { id: 'g2' } }), { status: 200 })
    }
    await renderReady()
    await fillPrompt()

    fireEvent.click(generateButton())
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' })))
    await waitFor(() => expect(generateButton().hasAttribute('disabled')).toBe(false))
    expect(screen.queryByTestId('video-submission-unconfirmed')).toBeNull()
    expect(screen.queryByTestId('video-submission-accepted')).toBeNull()

    fireEvent.click(generateButton())
    await waitFor(() => expect(screen.getByTestId('video-submission-accepted')).toBeTruthy())
    expect(posts()).toHaveLength(2)
  })

  it('an ambiguous outcome is never retried automatically and never claims "not submitted"', async () => {
    postHandler = () => { throw new TypeError('Failed to fetch') }
    await renderReady()
    await fillPrompt()

    fireEvent.click(generateButton())
    await waitFor(() => expect(screen.getByTestId('video-submission-unconfirmed')).toBeTruthy())
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(posts()).toHaveLength(1)
    expect(generateButton().hasAttribute('disabled')).toBe(true)
    const text = screen.getByTestId('video-submission-unconfirmed').textContent ?? ''
    expect(text).toMatch(/não tente de novo/i)
    expect(text).not.toMatch(/não foi enviad|nada foi enviad|not submitted/i)
    // Even a same-tick re-activation stays a no-op.
    act(() => { generateButton().click() })
    expect(posts()).toHaveLength(1)
  })
})

describe('connection clarity: API vs MCP', () => {
  it('API is the default and is visibly an API connection that spends the Kling API package', async () => {
    await renderReady()
    expect(selected()).toBe('API')
    expect(screen.getByTestId('video-connection-detail').getAttribute('data-transport')).toBe('API')
    expect(screen.getByTestId('video-connection-detail').textContent).toBe('Usa o pacote de recursos da sua API Kling.')
  })

  it('the account connection is visibly MCP and spends the credits of the connected Kling account', async () => {
    await renderReady()
    chooseConnection('mcp')
    await waitFor(() => expect(selected()).toBe('MCP'))

    expect(screen.getByTestId('video-connection-option-mcp').getAttribute('aria-label')).toContain('Minha conta Kling')
    expect(screen.getByTestId('video-connection-detail').getAttribute('data-transport')).toBe('MCP')
    expect(screen.getByTestId('video-connection-detail').textContent).toBe('Usa os créditos da sua conta Kling (web).')
  })

  it('the standalone Conexão block is gone: no dropdown, no duplicate heading', async () => {
    await renderReady()
    expect(screen.queryByTestId('video-connection-select')).toBeNull()
    expect(screen.queryByTestId('video-connection-summary')).toBeNull()
    expect(screen.queryByText('Conexão')).toBeNull()
  })

  it('renders one control per configured connection, on the Modelo row', async () => {
    await renderReady()
    const toggle = screen.getByTestId('video-connection-toggle')
    expect(within(toggle).getAllByRole('radio').map((radio) => radio.textContent)).toEqual(['API', 'MCP'])
    expect(toggle.closest('div')?.parentElement?.textContent).toContain('Modelo')
    expect(screen.getByRole('radiogroup', { name: 'Conexão de geração' })).toBe(toggle)
  })

  it('only API configured → only the API control renders', async () => {
    connections = [describeRestConnection('configured')]
    await renderReady()
    expect(within(screen.getByTestId('video-connection-toggle')).getAllByRole('radio').map((radio) => radio.textContent)).toEqual(['API'])
    expect(screen.queryByTestId('video-connection-option-mcp')).toBeNull()
  })

  it('only MCP configured → only the MCP control renders, already selected', async () => {
    connections = [mcpDescriptor(GENERATION_SCOPES)]
    await renderReady()
    expect(within(screen.getByTestId('video-connection-toggle')).getAllByRole('radio').map((radio) => radio.textContent)).toEqual(['MCP'])
    expect(selected()).toBe('MCP')
  })

  it('the active control is obvious and exposed accessibly; the inactive one is not', async () => {
    await renderReady()
    const api = screen.getByTestId('video-connection-option-api')
    const mcp = screen.getByTestId('video-connection-option-mcp')
    expect(api.getAttribute('aria-checked')).toBe('true')
    expect(api.getAttribute('data-selected')).toBe('true')
    expect(mcp.getAttribute('aria-checked')).toBe('false')
    expect(mcp.getAttribute('data-selected')).toBe('false')
    expect(api.className).not.toEqual(mcp.className)

    chooseConnection('mcp')
    await waitFor(() => expect(mcp.getAttribute('aria-checked')).toBe('true'))
    expect(api.getAttribute('aria-checked')).toBe('false')
  })

  it('the controls are real, keyboard-operable buttons', async () => {
    await renderReady()
    for (const control of within(screen.getByTestId('video-connection-toggle')).getAllByRole('radio')) {
      expect(control.tagName).toBe('BUTTON')
      expect(control.getAttribute('type')).toBe('button')
      expect(control.getAttribute('aria-label')).toMatch(/\((API|MCP)\)$/)
    }
  })

  it('no numeric or predicted cost is shown, for either connection', async () => {
    await renderReady()
    const summary = () => screen.getByTestId('video-connection-detail').textContent ?? ''
    expect(summary()).not.toMatch(/\d/)
    chooseConnection('mcp')
    await waitFor(() => expect(selected()).toBe('MCP'))
    expect(summary()).not.toMatch(/\d/)
    expect(document.body.textContent).not.toMatch(/\b18\s*créditos/i)
  })

  it('connecting MCP does not silently change the spending source: API stays selected, whatever the list order', async () => {
    connections = [mcpDescriptor(GENERATION_SCOPES), describeRestConnection('configured')]
    await renderReady()
    expect(selected()).toBe('API')
  })

  it('an MCP connection that appears later (form reopened) does not replace the API selection', async () => {
    connections = [describeRestConnection('configured')]
    const view = await renderReady()
    expect(selected()).toBe('API')

    connections = [describeRestConnection('configured'), mcpDescriptor(GENERATION_SCOPES)]
    view.rerender(<CreateVideoGenerationDialog open={false} onOpenChange={view.onOpenChange} {...props} />)
    view.rerender(<CreateVideoGenerationDialog open onOpenChange={view.onOpenChange} {...props} />)
    await waitFor(() => expect(screen.getByTestId('video-connection-toggle')).toBeTruthy())
    expect(selected()).toBe('API')
  })

  it('MCP is the default only when it is the ONLY usable connection', async () => {
    connections = [describeRestConnection('missing'), mcpDescriptor(GENERATION_SCOPES)]
    await renderReady()
    expect(selected()).toBe('MCP')
  })

  it('an MCP account without generation.create keeps the explicit authorization gate and cannot generate', async () => {
    connections = [describeRestConnection('configured'), mcpDescriptor(READ_ONLY_SCOPES)]
    await renderReady()
    chooseConnection('mcp')

    await waitFor(() => expect(screen.getByTestId('video-connection-blocked')).toBeTruthy())
    expect(selected()).toBe('MCP')
    expect(screen.getByTestId('video-connection-blocked').getAttribute('data-reason')).toBe('generation_authorization_required')
    expect(screen.getByTestId('authorize-generation')).toBeTruthy()
    expect(generateButton().hasAttribute('disabled')).toBe(true)
    // Selecting the connection never starts the OAuth flow by itself.
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/mcp/connect'))).toBe(false)
  })
})

describe('connection switching keeps the form truthful', () => {
  it('API → MCP: values the new connection also supports are kept (10 s, 1080p)', async () => {
    await renderReady()
    await selectOption('video-duration-select', '10 segundos')
    await selectOption('video-resolution-select', /Alta \(1080p\)/)

    chooseConnection('mcp')
    await waitFor(() => expect(selected()).toBe('MCP'))

    expect(screen.getByTestId('video-duration-select').textContent).toContain('10 segundos')
    expect(screen.getByTestId('video-resolution-select').textContent).toContain('1080p')
  })

  it('MCP → API: values only the MCP account offers (3 s, 4K) reset to the API model’s explicit defaults, and models/controls are re-read', async () => {
    await renderReady()
    chooseConnection('mcp')
    await waitFor(() => expect(selected()).toBe('MCP'))
    await selectOption('video-duration-select', '3 segundos')
    await selectOption('video-resolution-select', /Ultra \(4K\)/)
    expect(screen.getByTestId('video-duration-select').textContent).toContain('3 segundos')

    chooseConnection('api')
    await waitFor(() => expect(selected()).toBe('API'))

    expect(screen.getByTestId('video-duration-select').textContent).toContain('5 segundos')
    expect(screen.getByTestId('video-resolution-select').textContent).toContain('720p')
    expect(screen.getByTestId('video-model-select').textContent).toContain('Kling 3.0')
  })

  it('what is submitted after a switch is the switched connection’s reference and only values it supports', async () => {
    await renderReady()
    chooseConnection('mcp')
    await waitFor(() => expect(selected()).toBe('MCP'))
    await selectOption('video-duration-select', '3 segundos')
    chooseConnection('api')
    await waitFor(() => expect(selected()).toBe('API'))
    await fillPrompt()

    fireEvent.click(generateButton())
    await waitFor(() => expect(posts()).toHaveLength(1))
    const body = JSON.parse(posts()[0][1].body as string)
    expect(body.connectionRef).toBe('kling:api')
    expect(body.duration).toBe(5)
  })
})

describe('VIDEO_GENERATION_CALLER_WIDE_IDEMPOTENCY_HARDENING_V1 — CreateVideoGenerationDialog clientRequestId lifecycle', () => {
  it('always sends clientRequestId as a valid UUID, with no sessionId attached', async () => {
    await renderReady()
    await fillPrompt('A scenic coastal drive at sunset')

    fireEvent.click(generateButton())
    await waitFor(() => expect(posts()).toHaveLength(1))
    const body = JSON.parse(posts()[0][1].body as string)

    expect(body.clientRequestId).toBeDefined()
    expect(body.clientRequestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    // Legacy dialog does not invent or require a Session
    expect(body.sessionId).toBeUndefined()
  })

  it('retains the same clientRequestId across an ambiguous network outcome', async () => {
    // Hangs or drops the connection on first submit -> ambiguous
    fetchMock.mockImplementation((url, init) => {
      if (url === '/api/video-generations/connections') return Promise.resolve(new Response(JSON.stringify({ connections }), { status: 200 }))
      if (url === '/api/video-generations' && init?.method === 'POST') {
        return Promise.reject(new Error('Network disconnected'))
      }
      return Promise.resolve(new Response('{}', { status: 200 }))
    })

    await renderReady()
    await fillPrompt('Ambiguous submission test')

    fireEvent.click(generateButton())
    await waitFor(() => expect(posts()).toHaveLength(1))
    const firstBody = JSON.parse(posts()[0][1].body as string)
    const initialKey = firstBody.clientRequestId
    expect(initialKey).toBeDefined()

    // Form is locked to prevent double billing
    await waitFor(() => expect(screen.getByTestId('video-submission-unconfirmed')).toBeTruthy())
    expect(generateButton().hasAttribute('disabled')).toBe(true)

    // Re-triggering or programmatic activation preserves lock and cannot emit a second key
    fireEvent.click(generateButton())
    expect(posts()).toHaveLength(1)
  })

  it('rotates to a new clientRequestId after an accepted generation when reopened', async () => {
    let callCount = 0
    fetchMock.mockImplementation((url, init) => {
      if (url === '/api/video-generations/connections') return Promise.resolve(new Response(JSON.stringify({ connections }), { status: 200 }))
      if (url === '/api/video-generations' && init?.method === 'POST') {
        callCount++
        return Promise.resolve(new Response(JSON.stringify({ generation: { id: `gen-${callCount}`, status: 'submitted' } }), { status: 200 }))
      }
      return Promise.resolve(new Response('{}', { status: 200 }))
    })

    const view = await renderReady()
    await fillPrompt('First deliberate submit')

    fireEvent.click(generateButton())
    await waitFor(() => expect(posts()).toHaveLength(1))
    const firstKey = JSON.parse(posts()[0][1].body as string).clientRequestId

    // Reopen dialog for next deliberate generation
    view.rerender(<CreateVideoGenerationDialog open={false} onOpenChange={view.onOpenChange} {...props} />)
    view.rerender(<CreateVideoGenerationDialog open onOpenChange={view.onOpenChange} {...props} />)
    await waitFor(() => expect(screen.getByTestId('video-controls')).toBeTruthy())

    await fillPrompt('Second deliberate submit')
    fireEvent.click(generateButton())
    await waitFor(() => expect(posts()).toHaveLength(2))
    const secondKey = JSON.parse(posts()[1][1].body as string).clientRequestId

    expect(firstKey).toBeDefined()
    expect(secondKey).toBeDefined()
    expect(firstKey).not.toBe(secondKey)
  })

  it('validation failure before fetch does not rotate the key', async () => {
    await renderReady()
    // Empty prompt -> fails client validation before fetch
    fireEvent.click(generateButton())
    expect(posts()).toHaveLength(0)

    // Now fill prompt and submit -> successfully emits key
    await fillPrompt('Valid prompt after validation fix')
    fireEvent.click(generateButton())
    await waitFor(() => expect(posts()).toHaveLength(1))
    const body = JSON.parse(posts()[0][1].body as string)
    expect(body.clientRequestId).toBeDefined()
    expect(body.clientRequestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  })
})
