// STRUCTURAL_WAVE_1A1 - the Dashboard's data, in one testable place.
//
// What the Dashboard needs to show CONTINUITY correctly, with the cheapest queries that stay truthful:
//
//   Phase 1 (parallel)  recent slices of every continuity entity + exact totals
//   Phase 2 (parallel)  legacy ImageDraft -> Session lookup (so a draft a Session already carries is not listed twice)
//   Phase 3 (parallel)  EXACT counters for the (at most 4) Productions that are displayed, and the latest Attempt status of the
//                       (at most 6) displayed video Sessions
//
// Rules this module enforces:
//   * every query is scoped to the user (`user_id`), and Production counters also to the Production's own Project;
//   * a counter is a `head` count: it is never derived from a limited list, so a limit can never produce a misleading number;
//   * the Phase 3 fan-out is bounded by the display limits (constant), not by the size of the user's data;
//   * a query that fails yields `null`/omission plus `hasLoadError` - never a silent 0 or an invented relationship;
//   * read-only: nothing here writes, and nothing calls a provider.

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildRecentProductions,
  buildRecentProjects,
  buildRecentWorkItems,
  getDashboardEmptyState,
  type DashboardEditorialContent,
  type DashboardEmptyState,
  type DashboardImageDraft,
  type DashboardImageSession,
  type DashboardProduction,
  type DashboardProject,
  type DashboardVideoDraft,
  type DashboardVideoSession,
  type RecentProductionCard,
  type RecentProjectCard,
  type RecentWorkItem,
} from '@/lib/dashboard-continuation'
import type { ProductionCounters } from '@/lib/session-continuity'

export const DASHBOARD_LIMITS = {
  projects: 6,
  productions: 10,
  /** Recent rows read per continuity entity (display uses far fewer; this only bounds the activity/recency derivation). */
  recentPerEntity: 20,
  displayedProductions: 4,
  displayedWorkItems: 6,
} as const

/** Totals, one per ENTITY. They are never added together. `null` = could not be read. */
export interface DashboardStats {
  projects: number | null
  productions: number | null
  imageSessions: number | null
  videoSessions: number | null
  videoDrafts: number | null
  editorialContents: number | null
}

export interface DashboardViewModel {
  recentProductions: RecentProductionCard[]
  recentWorkItems: RecentWorkItem[]
  recentProjects: RecentProjectCard[]
  stats: DashboardStats
  emptyState: DashboardEmptyState | null
  hasLoadError: boolean
}

type Result<T = unknown> = { data?: T | null; error?: unknown; count?: number | null }

export async function loadDashboardViewModel(supabase: SupabaseClient, userId: string): Promise<DashboardViewModel> {
  let hasLoadError = false
  const failed = (result: Result) => {
    if (result.error) hasLoadError = true
    return Boolean(result.error)
  }

  const slice = (table: string, columns: string, limit: number, scope?: (query: any) => any) => {
    let query: any = supabase.from(table).select(columns).eq('user_id', userId)
    if (scope) query = scope(query)
    return query.order('updated_at', { ascending: false }).limit(limit) as PromiseLike<Result<any[]>>
  }
  const total = (table: string, scope?: (query: any) => any) => {
    let query: any = supabase.from(table).select('id', { count: 'exact', head: true }).eq('user_id', userId)
    if (scope) query = scope(query)
    return query as PromiseLike<Result>
  }
  const onlyActive = (query: any) => query.eq('status', 'active')

  // ---- Phase 1 -----------------------------------------------------------------------------------------------------------------
  const [
    projectsResult,
    productionsResult,
    imageDraftsResult,
    videoDraftsResult,
    editorialResult,
    imageSessionsResult,
    videoSessionsResult,
    projectsTotal,
    productionsTotal,
    imageSessionsTotal,
    videoSessionsTotal,
    videoDraftsTotal,
    editorialTotal,
  ] = await Promise.all([
    slice('projects', 'id, name, description, context, identity, updated_at', DASHBOARD_LIMITS.projects),
    slice('productions', 'id, project_id, title, intention, type, updated_at', DASHBOARD_LIMITS.productions),
    slice('image_drafts', 'id, project_id, production_id, name, user_input, image_status, updated_at', DASHBOARD_LIMITS.recentPerEntity),
    slice('video_drafts', 'id, project_id, production_id, name, updated_at', DASHBOARD_LIMITS.recentPerEntity),
    slice('editorial_contents', 'id, project_id, production_id, title, status, updated_at', DASHBOARD_LIMITS.recentPerEntity),
    slice(
      'image_generation_sessions',
      'id, project_id, production_id, name, working_prompt, status, legacy_image_draft_id, image_status:working_state->>imageStatus, updated_at',
      DASHBOARD_LIMITS.recentPerEntity,
      onlyActive,
    ),
    slice('video_generation_sessions', 'id, project_id, production_id, working_prompt, updated_at', DASHBOARD_LIMITS.recentPerEntity),
    total('projects'),
    total('productions'),
    total('image_generation_sessions', onlyActive),
    total('video_generation_sessions'),
    total('video_drafts'),
    total('editorial_contents'),
  ])

  for (const result of [projectsResult, productionsResult, imageDraftsResult, videoDraftsResult, editorialResult, imageSessionsResult, videoSessionsResult]) failed(result)

  let projects = (projectsResult.data ?? []) as DashboardProject[]
  let productions = (productionsResult.data ?? []) as DashboardProduction[]
  const imageDrafts = (imageDraftsResult.data ?? []) as DashboardImageDraft[]
  const videoDrafts = (videoDraftsResult.data ?? []) as DashboardVideoDraft[]
  const editorialContents = (editorialResult.data ?? []) as DashboardEditorialContent[]
  const imageSessions = (imageSessionsResult.data ?? []) as DashboardImageSession[]
  const videoSessions = (videoSessionsResult.data ?? []) as DashboardVideoSession[]

  const countOf = (result: Result): number | null => {
    if (failed(result) || result.count == null) { hasLoadError = true; return null }
    return result.count
  }
  const stats: DashboardStats = {
    projects: countOf(projectsTotal),
    productions: countOf(productionsTotal),
    imageSessions: countOf(imageSessionsTotal),
    videoSessions: countOf(videoSessionsTotal),
    videoDrafts: countOf(videoDraftsTotal),
    editorialContents: countOf(editorialTotal),
  }

  // ---- Phase 2: which of the recent legacy drafts does a Session already carry? --------------------------------------------------
  // (a Session carries a draft through `legacy_image_draft_id`; any status counts, so an archived Session still hides its draft)
  const draftIds = imageDrafts.map((draft) => draft.id)
  let linkedDraftIds: string[] = []
  if (draftIds.length > 0) {
    const lookup = (await supabase
      .from('image_generation_sessions')
      .select('legacy_image_draft_id')
      .eq('user_id', userId)
      .in('legacy_image_draft_id', draftIds)
      .limit(draftIds.length)) as Result<Array<{ legacy_image_draft_id: string | null }>>
    if (failed(lookup)) {
      // Unknown linkage: suppress the legacy drafts rather than risk listing work twice.
      linkedDraftIds = draftIds
    } else {
      linkedDraftIds = (lookup.data ?? []).map((row) => row.legacy_image_draft_id).filter((id): id is string => Boolean(id))
    }
  }

  // A Production's own timestamp is not touched by session autosave. Resolve parents of the bounded recent slices too, otherwise
  // recently edited work in an older Production disappears from "Continuar trabalhando" after ten newer Productions exist.
  const parentIds = [...new Set([...imageDrafts, ...videoDrafts, ...editorialContents, ...imageSessions, ...videoSessions]
    .map((row) => row.production_id).filter((id): id is string => Boolean(id)))]
    .filter((id) => !productions.some((row) => row.id === id))
  if (parentIds.length) {
    const result = await supabase.from('productions').select('id, project_id, title, intention, type, updated_at')
      .eq('user_id', userId).in('id', parentIds).limit(parentIds.length)
    if (!failed(result)) productions = [...productions, ...(result.data ?? []) as DashboardProduction[]]
  }
  const projectIds = [...new Set([...productions.map((row) => row.project_id), ...imageDrafts.map((row) => row.project_id),
    ...videoDrafts.map((row) => row.project_id), ...editorialContents.map((row) => row.project_id),
    ...imageSessions.map((row) => row.project_id), ...videoSessions.map((row) => row.project_id)]
    .filter((id): id is string => Boolean(id)))].filter((id) => !projects.some((row) => row.id === id))
  if (projectIds.length) {
    const result = await supabase.from('projects').select('id, name, description, context, identity, updated_at')
      .eq('user_id', userId).in('id', projectIds).limit(projectIds.length)
    if (!failed(result)) projects = [...projects, ...(result.data ?? []) as DashboardProject[]]
  }
  const common = { imageDrafts, videoDrafts, editorialContents, projects, productions, imageSessions, videoSessions, linkedImageDraftIds: linkedDraftIds }

  // ---- Phase 3: exact counters for the displayed Productions + latest status of the displayed video Sessions ----------------------
  const displayed = buildRecentProductions({ ...common, limit: DASHBOARD_LIMITS.displayedProductions })
  const firstPassItems = buildRecentWorkItems({ ...common, limit: DASHBOARD_LIMITS.displayedWorkItems })
  const displayedVideoSessionIds = firstPassItems.filter((item) => item.entity === 'video_session').map((item) => item.id)

  const productionById = new Map(productions.map((production) => [production.id, production]))
  const counterFor = async (card: RecentProductionCard): Promise<[string, ProductionCounters]> => {
    const production = productionById.get(card.id)
    if (!production) return [card.id, { imageSessions: null, videoSessions: null, videoDrafts: null, editorial: null }]
    const scoped = (extra?: (query: any) => any) => (query: any) => {
      const narrowed = query.eq('project_id', production.project_id).eq('production_id', production.id)
      return extra ? extra(narrowed) : narrowed
    }
    const [images, videos, edits, editorial] = await Promise.all([
      total('image_generation_sessions', scoped(onlyActive)),
      total('video_generation_sessions', scoped()),
      total('video_drafts', scoped()),
      total('editorial_contents', scoped()),
    ])
    return [card.id, { imageSessions: countOf(images), videoSessions: countOf(videos), videoDrafts: countOf(edits), editorial: countOf(editorial) }]
  }

  const latestStatusFor = async (sessionId: string): Promise<[string, string | null] | null> => {
    const result = (await supabase
      .from('video_generations')
      .select('status')
      .eq('user_id', userId)
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1)) as Result<Array<{ status: string | null }>>
    if (failed(result)) return null
    return [sessionId, result.data?.[0]?.status ?? null]
  }

  const [counterEntries, statusEntries] = await Promise.all([
    Promise.all(displayed.map(counterFor)),
    Promise.all(displayedVideoSessionIds.map(latestStatusFor)),
  ])
  const counters = new Map(counterEntries)
  const videoSessionLatestStatus: Record<string, string | null> = {}
  for (const entry of statusEntries) {
    if (entry) videoSessionLatestStatus[entry[0]] = entry[1]
  }

  const recentProductions = displayed.map((card) => ({ ...card, counters: counters.get(card.id) ?? card.counters }))
  const recentWorkItems = buildRecentWorkItems({ ...common, videoSessionLatestStatus, limit: DASHBOARD_LIMITS.displayedWorkItems })
  const recentProjects = await Promise.all(buildRecentProjects({ projects, productions }).map(async (card) => {
    const result = await total('productions', (query) => query.eq('project_id', card.id))
    return { ...card, productionCount: countOf(result) }
  }))

  // An empty-state claim ("no Projects", "no Productions") is only made when the totals were actually read.
  const emptyState = hasLoadError || stats.projects === null || stats.productions === null
    ? null
    : getDashboardEmptyState({ projectCount: stats.projects, productionCount: stats.productions, recentItemCount: recentWorkItems.length })

  return { recentProductions, recentWorkItems, recentProjects, stats, emptyState, hasLoadError }
}
