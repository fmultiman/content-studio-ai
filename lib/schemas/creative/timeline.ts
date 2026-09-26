import { z } from 'zod'
import {
  AssetFitSchema,
  AssetRefSchema,
  ContentBindingsSchema,
  IdentitySnapshotRefSchema,
  MotionSpecSchema,
  RefSchema,
  SequenceContextSchema,
  TemplateRefSchema,
  TransitionSpecSchema,
  VideoContainerSchema,
} from './primitives'

// ─── Wave 2 — Neutral Schemas ───────────────────────────────────────────────
//
// TimelineManifest V0 refines the neutral montage contract already decided
// for video (Scene Plan -> Assembly -> Timeline Manifest -> renderer/editor
// adapters) so it can also carry `template` segments shared with static
// render. Frames are the canonical time unit for this spike. This module
// must never import remotion/@remotion/* — see __tests__/isolation.test.ts.
//
// Boundary preserved from VIDEO_PRODUCTION_V0_DOMAIN.md /
// KNOWLEDGE_EXPLAINER_HYBRID_V0_COMPLETE.md:
//   Scene Plan (intent) != Timeline Segment (concrete edit decision)
//   != Template (how it's drawn) != Renderer (how it's executed).

export const FrameSchema = z.number().int().nonnegative()

export const PositiveFrameCountSchema = z.number().int().positive()

export const TimelineSpecificationSchema = z
  .object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.number().positive(),
    duration_frames: PositiveFrameCountSchema,
  })
  .strict()

export type TimelineSpecification = z.infer<typeof TimelineSpecificationSchema>

// Decision C2 (Wave 2): VideoWork does not exist in the product yet, so
// video_work_ref is optional. No VideoWork table, no migration, no
// persistent placeholder is created to support this field.
export const TimelineContextSchema = z
  .object({
    project_ref: RefSchema,
    production_ref: RefSchema,
    video_work_ref: RefSchema.optional(),
  })
  .strict()

export type TimelineContext = z.infer<typeof TimelineContextSchema>

// ─── Tracks ──────────────────────────────────────────────────────────────────

export const TimelineTrackKindSchema = z.enum(['video', 'audio', 'overlay', 'caption'])

export const TimelineTrackSchema = z
  .object({
    id: RefSchema,
    kind: TimelineTrackKindSchema,
    order: z.number().int().nonnegative(),

    // Editing/UI metadata only — does not change render semantics.
    muted: z.boolean().optional(),
    locked: z.boolean().optional(),
  })
  .strict()

export type TimelineTrack = z.infer<typeof TimelineTrackSchema>

// ─── Segments ────────────────────────────────────────────────────────────────

const TimelineSegmentBaseSchema = z
  .object({
    id: RefSchema,
    track_id: RefSchema,

    scene_plan_ref: RefSchema.optional(),

    start_frame: FrameSchema,
    duration_frames: PositiveFrameCountSchema,

    transition_out: TransitionSpecSchema.optional(),
  })
  .strict()

export const MediaSegmentPayloadSchema = z
  .object({
    asset_ref: RefSchema,

    source_in_frame: FrameSchema.optional(),
    source_out_frame: FrameSchema.optional(),

    fit: AssetFitSchema.optional(),

    transform: z
      .object({
        scale: z.number().positive().optional(),
        position: z
          .object({
            x: z.number().min(0).max(1),
            y: z.number().min(0).max(1),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

export const MediaSegmentSchema = TimelineSegmentBaseSchema.extend({
  kind: z.literal('media'),
  payload: MediaSegmentPayloadSchema,
})

// VIDEO_SCENE_COMPOSITION_PARITY_V1: the segment's spatial element stack,
// in the template's own element ids (like `template.variant`, they only mean
// something inside that template). Absent = the layout's default stack with
// every element visible — i.e. every manifest produced before it existed.
const ElementIdListSchema = z.array(z.string().trim().min(1).max(64)).max(64)

export const TemplateSegmentLayeringSchema = z
  .object({
    // Paint order, back -> front.
    element_order: ElementIdListSchema.optional(),
    hidden_elements: ElementIdListSchema.optional(),
  })
  .strict()

export type TemplateSegmentLayering = z.infer<typeof TemplateSegmentLayeringSchema>

// VIDEO_HIERARCHICAL_SCENE_TIMING_SPIKE_V1: WHEN some of the segment's own
// template elements participate, in SEGMENT-LOCAL frames (0 = segment start),
// already clipped to the segment. An element that is not listed participates
// for the whole segment (every manifest produced before it existed). Timing is
// temporal, so it sits beside `motion`, not inside the spatial `layering`.
export const TemplateSegmentElementTimingSchema = z
  .object({
    element_id: z.string().trim().min(1).max(64),
    start_frame: FrameSchema,
    // 0 = the element does not participate in this segment (authored start at/after its end).
    duration_frames: FrameSchema,
  })
  .strict()

export type TemplateSegmentElementTiming = z.infer<typeof TemplateSegmentElementTimingSchema>

// The main integration point with StaticRenderManifest: same TemplateRef,
// content, and assets shape can drive both a still and a timeline segment.
export const TemplateSegmentPayloadSchema = z
  .object({
    template: TemplateRefSchema,

    content: ContentBindingsSchema,
    assets: z.record(z.string().trim().min(1), AssetRefSchema),

    // Decision C7 (Wave 2): optional sequence context, same primitive used
    // by StaticRenderManifest — never Documentary-Card-specific.
    sequence: SequenceContextSchema.optional(),

    motion: MotionSpecSchema.optional(),

    layering: TemplateSegmentLayeringSchema.optional(),

    element_timing: z.array(TemplateSegmentElementTimingSchema).max(64).optional(),
  })
  .strict()

export const TemplateSegmentSchema = TimelineSegmentBaseSchema.extend({
  kind: z.literal('template'),
  payload: TemplateSegmentPayloadSchema,
})

export const AudioSegmentPayloadSchema = z
  .object({
    asset_ref: RefSchema,

    gain: z.number().nonnegative().default(1),

    source_in_frame: FrameSchema.optional(),
    source_out_frame: FrameSchema.optional(),

    fade_in_frames: FrameSchema.optional(),
    fade_out_frames: FrameSchema.optional(),
  })
  .strict()

export const AudioSegmentSchema = TimelineSegmentBaseSchema.extend({
  kind: z.literal('audio'),
  payload: AudioSegmentPayloadSchema,
})

// Useful for simple overlays that do not justify a full template.
export const TextSegmentPayloadSchema = z
  .object({
    text: z.string().min(1),

    role: z.enum(['title', 'subtitle', 'label', 'lower_third', 'source']),

    motion: MotionSpecSchema.optional(),
  })
  .strict()

export const TextSegmentSchema = TimelineSegmentBaseSchema.extend({
  kind: z.literal('text'),
  payload: TextSegmentPayloadSchema,
})

// Captions may alternatively live as a separate artifact bound via
// TimelineManifest.captions — this per-segment shape is permitted, not
// mandatory, in V0.
export const CaptionSegmentPayloadSchema = z
  .object({
    text: z.string().min(1),
    speaker_ref: RefSchema.optional(),
  })
  .strict()

export const CaptionSegmentSchema = TimelineSegmentBaseSchema.extend({
  kind: z.literal('caption'),
  payload: CaptionSegmentPayloadSchema,
})

export const TimelineSegmentSchema = z.discriminatedUnion('kind', [
  MediaSegmentSchema,
  TemplateSegmentSchema,
  AudioSegmentSchema,
  TextSegmentSchema,
  CaptionSegmentSchema,
])

export type TimelineSegment = z.infer<typeof TimelineSegmentSchema>

// ─── Captions binding / render intent ────────────────────────────────────────

export const CaptionsBindingSchema = z
  .object({
    artifact_ref: RefSchema,
    mode: z.enum(['burned_in', 'sidecar', 'none']),
  })
  .strict()

export type CaptionsBinding = z.infer<typeof CaptionsBindingSchema>

// Declares technical purpose, never a renderer. No worker, Lambda, Chromium,
// or FFmpeg configuration belongs here.
export const TimelineRenderIntentSchema = z
  .object({
    purpose: z.enum(['preview', 'rough_cut', 'final']),
    container: VideoContainerSchema.optional(),
    audio: z.boolean(),
    captions: z.enum(['burned_in', 'sidecar', 'none']).optional(),
  })
  .strict()

export type TimelineRenderIntent = z.infer<typeof TimelineRenderIntentSchema>

// ─── TimelineManifest ────────────────────────────────────────────────────────

export const TimelineManifestSchema = z
  .object({
    schema_version: z.literal('timeline.v0'),
    manifest_id: RefSchema,

    context: TimelineContextSchema,
    specification: TimelineSpecificationSchema,

    identity: IdentitySnapshotRefSchema,

    tracks: z.array(TimelineTrackSchema).min(1),
    segments: z.array(TimelineSegmentSchema),

    assets: z.record(z.string().trim().min(1), AssetRefSchema),

    captions: CaptionsBindingSchema.optional(),

    render_intent: TimelineRenderIntentSchema,
  })
  .strict()

export type TimelineManifest = z.infer<typeof TimelineManifestSchema>
