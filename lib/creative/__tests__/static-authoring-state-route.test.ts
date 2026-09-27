/**
 * Slice 1 — Portal Carousel V1: static-authoring-state persistence route.
 * Follows this repo's existing route-testing convention (source assertions
 * against the compiled TS, e.g. lib/render-execution/__tests__/output-url-route.test.ts)
 * rather than a full Supabase-mocked integration harness.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('Static Authoring State route', () => {
  const routeSource = readFileSync(
    join(process.cwd(), 'app', 'api', 'creative', 'static-authoring-state', 'route.ts'),
    'utf-8',
  )

  it('authenticates the current Supabase user on both GET and PUT', () => {
    const authChecks = routeSource.match(/supabase\.auth\.getUser\(\)/g) ?? []
    expect(authChecks.length).toBeGreaterThanOrEqual(2)
    expect(routeSource).toMatch(/return NextResponse\.json\(\{ error: 'Nao autorizado' \}, \{ status: 401 \}\)/)
  })

  it('validates channelPieceId as a UUID before touching the database', () => {
    expect(routeSource).toMatch(/UUID_RE\.test\(channelPieceId\)/)
    expect(routeSource).toMatch(/UUID_RE\.test\(body\.channelPieceId\)/)
  })

  it('verifies ChannelPiece ownership before read or write', () => {
    expect(routeSource).toMatch(/ownedChannelPiece\(supabase, channelPieceId, user\.id\)/)
    expect(routeSource).toMatch(/ownedChannelPiece\(supabase, body\.channelPieceId, user\.id\)/)
    // CREATIVE_EDITOR_FREE_DEFAULT_AND_TEMPLATE_ENTRY_V1: the format is read for the single-piece cardinality rule.
    expect(routeSource).toMatch(/from\('channel_pieces'\)\.select\('id, format'\)\.eq\('id', channelPieceId\)\.eq\('user_id', userId\)/)
  })

  it('validates the request body against StaticAuthoringStateSchema before persisting', () => {
    expect(routeSource).toMatch(/StaticAuthoringStateSchema\.safeParse\(raw\)/)
  })

  it('upserts by channel_piece_id — one row per ChannelPiece, never a growing history', () => {
    expect(routeSource).toMatch(/\.upsert\(/)
    expect(routeSource).toMatch(/onConflict: 'channel_piece_id'/)
  })

  it('scopes both read and write queries to the authenticated user, never a bare channelPieceId lookup', () => {
    expect(routeSource).toMatch(/\.eq\('channel_piece_id', channelPieceId\)\s*\n\s*\.eq\('user_id', user\.id\)/)
    expect(routeSource).toMatch(/user_id: user\.id,\s*\n\s*channel_piece_id: body\.channelPieceId,/)
  })

  it('never returns a rendered PNG, a LibraryFile, or a ChannelPieceMedia row from this route', () => {
    expect(routeSource).not.toMatch(/image_data_url/)
    expect(routeSource).not.toMatch(/library_files/)
    expect(routeSource).not.toMatch(/channel_piece_media/)
  })
})
