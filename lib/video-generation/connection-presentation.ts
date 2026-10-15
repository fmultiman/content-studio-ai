// VIDEO_GENERATION_MODAL_SAFETY_AND_TRANSPORT_UX_V1
//
// How a connection and a generation's provenance are PRESENTED. Pure and
// client-safe (no server imports). It derives everything from data the product
// already has — the connection descriptor (`transport`, `funding`, `label`,
// `accountLabel`) and the persisted `video_generations.transport` /
// `connection_id` — and adds no backend data, no cost estimate and no routing.
//
// "API" and "MCP" are the two connection types the user must be able to tell
// apart, because they spend different balances:
//   API  -> the user's Kling API resource package
//   MCP  -> the credits of the connected Kling account (web)

import type { VideoGenerationConnectionDescriptor } from './capabilities'
import { parseConnectionRef } from './connection-ref'

export type TransportBadge = 'API' | 'MCP'

/**
 * Badge for a transport. A row without a transport (created before it was
 * persisted) is REST by definition — REST was the only transport that existed.
 */
export function transportBadge(transport: string | null | undefined): TransportBadge {
  return transport === 'mcp' ? 'MCP' : 'API'
}

/** Short label of a connection in the picker: the transport for Kling, the product for Google Veo (two "API" labels would be ambiguous). */
export function connectionBadge(connection: Pick<VideoGenerationConnectionDescriptor, 'provider' | 'transport'>): string {
  return connection.provider === 'gemini' ? 'VEO' : transportBadge(connection.transport)
}

/**
 * Why Google Veo cannot generate right now, in one sentence (null = it can, or the connection is not Veo). Shown next to the
 * model so a visible control is never a silent dead end. Kling connections keep their existing presentation.
 */
export function veoBlockedNote(connection: Pick<VideoGenerationConnectionDescriptor, 'provider' | 'canGenerate' | 'blockedReason'>): string | null {
  if (connection.provider !== 'gemini' || connection.canGenerate) return null
  if (connection.blockedReason === 'canary_restricted') {
    return 'O Google Veo está liberado apenas para contas de teste neste ambiente: você pode configurar o vídeo, mas a geração fica desativada para esta conta.'
  }
  if (connection.blockedReason === 'feature_disabled') {
    return 'O Google Veo ainda não foi liberado neste ambiente: você pode configurar o vídeo, mas a geração fica desativada até a liberação.'
  }
  return 'Adicione sua chave Gemini em Configurações para gerar vídeos com o Google Veo.'
}

/** Whose balance a generation on this connection consumes. No amounts: cost varies by model, duration and resolution. */
export function spendingSourceCopy(funding: VideoGenerationConnectionDescriptor['funding']): string {
  if (funding === 'google_gemini_api') return 'Usa a sua chave Gemini: o Google cobra por segundo de vídeo gerado, na sua conta.'
  return funding === 'kling_web_credits'
    ? 'Usa os créditos da sua conta Kling (web).'
    : 'Usa o pacote de recursos da sua API Kling.'
}

/**
 * STRUCTURAL_WAVE_0 (D22): the provider of the SELECTED connection, in the grammatical forms the UI messages need, so a Google Veo user
 * is never told about "a Kling". No selection (or a provider this build does not know) reads as the neutral "provedor".
 * Presentation only: it never decides routing, capabilities or credentials.
 */
export interface VideoProviderPhrases {
  /** "Kling" / "Google Veo" / "provedor de vídeo" */
  name: string
  /** "à Kling" / "ao Google Veo" / "ao provedor" */
  to: string
  /** "para a Kling" / "para o Google Veo" / "para o provedor" */
  toward: string
  /** "A Kling" / "O Google Veo" / "O provedor" */
  subject: string
}

const VIDEO_PROVIDER_PHRASES: Readonly<Record<string, VideoProviderPhrases>> = Object.freeze({
  kling: { name: 'Kling', to: 'à Kling', toward: 'para a Kling', subject: 'A Kling' },
  gemini: { name: 'Google Veo', to: 'ao Google Veo', toward: 'para o Google Veo', subject: 'O Google Veo' },
})
const NEUTRAL_VIDEO_PROVIDER: VideoProviderPhrases = { name: 'provedor de vídeo', to: 'ao provedor', toward: 'para o provedor', subject: 'O provedor' }

export function videoProviderPhrases(provider: string | null | undefined): VideoProviderPhrases {
  return typeof provider === 'string' && Object.prototype.hasOwnProperty.call(VIDEO_PROVIDER_PHRASES, provider)
    ? VIDEO_PROVIDER_PHRASES[provider]
    : NEUTRAL_VIDEO_PROVIDER
}

/** Product-facing name of a connection, e.g. "Minha conta Kling — Pro" / "Kling API". */
export function connectionDisplayName(connection: Pick<VideoGenerationConnectionDescriptor, 'label' | 'accountLabel'>): string {
  return connection.accountLabel ? `${connection.label} — ${connection.accountLabel}` : connection.label
}

/** provider_connections id -> display name, from the connection list the dialog already loads. */
export function connectionNamesById(connections: VideoGenerationConnectionDescriptor[]): Map<string, string> {
  const names = new Map<string, string>()
  for (const connection of connections) {
    const parsed = parseConnectionRef(connection.ref)
    if (parsed?.kind === 'provider_connection') names.set(parsed.connectionId, connectionDisplayName(connection))
  }
  return names
}

export interface GenerationProvenance {
  badge: TransportBadge
  /** Connection name when it can be stated truthfully; otherwise null (never invented). */
  connectionName: string | null
}

/**
 * Provenance of a stored generation.
 *   API rows      -> the Kling API connection (REST has exactly one).
 *   MCP rows      -> the account connection's name if it is still known; a
 *                    disconnected/unknown connection (connection_id NULL by the
 *                    FK) shows the transport only.
 */
export function describeGenerationProvenance(
  generation: { transport?: string | null; connection_id?: string | null; provider?: string | null },
  connectionNames: ReadonlyMap<string, string>,
): GenerationProvenance {
  const badge = transportBadge(generation.transport)
  if (generation.provider === 'gemini') return { badge, connectionName: 'Google Veo' }
  if (badge === 'API') return { badge, connectionName: 'Kling API' }
  const name = generation.connection_id ? connectionNames.get(generation.connection_id) : undefined
  return { badge, connectionName: name ?? null }
}
