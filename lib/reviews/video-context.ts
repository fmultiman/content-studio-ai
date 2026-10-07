// GEMINI_VIDEO_REVIEW_ADAPTER_V1
//
// Server-resolved Video Review context. Everything here comes from owner-filtered rows;
// nothing is taken from the request except the typed source id (already authorized by the
// artifact registration step). The Review scope is the ARTIFACT's own scope (migration 060:
// a Review's Project/Production equal the artifact's, NULL-safe), so a Library video without a
// Project or Production is reviewable with an empty context.

import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeProjectIdentity } from '@/lib/project-identity-normalizer'
import type { MediaArtifactRow } from '@/lib/media-artifacts/contracts'
import type { VideoReviewContext, VideoReviewSource, VideoReviewSubject } from './contracts'
import { ReviewServiceError } from './errors'

const sha256 = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

type ProjectRow = { id: string; user_id: string; context: string | null; evaluation_mode: string | null; identity: unknown }
type ProductionRow = { id: string; user_id: string; project_id: string; title: string; intention: string; type: string }

async function resolveSourceContext(db: SupabaseClient, userId: string, source: VideoReviewSource): Promise<Record<string, unknown>> {
  if (source.kind === 'video_generation') {
    const result = await db.from('video_generations').select('prompt,mode,provider,model').eq('id', source.id).eq('user_id', userId).maybeSingle()
    if (result.error) throw new ReviewServiceError(503, 'REVIEW_STORE_UNAVAILABLE', 'Review source context could not be loaded.')
    const row = result.data as { prompt: string | null; mode: string | null; provider: string | null; model: string | null } | null
    if (!row) throw new ReviewServiceError(404, 'REVIEW_SUBJECT_NOT_FOUND', 'Review source was not found.')
    return { submittedPrompt: row.prompt ?? null, mode: row.mode, provider: row.provider, model: row.model }
  }
  if (source.kind === 'library_file') {
    const result = await db.from('library_files').select('origin').eq('id', source.id).eq('user_id', userId).maybeSingle()
    if (result.error) throw new ReviewServiceError(503, 'REVIEW_STORE_UNAVAILABLE', 'Review source context could not be loaded.')
    const row = result.data as { origin: string | null } | null
    if (!row) throw new ReviewServiceError(404, 'REVIEW_SUBJECT_NOT_FOUND', 'Review source was not found.')
    return { origin: row.origin }
  }
  // A completed render has no generation prompt: it is authored composition, not a prompt-driven output.
  return {}
}

export async function resolveVideoReviewContext(
  db: SupabaseClient,
  params: { userId: string; source: VideoReviewSource; artifact: MediaArtifactRow },
) {
  const { userId, source, artifact } = params

  let project: ProjectRow | null = null
  if (artifact.project_id) {
    const result = await db.from('projects').select('id,user_id,context,evaluation_mode,identity')
      .eq('id', artifact.project_id).eq('user_id', userId).maybeSingle()
    if (result.error) throw new ReviewServiceError(503, 'REVIEW_STORE_UNAVAILABLE', 'Project context could not be loaded.')
    project = result.data as ProjectRow | null
    if (!project) throw new ReviewServiceError(403, 'REVIEW_PROJECT_SCOPE_MISMATCH', 'The Project is not accessible.')
  }

  let production: ProductionRow | null = null
  if (artifact.production_id) {
    const result = await db.from('productions').select('id,user_id,project_id,title,intention,type')
      .eq('id', artifact.production_id).eq('user_id', userId).maybeSingle()
    if (result.error) throw new ReviewServiceError(503, 'REVIEW_STORE_UNAVAILABLE', 'Production context could not be loaded.')
    production = result.data as ProductionRow | null
    if (!production || production.project_id !== artifact.project_id) {
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

  const context: VideoReviewContext = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    project: { id: project?.id ?? null, context: project?.context ?? null, evaluationMode: project?.evaluation_mode ?? null, identity },
    production: production ? { id: production.id, title: production.title, intention: production.intention, type: production.type } : null,
  }
  const sourceContext = await resolveSourceContext(db, userId, source)
  const subject: VideoReviewSubject = {
    artifactId: artifact.id,
    source,
    projectId: artifact.project_id,
    productionId: artifact.production_id,
    media: {
      mimeType: artifact.mime_type,
      byteSize: artifact.byte_size,
      durationMs: artifact.duration_ms,
      width: artifact.width,
      height: artifact.height,
      contentHash: artifact.content_hash,
    },
    sourceContext,
  }
  // The fingerprint must be stable across replays of the same request, so the capture time is excluded.
  const { capturedAt: _capturedAt, ...stableContext } = context
  void _capturedAt
  return { project, production, context, subject, contextFingerprint: sha256({ context: stableContext, sourceContext }) }
}

/** Identity of one Video Review request: the source, the canonical artifact and the server context. */
export function buildVideoRequestFingerprint(source: VideoReviewSource, artifactId: string, contextFingerprint: string) {
  return sha256({ source, artifactId, adapter: 'video', adapterVersion: 'video-review-v1', contextFingerprint })
}
