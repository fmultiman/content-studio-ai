import { describe, expect, it } from 'vitest'
import { normalizeKlingMcpVideoCapabilities } from '@/lib/provider-connections/kling-mcp-video-capabilities'
import { buildKlingMcpVideoCall } from '@/lib/provider-connections/kling-mcp-generation'
import { parseUploadTicket } from '@/lib/provider-connections/kling-mcp-upload'
import { validateVideoRequest } from '@/lib/video-generation/request'

// VIDEO_MCP_I2V_SOURCE_TRANSPORT_V1 — EVIDENCE, not behavior.
//
// Captured by reading the CURRENT Kling MCP server's own tool listing (who_am_i for image_to_video, and the `file_upload`
// / `image_to_video` tool descriptions), mcpVersion 1.3.3. This is the only thing the transport is built on: no
// real `file_upload`, no generation and no REST call was made to obtain it.
//
//   file_upload (tool description):
//     "Get a one-time upload ticket for sending a local file (image/video) to Kling AI. Then upload the file bytes
//      yourself: POST multipart/form-data to upload_url with two fields: 'ticket' (the ticket string) and 'file' (the file
//      bytes). The 'file' part Content-Type must be image/png, image/jpeg, or video/mp4. The upload response contains the
//      file URL, which can be used as the 'image' parameter of image_to_video or image_to_image. The ticket is single-use
//      and expires at expire_at. Reuse result URL instead of re-upload for unchanged local files. Supported image specs:
//      PNG/JPG only, below 4K resolution, <=30MB, aspect ratio no wider than 1:2."
//     input schema: { contentType: string, filename: string, size: integer, taskTraceId?: string } (all optional in the schema)
//   image_to_video (tool description):
//     "Input URLs must either be links returned by the file_upload tool for local uploads, or publicly accessible external file URLs."
//     first_image: "Must be url returned by file_upload tool, or a publicly accessible external file URL. No local file path."

const inputs = (...names: Array<[string, boolean]>) => names.map(([name, required]) => ({ name, required, description: 'x' }))
const FIRST_AND_TAIL = inputs(['first_image', true], ['tail_image', false])
const REFS = inputs(['image_1', true], ['image_2', false], ['image_3', false], ['image_4', false], ['image_5', false], ['image_6', false], ['image_7', false])
const args = (...extra: Array<{ name: string; allowedValues?: string[]; default?: string }>) => [
  { name: 'prompt', required: true, description: 'x' },
  { name: 'duration', required: false, default: '5', allowedValues: ['5', '10'], description: 'x' },
  { name: 'resolution', required: false, default: '1080p', allowedValues: ['720p', '1080p'], description: 'x' },
  { name: 'imageCount', required: false, default: '1', allowedValues: ['1'], description: 'x' },
  ...extra.map((entry) => ({ required: false, description: 'x', ...entry })),
]
const model = (id: string, modelArgs: ReturnType<typeof args>, modelInputs: ReturnType<typeof inputs>) => ({ model: id, arguments: modelArgs, inputs: modelInputs })

const LIVE_I2V = {
  mcpVersion: '1.3.3',
  user: { userId: 1 },
  availableModels: {
    image_to_video: {
      defaultModel: 'kling-video-v3_0',
      models: [
        model('kling-video-v2_5', args(), FIRST_AND_TAIL),
        model('kling-video-v2_6', args(), FIRST_AND_TAIL),
        model('kling-video-o1', args({ name: 'aspect_ratio', allowedValues: ['16:9', '9:16', '1:1'], default: '16:9' }), REFS),
        model('kling-video-v3_0_omni', args({ name: 'aspect_ratio', allowedValues: ['16:9', '9:16', '1:1'], default: '16:9' }), REFS),
        model('kling-video-v3_0', args(), FIRST_AND_TAIL),
        model('kling-video-v3_0_turbo', args(), inputs(['first_image', true])),
      ],
    },
  },
}

describe('the four single-image models share ONE image contract: `first_image`', () => {
  const operations = normalizeKlingMcpVideoCapabilities(LIVE_I2V).operations
  const SINGLE = ['kling-video-v2_5', 'kling-video-v2_6', 'kling-video-v3_0', 'kling-video-v3_0_turbo']

  it('exactly Kling 2.5, 2.6, 3.0 and 3.0 Turbo are offered for image_to_video; O1 and 3.0 Omni (image_1..image_7) are not', () => {
    const offered = operations.find((operation) => operation.operation === 'image_to_video')?.models.map((entry) => entry.id) ?? []
    expect(offered.sort()).toEqual([...SINGLE].sort())
    expect(offered).not.toContain('kling-video-o1')
    expect(offered).not.toContain('kling-video-v3_0_omni')
  })

  it.each(SINGLE)('%s: the paid call carries the uploaded provider URL as first_image, and only first_image (no tail_image, no element)', (id) => {
    const validation = validateVideoRequest(operations, { operation: 'image_to_video', model: id, duration: 5, resolution: '720p' })
    if (!validation.ok) throw new Error(validation.code)
    const built = buildKlingMcpVideoCall({ request: validation.request, model: validation.model, prompt: 'a fox', sourceImageUrl: 'https://provider-files.example.test/u/x.png' })
    expect(built.tool).toBe('image_to_video')
    expect(built.inputs).toEqual([{ name: 'first_image', inputType: 'URL', url: 'https://provider-files.example.test/u/x.png' }])
    expect(built.arguments.map((entry) => entry.name)).not.toContain('elements')
  })

  it('a multi-reference model is refused by validation, so it can never reach the upload/submit path', () => {
    for (const id of ['kling-video-o1', 'kling-video-v3_0_omni']) {
      expect(validateVideoRequest(operations, { operation: 'image_to_video', model: id, duration: 5, resolution: '720p' }).ok).toBe(false)
    }
  })
})

describe('the documented ticket field names are the ones the parser reads', () => {
  it('ticket, upload_url, expire_at', () => {
    expect(parseUploadTicket({ ticket: 'T', upload_url: 'https://upload.example.test/x', expire_at: 1_900_000_000 })).toEqual({
      ticket: 'T',
      uploadUrl: 'https://upload.example.test/x',
      expiresAtMs: 1_900_000_000_000,
    })
  })
})
