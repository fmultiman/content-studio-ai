// Test-only fixture: the SHAPE and per-model argument specs that Kling's MCP
// `who_am_i` returned for a real Pro account (read-only observation made while
// implementing VIDEO_GENERATION_CONNECTION_CAPABILITY_ROUTING_V1). Descriptions
// are trimmed; ids, argument names, defaults and allowed values are as observed.
// The account id is a placeholder.

type Arg = { name: string; required?: boolean; default?: string; allowedValues?: string[]; description?: string; maxItems?: number }
type Input = { name: string; required: boolean; description: string }

const arg = (name: string, allowedValues: string[], def: string): Arg => ({ name, required: false, default: def, allowedValues, description: name })
const prompt: Arg = { name: 'prompt', required: true, description: 'Text prompt' }

const seconds = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => String(from + i))
const bool = ['true', 'false']
const ratios = ['16:9', '9:16', '1:1']
const firstImage: Input[] = [
  { name: 'first_image', required: true, description: 'Source image URL' },
  { name: 'tail_image', required: false, description: 'Optional tail image URL' },
]
const imageRefs: Input[] = [
  { name: 'image_1', required: true, description: 'Reference image #1' },
  ...[2, 3, 4, 5, 6, 7].map((n) => ({ name: `image_${n}`, required: false, description: `Reference image #${n}` })),
]

const imageCount = arg('imageCount', ['1', '2', '3', '4'], '1')
const audio = arg('enable_audio', bool, 'true')
const multiShot = (def: string) => arg('prefer_multi_shots', bool, def)
const elements: Arg = { name: 'elements', required: false, maxItems: 3, description: 'Optional subjects' }

const m = (model: string, args: Arg[], inputs: Input[] = []) => ({ model, alias: model, description: model, arguments: args, inputs })

export const WHO_AM_I_TEXT_TO_VIDEO = [
  m('kling-video-v2_5', [prompt, arg('duration', ['5', '10'], '5'), arg('aspect_ratio', ratios, '16:9'), imageCount, arg('resolution', ['720p', '1080p'], '1080p'), audio, arg('enable_asmr', bool, 'false'), { name: 'audio_prompt', required: false }, { name: 'music_prompt', required: false }]),
  m('kling-video-v2_6', [prompt, arg('duration', ['5', '10'], '5'), arg('aspect_ratio', ratios, '16:9'), imageCount, arg('resolution', ['720p', '1080p'], '1080p'), audio]),
  m('kling-video-o1', [prompt, arg('duration', seconds(3, 10), '5'), arg('aspect_ratio', ratios, '16:9'), arg('resolution', ['720p', '1080p'], '1080p'), imageCount]),
  m('kling-video-v3_0_omni', [prompt, arg('duration', seconds(3, 15), '5'), arg('aspect_ratio', ratios, '16:9'), arg('resolution', ['720p', '1080p', '4k'], '1080p'), imageCount, multiShot('false'), audio]),
  m('kling-video-v3_0', [prompt, arg('duration', seconds(3, 15), '5'), arg('aspect_ratio', ratios, '16:9'), arg('resolution', ['720p', '1080p', '4k'], '1080p'), imageCount, multiShot('true'), audio]),
  m('kling-video-v3_0_turbo', [prompt, arg('duration', seconds(3, 15), '5'), arg('resolution', ['720p', '1080p'], '1080p'), imageCount, arg('aspect_ratio', ratios, '16:9')]),
]

export const WHO_AM_I_IMAGE_TO_VIDEO = [
  m('kling-video-v2_5', [prompt, arg('duration', ['5', '10'], '5'), imageCount, arg('resolution', ['720p', '1080p'], '1080p'), audio, arg('enable_asmr', bool, 'false')], firstImage),
  // Kling 2.6 image_to_video states its tail-image contract IN the argument descriptions (observed, mcpVersion 1.3.3):
  // "Tail image requires 1080p." and "Only at resolution=1080p; not supported with a tail image."
  m('kling-video-v2_6', [
    prompt,
    arg('duration', ['5', '10'], '5'),
    imageCount,
    { ...arg('resolution', ['720p', '1080p'], '1080p'), description: 'Quality tier. 720p=std, 1080p=pro. Tail image requires 1080p.' },
    { ...audio, description: 'Produce a work that includes audio. Only at resolution=1080p; not supported with a tail image.' },
  ], firstImage),
  // Multi-reference "omni" models take image_1..image_7 and reference images in the prompt: NOT a single-source I2V.
  m('kling-video-o1', [prompt, arg('duration', seconds(3, 10), '5'), arg('aspect_ratio', ratios, '16:9'), arg('resolution', ['720p', '1080p'], '1080p'), imageCount, elements], imageRefs),
  m('kling-video-v3_0_omni', [prompt, arg('duration', seconds(3, 15), '5'), arg('aspect_ratio', ratios, '16:9'), arg('resolution', ['720p', '1080p', '4k'], '1080p'), imageCount, multiShot('false'), audio, elements], imageRefs),
  m('kling-video-v3_0', [prompt, arg('duration', seconds(3, 15), '5'), arg('resolution', ['720p', '1080p', '4k'], '1080p'), imageCount, multiShot('true'), audio, elements], firstImage),
  m('kling-video-v3_0_turbo', [prompt, arg('duration', seconds(3, 15), '5'), arg('resolution', ['720p', '1080p'], '1080p'), imageCount], firstImage.slice(0, 1)),
]

export function whoAmIFixture(): Record<string, unknown> {
  return {
    user: { userId: 424242 },
    mcpVersion: '1.3.3',
    availableModels: {
      text_to_video: { defaultModel: 'kling-video-v3_0_omni', models: WHO_AM_I_TEXT_TO_VIDEO },
      image_to_video: { defaultModel: 'kling-video-v3_0', models: WHO_AM_I_IMAGE_TO_VIDEO },
    },
    authMode: 'oauth',
  }
}
