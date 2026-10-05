import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ATTEMPT_COLUMNS, type ImageGenerationAttemptRow } from '@/lib/image-generation/attempt'
import { syncNanoImageAttempt, ImageSubmissionError } from '@/lib/image-generation/execution'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params
    
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    }

    const { data: task, error } = await supabase
      .from('generation_tasks')
      .select('id, status, image_url, error_message, created_at, updated_at')
      .eq('id', taskId)
      .eq('user_id', user.id)
      .single()

    if (error || !task) {
      return NextResponse.json({ error: 'Task não encontrada' }, { status: 404 })
    }

    // Canonical workspace tasks are bound to an immutable Attempt. Legacy
    // callers still receive the original task response below.
    const { data: attempt } = await supabase
      .from('image_generation_attempts')
      .select(ATTEMPT_COLUMNS)
      .eq('provider_task_id', task.id)
      .eq('user_id', user.id)
      .maybeSingle()
    const attemptRow = attempt as unknown as ImageGenerationAttemptRow | null
    let canonical: Awaited<ReturnType<typeof syncNanoImageAttempt>> | null = null
    if (attemptRow) {
      try {
        canonical = await syncNanoImageAttempt(attemptRow)
      } catch (syncError) {
        if (syncError instanceof ImageSubmissionError) {
          return NextResponse.json({ error: syncError.message, code: syncError.code, attemptId: attemptRow.id }, { status: syncError.status })
        }
        throw syncError
      }
    }

    return NextResponse.json({
      id: task.id,
      status: task.status,
      imageUrl: task.image_url,
      errorMessage: task.error_message,
      createdAt: task.created_at,
      updatedAt: task.updated_at,
      attemptId: attemptRow?.id || null,
      attemptStatus: canonical?.status || attemptRow?.status || null,
      image: canonical?.image || null,
      replayed: canonical?.replayed || false,
    })

  } catch (error) {
    console.error('[NanoBanana Status] Erro:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 500 }
    )
  }
}
