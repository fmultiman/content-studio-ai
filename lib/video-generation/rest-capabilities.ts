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

import type {
  VideoModelCapability,
  VideoModelOperationsCapability,
  VideoOperation,
  VideoOperationCapability,
} from './capabilities'

export const REST_MODEL_ID = 'kling-v3'
export const REST_KLING_V2_6_ID = 'kling-v2-6'

export const KLING_REST_MODEL_CAPABILITIES: Record<string, VideoModelOperationsCapability> = {
  [REST_MODEL_ID]: {
    id: REST_MODEL_ID,
    label: 'Kling 3.0',
    text_to_video: {
      id: REST_MODEL_ID,
      label: 'Kling 3.0',
      durations: [5, 10],
      resolutions: ['720p', '1080p'],
      aspectRatios: ['16:9', '9:16', '1:1'],
      audio: true,
      multiShot: true,
      asmr: false,
      audioPrompt: false,
      musicPrompt: false,
    },
    image_to_video: {
      id: REST_MODEL_ID,
      label: 'Kling 3.0',
      durations: [5, 10],
      resolutions: ['720p', '1080p'],
      aspectRatios: [],
      audio: true,
      multiShot: true,
      asmr: false,
      audioPrompt: false,
      musicPrompt: false,
    },
  },
  [REST_KLING_V2_6_ID]: {
    id: REST_KLING_V2_6_ID,
    label: 'Kling 2.6',
    text_to_video: {
      id: REST_KLING_V2_6_ID,
      label: 'Kling 2.6',
      durations: [5, 10],
      resolutions: ['720p', '1080p'],
      aspectRatios: ['16:9', '9:16', '1:1'],
      audio: true,
      multiShot: false, // Kling 2.6 does not support multi-shot
      asmr: false,
      audioPrompt: false,
      musicPrompt: false,
    },
    image_to_video: {
      id: REST_KLING_V2_6_ID,
      label: 'Kling 2.6',
      durations: [5, 10],
      resolutions: ['720p', '1080p'],
      aspectRatios: [],
      audio: true,
      multiShot: false, // Kling 2.6 does not support multi-shot
      audioRequiresResolution: '1080p',
      asmr: false,
      audioPrompt: false,
      musicPrompt: false,
    },
  },
}

export function restVideoOperations(): VideoOperationCapability[] {
  return [
    {
      operation: 'image_to_video',
      models: Object.values(KLING_REST_MODEL_CAPABILITIES)
        .map((m) => m.image_to_video)
        .filter((cap): cap is VideoModelCapability => Boolean(cap)),
    },
    {
      operation: 'text_to_video',
      models: Object.values(KLING_REST_MODEL_CAPABILITIES)
        .map((m) => m.text_to_video)
        .filter((cap): cap is VideoModelCapability => Boolean(cap)),
    },
  ]
}

export function getRestModelCapabilities(modelId: string): VideoModelOperationsCapability | undefined {
  return KLING_REST_MODEL_CAPABILITIES[modelId]
}

export function getRestModelOperationCapability(
  operation: VideoOperation,
  modelId: string,
): VideoModelCapability | undefined {
  const profile = KLING_REST_MODEL_CAPABILITIES[modelId]
  if (!profile) return undefined
  return operation === 'text_to_video' ? profile.text_to_video : profile.image_to_video
}
