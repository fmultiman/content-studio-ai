import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { NextResponse } from 'next/server'
import { authoringRenderRequestSchema } from '@/lib/creative/authoring/render-request'
import { createClient } from '@/lib/supabase/server'
import { adaptProjectIdentityToVisualTokens } from '@/lib/creative/integration/project-identity-adapter'
import { normalizeProjectIdentity } from '@/lib/project-identity-normalizer'
import { listPrimitivesForProject, PORTAL_PROJECT_REF } from '@/lib/creative/primitives/discovery'
import { staticAuthoringTarget } from '@/lib/creative/context/static-authoring'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const routeDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(routeDir, '..', '..', '..', '..', '..', '..')
const runner = path.join(repoRoot, 'scripts', 'creative', 'run-authoring-render.mjs')
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PRIMITIVE_FILE_IDS = ['afa6868e-a2d6-473d-9df7-bbf713ad8b02', '3f593474-05c0-4de3-a537-de50a1abb906']

function runRenderer(input: unknown): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [runner], { cwd: repoRoot, env: { ...process.env, NODE_ENV: 'development' }, shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
    const stdout: Buffer[] = []; const stderr: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk)); child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk)); child.on('error', reject)
    child.on('close', (code) => resolve({ stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), code: code ?? 1 }))
    child.stdin.end(JSON.stringify(input))
  })
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient(); const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })
    const raw = await request.json().catch(() => null); const parsed = authoringRenderRequestSchema.safeParse(raw)
    if (!parsed.success) return NextResponse.json({ error: 'Request contextual invalida.' }, { status: 400 })
    const context = parsed.data.context
    if (!context) return NextResponse.json({ error: 'Contexto de render obrigatorio.' }, { status: 400 })
    const input = parsed.data; const { projectId, editorialContentId, channelPieceId } = context
    if (![projectId, editorialContentId, channelPieceId].every((id) => UUID_RE.test(id))) return NextResponse.json({ error: 'Contexto invalido.' }, { status: 400 })
    const [{ data: project }, { data: editorialContent }, { data: channelPiece }] = await Promise.all([
      supabase.from('projects').select('*').eq('id', projectId).eq('user_id', user.id).single(),
      supabase.from('editorial_contents').select('*').eq('id', editorialContentId).eq('user_id', user.id).single(),
      supabase.from('channel_pieces').select('*').eq('id', channelPieceId).eq('user_id', user.id).single(),
    ])
    if (!project || !editorialContent || !channelPiece || editorialContent.project_id !== project.id || channelPiece.editorial_content_id !== editorialContent.id) return NextResponse.json({ error: 'Contexto nao encontrado ou nao autorizado.' }, { status: 404 })
    if (!staticAuthoringTarget(channelPiece.channel, channelPiece.format)) return NextResponse.json({ error: 'ChannelPiece nao e static.' }, { status: 409 })
    const projectIdentity = normalizeProjectIdentity(project.identity); if (!projectIdentity) return NextResponse.json({ error: 'Project sem identidade valida.' }, { status: 409 })
    const { data: primitiveFiles } = await supabase.from('library_files').select('id').in('id', PRIMITIVE_FILE_IDS).eq('project_id', project.id).eq('user_id', user.id)
    const catalog = primitiveFiles?.length === PRIMITIVE_FILE_IDS.length ? listPrimitivesForProject(PORTAL_PROJECT_REF) : null
    if (input.primitiveSelection) {
      if (!catalog?.found || input.primitiveSelection.projectRef !== PORTAL_PROJECT_REF) return NextResponse.json({ error: 'Primitive catalog nao autorizado.' }, { status: 403 })
      const keys = new Set(catalog.primitives.map((primitive) => primitive.key)); if ([input.primitiveSelection.paper, input.primitiveSelection.tape].some((key) => key && !keys.has(key))) return NextResponse.json({ error: 'Primitive fora do Project.' }, { status: 403 })
    }
    const identitySnapshot = adaptProjectIdentityToVisualTokens(project.id, projectIdentity)
    const secureRequest = { ...input, identitySnapshot, manifest: { ...input.manifest, identity: { snapshot_ref: identitySnapshot.snapshot_ref, token_profile: 'default' } } }
    const result = await runRenderer(secureRequest); if (result.code !== 0) return NextResponse.json({ error: 'Render contextual falhou.', details: result.stderr.slice(-4000) }, { status: 500 })
    const output = JSON.parse(result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? '{}') as Record<string, unknown>
    const fs = await import('node:fs/promises'); const image = await fs.readFile(path.join(repoRoot, String(output.output_path)))
    return NextResponse.json({ ...output, image_data_url: `data:image/png;base64,${image.toString('base64')}` })
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Render contextual falhou.' }, { status: 500 }) }
}
