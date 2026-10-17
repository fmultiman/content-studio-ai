import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createGalleryFakeDb, type Row } from './helpers/gallery-fake-db'
import { encodeGalleryCursor, filterFingerprint, GALLERY_OUTPUT_TYPES } from '@/lib/gallery/outputs'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/service-role', () => ({ createServiceRoleSupabaseOrNull: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { createServiceRoleSupabaseOrNull } from '@/lib/supabase/service-role'
import { GET } from '@/app/api/gallery/outputs/route'

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ME = u(1)
const OTHER = u(2)
const P1 = u(10)
const THEIR_PROJECT = u(12)
const PR1 = u(20)

let tables: Record<string, Row[]>
let failing: Set<string>
let signedIn: boolean
let serviceRole: 'ok' | 'missing' | 'throws'

beforeEach(() => {
  signedIn = true
  failing = new Set()
  serviceRole = 'ok'
  tables = {
    projects: [{ id: P1, user_id: ME, name: 'Portal Norte' }, { id: THEIR_PROJECT, user_id: OTHER, name: 'Alheio' }],
    productions: [{ id: PR1, user_id: ME, project_id: P1, title: 'Campanha', intention: null }],
    images: [{ id: u(101), user_id: ME, project_id: P1, user_input: 'Uma imagem', generated_prompt: null, status: 'draft', model: 'm', mime_type: 'image/png', created_at: '2026-10-01T10:00:00.000000Z', image_url: 'https://x', thumbnail_url: null, storage_path: `users/${ME}/images/${u(9)}/original.png`, thumbnail_path: null }],
    image_generation_attempts: [], image_drafts: [], library_files: [], video_drafts: [], channel_pieces: [], editorial_contents: [],
    video_generations: [{ id: u(401), user_id: ME, project_id: P1, production_id: PR1, session_id: null, mode: 'text_to_video', prompt: 'Um vídeo', provider: 'kling', model: 'k', status: 'succeeded', storage_path: `${ME}/videos/ai/${P1}/${u(401)}.mp4`, library_file_id: null, created_at: '2026-10-02T10:00:00.000000Z' }],
    render_executions: [],
  }
  vi.mocked(createClient).mockImplementation(async () => Object.assign(createGalleryFakeDb(tables, failing).db, {
    auth: { getUser: async () => ({ data: { user: signedIn ? { id: ME } : null }, error: null }) },
  }) as never)
  vi.mocked(createServiceRoleSupabaseOrNull).mockImplementation(() => {
    if (serviceRole === 'throws') throw new Error('not permitted locally')
    return serviceRole === 'ok' ? (createGalleryFakeDb(tables, failing).db as never) : null
  })
})

const call = (query = '') => GET(new Request(`http://localhost/api/gallery/outputs${query}`))

describe('GET /api/gallery/outputs', () => {
  it('requires a signed-in user', async () => {
    signedIn = false
    const response = await call()
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ code: 'UNAUTHORIZED' })
  })

  it('answers with the projection, never cached, with a typed identity per item', async () => {
    const response = await call()
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const body = await response.json()
    expect(body.items.map((item: Row) => item.key)).toEqual([`video_generation:${u(401)}`, `image:${u(101)}`])
    expect(body).toMatchObject({ partial: false, hasMore: false, nextCursor: null, limit: 48 })
    expect(Object.keys(body.sources).sort()).toEqual([...GALLERY_OUTPUT_TYPES].sort())
  })

  it('validates type, project, cursor and limit before touching data', async () => {
    expect((await call('?type=library_file')).status).toBe(400)
    expect((await call('?projectId=not-a-uuid')).status).toBe(400)
    expect((await call('?cursor=garbage')).status).toBe(400)
    const body = await (await call('?limit=100000')).json()
    expect(body.limit).toBe(100)
  })

  it('accepts repeated and comma separated type filters and filters across the whole collection', async () => {
    for (const query of ['?type=image', '?type=image&type=image']) {
      const body = await (await call(query)).json()
      expect(body.items.map((item: Row) => item.type)).toEqual(['image'])
      expect(body.sources.video_generation).toEqual({ state: 'skipped' })
    }
    const both = await (await call('?type=image,video_generation')).json()
    expect(both.items).toHaveLength(2)
  })

  it('a cursor belongs to the filters it was issued for', async () => {
    const cursor = encodeGalleryCursor(filterFingerprint(GALLERY_OUTPUT_TYPES, null), { image: { at: '2026-10-01T10:00:00.000000Z', id: u(101) } })
    const response = await call(`?type=image&cursor=${cursor}`)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'CURSOR_FILTER_MISMATCH' })
    expect((await call(`?cursor=${cursor}`)).status).toBe(200)
  })

  it('a pagination cursor continues the same collection without repeating', async () => {
    const first = await (await call('?limit=1')).json()
    expect(first.items).toHaveLength(1)
    expect(first.nextCursor).toBeTruthy()
    const second = await (await call(`?limit=1&cursor=${encodeURIComponent(first.nextCursor)}`)).json()
    expect(second.items.map((item: Row) => item.key)).toEqual([`image:${u(101)}`])
    expect(second.nextCursor).toBeNull()
  })

  it('rejects another user\'s Project as not found, and never reveals it', async () => {
    const response = await call(`?projectId=${THEIR_PROJECT}`)
    expect(response.status).toBe(404)
    expect(JSON.stringify(await response.json())).not.toContain('Alheio')
  })

  it('scopes to the caller\'s own Project', async () => {
    const body = await (await call(`?projectId=${P1}`)).json()
    expect(body.items).toHaveLength(2)
  })

  it('totals are opt-in and honest', async () => {
    expect((await (await call()).json()).totals).toBeUndefined()
    const body = await (await call('?totals=1')).json()
    expect(body.totals).toMatchObject({ globalExact: true, global: 2 })
  })

  it('a failing source degrades to 200 + partial; the cursor stays open; nothing from the database leaks', async () => {
    failing = new Set(['video_generations'])
    const response = await call()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.partial).toBe(true)
    expect(body.sources.video_generation).toEqual({ state: 'failed', code: 'VIDEO_GENERATIONS_UNAVAILABLE' })
    expect(body.items.map((item: Row) => item.type)).toEqual(['image'])
    expect(body.nextCursor).toBeTruthy()
    expect(JSON.stringify(body)).not.toContain('secret database detail')
  })

  it('a missing or locally-forbidden service role fails only the render sources', async () => {
    for (const mode of ['missing', 'throws'] as const) {
      serviceRole = mode
      const response = await call()
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.sources.video_render).toEqual({ state: 'failed', code: 'RENDER_SERVICE_UNAVAILABLE' })
      expect(body.sources.image).toMatchObject({ state: 'ok' })
      expect(body.partial).toBe(true)
    }
  })

  it('503 only when every selected source failed - and the body still says which and why', async () => {
    failing = new Set(['images', 'video_generations', 'render_executions'])
    const response = await call()
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body).toMatchObject({ code: 'ALL_SOURCES_FAILED', partial: true })
    expect(body.items).toEqual([])
    // A single selected source failing is "all selected failed" for that request, not a silent empty list.
    failing = new Set(['video_generations'])
    expect((await call('?type=video_generation')).status).toBe(503)
    expect((await call('?type=image')).status).toBe(200)
  })

  it('exposes no private storage information anywhere in the payload', async () => {
    tables.render_executions = [{ id: u(501), user_id: ME, project_id: P1, kind: 'video', status: 'completed', video_draft_id: u(601), completed_at: '2026-10-03T10:00:00.000000Z', output_bucket: 'private-bucket', output_storage_path: `users/${ME}/renders/scratch/${u(501)}/output.mp4`, output_mime_type: 'video/mp4', output_duration_ms: 1000, claimed_by: 'worker-1', input_snapshot: { token: 'frozen' } }]
    tables.video_drafts = [{ id: u(601), user_id: ME, project_id: P1, production_id: PR1, name: 'Teaser' }]
    const serialized = JSON.stringify(await (await call()).json())
    for (const forbidden of ['storage_path', 'output_storage_path', 'private-bucket', 'claimed_by', 'frozen', `users/${ME}`, `${ME}/videos`, 'https://', 'X-Amz']) expect(serialized).not.toContain(forbidden)
  })
})

describe('read-only boundary', () => {
  const source = (relative: string) => readFileSync(path.join(process.cwd(), relative), 'utf8')

  it('the read model and the route never write, sign or delete', () => {
    for (const file of ['lib/gallery/outputs.ts', 'lib/gallery/outputs-data.ts', 'app/api/gallery/outputs/route.ts']) {
      const code = source(file)
      for (const forbidden of [/\.insert\(/, /\.update\(/, /\.upsert\(/, /\.delete\(/, /\.rpc\(/, /createPresignedReadUrl/, /presignImageObject/, /@\/lib\/storage\//, /headS3Object|deleteS3Object|copyS3Object/]) {
        expect(code, `${file} ${forbidden}`).not.toMatch(forbidden)
      }
    }
  })

  it('the service role is confined to the route (handed to the loaders only for render_executions)', () => {
    expect(source('lib/gallery/outputs-data.ts')).not.toMatch(/from '@\/lib\/supabase\/service-role'/)
    expect(source('lib/gallery/outputs-data.ts').match(/renderDb/g)!.length).toBeGreaterThan(0)
    const data = source('lib/gallery/outputs-data.ts')
    for (const table of ['images', 'video_generations', 'productions', 'projects', 'library_files', 'image_generation_attempts', 'image_drafts', 'video_drafts', 'channel_pieces', 'editorial_contents']) {
      expect(data).not.toMatch(new RegExp(`renderDb[\\s\\S]{0,40}from\\('${table}'\\)`))
    }
  })

  it('the existing Gallery page, Arquivos and per-item endpoints are untouched by this step', () => {
    expect(source('app/(dashboard)/galeria/page.tsx')).not.toContain('/api/gallery/outputs')
    expect(source('app/api/gallery/video-outputs/route.ts')).toContain("'video_draft_id'")
  })
})
