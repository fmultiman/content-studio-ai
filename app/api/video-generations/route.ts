import { NextRequest, NextResponse } from 'next/server'
import { providerExecutionBlockedResponse } from '@/lib/providers/execution-policy-http'
import { createClient } from '@/lib/supabase/server'
import { createPresignedReadUrl } from '@/lib/storage/s3'
import { resolveProviderExecution } from '@/lib/credentials/provider-execution'
import { providerCredentialUnavailableResponse } from '@/lib/credentials/provider-credential-http'
import { createServiceRoleSupabase } from '@/lib/supabase/service-role'
import { forceRefreshAccessToken, getValidAccessToken } from '@/lib/provider-connections/token-store'
import { ProviderAuthorizationRequiredError, ProviderConnectionError } from '@/lib/provider-connections/types'
import { REST_CONNECTION_REF, parseConnectionRef, resolveGenerationConnection } from '@/lib/video-generation/connections'
import { frameConfig, type FrameIdentity } from '@/lib/video-generation/frames'
import { isProviderExecutionDisabledError } from '@/lib/providers/execution-policy'
import { VEO_MAX_FRAME_BYTES, isVeoError, type VeoError } from '@/lib/providers/gemini/veo-client'
import { classifyExistingSubmission, generateRequestFingerprint, isClientRequestId, toClientGeneration } from '@/lib/video-generation/idempotency'
import { isUuid } from '@/lib/video-generation/session'
import { initialNextPollAt } from '@/lib/video-generation/polling'
import { isTenantVideoStoragePath } from '@/lib/video-generation/storage-path'
import { I2V_MEDIA_FAILURE_MESSAGE, loadTrustedI2vSourceImage, resolveI2vSource } from '@/lib/video-generation/i2v-source-media'
import type { KlingMcpUploadImage } from '@/lib/provider-connections/kling-mcp-upload'
import { restVideoOperations } from '@/lib/video-generation/rest-capabilities'
import { veoVideoOperations } from '@/lib/video-generation/veo-capabilities'
import { validateControlVocabulary, validateVideoRequest } from '@/lib/video-generation/request'
import {
  GeminiVeoTransport,
  KlingMcpSubmitError,
  KlingMcpTransport,
  KlingRestTransport,
  type KlingVideoTransport,
} from '@/lib/video-generation/transport'

export const maxDuration = 60

// VIDEO_GENERATION_CONNECTION_CAPABILITY_ROUTING_V1
//
// Fields a client must never supply: the SERVER decides the transport, the
// credential source / execution mode and the connection's identity.
const FORBIDDEN_CLIENT_FIELDS = [
  'transport',
  'executionMode',
  'execution_mode',
  'credentialSource',
  'credential_source',
  'connection_id',
  'connectionId',
  'provider',
] as const

function jsonError(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: message, code, ...extra }, { status })
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // FUTURE-050: before the queued generation row, the credential, the MCP token or any source upload exists.
    const blocked = providerExecutionBlockedResponse({ provider: 'kling', operation: 'video_generation' })
    if (blocked) return blocked

    let body: Record<string, any>
    try {
      body = await req.json()
    } catch {
      return jsonError(400, 'INVALID_JSON', 'Invalid JSON body.')
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return jsonError(400, 'INVALID_BODY', 'Invalid request body.')
    }

    const { projectId, productionId, mode, prompt, sourceImageId, sourceLibraryFileId } = body
    // VEO_KLING_FIRST_LAST_FRAME_V1: the optional LAST frame. Same identity rule as the first frame (exactly one of an
    // image id / a Library file id), and it is only meaningful together with a first frame in image_to_video.
    const { lastFrameImageId, lastFrameLibraryFileId } = body
    const hasLastFrame = Boolean(lastFrameImageId || lastFrameLibraryFileId)

    if (!projectId || !productionId || !mode || !prompt) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    if (typeof prompt !== 'string') {
      return jsonError(400, 'INVALID_PROMPT', 'prompt must be a string.')
    }

    const forbidden = FORBIDDEN_CLIENT_FIELDS.find((field) => field in body)
    if (forbidden) {
      return jsonError(400, 'UNSUPPORTED_FIELD', `"${forbidden}" cannot be set by the client.`)
    }

    // VIDEO_GENERATION_SESSION_PERSISTENCE_AND_API_V1 / VIDEO_GENERATION_CALLER_WIDE_IDEMPOTENCY_HARDENING_V1
    // `sessionId` is lineage/ownership ONLY. The body stays the single authority for what is generated.
    // Idempotency policy: all first-party product callers MUST supply clientRequestId for paid generation.
    // The API boundary retains optional compatibility (POLICY A) for external/script callers without idempotency.
    const { sessionId, clientRequestId } = body
    if (sessionId !== undefined && sessionId !== null && !isUuid(sessionId)) {
      return jsonError(400, 'INVALID_SESSION_ID', 'sessionId must be a UUID.')
    }
    if (clientRequestId !== undefined && clientRequestId !== null && !isClientRequestId(clientRequestId)) {
      return jsonError(400, 'INVALID_CLIENT_REQUEST_ID', 'clientRequestId must be a UUID.')
    }

    // Server-owned idempotency: the same logical submit (same key) must never create - or pay for - a second
    // attempt. Checked before any credential, source or provider work; the owner scope comes from the session.
    const idempotencyKey: string | null = clientRequestId ?? null
    const fingerprint = generateRequestFingerprint(body)
    const replayFor = (existing: Record<string, any>) => {
      const decision = classifyExistingSubmission(existing, fingerprint)
      if (decision.kind === 'conflict') {
        return jsonError(409, 'IDEMPOTENCY_KEY_REUSED', 'Esta chave de envio já foi usada para uma requisição diferente.')
      }
      return NextResponse.json({ generation: decision.generation, idempotentReplay: true, outcomeUnknown: decision.outcomeUnknown })
    }
    if (idempotencyKey) {
      const { data: existing, error: lookupError } = await supabase
        .from('video_generations')
        .select('*')
        .eq('user_id', user.id)
        .eq('client_request_id', idempotencyKey)
        .maybeSingle()
      // If the key cannot be checked, nothing is created: proceeding could submit (and bill) twice.
      if (lookupError) return jsonError(503, 'STORE_UNAVAILABLE', 'Não foi possível validar o envio agora. Tente novamente.')
      if (existing) return replayFor(existing)
    }

    const rawControls = {
      operation: mode,
      model: body.model ?? undefined,
      duration: body.duration ?? undefined,
      resolution: body.resolution ?? undefined,
      aspect_ratio: body.aspect_ratio ?? undefined,
      audio: body.audio ?? undefined,
      multi_shot: body.multi_shot ?? undefined,
      // MCP advanced Product controls: validated against the resolved connection's model like every other control
      // (an unsupported or malformed value is a typed 400, never silently dropped).
      asmr: body.asmr ?? undefined,
      audio_prompt: body.audio_prompt ?? undefined,
      music_prompt: body.music_prompt ?? undefined,
      outputCount: body.outputCount ?? body.imageCount ?? undefined,
      lastFrame: hasLastFrame && mode === 'image_to_video' ? true : undefined,
    }
    // Vocabulary/shape errors are rejected before any database access.
    const vocabularyFailure = validateControlVocabulary(mode, rawControls, {
      imageToVideoAspectRatio: parseConnectionRef(body.connectionRef ?? REST_CONNECTION_REF)?.kind === 'gemini_api',
    })
    if (vocabularyFailure && !vocabularyFailure.ok) {
      return jsonError(400, vocabularyFailure.code, vocabularyFailure.message)
    }

    if (mode === 'image_to_video') {
      if (!sourceImageId && !sourceLibraryFileId) {
        return NextResponse.json({ error: 'sourceImageId or sourceLibraryFileId is required for image_to_video.' }, { status: 400 })
      }
      if (sourceImageId && sourceLibraryFileId) {
        return NextResponse.json({ error: 'Provide exactly one source: sourceImageId OR sourceLibraryFileId.' }, { status: 400 })
      }
      if (hasLastFrame) {
        if (lastFrameImageId && lastFrameLibraryFileId) {
          return jsonError(400, 'INVALID_LAST_FRAME', 'Provide exactly one last frame: lastFrameImageId OR lastFrameLibraryFileId.')
        }
        for (const id of [lastFrameImageId, lastFrameLibraryFileId]) {
          if (id !== undefined && id !== null && !isUuid(id)) return jsonError(400, 'INVALID_LAST_FRAME', 'The last frame id must be a UUID.')
        }
        // Start and end must be two different images: an identical pair carries no transition and would only cost money.
        if ((lastFrameImageId && lastFrameImageId === sourceImageId) || (lastFrameLibraryFileId && lastFrameLibraryFileId === sourceLibraryFileId)) {
          return jsonError(400, 'LAST_FRAME_SAME_AS_FIRST', 'A imagem final precisa ser diferente da imagem inicial.')
        }
      }
    } else if (mode === 'text_to_video') {
      if (sourceImageId || sourceLibraryFileId) {
        return NextResponse.json({ error: 'sourceImageId and sourceLibraryFileId must be absent for text_to_video.' }, { status: 400 })
      }
      if (hasLastFrame) {
        return jsonError(400, 'UNSUPPORTED_LAST_FRAME', 'lastFrameImageId and lastFrameLibraryFileId must be absent for text_to_video.')
      }
    }

    // The connection is resolved SERVER-side from the user's own data. The
    // reference is only a pointer: ownership, status, scopes, capabilities and
    // therefore the transport all come from the resolved connection, never from
    // the request. An absent reference means the existing Kling API (REST) default.
    // A missing credential/connection = zero created records, zero provider
    // calls, and it never becomes a platform credential.
    const connectionRef = body.connectionRef ?? REST_CONNECTION_REF
    const routedProvider = parseConnectionRef(connectionRef)?.kind === 'gemini_api' ? ('gemini' as const) : ('kling' as const)
    const resolved = await resolveGenerationConnection(supabase, user.id, connectionRef)
    if (!resolved.ok) {
      return jsonError(resolved.status, resolved.code, resolved.message, { provider: routedProvider })
    }

    const operations =
      resolved.kind === 'rest' ? restVideoOperations() : resolved.kind === 'gemini_api' ? veoVideoOperations() : resolved.operations

    const validation = validateVideoRequest(operations, rawControls)
    if (!validation.ok) {
      return jsonError(400, validation.code, validation.message)
    }
    const { request: videoRequest, model: modelCapability } = validation

    // The production must belong to THIS user AND to the given project (RLS-scoped read): the
    // browser-supplied ids are never trusted, and the storage prefix is derived from the project id.
    const { data: ownedProduction, error: productionError } = await supabase
      .from('productions')
      .select('id')
      .eq('id', productionId)
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (productionError) {
      return jsonError(503, 'STORE_UNAVAILABLE', 'Não foi possível validar o projeto agora. Tente novamente.')
    }
    if (!ownedProduction) {
      return jsonError(403, 'PRODUCTION_NOT_FOUND', 'Production não encontrada neste projeto.')
    }

    // Lineage: the Session must be THIS user's and belong to exactly this Project and Production (the database
    // enforces the same with a composite FK). A missing, foreign or nonexistent id is simply "not found".
    if (sessionId) {
      const { data: ownedSession, error: sessionError } = await supabase
        .from('video_generation_sessions')
        .select('id,project_id,production_id')
        .eq('id', sessionId)
        .eq('user_id', user.id)
        .maybeSingle()
      if (sessionError) {
        return jsonError(503, 'STORE_UNAVAILABLE', 'Não foi possível validar a sessão agora. Tente novamente.')
      }
      if (!ownedSession) {
        return jsonError(404, 'SESSION_NOT_FOUND', 'Sessão não encontrada.')
      }
      if (ownedSession.project_id !== projectId || ownedSession.production_id !== productionId) {
        return jsonError(409, 'SESSION_SCOPE_MISMATCH', 'Esta sessão pertence a outro projeto ou production.')
      }
    }

    // Every write to video_generations is SERVER-owned: the user session can only read this table
    // (privileges revoked in scripts/043). The server has verified above that the project, production
    // and any source belong to this user, and always writes `user_id` from the verified session.
    // Created before any provider call, so a missing server credential is a pre-submission failure.
    const serverDb = createServiceRoleSupabase()

    // Secrets are resolved only after every check passed.
    let transport: KlingVideoTransport
    let connectionId: string | null = null
    if (resolved.kind === 'gemini_api') {
      const execution = await resolveProviderExecution(supabase, { userId: user.id, provider: 'gemini' })
      if (execution.status !== 'ready') {
        return jsonError(422, execution.code, 'Gemini não configurado. Adicione sua chave de API em Configurações para usar o Google Veo.', { provider: 'gemini' })
      }
      transport = new GeminiVeoTransport(execution.secret)
    } else if (resolved.kind === 'rest') {
      const execution = await resolveProviderExecution(supabase, { userId: user.id, provider: 'kling' })
      if (execution.status !== 'ready') {
        return jsonError(422, execution.code, 'Kling não configurado. Adicione sua chave de API em Configurações.', { provider: 'kling' })
      }
      transport = new KlingRestTransport(execution.secret)
    } else {
      const db = serverDb
      const connection = resolved.connection
      connectionId = connection.id
      transport = new KlingMcpTransport({
        get: () => getValidAccessToken(db, connection.id),
        refresh: () => forceRefreshAccessToken(db, connection.id),
      })
    }

    let resolvedSourceUrl = ''
    let resolvedLastFrameUrl = ''
    let mcpSourceImage: KlingMcpUploadImage | undefined
    let lastFrameImage: KlingMcpUploadImage | undefined
    // Kling REST receives presigned URLs; Kling MCP uploads bytes to the provider; Google Veo receives bytes inline.
    const deliverBytes = transport.transport === 'mcp' || resolved.kind === 'gemini_api'
    const frameTooLargeForVeo = (bytes: Uint8Array) => resolved.kind === 'gemini_api' && bytes.byteLength > VEO_MAX_FRAME_BYTES

    if (mode === 'image_to_video') {
      // One trust chain for every transport (owner, Project, kind, deleted state, proven storage key).
      const source = await resolveI2vSource(supabase, {
        userId: user.id,
        projectId,
        sourceImageId,
        sourceLibraryFileId,
        deliver: deliverBytes ? 'bytes' : 'url',
      })
      if (!source.ok) return NextResponse.json(source.body, { status: source.status })
      resolvedSourceUrl = source.restSourceUrl

      if (deliverBytes) {
        // VIDEO_MCP_I2V_SOURCE_TRANSPORT_V1: Kling can never fetch our private storage (a presigned URL is unreachable,
        // a data URL is not an absolute URL). The MCP transport uploads the BYTES through file_upload (Veo takes them
        // inline), so they are loaded and validated HERE, before any record exists and before any provider call.
        const loaded = await loadTrustedI2vSourceImage(source.locator)
        if (!loaded.ok) {
          console.error('I2V source rejected before any provider call:', { code: loaded.code, sourceKind: source.locator.kind, sourceId: source.locator.id.slice(0, 8) })
          return jsonError(422, loaded.code, I2V_MEDIA_FAILURE_MESSAGE[loaded.code])
        }
        if (frameTooLargeForVeo(loaded.image.bytes)) {
          return jsonError(422, 'SOURCE_IMAGE_TOO_LARGE', 'A imagem inicial é grande demais para o Google Veo (máximo de 7 MB por imagem).')
        }
        mcpSourceImage = { bytes: loaded.image.bytes, mimeType: loaded.image.mimeType, filename: loaded.image.filename }
      }

      if (videoRequest.lastFrame) {
        // VEO_KLING_FIRST_LAST_FRAME_V1: the LAST frame goes through the SAME trust chain as the first (owner, Project,
        // kind, deleted state, proven storage key) - an id belonging to another user or Project is simply "not found".
        const last = await resolveI2vSource(supabase, {
          userId: user.id,
          projectId,
          sourceImageId: lastFrameImageId,
          sourceLibraryFileId: lastFrameLibraryFileId,
          deliver: deliverBytes ? 'bytes' : 'url',
        })
        if (!last.ok) return NextResponse.json({ ...last.body, frame: 'last' }, { status: last.status })
        resolvedLastFrameUrl = last.restSourceUrl

        if (deliverBytes) {
          const loadedLast = await loadTrustedI2vSourceImage(last.locator)
          if (!loadedLast.ok) {
            console.error('I2V last frame rejected before any provider call:', { code: loadedLast.code, sourceKind: last.locator.kind, sourceId: last.locator.id.slice(0, 8) })
            return jsonError(422, loadedLast.code, `Imagem final: ${I2V_MEDIA_FAILURE_MESSAGE[loadedLast.code]}`, { frame: 'last' })
          }
          if (frameTooLargeForVeo(loadedLast.image.bytes)) {
            return jsonError(422, 'SOURCE_IMAGE_TOO_LARGE', 'A imagem final é grande demais para o Google Veo (máximo de 7 MB por imagem).', { frame: 'last' })
          }
          lastFrameImage = { bytes: loadedLast.image.bytes, mimeType: loadedLast.image.mimeType, filename: loadedLast.image.filename }
        }
      }
    }

    if (mode === 'image_to_video' && !deliverBytes && !resolvedSourceUrl) {
      return jsonError(422, 'SOURCE_MEDIA_UNAVAILABLE', 'A imagem de origem não está disponível para envio. Escolha outra imagem.')
    }
    if (mode === 'image_to_video' && videoRequest.lastFrame && !deliverBytes && !resolvedLastFrameUrl) {
      return jsonError(422, 'SOURCE_MEDIA_UNAVAILABLE', 'A imagem final não está disponível para envio. Escolha outra imagem.', { frame: 'last' })
    }

    // Durable identities of the two frames, recorded in the attempt's immutable request_config. Ids only: never a URL.
    const firstFrameIdentity: FrameIdentity | null = mode === 'image_to_video'
      ? (sourceLibraryFileId ? { type: 'library', id: sourceLibraryFileId } : { type: 'generated', id: sourceImageId })
      : null
    const lastFrameIdentity: FrameIdentity | null = mode === 'image_to_video' && videoRequest.lastFrame
      ? (lastFrameLibraryFileId ? { type: 'library', id: lastFrameLibraryFileId } : { type: 'generated', id: lastFrameImageId })
      : null

    // Insert queued state. `request_config` is the exact, explicit set of values
    // that is sent to the provider (reproducible/debuggable) — never a secret.
    const { data: generation, error: dbError } = await serverDb
      .from('video_generations')
      .insert({
        user_id: user.id,
        project_id: projectId,
        production_id: productionId,
        // Only present when used, so a caller without a Session or key inserts exactly the row it always did
        // (and keeps working even before scripts/049 is applied).
        ...(sessionId ? { session_id: sessionId } : {}),
        ...(idempotencyKey ? { client_request_id: idempotencyKey, request_fingerprint: fingerprint } : {}),
        mode,
        prompt,
        source_image_id: sourceImageId || null,
        source_library_file_id: sourceLibraryFileId || null,
        status: 'queued',
        provider: routedProvider,
        model: videoRequest.model,
        transport: transport.transport,
        connection_id: connectionId,
        request_config: {
          duration: videoRequest.duration,
          resolution: videoRequest.resolution,
          audio: videoRequest.audio ?? undefined,
          multi_shot: videoRequest.multiShot ?? undefined,
          aspect_ratio: videoRequest.aspectRatio ?? undefined,
          asmr: videoRequest.asmr ?? undefined,
          audio_prompt: videoRequest.audioPrompt ? videoRequest.audioPrompt : undefined,
          music_prompt: videoRequest.musicPrompt ? videoRequest.musicPrompt : undefined,
          output_count: 1,
          // Only attempts WITH a last frame record the frame pair, so a single-image I2V row stays exactly what it always was.
          ...(lastFrameIdentity ? frameConfig(firstFrameIdentity, lastFrameIdentity) : {}),
        },
      })
      .select()
      .single()

    if (dbError?.code === '23505' && idempotencyKey) {
      // A concurrent request with the same key won the insert: settle on ITS row. No provider call is made here.
      const { data: winner, error: winnerError } = await supabase
        .from('video_generations')
        .select('*')
        .eq('user_id', user.id)
        .eq('client_request_id', idempotencyKey)
        .maybeSingle()
      if (winnerError || !winner) return jsonError(503, 'STORE_UNAVAILABLE', 'Não foi possível validar o envio agora. Tente novamente.')
      return replayFor(winner)
    }
    if (dbError || !generation) {
      throw new Error(`Failed to create generation record: ${dbError?.message}`)
    }

    const callbackUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/kling/callback`

    let submitRes: Awaited<ReturnType<KlingVideoTransport['submit']>>
    try {
      submitRes = await transport.submit({
        generationId: generation.id,
        prompt,
        request: videoRequest,
        model: modelCapability,
        sourceImageUrl: mode === 'image_to_video' && !deliverBytes ? resolvedSourceUrl : undefined,
        lastFrameImageUrl: mode === 'image_to_video' && !deliverBytes && videoRequest.lastFrame ? resolvedLastFrameUrl : undefined,
        sourceImage: mcpSourceImage,
        lastFrameImage,
        // Kling REST completes through its callback; MCP and Google Veo are polled.
        callbackUrl: transport.transport === 'rest' && resolved.kind === 'rest' ? callbackUrl : undefined,
      })
    } catch (providerError: any) {
      // Only the error CLASS is logged: provider text/URLs are never written to logs.
      console.error(resolved.kind === 'gemini_api' ? 'Veo provider failure:' : 'Kling provider failure:', providerError instanceof Error ? providerError.name : 'unknown')

      if (resolved.kind === 'gemini_api') {
        const known = describeVeoSubmitFailure(providerError)
        await serverDb
          .from('video_generations')
          .update({ status: 'failed', error_details: known.errorDetails })
          .eq('id', generation.id)
        return jsonError(known.httpStatus, known.code, known.message, { outcomeUnknown: known.outcomeUnknown })
      }

      if (transport.transport === 'mcp') {
        const known = describeMcpSubmitFailure(providerError)
        await serverDb
          .from('video_generations')
          .update({ status: 'failed', error_details: known.errorDetails })
          .eq('id', generation.id)
        return jsonError(known.httpStatus, known.code, known.message, { outcomeUnknown: known.outcomeUnknown })
      }

      // An HTTP error ANSWER from Kling is definitive (the job was refused). A network failure or a
      // 2xx whose body we cannot read may have created (and billed) the job: that is an unknown outcome.
      const definitive = typeof providerError?.message === 'string' && providerError.message.startsWith('Kling API HTTP error')
      await serverDb
        .from('video_generations')
        .update({
          status: 'failed',
          error_details: definitive
            ? { message: providerError.message }
            : { code: 'SUBMIT_OUTCOME_UNKNOWN', message: 'Não foi possível confirmar o envio à Kling.', outcome_unknown: true },
        })
        .eq('id', generation.id)
      if (!definitive) {
        return jsonError(
          502,
          'SUBMIT_OUTCOME_UNKNOWN',
          'Não foi possível confirmar o envio à Kling. Verifique a sua conta Kling antes de tentar novamente.',
          { outcomeUnknown: true },
        )
      }
      return NextResponse.json(
        { error: 'Provider submission failed', code: 'PROVIDER_SUBMISSION_FAILED', details: providerError.message },
        { status: 500 },
      )
    }

    // The provider has ACCEPTED the job (and may bill it) from here on. Recording
    // its task id is therefore handled separately from the submission itself: a
    // failure to record must NEVER be reported as "the submission failed" (the
    // user would retry and be charged twice). MCP has no callback, so its first
    // poll is scheduled now.
    const submittedPatch = {
      status: 'submitted',
      task_id: submitRes.taskId,
      provider_metadata: submitRes.providerMetadata,
      // Every transport is polled: MCP and Google Veo have no callback; for Kling REST the signed webhook completes the generation
      // first when it arrives, and the poller recovers it when it does not (completion is idempotent).
      next_poll_at: initialNextPollAt(),
      poll_attempts: 0,
    }
    let recorded = await serverDb.from('video_generations').update(submittedPatch).eq('id', generation.id).select().single()
    if (recorded.error || !recorded.data) {
      // One more attempt (a transient store error must not be reported as a failed submission).
      try {
        recorded = await serverDb.from('video_generations').update(submittedPatch).eq('id', generation.id).select().single()
      } catch {
        // fall through to the unrecorded response below
      }
    }
    if (recorded.error || !recorded.data) {
      // Provider ids are not secrets; logged so an operator can reconcile the accepted job.
      console.error('Video submission accepted but could not be recorded', {
        generationId: generation.id,
        taskId: submitRes.taskId,
        transport: transport.transport,
      })
      return jsonError(
        502,
        'SUBMISSION_UNRECORDED',
        resolved.kind === 'gemini_api'
          ? 'O Google aceitou a geração, mas não conseguimos registrá-la. NÃO tente de novo: verifique a sua conta Google antes de gerar outro vídeo.'
          : 'A Kling aceitou a geração, mas não conseguimos registrá-la. NÃO tente de novo: verifique a sua conta Kling antes de gerar outro vídeo.',
        { outcomeUnknown: true },
      )
    }

    return NextResponse.json({ generation: toClientGeneration(recorded.data) })
  } catch (error: any) {
    const credentialUnavailable = providerCredentialUnavailableResponse(error)
    if (credentialUnavailable) return credentialUnavailable
    // Everything that reaches here happened BEFORE a provider call (the submit and the recording of its
    // result have their own handling above): a definitive failure, with a code and a generic message.
    console.error('Create video generation route error:', error instanceof Error ? error.name : 'unknown')
    return jsonError(500, 'INTERNAL_ERROR', 'Erro interno ao criar a geração. Nada foi enviado ao provedor.')
  }
}

/**
 * Maps a Google Veo submission failure to a safe response + the persisted error record. A transport failure, a 5xx or an
 * unreadable 2xx may have created (and billed) the job: that is an UNKNOWN outcome, never retried automatically.
 */
function describeVeoSubmitFailure(error: unknown) {
  if (isProviderExecutionDisabledError(error)) {
    return {
      code: 'PROVIDER_EXECUTION_DISABLED_IN_ENVIRONMENT',
      httpStatus: 403,
      message: error.message,
      outcomeUnknown: false,
      errorDetails: { code: 'PROVIDER_EXECUTION_DISABLED_IN_ENVIRONMENT', message: error.message, outcome_unknown: false },
    }
  }
  if (isVeoError(error)) {
    const veo: VeoError = error
    const unknown = veo.outcomeUnknown
    const httpStatus = unknown ? 502 : veo.kind === 'quota' ? 429 : veo.kind === 'provider_unavailable' ? 502 : 422
    const code = unknown
      ? 'SUBMIT_OUTCOME_UNKNOWN'
      : veo.kind === 'quota'
        ? 'PROVIDER_QUOTA_EXCEEDED'
        : veo.kind === 'invalid_credential'
          ? 'PROVIDER_CREDENTIAL_REJECTED'
          : 'PROVIDER_REJECTED'
    const message = unknown
      ? 'Não foi possível confirmar o envio ao Google Veo. Verifique a sua conta Google antes de tentar novamente.'
      : veo.message
    return {
      code,
      httpStatus,
      message,
      outcomeUnknown: unknown,
      errorDetails: {
        code,
        message,
        outcome_unknown: unknown,
        // For diagnosis only: the HTTP status and Google's bounded, key-redacted message (it names the offending field).
        ...(veo.status ? { provider_status: veo.status } : {}),
        ...(veo.providerText ? { provider_text: veo.providerText } : {}),
      },
    }
  }
  // Anything unclassified after the request was built may have reached Google.
  const message = 'Não foi possível confirmar o envio ao Google Veo. Verifique a sua conta Google antes de tentar novamente.'
  return { code: 'SUBMIT_OUTCOME_UNKNOWN', httpStatus: 502, message, outcomeUnknown: true, errorDetails: { code: 'SUBMIT_OUTCOME_UNKNOWN', message, outcome_unknown: true } }
}

/** Maps an MCP submission failure to a safe response + the persisted error record. */
function describeMcpSubmitFailure(error: unknown) {
  if (error instanceof ProviderAuthorizationRequiredError) {
    return {
      code: 'AUTHORIZATION_REQUIRED',
      httpStatus: 409,
      message: 'A conexão com a conta Kling precisa ser reautorizada em Configurações.',
      outcomeUnknown: false,
      errorDetails: { code: 'AUTHORIZATION_REQUIRED', message: 'A conexão com a conta Kling precisa ser reautorizada.' },
    }
  }
  if (error instanceof KlingMcpSubmitError) {
    const status = error.failureClass === 'PROVIDER_QUOTA_EXCEEDED' ? 402 : error.failureClass === 'MCP_FILE_UPLOAD_FAILED' || error.failureClass === 'MCP_SOURCE_REFERENCE_INVALID' ? 502 : error.outcomeUnknown ? 502 : 422
    return {
      code: error.failureClass,
      httpStatus: status,
      message: error.message,
      outcomeUnknown: error.outcomeUnknown,
      errorDetails: {
        code: error.failureClass,
        message: error.message,
        outcome_unknown: error.outcomeUnknown,
        ...(error.providerText ? { provider_text: error.providerText } : {}),
      },
    }
  }
  const code = error instanceof ProviderConnectionError ? error.code : 'PROVIDER_UNAVAILABLE'
  return {
    code,
    httpStatus: 502,
    message: 'Não foi possível enviar a geração à Kling agora.',
    outcomeUnknown: false,
    errorDetails: { code, message: 'Não foi possível enviar a geração à Kling agora.' },
  }
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const productionId = searchParams.get('productionId')
    const projectId = searchParams.get('projectId')

    const sessionId = searchParams.get('sessionId')
    if (sessionId !== null) {
      if (!isUuid(sessionId)) return jsonError(400, 'INVALID_SESSION_ID', 'sessionId must be a UUID.')
      // The attempts of a Session are only listed to the Session's owner; anything else is "not found".
      const { data: ownedSession, error: sessionError } = await supabase
        .from('video_generation_sessions')
        .select('id')
        .eq('id', sessionId)
        .eq('user_id', user.id)
        .maybeSingle()
      if (sessionError) return jsonError(503, 'STORE_UNAVAILABLE', 'Não foi possível validar a sessão agora. Tente novamente.')
      if (!ownedSession) return jsonError(404, 'SESSION_NOT_FOUND', 'Sessão não encontrada.')
    }

    // Newest first; `id` breaks created_at ties so the order is always deterministic (attempt numbers are
    // derived from this order, never stored).
    let query = supabase
      .from('video_generations')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })

    if (sessionId) {
      query = query.eq('session_id', sessionId)
    }

    if (productionId) {
      query = query.eq('production_id', productionId)
    }

    if (projectId) {
      query = query.eq('project_id', projectId)
    }

    const { data: generations, error } = await query

    if (error) {
      throw error
    }

    // "Saved in Arquivos" is durable server state: the promotion pointer counts only while its LibraryFile
    // is live. A trashed file reads as not saved (matching render -> Arquivos), so saving again is offered.
    const pointerIds = [...new Set((generations || []).map((gen) => gen.library_file_id).filter((id): id is string => !!id))]
    const liveFileIds = new Set<string>()
    if (pointerIds.length > 0) {
      const { data: liveFiles } = await supabase.from('library_files').select('id').in('id', pointerIds).eq('user_id', user.id).is('deleted_at', null)
      for (const file of (liveFiles ?? []) as Array<{ id: string }>) liveFileIds.add(file.id)
    }

    const signedGenerations = await Promise.all(
      (generations || []).map(async (rawGen) => {
        const gen = toClientGeneration(rawGen.library_file_id && !liveFileIds.has(rawGen.library_file_id) ? { ...rawGen, library_file_id: null } : rawGen)
        if (gen.status === 'succeeded' && gen.storage_path) {
          // Never sign (or echo the stored URL of) a path outside the owner's own namespace.
          if (!isTenantVideoStoragePath(gen.storage_path, gen)) {
            return { ...gen, storage_path: null, public_url: null }
          }
          const presigned = await createPresignedReadUrl(gen.storage_path)
          if (presigned) {
            return { ...gen, public_url: presigned }
          }
        }
        return gen
      })
    )

    return NextResponse.json({ generations: signedGenerations })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
