/**
 * Phase 2I — Production Video Operational Closure (Task B1).
 *
 * GET /api/gallery/video-outputs closes the Gallery 403: the browser had no
 * SELECT policy on render_executions (intentional), so the page's direct
 * Supabase query always failed in production. This route is the narrow,
 * server-authoritative replacement. Source-regex tests, matching this repo's
 * existing convention for Next.js route handlers (see output-url-route.test.ts).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('GET /api/gallery/video-outputs', () => {
  const routeSource = readFileSync(
    join(process.cwd(), 'app', 'api', 'gallery', 'video-outputs', 'route.ts'),
    'utf-8',
  )

  it('authenticates the current Supabase user server-side', () => {
    expect(routeSource).toMatch(/supabase\.auth\.getUser\(\)/)
    expect(routeSource).toMatch(/return NextResponse\.json\(\{ error: 'Nao autorizado' \}, \{ status: 401 \}\)/)
  })

  it('reads render_executions through the service-role client, never the browser session client', () => {
    expect(routeSource).toMatch(/createServiceRoleClient/)
    expect(routeSource).toMatch(/createRenderExecutionReadClient/)
  })

  it('scopes results to the authenticated user only', () => {
    expect(routeSource).toMatch(/\.eq\('user_id', user\.id\)/)
  })

  it('returns only completed executions — queued/claimed/failed are excluded', () => {
    expect(routeSource).toMatch(/\.eq\('status', 'completed'\)/)
  })

  it('projects a safe column set only — no worker internals, no input snapshot, no storage path', () => {
    const safeColumnsLine = routeSource.match(/const SAFE_COLUMNS = \[([\s\S]*?)\]\.join/)
    expect(safeColumnsLine).not.toBeNull()
    const forbidden = [
      'claimed_by',
      'lease_expires_at',
      'input_snapshot',
      'output_storage_path',
      'output_bucket',
      'error_detail',
      'idempotency_key',
    ]
    for (const column of forbidden) {
      expect(safeColumnsLine![1].includes(column)).toBe(false)
    }
    expect(routeSource).toMatch(/'id', 'video_draft_id', 'status', 'queued_at', 'completed_at'/)
  })

  it('never accepts a caller-supplied videoDraftId or arbitrary filter — always scoped to the caller', () => {
    expect(routeSource).not.toMatch(/searchParams/)
  })
})
