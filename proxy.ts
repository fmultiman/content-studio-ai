import { updateSession } from '@/lib/supabase/middleware'
import { NextResponse, type NextRequest } from 'next/server'
import { legacyVideoAuthoringRedirect } from '@/lib/creative/video-editor/video-routes'

export async function proxy(request: NextRequest) {
  // VideoDraft single writer: the legacy /videos?draft= authoring workspace
  // hands off to the canonical Creative Editor. The target is itself a
  // protected route whose draft load is ownership-scoped, so this never
  // bypasses authentication or draft access checks.
  const legacyTarget = legacyVideoAuthoringRedirect(request.nextUrl.pathname, request.nextUrl.searchParams)
  if (legacyTarget) return NextResponse.redirect(new URL(legacyTarget, request.url))
  return await updateSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
