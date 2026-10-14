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
      effectiveFrom: '2026-10-09T00:00:00.000Z',
      effectiveFromBasis: 'observed_at_source',
    },
    components: [{ category: 'input', quantity: '24800', amount, pricingVersionId: 'v1' }],
    assumptions: ['list_price_equivalent', 'paid_tier_list_price', 'price_observed_at_source', 'byok_invoice_may_differ'],
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
    expect(title).toMatch(/observado na página oficial; execuções anteriores não são estimadas/)
    expect(title).not.toMatch(/lançamento do modelo/)
    expect(title).toMatch(/Fonte: Gemini API pricing .*https:\/\/ai\.google\.dev\/gemini-api\/docs\/pricing/)
    expect(title).toMatch(/Preço em vigor desde 09\/10\/2026; consultado em 09\/10\/2026/)
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

  it('historical rows before the first evidenced rate: every row says "Preço indisponível", usage stays intact, no total is invented', async () => {
    const rows = Array.from({ length: 6 }, (_, i) =>
      event(`h${i}`, i % 3 === 0 ? 'input_tokens' : i % 3 === 1 ? 'output_tokens' : 'tokens', 1000 + i, unavailable('pricing_not_effective_at_execution'), {
        occurred_at: '2026-10-08T17:38:46.000Z',
        usage_category: i % 3 === 2 ? 'thoughts' : null,
      }),
    )
    respond(payload(rows))
    await ready()
    expect(screen.getAllByTestId('usage-row')).toHaveLength(6)
    expect(screen.getAllByTestId('usage-summary-group')).toHaveLength(3)
    expect(screen.getAllByTestId('usage-cost').map((c) => c.textContent)).toEqual(Array(6).fill('Preço indisponível'))
    expect(screen.getByTestId('usage-cost-none')).toBeTruthy()
    expect(screen.queryAllByTestId('usage-cost-total')).toHaveLength(0)
    expect(screen.getByTestId('usage-cost-unpriced').textContent).toMatch(/6 registros sem preço disponível/)
    expect(screen.getAllByTestId('usage-cost')[0].getAttribute('title')).toMatch(/Nenhum preço cadastrado estava em vigor na data desta execução/)
    expect(document.body.textContent).not.toMatch(/US\$/)
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

// FUTURE-064 Slice D — an aggregate that omits unpriced rows is a PARTIAL cost and must say so; a fully priced one keeps the normal label.
describe('partial vs complete estimated cost (aggregate label only)', () => {
  const image = (id: string, unit: UsageEventView['unit'], quantity: number | null, cost: Cost | undefined, extra: Partial<UsageEventView> = {}) =>
    event(id, unit, quantity, cost, { operation: 'image_generation', model: 'gemini-nano-banana-2.1', ...extra })
  const heading = () => screen.getByTestId('usage-cost-heading')

  it('every row priced -> the normal label "Custo estimado" and data-complete=true', async () => {
    respond(payload([image('a', 'input_tokens', 14, estimatedCost('0.000021')), image('b', 'tokens', 1120, estimatedCost('0.0336'), { usage_category: 'image_output' })]))
    await ready()
    expect(heading().textContent).toBe('Custo estimado (preço de tabela)')
    expect(heading().getAttribute('data-complete')).toBe('true')
    expect(screen.queryByTestId('usage-cost-unpriced')).toBeNull()
    expect(screen.getByTestId('usage-cost-total').textContent).toMatch(/US\$\s0,0336/)
  })

  it('some rows unpriced -> "Custo estimado parcial" with the known sum, the unpriced count, and the detailed rows untouched', async () => {
    respond(payload([
      image('a', 'input_tokens', 14, estimatedCost('0.000021')),
      image('b', 'tokens', 1120, unavailable('output_modality_unattributed'), { usage_category: 'output_unattributed' }),
    ]))
    await ready()
    expect(heading().textContent).toBe('Custo estimado parcial (preço de tabela)')
    expect(heading().getAttribute('data-complete')).toBe('false')
    expect(screen.getByTestId('usage-cost-total').textContent).toMatch(/1 registro com preço/)
    expect(screen.getByTestId('usage-cost-unpriced').textContent).toMatch(/1 registro sem preço disponível — não entram no total e não valem zero/)
    // detailed rows are preserved: one estimated row, one "Preço indisponível" row with its reason, no zero anywhere
    const costs = screen.getAllByTestId('usage-cost')
    expect(costs.map((c) => c.getAttribute('data-status'))).toEqual(['estimated', 'unavailable'])
    expect(costs[1].textContent).toBe('Preço indisponível')
    expect(costs[1].getAttribute('title')).toMatch(/não informou a modalidade da saída/)
    expect(document.body.textContent).not.toMatch(/US\$\s?0,00(?![0-9])/)
  })

  it('an unknown-usage execution next to priced rows also makes the total partial', async () => {
    respond(payload([image('a', 'input_tokens', 14, estimatedCost('0.000021')), image('u', null, null, unavailable('usage_unknown'))]))
    await ready()
    expect(heading().textContent).toBe('Custo estimado parcial (preço de tabela)')
  })

  it('nothing priced -> no total and no "parcial" claim (there is no sum to qualify)', async () => {
    respond(payload([image('u', null, null, unavailable('usage_unknown')), image('v', 'input_tokens', 5, unavailable('no_pricing_for_model'))]))
    await ready()
    expect(heading().textContent).toBe('Custo estimado (preço de tabela)')
    expect(screen.getByTestId('usage-cost-none')).toBeTruthy()
    expect(screen.queryAllByTestId('usage-cost-total')).toHaveLength(0)
  })

  it('the label follows the filters: filtering away the unpriced rows turns the remaining total into a complete one', async () => {
    respond(payload([
      image('a', 'input_tokens', 14, estimatedCost('0.000021')),
      event('k', 'credits', 18, unavailable('unit_not_priceable'), { provider: 'kling', transport: 'mcp', model: 'kling-v3', funding: null }),
    ]))
    await ready()
    expect(heading().textContent).toBe('Custo estimado parcial (preço de tabela)')
    await selectOption('usage-filter-provider', 'Gemini')
    expect(heading().textContent).toBe('Custo estimado (preço de tabela)')
    expect(heading().getAttribute('data-complete')).toBe('true')
  })
})

// PROVIDER_COST_ATTRIBUTION_V1 — GPT Image 2 / Veo / Kling on the same screen: estimated, simulated and unknown are different things,
// and a total always states its coverage.
describe('cost attribution states on the usage screen', () => {
  const simulatedCost = (amount: string): Cost =>
    ({
      ...(estimatedCost(amount) as any),
      status: 'simulated',
      basis: 'current_list_price_simulation',
      assumptions: ['list_price_equivalent', 'price_observed_at_source', 'current_price_simulation', 'byok_invoice_may_differ'],
    }) as Cost
  const openaiOut = (id: string, cost: Cost) =>
    event(id, 'output_tokens', 1756, cost, { provider: 'openai', operation: 'image_generation', model: 'gpt-image-2', occurred_at: '2026-10-13T17:20:39.000Z' })
  const veo = (id: string, seconds: number, cost: Cost) =>
    event(id, 'seconds', seconds, cost, { operation: 'image_to_video', model: 'veo-3.1-fast-generate-preview', measurement_source: 'derived', funding: null })
  const klingUnknown = () =>
    event('k-ab', null, null, unavailable('usage_unknown'), { provider: 'kling', operation: 'image_to_video', model: 'kling-v3', funding: null })
  const plain = (text: string | null | undefined) => (text ?? '').replace(/ /g, ' ')

  it('a row before the first known price is shown as a SIMULATION at the current price, with its own label and explanation', async () => {
    respond(payload([openaiOut('o1', simulatedCost('0.05268'))]))
    await ready()
    const cost = screen.getByTestId('usage-cost')
    expect(cost.getAttribute('data-status')).toBe('simulated')
    expect(plain(cost.textContent)).toMatch(/^Simulação a preço atual: US\$ 0,0527$/)
    expect(cost.textContent).not.toMatch(/Custo estimado/)
    expect(cost.getAttribute('title')).toMatch(/simulação, não uma estimativa do período/)
    expect(cost.getAttribute('title')).toMatch(/Valor cobrado não disponível/)
  })

  it('the simulation is kept OUT of the estimated total: nothing estimated -> no total, the simulated figure is stated apart', async () => {
    respond(payload([openaiOut('o1', simulatedCost('0.05268')), openaiOut('o2', simulatedCost('0.008342'))]))
    await ready()
    expect(screen.queryAllByTestId('usage-cost-total')).toHaveLength(0)
    expect(screen.getByTestId('usage-cost-none')).toBeTruthy()
    expect(plain(screen.getByTestId('usage-cost-simulated').textContent)).toMatch(/US\$ 0,061 em simulação a preço atual para\s*2 registros anteriores à primeira tabela de preços — fora do total estimado/)
  })

  it('states the coverage: estimated + simulated + unpriced rows; Kling unknown consumption is never a zero', async () => {
    respond(
      payload([
        veo('v1', 4, estimatedCost('0.4')),
        veo('v2', 4, estimatedCost('0.4')),
        veo('v3', 8, estimatedCost('0.8')),
        openaiOut('o1', simulatedCost('0.05268')),
        openaiOut('o2', simulatedCost('0.008342')),
        klingUnknown(),
      ]),
    )
    await ready()
    expect(screen.getByTestId('usage-cost-heading').textContent).toBe('Custo estimado parcial (preço de tabela)')
    expect(plain(screen.getByTestId('usage-cost-total').textContent)).toMatch(/US\$ 1,60.*3 registros com preço/)
    expect(plain(screen.getByTestId('usage-cost-coverage').textContent)).toBe(
      'Cobertura: US$ 1,60 estimados + US$ 0,061 simulados a preço atual (2 registros anteriores à tabela) + 1 registro sem precificação',
    )
    expect(screen.getByTestId('usage-cost-unpriced').textContent).toMatch(/1 registro sem preço disponível — não entram no total e não valem zero/)
    expect(document.body.textContent).not.toMatch(/US\$\s?0,00(?![0-9])/)
  })

  it('the Kling row with no reported consumption is "Consumo desconhecido" with no amount; a row that merely has no price is not called unknown', async () => {
    respond(payload([klingUnknown(), event('k-mcp', 'credits', 18, unavailable('measurement_not_provider_reported'), { provider: 'kling', transport: 'mcp', funding: null, measurement_source: 'balance_delta' })]))
    await ready()
    const costs = screen.getAllByTestId('usage-cost')
    expect(costs.map((c) => c.getAttribute('data-cost-state'))).toEqual(['unknown', 'unknown'])
    expect(screen.getAllByTestId('usage-cost-state').map((c) => c.textContent)).toEqual(['Consumo desconhecido', 'Consumo desconhecido'])
    expect(costs.every((c) => c.textContent === 'Preço indisponível')).toBe(true)
    const rows = screen.getAllByTestId('usage-row')
    expect(within(rows[0]).getByTestId('usage-quantity').textContent).toBe('Uso não informado')
    expect(within(rows[0]).getByTestId('usage-quantity').getAttribute('data-known')).toBe('false')
    cleanup()
    respond(payload([event('o', 'input_tokens', 5, unavailable('no_pricing_for_model'))]))
    await ready()
    expect(screen.queryByTestId('usage-cost-state')).toBeNull()
    expect(screen.getByTestId('usage-cost').getAttribute('data-cost-state')).toBe('unpriced')
  })

  it('a derived quantity (Veo seconds) says it was derived, not measured by the provider, and is still priced as an estimate', async () => {
    respond(payload([veo('v3', 8, estimatedCost('0.8', { assumptions: ['list_price_equivalent', 'usage_derived_from_request', 'paid_tier_list_price'] }))]))
    await ready()
    const row = screen.getByTestId('usage-row')
    expect(within(row).getByTestId('usage-quantity').textContent).toBe('8 segundos')
    expect(within(row).getByTestId('usage-source').textContent).toBe('Medição: derivado (não medido pelo provedor)')
    expect(within(row).getByTestId('usage-source').getAttribute('title')).toMatch(/Não é uma medição do provedor/)
    expect(within(row).getByTestId('usage-cost').getAttribute('title')).toMatch(/duração é a do pedido entregue/)
    expect(plain(within(row).getByTestId('usage-cost').textContent)).toMatch(/^Custo estimado: US\$ 0,80$/)
  })

  it('every row fully estimated: no coverage warning', async () => {
    respond(payload([veo('v1', 4, estimatedCost('0.4')), veo('v2', 8, estimatedCost('0.8'))]))
    await ready()
    expect(screen.getByTestId('usage-cost-heading').textContent).toBe('Custo estimado (preço de tabela)')
    expect(screen.queryByTestId('usage-cost-coverage')).toBeNull()
    expect(screen.queryByTestId('usage-cost-simulated')).toBeNull()
  })
})
