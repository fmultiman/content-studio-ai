// VIDEO_GENERATION_CONNECTION_CAPABILITY_ROUTING_V1
//
// REST capabilities are CODE-BACKED, not discovered: they describe exactly what
// the executing adapter (lib/providers/kling/adapter.ts) and the proven REST
// flow support today. They deliberately do NOT advertise things Kling REST
// documentation supports but we have not productized (4K, other models, more
// durations, ...). Changing this file without changing the adapter is a bug.
//
// The model id is the value already stored in video_generations.model for every
// REST generation, so history and new rows agree.

import type { VideoModelCapability, VideoOperationCapability } from './capabilities'

export const REST_MODEL_ID = 'kling-v3'

const REST_MODEL_BASE = {
  id: REST_MODEL_ID,
  label: 'Kling 3.0',
  durations: [5, 10],
  resolutions: ['720p', '1080p'],
  audio: true,
  multiShot: true,
} satisfies Omit<VideoModelCapability, 'aspectRatios'>

export function restVideoOperations(): VideoOperationCapability[] {
  return [
    {
      operation: 'image_to_video',
      // REST I2V takes its framing from the source image: no aspect-ratio control.
      models: [{ ...REST_MODEL_BASE, durations: [...REST_MODEL_BASE.durations], resolutions: ['720p', '1080p'], aspectRatios: [] }],
    },
    {
      operation: 'text_to_video',
      models: [
        {
          ...REST_MODEL_BASE,
          durations: [...REST_MODEL_BASE.durations],
          resolutions: ['720p', '1080p'],
          aspectRatios: ['16:9', '9:16', '1:1'],
        },
      ],
    },
  ]
}
