import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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

    return NextResponse.json({
      id: task.id,
      status: task.status,
      imageUrl: task.image_url,
      errorMessage: task.error_message,
      createdAt: task.created_at,
      updatedAt: task.updated_at,
    })

  } catch (error) {
    console.error('[NanoBanana Status] Erro:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 500 }
    )
  }
}
