// VIDEO_GENERATION_CONNECTION_CAPABILITY_ROUTING_V1
//
// Server-side connection descriptors for /videos and the resolver the submit
// route uses. ONE function decides what a connection can do, and both the
// capability endpoint and the submit route call it — so what the form shows is
// exactly what the server will accept.
//
// Connection reference (the value the browser sends back):
//   "kling:api"            the user's Kling API key (REST) — NOT a ProviderConnection row
//   "kling:account:<uuid>" a provider_connections row (Kling MCP OAuth)
// A reference is only a pointer. The server ALWAYS resolves it against the
// authenticated user's own data (ownership-scoped), and nothing the browser
// says about capabilities, transport or scopes is ever trusted.
//
// Freshness rule (MCP capability snapshot, taken by the deliberate
// "check connection" action — never on render):
//   <= 24 h   fresh
//   <= 7 d    stale   (still shown and usable; the UI offers a refresh)
//   >  7 d    expired (blocked until refreshed)
//   no `video` section / older schema   missing (blocked until refreshed)
// A snapshot is capability truth only — it is not a billing ledger and holds
// no credit balance.

import type { SupabaseClient } from '@supabase/supabase-js'
import { getProviderConfigurationState } from '@/lib/credentials/provider-credentials'
import { isVeoVideoGenerationEnabled } from '@/lib/providers/gemini/veo-feature'
import { getOwnedConnection, listConnectionsForUser } from '@/lib/provider-connections/connections'
import { KLING_MCP_GENERATION_CREATE_SCOPE } from '@/lib/provider-connections/kling-mcp'
import { KLING_MCP_VIDEO_SNAPSHOT_VERSION } from '@/lib/provider-connections/kling-mcp-video-capabilities'
import type { ProviderConnectionRow } from '@/lib/provider-connections/types'
import type {
  VideoCapabilityFreshness,
  VideoConnectionBlockedReason,
  VideoGenerationConnectionDescriptor,
  VideoModelCapability,
  VideoOperationCapability,
} from './capabilities'
import { accountConnectionRef, GEMINI_CONNECTION_REF, parseConnectionRef, REST_CONNECTION_REF } from './connection-ref'
import { restVideoOperations } from './rest-capabilities'
import { veoVideoOperations } from './veo-capabilities'

export const CAPABILITY_FRESH_MS = 24 * 60 * 60 * 1000
export const CAPABILITY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export { GEMINI_CONNECTION_REF, REST_CONNECTION_REF, accountConnectionRef, parseConnectionRef, type ParsedConnectionRef } from './connection-ref'

/** Browser-safe copy of a model: drops server-side mapping hints. */
function toClientModel(model: VideoModelCapability): VideoModelCapability {
  const { outputCountArg: _outputCountArg, ...rest } = model
  return { ...rest, durations: [...model.durations], resolutions: [...model.resolutions], aspectRatios: [...model.aspectRatios] }
}

function toClientOperations(operations: VideoOperationCapability[]): VideoOperationCapability[] {
  return operations.map((entry) => ({ operation: entry.operation, models: entry.models.map(toClientModel) }))
}

export function describeRestConnection(state: 'configured' | 'missing'): VideoGenerationConnectionDescriptor {
  const configured = state === 'configured'
  return {
    ref: REST_CONNECTION_REF,
    provider: 'kling',
    connectionMethod: 'api_key',
    transport: 'rest',
    label: 'Kling API',
    detail: 'REST · usa o pacote de recursos da sua API Kling',
    funding: 'kling_api_package',
    status: configured ? 'connected' : 'not_configured',
    canGenerate: configured,
    ...(configured ? {} : { blockedReason: 'not_configured' as const }),
    needsGenerationAuthorization: false,
    accountLabel: null,
    capabilitiesFreshness: 'static',
    capabilitiesCheckedAt: null,
    operations: configured ? toClientOperations(restVideoOperations()) : [],
  }
}

/** Google Veo through the user's own Gemini API key (BYOK). Capabilities are code-backed (veo-capabilities.ts). */
export function describeGeminiConnection(
  state: 'configured' | 'missing',
  enabled: boolean = isVeoVideoGenerationEnabled(),
): VideoGenerationConnectionDescriptor {
  // Callers that know the user pass `isVeoVideoGenerationEnabled(process.env, userId)`: the release switch can be limited to a
  // canary allowlist, so "enabled" is a per-user answer.
  const configured = state === 'configured'
  // A saved key is not enough: Veo also needs its release switch. Until then the controls are visible and explained,
  // but the connection cannot generate (no silent paid path exists behind a merged feature).
  const blockedReason: VideoConnectionBlockedReason | undefined = !configured ? 'not_configured' : !enabled ? 'feature_disabled' : undefined
  return {
    ref: GEMINI_CONNECTION_REF,
    provider: 'gemini',
    connectionMethod: 'api_key',
    transport: 'rest',
    label: 'Google Veo',
    detail: 'API · usa a sua chave Gemini (faturamento Google)',
    funding: 'google_gemini_api',
    status: configured ? 'connected' : 'not_configured',
    canGenerate: blockedReason === undefined,
    ...(blockedReason ? { blockedReason } : {}),
    needsGenerationAuthorization: false,
    accountLabel: null,
    capabilitiesFreshness: 'static',
    capabilitiesCheckedAt: null,
    operations: configured ? toClientOperations(veoVideoOperations()) : [],
  }
}

export function mcpCapabilityAgeState(
  row: Pick<ProviderConnectionRow, 'capabilities' | 'last_checked_at'>,
  now: Date,
): { freshness: VideoCapabilityFreshness; expired: boolean } {
  const video = row.capabilities && 'video' in row.capabilities ? row.capabilities.video : undefined
  if (!video || video.schemaVersion !== KLING_MCP_VIDEO_SNAPSHOT_VERSION || !row.last_checked_at) {
    return { freshness: 'missing', expired: false }
  }
  const age = now.getTime() - new Date(row.last_checked_at).getTime()
  if (!Number.isFinite(age)) return { freshness: 'missing', expired: false }
  if (age <= CAPABILITY_FRESH_MS) return { freshness: 'fresh', expired: false }
  return { freshness: 'stale', expired: age > CAPABILITY_MAX_AGE_MS }
}

export function describeMcpConnection(row: ProviderConnectionRow, now: Date = new Date()): VideoGenerationConnectionDescriptor {
  const membership = row.capabilities && 'membership' in row.capabilities ? row.capabilities.membership : undefined
  const accountLabel = membership?.label ?? membership?.type ?? null
  const hasGenerationScope = row.scopes.includes(KLING_MCP_GENERATION_CREATE_SCOPE)

  const base = {
    ref: accountConnectionRef(row.id),
    provider: 'kling' as const,
    connectionMethod: 'mcp_oauth' as const,
    transport: 'mcp' as const,
    label: 'Minha conta Kling',
    detail: 'MCP · usa os créditos da sua conta Kling (web)',
    funding: 'kling_web_credits' as const,
    accountLabel,
    capabilitiesCheckedAt: row.last_checked_at,
  }

  if (row.status !== 'connected') {
    const authorization = row.status === 'authorization_required'
    return {
      ...base,
      status: authorization ? 'authorization_required' : 'error',
      canGenerate: false,
      blockedReason: authorization ? 'authorization_required' : 'connection_error',
      needsGenerationAuthorization: false,
      capabilitiesFreshness: 'missing',
      operations: [],
    }
  }

  const { freshness, expired } = mcpCapabilityAgeState(row, now)
  const video = row.capabilities && 'video' in row.capabilities ? row.capabilities.video : undefined
  const usableSnapshot = freshness !== 'missing' && !expired && !!video
  const operations = usableSnapshot ? toClientOperations(video!.operations) : []
  const hasModels = operations.some((entry) => entry.models.length > 0)

  let blockedReason: VideoConnectionBlockedReason | undefined
  if (freshness === 'missing') blockedReason = 'capabilities_missing'
  else if (expired) blockedReason = 'capabilities_expired'
  else if (!hasModels) blockedReason = 'no_supported_models'
  else if (!hasGenerationScope) blockedReason = 'generation_authorization_required'

  return {
    ...base,
    status: 'connected',
    canGenerate: blockedReason === undefined,
    ...(blockedReason ? { blockedReason } : {}),
    needsGenerationAuthorization: !hasGenerationScope,
    capabilitiesFreshness: freshness,
    operations,
  }
}

export class ConnectionsUnavailableError extends Error {
  readonly code = 'CONNECTIONS_UNAVAILABLE'
  constructor() {
    super('The connection store could not be read.')
    this.name = 'ConnectionsUnavailableError'
  }
}

/**
 * Every connection the user may pick on /videos. Kling API is listed whether or
 * not it is configured (so the form can explain how to configure it); a Kling
 * account only appears when the user actually has one. Store failures throw
 * ConnectionsUnavailableError — they are never reported as "not configured".
 */
export async function listVideoGenerationConnections(
  supabase: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<VideoGenerationConnectionDescriptor[]> {
  const [restState, geminiState, rows] = await Promise.all([
    getProviderConfigurationState(supabase, { userId, provider: 'kling' }),
    getProviderConfigurationState(supabase, { userId, provider: 'gemini' }),
    listConnectionsForUser(supabase, userId).catch(() => null),
  ])
  if (restState === 'unavailable' || geminiState === 'unavailable' || rows === null) throw new ConnectionsUnavailableError()

  return [
    describeRestConnection(restState),
    describeGeminiConnection(geminiState, isVeoVideoGenerationEnabled(process.env, userId)),
    ...rows.filter((row) => row.provider === 'kling' && row.connection_method === 'mcp_oauth').map((row) => describeMcpConnection(row, now)),
  ]
}

export type ResolvedGenerationConnection =
  | { ok: true; kind: 'rest'; descriptor: VideoGenerationConnectionDescriptor }
  | { ok: true; kind: 'gemini_api'; descriptor: VideoGenerationConnectionDescriptor }
  | {
      ok: true
      kind: 'provider_connection'
      descriptor: VideoGenerationConnectionDescriptor
      /** Server-side capability data (includes mapping hints) — never derived from the request. */
      operations: VideoOperationCapability[]
      connection: ProviderConnectionRow
    }
  | { ok: false; status: number; code: string; message: string }

/** Server-side capabilities of a connection row (unfiltered, includes mapping hints). */
export function serverOperationsFor(row: ProviderConnectionRow): VideoOperationCapability[] {
  const video = row.capabilities && 'video' in row.capabilities ? row.capabilities.video : undefined
  return video?.operations ?? []
}

const BLOCKED_HTTP: Record<VideoConnectionBlockedReason, { status: number; message: string }> = {
  not_configured: { status: 422, message: 'Kling não configurado. Adicione sua chave de API em Configurações.' },
  authorization_required: { status: 409, message: 'A conexão com a conta Kling precisa ser reautorizada em Configurações.' },
  connection_error: { status: 409, message: 'A conexão com a conta Kling está com erro. Verifique-a em Configurações.' },
  generation_authorization_required: {
    status: 403,
    message: 'Esta conexão é somente leitura. Autorize a geração em Configurações antes de gerar vídeos.',
  },
  capabilities_missing: { status: 409, message: 'As capacidades desta conta ainda não foram carregadas. Atualize a conexão.' },
  capabilities_expired: { status: 409, message: 'As capacidades desta conta estão desatualizadas. Atualize a conexão.' },
  no_supported_models: { status: 409, message: 'Esta conta não oferece modelos de vídeo compatíveis com o Content Studio.' },
  feature_disabled: { status: 403, message: 'O Google Veo ainda não foi liberado neste ambiente. Use outro modelo por enquanto.' },
}

export function blockedResponse(reason: VideoConnectionBlockedReason): { status: number; code: string; message: string } {
  const entry = BLOCKED_HTTP[reason]
  return { status: entry.status, code: reason.toUpperCase(), message: entry.message }
}

/**
 * Resolves the reference the browser sent to a connection the SERVER owns and
 * verifies that it can start a generation. A foreign, unknown or malformed
 * reference is indistinguishable from "not found".
 */
export async function resolveGenerationConnection(
  supabase: SupabaseClient,
  userId: string,
  ref: unknown,
  now: Date = new Date(),
): Promise<ResolvedGenerationConnection> {
  const parsed = parseConnectionRef(ref)
  if (!parsed) return { ok: false, status: 404, code: 'CONNECTION_NOT_FOUND', message: 'Conexão não encontrada.' }

  if (parsed.kind === 'gemini_api') {
    const state = await getProviderConfigurationState(supabase, { userId, provider: 'gemini' })
    if (state === 'unavailable') {
      return { ok: false, status: 503, code: 'CONNECTIONS_UNAVAILABLE', message: 'Não foi possível verificar suas conexões agora.' }
    }
    const descriptor = describeGeminiConnection(state, isVeoVideoGenerationEnabled(process.env, userId))
    if (!descriptor.canGenerate) {
      if (descriptor.blockedReason === 'feature_disabled') return { ok: false, ...blockedResponse('feature_disabled') }
      return { ok: false, status: 422, code: 'PROVIDER_NOT_CONFIGURED', message: 'Gemini não configurado. Adicione sua chave de API em Configurações para usar o Google Veo.' }
    }
    return { ok: true, kind: 'gemini_api', descriptor }
  }

  if (parsed.kind === 'rest') {
    const state = await getProviderConfigurationState(supabase, { userId, provider: 'kling' })
    if (state === 'unavailable') {
      return { ok: false, status: 503, code: 'CONNECTIONS_UNAVAILABLE', message: 'Não foi possível verificar suas conexões agora.' }
    }
    const descriptor = describeRestConnection(state)
    if (!descriptor.canGenerate) {
      const blocked = blockedResponse('not_configured')
      // Historical, client-visible code for a missing Kling API key.
      return { ok: false, status: blocked.status, code: 'PROVIDER_NOT_CONFIGURED', message: blocked.message }
    }
    return { ok: true, kind: 'rest', descriptor }
  }

  let connection: ProviderConnectionRow | null
  try {
    // Ownership-scoped: id AND user id.
    connection = await getOwnedConnection(supabase, parsed.connectionId, userId)
  } catch {
    return { ok: false, status: 503, code: 'CONNECTIONS_UNAVAILABLE', message: 'Não foi possível verificar suas conexões agora.' }
  }
  if (!connection || connection.provider !== 'kling' || connection.connection_method !== 'mcp_oauth') {
    return { ok: false, status: 404, code: 'CONNECTION_NOT_FOUND', message: 'Conexão não encontrada.' }
  }

  const descriptor = describeMcpConnection(connection, now)
  if (!descriptor.canGenerate) {
    const blocked = blockedResponse(descriptor.blockedReason!)
    return { ok: false, ...blocked }
  }

  return { ok: true, kind: 'provider_connection', descriptor, operations: serverOperationsFor(connection), connection }
}
