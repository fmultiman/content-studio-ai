// Server-only boundary. A durable immutable submission and an exclusive claim
// must exist before either Image provider can be called.
import { createServiceRoleSupabase } from '@/lib/supabase/service-role'
import { createPresignedReadUrl, uploadImageToS3 } from '@/lib/storage/s3'
import { fetchRemoteImage, NANOBANANA_RESULT_IMAGE_POLICY } from '@/lib/security/safe-remote-image'
import { generateImageAttemptFingerprint } from './idempotency'
import { ATTEMPT_COLUMNS, type ImageGenerationAttemptRow } from './attempt'
import { isUuid, parseWorkingState, ImageReferenceSchema, type ImageReference, type ImageGenerationSessionRow } from './session'
import { resolveGeminiImageModel } from '@/lib/providers/gemini/image-models'
import { resolveOpenAIImageEditModel } from '@/lib/providers/openai/image-models'

export class ImageSubmissionError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly outcomeUnknown = false) { super(message) }
}

export async function freezeAndClaimImageAttempt(input: {
  userId: string; sessionId: unknown; clientRequestId: unknown; prompt: string;
  provider: string; model: string; config: Record<string, unknown>;
  sourceReferences?: ImageReference[];
}) {
  if (!isUuid(input.sessionId) || !isUuid(input.clientRequestId)) {
    throw new ImageSubmissionError(400, 'SESSION_REQUEST_ID_REQUIRED', 'Session e clientRequestId são obrigatórios.')
  }
  const db = createServiceRoleSupabase()
  const { data: session, error: sessionError } = await db.from('image_generation_sessions').select('*')
    .eq('id', input.sessionId).eq('user_id', input.userId).maybeSingle()
  if (sessionError) throw new ImageSubmissionError(503, 'STORE_UNAVAILABLE', 'Não foi possível validar a geração.', true)
  if (!session) throw new ImageSubmissionError(404, 'SESSION_NOT_FOUND', 'Geração não encontrada.')
  // Scope must still exist and belong to the owner at submission time.
  if (session.project_id) {
    const project = await db.from('projects').select('id').eq('id', session.project_id).eq('user_id', input.userId).maybeSingle()
    if (project.error) throw new ImageSubmissionError(503, 'STORE_UNAVAILABLE', 'Não foi possível validar o projeto.', true)
    if (!project.data) throw new ImageSubmissionError(403, 'PROJECT_NOT_FOUND', 'Project indisponível.')
  }
  if (session.production_id) {
    const production = await db.from('productions').select('id').eq('id', session.production_id)
      .eq('project_id', session.project_id).eq('user_id', input.userId).maybeSingle()
    if (production.error) throw new ImageSubmissionError(503, 'STORE_UNAVAILABLE', 'Não foi possível validar a produção.', true)
    if (!production.data) throw new ImageSubmissionError(403, 'PRODUCTION_NOT_FOUND', 'Production indisponível.')
  }
  const state = parseWorkingState(session.working_state)
  if (!state.success) throw new ImageSubmissionError(409, 'INVALID_WORKING_STATE', 'Estado da geração inválido.')
  const references = input.sourceReferences ?? state.data.sourceReferences
  if (!references.every((reference) => ImageReferenceSchema.safeParse(reference).success)) throw new ImageSubmissionError(400, 'INVALID_SOURCE_REFERENCE', 'Referência inválida.')
  const referenceModel = input.provider === 'gemini' ? resolveGeminiImageModel(input.model)
    : input.provider === 'openai' ? resolveOpenAIImageEditModel(input.model) : null
  // Never silently drop a reference for adapters without image inputs.
  if (references.length && !referenceModel) throw new ImageSubmissionError(400, 'SOURCE_NOT_SUPPORTED', 'Este modelo ainda não envia referências de imagem.')
  if (referenceModel && references.length > referenceModel.referenceCapabilities.maxReferences) throw new ImageSubmissionError(400, 'SOURCE_REFERENCE_LIMIT', 'Use uma referência por geração.')
  if (references.length && !session.project_id) throw new ImageSubmissionError(400, 'SOURCE_PROJECT_REQUIRED', 'Selecione um projeto para usar uma referência.')
  const sourceSnapshot = { references, metadata: { userInput: session.working_prompt } }
  const fingerprint = generateImageAttemptFingerprint({
    sessionId: input.sessionId, submittedPrompt: input.prompt, provider: input.provider,
    model: input.model, submittedConfig: input.config, sourceSnapshot,
  })
  const find = () => db.from('image_generation_attempts').select(ATTEMPT_COLUMNS)
    .eq('user_id', input.userId).eq('client_request_id', input.clientRequestId).maybeSingle()
  let existing = await find()
  if (existing.error) throw new ImageSubmissionError(503, 'STORE_UNAVAILABLE', 'Não foi possível verificar o pedido.', true)
  if (!existing.data) {
    // An explicit request must agree with the persisted state before a new execution.
    // Replays below use their immutable snapshot even after the Session changes.
    if (input.sourceReferences && JSON.stringify(references) !== JSON.stringify(state.data.sourceReferences)) throw new ImageSubmissionError(409, 'SOURCE_STATE_CONFLICT', 'A referência mudou. Salve a geração antes de enviar.')
    for (let n = 0; n < 3; n++) {
      const latest = await db.from('image_generation_attempts').select('sequence').eq('session_id', input.sessionId)
        .order('sequence', { ascending: false }).limit(1).maybeSingle()
      if (latest.error) throw new ImageSubmissionError(503, 'STORE_UNAVAILABLE', 'Não foi possível criar a tentativa.', true)
      const inserted = await db.from('image_generation_attempts').insert({
        session_id: input.sessionId, user_id: input.userId, project_id: session.project_id,
        production_id: session.production_id, sequence: (latest.data?.sequence ?? 0) + 1,
        submitted_prompt: input.prompt, provider: input.provider, model: input.model,
        submitted_config: input.config, source_snapshot: sourceSnapshot,
        client_request_id: input.clientRequestId, request_fingerprint: fingerprint,
        status: 'queued', submitted_at: new Date().toISOString(),
      }).select(ATTEMPT_COLUMNS).single()
      if (!inserted.error) { existing = inserted; break }
      if (inserted.error.code !== '23505') throw new ImageSubmissionError(503, 'STORE_UNAVAILABLE', 'Não foi possível congelar a tentativa.', true)
      existing = await find()
      if (existing.error) throw new ImageSubmissionError(503, 'STORE_UNAVAILABLE', 'Não foi possível verificar a tentativa.', true)
      if (existing.data) break
    }
  }
  if (!existing.data) throw new ImageSubmissionError(409, 'ATTEMPT_CREATE_RACE', 'Outra tentativa foi criada. Tente novamente.', true)
  const attempt = existing.data as unknown as ImageGenerationAttemptRow
  // A replay is compared against the stored snapshot, including the original
  // description; subsequent Session edits do not invalidate a network retry.
  const replayFingerprint = generateImageAttemptFingerprint({
    sessionId: input.sessionId, submittedPrompt: input.prompt, provider: input.provider,
    model: input.model, submittedConfig: input.config, sourceSnapshot: { ...attempt.source_snapshot, references },
  })
  if (attempt.request_fingerprint !== replayFingerprint) throw new ImageSubmissionError(409, 'IDEMPOTENCY_CONFLICT', 'Este pedido já foi usado com outros parâmetros.')
  const claim = await db.from('image_generation_attempts').update({ status: 'submitted' })
    .eq('id', attempt.id).eq('user_id', input.userId).eq('status', 'queued').select(ATTEMPT_COLUMNS).maybeSingle()
  // A store outage cannot prove that this identity has never reached a provider.
  if (claim.error) throw new ImageSubmissionError(503, 'STORE_UNAVAILABLE', 'Não foi possível iniciar a tentativa.', true)
  return { attempt: (claim.data ?? attempt) as ImageGenerationAttemptRow, claimed: !!claim.data, session: session as ImageGenerationSessionRow }
}

export async function failImageAttempt(attempt: ImageGenerationAttemptRow, message: string, outcomeUnknown = false) {
  const result = await createServiceRoleSupabase().from('image_generation_attempts').update({
    status: 'failed', failure_details: { message, outcome_unknown: outcomeUnknown }, completed_at: new Date().toISOString(),
  }).eq('id', attempt.id).eq('user_id', attempt.user_id).in('status', ['submitted', 'processing'])
  if (result.error) throw new ImageSubmissionError(503, 'LIFECYCLE_SAVE_FAILED', 'Não foi possível registrar o resultado.')
}

export async function recordImageReferenceProvenance(attempt: ImageGenerationAttemptRow, inputReferences: unknown[]) {
  const result = await createServiceRoleSupabase().from('image_generation_attempts').update({
    result_metadata: { operation: 'image_to_image', inputReferences },
  }).eq('id', attempt.id).eq('user_id', attempt.user_id).eq('status', 'submitted')
  if (result.error) throw new ImageSubmissionError(503, 'PROVENANCE_SAVE_FAILED', 'Não foi possível registrar a referência.')
}

export async function markImageAttemptProcessing(attempt: ImageGenerationAttemptRow, providerTaskId: string) {
  const result = await createServiceRoleSupabase().from('image_generation_attempts').update({
    status: 'processing', provider_task_id: providerTaskId,
  }).eq('id', attempt.id).eq('user_id', attempt.user_id).in('status', ['submitted', 'processing'])
  if (result.error) throw new ImageSubmissionError(503, 'LIFECYCLE_SAVE_FAILED', 'Não foi possível registrar a execução.')
}

export async function linkImageOutput(attempt: ImageGenerationAttemptRow, result: {
  imageUrl: string; publicUrl?: string | null; thumbnailUrl?: string | null;
  storageProvider?: string | null; storagePath?: string | null; thumbnailPath?: string | null;
  fileSize?: number | null; mimeType?: string | null;
}) {
  const db = createServiceRoleSupabase()
  // One output identity per attempt, including retries of result ingestion.
  const stored = await db.from('images').upsert({
    id: attempt.id, user_id: attempt.user_id, project_id: attempt.project_id,
    user_input: attempt.source_snapshot?.metadata && typeof attempt.source_snapshot.metadata === 'object'
      ? (attempt.source_snapshot.metadata as Record<string, unknown>).userInput ?? '' : '',
    generated_prompt: attempt.submitted_prompt, model: attempt.model, status: 'draft',
    image_url: result.publicUrl || result.imageUrl, thumbnail_url: result.thumbnailUrl ?? null,
    storage_provider: result.storageProvider ?? null, storage_path: result.storagePath ?? null,
    thumbnail_path: result.thumbnailPath ?? null, file_size: result.fileSize ?? null, mime_type: result.mimeType ?? null,
  }, { onConflict: 'id', ignoreDuplicates: true }).select('*').maybeSingle()
  if (stored.error) throw new ImageSubmissionError(503, 'OUTPUT_SAVE_FAILED', 'Não foi possível salvar a imagem.')
  const image = stored.data ?? (await db.from('images').select('*').eq('id', attempt.id).eq('user_id', attempt.user_id).single()).data
  if (!image) throw new ImageSubmissionError(503, 'OUTPUT_SAVE_FAILED', 'Imagem indisponível.')
  const linked = await db.from('image_generation_attempts').update({
    status: 'succeeded', result_image_id: image.id, completed_at: new Date().toISOString(),
  }).eq('id', attempt.id).eq('user_id', attempt.user_id).in('status', ['submitted', 'processing'])
  if (linked.error) throw new ImageSubmissionError(503, 'OUTPUT_LINK_FAILED', 'Não foi possível vincular a imagem.')
  // Output is a mutable convenience pointer on the Session. CAS keeps a
  // concurrent edit from being silently overwritten by provider completion.
  if (attempt.session_id) {
    const session = await db.from('image_generation_sessions').select('revision,working_state')
      .eq('id', attempt.session_id).eq('user_id', attempt.user_id).maybeSingle()
    if (session.data) {
      const currentState = parseWorkingState(session.data.working_state)
      if (currentState.success) {
        await db.from('image_generation_sessions').update({
          current_image_id: image.id,
          working_state: { ...currentState.data, currentImageId: image.id, imageStatus: 'draft' },
          revision: session.data.revision + 1,
        }).eq('id', attempt.session_id).eq('user_id', attempt.user_id).eq('revision', session.data.revision)
      }
    }
  }
  return image
}

export async function imageAttemptReplay(attempt: ImageGenerationAttemptRow) {
  const db = createServiceRoleSupabase()
  const fresh = await db.from('image_generation_attempts').select(ATTEMPT_COLUMNS).eq('id', attempt.id).eq('user_id', attempt.user_id).single()
  const row = (fresh.data ?? attempt) as ImageGenerationAttemptRow
  if (row.result_image_id) {
    const image = await db.from('images').select('*').eq('id', row.result_image_id).eq('user_id', row.user_id).single()
    return { attemptId: row.id, status: row.status, image: image.data,
      imageUrl: image.data?.storage_path ? await createPresignedReadUrl(image.data.storage_path) : image.data?.image_url,
      outcome_unknown: row.status === 'failed' ? row.failure_details?.outcome_unknown !== false : false, replayed: true }
  }
  return { attemptId: row.id, status: row.status, taskId: row.provider_task_id, error: row.failure_details?.message,
    // Older failed rows without a proven outcome stay conservative during recovery.
    outcome_unknown: row.status === 'failed' ? row.failure_details?.outcome_unknown !== false : false, replayed: true }
}

export async function syncNanoImageAttempt(attempt: ImageGenerationAttemptRow) {
  if (!attempt.provider_task_id || !['submitted', 'processing'].includes(attempt.status)) return imageAttemptReplay(attempt)
  const db = createServiceRoleSupabase()
  const task = await db.from('generation_tasks').select('*').eq('id', attempt.provider_task_id).eq('user_id', attempt.user_id).maybeSingle()
  if (task.error || !task.data) throw new ImageSubmissionError(503, 'TASK_UNAVAILABLE', 'Execução indisponível.')
  if (task.data.status === 'failed') {
    await failImageAttempt(attempt, task.data.error_message || 'Falha na geração.')
  } else if (task.data.status === 'completed' && task.data.image_url) {
    // Reuse the existing SSRF-protected ingestion policy. No paid submit here.
    const remote = await fetchRemoteImage(task.data.image_url, NANOBANANA_RESULT_IMAGE_POLICY)
    const storage = await uploadImageToS3({ userId: attempt.user_id, folder: 'images', buffer: remote.buffer, mimeType: remote.mimeType })
    if (!storage) throw new ImageSubmissionError(503, 'STORAGE_UNAVAILABLE', 'Armazenamento indisponível.')
    await linkImageOutput(attempt, { ...storage, publicUrl: storage.imageUrl })
  }
  return imageAttemptReplay(attempt)
}
