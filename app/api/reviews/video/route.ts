// GEMINI_VIDEO_REVIEW_ADAPTER_V1
//
// POST /api/reviews/video   (run one Review)
// GET  /api/reviews/video   (read-only history of a typed source)
//
// The browser names a typed SOURCE entity by id (`video_generation` | `render_execution` |
// `library_file`) and a clientRequestId. It can never send a URL, bucket, storage key, MIME type,
// size, duration, credential, provider or model: the schema is strict and the server resolves
// every trusted fact. Review is advisory (it is not approval) and never mutates the source.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isUuid, readBoundedJsonBody } from '@/lib/image-generation/session'
import { VideoReviewRequestSchema, VideoReviewSourceSchema } from '@/lib/reviews/contracts'
import { ReviewServiceError } from '@/lib/reviews/errors'
import { toReviewRecord } from '@/lib/reviews/repository'
import { createVideoReviewExecution } from '@/lib/reviews/video-service'
import { getVideoReviewHistory } from '@/lib/reviews/video-history'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Upload + provider processing of a long clip can exceed the default function budget.
export const maxDuration = 300

function errorResponse(error: unknown) {
  if (error instanceof ReviewServiceError) {
    return NextResponse.json({ error: error.message, code: error.code, ...error.details }, { status: error.status })
  }
  // Unknown failures are never echoed: they may carry storage keys or provider details.
  return NextResponse.json({ error: 'Review could not be completed.', code: 'REVIEW_INTERNAL_ERROR' }, { status: 500 })
}

/**
 * GET /api/reviews/video?kind=<video_generation|render_execution|library_file>&id=<uuid>
 *
 * READ-ONLY history of Video Reviews for one typed source, newest first. It runs with the caller's own
 * session client (row-level security applies), issues only SELECTs, and never registers an artifact, reads
 * media, writes provenance or a Review, or contacts a provider. A source with no artifact yet answers `[]`.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 })

    const params = new URL(request.url).searchParams
    const parsed = VideoReviewSourceSchema.safeParse({ kind: params.get('kind'), id: params.get('id') })
    if (!parsed.success || !isUuid(parsed.data.id)) {
      return NextResponse.json({ error: 'Invalid Review source.', code: 'INVALID_BODY' }, { status: 400 })
    }
    const history = await getVideoReviewHistory({ db: supabase, userId: user.id, source: parsed.data })
    return NextResponse.json(history, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 })

    const body = await readBoundedJsonBody(request, 16 * 1024)
    if (!body.ok) return NextResponse.json({ error: body.message, code: body.code }, { status: body.status })
    const parsed = VideoReviewRequestSchema.safeParse(body.body)
    if (!parsed.success || !isUuid(parsed.data.source.id)) {
      return NextResponse.json({ error: 'Invalid Review body.', code: 'INVALID_BODY' }, { status: 400 })
    }
    const result = await createVideoReviewExecution({ userId: user.id, source: parsed.data.source, clientRequestId: parsed.data.clientRequestId })
    return NextResponse.json({ review: toReviewRecord(result.row), replayed: result.replayed }, { status: result.replayed ? 200 : 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
