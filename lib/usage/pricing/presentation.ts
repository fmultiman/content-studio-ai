// PROVIDER_PRICING_REGISTRY_AND_ESTIMATED_COST_V1 — pt-BR product language for estimated cost. Pure and client-safe.
//
// Vocabulary rule: this is an ESTIMATE of the provider's PUBLIC LIST price for the measured usage. It is never
// described as what the provider charged ("cobrado"), and an unpriced row is "Preço indisponível" - never R$/US$ 0.

import type { EstimatedCostSummary } from './aggregate'
import { parseFixed, roundToUnits } from './decimal'
import type { CostAmbiguousReason, CostAssumption, CostUnavailableReason, ProviderUsageCost } from './derive'

export const ESTIMATED_COST_LABEL = 'Custo estimado'
/** FUTURE-064 Slice D: the headline of a total that omits one or more unpriced rows. */
export const PARTIAL_ESTIMATED_COST_LABEL = 'Custo estimado parcial'
export const PRICING_UNAVAILABLE_LABEL = 'Preço indisponível'
/** PROVIDER_COST_ATTRIBUTION_V1: an execution that predates the first known price, shown ONLY as a what-if at the earliest known price. */
export const SIMULATED_COST_LABEL = 'Simulação a preço atual'
export const USAGE_UNKNOWN_LABEL = 'Consumo desconhecido'
export const ACTUAL_BILLING_UNAVAILABLE_LABEL = 'Valor cobrado não disponível'

const DISPLAY_DIGITS = 4

/** "US$ 0,0042". Rounds half-up for DISPLAY only, from the exact decimal; a non-zero amount never shows as zero. */
export function formatEstimatedAmount(amount: string, currency: string): string {
  const exact = parseFixed(amount)
  if (exact === null) return '—'
  const units = roundToUnits(exact, DISPLAY_DIGITS)
  const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: DISPLAY_DIGITS })
  if (units === BigInt(0) && exact > BigInt(0)) return `< ${money.format(1 / 10 ** DISPLAY_DIGITS)}`
  // `units` is bounded by what a usage ledger can hold; Number() of the 4-digit-rounded value is exact at this precision.
  return money.format(Number(units) / 10 ** DISPLAY_DIGITS)
}

const UNAVAILABLE_REASON: Record<CostUnavailableReason, string> = {
  usage_unknown: 'O provedor não informou o consumo desta execução.',
  invalid_usage: 'O consumo registrado está em um formato não reconhecido.',
  invalid_timestamp: 'A data da execução não é válida.',
  measurement_not_provider_reported: 'O consumo não foi informado pelo provedor (foi inferido), então não é convertido em valor.',
  provider_not_supported: 'Ainda não há tabela de preços oficial para este provedor.',
  unit_not_priceable: 'Esta unidade de consumo não tem conversão oficial para dinheiro.',
  output_modality_unattributed: 'O provedor não informou a modalidade da saída (imagem ou texto), então não é convertida em valor.',
  input_modality_unattributed: 'O provedor não informou a divisão da entrada (texto e imagem), que têm tarifas diferentes, então não é convertida em valor.',
  resolution_unknown: 'A resolução do vídeo não foi registrada, e o preço por segundo depende dela.',
  model_unknown: 'O modelo desta execução não foi registrado.',
  no_pricing_for_model: 'Não há preço oficial cadastrado para este modelo.',
  no_pricing_for_category: 'Não há preço oficial cadastrado para este tipo de consumo.',
  pricing_not_effective_at_execution: 'Nenhum preço cadastrado estava em vigor na data desta execução.',
  inconsistent_usage: 'Os números de consumo informados são inconsistentes entre si.',
  mixed_currency: 'Os preços aplicáveis estão em moedas diferentes.',
  pricing_registry_unavailable: 'A tabela de preços não pôde ser carregada agora.',
}

const AMBIGUOUS_REASON: Record<CostAmbiguousReason, string> = {
  service_tier_not_proven: 'O nível de serviço (padrão, flex ou prioridade) não foi informado e o preço depende dele.',
  overlapping_pricing_versions: 'Há mais de um preço em vigor para esta execução.',
  tool_use_tokens_not_priced: 'Há tokens de uso de ferramentas que não estão registrados separadamente.',
}

const ASSUMPTION: Record<CostAssumption, string> = {
  list_price_equivalent: 'Estimativa pelo preço de tabela público do provedor — não é o valor cobrado.',
  paid_tier_list_price: 'Considera a tabela do plano pago; no plano gratuito do provedor não há cobrança.',
  byok_invoice_may_differ: 'Chave própria (BYOK): a fatura real na sua conta do provedor pode ser diferente.',
  cached_tokens_priced_separately: 'Tokens em cache foram calculados com a tarifa de cache.',
  service_tier_sole_registry_tier: 'O provedor não informou o nível de serviço; foi usado o nível padrão porque é o único com preço cadastrado para este modelo.',
  price_observed_at_source: 'O provedor não publica histórico de preços: este preço vale a partir do dia em que foi observado na página oficial; execuções anteriores não são estimadas — aparecem apenas como simulação a preço atual, fora dos totais estimados.',
  usage_derived_from_request: 'O provedor não informa os segundos gerados: a duração é a do pedido entregue, calculada pelo Content Studio (não medida pelo provedor).',
  modalities_priced_separately: 'Tokens de texto e de imagem foram calculados com tarifas diferentes, sem contar nenhum token duas vezes.',
  kling_package_price_unknown: 'Unidades Kling são calculadas pelo preço público de tabela; o preço real da unidade depende do pacote de recursos da sua conta.',
  current_price_simulation: 'A execução é anterior ao primeiro preço cadastrado: o valor aplica o preço mais antigo conhecido (atual) e é apenas uma simulação, não uma estimativa do período.',
}

/** One short line for why a row has no estimate; null for an estimated row. */
export function unpricedReason(cost: ProviderUsageCost | null | undefined): string | null {
  if (!cost) return UNAVAILABLE_REASON.pricing_registry_unavailable
  if (cost.status === 'unavailable') return UNAVAILABLE_REASON[cost.reason]
  if (cost.status === 'ambiguous') return AMBIGUOUS_REASON[cost.reason]
  return null
}

const dateOnly = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'UTC' })

/** Tooltip / details lines for an estimated row: what the number is, where the price came from and since when. */
export function estimatedCostDetails(cost: Extract<ProviderUsageCost, { status: 'estimated' | 'simulated' }>): string[] {
  return [
    ...cost.assumptions.map((assumption) => ASSUMPTION[assumption]),
    `Nível de serviço: ${cost.serviceTier}.`,
    `Fonte: ${cost.pricing.sourceLabel} (${cost.pricing.sourceUrl}).`,
    `Preço em vigor desde ${dateOnly.format(new Date(cost.pricing.effectiveFrom))}; consultado em ${dateOnly.format(new Date(cost.pricing.retrievedAt))}.`,
    `${ACTUAL_BILLING_UNAVAILABLE_LABEL}.`,
  ]
}

export type CostStateKey = 'estimated' | 'simulated' | 'unknown' | 'unpriced'

/** The per-row state in product language: estimated / simulated / unknown consumption / no price. Never "zero". */
export function costState(cost: ProviderUsageCost | null | undefined): { key: CostStateKey; label: string } {
  if (cost?.status === 'estimated') return { key: 'estimated', label: ESTIMATED_COST_LABEL }
  if (cost?.status === 'simulated') return { key: 'simulated', label: SIMULATED_COST_LABEL }
  if (cost?.status === 'unavailable' && (cost.reason === 'usage_unknown' || cost.reason === 'measurement_not_provider_reported')) {
    return { key: 'unknown', label: USAGE_UNKNOWN_LABEL }
  }
  return { key: 'unpriced', label: PRICING_UNAVAILABLE_LABEL }
}

const plural = (n: number, one: string, other: string) => `${n} ${n === 1 ? one : other}`

/**
 * One line for the coverage of a total, e.g. "US$ 1,60 estimados + 2 registros sem preço" / "+ US$ 0,0610 simulados a preço atual".
 * An unknown or unpriced row is named, never added as zero.
 */
export function describeCostCoverage(summary: EstimatedCostSummary): string {
  const parts: string[] = []
  const priced = summary.totals.map((total) => formatEstimatedAmount(total.amount, total.currency))
  parts.push(priced.length > 0 ? `${priced.join(' + ')} estimados` : 'Nenhum valor estimado')
  if (summary.simulatedEvents > 0) {
    const simulated = summary.simulatedTotals.map((total) => formatEstimatedAmount(total.amount, total.currency)).join(' + ')
    parts.push(`${simulated} simulados a preço atual (${plural(summary.simulatedEvents, 'registro anterior à tabela', 'registros anteriores à tabela')})`)
  }
  if (summary.unpricedEvents > 0) parts.push(`${plural(summary.unpricedEvents, 'registro sem precificação', 'registros sem precificação')}`)
  return parts.join(' + ')
}
