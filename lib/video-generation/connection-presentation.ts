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

/** Whose balance a generation on this connection consumes. No amounts: cost varies by model, duration and resolution. */
export function spendingSourceCopy(funding: VideoGenerationConnectionDescriptor['funding']): string {
  return funding === 'kling_web_credits'
    ? 'Usa os créditos da sua conta Kling (web).'
    : 'Usa o pacote de recursos da sua API Kling.'
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
  generation: { transport?: string | null; connection_id?: string | null },
  connectionNames: ReadonlyMap<string, string>,
): GenerationProvenance {
  const badge = transportBadge(generation.transport)
  if (badge === 'API') return { badge, connectionName: 'Kling API' }
  const name = generation.connection_id ? connectionNames.get(generation.connection_id) : undefined
  return { badge, connectionName: name ?? null }
}
