import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const send = vi.fn()
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class { send = send },
  GetObjectCommand: class { constructor(public input: Record<string, unknown>) {} },
  CopyObjectCommand: class {}, DeleteObjectCommand: class {}, HeadObjectCommand: class {}, PutObjectCommand: class {},
}))
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: vi.fn() }))

import { openS3ObjectStream } from '../s3'

function configure() {
  process.env.S3_ENDPOINT = 'https://s3.example'
  process.env.S3_BUCKET_NAME = 'bucket'
  process.env.S3_ACCESS_KEY = 'k'
  process.env.S3_SECRET_KEY = 's'
}

describe('openS3ObjectStream', () => {
  beforeEach(() => { send.mockReset(); configure() })

  it('returns the live body stream without materialising it, with length and type', async () => {
    const body = Object.assign(Readable.from([Buffer.from('abc')]), { transformToByteArray: vi.fn() })
    send.mockResolvedValue({ Body: body, ContentLength: 3, ContentType: 'video/mp4' })
    const opened = await openS3ObjectStream('users/u/library/x/clip.mp4')
    expect(opened?.stream).toBe(body)
    expect(opened).toMatchObject({ contentLength: 3, contentType: 'video/mp4' })
    expect(body.transformToByteArray).not.toHaveBeenCalled()
    expect(send.mock.calls[0][0].input).toEqual({ Bucket: 'bucket', Key: 'users/u/library/x/clip.mp4' })
  })

  it('issues an inclusive HTTP range and forwards the abort signal', async () => {
    send.mockResolvedValue({ Body: Readable.from([]), ContentLength: 16 })
    const controller = new AbortController()
    await openS3ObjectStream('k', { range: { start: 10, end: 25 }, signal: controller.signal })
    expect(send.mock.calls[0][0].input).toMatchObject({ Range: 'bytes=10-25' })
    expect(send.mock.calls[0][1]).toEqual({ abortSignal: controller.signal })
  })

  it('returns null when there is no body or storage is unconfigured, and propagates storage failures', async () => {
    send.mockResolvedValue({})
    expect(await openS3ObjectStream('k')).toBeNull()
    send.mockRejectedValue(new Error('NoSuchKey'))
    await expect(openS3ObjectStream('k')).rejects.toThrow('NoSuchKey')
    delete process.env.S3_ENDPOINT
    expect(await openS3ObjectStream('k')).toBeNull()
  })
})
