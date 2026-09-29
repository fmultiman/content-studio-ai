// AI_PROVIDER_USAGE_LEDGER_AND_HISTORY_V1 — SERVER ONLY.
//
// Appends usage events to `provider_usage_events`. The caller passes a
// server-authority client (service role): users have no write access to the
// ledger, and the service role can only INSERT (see migration 044).
//
// Principles:
//   - one provider charge = one event: the write is an INSERT ... ON CONFLICT DO
//     NOTHING on a stable idempotency key, so at-least-once completion (webhook
//     retries, overlapping polls) can never double-count;
//   - a quantity is written ONLY when a source really measured it. When the
//     execution is known but its usage is not, the event says so (NULL quantity,
//     NULL unit, source 'unknown') — never a fake 0 and never a guess;
//   - recording usage must never break the operation it observes: the video
//     generation completion is already durable, so a ledger write failure is
//     retried once, logged by error CLASS only, and swallowed.

import type { SupabaseClient } from '@supabase/supabase-js'
import { USAGE_UNITS, type UsageMeasurement } from './provider-usage'

export interface ProviderUsageEventInput {
  userId: string
  projectId?: string | null
  productionId?: string | null
  provider: string
  connectionId?: string | null
  transport: string
  operation: string
  model?: string | null
  resourceType: string
  resourceId?: string | null
  providerTaskId?: string | null
  /** Omit when the usage is unknown. */
  measurement?: UsageMeasurement | null
  providerMetadata?: Record<string, unknown>
  idempotencyKey: string
  occurredAt?: Date
}

export class InvalidUsageEventError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidUsageEventError'
  }
}

/** The database row for an input; throws on a malformed measurement instead of storing a wrong number. */
export function toUsageEventRow(input: ProviderUsageEventInput): Record<string, unknown> {
  const measurement = input.measurement ?? null
  if (measurement) {
    if (!Number.isFinite(measurement.quantity) || measurement.quantity < 0) throw new InvalidUsageEventError('quantity must be a finite number >= 0')
    if (!(USAGE_UNITS as readonly string[]).includes(measurement.unit)) throw new InvalidUsageEventError('unknown usage unit')
    if ((measurement.source as string) === 'unknown') throw new InvalidUsageEventError('a measured quantity needs a real source')
  }
  if (!input.idempotencyKey) throw new InvalidUsageEventError('idempotency key is required')

  return {
    user_id: input.userId,
    project_id: input.projectId ?? null,
    production_id: input.productionId ?? null,
    provider: input.provider,
    connection_id: input.connectionId ?? null,
    transport: input.transport,
    operation: input.operation,
    model: input.model ?? null,
    resource_type: input.resourceType,
    resource_id: input.resourceId ?? null,
    provider_task_id: input.providerTaskId ?? null,
    quantity: measurement ? measurement.quantity : null,
    unit: measurement ? measurement.unit : null,
    measurement_source: measurement ? measurement.source : 'unknown',
    provider_metadata: input.providerMetadata ?? {},
    idempotency_key: input.idempotencyKey,
    ...(input.occurredAt ? { occurred_at: input.occurredAt.toISOString() } : {}),
  }
}

/** Appends one event. A second call with the same idempotency key is a silent no-op. Throws on a store error. */
export async function recordProviderUsageEvent(db: SupabaseClient, input: ProviderUsageEventInput): Promise<void> {
  const { error } = await db
    .from('provider_usage_events')
    .upsert(toUsageEventRow(input), { onConflict: 'idempotency_key', ignoreDuplicates: true })
  if (error) throw new Error('provider usage event write failed')
}

// ---------------------------------------------------------------------------
// Video generation
// ---------------------------------------------------------------------------

/** Stable per generation: a generation completes (and is charged) once. */
export const videoGenerationUsageKey = (generationId: string) => `video_generation:${generationId}:completed`

/**
 * The event for a COMPLETED video generation, built from the stored row. `usage`
 * is present only when the provider/transport genuinely reported a quantity;
 * otherwise the event records the execution with unknown usage.
 */
export function videoGenerationUsageEvent(
  generation: Record<string, any>,
  usage?: UsageMeasurement | null,
  occurredAt?: Date,
): ProviderUsageEventInput {
  const config = generation.request_config && typeof generation.request_config === 'object' ? generation.request_config : {}
  return {
    userId: generation.user_id,
    projectId: generation.project_id ?? null,
    productionId: generation.production_id ?? null,
    provider: generation.provider ?? 'kling',
    // Legacy rows (transport NULL) are REST by definition.
    transport: generation.transport ?? 'rest',
    connectionId: generation.connection_id ?? null,
    operation: generation.mode,
    model: generation.model ?? null,
    resourceType: 'video_generation',
    resourceId: generation.id,
    providerTaskId: generation.task_id ?? null,
    measurement: usage ?? null,
    // The exact, non-secret settings that were sent: what the provider's consumption depends on.
    providerMetadata: {
      request: {
        duration: config.duration ?? null,
        resolution: config.resolution ?? null,
        audio: config.audio ?? null,
        multi_shot: config.multi_shot ?? null,
        aspect_ratio: config.aspect_ratio ?? null,
        output_count: config.output_count ?? null,
      },
    },
    idempotencyKey: videoGenerationUsageKey(generation.id),
    occurredAt,
  }
}

/** Best-effort: one retry, never throws, logs only the error class. */
export async function recordVideoGenerationUsage(
  db: SupabaseClient,
  generation: Record<string, any>,
  usage?: UsageMeasurement | null,
  occurredAt?: Date,
): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await recordProviderUsageEvent(db, videoGenerationUsageEvent(generation, usage, occurredAt))
      return true
    } catch (error) {
      if (error instanceof InvalidUsageEventError) {
        console.error('[usage-ledger] rejected event:', error.name)
        return false
      }
      if (attempt === 1) console.error('[usage-ledger] write failed:', error instanceof Error ? error.name : 'unknown')
    }
  }
  return false
}
