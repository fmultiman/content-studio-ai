import { createHash, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleSupabase } from '@/lib/supabase/service-role'
import { pollDueMcpGenerations } from '@/lib/video-generation/polling'

// VIDEO_GENERATION_CONNECTION_CAPABILITY_ROUTING_V1
//
// Server-to-server trigger for the MCP status poller. The scheduler is an
// EXTERNAL always-on host (the project's VPS) that calls this endpoint about
// every 10 s (VIDEO_GENERATION_POLLING_LATENCY_V1; a wake with nothing due makes no
// provider call — each job's own `next_poll_at` governs provider traffic); this route
// only *executes* one bounded polling pass. There is
// no user session here. Authentication is a dedicated shared secret,
// `VIDEO_POLL_WORKER_SECRET`, supplied out-of-band to Vercel Production and to the
// scheduler (never generated, logged or returned by the application):
//
//     POST /api/internal/video-generations/poll
//     Authorization: Bearer <VIDEO_POLL_WORKER_SECRET>
//
// It fails CLOSED: without a configured secret the route does nothing (503);
// a wrong or missing header is rejected (401) before any database access; only
// POST exists (no GET, so it is not triggerable by a link or a prefetch).
//
// Overlapping or repeated calls are safe: every due row is LEASED with a
// compare-and-swap, so two passes never check the same job twice.
//
// Response: counts only. It never returns generation ids, prompts, provider
// text or anything token-related.

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MIN_SECRET_LENGTH = 32

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

function isAuthorized(header: string | null, secret: string): boolean {
  if (!header) return false
  // Compare fixed-length digests so neither length nor content leaks via timing.
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`))
}

export async function POST(request: NextRequest) {
  const secret = process.env.VIDEO_POLL_WORKER_SECRET
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    return NextResponse.json({ error: 'Polling trigger is not configured.', code: 'VIDEO_POLL_WORKER_NOT_CONFIGURED' }, { status: 503 })
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
