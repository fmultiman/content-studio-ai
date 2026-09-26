import type { TimelineManifest } from './timeline'

// ─── Wave 2 — Neutral Schemas ───────────────────────────────────────────────
//
// Semantic validation that Zod's structural parse cannot express on its own
// (cross-field and cross-array checks within one manifest). Anything that
// would require the Template Registry, Identity Resolver, or Asset Resolver
// (Wave 3) is explicitly deferred — see the DEFERRED comments below and
// docs/discovery/creative-rendering/WAVE_2_NEUTRAL_SCHEMAS.md.

export type ValidationIssue = {
  code: string
  path?: string
  message: string
  severity: 'warning' | 'error'
}

export type ValidationResult = {
  valid: boolean
  issues: ValidationIssue[]
}

function ok(issues: ValidationIssue[]): ValidationResult {
  return { valid: issues.every((issue) => issue.severity !== 'error'), issues }
}

/**
 * Validates cross-field/cross-array invariants of an already Zod-parsed
 * TimelineManifest. Call this only after TimelineManifestSchema.parse()
 * succeeds — it assumes structural validity.
 *
 * Covers (V0):
 *   - track ids are unique;
 *   - segment ids are unique;
 *   - every segment.track_id references an existing track;
 *   - every segment stays within the timeline's total duration;
 *   - media segments: source_out_frame > source_in_frame when both present.
 *
 * DEFERRED to Wave 3 (needs Template Registry / Identity Resolver / Asset
 * Resolver, none of which exist yet):
 *   - template id/version resolves in the Registry;
 *   - template content/assets pass the template's own schema;
 *   - motion preset is supported by the resolved template;
 *   - identity snapshot actually resolves;
 *   - asset_ref values resolve to real assets;
 *   - track/segment kind compatibility beyond structural shape.
 */
export function validateTimelineSemantics(manifest: TimelineManifest): ValidationResult {
  const issues: ValidationIssue[] = []

  const trackIds = new Set<string>()
  for (const track of manifest.tracks) {
    if (trackIds.has(track.id)) {
      issues.push({
        code: 'duplicate_track_id',
        path: `tracks[id=${track.id}]`,
        message: `Duplicate track id: ${track.id}`,
        severity: 'error',
      })
    }
    trackIds.add(track.id)
  }

  const segmentIds = new Set<string>()
  for (const segment of manifest.segments) {
    if (segmentIds.has(segment.id)) {
      issues.push({
        code: 'duplicate_segment_id',
        path: `segments[id=${segment.id}]`,
        message: `Duplicate segment id: ${segment.id}`,
        severity: 'error',
      })
    }
    segmentIds.add(segment.id)

    if (!trackIds.has(segment.track_id)) {
      issues.push({
        code: 'segment_track_not_found',
        path: `segments[id=${segment.id}].track_id`,
        message: `Segment "${segment.id}" references unknown track "${segment.track_id}"`,
        severity: 'error',
      })
    }

    if (segment.start_frame + segment.duration_frames > manifest.specification.duration_frames) {
      issues.push({
        code: 'segment_out_of_bounds',
        path: `segments[id=${segment.id}]`,
        message: `Segment "${segment.id}" ends after the timeline's total duration_frames`,
        severity: 'error',
      })
    }

    // VIDEO_HIERARCHICAL_SCENE_TIMING_SPIKE_V1: element timing is segment-local and inside the segment.
    if (segment.kind === 'template' && segment.payload.element_timing) {
      const seen = new Set<string>()
      for (const entry of segment.payload.element_timing) {
        if (seen.has(entry.element_id) || entry.start_frame + entry.duration_frames > segment.duration_frames) {
          issues.push({
            code: 'invalid_element_timing',
            path: `segments[id=${segment.id}].payload.element_timing[element_id=${entry.element_id}]`,
            message: `Segment "${segment.id}": element "${entry.element_id}" timing is duplicated or reaches past the segment`,
            severity: 'error',
          })
        }
        seen.add(entry.element_id)
      }
    }

    if (segment.kind === 'media') {
      const { source_in_frame, source_out_frame } = segment.payload
      if (
        source_in_frame !== undefined &&
        source_out_frame !== undefined &&
        source_out_frame <= source_in_frame
      ) {
        issues.push({
          code: 'invalid_source_range',
          path: `segments[id=${segment.id}].payload`,
          message: `Segment "${segment.id}": source_out_frame must be greater than source_in_frame`,
          severity: 'error',
        })
      }
    }
  }

  return ok(issues)
}
