import { describe, expect, it } from 'vitest'
import {
  buildRecentProductions,
  buildRecentWorkItems,
  type DashboardEditorialContent,
  type DashboardImageDraft,
  type DashboardImageSession,
  type DashboardProduction,
  type DashboardProject,
  type DashboardVideoDraft,
  type DashboardVideoSession,
} from '@/lib/dashboard-continuation'
import {
  buildProductionImageContinuity,
  describeOverviewImages,
  describeOverviewVideos,
  describeProductionCounters,
  excludeLinkedImageDrafts,
  imageSessionHref,
  imageSessionStatus,
  imageSessionTitle,
  isActiveSession,
  linkedImageDraftIds,
  videoSessionHref,
  videoSessionStatus,
} from '@/lib/session-continuity'

// STRUCTURAL_WAVE_1A1 - CANONICAL SESSION CONTINUITY V1: the pure rules.

const P1 = 'project-1'
const P2 = 'project-2'
const PR1 = 'production-1'
const PR2 = 'production-2'

const projects: DashboardProject[] = [
  { id: P1, name: 'Portal Norte', description: null, context: null, identity: null, updated_at: '2026-10-01T10:00:00.000Z' },
  { id: P2, name: 'Outro Project', description: null, context: null, identity: null, updated_at: '2026-10-01T10:00:00.000Z' },
]
const productions: DashboardProduction[] = [
  { id: PR1, project_id: P1, title: 'Campanha de outono', intention: 'Campanha', type: 'campaign', updated_at: '2026-10-01T09:00:00.000Z' },
  { id: PR2, project_id: P2, title: 'Serie Outro', intention: 'Serie', type: 'editorial', updated_at: '2026-10-01T08:00:00.000Z' },
]

const imageSession = (overrides: Partial<DashboardImageSession> = {}): DashboardImageSession => ({
  id: 'is-1', project_id: P1, production_id: PR1, name: null, working_prompt: 'Retrato de estúdio', image_status: 'draft', status: 'active',
  legacy_image_draft_id: null, updated_at: '2026-10-05T10:00:00.000Z', ...overrides,
})
const imageDraft = (overrides: Partial<DashboardImageDraft> = {}): DashboardImageDraft => ({
  id: 'id-1', project_id: P1, production_id: PR1, name: 'Rascunho antigo', user_input: 'um retrato', image_status: 'draft', updated_at: '2026-10-04T10:00:00.000Z', ...overrides,
})
const videoSession = (overrides: Partial<DashboardVideoSession> = {}): DashboardVideoSession => ({
  id: 'vs-1', project_id: P1, production_id: PR1, working_prompt: 'Câmera lenta no mar', updated_at: '2026-10-06T10:00:00.000Z', ...overrides,
})
const videoDraft = (overrides: Partial<DashboardVideoDraft> = {}): DashboardVideoDraft => ({
  id: 'vd-1', project_id: P1, production_id: PR1, name: 'Teaser', updated_at: '2026-10-03T10:00:00.000Z', ...overrides,
})
const editorial = (overrides: Partial<DashboardEditorialContent> = {}): DashboardEditorialContent => ({
  id: 'ec-1', project_id: P1, production_id: PR1, title: 'Lançamento', status: 'draft', updated_at: '2026-10-02T10:00:00.000Z', ...overrides,
})

const items = (extra: Partial<Parameters<typeof buildRecentWorkItems>[0]> = {}) =>
  buildRecentWorkItems({ imageDrafts: [], videoDrafts: [], editorialContents: [], projects, productions, limit: 50, ...extra })

describe('canonical destinations, one specific to each entity', () => {
  it('maps every continuity entity to its own canonical route', () => {
    const all = items({
      imageSessions: [imageSession()],
      imageDrafts: [imageDraft()],
      videoSessions: [videoSession()],
      videoDrafts: [videoDraft()],
      editorialContents: [editorial()],
    })
    const href = (entity: string) => all.find((item) => item.entity === entity)?.href
    expect(href('image_session')).toBe('/imagens/geracoes/is-1')
    expect(href('video_session')).toBe('/videos/geracoes/vs-1')
    expect(href('video_draft')).toBe('/creative-editor/video/vd-1')
    expect(href('editorial')).toBe('/projetos/project-1/conteudos/ec-1')
    expect(href('image_draft')).toBe('/imagens?draft=id-1&project=project-1&production=production-1')
    expect(imageSessionHref('x')).toBe('/imagens/geracoes/x')
    expect(videoSessionHref('x')).toBe('/videos/geracoes/x')
  })

  it('labels each entity for what it is (session, edit, content), never as one generic "item"', () => {
    const all = items({ imageSessions: [imageSession()], videoSessions: [videoSession()], videoDrafts: [videoDraft()], editorialContents: [editorial()], imageDrafts: [imageDraft()] })
    expect(Object.fromEntries(all.map((item) => [item.entity, item.label]))).toEqual({
      image_session: 'Sessão de imagem',
      video_session: 'Sessão de vídeo',
      video_draft: 'Edição de vídeo',
      editorial: 'Conteúdo',
      image_draft: 'Rascunho de imagem',
    })
  })
})

describe('image session without any legacy ImageDraft', () => {
  it('a brand-new Session appears on its own (no draft needed)', () => {
    const [item] = items({ imageSessions: [imageSession({ id: 'new-session', legacy_image_draft_id: null })] })
    expect(item).toMatchObject({ id: 'new-session', entity: 'image_session', title: 'Retrato de estúdio', status: 'Rascunho', productionName: 'Campanha de outono', projectName: 'Portal Norte' })
  })

  it('uses the Session name, then the prompt, then an honest fallback; and carries the Session status', () => {
    const named = items({ imageSessions: [imageSession({ name: '  Capa   do mês ', status: 'active', image_status: 'approved' })] })[0]
    expect(named).toMatchObject({ title: 'Capa do mês', status: 'Aprovada', statusTone: 'positive' })
    expect(imageSessionTitle({ name: null, workingPrompt: null })).toBe('Geração sem descrição')
    expect(imageSessionTitle({ name: '', workingPrompt: 'x'.repeat(200) }).length).toBe(72)
    expect(imageSessionStatus('generating')).toEqual({ label: 'Gerando', tone: 'warning' })
    expect(imageSessionStatus('rejected')).toEqual({ label: 'Rejeitada', tone: 'danger' })
    expect(imageSessionStatus(undefined)).toEqual({ label: 'Rascunho', tone: 'neutral' })
  })

  it('an archived Session is out of continuity', () => {
    expect(isActiveSession({ status: 'archived' })).toBe(false)
    expect(isActiveSession({ status: 'active' })).toBe(true)
    expect(items({ imageSessions: [imageSession({ status: 'archived' })] })).toHaveLength(0)
  })
})

describe('legacy ImageDraft carried by a Session is not shown twice', () => {
  it('lists the Session and hides the draft it carries', () => {
    const all = items({ imageSessions: [imageSession({ id: 's-a', legacy_image_draft_id: 'd-a' })], imageDrafts: [imageDraft({ id: 'd-a' })] })
    expect(all.map((item) => `${item.entity}:${item.id}`)).toEqual(['image_session:s-a'])
  })

  it('a draft that NO Session carries is still reachable (legacy compatibility)', () => {
    const all = items({ imageSessions: [imageSession({ id: 's-a', legacy_image_draft_id: 'd-a' })], imageDrafts: [imageDraft({ id: 'd-a' }), imageDraft({ id: 'd-orphan', updated_at: '2026-10-09T10:00:00.000Z' })] })
    expect(all.map((item) => `${item.entity}:${item.id}`).sort()).toEqual(['image_draft:d-orphan', 'image_session:s-a'])
  })

  it('a Session found by a lookup (outside the listed slice) also hides its draft; an archived Session still does', () => {
    expect(items({ imageDrafts: [imageDraft({ id: 'd-x' })], linkedImageDraftIds: ['d-x'] })).toHaveLength(0)
    expect(items({ imageDrafts: [imageDraft({ id: 'd-y' })], imageSessions: [imageSession({ status: 'archived', legacy_image_draft_id: 'd-y' })] })).toHaveLength(0)
  })

  it('pure helpers', () => {
    const linked = linkedImageDraftIds([{ legacyImageDraftId: 'a' }, { legacyImageDraftId: null }, {}], ['b'])
    expect([...linked].sort()).toEqual(['a', 'b'])
    expect(excludeLinkedImageDrafts([{ id: 'a' }, { id: 'c' }], linked)).toEqual([{ id: 'c' }])
  })
})

describe('video Session and VideoDraft coexist as different entities', () => {
  it('both appear, each with its own destination, neither replacing the other', () => {
    const all = items({ videoSessions: [videoSession({ id: 'vs-9' })], videoDrafts: [videoDraft({ id: 'vd-9' })] })
    expect(all.map((item) => `${item.entity}:${item.href}`).sort()).toEqual(['video_draft:/creative-editor/video/vd-9', 'video_session:/videos/geracoes/vs-9'])
  })

  it('a video Session shows the stored status of its latest Attempt in Portuguese; unknown is "Sem status", never a fake state', () => {
    const base = { videoSessions: [videoSession({ id: 'vs-9' })] }
    expect(items({ ...base, videoSessionLatestStatus: { 'vs-9': 'processing' } })[0]).toMatchObject({ status: 'Processando', statusTone: 'warning' })
    expect(items({ ...base, videoSessionLatestStatus: { 'vs-9': 'failed' } })[0]).toMatchObject({ status: 'Falhou', statusTone: 'danger' })
    expect(items({ ...base, videoSessionLatestStatus: { 'vs-9': null } })[0]).toMatchObject({ status: 'Sem tentativas' })
    expect(items(base)[0]).toMatchObject({ status: 'Sem status' })
    expect(videoSessionStatus('succeeded')).toMatchObject({ label: 'Concluído', stored: 'succeeded' })
  })

  it('historical standalone generations are NOT represented as sessions (they have no Session to continue)', () => {
    // The builder has no input for them, so they can never appear as a session item: their visibility stays where it already was.
    expect(items({ videoSessions: [], videoDrafts: [] })).toHaveLength(0)
  })
})

describe('activity dates and counters', () => {
  it('Sessions participate in the activity date of their Production', () => {
    const [card] = buildRecentProductions({
      productions: [productions[0]], projects, imageDrafts: [], videoDrafts: [], editorialContents: [],
      imageSessions: [imageSession({ updated_at: '2026-10-07T12:00:00.000Z' })],
      videoSessions: [videoSession({ updated_at: '2026-10-08T12:00:00.000Z' })],
    })
    expect(card.activityAt).toBe('2026-10-08T12:00:00.000Z')
    const [onlyImage] = buildRecentProductions({
      productions: [productions[0]], projects, imageDrafts: [], videoDrafts: [], editorialContents: [],
      imageSessions: [imageSession({ updated_at: '2026-10-07T12:00:00.000Z' })],
    })
    expect(onlyImage.activityAt).toBe('2026-10-07T12:00:00.000Z')
  })

  it('a Production with a more recent Session outranks one with only older work', () => {
    const cards = buildRecentProductions({
      productions, projects, imageDrafts: [], videoDrafts: [videoDraft({ production_id: PR2, project_id: P2, updated_at: '2026-10-02T10:00:00.000Z' })], editorialContents: [],
      imageSessions: [imageSession({ updated_at: '2026-10-09T10:00:00.000Z' })],
    })
    expect(cards.map((card) => card.id)).toEqual([PR1, PR2])
  })

  it('a legacy draft carried by a Session does not bump the activity (the Session is the work)', () => {
    const [card] = buildRecentProductions({
      productions: [productions[0]], projects,
      imageDrafts: [imageDraft({ id: 'd-a', updated_at: '2026-10-20T10:00:00.000Z' })], videoDrafts: [], editorialContents: [],
      imageSessions: [imageSession({ legacy_image_draft_id: 'd-a', updated_at: '2026-10-05T10:00:00.000Z' })],
    })
    expect(card.activityAt).toBe('2026-10-05T10:00:00.000Z')
  })

  it('counters are one number per entity and are never summed; legacy drafts are not double counted', () => {
    const [card] = buildRecentProductions({
      productions: [productions[0]], projects,
      imageDrafts: [imageDraft({ id: 'd-a' })], videoDrafts: [videoDraft(), videoDraft({ id: 'vd-2' })], editorialContents: [editorial()],
      imageSessions: [imageSession({ legacy_image_draft_id: 'd-a' }), imageSession({ id: 'is-2' })],
      videoSessions: [videoSession()],
    })
    expect(card.counters).toEqual({ imageSessions: 2, videoSessions: 1, videoDrafts: 2, editorial: 1 })
  })

  it('exact counters supplied by the caller win over anything derived from a limited slice', () => {
    const counters = new Map([[PR1, { imageSessions: 57, videoSessions: 3, videoDrafts: 0, editorial: null }]])
    const [card] = buildRecentProductions({
      productions: [productions[0]], projects, imageDrafts: [], videoDrafts: [], editorialContents: [], imageSessions: [imageSession()], counters,
    })
    expect(card.counters).toEqual({ imageSessions: 57, videoSessions: 3, videoDrafts: 0, editorial: null })
  })

  it('a row that names a Production but belongs to ANOTHER Project is not attributed to it', () => {
    const [card] = buildRecentProductions({
      productions: [productions[0]], projects, imageDrafts: [], videoDrafts: [], editorialContents: [],
      imageSessions: [imageSession({ project_id: P2 })],
      videoSessions: [videoSession({ project_id: P2 })],
    })
    expect(card.counters).toEqual({ imageSessions: 0, videoSessions: 0, videoDrafts: 0, editorial: 0 })
  })

  it('an image Session without Project/Production (optional scope) is never attributed to a Production', () => {
    const [card] = buildRecentProductions({
      productions: [productions[0]], projects, imageDrafts: [], videoDrafts: [], editorialContents: [],
      imageSessions: [imageSession({ project_id: null, production_id: null })],
    })
    expect(card.counters.imageSessions).toBe(0)
    const all = items({ imageSessions: [imageSession({ project_id: null, production_id: null })] })
    expect(all[0]).toMatchObject({ projectName: 'Sem Project', productionName: null, href: '/imagens/geracoes/is-1' })
  })

  it('describes counters entity by entity; unknown counts are omitted, never printed as 0', () => {
    expect(describeProductionCounters({ imageSessions: 2, videoSessions: 1, videoDrafts: 3, editorial: 1 })).toBe('2 sessões de imagem · 1 sessão de vídeo · 3 edições de vídeo · 1 conteúdo')
    expect(describeProductionCounters({ imageSessions: 0, videoSessions: 0, videoDrafts: 0, editorial: 0 })).toBe('Nenhum item vinculado')
    expect(describeProductionCounters({ imageSessions: null, videoSessions: 4, videoDrafts: null, editorial: null })).toBe('4 sessões de vídeo')
    expect(describeProductionCounters({ imageSessions: null, videoSessions: null, videoDrafts: null, editorial: null })).toBe('Contagem indisponível')
  })

  it('recent items are ordered by their real update date across all entities', () => {
    const all = items({
      imageSessions: [imageSession({ updated_at: '2026-10-05T10:00:00.000Z' })], videoSessions: [videoSession({ updated_at: '2026-10-06T10:00:00.000Z' })],
      videoDrafts: [videoDraft({ updated_at: '2026-10-03T10:00:00.000Z' })], editorialContents: [editorial({ updated_at: '2026-10-07T10:00:00.000Z' })],
    })
    expect(all.map((item) => item.entity)).toEqual(['editorial', 'video_session', 'image_session', 'video_draft'])
    expect(buildRecentWorkItems({ imageDrafts: [], videoDrafts: [], editorialContents: [editorial(), editorial({ id: 'e2' }), editorial({ id: 'e3' })], projects, productions, limit: 2 })).toHaveLength(2)
  })

  it('does not mutate its inputs', () => {
    const sessions = [imageSession({ legacy_image_draft_id: 'd-a' })]
    const drafts = [imageDraft({ id: 'd-a' })]
    const snapshot = structuredClone({ sessions, drafts })
    buildRecentWorkItems({ imageDrafts: drafts, imageSessions: sessions, videoDrafts: [], editorialContents: [], projects, productions })
    buildRecentProductions({ imageDrafts: drafts, imageSessions: sessions, videoDrafts: [], editorialContents: [], projects, productions })
    expect({ sessions, drafts }).toEqual(snapshot)
  })
})

describe('Production workspace - Images tab continuity', () => {
  const session = (overrides: Record<string, unknown> = {}) => ({
    id: 's1', projectId: P1, productionId: PR1, name: null, workingPrompt: 'Retrato', workingState: { imageStatus: 'generating' }, status: 'active',
    legacyImageDraftId: null, updatedAt: '2026-10-05T10:00:00.000Z', thumbnailUrl: 'https://cdn.example/t.webp', ...overrides,
  })
  const draft = (overrides: Record<string, unknown> = {}) => ({ id: 'd1', project_id: P1, production_id: PR1, name: 'Antigo', user_input: 'x', image_status: 'draft', updated_at: '2026-10-01T10:00:00.000Z', ...overrides })
  const build = (sessions: unknown[], legacyDrafts: unknown[]) => buildProductionImageContinuity({ sessions: sessions as never, legacyDrafts: legacyDrafts as never, projectId: P1, productionId: PR1 })

  it('lists the canonical Session with title, status, update date and the canonical route', () => {
    const result = build([session()], [])
    expect(result.sessions).toEqual([{ id: 's1', title: 'Retrato', status: { label: 'Gerando', tone: 'warning' }, updatedAt: '2026-10-05T10:00:00.000Z', thumbnailUrl: 'https://cdn.example/t.webp', href: '/imagens/geracoes/s1' }])
  })

  it('a Session without a legacy draft needs none; a draft carried by a Session is hidden (no duplicate)', () => {
    expect(build([session()], [])).toMatchObject({ legacyDrafts: [], hiddenLegacyDrafts: 0 })
    const both = build([session({ legacyImageDraftId: 'd1' })], [draft()])
    expect(both.sessions).toHaveLength(1)
    expect(both.legacyDrafts).toEqual([])
    expect(both.hiddenLegacyDrafts).toBe(1)
  })

  it('a draft no Session carries stays visible as legacy', () => {
    const result = build([session({ legacyImageDraftId: 'd1' })], [draft(), draft({ id: 'd2' })])
    expect(result.legacyDrafts.map((entry) => entry.id)).toEqual(['d2'])
  })

  it('re-checks scope: a Session of another Production or another Project is never attributed to this one', () => {
    const result = build([session({ id: 'ok' }), session({ id: 'other-production', productionId: PR2 }), session({ id: 'other-project', projectId: P2 }), session({ id: 'unscoped', projectId: null, productionId: null })], [])
    expect(result.sessions.map((entry) => entry.id)).toEqual(['ok'])
  })

  it('skips archived Sessions but they still hide the draft they carry', () => {
    const result = build([session({ status: 'archived', legacyImageDraftId: 'd1' })], [draft()])
    expect(result.sessions).toEqual([])
    expect(result.legacyDrafts).toEqual([])
  })

  it('orders Sessions by recency and falls back to an honest title', () => {
    const result = build([session({ id: 'old', updatedAt: '2026-09-01T00:00:00.000Z' }), session({ id: 'new', updatedAt: '2026-10-09T00:00:00.000Z', workingPrompt: '', name: null })], [])
    expect(result.sessions.map((entry) => entry.id)).toEqual(['new', 'old'])
    expect(result.sessions[0].title).toBe('Geração sem descrição')
  })

  it('overview wording: one number per entity; "+" when the list was cut by its cap', () => {
    expect(describeOverviewImages({ sessions: 0, legacyDrafts: 0 })).toBe('Sem imagens vinculadas')
    expect(describeOverviewImages({ sessions: 1, legacyDrafts: 0 })).toBe('1 sessão de imagem')
    expect(describeOverviewImages({ sessions: 100, legacyDrafts: 2, hasMore: true })).toBe('100+ sessões de imagem · 2 rascunhos legados')
    expect(describeOverviewVideos({ sessions: 0, drafts: 0, standaloneGenerations: 0 })).toBe('Sem vídeos vinculados')
    expect(describeOverviewVideos({ sessions: 2, drafts: 1, standaloneGenerations: 3 })).toBe('2 sessões de geração · 1 edição de vídeo · 3 gerações avulsas (histórico)')
    expect(describeOverviewVideos({ sessions: 100, drafts: 0, standaloneGenerations: 0, sessionsHasMore: true })).toBe('100+ sessões de geração')
  })
})
