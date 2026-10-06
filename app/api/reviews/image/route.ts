import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isUuid, readBoundedJsonBody } from '@/lib/image-generation/session'
import { ReviewRequestSchema } from '@/lib/reviews/contracts'
import { ReviewServiceError } from '@/lib/reviews/errors'
import { createImageReviewExecution, getImageReviewHistory } from '@/lib/reviews/service'
import { toReviewRecord } from '@/lib/reviews/repository'

function errorResponse(error: unknown) {
  if (error instanceof ReviewServiceError) {
    return NextResponse.json({ error: error.message, code: error.code, ...error.details }, { status: error.status })
  }
  return NextResponse.json({ error: 'Review could not be completed.', code: 'REVIEW_INTERNAL_ERROR' }, { status: 500 })
}

async function authenticate() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  return { supabase, user: error ? null : user }
}

export async function GET(request: NextRequest) {
  try {
    const { supabase, user } = await authenticate()
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 })
    const attemptId = new URL(request.url).searchParams.get('attemptId')
    if (!attemptId || !isUuid(attemptId)) return NextResponse.json({ error: 'attemptId must be a UUID.', code: 'INVALID_ATTEMPT_ID' }, { status: 400 })
    const history = await getImageReviewHistory({ userId: user.id, attemptId, db: supabase })
    return NextResponse.json(history)
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await authenticate()
    if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 })
    const body = await readBoundedJsonBody(request, 16 * 1024)
    if (!body.ok) return NextResponse.json({ error: body.message, code: body.code }, { status: body.status })
    const parsed = ReviewRequestSchema.safeParse(body.body)
    if (!parsed.success) return NextResponse.json({ error: 'Invalid Review body.', code: 'INVALID_BODY', issues: parsed.error.issues }, { status: 400 })
    const result = await createImageReviewExecution({ userId: user.id, ...parsed.data })
    return NextResponse.json({ review: toReviewRecord(result.row), replayed: result.replayed }, { status: result.replayed ? 200 : 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
