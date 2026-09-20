import type { ResolvedTimelineInput } from '@/lib/creative/resolution/resolve-timeline'

export type TimelineAdapterDiagnostic = {
  code: 'unsupported_segment_kind' | 'unsupported_template_track'
  segment_id: string
  message: string
}

/**
 * The V0 adapter deliberately renders only template segments on visual tracks.
 * Other neutral schema kinds remain valid and are reported rather than faked.
 */
export function timelineAdapterDiagnostics(input: ResolvedTimelineInput): TimelineAdapterDiagnostic[] {
  const tracks = new Map(input.manifest.tracks.map((track) => [track.id, track]))
  return input.manifest.segments.flatMap((segment): TimelineAdapterDiagnostic[] => {
    if (segment.kind !== 'template') {
      return [{
        code: 'unsupported_segment_kind' as const,
        segment_id: segment.id,
        message: `Timeline adapter preview does not render ${segment.kind} segments in Wave 7.`,
      }]
    }
    const track = tracks.get(segment.track_id)
    if (track && track.kind !== 'video' && track.kind !== 'overlay') {
      return [{
        code: 'unsupported_template_track' as const,
        segment_id: segment.id,
        message: `Template segment ${segment.id} is on non-visual ${track.kind} track.`,
      }]
    }
    return []
  })
}
