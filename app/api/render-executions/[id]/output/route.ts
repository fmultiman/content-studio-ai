/**
 * GET /api/render-executions/:id/output
 *
 * Static Render Worker V1 — streams a COMPLETED static still (PNG) from the
 * execution's private scratch object to its owner, same-origin.
 *
 * Exists so "Salvar nesta peca" keeps using the existing, proven
 * `/api/channel-piece-media/upload` route (scratch PNG -> Blob -> upload ->
 * LibraryFile -> ChannelPieceMedia) without the browser ever needing a
 * cross-origin MinIO fetch. Display uses the presigned `output-url` route.
 *
 * Authority: session user must own the row; row must be static_still and
 * completed; the storage key must sit inside that user's scratch prefix for
 * that execution. Never returns a storage path, bucket or credential.
 */
import { NextResponse } from 'next/server'
import { createClient as createServiceRoleClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { readS3Object } from '@/lib/storage/s3'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_STATIC_OUTPUT_BYTES = 20 * 1024 * 1024

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

function createRenderExecutionReadClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) return null
  return createServiceRoleClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'ID invalido.', code: 'INVALID_EXECUTION_ID' }, { status: 400 })

    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })

    const reader = createRenderExecutionReadClient()
    if (!reader) return NextResponse.json({ error: 'Servico de renderizacao indisponivel.' }, { status: 503 })

    const { data: execution } = await reader
      .from('render_executions')
      .select('id, status, kind, output_storage_path')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!execution) return NextResponse.json({ error: 'Execucao nao encontrada ou acesso negado.', code: 'NOT_FOUND' }, { status: 404 })
    if (execution.kind !== 'static_still') return NextResponse.json({ error: 'Somente renders estaticos.', code: 'NOT_STATIC_EXECUTION' }, { status: 409 })
    if (execution.status !== 'completed' || !execution.output_storage_path) return NextResponse.json({ error: 'Render ainda nao concluido.', code: 'EXECUTION_NOT_COMPLETED' }, { status: 409 })

    const expectedKey = `users/${user.id}/renders/scratch/${id}/output.png`
    if (execution.output_storage_path !== expectedKey) {
      console.error('[render-executions/output] storage key outside scratch boundary for', id)
      return NextResponse.json({ error: 'Saida invalida.', code: 'INVALID_STORAGE_PATH' }, { status: 500 })
    }

    const object = await readS3Object(expectedKey, { maxBytes: MAX_STATIC_OUTPUT_BYTES })
    if (!object) return NextResponse.json({ error: 'Storage indisponivel.', code: 'STORAGE_UNAVAILABLE' }, { status: 503 })

    return new NextResponse(Buffer.from(object.bytes), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(object.bytes.byteLength),
        'Cache-Control': 'private, no-store',
        'Content-Disposition': `inline; filename="render-${id}.png"`,
      },
    })
  } catch (error) {
    console.error('[render-executions/output] Error:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Falha ao ler o PNG.', code: 'OUTPUT_READ_FAILED' }, { status: 500 })
  }
}
