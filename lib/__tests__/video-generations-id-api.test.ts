import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createFakeDb } from './helpers/fake-db'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import * as server from '@/lib/supabase/server'
import { GET } from '@/app/api/video-generations/[id]/route'

const USER_A = '11111111-1111-4111-8111-111111111111'
const USER_B = '22222222-2222-4222-8222-222222222222'
const PROJECT = '10000000-0000-0000-0000-000000000001'
const PROD_1 = '20000000-0000-0000-0000-000000000001'
const PROD_2 = '20000000-0000-0000-0000-000000000002'

const ID_A = '30000000-0000-0000-0000-000000000001'
const ID_B = '30000000-0000-0000-0000-000000000002'

function makeDb(generations: any[] = []) {
  return createFakeDb({
    seed: {
      video_generations: generations,
    },
  }) as any
}

function signIn(db: any, userId: string | null = USER_A) {
  vi.mocked(server.createClient).mockResolvedValue({
    from: (table: string) => db.from(table),
    auth: { getUser: vi.fn(async () => ({ data: { user: userId ? { id: userId } : null }, error: null })) },
  } as any)
}

function sampleRows() {
  return [
    {
      id: ID_A,
      user_id: USER_A,
      project_id: PROJECT,
      production_id: PROD_1,
      prompt: 'Prompt A',
      mode: 'text_to_video',
      model: 'kling-v1',
      transport: 'rest',
      connection_id: null,
      source_image_id: null,
      source_library_file_id: null,
      request_config: { duration: 5, resolution: '720p' },
      client_request_id: 'secret123',
    },
    {
      id: ID_B,
      user_id: USER_B,
      project_id: PROJECT,
      production_id: PROD_2,
      prompt: 'Prompt B',
      mode: 'image_to_video',
      model: 'kling-v1',
      transport: 'mcp',
      connection_id: 'acc1',
      source_image_id: null,
      source_library_file_id: 'lib123',
      request_config: {},
      client_request_id: 'secret456',
    },
  ]
}

async function getGeneration(id: string, searchParams: string = '') {
  const req = new NextRequest(`http://localhost/api/video-generations/${id}${searchParams}`)
  return GET(req, { params: Promise.resolve({ id }) })
}

describe('single-Attempt secure read endpoint', () => {
  let consoleError: any
  beforeEach(() => {
    vi.clearAllMocks()
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => consoleError.mockRestore())

  it('unauthenticated -> 401', async () => {
    const db = makeDb(sampleRows())
    signIn(db, null)
    const res = await getGeneration(ID_A, `?projectId=${PROJECT}&productionId=${PROD_1}`)
    expect(res.status).toBe(401)
  })

  it('missing projectId or productionId context -> 400', async () => {
    const db = makeDb(sampleRows())
    signIn(db, USER_A)

    const res1 = await getGeneration(ID_A, `?projectId=${PROJECT}`)
    expect(res1.status).toBe(400)

    const res2 = await getGeneration(ID_A, `?productionId=${PROD_1}`)
    expect(res2.status).toBe(400)

    const body = await res1.json()
    expect(body.code).toBe('MISSING_CONTEXT')
  })

  it('valid user + correct project + correct production -> 200', async () => {
    const db = makeDb(sampleRows())
    signIn(db, USER_A)

    const res = await getGeneration(ID_A, `?projectId=${PROJECT}&productionId=${PROD_1}`)
    expect(res.status).toBe(200)
  })

  it('correct user + WRONG project or production -> safe 404', async () => {
    const db = makeDb(sampleRows())
    signIn(db, USER_A)

    const res1 = await getGeneration(ID_A, `?projectId=10000000-0000-0000-0000-000000000099&productionId=${PROD_1}`)
    expect(res1.status).toBe(404)

    const res2 = await getGeneration(ID_A, `?projectId=${PROJECT}&productionId=${PROD_2}`)
    expect(res2.status).toBe(404)
  })

  it('foreign user -> safe 404', async () => {
    const db = makeDb(sampleRows())
    signIn(db, USER_A)
    const res = await getGeneration(ID_B, `?projectId=${PROJECT}&productionId=${PROD_2}`)
    expect(res.status).toBe(404)
  })

  it('response contains ONLY intended reusable fields (no user_id, no request_fingerprint, no credentials)', async () => {
    const db = makeDb(sampleRows())
    signIn(db, USER_A)

    const res = await getGeneration(ID_A, `?projectId=${PROJECT}&productionId=${PROD_1}`)
    const body = await res.json()

    const gen = body.generation
    expect(gen.id).toBe(ID_A)
    expect(gen.project_id).toBe(PROJECT)
    expect(gen.production_id).toBe(PROD_1)
    expect(gen.prompt).toBe('Prompt A')
    expect(gen.mode).toBe('text_to_video')
    expect(gen.model).toBe('kling-v1')
    expect(gen.transport).toBe('rest')
    expect(gen.request_config).toEqual({ duration: 5, resolution: '720p' })

    // Confirm absence of internal and sensitive fields
    expect(gen.user_id).toBeUndefined()
    expect(gen.client_request_id).toBeUndefined()
    expect(gen.request_fingerprint).toBeUndefined()
    expect(gen.task_id).toBeUndefined()
    expect(gen.provider_metadata).toBeUndefined()
  })
})
