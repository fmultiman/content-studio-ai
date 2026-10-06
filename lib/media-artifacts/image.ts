import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isTrustedImageStoragePath } from '@/lib/storage/image-path'
import { readS3Object } from '@/lib/storage/s3'
import type { MediaArtifactRow } from './contracts'

const MEDIA_ARTIFACT_COLUMNS = [
  'id', 'user_id', 'project_id', 'production_id', 'media_type', 'identity_mode',
  'storage_provider', 'storage_path', 'content_hash', 'version', 'mime_type',
  'byte_size', 'width', 'height', 'duration_ms', 'created_at', 'updated_at',
].join(',')

type ImageArtifactInput = {
  userId: string
  projectId: string | null
  productionId: string | null
  attemptId: string
  outputId: string
  storageProvider: string | null
  storagePath: string
  mimeType: string | null
  fileSize: number | null
  metadata: Record<string, unknown> | null
}

type ArtifactLookup = {
  data: MediaArtifactRow | null
  error: unknown
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

function metadataInteger(metadata: Record<string, unknown> | null, ...keys: string[]) {
  for (const key of keys) {
    const value = positiveInteger(metadata?.[key])
    if (value !== null) return value
  }
  return null
}

export function sha256Bytes(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex')
}

export function artifactIdentityFingerprint(input: {
  userId: string
  storageProvider: string
  storagePath: string
  contentHash: string | null
  mimeType: string
  fileSize: number | null
  width: number | null
  height: number | null
  durationMs: number | null
  version: number
}) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex')
}

async function readStoredImageHash(userId: string, storagePath: string) {
  if (!isTrustedImageStoragePath(userId, storagePath, 'original')) {
    throw new Error('MEDIA_ARTIFACT_UNTRUSTED_STORAGE_PATH')
  }
  const stored = await readS3Object(storagePath, { maxBytes: 100 * 1024 * 1024 })
  if (!stored) throw new Error('MEDIA_ARTIFACT_STORAGE_UNAVAILABLE')
  return { hash: sha256Bytes(stored.bytes), contentType: stored.contentType, byteSize: stored.bytes.byteLength }
}

async function findImageArtifactByProvenance(db: SupabaseClient, input: ImageArtifactInput): Promise<ArtifactLookup> {
  const result = await db.from('media_artifact_provenance')
    .select(`artifact_id,media_artifacts(${MEDIA_ARTIFACT_COLUMNS})`)
    .eq('user_id', input.userId)
    .eq('image_generation_attempt_id', input.attemptId)
    .eq('image_output_id', input.outputId)
    .maybeSingle()
  const row = result.data as { artifact_id?: string; media_artifacts?: MediaArtifactRow | MediaArtifactRow[] | null } | null
  const artifact = Array.isArray(row?.media_artifacts) ? row.media_artifacts[0] : row?.media_artifacts
  return { data: (artifact ?? null) as unknown as MediaArtifactRow | null, error: result.error }
}

export async function resolveImageArtifact(db: SupabaseClient, input: ImageArtifactInput) {
  const existing = await findImageArtifactByProvenance(db, input)
  if (existing.error) throw existing.error
  if (existing.data) return existing.data

  const stored = await readStoredImageHash(input.userId, input.storagePath)
  const storageProvider = input.storageProvider || 's3'
  const mimeType = input.mimeType || stored.contentType || 'application/octet-stream'
  const fileSize = input.fileSize ?? stored.byteSize
  const metadata = input.metadata ?? {}
  const width = metadataInteger(metadata, 'width', 'imageWidth')
  const height = metadataInteger(metadata, 'height', 'imageHeight')
  const durationMs = metadataInteger(metadata, 'durationMs', 'duration_ms')
  const identityFingerprint = artifactIdentityFingerprint({
    userId: input.userId,
    storageProvider,
    storagePath: input.storagePath,
    contentHash: stored.hash,
    mimeType,
    fileSize,
    width,
    height,
    durationMs,
    version: 1,
  })

  const found = await db.from('media_artifacts')
    .select(MEDIA_ARTIFACT_COLUMNS)
    .eq('user_id', input.userId)
    .eq('media_type', 'image')
    .eq('storage_provider', storageProvider)
    .eq('storage_path', input.storagePath)
    .eq('content_hash', stored.hash)
    .maybeSingle()
  if (found.error) throw found.error
  if (found.data) {
    await attachImageProvenance(db, input, (found.data as unknown as MediaArtifactRow).id)
    return found.data as unknown as MediaArtifactRow
  }

  const inserted = await db.from('media_artifacts').insert({
    user_id: input.userId,
    project_id: input.projectId,
    production_id: input.productionId,
    media_type: 'image',
    identity_mode: 'sha256',
    storage_provider: storageProvider,
    storage_path: input.storagePath,
    content_hash: stored.hash,
    version: 1,
    mime_type: mimeType,
    byte_size: fileSize,
    width,
    height,
    duration_ms: durationMs,
    identity_fingerprint: identityFingerprint,
  }).select(MEDIA_ARTIFACT_COLUMNS).single()
  if (inserted.error || !inserted.data) {
    if ((inserted.error as { code?: string } | null)?.code === '23505') {
      const raced = await db.from('media_artifacts').select(MEDIA_ARTIFACT_COLUMNS)
        .eq('user_id', input.userId).eq('media_type', 'image')
        .eq('storage_provider', storageProvider).eq('storage_path', input.storagePath)
        .eq('content_hash', stored.hash).maybeSingle()
      if (raced.data) {
        await attachImageProvenance(db, input, (raced.data as unknown as MediaArtifactRow).id)
        return raced.data as unknown as MediaArtifactRow
      }
    }
    throw inserted.error ?? new Error('MEDIA_ARTIFACT_CREATE_FAILED')
  }
  const artifact = inserted.data as unknown as MediaArtifactRow
  await attachImageProvenance(db, input, artifact.id)
  return artifact
}

export async function attachImageProvenance(db: SupabaseClient, input: ImageArtifactInput, artifactId: string) {
  const result = await db.from('media_artifact_provenance').upsert({
    artifact_id: artifactId,
    user_id: input.userId,
    project_id: input.projectId,
    production_id: input.productionId,
    provenance_kind: 'image_generation',
    image_generation_attempt_id: input.attemptId,
    image_output_id: input.outputId,
  }, { onConflict: 'artifact_id,image_generation_attempt_id,image_output_id' })
  if (result.error) throw result.error
}
