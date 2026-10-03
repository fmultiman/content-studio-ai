import { z } from 'zod'
import {
  VIDEO_ASPECT_RATIOS,
  VIDEO_OPERATIONS,
  VIDEO_RESOLUTIONS,
  type VideoAspectRatio,
  type VideoAudio,
  type VideoOperation,
  type VideoResolution
} from './capabilities'
import { REST_CONNECTION_REF, accountConnectionRef, parseConnectionRef } from './connection-ref'
import type { VideoFormSelection } from './form-selection'
import type { I2vSource } from './i2v-source'

export const VideoFormSelectionSchema = z.object({
  connectionRef: z.string().nullable().refine((val) => val === null || parseConnectionRef(val) !== null, {
    message: 'Invalid connection reference format',
  }),
  operation: z.enum(VIDEO_OPERATIONS).nullable(),
  modelId: z.string().nullable(),
  duration: z.number().nullable(),
  resolution: z.enum(VIDEO_RESOLUTIONS).nullable(),
  aspectRatio: z.enum(VIDEO_ASPECT_RATIOS).nullable(),
  audio: z.enum(['off', 'on']).nullable(),
  multiShot: z.boolean().nullable(),
  asmr: z.boolean().nullable(),
  audioPrompt: z.string().nullable(),
  musicPrompt: z.string().nullable(),
})

export const I2vWorkingSourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('generated'), id: z.string() }),
  z.object({ type: z.literal('library'), id: z.string() }),
])

export const VideoGenerationWorkingStateV1Schema = z.object({
  schemaVersion: z.literal(1),
  prompt: z.string(),
  source: I2vWorkingSourceSchema.nullable(),
  selection: VideoFormSelectionSchema,
})

export type VideoGenerationWorkingStateV1 = z.infer<typeof VideoGenerationWorkingStateV1Schema>

/** A subset of VideoGeneration representing the persisted fields we need to read for attempting to recreate working state. */
export interface HistoricalVideoGenerationSnapshot {
  prompt: string
  mode: string
  model: string
  transport?: string | null
  connection_id?: string | null
  source_image_id?: string | null
  source_library_file_id?: string | null
  request_config?: Record<string, unknown> | null
}

/**
 * Reconstructs a reusable working state from a historical video generation attempt.
 * This is a pure mapping from factual historical truth (the attempt) to the working representation.
 * It degrades gracefully for legacy/standalone generations and missing values.
 * 
 * @param attempt - The historical generation attempt subset
 * @returns The V1 working state representing the requested intent.
 */
export function attemptToWorkingState(attempt: HistoricalVideoGenerationSnapshot): VideoGenerationWorkingStateV1 {
  const isI2v = attempt.mode === 'image_to_video'
  
  let source: I2vSource | null = null
  if (isI2v) {
    if (attempt.source_library_file_id) {
      source = { type: 'library', id: attempt.source_library_file_id }
    } else if (attempt.source_image_id) {
      source = { type: 'generated', id: attempt.source_image_id }
    }
  }

  const transport = attempt.transport ?? 'rest'
  let connectionRef: string | null = null
  if (transport === 'rest') {
    connectionRef = REST_CONNECTION_REF
  } else if (transport === 'mcp' && attempt.connection_id) {
    connectionRef = accountConnectionRef(attempt.connection_id)
  }

  const config = attempt.request_config ?? {}

  const selection: VideoFormSelection = {
    connectionRef,
    operation: (attempt.mode as VideoOperation) || null,
    modelId: attempt.model || null,
    duration: typeof config.duration === 'number' ? config.duration : null,
    resolution: (typeof config.resolution === 'string' ? config.resolution as VideoResolution : null),
    aspectRatio: (typeof config.aspect_ratio === 'string' ? config.aspect_ratio as VideoAspectRatio : null),
    audio: (typeof config.audio === 'string' ? config.audio as VideoAudio : null),
    multiShot: typeof config.multi_shot === 'boolean' ? config.multi_shot : null,
    asmr: typeof config.asmr === 'boolean' ? config.asmr : null,
    audioPrompt: typeof config.audio_prompt === 'string' ? config.audio_prompt : null,
    musicPrompt: typeof config.music_prompt === 'string' ? config.music_prompt : null,
  }

  return {
    schemaVersion: 1,
    prompt: attempt.prompt || '',
    source,
    selection,
  }
}
