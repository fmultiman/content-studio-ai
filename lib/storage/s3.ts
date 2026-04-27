import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
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

function safePathSegment(value: string | null | undefined, fallback: string) {
  const safe = value
    ?.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-_.]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96)

  return safe || fallback
}

function publicUrl(publicBaseUrl: string, path: string) {
  return `${publicBaseUrl.replace(/\/$/, '')}/${path.split('/').map(encodeURIComponent).join('/')}`
}

export async function createPresignedImageUpload(input: PresignedUploadInput) {
  const config = getS3Config()

  if (!config) return null

  const extension = input.filename?.includes('.')
    ? input.filename.split('.').pop() || extensionForMimeType(input.mimeType)
    : extensionForMimeType(input.mimeType)
  const id = randomUUID()
  const safeName = safePathSegment(input.filename?.replace(/\.[^/.]+$/, ''), 'file')
  const cleanPrefix = input.prefix?.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  const prefix = cleanPrefix
    ? `${cleanPrefix.split('/').filter(Boolean).map((segment) => safePathSegment(segment, 'folder')).join('/')}/`
    : ''
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

export async function createPresignedReadUrl(path: string) {
  const config = getS3Config()

  if (!config) return null

  const client = createS3Client(config)
  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: config.bucket,
      Key: path,
    }),
    { expiresIn: 3600 },
  )
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
