import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createRecordingSupabase, type Row } from './helpers/recording-supabase'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/image-generation/api', () => ({ authenticateImageGenerationRequest: vi.fn(), validateImageScope: vi.fn() }))
vi.mock('@/lib/supabase/service-role', () => ({ createServiceRoleSupabase: vi.fn(() => { throw new Error('write client requested') }) }))
vi.mock('@/lib/image-generation/session-thumbnails', () => ({ resolveSessionThumbnails: vi.fn(async () => new Map()) }))

import { createClient } from '@/lib/supabase/server'
import { authenticateImageGenerationRequest } from '@/lib/image-generation/api'
import { GET as imageSessions } from '@/app/api/image-generation-sessions/route'
import { GET as imageDrafts } from '@/app/api/image-drafts/route'
import { GET as videoDrafts } from '@/app/api/video-drafts/route'
import { GET as videoGenerations } from '@/app/api/video-generations/route'

const PROJECT = '11111111-1111-4111-8111-111111111111'
const PRODUCTION = '22222222-2222-4222-8222-222222222222'
let tables: Record<string, Row[]>
let failing: Set<string>
let signedIn: boolean

beforeEach(() => {
  tables = { image_generation_sessions: [], image_drafts: [], video_drafts: [] }
  failing = new Set()
  signedIn = true
  vi.mocked(createClient).mockImplementation(async () => Object.assign(createRecordingSupabase(tables, failing).supabase, {
    auth: { getUser: async () => ({ data: { user: signedIn ? { id: 'me' } : null }, error: null }) },
  }) as never)
  vi.mocked(authenticateImageGenerationRequest).mockImplementation(async () => ({
    supabase: createRecordingSupabase(tables, failing).supabase, user: signedIn ? { id: 'me' } : null,
  }) as never)
})
const req = (path: string) => new NextRequest(`http://localhost${path}`)
const draft = (id: string, user = 'me') => ({ id, user_id: user, project_id: PROJECT, production_id: PRODUCTION, updated_at: '2026-10-01' })

describe('bounded continuity list APIs', () => {
  it('image Sessions preserve optional scope, isolate owners and signal the existing 100-row cap', async () => {
    tables.image_generation_sessions = Array.from({ length: 101 }, (_, n) => ({ ...draft(`s${n}`), project_id: null, production_id: null, working_state: {}, status: 'active' }))
    tables.image_generation_sessions.push({ ...draft('foreign', 'other'), working_state: {} })
    let body = await (await imageSessions(req('/api/image-generation-sessions'))).json()
    expect(body.sessions).toHaveLength(100)
    expect(body.hasMore).toBe(true)
    expect(body.sessions.every((row: Row) => row.projectId === null && row.productionId === null)).toBe(true)
    body = await (await imageSessions(req(`/api/image-generation-sessions?projectId=${PROJECT}&productionId=${PRODUCTION}`))).json()
    expect(body).toMatchObject({ sessions: [], hasMore: false })
  })

  it('resolves legacy linkage independently of the visible Session slice and scope, without another owner hiding my draft', async () => {
    tables.image_drafts = [draft('linked'), draft('orphan'), draft('theirs', 'other')]
    tables.image_generation_sessions = [
      { ...draft('old-carrier'), legacy_image_draft_id: 'linked', project_id: null, production_id: null, status: 'archived' },
      { ...draft('foreign-carrier', 'other'), legacy_image_draft_id: 'orphan' },
    ]
    const body = await (await imageDrafts(req(`/api/image-drafts?productionId=${PRODUCTION}&continuity=true`))).json()
    expect(body.drafts.map((row: Row) => row.id)).toEqual(['linked', 'orphan'])
    expect(body.linkedLegacyDraftIds).toEqual(['linked'])
    expect(body.hasMore).toBe(false)
  })

  it('a failed link query marks linkage unknown while preserving readable drafts', async () => {
    tables.image_drafts = [draft('d1')]
    failing.add('image_generation_sessions')
    const body = await (await imageDrafts(req(`/api/image-drafts?productionId=${PRODUCTION}&continuity=true`))).json()
    expect(body.drafts).toHaveLength(1)
    expect(body.linkedLegacyDraftIds).toBeNull()
  })

  it('draft caps report truncation without changing the 200-row response limit', async () => {
    tables.image_drafts = Array.from({ length: 201 }, (_, n) => draft(`d${n}`))
    tables.video_drafts = [...tables.image_drafts]
    for (const response of [await imageDrafts(req(`/api/image-drafts?productionId=${PRODUCTION}&continuity=true`)), await videoDrafts(req(`/api/video-drafts?productionId=${PRODUCTION}`))]) {
      const body = await response.json()
      expect(body.drafts).toHaveLength(200)
      expect(body.hasMore).toBe(true)
    }
  })

  it('anonymous visitors cannot read any continuity list', async () => {
    signedIn = false
    expect((await imageSessions(req('/api/image-generation-sessions'))).status).toBe(401)
    expect((await imageDrafts(req(`/api/image-drafts?productionId=${PRODUCTION}&continuity=true`))).status).toBe(401)
    expect((await videoDrafts(req(`/api/video-drafts?productionId=${PRODUCTION}`))).status).toBe(401)
  })

  it('bounds the Production history only in continuity mode, preserves historical rows, and signals partial data', async () => {
    tables.video_generations = Array.from({ length: 205 }, (_, n) => ({ ...draft(`g${n}`), session_id: n === 0 ? null : 'session', status: 'failed', created_at: '2026-10-01', library_file_id: null }))
    const response = await videoGenerations(req(`/api/video-generations?productionId=${PRODUCTION}&continuity=true`))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.generations).toHaveLength(200)
    expect(body.generations.some((row: Row) => row.session_id === null)).toBe(true)
    expect(body.hasMore).toBe(true)
    const existing = await (await videoGenerations(req(`/api/video-generations?productionId=${PRODUCTION}`))).json()
    expect(existing.generations).toHaveLength(205)
    expect(existing).not.toHaveProperty('hasMore')
  })
})
