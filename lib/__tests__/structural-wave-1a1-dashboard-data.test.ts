import { describe, expect, it } from 'vitest'
import { DASHBOARD_LIMITS, loadDashboardViewModel } from '@/lib/dashboard-data'
import { createRecordingSupabase, type Row } from './helpers/recording-supabase'

// STRUCTURAL_WAVE_1A1 - the Dashboard data layer against a RECORDING fake of the Supabase query builder: what is asked, with which
// scope, and what is shown when a query answers or fails. The fake enforces the filters it receives (so a missing `user_id` filter
// would leak the other user's rows into the result) and refuses every write.

const ME = 'user-me'
const OTHER = 'user-other'
const P1 = 'p1'
const P2 = 'p2'
const PR1 = 'pr1'
const PR2 = 'pr2'

const createFake = createRecordingSupabase

const iso = (day: number, hour = 10) => `2026-10-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00.000Z`

const base = (): Record<string, Row[]> => ({
  projects: [
    { id: P1, user_id: ME, name: 'Portal Norte', description: null, context: null, identity: null, updated_at: iso(1) },
    { id: P2, user_id: ME, name: 'Outro', description: null, context: null, identity: null, updated_at: iso(1) },
    { id: 'p-other', user_id: OTHER, name: 'Projeto alheio', description: null, context: null, identity: null, updated_at: iso(28) },
  ],
  productions: [
    { id: PR1, user_id: ME, project_id: P1, title: 'Campanha Norte', intention: 'Campanha', type: 'campaign', updated_at: iso(2) },
    { id: PR2, user_id: ME, project_id: P2, title: 'Serie Outro', intention: 'Serie', type: 'editorial', updated_at: iso(1) },
    { id: 'pr-other', user_id: OTHER, project_id: 'p-other', title: 'Production alheia', intention: 'x', type: 'campaign', updated_at: iso(28) },
  ],
  image_drafts: [],
  video_drafts: [],
  editorial_contents: [],
  image_generation_sessions: [],
  video_generation_sessions: [],
  video_generations: [],
})

const imageSession = (id: string, overrides: Row = {}): Row => ({
  id, user_id: ME, project_id: P1, production_id: PR1, name: null, working_prompt: `Sessão ${id}`, status: 'active', legacy_image_draft_id: null, image_status: 'draft', updated_at: iso(10), ...overrides,
})
const videoSession = (id: string, overrides: Row = {}): Row => ({ id, user_id: ME, project_id: P1, production_id: PR1, working_prompt: `Vídeo ${id}`, updated_at: iso(11), ...overrides })

describe('scope: only the signed-in user\'s work', () => {
  it('never reads or shows another user\'s rows, and every query carries the user filter', async () => {
    const tables = base()
    tables.image_generation_sessions = [imageSession('mine'), imageSession('theirs', { user_id: OTHER, project_id: 'p-other', production_id: 'pr-other', updated_at: iso(29) })]
    tables.video_generation_sessions = [videoSession('v-mine'), videoSession('v-theirs', { user_id: OTHER, project_id: 'p-other', production_id: 'pr-other', updated_at: iso(29) })]
    tables.video_drafts = [{ id: 'd-theirs', user_id: OTHER, project_id: 'p-other', production_id: 'pr-other', name: 'alheio', updated_at: iso(29) }]
    tables.editorial_contents = [{ id: 'e-theirs', user_id: OTHER, project_id: 'p-other', production_id: 'pr-other', title: 'alheio', status: 'draft', updated_at: iso(29) }]
    const { supabase, log } = createFake(tables)
    const view = await loadDashboardViewModel(supabase, ME)

    expect(view.recentWorkItems.map((item) => item.id).sort()).toEqual(['mine', 'v-mine'])
    expect(view.recentProductions.map((card) => card.id)).not.toContain('pr-other')
    expect(view.stats).toMatchObject({ projects: 2, productions: 2, imageSessions: 1, videoSessions: 1, videoDrafts: 0, editorialContents: 0 })
    expect(log.length).toBeGreaterThan(10)
    for (const query of log) {
      expect(query.filters, query.table).toContainEqual(['eq', 'user_id', ME])
    }
  })

  it('Production counters are scoped to the Production AND its own Project', async () => {
    const tables = base()
    tables.image_generation_sessions = [
      imageSession('ok-1'), imageSession('ok-2'),
      imageSession('wrong-project', { project_id: P2 }), // names PR1 but belongs to another Project
    ]
    const { supabase, log } = createFake(tables)
    const view = await loadDashboardViewModel(supabase, ME)
    const card = view.recentProductions.find((entry) => entry.id === PR1)!
    expect(card.counters.imageSessions).toBe(2)
    const counterQueries = log.filter((query) => query.head && query.filters.some(([, column, value]) => column === 'production_id' && value === PR1))
    expect(counterQueries.length).toBe(4)
    for (const query of counterQueries) {
      expect(query.filters).toContainEqual(['eq', 'project_id', P1])
      expect(query.filters).toContainEqual(['eq', 'user_id', ME])
    }
  })

  it('archived image Sessions are excluded from the slice, the totals and the counters', async () => {
    const tables = base()
    tables.image_generation_sessions = [imageSession('active-1'), imageSession('archived-1', { status: 'archived' })]
    const { supabase } = createFake(tables)
    const view = await loadDashboardViewModel(supabase, ME)
    expect(view.recentWorkItems.map((item) => item.id)).toEqual(['active-1'])
    expect(view.stats.imageSessions).toBe(1)
    expect(view.recentProductions.find((card) => card.id === PR1)!.counters.imageSessions).toBe(1)
  })
})

describe('counts are never distorted by pagination limits', () => {
  it('a Production with more Sessions than the recent slice reports the EXACT number', async () => {
    const tables = base()
    tables.image_generation_sessions = Array.from({ length: 57 }, (_, index) => imageSession(`img-${index}`, { updated_at: iso(1 + (index % 25), index % 20) }))
    tables.video_generation_sessions = Array.from({ length: 31 }, (_, index) => videoSession(`vid-${index}`, { updated_at: iso(1 + (index % 25), index % 20) }))
    const { supabase } = createFake(tables)
    const view = await loadDashboardViewModel(supabase, ME)
    expect(DASHBOARD_LIMITS.recentPerEntity).toBe(20)
    expect(view.stats.imageSessions).toBe(57)
    expect(view.stats.videoSessions).toBe(31)
    const card = view.recentProductions.find((entry) => entry.id === PR1)!
    expect(card.counters).toEqual({ imageSessions: 57, videoSessions: 31, videoDrafts: 0, editorial: 0 })
  })

  it('the query plan is bounded by the display limits, not by how much work the user has', async () => {
    const small = base()
    const big = base()
    big.productions = [...big.productions, ...Array.from({ length: 30 }, (_, index) => ({ id: `extra-${index}`, user_id: ME, project_id: P1, title: `P${index}`, intention: 'x', type: 'campaign', updated_at: iso(3) }))]
    big.image_generation_sessions = Array.from({ length: 200 }, (_, index) => imageSession(`img-${index}`))
    big.video_generation_sessions = Array.from({ length: 200 }, (_, index) => videoSession(`vid-${index}`, { updated_at: iso(12) }))
    const first = createFake(small)
    const second = createFake(big)
    await loadDashboardViewModel(first.supabase, ME)
    await loadDashboardViewModel(second.supabase, ME)
    const ceiling = 13 /* phase 1 */ + 1 /* draft lookup */ + 2 /* parent hydration */ + DASHBOARD_LIMITS.displayedProductions * 4 + DASHBOARD_LIMITS.displayedWorkItems + 4 /* Project counts */
    expect(first.log.length).toBeLessThanOrEqual(ceiling)
    expect(second.log.length).toBeLessThanOrEqual(ceiling)
    // Every list query is limited; only HEAD counts are unlimited.
    for (const query of second.log.filter((entry) => !entry.head)) expect(query.limit, query.table).toBeDefined()
  })
})

describe('legacy ImageDraft vs canonical Session', () => {
  const draftRow = (id: string, overrides: Row = {}): Row => ({ id, user_id: ME, project_id: P1, production_id: PR1, name: `Rascunho ${id}`, user_input: 'x', image_status: 'draft', updated_at: iso(9), ...overrides })

  it('a draft carried by a Session is not listed; the Session is', async () => {
    const tables = base()
    tables.image_drafts = [draftRow('d1')]
    tables.image_generation_sessions = [imageSession('s1', { legacy_image_draft_id: 'd1', updated_at: iso(9) })]
    const { supabase } = createFake(tables)
    const view = await loadDashboardViewModel(supabase, ME)
    expect(view.recentWorkItems.map((item) => `${item.entity}:${item.id}`)).toEqual(['image_session:s1'])
  })

  it('the link is found even when its Session is outside the recent slice', async () => {
    const tables = base()
    tables.image_drafts = [draftRow('d1', { updated_at: iso(28) })]
    // 25 newer Sessions push the Session that carries d1 out of the 20-row slice.
    tables.image_generation_sessions = [
      ...Array.from({ length: 25 }, (_, index) => imageSession(`new-${index}`, { updated_at: iso(20, index % 20) })),
      imageSession('carrier', { legacy_image_draft_id: 'd1', updated_at: iso(2) }),
    ]
    const { supabase } = createFake(tables)
    const view = await loadDashboardViewModel(supabase, ME)
    expect(view.recentWorkItems.some((item) => item.entity === 'image_draft')).toBe(false)
  })

  it('a draft no Session carries is still reachable (legacy compatibility)', async () => {
    const tables = base()
    tables.image_drafts = [draftRow('orphan')]
    const { supabase } = createFake(tables)
    const view = await loadDashboardViewModel(supabase, ME)
    expect(view.recentWorkItems).toMatchObject([{ entity: 'image_draft', id: 'orphan', href: `/imagens?draft=orphan&project=${P1}&production=${PR1}` }])
  })

  it('if the link lookup fails the legacy drafts are withheld (never risk listing work twice) and the failure is reported', async () => {
    const tables = base()
    tables.image_drafts = [draftRow('d1')]
    tables.image_generation_sessions = [imageSession('s1', { legacy_image_draft_id: 'd1' })]
    // Only the narrow lookup fails: it is the one query that filters by legacy_image_draft_id.
    const { supabase } = createFake(tables)
    const original = (supabase as any).from.bind(supabase)
    ;(supabase as any).from = (table: string) => {
      const builder = original(table)
      const originalIn = builder.in.bind(builder)
      builder.in = (column: string, values: unknown[]) => {
        const next = originalIn(column, values)
        if (column === 'legacy_image_draft_id') next.then = (resolve: (value: unknown) => unknown) => resolve({ data: null, error: { message: 'lookup failed' }, count: null })
        return next
      }
      return builder
    }
    const view = await loadDashboardViewModel(supabase, ME)
    expect(view.recentWorkItems.map((item) => item.entity)).toEqual(['image_session'])
    expect(view.hasLoadError).toBe(true)
  })
})

describe('video Sessions and VideoDrafts coexist; Attempts give the Session its status', () => {
  it('both appear with their own destinations and counters', async () => {
    const tables = base()
    tables.video_generation_sessions = [videoSession('vs1')]
    tables.video_drafts = [{ id: 'vd1', user_id: ME, project_id: P1, production_id: PR1, name: 'Teaser', updated_at: iso(8) }]
    const { supabase } = createFake(tables)
    const view = await loadDashboardViewModel(supabase, ME)
    expect(view.recentWorkItems.map((item) => `${item.entity}:${item.href}`).sort()).toEqual(['video_draft:/creative-editor/video/vd1', 'video_session:/videos/geracoes/vs1'])
    expect(view.recentProductions.find((card) => card.id === PR1)!.counters).toMatchObject({ videoSessions: 1, videoDrafts: 1 })
    expect(view.stats).toMatchObject({ videoSessions: 1, videoDrafts: 1 })
  })

  it('reads the latest Attempt of each DISPLAYED video Session (one tiny query each), in Portuguese; none = "Sem tentativas"', async () => {
    const tables = base()
    tables.video_generation_sessions = [videoSession('vs-failed', { updated_at: iso(12) }), videoSession('vs-empty', { updated_at: iso(11) })]
    tables.video_generations = [
      { id: 'a1', user_id: ME, session_id: 'vs-failed', status: 'succeeded', created_at: iso(1) },
      { id: 'a2', user_id: ME, session_id: 'vs-failed', status: 'failed', created_at: iso(5) },
      { id: 'a3', user_id: OTHER, session_id: 'vs-empty', status: 'succeeded', created_at: iso(6) },
    ]
    const { supabase, log } = createFake(tables)
    const view = await loadDashboardViewModel(supabase, ME)
    const byId = Object.fromEntries(view.recentWorkItems.map((item) => [item.id, item]))
    expect(byId['vs-failed']).toMatchObject({ status: 'Falhou', statusTone: 'danger' })
    expect(byId['vs-empty']).toMatchObject({ status: 'Sem tentativas' })
    const attemptQueries = log.filter((query) => query.table === 'video_generations')
    expect(attemptQueries).toHaveLength(2)
    for (const query of attemptQueries) {
      expect(query.limit).toBe(1)
      expect(query.filters).toContainEqual(['eq', 'user_id', ME])
    }
  })

  it('a failed Attempt lookup shows "Sem status" (never a made-up state) and flags the failure', async () => {
    const tables = base()
    tables.video_generation_sessions = [videoSession('vs1')]
    const { supabase } = createFake(tables, new Set(['video_generations']))
    const view = await loadDashboardViewModel(supabase, ME)
    expect(view.recentWorkItems[0]).toMatchObject({ entity: 'video_session', status: 'Sem status' })
    expect(view.hasLoadError).toBe(true)
  })

  it('historical standalone generations (no Session) are not turned into Session items', async () => {
    const tables = base()
    tables.video_generations = [{ id: 'standalone', user_id: ME, session_id: null, project_id: P1, production_id: PR1, status: 'succeeded', created_at: iso(15) }]
    const { supabase } = createFake(tables)
    const view = await loadDashboardViewModel(supabase, ME)
    expect(view.recentWorkItems).toEqual([])
  })
})

describe('failures never become silent zeros or false claims', () => {
  it('a failing Session query is reported; the rest of the Dashboard still renders', async () => {
    const tables = base()
    tables.video_drafts = [{ id: 'vd1', user_id: ME, project_id: P1, production_id: PR1, name: 'Teaser', updated_at: iso(8) }]
    const { supabase } = createFake(tables, new Set(['image_generation_sessions']))
    const view = await loadDashboardViewModel(supabase, ME)
    expect(view.hasLoadError).toBe(true)
    expect(view.stats.imageSessions).toBeNull()
    expect(view.stats.videoDrafts).toBe(1)
    expect(view.recentWorkItems.map((item) => item.id)).toEqual(['vd1'])
    expect(view.recentProductions.find((card) => card.id === PR1)!.counters.imageSessions).toBeNull()
  })

  it('a failing counter query yields an unknown (null) counter, not 0', async () => {
    const tables = base()
    tables.video_drafts = [{ id: 'vd1', user_id: ME, project_id: P1, production_id: PR1, name: 'Teaser', updated_at: iso(8) }]
    const { supabase } = createFake(tables, new Set(), new Set(['editorial_contents']))
    const view = await loadDashboardViewModel(supabase, ME)
    expect(view.stats.editorialContents).toBeNull()
    expect(view.recentProductions[0].counters.editorial).toBeNull()
    expect(view.hasLoadError).toBe(true)
  })

  it('no "empty" claim is made when the totals could not be read', async () => {
    const { supabase } = createFake(base(), new Set(), new Set(['projects']))
    const view = await loadDashboardViewModel(supabase, ME)
    expect(view.stats.projects).toBeNull()
    expect(view.emptyState).toBeNull()
  })

  it('a user with nothing gets the real empty state and no error', async () => {
    const { supabase } = createFake({ projects: [], productions: [], image_drafts: [], video_drafts: [], editorial_contents: [], image_generation_sessions: [], video_generation_sessions: [], video_generations: [] })
    const view = await loadDashboardViewModel(supabase, ME)
    expect(view.hasLoadError).toBe(false)
    expect(view.emptyState).toMatchObject({ kind: 'no-projects' })
    expect(view.recentWorkItems).toEqual([])
    expect(view.recentProductions).toEqual([])
  })

  it('is strictly read-only (the fake throws on any write)', async () => {
    const { supabase } = createFake(base())
    await expect(loadDashboardViewModel(supabase, ME)).resolves.toBeDefined()
  })
})

describe('activity dates reach the Production ordering', () => {
  it('hydrates an older Production and Project referenced by recent Session work, beyond both parent slices', async () => {
    const tables = base()
    tables.projects.push(...Array.from({ length: 10 }, (_, n) => ({ ...tables.projects[0], id: `new-project-${n}`, updated_at: iso(15) })))
    tables.productions.push(...Array.from({ length: 20 }, (_, n) => ({ ...tables.productions[0], id: `new-production-${n}`, updated_at: iso(15) })))
    tables.image_generation_sessions = [imageSession('recent-work', { project_id: P2, production_id: PR2, updated_at: iso(28) })]
    const { supabase } = createFake(tables)
    const view = await loadDashboardViewModel(supabase, ME)
    expect(view.recentProductions[0]).toMatchObject({ id: PR2, projectName: 'Outro', activityAt: iso(28) })
    expect(view.recentWorkItems[0]).toMatchObject({ projectName: 'Outro', productionName: 'Outro' })
    const project = view.recentProjects.find((card) => card.id.startsWith('new-project'))!
    expect(project.productionCount).toBe(0)
  })

  it('Project counts include Productions beyond the ten-row parent slice', async () => {
    const tables = base()
    tables.productions.push(...Array.from({ length: 30 }, (_, n) => ({ ...tables.productions[0], id: `extra-${n}`, updated_at: iso(15) })))
    const { supabase } = createFake(tables)
    const view = await loadDashboardViewModel(supabase, ME)
    expect(view.recentProjects.find((card) => card.id === P1)!.productionCount).toBe(31)
  })

  it('a Production whose Session was edited last comes first', async () => {
    const tables = base()
    tables.image_generation_sessions = [imageSession('s-pr2', { project_id: P2, production_id: PR2, updated_at: iso(20) })]
    const { supabase } = createFake(tables)
    const view = await loadDashboardViewModel(supabase, ME)
    expect(view.recentProductions.map((card) => card.id)).toEqual([PR2, PR1])
    expect(view.recentProductions[0].activityAt).toBe(iso(20))
  })
})
