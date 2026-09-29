import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createPresignedReadUrl } from '@/lib/storage/s3'
import { resolveProviderExecution } from '@/lib/credentials/provider-execution'
import { createServiceRoleSupabase } from '@/lib/supabase/service-role'
import { forceRefreshAccessToken, getValidAccessToken } from '@/lib/provider-connections/token-store'
import { ProviderAuthorizationRequiredError, ProviderConnectionError } from '@/lib/provider-connections/types'
import { REST_CONNECTION_REF, resolveGenerationConnection } from '@/lib/video-generation/connections'
import { initialNextPollAt } from '@/lib/video-generation/polling'
import { restVideoOperations } from '@/lib/video-generation/rest-capabilities'
import { validateControlVocabulary, validateVideoRequest } from '@/lib/video-generation/request'
import {
  KlingMcpSubmitError,
  KlingMcpTransport,
  KlingRestTransport,
  type KlingVideoTransport,
} from '@/lib/video-generation/transport'

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
      const db = createServiceRoleSupabase()
      const connection = resolved.connection
      connectionId = connection.id
      transport = new KlingMcpTransport({
        get: () => getValidAccessToken(db, connection.id),
        refresh: () => forceRefreshAccessToken(db, connection.id),
      })
    }

    let resolvedSourceUrl = ''

    if (mode === 'image_to_video') {
      if (sourceImageId) {
        const { data: image, error: imageError } = await supabase
          .from('images')
          .select('*')
          .eq('id', sourceImageId)
          .eq('user_id', user.id)
          .eq('project_id', projectId)
          .single()

        if (imageError || !image) {
          return NextResponse.json({ error: 'Source image not found or not owned by user in this project' }, { status: 403 })
        }
        if (image.storage_path) {
          const presigned = await createPresignedReadUrl(image.storage_path)
          resolvedSourceUrl = presigned || image.image_url
        } else {
          resolvedSourceUrl = image.image_url
        }
      } else if (sourceLibraryFileId) {
        const { data: file, error: fileError } = await supabase
          .from('library_files')
          .select('*')
          .eq('id', sourceLibraryFileId)
          .eq('user_id', user.id)
          .eq('project_id', projectId)
          .single()

        if (fileError || !file) {
          return NextResponse.json({ error: 'Source library file not found or not owned by user in this project' }, { status: 403 })
        }
        if (file.storage_path) {
          const presigned = await createPresignedReadUrl(file.storage_path)
          resolvedSourceUrl = presigned || file.public_url || ''
        } else {
          resolvedSourceUrl = file.public_url || ''
        }
      }
    }

    // Insert queued state. `request_config` is the exact, explicit set of values
    // that is sent to the provider (reproducible/debuggable) — never a secret.
    const { data: generation, error: dbError } = await supabase
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
        sourceImageUrl: mode === 'image_to_video' ? resolvedSourceUrl : undefined,
        callbackUrl: transport.transport === 'rest' ? callbackUrl : undefined,
      })
    } catch (providerError: any) {
      // Only the error CLASS is logged: provider text/URLs are never written to logs.
      console.error('Kling provider failure:', providerError instanceof Error ? providerError.name : 'unknown')

      if (transport.transport === 'mcp') {
        const known = describeMcpSubmitFailure(providerError)
        await supabase
          .from('video_generations')
          .update({ status: 'failed', error_details: known.errorDetails })
          .eq('id', generation.id)
        return jsonError(known.httpStatus, known.code, known.message, { outcomeUnknown: known.outcomeUnknown })
      }

      await supabase
        .from('video_generations')
        .update({
          status: 'failed',
          error_details: { message: providerError.message },
        })
        .eq('id', generation.id)
      return NextResponse.json({ error: 'Provider submission failed', details: providerError.message }, { status: 500 })
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
    let recorded = await supabase.from('video_generations').update(submittedPatch).eq('id', generation.id).select().single()
    if (recorded.error || !recorded.data) {
      // One more attempt with server authority (not blocked by row-level policy).
      try {
        recorded = await createServiceRoleSupabase().from('video_generations').update(submittedPatch).eq('id', generation.id).select().single()
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
    console.error('Create video generation route error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
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
    const status = error.failureClass === 'PROVIDER_QUOTA_EXCEEDED' ? 402 : error.outcomeUnknown ? 502 : 422
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

    const signedGenerations = await Promise.all(
      (generations || []).map(async (gen) => {
        if (gen.status === 'succeeded' && gen.storage_path) {
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
