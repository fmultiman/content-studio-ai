import { createClient } from '@/lib/supabase/server'
import type { ImageGenerationSessionRow } from './session'

export async function authenticateImageGenerationRequest() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  return { supabase, user: error || !user ? null : user }
}

export async function validateImageScope(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  projectId: string | null | undefined,
  productionId: string | null | undefined,
) {
  if (projectId) {
    const { data, error } = await supabase.from('projects').select('id').eq('id', projectId).eq('user_id', userId).maybeSingle()
    if (error) return { ok: false as const, status: 503, code: 'STORE_UNAVAILABLE', message: 'Project scope could not be verified.' }
    if (!data) return { ok: false as const, status: 403, code: 'PROJECT_NOT_FOUND', message: 'Project not found for this user.' }
  }
  if (productionId) {
    if (!projectId) return { ok: false as const, status: 400, code: 'PRODUCTION_REQUIRES_PROJECT', message: 'A production requires a project.' }
    const { data, error } = await supabase
      .from('productions').select('id').eq('id', productionId).eq('project_id', projectId).eq('user_id', userId).maybeSingle()
    if (error) return { ok: false as const, status: 503, code: 'STORE_UNAVAILABLE', message: 'Production scope could not be verified.' }
    if (!data) return { ok: false as const, status: 403, code: 'PRODUCTION_NOT_FOUND', message: 'Production not found for this project.' }
  }
  return { ok: true as const }
}

export function jsonError(NextResponse: typeof import('next/server').NextResponse, status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: message, code, ...extra }, { status })
}

export function asSessionRow(data: unknown) {
  return (data ?? null) as ImageGenerationSessionRow | null
}
