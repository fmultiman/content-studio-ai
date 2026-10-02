// GENERATED_MEDIA_TO_CREATIVE_EDITOR_HANDOFF_V1
//
// The pure contract of the handoff "generated media (saved LibraryFile) -> existing Creative Editor
// target". Identity is the LibraryFile id and NOTHING else: never a signed URL, a storage path, a
// provider id/URL or a browser-supplied MIME. Navigation is not authoring: nothing here creates or
// changes a ChannelPiece, ChannelPieceMedia, VideoDraft, VideoScene or timeline item.

import { isRenderableLibraryFile } from '@/lib/creative/integration/library-file-adapter'
import type { LibraryFileKind } from '@/lib/types'

/** The one query parameter the receiving editors read (see `parseIncomingMediaParam`). */
export const HANDOFF_MEDIA_PARAM = 'media'

export type HandoffEditor = 'static' | 'video'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The single place that reads the incoming-media query value. It is a REQUESTED identity, not trusted
 * metadata: anything that is not exactly one UUID is ignored (the editor opens normally).
 */
export function parseIncomingMediaParam(value: string | string[] | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return UUID_RE.test(trimmed) ? trimmed.toLowerCase() : null
}

export type HandoffCompatibility = Record<HandoffEditor, boolean>

/**
 * CURRENT factual matrix (audited against the executing editors, not assumed):
 *
 *   image (renderable raster) -> Static: yes   (free/template image element, the picker's `add` path)
 *                             -> Video:  yes   (scene hero, free scene image element, B-roll)
 *   video (renderable)        -> Static: NO    (the Static editor only ingests image LibraryFiles)
 *                             -> Video:  yes   (B-roll only)
 *   audio / document / other  -> unsupported in this handoff
 *
 * `mime_type` is the stored row value re-read on the server, never a browser claim.
 */
export function handoffCompatibility(file: { kind: LibraryFileKind; mime_type: string | null }): HandoffCompatibility {
  if (!isRenderableLibraryFile(file)) return { static: false, video: false }
  if (file.kind === 'image') return { static: true, video: true }
  if (file.kind === 'video') return { static: false, video: true }
  return { static: false, video: false }
}

export function isHandoffCompatible(file: { kind: LibraryFileKind; mime_type: string | null }, editor: HandoffEditor): boolean {
  return handoffCompatibility(file)[editor]
}

function withMedia(path: string, libraryFileId: string): string {
  return `${path}?${HANDOFF_MEDIA_PARAM}=${encodeURIComponent(libraryFileId)}`
}

/** The canonical Static Creative Editor route + the stable media id. */
export function staticHandoffHref(target: { projectId: string; editorialContentId: string; channelPieceId: string }, libraryFileId: string): string {
  return withMedia(`/projetos/${target.projectId}/conteudos/${target.editorialContentId}/channel-pieces/${target.channelPieceId}/editar-visual`, libraryFileId)
}

/** The canonical Video Creative Editor route + the stable media id. */
export function videoHandoffHref(draftId: string, libraryFileId: string): string {
  return withMedia(`/creative-editor/video/${draftId}`, libraryFileId)
}

/** Why a requested incoming media cannot be shown as "Mídia recebida" (bounded, user-safe). */
export type HandoffMediaErrorCode = 'NOT_FOUND' | 'NO_PROJECT' | 'PROJECT_MISMATCH' | 'UNSUPPORTED_KIND' | 'INVALID_REQUEST' | 'TARGET_NOT_FOUND'

export const HANDOFF_MEDIA_ERROR_COPY: Record<HandoffMediaErrorCode, string> = {
  NOT_FOUND: 'Este arquivo não foi encontrado ou foi removido de Arquivos.',
  NO_PROJECT: 'Este arquivo não está associado a um Projeto.',
  PROJECT_MISMATCH: 'Este arquivo pertence a outro Projeto e não pode ser usado aqui.',
  UNSUPPORTED_KIND: 'Este tipo de arquivo não pode ser usado neste editor.',
  INVALID_REQUEST: 'Não foi possível validar a mídia recebida.',
  TARGET_NOT_FOUND: 'Não foi possível validar o destino deste editor.',
}

/**
 * The receiving editor's REAL authoring target, as identifiers the server must verify (never as a Project
 * claim): Static = the Project -> EditorialContent -> ChannelPiece chain the editor route itself enforces;
 * Video = the owner-scoped VideoDraft, whose own `project_id` is the only Project authority.
 * `editor` only routes between the two shapes — it is not authority.
 */
export type ReceivingTarget =
  | { editor: 'static'; projectId: string; editorialContentId: string; channelPieceId: string }
  | { editor: 'video'; draftId: string }

/** Serializes the target for the handoff-media request (the server re-derives the Project from it). */
export function receivingTargetQuery(target: ReceivingTarget): URLSearchParams {
  return target.editor === 'static'
    ? new URLSearchParams({ editor: 'static', projectId: target.projectId, editorialContentId: target.editorialContentId, channelPieceId: target.channelPieceId })
    : new URLSearchParams({ editor: 'video', draftId: target.draftId })
}

/** `blockedReason` is set only when the editor itself cannot open for this Project (no target is listed then). */
export type HandoffTargetFamily<T> = { items: T[]; truncated: boolean; blockedReason?: 'PROJECT_IDENTITY_REQUIRED' }

export type StaticHandoffTarget = {
  channelPieceId: string
  editorialContentId: string
  /** ChannelPiece title, falling back to the EditorialContent title (same rule the editor uses). */
  title: string
  editorialContentTitle: string
  /** `Instagram Carousel`-style label (existing `channelFormatLabel`). */
  formatLabel: string
  productionId: string | null
  productionTitle: string | null
  href: string
}

export type VideoHandoffTarget = {
  draftId: string
  name: string
  productionId: string | null
  productionTitle: string | null
  href: string
}

export type HandoffFileSummary = {
  id: string
  name: string
  kind: LibraryFileKind
  mimeType: string | null
  projectId: string
  productionId: string | null
  productionTitle: string | null
}

/**
 * Production is CONTEXT, not a boundary: targets of the file's own Production come first, every other
 * Project target stays available (same Project / different Production, and a NULL Production on either
 * side, both remain valid — exactly like the Library browsers, whose Production filter can be set to "all").
 * Stable: the incoming order (most recently updated first) is preserved inside each group.
 */
export function prioritizeByProduction<T extends { productionId: string | null }>(targets: readonly T[], fileProductionId: string | null): T[] {
  if (!fileProductionId) return [...targets]
  return [...targets.filter((target) => target.productionId === fileProductionId), ...targets.filter((target) => target.productionId !== fileProductionId)]
}
