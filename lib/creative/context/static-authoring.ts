import type { CanvasSpec } from '@/lib/schemas/creative/primitives'
import type { ChannelPiece, EditorialContent, PublicationChannel, PublicationFormat } from '@/lib/types'

export type StaticAuthoringTarget = { mode: 'static'; canvas: CanvasSpec; templateVariant: 'cover'; label: string }

const VIDEO_FORMATS = new Set<PublicationFormat>(['reel', 'short', 'video_description'])

export function isStaticChannelPiece(channel: PublicationChannel, format: PublicationFormat): boolean {
  void channel
  return !VIDEO_FORMATS.has(format)
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
  return {
    eyebrow: channelPiece.channel,
    title: channelPiece.title || editorialContent.title,
    subtitle: channelPiece.body || editorialContent.body || '',
    source_line: channelPiece.format,
    detail_note: channelPiece.cta || '',
  }
}
