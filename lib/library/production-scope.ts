// MEDIA_LIBRARY_PRODUCTION_SCOPING_V1
//
// Server-side helpers for the optional Production association of a LibraryFile
// (`library_files.production_id`, scripts/048). The association is an id, independent of the
// folder/path, and is only ever written from a SERVER-RESOLVED relationship:
//
//   generated video   -> video_generations.production_id          (always present)
//   video render      -> render_execution -> video_draft.production_id
//   static render /   -> ChannelPiece -> EditorialContent.production_id
//   piece upload
//   generated image   -> ONLY a uniquely derivable draft Production (resolved | unscoped | ambiguous)
//   generic upload    -> none, unless the caller names a Production that is verified here
//
// The browser is never authority for a Production that a server relationship already answers. The
// database (migration 048) independently refuses a Production that is not the owner's, in the
// file's own Project.

import type { SupabaseClient } from '@supabase/supabase-js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

export type OwnedProductionContext =
  | { ok: true; productionId: string }
  | { ok: false; code: 'PRODUCTION_NOT_FOUND' }

/**
 * A Production the authenticated user owns AND that belongs to `projectId`. A browser-supplied uuid is
 * not proof; nothing is revealed about a Production that exists for someone else or in another Project.
 */
export async function resolveOwnedProductionContext(
  supabase: SupabaseClient,
  params: { userId: string; projectId: string | null | undefined; productionId: unknown },
): Promise<OwnedProductionContext> {
  if (!isUuid(params.productionId) || !isUuid(params.projectId)) return { ok: false, code: 'PRODUCTION_NOT_FOUND' }
  const { data, error } = await supabase
    .from('productions')
    .select('id')
    .eq('id', params.productionId)
    .eq('project_id', params.projectId)
    .eq('user_id', params.userId)
    .maybeSingle()
  if (error || !data) return { ok: false, code: 'PRODUCTION_NOT_FOUND' }
  return { ok: true, productionId: params.productionId }
}

/**
 * For writers whose Production comes from a server relationship: the id if it is valid for this
 * owner/Project, otherwise NULL (an unscoped file is always a valid state; a promotion must not fail
 * because a historical relationship points somewhere unusable).
 */
export async function ownedProductionIdOrNull(
  supabase: SupabaseClient,
  params: { userId: string; projectId: string | null | undefined; productionId: string | null | undefined },
): Promise<string | null> {
  if (!params.productionId) return null
  const resolved = await resolveOwnedProductionContext(supabase, params)
  return resolved.ok ? resolved.productionId : null
}

export type ImageProductionDerivation =
  | { kind: 'resolved'; productionId: string }
  | { kind: 'unscoped' }
  | { kind: 'ambiguous'; productionIds: string[] }

/**
 * Generated Image -> Production. `images` carries no Production of its own, so the ONLY trustworthy
 * relationships are the owner's drafts that hold the image as their current image or recorded it as an
 * attempt. Exactly one distinct valid Production => resolved; none => unscoped; several => ambiguous
 * (never picks "the newest"/"the first"). Candidates must belong to the image's Project.
 */
export async function deriveImageProduction(
  supabase: SupabaseClient,
  params: { userId: string; projectId: string | null | undefined; imageId: string },
): Promise<ImageProductionDerivation> {
  const candidates = new Set<string>()

  const current = await supabase
    .from('image_drafts')
    .select('production_id')
    .eq('user_id', params.userId)
    .eq('current_image_id', params.imageId)
    .not('production_id', 'is', null)
  // Fail closed: if a relationship cannot be read, the answer is "unscoped", never a partial guess.
  if (current.error) return { kind: 'unscoped' }
  for (const row of current.data ?? []) if (row.production_id) candidates.add(row.production_id as string)

  const attempts = await supabase
    .from('image_drafts')
    .select('production_id')
    .eq('user_id', params.userId)
    // jsonb containment: a JSON string (postgrest-js would turn a JS array of objects into a Postgres array literal).
    .contains('generation_attempts', JSON.stringify([{ imageId: params.imageId }]))
    .not('production_id', 'is', null)
  if (attempts.error) return { kind: 'unscoped' }
  for (const row of attempts.data ?? []) if (row.production_id) candidates.add(row.production_id as string)

  const valid: string[] = []
  for (const productionId of candidates) {
    const owned = await resolveOwnedProductionContext(supabase, { userId: params.userId, projectId: params.projectId, productionId })
    if (owned.ok) valid.push(owned.productionId)
  }
  valid.sort()

  if (valid.length === 0) return { kind: 'unscoped' }
  if (valid.length === 1) return { kind: 'resolved', productionId: valid[0] }
  return { kind: 'ambiguous', productionIds: valid }
}
