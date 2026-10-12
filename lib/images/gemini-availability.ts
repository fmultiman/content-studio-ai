// FUTURE-064 Slice B — browser-safe view of "can this deployment run official Gemini image generation right now?".
//
// The SERVER derives it (lib/providers/gemini/image-feature.ts: release switch + FUTURE-050 execution policy) and returns
// only this class, through the authenticated /api/settings/providers response. The browser never sees a variable name,
// a value, or a secret. Pure module: no env, no I/O, safe to import from client components.

export const GEMINI_IMAGE_AVAILABILITY_REASONS = ['available', 'release_switch_off', 'environment_blocked'] as const
export type GeminiImageAvailabilityReason = (typeof GEMINI_IMAGE_AVAILABILITY_REASONS)[number]

export type GeminiImageAvailability = { available: boolean; reason: GeminiImageAvailabilityReason }

/**
 * Strict parser for the server payload. Anything that is not exactly a known, self-consistent answer is `null`
 * ("unknown"), and unknown is treated as UNAVAILABLE by the UI: a malformed or missing signal can never enable
 * paid generation.
 */
export function parseGeminiImageAvailability(raw: unknown): GeminiImageAvailability | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const { available, reason } = raw as { available?: unknown; reason?: unknown }
  if (typeof available !== 'boolean') return null
  if (!(GEMINI_IMAGE_AVAILABILITY_REASONS as readonly unknown[]).includes(reason)) return null
  if (available !== (reason === 'available')) return null
  return { available, reason: reason as GeminiImageAvailabilityReason }
}

/** pt-BR explanation shown wherever a Google model is hidden or disabled. Never claims a missing credential. */
export function geminiImageAvailabilityMessage(availability: GeminiImageAvailability | null): string {
  if (!availability) return 'Não foi possível verificar se a geração de imagem com o Google Gemini está disponível.'
  switch (availability.reason) {
    case 'available':
      return 'Geração de imagem com o Google Gemini disponível.'
    case 'environment_blocked':
      return 'A geração com provedores externos está desativada neste ambiente (Preview/local).'
    default:
      return 'A geração de imagem com o Google Gemini ainda não foi habilitada neste ambiente.'
  }
}
