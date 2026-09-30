import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import sharp from 'sharp'
import { randomUUID } from 'crypto'

type UploadImageInput = {
  userId: string
  folder: 'images' | 'posts'
  dataUrl?: string
  buffer?: Buffer
  mimeType?: string
}

type PresignedUploadInput = {
  userId: string
  folder: 'images' | 'posts' | 'library'
  mimeType: string
  filename?: string
  prefix?: string | null
}

export type StoredImage = {
  imageUrl: string
  thumbnailUrl: string
  storageProvider: 's3'
  storagePath: string
  thumbnailPath: string
  fileSize: number
  mimeType: string
}

function getS3Config() {
  const endpoint = process.env.S3_ENDPOINT
  const bucket = process.env.S3_BUCKET_NAME || process.env.S3_BUCKET
  const accessKeyId = process.env.S3_ACCESS_KEY || process.env.S3_ACCESS_KEY_ID
  const secretAccessKey = process.env.S3_SECRET_KEY || process.env.S3_SECRET_ACCESS_KEY

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    return null
  }

  return {
    endpoint,
    bucket,
    region: process.env.S3_REGION || 'us-east-1',
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
    accessKeyId,
    secretAccessKey,
    publicBaseUrl: process.env.PUBLIC_STORAGE_BASE_URL || `${endpoint.replace(/\/$/, '')}/${bucket}`,
  }
}

function createS3Client(config: NonNullable<ReturnType<typeof getS3Config>>) {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
}

export function isS3StorageConfigured() {
  return Boolean(getS3Config())
}

function parseDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)

  if (!match) {
    throw new Error('Imagem em base64 invalida')
  }

  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], 'base64'),
  }
}

function extensionForMimeType(mimeType: string) {
  if (mimeType === 'application/pdf') return 'pdf'
  if (mimeType.startsWith('text/')) return 'txt'
  if (mimeType.startsWith('video/')) return 'mp4'
  if (mimeType.startsWith('audio/')) return 'mp3'
  if (mimeType === 'image/jpeg') return 'jpg'
  if (mimeType === 'image/webp') return 'webp'
  return 'png'
}

/**
 * The extension is the one part of a generated key that can come straight from a browser filename.
 * Only a short lowercase alphanumeric extension survives; anything else (separators, dots, query/hash
 * text, traversal) falls back to the extension implied by the MIME type, so it can never shape the key.
 */
export function safeKeyExtension(filename: string | null | undefined, mimeType: string): string {
  const requested = filename?.includes('.') ? (filename.split('.').pop() ?? '').toLowerCase() : ''
  return /^[a-z0-9]{1,8}$/.test(requested) ? requested : extensionForMimeType(mimeType)
}

function safePathSegment(value: string | null | undefined, fallback: string) {
  const safe = value
    ?.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-_.]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96)

  // A dot-only segment ('.', '..') is a path traversal element, never a name.
  if (safe && /^\.+$/.test(safe)) return fallback

  return safe || fallback
}

function publicUrl(publicBaseUrl: string, path: string) {
  return `${publicBaseUrl.replace(/\/$/, '')}/${path.split('/').map(encodeURIComponent).join('/')}`
}

function storagePrefix(prefix: string | null | undefined) {
  const cleanPrefix = prefix?.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  return cleanPrefix
    ? `${cleanPrefix.split('/').filter(Boolean).map((segment) => safePathSegment(segment, 'folder')).join('/')}/`
    : ''
}

export async function createPresignedImageUpload(input: PresignedUploadInput) {
  const config = getS3Config()

  if (!config) return null

  const extension = safeKeyExtension(input.filename, input.mimeType)
  const id = randomUUID()
  const safeName = safePathSegment(input.filename?.replace(/\.[^/.]+$/, ''), 'file')
  const prefix = storagePrefix(input.prefix)
  const path = `users/${input.userId}/${input.folder}/${prefix}${id}/${safeName}.${extension}`
  const client = createS3Client(config)
  const uploadUrl = await getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: path,
      ContentType: input.mimeType,
    }),
    { expiresIn: 900 },
  )

  return {
    uploadUrl,
    imageUrl: publicUrl(config.publicBaseUrl, path),
    storageProvider: 's3' as const,
    storagePath: path,
    mimeType: input.mimeType,
  }
}

export async function createS3FolderPlaceholder(input: {
  userId: string
  folder: 'library'
  prefix: string
}) {
  const config = getS3Config()

  if (!config) return null

  const prefix = storagePrefix(input.prefix)
  if (!prefix) return null

  const path = `users/${input.userId}/${input.folder}/${prefix}.keep`
  const client = createS3Client(config)
  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: path,
      Body: '',
      ContentType: 'text/plain',
    }),
  )

  return {
    storageProvider: 's3' as const,
    storagePath: path,
    fileSize: 0,
    mimeType: 'text/plain',
  }
}

export async function deleteS3FolderPlaceholder(input: {
  userId: string
  folder: 'library'
  prefix: string
}) {
  const prefix = storagePrefix(input.prefix)
  if (!prefix) return false

  return deleteS3Object(`users/${input.userId}/${input.folder}/${prefix}.keep`)
}

/** The durable, non-signed URL recorded for an object key this server generated or validated. */
export function buildStoragePublicUrl(path: string): string | null {
  const config = getS3Config()
  return config ? publicUrl(config.publicBaseUrl, path) : null
}

/** HEAD an object: proves it exists and returns the size/type S3 itself reports. Null = S3 not configured. */
export async function headS3Object(path: string): Promise<{ size: number; contentType: string | null } | null> {
  const config = getS3Config()
  if (!config) return null
  const client = createS3Client(config)
  const head = await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: path }))
  return { size: head.ContentLength ?? 0, contentType: head.ContentType ?? null }
}

export async function deleteS3Object(path: string) {
  const config = getS3Config()

  if (!config) return false

  const client = createS3Client(config)
  await client.send(
    new DeleteObjectCommand({
      Bucket: config.bucket,
      Key: path,
    }),
  )

  return true
}

export async function moveLibraryS3Object(input: {
  userId: string
  currentPath: string
  targetFolder: string
}) {
  const config = getS3Config()

  if (!config) return null

  const libraryPrefix = `users/${input.userId}/library/`
  if (!input.currentPath.startsWith(libraryPrefix)) {
    return null
  }

  const relativePath = input.currentPath.slice(libraryPrefix.length)
  const parts = relativePath.split('/').filter(Boolean)
  const tail = parts.length >= 2 ? parts.slice(-2).join('/') : parts.join('/')
  const targetPrefix = storagePrefix(input.targetFolder)
  const nextPath = `${libraryPrefix}${targetPrefix}${tail}`

  if (nextPath === input.currentPath) {
    return {
      storagePath: input.currentPath,
      publicUrl: publicUrl(config.publicBaseUrl, input.currentPath),
    }
  }

  const client = createS3Client(config)
  const copySource = `${config.bucket}/${input.currentPath.split('/').map(encodeURIComponent).join('/')}`

  await client.send(
    new CopyObjectCommand({
      Bucket: config.bucket,
      Key: nextPath,
      CopySource: copySource,
    }),
  )
  await client.send(
    new DeleteObjectCommand({
      Bucket: config.bucket,
      Key: input.currentPath,
    }),
  )

  return {
    storagePath: nextPath,
    publicUrl: publicUrl(config.publicBaseUrl, nextPath),
  }
}

export async function moveS3Object(input: {
  currentPath: string
  nextPath: string
}) {
  const config = getS3Config()

  if (!config) return null
  if (input.currentPath === input.nextPath) {
    return {
      storagePath: input.currentPath,
      publicUrl: publicUrl(config.publicBaseUrl, input.currentPath),
    }
  }

  const client = createS3Client(config)
  const copySource = `${config.bucket}/${input.currentPath.split('/').map(encodeURIComponent).join('/')}`

  await client.send(
    new CopyObjectCommand({
      Bucket: config.bucket,
      Key: input.nextPath,
      CopySource: copySource,
    }),
  )
  await client.send(
    new DeleteObjectCommand({
      Bucket: config.bucket,
      Key: input.currentPath,
    }),
  )

  return {
    storagePath: input.nextPath,
    publicUrl: publicUrl(config.publicBaseUrl, input.nextPath),
  }
}

type PresignedReadOptions = {
  filename?: string | null
  disposition?: 'inline' | 'attachment'
}

export async function createPresignedReadUrl(path: string, options: PresignedReadOptions = {}) {
  const config = getS3Config()

  if (!config) return null

  const client = createS3Client(config)
  const filename = options.filename?.trim()
  const disposition = options.disposition || 'inline'

  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: config.bucket,
      Key: path,
      ResponseContentDisposition: filename
        ? `${disposition}; filename*=UTF-8''${encodeURIComponent(filename)}`
        : disposition,
    }),
    { expiresIn: 3600 },
  )
}

/**
 * Server-side read of one object's bytes (Static Render Worker V1: streams a
 * completed static PNG from private scratch to the owner through a
 * same-origin, session-authorized route, so "Salvar nesta peca" can hand it
 * to the existing upload route without any browser->MinIO CORS dependency).
 * Callers are responsible for authorizing `path` first.
 */
export async function readS3Object(path: string, options: { maxBytes?: number } = {}) {
  const config = getS3Config()
  if (!config) return null
  const client = createS3Client(config)
  const result = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: path }))
  if (!result.Body) return null
  const bytes = await result.Body.transformToByteArray()
  if (options.maxBytes && bytes.byteLength > options.maxBytes) throw new Error('Object exceeds the allowed size.')
  return { bytes, contentType: result.ContentType ?? 'application/octet-stream' }
}

export type UploadedLibraryFile = {
  storagePath: string
  publicUrl: string
  fileSize: number
  mimeType: string
}

/**
 * Copies an already-stored object into the durable Library namespace without
 * deleting or rewriting the source object. Used when a server-authoritative
 * render output crosses the explicit scratch -> Library durability boundary.
 *
 * A HEAD is performed first so a missing/unreadable source can never produce
 * a LibraryFile row that only *claims* durable bytes exist. CopyObject keeps
 * the payload byte-for-byte identical while giving the durable copy its own
 * Library lifecycle and key.
 */
export async function copyS3ObjectToLibrary(input: {
  userId: string
  sourcePath: string
  filename: string
  mimeType: string
}): Promise<UploadedLibraryFile | null> {
  const config = getS3Config()
  if (!config) return null

  const client = createS3Client(config)
  const source = await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: input.sourcePath }))
  const fileSize = source.ContentLength ?? 0
  if (fileSize <= 0) throw new Error('Source object is empty or has no readable size.')

  const ext = safeKeyExtension(input.filename, input.mimeType)
  const id = randomUUID()
  const baseName = safePathSegment(input.filename.replace(/\.[^/.]+$/, ''), 'file')
  const path = `users/${input.userId}/library/${id}/${baseName}.${ext}`
  const copySource = `${config.bucket}/${input.sourcePath.split('/').map(encodeURIComponent).join('/')}`

  await client.send(
    new CopyObjectCommand({
      Bucket: config.bucket,
      Key: path,
      CopySource: copySource,
    }),
  )

  return {
    storagePath: path,
    publicUrl: publicUrl(config.publicBaseUrl, path),
    fileSize,
    mimeType: source.ContentType || input.mimeType,
  }
}

// Uploads a binary buffer directly to S3 under the library folder.
// Path convention: users/{userId}/library/{uuid}/{safeName}.{ext}
// Returns null when S3 is not configured.
export async function uploadLibraryFile(input: {
  userId: string
  filename: string
  mimeType: string
  buffer: Buffer
}): Promise<UploadedLibraryFile | null> {
  const config = getS3Config()
  if (!config) return null

  const ext = safeKeyExtension(input.filename, input.mimeType)
  const id = randomUUID()
  const baseName = safePathSegment(input.filename.replace(/\.[^/.]+$/, ''), 'file')
  const path = `users/${input.userId}/library/${id}/${baseName}.${ext}`

  const client = createS3Client(config)
  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: path,
      Body: input.buffer,
      ContentType: input.mimeType,
    }),
  )

  return {
    storagePath: path,
    publicUrl: publicUrl(config.publicBaseUrl, path),
    fileSize: input.buffer.byteLength,
    mimeType: input.mimeType,
  }
}

export async function uploadImageToS3(input: UploadImageInput): Promise<StoredImage | null> {
  const config = getS3Config()

  if (!config) return null

  const parsed = input.dataUrl
    ? parseDataUrl(input.dataUrl)
    : {
        buffer: input.buffer,
        mimeType: input.mimeType || 'image/png',
      }

  if (!parsed.buffer) {
    throw new Error('Arquivo de imagem obrigatorio')
  }

  const sourceBuffer = parsed.buffer
  const mimeType = parsed.mimeType
  const extension = extensionForMimeType(mimeType)
  const id = randomUUID()
  const basePath = `users/${input.userId}/${input.folder}/${id}`
  const originalPath = `${basePath}/original.${extension}`
  const thumbnailPath = `${basePath}/thumb.webp`
  const thumbnailBuffer = await sharp(sourceBuffer)
    .rotate()
    .resize({ width: 360, height: 360, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 55 })
    .toBuffer()

  const client = createS3Client(config)

  await Promise.all([
    client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: originalPath,
        Body: sourceBuffer,
        ContentType: mimeType,
      }),
    ),
    client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: thumbnailPath,
        Body: thumbnailBuffer,
        ContentType: 'image/webp',
      }),
    ),
  ])

  return {
    imageUrl: publicUrl(config.publicBaseUrl, originalPath),
    thumbnailUrl: publicUrl(config.publicBaseUrl, thumbnailPath),
    storageProvider: 's3',
    storagePath: originalPath,
    thumbnailPath,
    fileSize: sourceBuffer.byteLength,
    mimeType,
  }
}
