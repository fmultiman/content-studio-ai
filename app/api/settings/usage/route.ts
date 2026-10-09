import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { listConnectionsForUser } from '@/lib/provider-connections/connections'
import { describeMcpConnection } from '@/lib/video-generation/connections'
import { connectionDisplayName } from '@/lib/video-generation/connection-presentation'
import { costInputFromRow, deriveProviderUsageCost } from '@/lib/usage/pricing/derive'
import { loadPricingVersions } from '@/lib/usage/pricing/load'
import { USAGE_CATEGORIES, USAGE_FUNDING, type UsageCategory, type UsageEventView, type UsageFunding, type UsageHistoryResponse } from '@/lib/usage/provider-usage'

// AI_PROVIDER_USAGE_LEDGER_AND_HISTORY_V1
//
// Read-only usage history for the signed-in user. It reads with the USER's
// session, so the database (RLS SELECT policy on provider_usage_events) is the
// tenant boundary — there is no service-role read here and no write path at all.
// Only safe, display-ready columns are returned: no raw provider metadata, no task
// ids, no idempotency keys. `historical_import`, `usage_category` and `funding` are the only values derived from
// provider_metadata, each through a closed whitelist (nothing free-form is ever forwarded).
//
// PROVIDER_PRICING_REGISTRY_AND_ESTIMATED_COST_V1: each event also gets `estimated_cost`, DERIVED here on read
// (usage x the pricing version effective at occurred_at, from the SELECT-only provider_pricing_versions table).
// Nothing is stored or written. If the registry cannot be loaded the usage still renders and every cost is
// "unavailable" - never zero.

export const dynamic = 'force-dynamic'

const WINDOW = 200

const COLUMNS =
  'id, occurred_at, provider, transport, operation, model, quantity, unit, measurement_source, project_id, connection_id, provider_metadata'

export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    }

    const { data, error } = await supabase
      .from('provider_usage_events')
      .select(COLUMNS)
      .eq('user_id', user.id)
      .order('occurred_at', { ascending: false })
      .limit(WINDOW + 1)

    if (error) {
      // A load failure is NOT "no usage": the client must be able to tell them apart.
      return NextResponse.json({ error: 'Não foi possível carregar o histórico de uso.', code: 'USAGE_UNAVAILABLE' }, { status: 503 })
    }

    const rows = (data ?? []) as Array<Record<string, any>>
    const hasMore = rows.length > WINDOW
    const pricing = await loadPricingVersions(supabase)
    const events: UsageEventView[] = rows.slice(0, WINDOW).map((row) => ({
      id: row.id,
      occurred_at: row.occurred_at,
      provider: row.provider,
      transport: row.transport,
      operation: row.operation,
      model: row.model ?? null,
      // NUMERIC may arrive as a string: normalise, but keep NULL as NULL (unknown is not zero).
      quantity: row.quantity === null || row.quantity === undefined ? null : Number(row.quantity),
      unit: row.unit ?? null,
      measurement_source: row.measurement_source,
      project_id: row.project_id ?? null,
      connection_id: row.connection_id ?? null,
      historical_import: row.provider_metadata?.historical_import === true,
      usage_category: (USAGE_CATEGORIES as readonly unknown[]).includes(row.provider_metadata?.usage_category) ? (row.provider_metadata.usage_category as UsageCategory) : null,
      funding: (USAGE_FUNDING as readonly unknown[]).includes(row.provider_metadata?.funding) ? (row.provider_metadata.funding as UsageFunding) : null,
      estimated_cost: pricing ? deriveProviderUsageCost(costInputFromRow(row), pricing) : { status: 'unavailable', reason: 'pricing_registry_unavailable' },
    }))

    // Names are decoration: if they cannot be loaded the rows still render, and never with an invented name.
    const projects: Record<string, string> = {}
    const projectIds = [...new Set(events.map((event) => event.project_id).filter((id): id is string => !!id))]
    if (projectIds.length > 0) {
      const { data: projectRows } = await supabase.from('projects').select('id, name').in('id', projectIds)
      for (const project of (projectRows ?? []) as Array<{ id: string; name: string | null }>) {
        if (project.name) projects[project.id] = project.name
      }
    }

    const connections: Record<string, string> = {}
    const connectionIds = new Set(events.map((event) => event.connection_id).filter((id): id is string => !!id))
    if (connectionIds.size > 0) {
      try {
        for (const row of await listConnectionsForUser(supabase, user.id)) {
          if (connectionIds.has(row.id)) connections[row.id] = connectionDisplayName(describeMcpConnection(row))
        }
      } catch {
        // leave the names out
      }
    }

    const body: UsageHistoryResponse = { events, projects, connections, hasMore }
    return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[Settings usage] Error:', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
