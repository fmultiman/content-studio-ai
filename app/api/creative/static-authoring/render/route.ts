/**
 * POST /api/creative/static-authoring/render
 *
 * Static Render Worker V1 — ENQUEUE a static still render ("Gerar PNG").
 *
 * This route used to spawn `scripts/creative/run-authoring-render.mjs`
 * (Remotion bundle + headless Chromium + renderStill) INSIDE the request —
 * a local-development bridge that cannot run on Vercel and produced the
 * production 500. It now only validates, freezes and enqueues; the VPS
 * render worker claims and renders the job (same pull/coordinator model as
 * video). No Chromium, no Remotion, no MinIO write happens here.
 *
 * Flow:
 *   authenticate -> ownership (Project / EditorialContent / ChannelPiece)
 *   -> validate the current authored render request (may include unsaved
 *      local edits; persisted authoring state is never read or written)
 *   -> compile + validate the canonical StaticRenderManifest server-side
 *   -> freeze it into render_executions.input_snapshot (kind static_still)
 *   -> 201 { executionId, status: 'queued' }
 *
 * The browser supplies the authored render request plus an optional
 * `idempotencyKey`, `slide` ({ id, index, total }) and `retryOfExecutionId`.
 * Authority fields (identity snapshot, manifest source/context, the
 * execution row itself) are always server-derived.
 */
import { NextResponse } from 'next/server'
import { createClient as createServiceRoleClient } from '@supabase/supabase-js'
import { authoringRenderRequestSchema } from '@/lib/creative/authoring/render-request'
import { createClient } from '@/lib/supabase/server'
import { adaptProjectIdentityToVisualTokens } from '@/lib/creative/integration/project-identity-adapter'
import { normalizeProjectIdentity, ProjectIdentityParseError } from '@/lib/project-identity-normalizer'
import { listPrimitivesForProject, PORTAL_PROJECT_REF, selectPrimitiveAssetRef } from '@/lib/creative/primitives/discovery'
import { staticAuthoringTarget } from '@/lib/creative/context/static-authoring'
import { resolveStaticRenderManifest } from '@/lib/creative/resolution/resolve-static-render'
import { DEFAULT_TEMPLATE_ID, getTemplateDefinition, getTemplateLayout, layoutUsesContentImage } from '@/lib/creative/templates/template-definitions'
import { normalizeElementOrder } from '@/lib/creative/templates/element-stack'
import type { FrozenAssetOverrides } from '@/lib/render-execution/static-snapshot'
import {
  StaticRenderSlideRefSchema,
  assertStaticSnapshotHasNoSignedUrl,
  buildStaticRenderExecutionSnapshot,
  STATIC_RENDER_EXECUTION_SNAPSHOT_SCHEMA_VERSION,
  type FrozenPrimitiveAssets,
} from '@/lib/render-execution/static-snapshot'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_IDEMPOTENCY_KEY_LENGTH = 128
const PRIMITIVE_FILE_IDS = ['afa6868e-a2d6-473d-9df7-bbf713ad8b02', '3f593474-05c0-4de3-a537-de50a1abb906']
/** Image types a slot override may use (the renderer paints them as CSS backgrounds). */
const OVERRIDE_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

/** Server-only: execution rows are never insertable with the browser's session client (see 031/032). */
function createRenderExecutionWriteClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) return null
  return createServiceRoleClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
}

function fail(status: number, code: string, error: string) {
  return NextResponse.json({ error, code }, { status })
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return fail(401, 'UNAUTHORIZED', 'Nao autorizado')

    const raw = await request.json().catch(() => null) as Record<string, unknown> | null
    if (!raw || typeof raw !== 'object') return fail(400, 'INVALID_BODY', 'Corpo da requisicao invalido.')

    // Execution-plane fields ride beside the authored render request; the
    // render request itself is validated by its own strict schema.
    const { idempotencyKey: rawKey, slide: rawSlide, retryOfExecutionId: rawRetryOf, ...renderRequest } = raw

    let idempotencyKey: string | null = null
    if (rawKey !== undefined && rawKey !== null) {
      if (typeof rawKey !== 'string' || !rawKey.trim() || rawKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) return fail(400, 'INVALID_IDEMPOTENCY_KEY', 'idempotencyKey invalido.')
      idempotencyKey = rawKey.trim()
    }
    const slideParsed = rawSlide === undefined || rawSlide === null ? { success: true as const, data: null } : StaticRenderSlideRefSchema.safeParse(rawSlide)
    if (!slideParsed.success) return fail(400, 'INVALID_SLIDE', 'Slide invalido.')
    const slide = slideParsed.data
    let retryOfExecutionId: string | null = null
    if (rawRetryOf !== undefined && rawRetryOf !== null) {
      if (typeof rawRetryOf !== 'string' || !UUID_RE.test(rawRetryOf)) return fail(400, 'INVALID_RETRY_OF', 'retryOfExecutionId invalido.')
      retryOfExecutionId = rawRetryOf
    }

    const parsed = authoringRenderRequestSchema.safeParse(renderRequest)
    if (!parsed.success) return fail(400, 'INVALID_RENDER_REQUEST', 'Request contextual invalida.')
    const input = parsed.data
    const context = input.context
    if (!context) return fail(400, 'CONTEXT_REQUIRED', 'Contexto de render obrigatorio.')
    const { projectId, editorialContentId, channelPieceId } = context
    if (![projectId, editorialContentId, channelPieceId].every((id) => UUID_RE.test(id))) return fail(400, 'INVALID_CONTEXT', 'Contexto invalido.')

    const executionAdmin = createRenderExecutionWriteClient()
    if (!executionAdmin) {
      console.error('[static-render enqueue] SUPABASE_SERVICE_ROLE_KEY is not configured')
      return fail(503, 'RENDER_EXECUTION_SERVICE_UNAVAILABLE', 'Servico de renderizacao indisponivel.')
    }

    // Idempotency fast path (same pattern as video): a double-submit of the
    // SAME gesture reuses its row. Only a static row can be reused here.
    if (idempotencyKey) {
      const { data: existing } = await executionAdmin
        .from('render_executions')
        .select('id, status, queued_at, kind, channel_piece_id')
        .eq('user_id', user.id)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle()
      if (existing) {
        if (existing.kind !== 'static_still' || existing.channel_piece_id !== channelPieceId) return fail(409, 'IDEMPOTENCY_KEY_CONFLICT', 'idempotencyKey ja usado por outra execucao.')
        return NextResponse.json({ executionId: existing.id, status: existing.status, queuedAt: existing.queued_at, reused: true, slide })
      }
    }

    // Ownership chain — the only client-authored authority is these ids,
    // each re-checked against the session user.
    const [{ data: project }, { data: editorialContent }, { data: channelPiece }] = await Promise.all([
      supabase.from('projects').select('id, identity').eq('id', projectId).eq('user_id', user.id).maybeSingle(),
      supabase.from('editorial_contents').select('id, project_id, production_id').eq('id', editorialContentId).eq('user_id', user.id).maybeSingle(),
      supabase.from('channel_pieces').select('id, editorial_content_id, channel, format').eq('id', channelPieceId).eq('user_id', user.id).maybeSingle(),
    ])
    if (!project || !editorialContent || !channelPiece || editorialContent.project_id !== project.id || channelPiece.editorial_content_id !== editorialContent.id) {
      return fail(404, 'CONTEXT_NOT_FOUND', 'Contexto nao encontrado ou nao autorizado.')
    }
    const target = staticAuthoringTarget(channelPiece.channel, channelPiece.format)
    if (!target) return fail(409, 'NOT_STATIC_CHANNEL_PIECE', 'ChannelPiece nao e static.')

    let projectIdentity
    try {
      projectIdentity = normalizeProjectIdentity(project.identity)
    } catch (error) {
      if (error instanceof ProjectIdentityParseError) return fail(409, 'PROJECT_IDENTITY_INVALID', 'Identidade do Projeto invalida.')
      throw error
    }
    if (!projectIdentity) return fail(409, 'PROJECT_IDENTITY_REQUIRED', 'Project sem identidade valida.')

    // Canvas is decided by the ChannelPiece's static target, never the browser.
    if (input.manifest.canvas.width !== target.canvas.width || input.manifest.canvas.height !== target.canvas.height) {
      return fail(400, 'CANVAS_MISMATCH', 'Canvas nao corresponde ao alvo da peca.')
    }
    // Only template fixture assets are renderable from the Creative Editor
    // today (no hero picker yet) — never an arbitrary library_file/URL ref.
    if (Object.values(input.manifest.assets).some((asset) => asset.type !== 'fixture')) {
      return fail(400, 'UNSUPPORTED_ASSET_REF', 'Asset nao suportado para render estatico.')
    }

    if (input.primitiveSelection) {
      const { data: primitiveFiles } = await supabase.from('library_files').select('id').in('id', PRIMITIVE_FILE_IDS).eq('project_id', project.id).eq('user_id', user.id)
      const catalog = primitiveFiles?.length === PRIMITIVE_FILE_IDS.length ? listPrimitivesForProject(PORTAL_PROJECT_REF) : null
      if (!catalog?.found || input.primitiveSelection.projectRef !== PORTAL_PROJECT_REF) return fail(403, 'PRIMITIVE_CATALOG_FORBIDDEN', 'Primitive catalog nao autorizado.')
      const keys = new Set(catalog.primitives.map((primitive) => primitive.key))
      if ([input.primitiveSelection.paper, input.primitiveSelection.tape].some((key) => key && !keys.has(key))) return fail(403, 'PRIMITIVE_OUTSIDE_PROJECT', 'Primitive fora do Project.')
    }

    // Compile the canonical manifest with server-authoritative identity,
    // source and context, then prove it resolves BEFORE queueing so an
    // invalid payload is rejected now, not after a worker claims it.
    const identitySnapshot = adaptProjectIdentityToVisualTokens(project.id, projectIdentity)
    const primitiveAssets: FrozenPrimitiveAssets = {}
    if (input.primitiveSelection) {
      const catalog = listPrimitivesForProject(input.primitiveSelection.projectRef)
      if (catalog.found) {
        for (const slot of ['paper', 'tape'] as const) {
          const key = input.primitiveSelection[slot]
          if (!key) continue
          const selected = selectPrimitiveAssetRef(input.primitiveSelection.projectRef, key)
          const descriptor = selected?.descriptor
          if (descriptor) {
            primitiveAssets[slot] = {
              libraryFileId: descriptor.library_file_ref,
              mimeType: descriptor.validation.mime_type ?? 'image/png',
              width: descriptor.validation.width,
              height: descriptor.validation.height,
              checksum: descriptor.validation.sha256 ?? 'catalog',
              version: descriptor.version,
            }
          }
        }
      }
    }
    // Authoring Usability Completion V1 — Assets "Trocar": each chosen
    // LibraryFile must be the user's own, in THIS project, not trashed, and an
    // image; its immutable id is frozen (never a URL/path).
    const assetOverrides: FrozenAssetOverrides = {}
    const overrideEntries = Object.entries(input.assetOverrides ?? {}).filter(([, value]) => value?.libraryFileId) as [keyof FrozenAssetOverrides, { libraryFileId: string }][]
    if (overrideEntries.length > 0) {
      const ids = [...new Set(overrideEntries.map(([, value]) => value.libraryFileId))]
      const { data: files } = await supabase
        .from('library_files')
        .select('id, name, kind, mime_type, deleted_at')
        .in('id', ids)
        .eq('user_id', user.id)
        .eq('project_id', project.id)
      for (const [slot, value] of overrideEntries) {
        const file = files?.find((candidate) => candidate.id === value.libraryFileId)
        if (!file || file.deleted_at || file.kind !== 'image' || !OVERRIDE_IMAGE_MIME_TYPES.has(file.mime_type ?? '')) {
          return fail(403, 'ASSET_OVERRIDE_FORBIDDEN', 'Arquivo de asset invalido ou fora do Projeto.')
        }
        assetOverrides[slot] = { libraryFileId: file.id, mimeType: file.mime_type as string, name: file.name }
      }
    }
    // Creative Editor Template Foundation V1: the authoring Template must
    // match the renderer the manifest names, and the element stack is frozen
    // already normalized (same helper the Editor preview and worker use).
    const templateId = input.templateId ?? DEFAULT_TEMPLATE_ID
    const template = getTemplateDefinition(templateId)
    const layout = template && input.manifest.template.variant ? getTemplateLayout(template, input.manifest.template.variant) : null
    if (!template || !layout || template.renderer.templateRef.id !== input.manifest.template.id) {
      return fail(400, 'TEMPLATE_LAYOUT_MISMATCH', 'Template/estrutura nao correspondem ao render.')
    }

    // A content-image override binds only on layouts that draw one (Cover, Lista).
    const heroOverride = assetOverrides.hero
    const manifestAssets = heroOverride && layoutUsesContentImage(layout)
      ? { ...input.manifest.assets, hero: { type: 'library_file' as const, ref: heroOverride.libraryFileId, fit: 'cover' as const } }
      : input.manifest.assets

    const manifest = {
      ...input.manifest,
      assets: manifestAssets,
      source: { type: 'channel_piece' as const, ref: channelPiece.id },
      context: { project_ref: project.id, ...(editorialContent.production_id ? { production_ref: editorialContent.production_id } : {}) },
      identity: { snapshot_ref: identitySnapshot.snapshot_ref, token_profile: 'default' },
      output: { ...input.manifest.output, format: 'png' as const },
    }
    const resolution = resolveStaticRenderManifest(manifest, { identitySnapshot })
    if (!resolution.valid) {
      const first = resolution.errors[0]
      return NextResponse.json({ error: 'Conteudo do slide invalido para render.', code: 'INVALID_STATIC_PAYLOAD', details: first ? `${first.code}: ${first.message}`.slice(0, 300) : undefined }, { status: 400 })
    }

    const elementOrder = normalizeElementOrder(layout, input.elementOrder)

    const snapshot = buildStaticRenderExecutionSnapshot({
      manifest,
      identitySnapshot,
      overrides: input.overrides,
      primitiveSelection: input.primitiveSelection,
      primitiveAssets: Object.keys(primitiveAssets).length > 0 ? primitiveAssets : undefined,
      primitiveTransforms: input.primitiveTransforms,
      templateId,
      elementOrder,
      assetOverrides,
      slide,
    })
    assertStaticSnapshotHasNoSignedUrl(snapshot)

    if (retryOfExecutionId) {
      const { data: previous } = await executionAdmin
        .from('render_executions')
        .select('id, kind, channel_piece_id')
        .eq('id', retryOfExecutionId)
        .eq('user_id', user.id)
        .maybeSingle()
      if (!previous || previous.kind !== 'static_still' || previous.channel_piece_id !== channelPiece.id) retryOfExecutionId = null
    }

    const { data: execution, error: insertError } = await executionAdmin
      .from('render_executions')
      .insert({
        user_id: user.id,
        project_id: project.id,
        kind: 'static_still',
        channel_piece_id: channelPiece.id,
        video_draft_id: null,
        status: 'queued',
        input_schema_version: STATIC_RENDER_EXECUTION_SNAPSHOT_SCHEMA_VERSION,
        input_snapshot: snapshot,
        idempotency_key: idempotencyKey,
        output_mime_type: 'image/png',
        ...(retryOfExecutionId ? { retry_of_execution_id: retryOfExecutionId } : {}),
      })
      .select('id, status, queued_at')
      .single()

    if (insertError) {
      if (idempotencyKey && insertError.code === '23505') {
        const { data: raced } = await executionAdmin.from('render_executions').select('id, status, queued_at').eq('user_id', user.id).eq('idempotency_key', idempotencyKey).maybeSingle()
        if (raced) return NextResponse.json({ executionId: raced.id, status: raced.status, queuedAt: raced.queued_at, reused: true, slide })
      }
      console.error('[static-render enqueue] insert failed:', insertError.code, insertError.message)
      return fail(500, 'RENDER_EXECUTION_INSERT_FAILED', 'Nao foi possivel enfileirar o render.')
    }

    console.log(`[static-render enqueue] queued execution ${execution.id} (channelPiece ${channelPiece.id}, slide ${slide ? `${slide.index}/${slide.total}` : '-'})`)
    return NextResponse.json({ executionId: execution.id, status: execution.status, queuedAt: execution.queued_at, reused: false, slide }, { status: 201 })
  } catch (error) {
    console.error('[static-render enqueue] Error:', error instanceof Error ? error.message : error)
    return fail(500, 'STATIC_RENDER_ENQUEUE_FAILED', 'Falha ao enfileirar o render.')
  }
}
