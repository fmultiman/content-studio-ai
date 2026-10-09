import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveProviderExecution } from '@/lib/credentials/provider-execution'
import { createPresignedReadUrl } from '@/lib/storage/s3'
import { createServiceRoleSupabase } from '@/lib/supabase/service-role'
import { createMcpTransportForGeneration, syncGenerationWithProvider } from '@/lib/video-generation/polling'
import { isTenantVideoStoragePath } from '@/lib/video-generation/storage-path'
import { KlingRestTransport, type KlingVideoTransport } from '@/lib/video-generation/transport'

// VIDEO_GENERATION_CONNECTION_CAPABILITY_ROUTING_V1
//
// Manual / recovery status sync for ONE of the authenticated user's
// generations. It is transport-aware and calls the SAME status + completion
// logic as the REST callback and the MCP poller (lib/video-generation), so
// there is a single implementation of "provider status -> VideoGeneration".
//
// The transport comes from the STORED generation (server-owned provenance);
// legacy rows without a transport are REST by definition.
export const maxDuration = 300

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: generation, error } = await supabase
      .from('video_generations')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (error || !generation) {
      return NextResponse.json({ error: 'Generation not found' }, { status: 404 })
    }

    if (generation.status === 'succeeded' || generation.status === 'failed') {
      return NextResponse.json({ generation })
    }

    if (!generation.task_id) {
      return NextResponse.json({ error: 'No task_id associated' }, { status: 400 })
    }

    const isMcp = generation.transport === 'mcp'
    let transport: KlingVideoTransport | null
    // Lifecycle writes (status, storage_path, result metadata, poll state) are server-owned: the user
    // session can only READ this table. Ownership was verified above (`user_id = user.id`).
    const writeDb = createServiceRoleSupabase()

    if (isMcp) {
      // Token material lives behind the service role; ownership of the
      // connection is re-verified against the generation's own user id.
      transport = await createMcpTransportForGeneration(writeDb, generation)
      if (!transport) {
        return NextResponse.json(
          { error: 'A conexão com a conta Kling não está mais disponível.', code: 'CONNECTION_UNAVAILABLE', provider: 'kling' },
          { status: 409 },
        )
      }
    } else {
      const execution = await resolveProviderExecution(supabase, { userId: user.id, provider: 'kling', purpose: 'status_read' })

      if (execution.status !== 'ready') {
        return NextResponse.json(
          {
            error: execution.code,
            code: execution.code,
            provider: 'kling',
            message: 'Kling não configurado. Adicione sua chave de API em Configurações.',
          },
          { status: 422 },
        )
      }
      transport = new KlingRestTransport(execution.secret)
    }

    // Manual sync is a plain check + completion. It never takes the poller's lease nor rewrites its
    // schedule/attempt counters (the leased external poller owns those), so `schedule` is always off.
    const result = await syncGenerationWithProvider(writeDb, generation, transport, { schedule: false })

    if (result.outcome === 'authorization_required') {
      return NextResponse.json(
        { error: 'A conexão com a conta Kling precisa ser reautorizada.', code: 'AUTHORIZATION_REQUIRED', provider: 'kling' },
        { status: 409 },
      )
    }
    if (result.outcome === 'transient_error') {
      return NextResponse.json(
        { error: 'Não foi possível consultar a Kling agora. Tente novamente em instantes.', code: 'PROVIDER_UNAVAILABLE', provider: 'kling' },
        { status: 502 },
      )
    }

    // Same contract as the history list: a finished video is served through a
    // short-lived presigned URL, never the raw storage URL.
    const current = result.generation ?? generation
    let responseGeneration = current
    if (current.status === 'succeeded' && current.storage_path) {
      if (!isTenantVideoStoragePath(current.storage_path, current)) {
        responseGeneration = { ...current, storage_path: null, public_url: null }
      } else {
        const presigned = await createPresignedReadUrl(current.storage_path)
        if (presigned) responseGeneration = { ...current, public_url: presigned }
      }
    }

    return NextResponse.json({ generation: responseGeneration, outcome: result.outcome })
  } catch (err: any) {
    console.error('Video generation sync error:', err instanceof Error ? err.name : 'unknown')
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
