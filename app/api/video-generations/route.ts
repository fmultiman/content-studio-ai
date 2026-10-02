import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createPresignedReadUrl } from '@/lib/storage/s3'
import { resolveProviderExecution } from '@/lib/credentials/provider-execution'
import { createServiceRoleSupabase } from '@/lib/supabase/service-role'
import { forceRefreshAccessToken, getValidAccessToken } from '@/lib/provider-connections/token-store'
import { ProviderAuthorizationRequiredError, ProviderConnectionError } from '@/lib/provider-connections/types'
import { REST_CONNECTION_REF, resolveGenerationConnection } from '@/lib/video-generation/connections'
import { initialNextPollAt } from '@/lib/video-generation/polling'
import { isTenantVideoStoragePath } from '@/lib/video-generation/storage-path'
import { I2V_MEDIA_FAILURE_MESSAGE, loadTrustedI2vSourceImage, resolveI2vSource } from '@/lib/video-generation/i2v-source-media'
import type { KlingMcpUploadImage } from '@/lib/provider-connections/kling-mcp-upload'
import { restVideoOperations } from '@/lib/video-generation/rest-capabilities'
import { validateControlVocabulary, validateVideoRequest } from '@/lib/video-generation/request'
import {
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
    }
    // Vocabulary/shape errors are rejected before any database access.
    const vocabularyFailure = validateControlVocabulary(mode, rawControls)
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
    } else if (mode === 'text_to_video') {
      if (sourceImageId || sourceLibraryFileId) {
        return NextResponse.json({ error: 'sourceImageId and sourceLibraryFileId must be absent for text_to_video.' }, { status: 400 })
      }
    }

    // The connection is resolved SERVER-side from the user's own data. The
    // reference is only a pointer: ownership, status, scopes, capabilities and
    // therefore the transport all come from the resolved connection, never from
    // the request. An absent reference means the existing Kling API (REST) default.
    // A missing credential/connection = zero created records, zero provider
    // calls, and it never becomes a platform credential.
    const resolved = await resolveGenerationConnection(supabase, user.id, body.connectionRef ?? REST_CONNECTION_REF)
    if (!resolved.ok) {
      return jsonError(resolved.status, resolved.code, resolved.message, { provider: 'kling' })
    }

    const operations = resolved.kind === 'rest' ? restVideoOperations() : resolved.operations

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

    // Every write to video_generations is SERVER-owned: the user session can only read this table
    // (privileges revoked in scripts/043). The server has verified above that the project, production
    // and any source belong to this user, and always writes `user_id` from the verified session.
    // Created before any provider call, so a missing server credential is a pre-submission failure.
    const serverDb = createServiceRoleSupabase()

    // Secrets are resolved only after every check passed.
    let transport: KlingVideoTransport
    let connectionId: string | null = null
    if (resolved.kind === 'rest') {
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
    let mcpSourceImage: KlingMcpUploadImage | undefined

    if (mode === 'image_to_video') {
      // One trust chain for both transports (owner, Project, kind, deleted state, proven storage key).
      const source = await resolveI2vSource(supabase, {
        userId: user.id,
        projectId,
        sourceImageId,
        sourceLibraryFileId,
        deliver: transport.transport === 'mcp' ? 'bytes' : 'url',
      })
      if (!source.ok) return NextResponse.json(source.body, { status: source.status })
      resolvedSourceUrl = source.restSourceUrl

      if (transport.transport === 'mcp') {
        // VIDEO_MCP_I2V_SOURCE_TRANSPORT_V1: Kling can never fetch our private storage (a presigned URL is unreachable,
        // a data URL is not an absolute URL). The MCP transport uploads the BYTES through file_upload, so they are
        // loaded and validated HERE, before any record exists and before any provider call. REST is untouched.
        const loaded = await loadTrustedI2vSourceImage(source.locator)
        if (!loaded.ok) {
          console.error('I2V MCP source rejected before any provider call:', { code: loaded.code, sourceKind: source.locator.kind, sourceId: source.locator.id.slice(0, 8) })
          return jsonError(422, loaded.code, I2V_MEDIA_FAILURE_MESSAGE[loaded.code])
        }
        mcpSourceImage = { bytes: loaded.image.bytes, mimeType: loaded.image.mimeType, filename: loaded.image.filename }
      }
    }

    if (mode === 'image_to_video' && transport.transport === 'rest' && !resolvedSourceUrl) {
      return jsonError(422, 'SOURCE_MEDIA_UNAVAILABLE', 'A imagem de origem não está disponível para envio. Escolha outra imagem.')
    }

    // Insert queued state. `request_config` is the exact, explicit set of values
    // that is sent to the provider (reproducible/debuggable) — never a secret.
    const { data: generation, error: dbError } = await serverDb
      .from('video_generations')
      .insert({
        user_id: user.id,
        project_id: projectId,
        production_id: productionId,
        mode,
        prompt,
        source_image_id: sourceImageId || null,
        source_library_file_id: sourceLibraryFileId || null,
        status: 'queued',
        provider: 'kling',
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
        },
      })
      .select()
      .single()

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
        sourceImageUrl: mode === 'image_to_video' && transport.transport === 'rest' ? resolvedSourceUrl : undefined,
        sourceImage: mcpSourceImage,
        callbackUrl: transport.transport === 'rest' ? callbackUrl : undefined,
      })
    } catch (providerError: any) {
      // Only the error CLASS is logged: provider text/URLs are never written to logs.
      console.error('Kling provider failure:', providerError instanceof Error ? providerError.name : 'unknown')

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
      ...(transport.transport === 'mcp' ? { next_poll_at: initialNextPollAt(), poll_attempts: 0 } : {}),
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
        'A Kling aceitou a geração, mas não conseguimos registrá-la. NÃO tente de novo: verifique a sua conta Kling antes de gerar outro vídeo.',
        { outcomeUnknown: true },
      )
    }

    return NextResponse.json({ generation: recorded.data })
  } catch (error: any) {
    // Everything that reaches here happened BEFORE a provider call (the submit and the recording of its
    // result have their own handling above): a definitive failure, with a code and a generic message.
    console.error('Create video generation route error:', error instanceof Error ? error.name : 'unknown')
    return jsonError(500, 'INTERNAL_ERROR', 'Erro interno ao criar a geração. Nada foi enviado à Kling.')
  }
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

    let query = supabase.from('video_generations').select('*').eq('user_id', user.id).order('created_at', { ascending: false })

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
        const gen = rawGen.library_file_id && !liveFileIds.has(rawGen.library_file_id) ? { ...rawGen, library_file_id: null } : rawGen
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
