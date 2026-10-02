import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadHandoffTargets, resolveHandoffLibraryFile, resolveReceivedMedia } from '@/lib/library/handoff'

// GENERATED_MEDIA_TO_CREATIVE_EDITOR_HANDOFF_V1 — the server authority. An in-memory table fake applies the
// real .eq/.is/.in filters, so cross-user / cross-Project / trashed rows are genuinely excluded by the query,
// and every write attempt would be recorded (there must be none).

vi.mock('@/lib/storage/library-storage', () => ({
  presignLibraryRead: vi.fn(async (file: { storage_path: string }) => `https://signed.example/${file.storage_path}`),
}))

type Row = Record<string, unknown>

class Query {
  private filters: Array<(row: Row) => boolean> = []
  private ordering: { column: string; ascending: boolean } | null = null
  private max: number | null = null
  constructor(private table: string, private tables: Record<string, Row[]>, private log: { reads: string[]; writes: string[] }) {
    log.reads.push(table)
  }
  select() { return this }
  eq(column: string, value: unknown) { this.filters.push((row) => row[column] === value); return this }
  is(column: string, value: null) { this.filters.push((row) => (value === null ? row[column] == null : row[column] === value)); return this }
  in(column: string, values: unknown[]) { this.filters.push((row) => values.includes(row[column])); return this }
  order(column: string, options?: { ascending?: boolean }) { this.ordering = { column, ascending: options?.ascending ?? true }; return this }
  limit(count: number) { this.max = count; return this }
  insert() { this.log.writes.push(`${this.table}.insert`); return this }
  update() { this.log.writes.push(`${this.table}.update`); return this }
  upsert() { this.log.writes.push(`${this.table}.upsert`); return this }
  delete() { this.log.writes.push(`${this.table}.delete`); return this }
  private rows(): Row[] {
    let rows = (this.tables[this.table] ?? []).filter((row) => this.filters.every((filter) => filter(row)))
    if (this.ordering) {
      const { column, ascending } = this.ordering
      rows = [...rows].sort((a, b) => (String(a[column]) < String(b[column]) ? -1 : 1) * (ascending ? 1 : -1))
    }
    return this.max === null ? rows : rows.slice(0, this.max)
  }
  async maybeSingle() { return { data: this.rows()[0] ?? null, error: null } }
  then<T>(resolve: (value: { data: Row[]; error: null }) => T) { return Promise.resolve({ data: this.rows(), error: null }).then(resolve) }
}

function fake(tables: Record<string, Row[]>) {
  const log = { reads: [] as string[], writes: [] as string[] }
  return { log, client: { from: (table: string) => new Query(table, tables, log) } as unknown as SupabaseClient }
}

const ME = '00000000-0000-4000-8000-0000000000aa'
const OTHER = '00000000-0000-4000-8000-0000000000bb'
const P1 = '10000000-0000-4000-8000-000000000001'
const P2 = '10000000-0000-4000-8000-000000000002'
const PROD_A = '20000000-0000-4000-8000-00000000000a'
const PROD_B = '20000000-0000-4000-8000-00000000000b'
const FILE = '30000000-0000-4000-8000-000000000001'
const UUID = '40000000-0000-4000-8000-000000000001'

// Same shape the Static Editor accepts (normalizeProjectIdentity returns it): a versioned identity with content.
const VALID_IDENTITY = { schema_version: 1, foundation: { purpose: 'Existir para iluminar.' } }

const libraryFile = (overrides: Row = {}): Row => ({
  id: FILE, user_id: ME, project_id: P1, production_id: PROD_A, name: 'gerada.png', kind: 'image', mime_type: 'image/png',
  storage_path: `users/${ME}/library/${UUID}/gerada.png`, public_url: 'https://stored.example/x', thumbnail_url: null, deleted_at: null, ...overrides,
})

const baseTables = (): Record<string, Row[]> => ({
  projects: [{ id: P1, user_id: ME, identity: VALID_IDENTITY }, { id: P2, user_id: ME, identity: VALID_IDENTITY }],
  productions: [
    { id: PROD_A, project_id: P1, user_id: ME, title: 'Production A' },
    { id: PROD_B, project_id: P1, user_id: ME, title: 'Production B' },
  ],
  library_files: [libraryFile()],
  editorial_contents: [
    { id: 'ec-a', project_id: P1, user_id: ME, production_id: PROD_A, title: 'Conteúdo A', updated_at: '2026-01-02' },
    { id: 'ec-b', project_id: P1, user_id: ME, production_id: PROD_B, title: 'Conteúdo B', updated_at: '2026-01-03' },
    { id: 'ec-null', project_id: P1, user_id: ME, production_id: null, title: 'Conteúdo sem Production', updated_at: '2026-01-01' },
    { id: 'ec-p2', project_id: P2, user_id: ME, production_id: null, title: 'Outro Projeto', updated_at: '2026-01-04' },
    { id: 'ec-foreign', project_id: P1, user_id: OTHER, production_id: null, title: 'De outro usuário', updated_at: '2026-01-05' },
  ],
  channel_pieces: [
    { id: 'cp-a-carousel', editorial_content_id: 'ec-a', user_id: ME, channel: 'instagram', format: 'carousel', title: 'Carrossel A', created_at: '1' },
    { id: 'cp-a-reel', editorial_content_id: 'ec-a', user_id: ME, channel: 'instagram', format: 'reel', title: 'Reel A', created_at: '2' },
    { id: 'cp-b-post', editorial_content_id: 'ec-b', user_id: ME, channel: 'linkedin', format: 'post', title: null, created_at: '3' },
    { id: 'cp-b-short', editorial_content_id: 'ec-b', user_id: ME, channel: 'youtube', format: 'short', title: 'Short B', created_at: '4' },
    { id: 'cp-b-desc', editorial_content_id: 'ec-b', user_id: ME, channel: 'youtube', format: 'video_description', title: 'Desc', created_at: '5' },
    { id: 'cp-null-story', editorial_content_id: 'ec-null', user_id: ME, channel: 'instagram', format: 'story', title: 'Story', created_at: '6' },
    { id: 'cp-p2', editorial_content_id: 'ec-p2', user_id: ME, channel: 'instagram', format: 'post', title: 'Peça de outro Projeto', created_at: '7' },
    { id: 'cp-foreign', editorial_content_id: 'ec-foreign', user_id: OTHER, channel: 'instagram', format: 'post', title: 'Peça alheia', created_at: '8' },
  ],
  video_drafts: [
    { id: 'vd-b', project_id: P1, user_id: ME, production_id: PROD_B, name: 'Rascunho B', updated_at: '2026-02-03' },
    { id: 'vd-a', project_id: P1, user_id: ME, production_id: PROD_A, name: 'Rascunho A', updated_at: '2026-02-01' },
    { id: 'vd-null', project_id: P1, user_id: ME, production_id: null, name: 'Rascunho sem Production', updated_at: '2026-02-02' },
    { id: 'vd-p2', project_id: P2, user_id: ME, production_id: null, name: 'Rascunho de outro Projeto', updated_at: '2026-02-04' },
    { id: 'vd-noproject', project_id: null, user_id: ME, production_id: null, name: 'Sem Projeto', updated_at: '2026-02-05' },
    { id: 'vd-foreign', project_id: P1, user_id: OTHER, production_id: null, name: 'Rascunho alheio', updated_at: '2026-02-06' },
  ],
})

let tables: Record<string, Row[]>
beforeEach(() => { tables = baseTables() })

describe('resolveHandoffLibraryFile — the single validation of a handoff media', () => {
  it('accepts an owned, active, trusted-path file of an owned Project', async () => {
    const { client, log } = fake(tables)
    const result = await resolveHandoffLibraryFile(client, ME, FILE)
    expect(result).toMatchObject({ ok: true, projectId: P1 })
    expect(log.writes).toEqual([])
  })

  it.each([
    ['unknown id', () => tables, '40000000-0000-4000-8000-0000000000ff', ME, 'NOT_FOUND'],
    ['a foreign user\'s file', () => tables, FILE, OTHER, 'NOT_FOUND'],
    ['a deleted (trashed) file', () => { tables.library_files = [libraryFile({ deleted_at: '2026-01-01T00:00:00Z' })]; return tables }, FILE, ME, 'NOT_FOUND'],
    ['a storage path outside the owner\'s Library namespace', () => { tables.library_files = [libraryFile({ storage_path: `users/${OTHER}/library/${UUID}/gerada.png` })]; return tables }, FILE, ME, 'NOT_FOUND'],
    ['a storage path claim that is a URL', () => { tables.library_files = [libraryFile({ storage_path: 'https://evil.example/a.png' })]; return tables }, FILE, ME, 'NOT_FOUND'],
    ['a file whose Project is not the owner\'s', () => { tables.projects = []; return tables }, FILE, ME, 'NOT_FOUND'],
    ['a file without a Project', () => { tables.library_files = [libraryFile({ project_id: null })]; return tables }, FILE, ME, 'NO_PROJECT'],
    ['a malformed id', () => tables, 'not-a-uuid', ME, 'INVALID_REQUEST'],
  ])('rejects %s', async (_label, setup, id, user, code) => {
    const { client, log } = fake(setup())
    const result = await resolveHandoffLibraryFile(client, user, id)
    expect(result).toEqual({ ok: false, code })
    expect(log.writes).toEqual([])
  })
})

describe('resolveReceivedMedia — the receiving editor revalidates (the Project is derived from the real target, never claimed)', () => {
  const VD_P1 = '50000000-0000-4000-8000-000000000001'
  const VD_P2 = '50000000-0000-4000-8000-000000000002'
  const EC_P1 = '60000000-0000-4000-8000-000000000001'
  const CP_P1 = '70000000-0000-4000-8000-000000000001'
  const withTargets = () => {
    tables.video_drafts.push({ id: VD_P1, project_id: P1, user_id: ME, production_id: null, name: 'V1', updated_at: '1' }, { id: VD_P2, project_id: P2, user_id: ME, production_id: null, name: 'V2', updated_at: '1' })
    tables.editorial_contents.push({ id: EC_P1, project_id: P1, user_id: ME, production_id: null, title: 'EC', updated_at: '1' })
    tables.channel_pieces.push({ id: CP_P1, editorial_content_id: EC_P1, user_id: ME, channel: 'instagram', format: 'post', title: 'Post', created_at: '1' })
  }
  const video = (draftId: string) => ({ editor: 'video' as const, draftId })
  const staticTarget = (projectId: string) => ({ editor: 'static' as const, projectId, editorialContentId: EC_P1, channelPieceId: CP_P1 })
  beforeEach(withTargets)

  it('Static route authority is unchanged: an identity-less Project still resolves a received Static target (the chooser, not this authority, applies the readiness gate)', async () => {
    tables.projects = [{ id: P1, user_id: ME, identity: null }, { id: P2, user_id: ME, identity: null }]
    const { client } = fake(tables)
    const result = await resolveReceivedMedia(client, ME, { fileId: FILE, target: staticTarget(P1) })
    expect(result.ok).toBe(true)
  })

  it('returns a list-shaped, signed row for a same-Project image in either editor', async () => {
    for (const target of [video(VD_P1), staticTarget(P1)]) {
      const { client, log } = fake(tables)
      const result = await resolveReceivedMedia(client, ME, { fileId: FILE, target })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.file.public_url).toBe(`https://signed.example/users/${ME}/library/${UUID}/gerada.png`)
        expect(result.file.id).toBe(FILE)
      }
      expect(log.writes).toEqual([])
    }
  })

  it('rejects a LibraryFile whose Project differs from the target Project (cross-Project handoff is forbidden)', async () => {
    const { client } = fake(tables)
    expect(await resolveReceivedMedia(client, ME, { fileId: FILE, target: video(VD_P2) })).toEqual({ ok: false, code: 'PROJECT_MISMATCH' })
  })

  it('a forged Project that is not the Project of the real Static chain is rejected before any file is read', async () => {
    // File in P1, chain in P1, but the browser says Project P2: the chain does not belong to P2.
    const { client, log } = fake(tables)
    expect(await resolveReceivedMedia(client, ME, { fileId: FILE, target: staticTarget(P2) })).toEqual({ ok: false, code: 'TARGET_NOT_FOUND' })
    expect(log.reads).not.toContain('library_files')
  })

  it('a deleted file is rejected as not found (stale handoff)', async () => {
    tables.library_files = [libraryFile({ deleted_at: '2026-01-01T00:00:00Z' })]
    const { client } = fake(tables)
    expect(await resolveReceivedMedia(client, ME, { fileId: FILE, target: video(VD_P1) })).toEqual({ ok: false, code: 'NOT_FOUND' })
  })

  it('video: Video editor yes, Static editor no', async () => {
    tables.library_files = [libraryFile({ kind: 'video', mime_type: 'video/mp4', name: 'clipe.mp4' })]
    const { client } = fake(tables)
    expect((await resolveReceivedMedia(client, ME, { fileId: FILE, target: video(VD_P1) })).ok).toBe(true)
    expect(await resolveReceivedMedia(client, ME, { fileId: FILE, target: staticTarget(P1) })).toEqual({ ok: false, code: 'UNSUPPORTED_KIND' })
  })

  it.each([
    ['audio', { kind: 'audio', mime_type: 'audio/mpeg' }],
    ['document', { kind: 'document', mime_type: 'application/pdf' }],
    ['svg', { kind: 'image', mime_type: 'image/svg+xml' }],
  ])('%s is unsupported in both editors', async (_label, overrides) => {
    tables.library_files = [libraryFile(overrides)]
    const { client } = fake(tables)
    for (const target of [video(VD_P1), staticTarget(P1)]) {
      expect(await resolveReceivedMedia(client, ME, { fileId: FILE, target })).toEqual({ ok: false, code: 'UNSUPPORTED_KIND' })
    }
  })

  it('refuses a missing or malformed target (an id the URL carries is never a Project)', async () => {
    const { client } = fake(tables)
    expect(await resolveReceivedMedia(client, ME, { fileId: FILE, target: video('') })).toEqual({ ok: false, code: 'INVALID_REQUEST' })
    expect(await resolveReceivedMedia(client, ME, { fileId: FILE, target: video('vd-a') })).toEqual({ ok: false, code: 'INVALID_REQUEST' })
    expect(await resolveReceivedMedia(client, ME, { fileId: FILE, target: { editor: 'static', projectId: P1, editorialContentId: '', channelPieceId: '' } })).toEqual({ ok: false, code: 'INVALID_REQUEST' })
  })
})

describe('loadHandoffTargets — existing, compatible, same-Project targets', () => {
  const resolved = async (client: SupabaseClient) => {
    const result = await resolveHandoffLibraryFile(client, ME, FILE)
    if (!result.ok) throw new Error('fixture must resolve')
    return result
  }

  it('image: lists Static + Video targets of the file\'s Project only (no foreign user, no other Project)', async () => {
    const { client } = fake(tables)
    const targets = await loadHandoffTargets(client, ME, await resolved(client))
    const staticIds = targets.static.items.map((item) => item.channelPieceId)
    expect(staticIds).toEqual(expect.arrayContaining(['cp-a-carousel', 'cp-b-post', 'cp-null-story']))
    expect(staticIds).not.toContain('cp-p2')
    expect(staticIds).not.toContain('cp-foreign')
    expect(targets.video.items.map((item) => item.draftId)).toEqual(expect.arrayContaining(['vd-a', 'vd-b', 'vd-null']))
    for (const excluded of ['vd-p2', 'vd-noproject', 'vd-foreign']) expect(targets.video.items.map((item) => item.draftId)).not.toContain(excluded)
  })

  it('applies the exact Static Editor eligibility: Reel / Short / video_description pieces are never offered', async () => {
    const { client } = fake(tables)
    const targets = await loadHandoffTargets(client, ME, await resolved(client))
    const staticIds = targets.static.items.map((item) => item.channelPieceId)
    for (const excluded of ['cp-a-reel', 'cp-b-short', 'cp-b-desc']) expect(staticIds).not.toContain(excluded)
  })

  it('uses real names: ChannelPiece title (falling back to the EditorialContent title), format label, Production title', async () => {
    const { client } = fake(tables)
    const targets = await loadHandoffTargets(client, ME, await resolved(client))
    expect(targets.static.items.find((item) => item.channelPieceId === 'cp-a-carousel')).toMatchObject({
      title: 'Carrossel A', editorialContentTitle: 'Conteúdo A', formatLabel: 'Instagram Carousel', productionTitle: 'Production A',
    })
    expect(targets.static.items.find((item) => item.channelPieceId === 'cp-b-post')).toMatchObject({ title: 'Conteúdo B', productionTitle: 'Production B' })
    expect(targets.video.items.find((item) => item.draftId === 'vd-null')).toMatchObject({ name: 'Rascunho sem Production', productionTitle: null })
  })

  it('Production is context: same-Production first, a different Production and a NULL Production stay available', async () => {
    const { client } = fake(tables)
    const targets = await loadHandoffTargets(client, ME, await resolved(client))
    expect(targets.static.items[0].productionId).toBe(PROD_A)
    expect(targets.video.items[0].draftId).toBe('vd-a')
    expect(targets.video.items.map((item) => item.productionId)).toEqual(expect.arrayContaining([PROD_B, null]))
    expect(targets.file).toMatchObject({ productionId: PROD_A, productionTitle: 'Production A', projectId: P1 })
  })

  it('a LibraryFile with NULL production_id is usable in its Project (nothing is prioritized, nothing is dropped)', async () => {
    tables.library_files = [libraryFile({ production_id: null })]
    const { client } = fake(tables)
    const targets = await loadHandoffTargets(client, ME, await resolved(client))
    expect(targets.file.productionId).toBeNull()
    expect(targets.video.items).toHaveLength(3)
    expect(targets.static.items.length).toBeGreaterThan(0)
  })

  it('video: Video targets only — the Static families is not even queried', async () => {
    tables.library_files = [libraryFile({ kind: 'video', mime_type: 'video/mp4' })]
    const { client, log } = fake(tables)
    const targets = await loadHandoffTargets(client, ME, await resolved(client))
    expect(targets.static.items).toEqual([])
    expect(targets.video.items.length).toBe(3)
    expect(log.reads).not.toContain('editorial_contents')
    expect(log.reads).not.toContain('channel_pieces')
  })

  it('an unsupported kind has no target and triggers no target query', async () => {
    tables.library_files = [libraryFile({ kind: 'audio', mime_type: 'audio/mpeg' })]
    const { client, log } = fake(tables)
    const targets = await loadHandoffTargets(client, ME, await resolved(client))
    expect(targets.static.items).toEqual([])
    expect(targets.video.items).toEqual([])
    expect(log.reads).not.toContain('video_drafts')
  })

  it('a Project without authoring targets yields truthful empty families (nothing is created)', async () => {
    tables.editorial_contents = []
    tables.channel_pieces = []
    tables.video_drafts = []
    const { client, log } = fake(tables)
    const targets = await loadHandoffTargets(client, ME, await resolved(client))
    expect(targets.static).toEqual({ items: [], truncated: false })
    expect(targets.video).toEqual({ items: [], truncated: false })
    expect(log.writes).toEqual([])
  })

  it('builds identity-only navigation for every target', async () => {
    const { client } = fake(tables)
    const targets = await loadHandoffTargets(client, ME, await resolved(client))
    expect(targets.static.items.find((item) => item.channelPieceId === 'cp-a-carousel')?.href).toBe(`/projetos/${P1}/conteudos/ec-a/channel-pieces/cp-a-carousel/editar-visual?media=${FILE}`)
    expect(targets.video.items.find((item) => item.draftId === 'vd-a')?.href).toBe(`/creative-editor/video/vd-a?media=${FILE}`)
    for (const href of [...targets.static.items, ...targets.video.items].map((item) => item.href)) expect(href).not.toMatch(/X-Amz|storage|https?:\/\//)
  })

  it('uses a constant number of queries however many targets exist (no N+1) and never writes', async () => {
    for (let index = 0; index < 40; index += 1) {
      tables.editorial_contents.push({ id: `ec-x${index}`, project_id: P1, user_id: ME, production_id: null, title: `EC ${index}`, updated_at: `2026-03-${String(index + 1).padStart(2, '0')}` })
      tables.channel_pieces.push({ id: `cp-x${index}`, editorial_content_id: `ec-x${index}`, user_id: ME, channel: 'instagram', format: 'post', title: `Peça ${index}`, created_at: `9${index}` })
      tables.video_drafts.push({ id: `vd-x${index}`, project_id: P1, user_id: ME, production_id: null, name: `Draft ${index}`, updated_at: `2026-04-${String(index + 1).padStart(2, '0')}` })
    }
    const { client, log } = fake(tables)
    const targets = await loadHandoffTargets(client, ME, await resolved(client))
    expect(targets.static.items.length).toBeGreaterThan(40)
    const before = log.reads.length
    expect(log.reads.slice(before - 5)).toEqual(expect.arrayContaining(['productions', 'projects', 'editorial_contents', 'video_drafts', 'channel_pieces']))
    expect(log.reads.filter((table) => table === 'channel_pieces')).toHaveLength(1)
    expect(log.writes).toEqual([])
  })
})

describe('loadHandoffTargets — Static Editor readiness (Project Identity) gates Static targets only', () => {
  const resolved = async (client: SupabaseClient) => {
    const result = await resolveHandoffLibraryFile(client, ME, FILE)
    if (!result.ok) throw new Error('fixture must resolve')
    return result
  }

  it('valid Project Identity: Static targets are listed with no block reason', async () => {
    const { client } = fake(tables)
    const targets = await loadHandoffTargets(client, ME, await resolved(client))
    expect(targets.static.items.length).toBeGreaterThan(0)
    expect(targets.static.blockedReason).toBeUndefined()
  })

  it.each([
    ['missing (null)', null],
    ['missing (undefined)', undefined],
    ['empty string', ''],
    ['empty object', {}],
    ['structurally invalid (wrong schema_version)', { schema_version: 2, foundation: { purpose: 'x' } }],
    ['structurally invalid (not an object)', 'texto'],
  ])('%s Project Identity: NO Static target is listed, Video targets stay listed', async (_label, identity) => {
    tables.projects = [{ id: P1, user_id: ME, identity }, { id: P2, user_id: ME, identity: VALID_IDENTITY }]
    const { client, log } = fake(tables)
    const targets = await loadHandoffTargets(client, ME, await resolved(client))
    expect(targets.static.items).toEqual([])
    expect(targets.static.blockedReason).toBe('PROJECT_IDENTITY_REQUIRED')
    expect(targets.video.items.map((item) => item.draftId)).toEqual(expect.arrayContaining(['vd-a', 'vd-b', 'vd-null']))
    expect(targets.video.blockedReason).toBeUndefined()
    expect(log.writes).toEqual([])
  })

  it('a video file in an identity-less Project is unaffected (Static is not applicable, no block reason)', async () => {
    tables.projects = [{ id: P1, user_id: ME, identity: null }]
    tables.library_files = [libraryFile({ kind: 'video', mime_type: 'video/mp4' })]
    const { client } = fake(tables)
    const targets = await loadHandoffTargets(client, ME, await resolved(client))
    expect(targets.static).toEqual({ items: [], truncated: false })
    expect(targets.video.items.length).toBe(3)
  })

  it('foreign / mixed protections still hold for the chooser (other user, other Project)', async () => {
    tables.projects = [{ id: P1, user_id: ME, identity: VALID_IDENTITY }]
    const { client } = fake(tables)
    const staticIds = (await loadHandoffTargets(client, ME, await resolved(client))).static.items.map((item) => item.channelPieceId)
    expect(staticIds).not.toContain('cp-p2')
    expect(staticIds).not.toContain('cp-foreign')
  })
})
