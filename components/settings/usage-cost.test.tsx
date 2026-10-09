// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { UsageEventView, UsageHistoryResponse } from '@/lib/usage/provider-usage'
import { UsageHistory } from './usage-history'

// PROVIDER_PRICING_REGISTRY_AND_ESTIMATED_COST_V1 — estimated cost on the "Uso e custos" screen.
// The usage view itself is covered by usage-history.test.tsx; this file only covers what the cost layer adds.

type Cost = NonNullable<UsageEventView['estimated_cost']>

const estimatedCost = (amount: string, extra: Record<string, unknown> = {}): Cost =>
  ({
    status: 'estimated',
    amount,
    currency: 'USD',
    basis: 'list_price_equivalent',
    serviceTier: 'standard',
    pricing: {
      versionIds: ['v1'],
      sourceUrl: 'https://ai.google.dev/gemini-api/docs/pricing',
      sourceLabel: 'Gemini API pricing - Gemini 3.5 Flash - Standard - Paid Tier - Input',
      retrievedAt: '2026-10-09T00:00:00Z',
      effectiveFrom: '2026-05-19T00:00:00.000Z',
      effectiveFromBasis: 'model_release_no_documented_change',
    },
    components: [{ category: 'input', quantity: '24800', amount, pricingVersionId: 'v1' }],
    assumptions: ['list_price_equivalent', 'paid_tier_list_price', 'effective_from_inferred', 'byok_invoice_may_differ'],
    ...extra,
  }) as Cost
const unavailable = (reason: string): Cost => ({ status: 'unavailable', reason }) as Cost

const event = (id: string, unit: UsageEventView['unit'], quantity: number | null, cost: Cost | undefined, extra: Partial<UsageEventView> = {}): UsageEventView => ({
  id,
  occurred_at: '2026-10-08T17:38:46.000Z',
  provider: 'gemini',
  transport: 'rest',
  operation: 'video_review',
  model: 'gemini-3.5-flash',
  quantity,
  unit,
  measurement_source: quantity === null ? 'unknown' : 'provider_reported',
  project_id: null,
  connection_id: null,
  funding: 'user_byok',
  usage_category: null,
  ...(cost ? { estimated_cost: cost } : {}),
  ...extra,
})

const payload = (events: UsageEventView[]): UsageHistoryResponse => ({ events, projects: {}, connections: {}, hasMore: false })

const fetchMock = vi.fn()
const respond = (body: unknown) => fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }))

beforeAll(() => {
  const proto = window.HTMLElement.prototype as any
  proto.hasPointerCapture ??= () => false
  proto.setPointerCapture ??= () => undefined
  proto.releasePointerCapture ??= () => undefined
  proto.scrollIntoView ??= () => undefined
  ;(window as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
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

describe('estimated cost on the usage screen', () => {
  it('20. labels the number as an ESTIMATE next to the usage, which stays intact', async () => {
    respond(payload([event('g1', 'input_tokens', 24800, estimatedCost('0.0372'))]))
    await ready()
    const row = screen.getByTestId('usage-row')
    expect(within(row).getByTestId('usage-quantity').textContent).toBe('24.800 tokens de entrada')
    expect(within(row).getByTestId('usage-source').textContent).toMatch(/Medição: informado pelo provedor/)
    const cost = within(row).getByTestId('usage-cost')
    expect(cost.getAttribute('data-status')).toBe('estimated')
    expect(cost.textContent).toMatch(/^Custo estimado: US\$\s0,0372$/)
    expect(within(row).getByTestId('usage-funding').textContent).toMatch(/BYOK/)
  })

  it('22. the details affordance explains the basis, the source and the effective date', async () => {
    respond(payload([event('g1', 'input_tokens', 24800, estimatedCost('0.0372'))]))
    await ready()
    const title = screen.getByTestId('usage-cost').getAttribute('title') ?? ''
    expect(title).toMatch(/preço de tabela público do provedor/)
    expect(title).toMatch(/fatura real na sua conta do provedor pode ser diferente/)
    expect(title).toMatch(/Fonte: Gemini API pricing .*https:\/\/ai\.google\.dev\/gemini-api\/docs\/pricing/)
    expect(title).toMatch(/Preço em vigor desde 19\/05\/2026; consultado em 09\/10\/2026/)
  })

  it('21. an unpriceable row says "Preço indisponível" with the reason - never a zero amount', async () => {
    respond(
      payload([
        event('k1', 'credits', 18, unavailable('measurement_not_provider_reported'), { provider: 'kling', transport: 'mcp', model: 'kling-video-v3_0', measurement_source: 'balance_delta', funding: null }),
        event('g-unknown', null, null, unavailable('usage_unknown')),
        event('g-amb', 'input_tokens', 10, { status: 'ambiguous', reason: 'service_tier_not_proven' } as Cost),
      ]),
    )
    await ready()
    const costs = screen.getAllByTestId('usage-cost')
    expect(costs.map((c) => c.textContent)).toEqual(['Preço indisponível', 'Preço indisponível', 'Preço indisponível'])
    expect(costs.map((c) => c.getAttribute('data-status'))).toEqual(['unavailable', 'unavailable', 'ambiguous'])
    expect(costs[0].getAttribute('title')).toMatch(/inferido/)
    expect(costs[2].getAttribute('title')).toMatch(/nível de serviço/)
    expect(document.body.textContent).not.toMatch(/US\$\s?0,00(?![0-9])/)
    expect(screen.getByTestId('usage-cost-none').textContent).toMatch(/Nenhum registro exibido tem preço disponível/)
    expect(screen.queryAllByTestId('usage-cost-total')).toHaveLength(0)
  })

  it('17. the summary sums only priced rows, counts the unpriced ones and says they are not zero', async () => {
    respond(
      payload([
        event('a', 'input_tokens', 1000, estimatedCost('0.0015')),
        event('b', 'output_tokens', 1000, estimatedCost('0.009')),
        event('c', 'tokens', 5, unavailable('unit_not_priceable')),
        event('d', null, null, unavailable('usage_unknown')),
      ]),
    )
    await ready()
    const total = screen.getByTestId('usage-cost-total')
    expect(total.getAttribute('data-currency')).toBe('USD')
    expect(total.textContent).toMatch(/US\$\s0,0105.*2 registros com preço/)
    expect(screen.getByTestId('usage-cost-unpriced').textContent).toMatch(/2 registros sem preço disponível — não entram no total e não valem zero/)
    expect(screen.getByTestId('usage-cost-disclaimer').textContent).toMatch(/Estimativa pelo preço de tabela público do provedor\. Não é o valor cobrado/)
  })

  it('totals follow the filters and never mix currencies', async () => {
    respond(
      payload([
        event('a', 'input_tokens', 1000, estimatedCost('1.5')),
        event('e', 'input_tokens', 1000, estimatedCost('2', { currency: 'EUR' }), { provider: 'kling', model: 'kling-v3' }),
      ]),
    )
    await ready()
    expect(screen.getAllByTestId('usage-cost-total').map((t) => t.getAttribute('data-currency'))).toEqual(['EUR', 'USD'])
    await selectOption('usage-filter-provider', 'Kling')
    expect(screen.getAllByTestId('usage-cost-total').map((t) => t.getAttribute('data-currency'))).toEqual(['EUR'])
  })

  it('23. nothing on the screen claims the provider charged this amount', async () => {
    respond(payload([event('g1', 'input_tokens', 24800, estimatedCost('0.0372')), event('k', 'credits', 18, unavailable('unit_not_priceable'))]))
    await ready()
    const text = (document.body.textContent ?? '') + screen.getAllByTestId('usage-cost').map((el) => el.getAttribute('title')).join(' ')
    expect(text).not.toMatch(/foi cobrado|cobrado pelo provedor|você pagou|fatura de|total pago|custo real/i)
    expect(text).toMatch(/Custo estimado/)
  })

  it('24. a payload without estimated_cost (older API) keeps the original usage view and shows no cost block', async () => {
    respond(payload([event('x1', 'credits', 18, undefined, { provider: 'kling', transport: 'mcp', funding: null }), event('x2', 'units', 3, undefined, { provider: 'kling', funding: null })]))
    await ready()
    expect(screen.queryByTestId('usage-cost-summary')).toBeNull()
    expect(screen.queryAllByTestId('usage-cost')).toHaveLength(0)
    expect(screen.getAllByTestId('usage-row')).toHaveLength(2)
    expect(screen.getAllByTestId('usage-summary-group')).toHaveLength(2)
  })
})
