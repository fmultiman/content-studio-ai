'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { summarizeEstimatedCost } from '@/lib/usage/pricing/aggregate'
import {
  ESTIMATED_COST_LABEL,
  PARTIAL_ESTIMATED_COST_LABEL,
  PRICING_UNAVAILABLE_LABEL,
  SIMULATED_COST_LABEL,
  costState,
  describeCostCoverage,
  estimatedCostDetails,
  formatEstimatedAmount,
  unpricedReason,
} from '@/lib/usage/pricing/presentation'
import {
  connectionName,
  DEFAULT_USAGE_FILTERS,
  filterUsageEvents,
  formatUsageQuantity,
  fundingLabel,
  measurementSourceHelp,
  measurementSourceLabel,
  operationLabel,
  providerLabel,
  summarizeUsage,
  transportLabel,
  type UsageFilters,
  type UsageHistoryResponse,
  type UsagePeriod,
} from '@/lib/usage/provider-usage'

// AI_PROVIDER_USAGE_LEDGER_AND_HISTORY_V1 — "Uso e custos" (Settings), read-only.
//
// Shows what each AI provider execution used, in the provider's OWN unit and with
// how the number was obtained. It is usage observability, not billing: nothing
// here is a price, and quantities in different units are never added together.
//
// PROVIDER_PRICING_REGISTRY_AND_ESTIMATED_COST_V1: next to the usage, a row may show an ESTIMATED cost (the
// provider's public list price x the measured usage). It is derived by the API, labelled as an estimate, never
// described as what was charged, and a row without a published price says "Preço indisponível" - never zero.

type LoadState = 'loading' | 'ready' | 'failed'

const PERIOD_LABEL: Record<UsagePeriod, string> = {
  all: 'Todo o período',
  '7d': 'Últimos 7 dias',
  '30d': 'Últimos 30 dias',
  '90d': 'Últimos 90 dias',
}

const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

export function UsageHistory() {
  const [state, setState] = useState<LoadState>('loading')
  const [data, setData] = useState<UsageHistoryResponse | null>(null)
  const [filters, setFilters] = useState<UsageFilters>(DEFAULT_USAGE_FILTERS)

  const request = useCallback(async (): Promise<UsageHistoryResponse> => {
    const response = await fetch('/api/settings/usage')
    if (!response.ok) throw new Error(`status ${response.status}`)
    return (await response.json()) as UsageHistoryResponse
  }, [])

  // Initial load (state already starts as 'loading').
  useEffect(() => {
    let cancelled = false
    request()
      .then((body) => {
        if (cancelled) return
        setData(body)
        setState('ready')
      })
      .catch(() => {
        // A failed load is NOT "no usage".
        if (!cancelled) setState('failed')
      })
    return () => {
      cancelled = true
    }
  }, [request])

  const retry = () => {
    setState('loading')
    request()
      .then((body) => {
        setData(body)
        setState('ready')
      })
      .catch(() => setState('failed'))
  }

  const events = useMemo(() => data?.events ?? [], [data])
  const visible = useMemo(() => filterUsageEvents(events, filters), [events, filters])
  const summary = useMemo(() => summarizeUsage(visible), [visible])
  const showCost = useMemo(() => visible.some((event) => event.estimated_cost !== undefined), [visible])
  const costSummary = useMemo(() => summarizeEstimatedCost(visible.map((event) => event.estimated_cost)), [visible])

  const providers = useMemo(() => [...new Set(events.map((event) => event.provider))].sort(), [events])
  const transports = useMemo(() => [...new Set(events.map((event) => event.transport))].sort(), [events])
  const projectOptions = useMemo(() => {
    const ids = [...new Set(events.map((event) => event.project_id).filter((id): id is string => !!id))]
    return ids.map((id) => ({ id, name: data?.projects[id] ?? 'Projeto removido ou indisponível' }))
  }, [events, data])

  const update = (patch: Partial<UsageFilters>) => setFilters((previous) => ({ ...previous, ...patch }))

  return (
    <section className="space-y-4" aria-labelledby="usage-history-title" data-testid="usage-history">
      <div>
        <h2 id="usage-history-title" className="text-lg font-semibold">Uso e custos</h2>
        <p className="text-sm text-muted-foreground" data-testid="usage-disclaimer">
          O que cada execução de IA consumiu, na unidade de cada provedor (créditos, unidades, tokens…). As quantidades de uso não são
          convertidas entre si. Quando o provedor publica preço, mostramos também um custo estimado pelo preço de tabela — não é o valor
          cobrado. Execuções anteriores a este registro só aparecem quando foram importadas com evidência verificada.
        </p>
      </div>

      {state === 'loading' && (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground" data-testid="usage-loading">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando histórico de uso…
        </div>
      )}

      {state === 'failed' && (
        <div className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-4" role="alert" data-testid="usage-failed">
          <p className="text-sm font-medium">Não foi possível carregar o histórico de uso.</p>
          <p className="text-xs text-muted-foreground">Isso é uma falha temporária de carregamento — não significa que não houve uso.</p>
          <Button size="sm" variant="outline" onClick={retry}>
            Tentar novamente
          </Button>
        </div>
      )}

      {state === 'ready' && events.length === 0 && (
        <div className="rounded-md border border-border/50 bg-card/30 p-6 text-sm" data-testid="usage-empty">
          <p className="font-medium">Nenhum uso registrado ainda.</p>
          <p className="mt-1 text-muted-foreground">
            Cada vídeo gerado com IA e cada revisão feita com o Gemini passam a aparecer aqui.
          </p>
        </div>
      )}

      {state === 'ready' && events.length > 0 && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="usage-filters">
            <div className="space-y-1.5">
              <Label htmlFor="usage-filter-period">Período</Label>
              <Select value={filters.period} onValueChange={(value) => update({ period: value as UsagePeriod })}>
                <SelectTrigger id="usage-filter-period" data-testid="usage-filter-period">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PERIOD_LABEL) as UsagePeriod[]).map((period) => (
                    <SelectItem key={period} value={period}>{PERIOD_LABEL[period]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="usage-filter-provider">Provedor</Label>
              <Select value={filters.provider} onValueChange={(value) => update({ provider: value })}>
                <SelectTrigger id="usage-filter-provider" data-testid="usage-filter-provider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os provedores</SelectItem>
                  {providers.map((provider) => (
                    <SelectItem key={provider} value={provider}>{providerLabel(provider)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="usage-filter-transport">Conexão</Label>
              <Select value={filters.transport} onValueChange={(value) => update({ transport: value })}>
                <SelectTrigger id="usage-filter-transport" data-testid="usage-filter-transport">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">API e MCP</SelectItem>
                  {transports.map((transport) => (
                    <SelectItem key={transport} value={transport}>{transportLabel(transport)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="usage-filter-project">Projeto</Label>
              <Select value={filters.projectId} onValueChange={(value) => update({ projectId: value })}>
                <SelectTrigger id="usage-filter-project" data-testid="usage-filter-project">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os projetos</SelectItem>
                  {projectOptions.map((project) => (
                    <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2 rounded-md border border-border/50 bg-card/30 p-4" data-testid="usage-summary">
            <p className="text-sm font-medium">Resumo por unidade</p>
            {summary.groups.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="usage-summary-none">
                Nenhum consumo medido nos registros exibidos.
              </p>
            ) : (
              <ul className="space-y-1 text-sm">
                {summary.groups.map((group) => (
                  <li key={`${group.provider}|${group.transport}|${group.unit}|${group.usageCategory ?? ''}|${group.measurementSource}`} data-testid="usage-summary-group">
                    <span className="font-medium">{providerLabel(group.provider)} · {transportLabel(group.transport)}:</span>{' '}
                    {formatUsageQuantity({ quantity: group.quantity, unit: group.unit, usage_category: group.usageCategory })}{' '}
                    <span className="text-xs text-muted-foreground">
                      ({measurementSourceLabel(group.measurementSource)}; {group.events} {group.events === 1 ? 'execução' : 'execuções'})
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {summary.unknownEvents > 0 && (
              <p className="text-xs text-muted-foreground" data-testid="usage-summary-unknown">
                {summary.unknownEvents} {summary.unknownEvents === 1 ? 'execução' : 'execuções'} sem consumo informado pelo provedor — não entram em nenhum total.
              </p>
            )}
            {showCost && (
              <div className="space-y-1 border-t border-border/50 pt-2" data-testid="usage-cost-summary">
                <p className="text-sm font-medium" data-testid="usage-cost-heading" data-complete={costSummary.complete ? 'true' : 'false'}>
                  {costSummary.totals.length > 0 && !costSummary.complete ? PARTIAL_ESTIMATED_COST_LABEL : ESTIMATED_COST_LABEL} (preço de tabela)
                </p>
                {costSummary.totals.length === 0 ? (
                  <p className="text-sm text-muted-foreground" data-testid="usage-cost-none">
                    Nenhum registro exibido tem preço disponível.
                  </p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {costSummary.totals.map((total) => (
                      <li key={total.currency} data-testid="usage-cost-total" data-currency={total.currency}>
                        <span className="font-medium">{formatEstimatedAmount(total.amount, total.currency)}</span>{' '}
                        <span className="text-xs text-muted-foreground">
                          ({total.pricedEvents} {total.pricedEvents === 1 ? 'registro com preço' : 'registros com preço'})
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {costSummary.simulatedEvents > 0 && (
                  <p className="text-xs text-muted-foreground" data-testid="usage-cost-simulated">
                    {costSummary.simulatedTotals.map((total) => formatEstimatedAmount(total.amount, total.currency)).join(' + ')} em simulação a preço atual para{' '}
                    {costSummary.simulatedEvents} {costSummary.simulatedEvents === 1 ? 'registro anterior' : 'registros anteriores'} à primeira tabela de preços — fora do total estimado.
                  </p>
                )}
                {costSummary.unpricedEvents > 0 && (
                  <p className="text-xs text-muted-foreground" data-testid="usage-cost-unpriced">
                    {costSummary.unpricedEvents} {costSummary.unpricedEvents === 1 ? 'registro' : 'registros'} sem preço disponível — não entram no total e não valem zero.
                  </p>
                )}
                {!costSummary.complete && costSummary.totalEvents > 0 && (
                  <p className="text-xs font-medium" data-testid="usage-cost-coverage">
                    Cobertura: {describeCostCoverage(costSummary)}
                  </p>
                )}
                <p className="text-xs text-muted-foreground" data-testid="usage-cost-disclaimer">
                  Estimativa pelo preço de tabela público do provedor. Não é o valor cobrado: com chave própria (BYOK), a fatura real na sua conta pode ser diferente.
                </p>
              </div>
            )}
          </div>

          {visible.length === 0 ? (
            <div className="rounded-md border border-border/50 bg-card/30 p-4 text-sm text-muted-foreground" data-testid="usage-no-match">
              Nenhum registro corresponde aos filtros.
            </div>
          ) : (
            <ul className="divide-y divide-border/50 rounded-md border border-border/50 bg-card/30" data-testid="usage-list">
              {visible.map((event) => {
                const connection = connectionName(event, data?.connections ?? {})
                const project = event.project_id ? (data?.projects[event.project_id] ?? null) : null
                return (
                  <li key={event.id} className="grid gap-1 p-4 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start" data-testid="usage-row" data-transport={event.transport}>
                    <div className="min-w-0 space-y-0.5">
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        <span data-testid="usage-provider">{providerLabel(event.provider)}</span>
                        <span className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide" data-testid="usage-transport">
                          {transportLabel(event.transport)}
                        </span>
                        {connection && <span className="font-normal text-muted-foreground" data-testid="usage-connection">{connection}</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {event.model && <span data-testid="usage-model">{event.model}</span>}
                        {event.model ? ' · ' : ''}
                        <span data-testid="usage-operation">{operationLabel(event.operation)}</span>
                        {project ? ` · ${project}` : ''}
                      </p>
                      <p className="text-xs text-muted-foreground" data-testid="usage-date">{dateFormat.format(new Date(event.occurred_at))}</p>
                      {fundingLabel(event.funding) && (
                        <p className="text-xs text-muted-foreground" data-testid="usage-funding">{fundingLabel(event.funding)}</p>
                      )}
                      {event.historical_import && (
                        <p className="text-xs text-muted-foreground" data-testid="usage-historical">Importado de prova histórica verificada</p>
                      )}
                    </div>
                    <div className="sm:text-right">
                      <p className="font-medium" data-testid="usage-quantity" data-known={event.quantity !== null ? 'true' : 'false'}>
                        {formatUsageQuantity(event)}
                      </p>
                      <p className="text-xs text-muted-foreground" data-testid="usage-source" title={measurementSourceHelp(event.measurement_source)}>
                        {event.quantity === null ? measurementSourceLabel('unknown') : `Medição: ${measurementSourceLabel(event.measurement_source).toLowerCase()}`}
                      </p>
                      {event.estimated_cost && event.estimated_cost.status === 'estimated' && (
                        <p
                          className="text-xs text-muted-foreground"
                          tabIndex={0}
                          data-testid="usage-cost"
                          data-status="estimated"
                          title={estimatedCostDetails(event.estimated_cost).join(' · ')}
                        >
                          {ESTIMATED_COST_LABEL}: {formatEstimatedAmount(event.estimated_cost.amount, event.estimated_cost.currency)}
                        </p>
                      )}
                      {event.estimated_cost && event.estimated_cost.status === 'simulated' && (
                        <p
                          className="text-xs text-muted-foreground"
                          tabIndex={0}
                          data-testid="usage-cost"
                          data-status="simulated"
                          title={estimatedCostDetails(event.estimated_cost).join(' · ')}
                        >
                          {SIMULATED_COST_LABEL}: {formatEstimatedAmount(event.estimated_cost.amount, event.estimated_cost.currency)}
                        </p>
                      )}
                      {event.estimated_cost && (event.estimated_cost.status === 'unavailable' || event.estimated_cost.status === 'ambiguous') && (
                        <>
                          <p
                            className="text-xs text-muted-foreground"
                            tabIndex={0}
                            data-testid="usage-cost"
                            data-status={event.estimated_cost.status}
                            data-cost-state={costState(event.estimated_cost).key}
                            title={unpricedReason(event.estimated_cost) ?? undefined}
                          >
                            {PRICING_UNAVAILABLE_LABEL}
                          </p>
                          {costState(event.estimated_cost).key === 'unknown' && (
                            <p className="text-xs text-muted-foreground" data-testid="usage-cost-state">{costState(event.estimated_cost).label}</p>
                          )}
                        </>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          {data?.hasMore && (
            <p className="text-xs text-muted-foreground" data-testid="usage-has-more">
              Mostrando os 200 registros mais recentes.
            </p>
          )}
        </>
      )}
    </section>
  )
}
