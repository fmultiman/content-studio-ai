import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

export const getS3Client = () =>
  new S3Client({
    region: process.env.S3_REGION || 'auto',
    endpoint: process.env.S3_ENDPOINT,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
    },
    forcePathStyle: true,
  })

export async function uploadApplicationVideo(
  buffer: Buffer,
  storagePath: string,
  contentType: string,
  size: number
) {
  const Bucket = process.env.S3_BUCKET
  if (!Bucket) throw new Error('S3_BUCKET is not defined')

  const client = getS3Client()
  await client.send(
    new PutObjectCommand({
      Bucket,
      Key: storagePath,
      Body: buffer,
      ContentType: contentType,
    })
  )

  const publicUrl = `${process.env.PUBLIC_STORAGE_BASE_URL}/${Bucket}/${storagePath}`

  return { storagePath, publicUrl, mime: contentType, size }
}

export async function downloadAndStoreVideo(url: string, prefix: string): Promise<{ storagePath: string, publicUrl: string, mime: string, size: number }> {
  const res = await fetch(url)
  
  if (!res.ok) {
    throw new Error(`Failed to fetch remote video. Status: ${res.status}`)
  }

  const mime = res.headers.get('content-type') || 'video/mp4'
  const size = parseInt(res.headers.get('content-length') || '0', 10)
  const buffer = Buffer.from(await res.arrayBuffer())

  const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.mp4`
  const objectPath = `${prefix}/${fileName}`

  return await uploadApplicationVideo(buffer, objectPath, mime, size)
}
