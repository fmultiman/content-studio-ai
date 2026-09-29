import { createHash, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleSupabase } from '@/lib/supabase/service-role'
import { pollDueMcpGenerations } from '@/lib/video-generation/polling'

// VIDEO_GENERATION_CONNECTION_CAPABILITY_ROUTING_V1
//
// Server-to-server trigger for the MCP status poller. There is NO user session
// here: authentication is a shared secret (`CRON_SECRET`, sent by Vercel Cron
// as `Authorization: Bearer <secret>`, or by any other scheduler). It fails
// CLOSED: without a configured secret the route does nothing (503), and a wrong
// or missing header is rejected (401) before any database access.
//
// Response: counts only. It never returns generation ids, prompts, provider
// text or anything token-related.

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MIN_SECRET_LENGTH = 16

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

function isAuthorized(header: string | null, secret: string): boolean {
  if (!header) return false
  // Compare fixed-length digests so neither length nor content leaks via timing.
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`))
}

async function handle(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    return NextResponse.json({ error: 'Polling trigger is not configured.', code: 'CRON_NOT_CONFIGURED' }, { status: 503 })
  }

  if (!isAuthorized(request.headers.get('authorization'), secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const summary = await pollDueMcpGenerations(createServiceRoleSupabase())
    return NextResponse.json({ ok: true, ...summary }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[Video poll] failed:', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ error: 'Polling failed', code: 'POLL_FAILED' }, { status: 500 })
  }
}

// Vercel Cron issues GET; POST is accepted for other schedulers and manual runs.
export const GET = handle
export const POST = handle
