import { createClient } from '@/lib/supabase/server'
import { resolveAuthCallbackRedirect } from '@/lib/auth/callback'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const supabase = await createClient()

  const location = await resolveAuthCallbackRedirect({
    origin,
    code: searchParams.get('code'),
    next: searchParams.get('next'),
    exchangeCodeForSession: (code) => supabase.auth.exchangeCodeForSession(code),
  })

  return NextResponse.redirect(location)
}
