// AI_PROVIDER_USAGE_LEDGER_AND_HISTORY_V1
//
// Vocabulary and presentation rules for the provider usage ledger. Pure and
// client-safe (no server imports).
//
// The one rule everything here protects: provider-native quantities are NEVER
// converted into, or added to, one another. 18 credits and 3 units are two
// different things, and "unknown" is not "zero".
//
// PROVIDER_PRICING_REGISTRY_AND_ESTIMATED_COST_V1: an event may also carry a DERIVED, ESTIMATED list-price cost
// (`estimated_cost`). It is computed on read from this usage x the pricing registry; the quantity above is
// never changed by it, and it is never described as what the provider charged.

import type { ProviderUsageCost } from './pricing/derive'

export const USAGE_UNITS = [
  'credits',
  'units',
  'tokens',
  'input_tokens',
  'output_tokens',
  'images',
  'seconds',
  'requests',
  'characters',
] as const
export type UsageUnit = (typeof USAGE_UNITS)[number]

/** How a quantity was obtained. `unknown` pairs with a missing quantity. */
export const MEASUREMENT_SOURCES = [
  'provider_reported',
  'balance_delta',
  'estimated',
  'derived',
  'manual_import',
  'unknown',
] as const
export type MeasurementSource = (typeof MEASUREMENT_SOURCES)[number]

/** A measured (known) quantity: always a number, a unit and a real source. */
export interface UsageMeasurement {
  quantity: number
  unit: UsageUnit
  source: Exclude<MeasurementSource, 'unknown'>
}

// `image_output` = Gemini IMAGE-modality output tokens; `output_unattributed` = Gemini output tokens reported without a modality
// breakdown. Both are unit `tokens` on purpose: they are never `output_tokens`, which is priced as ordinary text output.
export const USAGE_CATEGORIES = ['thoughts', 'image_output', 'output_unattributed'] as const
export type UsageCategory = (typeof USAGE_CATEGORIES)[number]
export const USAGE_FUNDING = ['user_byok', 'content_studio_credits'] as const
export type UsageFunding = (typeof USAGE_FUNDING)[number]

/** The safe, client-facing shape of one ledger row. */
export interface UsageEventView {
  id: string
  occurred_at: string
  provider: string
  transport: string
  operation: string
  model: string | null
  quantity: number | null
  unit: UsageUnit | null
  measurement_source: MeasurementSource
  project_id: string | null
  connection_id: string | null
  /**
   * Provider-native sub-kind of a unit that would otherwise be ambiguous. `thoughts` = Gemini thinking tokens, which the
   * provider reports apart from output tokens and which are therefore never merged with them. Whitelisted by the API.
   */
  usage_category?: UsageCategory | null
  /** Who paid the provider: `user_byok` = the user's own provider key (provider usage, NOT Content Studio spend). */
  funding?: UsageFunding | null
  /** True for an event imported from a verified historical proof (inserted after the fact, measured as stated). */
  historical_import?: boolean
  /**
   * Derived on read: usage x the pricing version effective at `occurred_at`. ESTIMATED list-price equivalent, never the
   * provider's invoice. Absent only in a payload that predates pricing; `unavailable`/`ambiguous` carry no amount.
   */
  estimated_cost?: ProviderUsageCost
}

export interface UsageHistoryResponse {
  events: UsageEventView[]
  /** project id -> name, only for projects that appear in `events`. */
  projects: Record<string, string>
  /** connection id -> product-facing name, only for account connections that appear in `events`. */
  connections: Record<string, string>
  /** True when older events exist beyond the returned window. */
  hasMore: boolean
}

// ---------------------------------------------------------------------------
// Labels (pt-BR product language)
// ---------------------------------------------------------------------------

const UNIT_LABEL: Record<UsageUnit, { one: string; other: string }> = {
  credits: { one: 'crédito', other: 'créditos' },
  units: { one: 'unidade', other: 'unidades' },
  tokens: { one: 'token', other: 'tokens' },
  input_tokens: { one: 'token de entrada', other: 'tokens de entrada' },
  output_tokens: { one: 'token de saída', other: 'tokens de saída' },
  images: { one: 'imagem', other: 'imagens' },
  seconds: { one: 'segundo', other: 'segundos' },
  requests: { one: 'requisição', other: 'requisições' },
  characters: { one: 'caractere', other: 'caracteres' },
}

export function unitLabel(unit: UsageUnit, quantity: number): string {
  return quantity === 1 ? UNIT_LABEL[unit].one : UNIT_LABEL[unit].other
}

const SOURCE_LABEL: Record<MeasurementSource, string> = {
  provider_reported: 'Informado pelo provedor',
  balance_delta: 'Diferença de saldo',
  estimated: 'Estimado',
  derived: 'Derivado (não medido pelo provedor)',
  manual_import: 'Importado manualmente',
  unknown: 'Uso não informado pelo provedor',
}

export function measurementSourceLabel(source: MeasurementSource): string {
  return SOURCE_LABEL[source]
}

/** Longer explanation for a tooltip / help line: why the number can (not) be trusted as per-task usage. */
const SOURCE_HELP: Record<MeasurementSource, string> = {
  provider_reported: 'O provedor informou este consumo para esta execução.',
  balance_delta: 'Calculado pela diferença de saldo da conta; pode incluir outras execuções ao mesmo tempo.',
  estimated: 'Valor estimado pelo Content Studio, não informado pelo provedor.',
  derived: 'Calculado pelo Content Studio a partir de outros dados (por exemplo, a duração pedida de um vídeo entregue). Não é uma medição do provedor.',
  manual_import: 'Registrado manualmente.',
  unknown: 'A execução aconteceu, mas o provedor não informou quanto foi consumido.',
}

export function measurementSourceHelp(source: MeasurementSource): string {
  return SOURCE_HELP[source]
}

const OPERATION_LABEL: Record<string, string> = {
  text_to_video: 'Texto → Vídeo',
  image_to_video: 'Imagem → Vídeo',
  image_review: 'Revisão de imagem',
  image_generation: 'Geração de imagem',
  video_review: 'Revisão de vídeo',
}

export function operationLabel(operation: string): string {
  return OPERATION_LABEL[operation] ?? operation
}

const PROVIDER_LABEL: Record<string, string> = { kling: 'Kling', openai: 'OpenAI', replicate: 'Replicate', gemini: 'Gemini' }

export function providerLabel(provider: string): string {
  return PROVIDER_LABEL[provider] ?? provider
}

/** "API" for the REST/API transport, "MCP" for the connected-account transport; anything else shown as-is. */
export function transportLabel(transport: string): string {
  if (transport === 'rest') return 'API'
  if (transport === 'mcp') return 'MCP'
  return transport.toUpperCase()
}

const NUMBER_FORMAT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 })

/** "18 créditos" — or an honest "Uso não informado" when the quantity is unknown (never "0"). */
export function formatUsageQuantity(event: Pick<UsageEventView, 'quantity' | 'unit'> & { usage_category?: UsageCategory | null }): string {
  if (event.quantity === null || event.unit === null) return 'Uso não informado'
  if (event.usage_category === 'thoughts' && event.unit === 'tokens') {
    return `${NUMBER_FORMAT.format(event.quantity)} ${event.quantity === 1 ? 'token de raciocínio' : 'tokens de raciocínio'}`
  }
  if (event.usage_category === 'image_output' && event.unit === 'tokens') {
    return `${NUMBER_FORMAT.format(event.quantity)} ${event.quantity === 1 ? 'token de saída de imagem' : 'tokens de saída de imagem'}`
  }
  if (event.usage_category === 'output_unattributed' && event.unit === 'tokens') {
    return `${NUMBER_FORMAT.format(event.quantity)} ${event.quantity === 1 ? 'token de saída (modalidade não informada)' : 'tokens de saída (modalidade não informada)'}`
  }
  return `${NUMBER_FORMAT.format(event.quantity)} ${unitLabel(event.unit, event.quantity)}`
}

/** Funding line for a row; null when the ledger did not record it (never invented). */
export function fundingLabel(funding: UsageFunding | null | undefined): string | null {
  if (funding === 'user_byok') return 'Chave própria (BYOK): consumo na sua conta do provedor — o valor cobrado depende do seu plano'
  return null
}

/** Connection line: the account connection's name if known, "Kling API" for REST, otherwise nothing (never invented). */
export function connectionName(
  event: Pick<UsageEventView, 'provider' | 'transport' | 'connection_id'>,
  connections: Readonly<Record<string, string>>,
): string | null {
  if (event.transport === 'rest') return `${providerLabel(event.provider)} API`
  return event.connection_id ? (connections[event.connection_id] ?? null) : null
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export type UsagePeriod = '7d' | '30d' | '90d' | 'all'

export interface UsageFilters {
  period: UsagePeriod
  provider: string | 'all'
  transport: string | 'all'
  projectId: string | 'all'
}

export const DEFAULT_USAGE_FILTERS: UsageFilters = { period: 'all', provider: 'all', transport: 'all', projectId: 'all' }

const PERIOD_DAYS: Record<Exclude<UsagePeriod, 'all'>, number> = { '7d': 7, '30d': 30, '90d': 90 }

export function filterUsageEvents(events: UsageEventView[], filters: UsageFilters, now: Date = new Date()): UsageEventView[] {
  const since = filters.period === 'all' ? null : now.getTime() - PERIOD_DAYS[filters.period] * 86_400_000
  return events.filter((event) => {
    if (since !== null && new Date(event.occurred_at).getTime() < since) return false
    if (filters.provider !== 'all' && event.provider !== filters.provider) return false
    if (filters.transport !== 'all' && event.transport !== filters.transport) return false
    if (filters.projectId !== 'all' && event.project_id !== filters.projectId) return false
    return true
  })
}

// ---------------------------------------------------------------------------
// Summary — grouped, never one universal total
// ---------------------------------------------------------------------------

export interface UsageSummaryGroup {
  provider: string
  transport: string
  /** Sum of KNOWN quantities in this unit, only. */
  unit: UsageUnit
  /** Distinguishes provider-native kinds sharing a unit (Gemini thinking tokens vs plain tokens). */
  usageCategory: UsageCategory | null
  measurementSource: MeasurementSource
  quantity: number
  events: number
}

export interface UsageSummary {
  /** One group per (provider, transport, unit, measurement source): quantities in different units or measured differently are never added. */
  groups: UsageSummaryGroup[]
  /** Executions whose usage is unknown: counted, contributing nothing to any total. */
  unknownEvents: number
}

export function summarizeUsage(events: UsageEventView[]): UsageSummary {
  const groups = new Map<string, UsageSummaryGroup>()
  let unknownEvents = 0
  for (const event of events) {
    if (event.quantity === null || event.unit === null) {
      unknownEvents += 1
      continue
    }
    const key = [event.provider, event.transport, event.unit, event.usage_category ?? '', event.measurement_source].join('|')
    const group = groups.get(key)
    if (group) {
      group.quantity += event.quantity
      group.events += 1
    } else {
      groups.set(key, {
        provider: event.provider,
        transport: event.transport,
        unit: event.unit,
        usageCategory: event.usage_category ?? null,
        measurementSource: event.measurement_source,
        quantity: event.quantity,
        events: 1,
      })
    }
  }
  return {
    groups: [...groups.values()].sort((a, b) => `${a.provider}${a.transport}${a.unit}`.localeCompare(`${b.provider}${b.transport}${b.unit}`)),
    unknownEvents,
  }
}
