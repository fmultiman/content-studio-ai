import { describe, expect, it } from 'vitest'
import {
  buildRecentProductions,
  buildRecentProjects,
  buildRecentWorkItems,
  getDashboardEmptyState,
  productionPath,
  type DashboardEditorialContent,
  type DashboardImageDraft,
  type DashboardProduction,
  type DashboardProject,
  type DashboardVideoDraft,
} from '../dashboard-continuation'

const projects: DashboardProject[] = [
  {
    id: 'project-1',
    name: 'Portal Norte',
    description: 'Project principal',
    context: 'Contexto legado',
    identity: null,
    updated_at: '2026-06-26T10:00:00.000Z',
  },
  {
    id: 'project-2',
    name: 'Project sem Production',
    description: null,
    context: null,
    identity: null,
    updated_at: '2026-06-25T10:00:00.000Z',
  },
]

const productions: DashboardProduction[] = [
  {
    id: 'production-1',
    project_id: 'project-1',
    title: 'Criar campanha Portal NortePortal NorteCampanha multimodal',
    intention: 'Criar campanha Portal Norte',
    type: 'campaign',
    updated_at: '2026-06-26T09:00:00.000Z',
  },
  {
    id: 'production-2',
    project_id: 'project-1',
    title: 'Serie editorial',
    intention: 'Organizar posts da semana',
    type: 'editorial',
    updated_at: '2026-06-26T08:00:00.000Z',
  },
]

const imageDrafts: DashboardImageDraft[] = [
  {
    id: 'image-1',
    project_id: 'project-1',
    production_id: 'production-1',
    name: 'Capa Portal Norte',
    user_input: 'Criar uma capa',
    image_status: 'draft',
    updated_at: '2026-06-26T12:00:00.000Z',
  },
  {
    id: 'image-legacy',
    project_id: 'project-1',
    production_id: null,
    name: null,
    user_input: 'Imagem sem Production',
    image_status: 'draft',
    updated_at: '2026-06-26T07:00:00.000Z',
  },
]

const videoDrafts: DashboardVideoDraft[] = [
  {
    id: 'video-1',
    project_id: 'project-1',
    production_id: 'production-1',
    name: 'Teaser Portal Norte',
    updated_at: '2026-06-26T11:00:00.000Z',
  },
]

const editorialContents: DashboardEditorialContent[] = [
  {
    id: 'content-1',
    project_id: 'project-1',
    production_id: 'production-1',
    title: 'Lancamento editorial',
    status: 'draft',
    updated_at: '2026-06-26T10:30:00.000Z',
  },
  {
    id: 'content-legacy',
    project_id: 'project-2',
    production_id: null,
    title: 'Conteudo sem Production',
    status: 'ready',
    updated_at: '2026-06-26T09:30:00.000Z',
  },
]

describe('UX-H3A Dashboard continuation helpers', () => {
  it('prioritizes recent Productions by real related activity', () => {
    const cards = buildRecentProductions({
      productions,
      projects,
      imageDrafts,
      videoDrafts,
      editorialContents,
    })

    expect(cards[0].id).toBe('production-1')
    expect(cards[0].activityAt).toBe('2026-06-26T12:00:00.000Z')
  })

  it('shows resolved Production title and Project context', () => {
    const [card] = buildRecentProductions({
      productions,
      projects,
      imageDrafts,
      videoDrafts,
      editorialContents,
    })

    expect(card.title).toBe('Campanha multimodal')
    expect(card.projectName).toBe('Portal Norte')
    expect(card.intention).toBe('Criar campanha Portal Norte')
  })

  it('opens a Production through the nested Project route', () => {
    expect(productionPath('project-1', 'production-1')).toBe(
      '/projetos/project-1/producoes/production-1',
    )
  })

  it('counts related image, video and editorial work per Production', () => {
    const [card] = buildRecentProductions({
      productions,
      projects,
      imageDrafts,
      videoDrafts,
      editorialContents,
    })

    expect(card.counters).toEqual({
      images: 1,
      videos: 1,
      editorial: 1,
    })
  })

  it('builds recent work item links preserving Project and Production context', () => {
    const items = buildRecentWorkItems({
      imageDrafts,
      videoDrafts,
      editorialContents,
      projects,
      productions,
    })

    expect(items[0]).toMatchObject({
      id: 'image-1',
      href: '/imagens?draft=image-1&project=project-1&production=production-1',
      productionName: 'Campanha multimodal',
    })
  })

  it('keeps content without Production safe and does not invent a Production link', () => {
    const items = buildRecentWorkItems({
      imageDrafts,
      videoDrafts,
      editorialContents,
      projects,
      productions,
    })
    const legacyContent = items.find((item) => item.id === 'content-legacy')

    expect(legacyContent).toMatchObject({
      productionName: null,
      href: '/projetos/project-2/conteudos/content-legacy',
    })
  })

  it('builds recent Project cards with Production counts and identity status', () => {
    const recentProjects = buildRecentProjects({ projects, productions })

    expect(recentProjects[0]).toMatchObject({
      id: 'project-1',
      productionCount: 2,
      identityLabel: 'Contexto legado',
      href: '/projetos/project-1',
    })
  })

  it('returns an empty state for users without Projects', () => {
    expect(getDashboardEmptyState({
      projectCount: 0,
      productionCount: 0,
      recentItemCount: 0,
    })).toMatchObject({
      kind: 'no-projects',
      href: '/projetos?new=true',
    })
  })

  it('returns an empty state for Projects without Productions', () => {
    expect(getDashboardEmptyState({
      projectCount: 1,
      productionCount: 0,
      recentItemCount: 0,
    })).toMatchObject({
      kind: 'no-productions',
      href: '/projetos',
    })
  })

  it('does not keep an empty recent activity panel when no recent items exist', () => {
    expect(getDashboardEmptyState({
      projectCount: 1,
      productionCount: 1,
      recentItemCount: 0,
    })).toMatchObject({
      kind: 'no-recent-items',
      actionLabel: 'Continuar Production',
    })
  })

  it('does not mutate input objects', () => {
    const projectSnapshot = structuredClone(projects)
    const productionSnapshot = structuredClone(productions)
    const imageSnapshot = structuredClone(imageDrafts)

    buildRecentProductions({
      productions,
      projects,
      imageDrafts,
      videoDrafts,
      editorialContents,
    })
    buildRecentWorkItems({
      imageDrafts,
      videoDrafts,
      editorialContents,
      projects,
      productions,
    })

    expect(projects).toEqual(projectSnapshot)
    expect(productions).toEqual(productionSnapshot)
    expect(imageDrafts).toEqual(imageSnapshot)
  })
})
