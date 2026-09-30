// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import {
  connectionName,
  filterUsageEvents,
  formatUsageQuantity,
  measurementSourceLabel,
  operationLabel,
  summarizeUsage,
  transportLabel,
  DEFAULT_USAGE_FILTERS,
  type UsageEventView,
  type UsageHistoryResponse,
} from '@/lib/usage/provider-usage'
import { UsageHistory } from './usage-history'

// AI_PROVIDER_USAGE_LEDGER_AND_HISTORY_V1 — "Uso e custos".
// Provider-native quantities are shown in their own unit, never converted and
// never added across units; unknown usage is shown as unknown, never as 0.

const CONNECTION_ID = '11111111-1111-4111-8111-111111111111'

const mcpEvent: UsageEventView = {
  id: 'e-mcp',
  occurred_at: '2026-09-29T20:01:46.000Z',
  provider: 'kling',
  transport: 'mcp',
  operation: 'text_to_video',
  model: 'kling-video-v3_0',
  quantity: 18,
  unit: 'credits',
  measurement_source: 'balance_delta',
  project_id: 'proj-1',
  connection_id: CONNECTION_ID,
}
const restEvent: UsageEventView = {
  id: 'e-rest',
  occurred_at: '2026-09-28T12:00:00.000Z',
  provider: 'kling',
  transport: 'rest',
  operation: 'image_to_video',
  model: 'kling-v3',
  quantity: 3,
  unit: 'units',
  measurement_source: 'provider_reported',
  project_id: 'proj-1',
  connection_id: null,
}
const unknownEvent: UsageEventView = {
  id: 'e-unknown',
  occurred_at: '2026-09-27T09:00:00.000Z',
  provider: 'kling',
  transport: 'mcp',
  operation: 'text_to_video',
  model: 'kling-video-v3_0',
  quantity: null,
  unit: null,
  measurement_source: 'unknown',
  project_id: 'proj-2',
  connection_id: CONNECTION_ID,
}

const payload = (events: UsageEventView[], overrides: Partial<UsageHistoryResponse> = {}): UsageHistoryResponse => ({
  events,
  projects: { 'proj-1': 'Maitê 1 ano', 'proj-2': 'Outro projeto' },
  connections: { [CONNECTION_ID]: 'Minha conta Kling — Pro' },
  hasMore: false,
  ...overrides,
})

const fetchMock = vi.fn()
const respond = (body: unknown, status = 200) => fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }))

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
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function ready() {
  render(<UsageHistory />)
  await waitFor(() => expect(screen.queryByTestId('usage-loading')).toBeNull())
}

async function selectOption(triggerTestId: string, optionName: RegExp | string) {
  fireEvent.pointerDown(screen.getByTestId(triggerTestId), { button: 0, ctrlKey: false, pointerType: 'mouse' })
  const option = await screen.findByRole('option', { name: optionName })
  fireEvent.pointerUp(option, { button: 0, pointerType: 'mouse' })
  fireEvent.click(option)
}

const rowFor = (id: string) => screen.getAllByTestId('usage-row').find((row) => row.textContent?.includes(id)) as HTMLElement

describe('usage rows', () => {
  it('an MCP row shows provider, MCP transport, the account connection, model, operation, project, quantity + unit and how it was measured', async () => {
    respond(payload([mcpEvent]))
    await ready()
    const row = screen.getByTestId('usage-row')

    expect(within(row).getByTestId('usage-provider').textContent).toBe('Kling')
    expect(within(row).getByTestId('usage-transport').textContent).toBe('MCP')
    expect(within(row).getByTestId('usage-connection').textContent).toBe('Minha conta Kling — Pro')
    expect(within(row).getByTestId('usage-model').textContent).toBe('kling-video-v3_0')
    expect(within(row).getByTestId('usage-operation').textContent).toBe('Texto → Vídeo')
    expect(row.textContent).toContain('Maitê 1 ano')
    expect(within(row).getByTestId('usage-quantity').textContent).toBe('18 créditos')
    expect(within(row).getByTestId('usage-source').textContent).toBe('Medição: diferença de saldo')
    // The weaker attribution is explained, not hidden.
    expect(within(row).getByTestId('usage-source').getAttribute('title')).toMatch(/outras execuções ao mesmo tempo/)
    expect(within(row).getByTestId('usage-date').textContent).toMatch(/\d/)
  })

  it('an API row shows the API transport, "Kling API", its own unit and "Informado pelo provedor"', async () => {
    respond(payload([restEvent]))
    await ready()
    const row = screen.getByTestId('usage-row')
    expect(within(row).getByTestId('usage-transport').textContent).toBe('API')
    expect(within(row).getByTestId('usage-connection').textContent).toBe('Kling API')
    expect(within(row).getByTestId('usage-model').textContent).toBe('kling-v3')
    expect(within(row).getByTestId('usage-operation').textContent).toBe('Imagem → Vídeo')
    expect(within(row).getByTestId('usage-quantity').textContent).toBe('3 unidades')
    expect(within(row).getByTestId('usage-source').textContent).toBe('Medição: informado pelo provedor')
  })

  it('unknown usage is shown as unknown — never as "0"', async () => {
    respond(payload([unknownEvent]))
    await ready()
    const row = screen.getByTestId('usage-row')
    const quantity = within(row).getByTestId('usage-quantity')
    expect(quantity.textContent).toBe('Uso não informado')
    expect(quantity.getAttribute('data-known')).toBe('false')
    expect(quantity.textContent).not.toMatch(/\b0\b/)
    expect(within(row).getByTestId('usage-source').textContent).toBe('Uso não informado pelo provedor')
  })

  it('a connection that is gone is not given an invented name', async () => {
    respond(payload([{ ...mcpEvent, connection_id: null }]))
    await ready()
    expect(screen.queryByTestId('usage-connection')).toBeNull()
  })

  it('a deleted project is not given an invented name either', async () => {
    respond(payload([{ ...mcpEvent, project_id: 'proj-gone' }], { projects: {} }))
    await ready()
    expect(screen.getByTestId('usage-row').textContent).not.toContain('Maitê')
  })
})

describe('summary — never one universal total', () => {
  it('credits and units are summarised separately: 18 créditos and 3 unidades are never added into 21', async () => {
    respond(payload([mcpEvent, restEvent]))
    await ready()
    const groups = screen.getAllByTestId('usage-summary-group').map((node) => node.textContent ?? '')
    expect(groups).toHaveLength(2)
    expect(groups.some((text) => text.includes('Kling · MCP') && text.includes('18 créditos'))).toBe(true)
    expect(groups.some((text) => text.includes('Kling · API') && text.includes('3 unidades'))).toBe(true)
    expect(screen.getByTestId('usage-summary').textContent).not.toMatch(/\b21\b/)
  })

  it('the same unit measured two different ways is not merged either', () => {
    const summary = summarizeUsage([
      { ...mcpEvent, id: 'a', quantity: 10, unit: 'credits', measurement_source: 'balance_delta' },
      { ...mcpEvent, id: 'b', quantity: 5, unit: 'credits', measurement_source: 'provider_reported' },
      { ...mcpEvent, id: 'c', quantity: 8, unit: 'credits', measurement_source: 'balance_delta' },
    ])
    expect(summary.groups.map((group) => [group.measurementSource, group.quantity, group.events]).sort()).toEqual([
      ['balance_delta', 18, 2],
      ['provider_reported', 5, 1],
    ])
  })

  it('unknown executions are counted but contribute to no total', async () => {
    respond(payload([mcpEvent, unknownEvent, { ...unknownEvent, id: 'e-unknown-2' }]))
    await ready()
    expect(screen.getAllByTestId('usage-summary-group')).toHaveLength(1)
    expect(screen.getByTestId('usage-summary-group').textContent).toContain('18 créditos')
    expect(screen.getByTestId('usage-summary-unknown').textContent).toMatch(/2 execuções sem consumo informado/)
  })

  it('with only unknown executions there is no total at all', async () => {
    respond(payload([unknownEvent]))
    await ready()
    expect(screen.queryAllByTestId('usage-summary-group')).toHaveLength(0)
    expect(screen.getByTestId('usage-summary-none').textContent).toMatch(/Nenhum consumo medido/)
  })

  it('singular / plural units and pt-BR number formatting', () => {
    expect(formatUsageQuantity({ quantity: 1, unit: 'credits' })).toBe('1 crédito')
    expect(formatUsageQuantity({ quantity: 18, unit: 'credits' })).toBe('18 créditos')
    expect(formatUsageQuantity({ quantity: 12840, unit: 'input_tokens' })).toBe('12.840 tokens de entrada')
    expect(formatUsageQuantity({ quantity: 0, unit: 'units' })).toBe('0 unidades')
    expect(formatUsageQuantity({ quantity: null, unit: null })).toBe('Uso não informado')
  })
})

describe('verified historical imports', () => {
  const importedRest: UsageEventView = { ...restEvent, id: 'h-rest-1', historical_import: true }
  const importedRest2: UsageEventView = { ...restEvent, id: 'h-rest-2', operation: 'text_to_video', occurred_at: '2026-09-28T20:58:46.000Z', historical_import: true }
  const importedMcp: UsageEventView = { ...mcpEvent, id: 'h-mcp', historical_import: true }

  it('an imported event says so, and keeps its own measurement wording (units provider-reported, credits by balance difference)', async () => {
    respond(payload([importedRest, importedMcp]))
    await ready()
    const rows = screen.getAllByTestId('usage-row')
    expect(rows).toHaveLength(2)
    for (const row of rows) expect(within(row).getByTestId('usage-historical').textContent).toBe('Importado de prova histórica verificada')
    const rest = rows.find((row) => row.getAttribute('data-transport') === 'rest')!
    const mcp = rows.find((row) => row.getAttribute('data-transport') === 'mcp')!
    expect(within(rest).getByTestId('usage-source').textContent).toBe('Medição: informado pelo provedor')
    expect(within(mcp).getByTestId('usage-source').textContent).toBe('Medição: diferença de saldo')
  })

  it('a live (non-imported) event carries no historical marker', async () => {
    respond(payload([mcpEvent]))
    await ready()
    expect(screen.queryByTestId('usage-historical')).toBeNull()
  })

  it('an imported row and a live row are rendered by the same row component: they differ ONLY by the provenance line', async () => {
    respond(payload([{ ...mcpEvent, id: 'live' }, importedMcp]))
    await ready()
    const rows = screen.getAllByTestId('usage-row')
    const imported = rows.find((row) => row.querySelector('[data-testid="usage-historical"]'))!
    const live = rows.find((row) => !row.querySelector('[data-testid="usage-historical"]'))!
    const structure = (row: HTMLElement) => {
      const clone = row.cloneNode(true) as HTMLElement
      clone.querySelector('[data-testid="usage-historical"]')?.remove()
      return clone.innerHTML
    }
    expect(rows).toHaveLength(2)
    expect(structure(imported)).toBe(structure(live))
  })

  it('imported events take part in the same filters and summaries as live ones', async () => {
    respond(payload([importedRest, importedMcp, { ...mcpEvent, id: 'live-mcp' }]))
    await ready()
    expect(screen.getAllByTestId('usage-row')).toHaveLength(3)

    await selectOption('usage-filter-transport', 'MCP')
    await waitFor(() => expect(screen.getAllByTestId('usage-row')).toHaveLength(2))
    expect(screen.getAllByTestId('usage-row').every((row) => row.getAttribute('data-transport') === 'mcp')).toBe(true)
    // imported + live credits share one MCP total; the provenance stays visible on the imported row only.
    const groups = screen.getAllByTestId('usage-summary-group').map((node) => node.textContent ?? '')
    expect(groups).toHaveLength(1)
    expect(groups[0]).toContain('36 créditos')
    expect(screen.getAllByTestId('usage-historical')).toHaveLength(1)
  })

  it('the two REST proofs are separate executions that share one API total; credits stay apart — never a combined 24', async () => {
    respond(payload([importedRest, importedRest2, importedMcp]))
    await ready()
    expect(screen.getAllByTestId('usage-row')).toHaveLength(3)
    const groups = screen.getAllByTestId('usage-summary-group').map((node) => node.textContent ?? '')
    expect(groups).toHaveLength(2)
    expect(groups.some((text) => text.includes('Kling · API') && text.includes('6 unidades') && text.includes('2 execuções'))).toBe(true)
    expect(groups.some((text) => text.includes('Kling · MCP') && text.includes('18 créditos') && text.includes('1 execução'))).toBe(true)
    expect(screen.getByTestId('usage-summary').textContent).not.toMatch(/24/)
  })
})

describe('filters', () => {
  it('filtering by connection type narrows both the rows and the summary', async () => {
    respond(payload([mcpEvent, restEvent, unknownEvent]))
    await ready()
    expect(screen.getAllByTestId('usage-row')).toHaveLength(3)

    await selectOption('usage-filter-transport', 'API')
    await waitFor(() => expect(screen.getAllByTestId('usage-row')).toHaveLength(1))
    expect(screen.getByTestId('usage-row').textContent).toContain('3 unidades')
    expect(screen.getAllByTestId('usage-summary-group')).toHaveLength(1)
    expect(screen.queryByTestId('usage-summary-unknown')).toBeNull()
  })

  it('filtering by project narrows the rows', async () => {
    respond(payload([mcpEvent, restEvent, unknownEvent]))
    await ready()
    await selectOption('usage-filter-project', 'Outro projeto')
    await waitFor(() => expect(screen.getAllByTestId('usage-row')).toHaveLength(1))
    expect(screen.getByTestId('usage-quantity').textContent).toBe('Uso não informado')
  })

  it('a filter with no match says so instead of showing an empty list silently', async () => {
    respond(payload([{ ...restEvent, occurred_at: '2025-01-01T00:00:00.000Z' }]))
    await ready()
    await selectOption('usage-filter-period', 'Últimos 7 dias')
    await waitFor(() => expect(screen.getByTestId('usage-no-match')).toBeTruthy())
  })

  it('period filtering is by event time (pure)', () => {
    const now = new Date('2026-09-30T00:00:00.000Z')
    const kept = filterUsageEvents([mcpEvent, restEvent, unknownEvent], { ...DEFAULT_USAGE_FILTERS, period: '7d' }, now)
    expect(kept.map((event) => event.id)).toEqual(['e-mcp', 'e-rest', 'e-unknown'])
    const none = filterUsageEvents([restEvent], { ...DEFAULT_USAGE_FILTERS, period: '7d' }, new Date('2026-12-01T00:00:00.000Z'))
    expect(none).toEqual([])
  })
})

describe('states', () => {
  it('shows a loading state first', () => {
    fetchMock.mockReturnValue(new Promise(() => undefined))
    render(<UsageHistory />)
    expect(screen.getByTestId('usage-loading')).toBeTruthy()
  })

  it('the empty state explains when history begins and does not look like an error', async () => {
    respond(payload([]))
    await ready()
    const empty = screen.getByTestId('usage-empty')
    expect(empty.textContent).toMatch(/Nenhum uso registrado ainda/)
    // Valid for an account with no events AND for one whose earlier usage was imported with verified evidence.
    expect(empty.textContent).not.toMatch(/começa quando|antes deste registro existir/i)
    expect(screen.queryByTestId('usage-failed')).toBeNull()
    expect(screen.queryByTestId('usage-filters')).toBeNull()
  })

  it('a load failure is NOT "no usage", and retry works', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 503 }))
    await ready()
    expect(screen.getByTestId('usage-failed').textContent).toMatch(/não significa que não houve uso/)
    expect(screen.queryByTestId('usage-empty')).toBeNull()

    respond(payload([mcpEvent]))
    fireEvent.click(screen.getByText('Tentar novamente'))
    await waitFor(() => expect(screen.getByTestId('usage-row')).toBeTruthy())
    expect(screen.queryByTestId('usage-failed')).toBeNull()
  })

  it('a network error is also a failure state, not an empty history', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await ready()
    expect(screen.getByTestId('usage-failed')).toBeTruthy()
    expect(screen.queryByTestId('usage-empty')).toBeNull()
  })

  it('says when older events exist beyond the window', async () => {
    respond(payload([mcpEvent], { hasMore: true }))
    await ready()
    expect(screen.getByTestId('usage-has-more').textContent).toMatch(/200 registros mais recentes/)
  })

  it('states plainly that quantities are usage, not money and not converted', async () => {
    respond(payload([mcpEvent]))
    await ready()
    const text = screen.getByTestId('usage-disclaimer').textContent ?? ''
    expect(text).toMatch(/não são valores em reais/)
    expect(text).toMatch(/não são convertidas entre si/)
    expect(document.body.textContent).not.toMatch(/R\$|US\$|\$\s?\d/)
  })

  it('never renders identifiers or raw payload fields', async () => {
    respond(payload([mcpEvent]))
    await ready()
    const text = document.body.textContent ?? ''
    expect(text).not.toContain(CONNECTION_ID)
    expect(text).not.toMatch(/idempotency|provider_metadata|task_id/)
  })
})

describe('presentation vocabulary', () => {
  it('measurement sources are understandable, and the weak one is not presented as provider-stated', () => {
    expect(measurementSourceLabel('provider_reported')).toBe('Informado pelo provedor')
    expect(measurementSourceLabel('balance_delta')).toBe('Diferença de saldo')
    expect(measurementSourceLabel('balance_delta')).not.toBe(measurementSourceLabel('provider_reported'))
    expect(measurementSourceLabel('estimated')).toBe('Estimado')
    expect(measurementSourceLabel('manual_import')).toBe('Importado manualmente')
  })

  it('operation, transport and connection wording', () => {
    expect(operationLabel('text_to_video')).toBe('Texto → Vídeo')
    expect(operationLabel('something_new')).toBe('something_new')
    expect(transportLabel('rest')).toBe('API')
    expect(transportLabel('mcp')).toBe('MCP')
    expect(connectionName({ provider: 'kling', transport: 'rest', connection_id: null }, {})).toBe('Kling API')
    expect(connectionName({ provider: 'kling', transport: 'mcp', connection_id: 'x' }, {})).toBeNull()
  })
})

describe('Settings navigation', () => {
  const page = readFileSync(join(process.cwd(), 'app/(dashboard)/configuracoes/page.tsx'), 'utf8')

  it('exposes a "Uso e custos" tab (via the shared Settings tab list) that renders the usage history', () => {
    const tabs = readFileSync(join(process.cwd(), 'components/settings/settings-tabs.tsx'), 'utf8')
    expect(tabs).toMatch(/value: 'usage', label: 'Uso e custos'/)
    expect(page).toMatch(/<SettingsTabsList \/>/)
    expect(page).toMatch(/<TabsContent value="usage">\s*<UsageHistory \/>\s*<\/TabsContent>/)
    expect(page).toMatch(/import \{ UsageHistory \} from '@\/components\/settings\/usage-history'/)
  })

  it('the usage component only ever reads: its only request is GET /api/settings/usage', () => {
    const component = readFileSync(join(process.cwd(), 'components/settings/usage-history.tsx'), 'utf8')
    expect(component.match(/fetch\(/g)).toHaveLength(1)
    expect(component).toMatch(/fetch\('\/api\/settings\/usage'\)/)
    expect(component).not.toMatch(/method:\s*'(POST|PUT|PATCH|DELETE)'/)
  })
})
