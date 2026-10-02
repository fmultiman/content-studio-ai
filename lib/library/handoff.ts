// GENERATED_MEDIA_TO_CREATIVE_EDITOR_HANDOFF_V1
//
// Server-side authority of the generated-media -> Creative Editor handoff. The browser names ONE
// LibraryFile id and (for the receiving editor) the identifiers of its REAL authoring target. A Project
// the browser names is never an authority: the receiving Project is derived here from the target chain
// (Static) or the owner-scoped VideoDraft (Video). Everything else is re-derived here too:
//
//   authenticated owner + active (not trashed) + the file's Project is the owner's
//   + canonical trusted Library storage path (lib/storage/library-path.ts, the single trust rule)
//   + kind/MIME compatibility with the target editor (media-handoff.ts matrix)
//
// Read-only by construction: this module never writes a row, never promotes media and never creates an
// authoring object (VideoDraft, ChannelPiece, ChannelPieceMedia, VideoScene, timeline item).

import type { SupabaseClient } from '@supabase/supabase-js'
import { isStaticChannelPiece } from '@/lib/creative/context/static-authoring'
import { channelFormatLabel } from '@/lib/creative/authoring/editor-workspace'
import {
  handoffCompatibility, isHandoffCompatible, prioritizeByProduction, staticHandoffHref, videoHandoffHref,
  type HandoffFileSummary, type HandoffMediaErrorCode, type HandoffTargetFamily, type ReceivingTarget, type StaticHandoffTarget, type VideoHandoffTarget,
} from '@/lib/creative/handoff/media-handoff'
import { isTrustedLibraryStoragePath } from '@/lib/storage/library-path'
import { presignLibraryRead } from '@/lib/storage/library-storage'
import type { LibraryFile } from '@/lib/types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Bounded, Project-scoped target queries: the most recently updated first; `truncated` says more exist. */
export const HANDOFF_EDITORIAL_CONTENT_LIMIT = 100
export const HANDOFF_VIDEO_DRAFT_LIMIT = 100

export type HandoffResolution =
  | { ok: true; file: LibraryFile & { production_id?: string | null }; projectId: string }
  | { ok: false; code: HandoffMediaErrorCode }

/** The ONLY validation of "is this LibraryFile a usable handoff media" — owner, active, Project, trusted path. */
export async function resolveHandoffLibraryFile(supabase: SupabaseClient, userId: string, fileId: unknown): Promise<HandoffResolution> {
  if (typeof fileId !== 'string' || !UUID_RE.test(fileId)) return { ok: false, code: 'INVALID_REQUEST' }

  const { data, error } = await supabase.from('library_files').select('*').eq('id', fileId).eq('user_id', userId).is('deleted_at', null).maybeSingle()
  // Missing, someone else's and trashed look identical: nothing is revealed about a file the caller does not own.
  if (error || !data) return { ok: false, code: 'NOT_FOUND' }
  const file = data as LibraryFile & { production_id?: string | null }
  // The row's storage_path is a claim: a key that is not provably the owner's Library object fails closed.
  if (!isTrustedLibraryStoragePath(file.user_id, file.storage_path)) return { ok: false, code: 'NOT_FOUND' }
  if (!file.project_id) return { ok: false, code: 'NO_PROJECT' }

  const { data: project, error: projectError } = await supabase.from('projects').select('id').eq('id', file.project_id).eq('user_id', userId).maybeSingle()
  if (projectError || !project) return { ok: false, code: 'NOT_FOUND' }
  return { ok: true, file, projectId: file.project_id }
}

export type ReceivedMediaResolution =
  | { ok: true; file: LibraryFile & { production_id?: string | null } }
  | { ok: false; code: HandoffMediaErrorCode }

type TargetProjectResolution = { ok: true; projectId: string } | { ok: false; code: HandoffMediaErrorCode }

/**
 * The Project that owns the receiving authoring target, derived from the DATABASE, owner-scoped:
 *  - Static: the same chain the Static Editor context route enforces (`/api/creative/static-authoring-context`):
 *    Project (owner) -> EditorialContent (in that Project) -> ChannelPiece (in that EditorialContent, a Static
 *    piece). A mixed / forged id combination fails here, whatever Project the browser claims.
 *  - Video: the owner-scoped VideoDraft's own `project_id`; no Project is read from the request.
 * Missing, someone else's and inconsistent targets are indistinguishable (TARGET_NOT_FOUND).
 */
export async function resolveReceivingTargetProject(supabase: SupabaseClient, userId: string, target: ReceivingTarget): Promise<TargetProjectResolution> {
  if (target.editor === 'video') {
    if (typeof target.draftId !== 'string' || !UUID_RE.test(target.draftId)) return { ok: false, code: 'INVALID_REQUEST' }
    const { data: draft, error } = await supabase.from('video_drafts').select('id, project_id').eq('id', target.draftId).eq('user_id', userId).maybeSingle()
    if (error || !draft) return { ok: false, code: 'TARGET_NOT_FOUND' }
    if (!draft.project_id) return { ok: false, code: 'NO_PROJECT' }
    return { ok: true, projectId: draft.project_id as string }
  }

  const ids = [target.projectId, target.editorialContentId, target.channelPieceId]
  if (!ids.every((id) => typeof id === 'string' && UUID_RE.test(id))) return { ok: false, code: 'INVALID_REQUEST' }
  const [project, content, piece] = await Promise.all([
    supabase.from('projects').select('id').eq('id', target.projectId).eq('user_id', userId).maybeSingle(),
    supabase.from('editorial_contents').select('id, project_id').eq('id', target.editorialContentId).eq('user_id', userId).maybeSingle(),
    supabase.from('channel_pieces').select('id, editorial_content_id, channel, format').eq('id', target.channelPieceId).eq('user_id', userId).maybeSingle(),
  ])
  if (project.error || !project.data) return { ok: false, code: 'TARGET_NOT_FOUND' }
  if (content.error || !content.data || content.data.project_id !== project.data.id) return { ok: false, code: 'TARGET_NOT_FOUND' }
  if (piece.error || !piece.data || piece.data.editorial_content_id !== content.data.id) return { ok: false, code: 'TARGET_NOT_FOUND' }
  // Same eligibility the Static Editor route applies: Reel/Short/video_description belong to the timeline editor.
  if (!isStaticChannelPiece(piece.data.channel as never, piece.data.format as never)) return { ok: false, code: 'TARGET_NOT_FOUND' }
  return { ok: true, projectId: content.data.project_id as string }
}

/**
 * Receiving editor: the incoming media must be valid AND belong to the Project DERIVED SERVER-SIDE from the
 * receiving target (see `resolveReceivingTargetProject`), AND be a kind this editor can consume. The target is
 * checked first, so nothing about a file is revealed for a target the caller does not own. The returned row is
 * shaped like a Library list entry (signed display URL, no storage claim trusted) so the editor can feed it to
 * the exact same maps its pickers already use.
 */
export async function resolveReceivedMedia(
  supabase: SupabaseClient,
  userId: string,
  params: { fileId: unknown; target: ReceivingTarget },
): Promise<ReceivedMediaResolution> {
  const targetProject = await resolveReceivingTargetProject(supabase, userId, params.target)
  if (!targetProject.ok) return targetProject
  const resolved = await resolveHandoffLibraryFile(supabase, userId, params.fileId)
  if (!resolved.ok) return resolved
  if (resolved.projectId !== targetProject.projectId) return { ok: false, code: 'PROJECT_MISMATCH' }
  if (!isHandoffCompatible(resolved.file, params.target.editor)) return { ok: false, code: 'UNSUPPORTED_KIND' }

  const signed = await presignLibraryRead(resolved.file).catch(() => null)
  return { ok: true, file: { ...resolved.file, public_url: signed || resolved.file.public_url, thumbnail_url: signed || resolved.file.thumbnail_url } }
}

export type HandoffTargets = {
  file: HandoffFileSummary
  static: HandoffTargetFamily<StaticHandoffTarget>
  video: HandoffTargetFamily<VideoHandoffTarget>
}

type ProductionRow = { id: string; title: string }
type EditorialContentRow = { id: string; title: string; production_id: string | null }
type ChannelPieceRow = { id: string; editorial_content_id: string; channel: string; format: string; title: string | null }
type VideoDraftRow = { id: string; name: string; production_id: string | null }

/**
 * Existing compatible authoring targets of the file's own Project, in a constant number of queries
 * (productions, editorial_contents, video_drafts in parallel, then channel_pieces) — no per-target fetch.
 * Nothing is created: no target means a truthful empty family.
 */
export async function loadHandoffTargets(supabase: SupabaseClient, userId: string, resolved: Extract<HandoffResolution, { ok: true }>): Promise<HandoffTargets> {
  const { file, projectId } = resolved
  const compatibility = handoffCompatibility(file)

  const [productionsResult, editorialResult, draftsResult] = await Promise.all([
    supabase.from('productions').select('id, title').eq('project_id', projectId).eq('user_id', userId),
    compatibility.static
      ? supabase.from('editorial_contents').select('id, title, production_id').eq('project_id', projectId).eq('user_id', userId).order('updated_at', { ascending: false }).limit(HANDOFF_EDITORIAL_CONTENT_LIMIT)
      : Promise.resolve({ data: [] as EditorialContentRow[], error: null }),
    compatibility.video
      ? supabase.from('video_drafts').select('id, name, production_id').eq('project_id', projectId).eq('user_id', userId).order('updated_at', { ascending: false }).limit(HANDOFF_VIDEO_DRAFT_LIMIT)
      : Promise.resolve({ data: [] as VideoDraftRow[], error: null }),
  ])
  if (productionsResult.error || editorialResult.error || draftsResult.error) throw new Error('HANDOFF_TARGETS_UNAVAILABLE')

  const productionTitles = new Map((productionsResult.data as ProductionRow[] ?? []).map((row) => [row.id, row.title]))
  const productionTitle = (id: string | null) => (id ? productionTitles.get(id) ?? null : null)
  const editorialContents = (editorialResult.data ?? []) as EditorialContentRow[]

  let staticTargets: StaticHandoffTarget[] = []
  if (compatibility.static && editorialContents.length > 0) {
    const pieces = await supabase
      .from('channel_pieces')
      .select('id, editorial_content_id, channel, format, title')
      .in('editorial_content_id', editorialContents.map((row) => row.id))
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
    if (pieces.error) throw new Error('HANDOFF_TARGETS_UNAVAILABLE')
    const byContent = new Map<string, ChannelPieceRow[]>()
    for (const piece of (pieces.data ?? []) as ChannelPieceRow[]) {
      // The exact Static Editor rule (same helper the editor route enforces): Reel/Short/video_description are excluded.
      if (!isStaticChannelPiece(piece.channel as never, piece.format as never)) continue
      byContent.set(piece.editorial_content_id, [...(byContent.get(piece.editorial_content_id) ?? []), piece])
    }
    staticTargets = editorialContents.flatMap((content) => (byContent.get(content.id) ?? []).map((piece): StaticHandoffTarget => ({
      channelPieceId: piece.id,
      editorialContentId: content.id,
      title: piece.title?.trim() || content.title,
      editorialContentTitle: content.title,
      formatLabel: channelFormatLabel(piece.channel, piece.format),
      productionId: content.production_id,
      productionTitle: productionTitle(content.production_id),
      href: staticHandoffHref({ projectId, editorialContentId: content.id, channelPieceId: piece.id }, file.id),
    })))
  }

  const drafts = (draftsResult.data ?? []) as VideoDraftRow[]
  const videoTargets = drafts.map((draft): VideoHandoffTarget => ({
    draftId: draft.id,
    name: draft.name,
    productionId: draft.production_id,
    productionTitle: productionTitle(draft.production_id),
    href: videoHandoffHref(draft.id, file.id),
  }))

  const fileProductionId = file.production_id ?? null
  return {
    file: {
      id: file.id, name: file.name, kind: file.kind, mimeType: file.mime_type, projectId, productionId: fileProductionId, productionTitle: productionTitle(fileProductionId),
    },
    static: { items: prioritizeByProduction(staticTargets, fileProductionId), truncated: editorialContents.length >= HANDOFF_EDITORIAL_CONTENT_LIMIT },
    video: { items: prioritizeByProduction(videoTargets, fileProductionId), truncated: drafts.length >= HANDOFF_VIDEO_DRAFT_LIMIT },
  }
}
