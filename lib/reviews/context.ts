import { createHash } from 'node:crypto'
import { normalizeProjectIdentity } from '@/lib/project-identity-normalizer'
import { isTrustedImageStoragePath } from '@/lib/storage/image-path'
import { presignImageObject } from '@/lib/storage/image-storage'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ImageReviewContext, ImageReviewSubject } from './contracts'
import { ReviewServiceError } from './errors'

export const IMAGE_REVIEW_SUBJECT_COLUMNS = [
  'id', 'user_id', 'project_id', 'production_id', 'sequence', 'submitted_prompt',
  'provider', 'model', 'submitted_config', 'source_snapshot', 'status', 'result_image_id',
].join(',')

type AttemptRow = {
  id: string
  user_id: string
  project_id: string | null
  production_id: string | null
  submitted_prompt: string | null
  provider: string | null
  model: string | null
  submitted_config: Record<string, unknown> | null
  source_snapshot: Record<string, unknown> | null
  status: string
  result_image_id: string | null
}

type OutputRow = {
  id: string
  user_id: string
  project_id: string | null
  image_url: string | null
  storage_path: string | null
  thumbnail_path: string | null
  file_size: number | null
  mime_type: string | null
  updated_at: string
  metadata: Record<string, unknown> | null
}

type ProjectRow = {
  id: string
  user_id: string
  context: string | null
  evaluation_mode: string | null
  identity: unknown
}

type ProductionRow = { id: string; user_id: string; project_id: string; title: string; intention: string; type: string }

const sha256 = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

export async function resolveImageReviewContext(db: SupabaseClient, userId: string, attemptId: string) {
  const attemptResult = await db.from('image_generation_attempts')
    .select(IMAGE_REVIEW_SUBJECT_COLUMNS)
    .eq('id', attemptId)
    .eq('user_id', userId)
    .maybeSingle()
  if (attemptResult.error) throw new ReviewServiceError(503, 'REVIEW_STORE_UNAVAILABLE', 'Review subject could not be loaded.')
  const attempt = attemptResult.data as AttemptRow | null
  if (!attempt || attempt.status !== 'succeeded' || !attempt.result_image_id) {
    throw new ReviewServiceError(404, 'REVIEW_SUBJECT_NOT_FOUND', 'A completed Image Attempt with an output is required.')
  }

  const outputResult = await db.from('images')
    .select('id,user_id,project_id,image_url,storage_path,thumbnail_path,file_size,mime_type,updated_at,metadata')
    .eq('id', attempt.result_image_id)
    .eq('user_id', userId)
    .maybeSingle()
  if (outputResult.error) throw new ReviewServiceError(503, 'REVIEW_STORE_UNAVAILABLE', 'Review output could not be loaded.')
  const output = outputResult.data as OutputRow | null
  if (!output || (attempt.project_id && output.project_id !== attempt.project_id)) {
    throw new ReviewServiceError(403, 'REVIEW_OUTPUT_UNAVAILABLE', 'The Attempt output is not available in this scope.')
  }

  let outputUrl: string | null = null
  if (output.storage_path) {
    if (!isTrustedImageStoragePath(userId, output.storage_path, 'original')) {
      throw new ReviewServiceError(422, 'REVIEW_OUTPUT_UNAVAILABLE', 'The stored output path is not trusted.')
    }
    outputUrl = await presignImageObject(userId, output.storage_path, 'original')
  }
  outputUrl ||= output.image_url
  if (!outputUrl) throw new ReviewServiceError(422, 'REVIEW_OUTPUT_UNAVAILABLE', 'The Image output has no usable media URL.')

  let project: ProjectRow | null = null
  if (attempt.project_id) {
    const result = await db.from('projects').select('id,user_id,context,evaluation_mode,identity')
      .eq('id', attempt.project_id).eq('user_id', userId).maybeSingle()
    if (result.error) throw new ReviewServiceError(503, 'REVIEW_STORE_UNAVAILABLE', 'Project context could not be loaded.')
    project = result.data as ProjectRow | null
    if (!project) throw new ReviewServiceError(403, 'REVIEW_PROJECT_SCOPE_MISMATCH', 'The Project is not accessible.')
  }

  let production: ProductionRow | null = null
  if (attempt.production_id) {
    const result = await db.from('productions').select('id,user_id,project_id,title,intention,type')
      .eq('id', attempt.production_id).eq('user_id', userId).maybeSingle()
    if (result.error) throw new ReviewServiceError(503, 'REVIEW_STORE_UNAVAILABLE', 'Production context could not be loaded.')
    production = result.data as ProductionRow | null
    if (!production || production.project_id !== attempt.project_id) {
      throw new ReviewServiceError(403, 'REVIEW_PRODUCTION_SCOPE_MISMATCH', 'The Production is not valid for this Project.')
    }
  }

  let identity: Record<string, unknown> | null = null
  if (project?.identity !== null && project?.identity !== undefined) {
    try {
      identity = normalizeProjectIdentity(project.identity) as Record<string, unknown> | null
    } catch {
      throw new ReviewServiceError(422, 'REVIEW_IDENTITY_INVALID', 'Project Identity is invalid for Review.')
    }
  }

  const context: ImageReviewContext = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    project: {
      id: project?.id ?? null,
      context: project?.context ?? null,
      evaluationMode: project?.evaluation_mode ?? null,
      identity,
    },
    production: production ? { id: production.id, title: production.title, intention: production.intention, type: production.type } : null,
  }
  const subject: ImageReviewSubject = {
    attemptId: attempt.id,
    outputId: output.id,
    projectId: attempt.project_id,
    productionId: attempt.production_id,
    submittedPrompt: attempt.submitted_prompt ?? '',
    provider: attempt.provider,
    model: attempt.model,
    submittedConfig: attempt.submitted_config ?? {},
    sourceSnapshot: attempt.source_snapshot,
    outputUrl,
    outputStoragePath: output.storage_path,
    outputMetadata: {
      fileSize: output.file_size,
      mimeType: output.mime_type,
      updatedAt: output.updated_at,
      metadata: output.metadata ?? {},
    },
  }
  return { attempt, output, project, production, context, subject, contextFingerprint: sha256(context) }
}

export function buildRequestFingerprint(attemptId: string, outputId: string, contextFingerprint: string) {
  return sha256({ attemptId, outputId, adapter: 'image', adapterVersion: 'image-review-v1', contextFingerprint })
}
