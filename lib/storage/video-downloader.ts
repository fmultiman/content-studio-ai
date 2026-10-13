import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { pinnedFetch } from './pinned-fetch'
import { assertPublicHost, isSafeResultUrl, type HostResolver } from './safe-result-url'

export const getS3Client = () =>
  new S3Client({
    region: process.env.S3_REGION || 'us-east-1',
    endpoint: process.env.S3_ENDPOINT,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY || process.env.S3_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.S3_SECRET_KEY || process.env.S3_SECRET_ACCESS_KEY || '',
    },
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
  })

export async function uploadApplicationVideo(
  buffer: Buffer,
  storagePath: string,
  contentType: string,
  size: number
) {
  const Bucket = process.env.S3_BUCKET_NAME || process.env.S3_BUCKET
  if (!Bucket) throw new Error('S3_BUCKET_NAME is not defined')

  const client = getS3Client()
  await client.send(
    new PutObjectCommand({
      Bucket,
      Key: storagePath,
      Body: buffer,
      ContentType: contentType,
    })
  )

  const publicBase = process.env.PUBLIC_STORAGE_BASE_URL || `${(process.env.S3_ENDPOINT || '').replace(/\/$/, '')}/${Bucket}`
  const publicUrl = `${publicBase.replace(/\/$/, '')}/${storagePath.split('/').map(encodeURIComponent).join('/')}`

  return { storagePath, publicUrl, mime: contentType, size }
}

export interface DownloadAndStoreOptions {
  /**
   * Deterministic object file name. Completion passes the generation id so a
   * retried/duplicated/concurrent completion overwrites the SAME object instead
   * of creating a second one (idempotent promotion to app-owned storage).
   */
  objectName?: string
  /**
   * Request headers the provider requires on the RESULT URL itself (Google Veo: the user's `x-goog-api-key`). They are
   * sent only to the host of the original URL and are dropped on any redirect to another host, so a credential can
   * never follow a redirect to a different origin. Never logged, never stored.
   */
  headers?: Record<string, string>
}

/** Limits for fetching a provider-supplied result URL (external input). */
export const MAX_VIDEO_BYTES = 300 * 1024 * 1024
export const VIDEO_DOWNLOAD_TIMEOUT_MS = 120_000
export const MAX_REDIRECTS = 3

export interface FetchDependencies {
  /** Default: a GET pinned to the vetted address (no second DNS resolution, no redirect following). */
  fetchFn?: (url: string, init: { redirect: 'manual'; signal: AbortSignal; address: string; headers?: Record<string, string> }) => Promise<Response>
  resolveHost?: HostResolver
  upload?: typeof uploadApplicationVideo
}

const ACCEPTED_MIME = /^(video\/|application\/octet-stream|binary\/octet-stream)/i

/**
 * Fetches a provider result URL defensively: every hop (including redirects,
 * which are followed MANUALLY and re-validated) must be https to a host that
 * resolves to public addresses only; the request is time-bounded; the body is
 * size-capped while streaming; and only video-like content types are accepted.
 */
async function fetchProviderVideo(url: string, deps: FetchDependencies, headers?: Record<string, string>): Promise<{ buffer: Buffer; mime: string }> {
  const fetchFn = deps.fetchFn ?? ((target, init) => pinnedFetch(target, { address: init.address, signal: init.signal, headers: init.headers }))
  const originHost = new URL(url).hostname.toLowerCase()
  const signal = AbortSignal.timeout(VIDEO_DOWNLOAD_TIMEOUT_MS)

  let current = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!isSafeResultUrl(current)) throw new Error('Result URL is not allowed.')
    // Vet the DNS answer, then connect to THAT address (not to a fresh lookup).
    const [address] = await assertPublicHost(new URL(current).hostname, deps.resolveHost)

    const sameOrigin = new URL(current).hostname.toLowerCase() === originHost
    const res = await fetchFn(current, { redirect: 'manual', signal, address, ...(headers && sameOrigin ? { headers } : {}) })

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      if (!location) throw new Error('Redirect without a location.')
      current = new URL(location, current).toString()
      continue
    }

    if (!res.ok) throw new Error(`Failed to fetch remote video. Status: ${res.status}`)

    const declared = res.headers.get('content-type')
    if (declared && !ACCEPTED_MIME.test(declared)) throw new Error('Result is not a video.')
    const mime = declared && declared.toLowerCase().startsWith('video/') ? declared : 'video/mp4'

    const length = Number.parseInt(res.headers.get('content-length') || '0', 10)
    if (length > MAX_VIDEO_BYTES) throw new Error('Result video is too large.')

    if (!res.body) {
      const buffer = Buffer.from(await res.arrayBuffer())
      if (buffer.length > MAX_VIDEO_BYTES) throw new Error('Result video is too large.')
      return { buffer, mime }
    }

    // With a declared length the body is written straight into ONE preallocated
    // buffer (peak memory ~ the video size, not 2x); without one, chunks are
    // collected and joined. Either way the cap is enforced while streaming.
    const reader = res.body.getReader()
    const preallocated = length > 0 ? Buffer.allocUnsafe(length) : null
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_VIDEO_BYTES || (preallocated && total > preallocated.length)) {
        await reader.cancel().catch(() => undefined)
        throw new Error('Result video is too large.')
      }
      if (preallocated) preallocated.set(value, total - value.byteLength)
      else chunks.push(value)
    }
    return { buffer: preallocated ? preallocated.subarray(0, total) : Buffer.concat(chunks, total), mime }
  }

  throw new Error('Too many redirects.')
}

export async function downloadAndStoreVideo(
  url: string,
  prefix: string,
  options: DownloadAndStoreOptions = {},
  deps: FetchDependencies = {},
): Promise<{ storagePath: string, publicUrl: string, mime: string, size: number }> {
  const { buffer, mime } = await fetchProviderVideo(url, deps, options.headers)

  const fileName = options.objectName ?? `${Date.now()}-${Math.random().toString(36).substring(7)}.mp4`
  const objectPath = `${prefix}/${fileName}`

  return await (deps.upload ?? uploadApplicationVideo)(buffer, objectPath, mime, buffer.length)
}
