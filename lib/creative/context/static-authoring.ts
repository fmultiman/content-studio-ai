import type { CanvasSpec } from '@/lib/schemas/creative/primitives'
import { normalizeProjectIdentity } from '@/lib/project-identity-normalizer'
import type { ChannelPiece, EditorialContent, PublicationChannel, PublicationFormat } from '@/lib/types'

export type StaticAuthoringTarget = { mode: 'static'; canvas: CanvasSpec; templateVariant: 'cover'; label: string }

const VIDEO_FORMATS = new Set<PublicationFormat>(['reel', 'short', 'video_description'])

export function isStaticChannelPiece(channel: PublicationChannel, format: PublicationFormat): boolean {
  void channel
  return !VIDEO_FORMATS.has(format)
}

/**
 * Whether a Project's stored identity satisfies the Static Editor's readiness gate. This is the SAME predicate
 * `/api/creative/static-authoring-context` (and the render route) apply: `normalizeProjectIdentity` must return an
 * identity. Absent/empty is not ready; a structurally invalid identity throws there (the editor cannot open it
 * either), so it is also not ready here. Pure: it never creates or repairs an identity.
 */
export function isStaticEditorProjectIdentityReady(rawIdentity: unknown): boolean {
  try {
    return normalizeProjectIdentity(rawIdentity) !== null
  } catch {
    return false
  }
}

export function staticAuthoringTarget(channel: PublicationChannel, format: PublicationFormat): StaticAuthoringTarget | null {
  if (!isStaticChannelPiece(channel, format)) return null
  return {
    mode: 'static',
    canvas: channel === 'instagram' && format === 'story' ? { width: 1080, height: 1920, unit: 'px' } : { width: 1080, height: 1350, unit: 'px' },
    templateVariant: 'cover',
    label: `${channel}:${format}`,
  }
}

export function contextualContentForChannelPiece(editorialContent: EditorialContent, channelPiece: ChannelPiece) {
  // DocumentaryCardCoverContentSchema's detail_note is optional but, when
  // present, requires min(1) — an empty string is a present-but-invalid
  // value, not an absent one. Omit the key entirely when there is no CTA,
  // instead of sending '' and failing content validation at render time.
  return {
    eyebrow: channelPiece.channel,
    title: channelPiece.title || editorialContent.title,
    subtitle: channelPiece.body || editorialContent.body || '',
    source_line: channelPiece.format,
    ...(channelPiece.cta ? { detail_note: channelPiece.cta } : {}),
  }
}
