import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildImageDraftHubCards,
  buildVideoDraftHubCards,
  draftRoute,
  filterDraftHubCards,
  getDraftHubEmptyState,
  getDraftHubProductionLabel,
  getProductionsForProject,
  productionHref,
  type DraftHubProduction,
  type DraftHubProject,
} from '../draft-hub'
import type { ImageDraft, VideoDraft } from '../types'

const projects: DraftHubProject[] = [
  { id: 'project-1', name: 'Portal Norte' },
  { id: 'project-2', name: 'Project vazio' },
]

const productions: DraftHubProduction[] = [
  {
    id: 'production-1',
    project_id: 'project-1',
    title: 'Criar campanha Portal NortePortal NorteCampanha multimodal',
    intention: 'Criar campanha Portal Norte',
    updated_at: '2026-06-27T11:00:00.000Z',
  },
  {
    id: 'production-2',
    project_id: 'project-2',
    title: 'Production sem drafts',
    intention: 'Organizar entregaveis',
    updated_at: '2026-06-27T09:00:00.000Z',
  },
]

const imageDrafts: Pick<ImageDraft, 'id' | 'project_id' | 'production_id' | 'name' | 'user_input' | 'generated_prompt' | 'image_status' | 'updated_at'>[] = [
  {
    id: 'image-new',
    project_id: 'project-1',
    production_id: 'production-1',
    name: 'Capa Portal Norte',
    user_input: 'Criar capa',
    generated_prompt: 'Prompt',
    image_status: 'draft',
    updated_at: '2026-06-27T12:00:00.000Z',
  },
  {
    id: 'image-legacy',
    project_id: 'project-1',
    production_id: null,
    name: null,
    user_input: 'Imagem legada sem Production',
    generated_prompt: null,
    image_status: null,
    updated_at: '2026-06-27T08:00:00.000Z',
  },
]

const videoDrafts: Pick<VideoDraft, 'id' | 'project_id' | 'production_id' | 'name' | 'scenes' | 'updated_at'>[] = [
  {
    id: 'video-1',
    project_id: 'project-1',
    production_id: 'production-1',
    name: '',
    scenes: [
      { id: 'scene-1', order: 1, description: 'Cena inicial', prompt: null, image_url: null, duration: 3, movement: 'static' },
      { id: 'scene-2', order: 2, description: 'Cena final', prompt: null, image_url: null, duration: 3, movement: 'static' },
    ],
    updated_at: '2026-06-27T10:00:00.000Z',
  },
]

describe('UX-H3B draft hub helpers', () => {
  it('builds image cards with Project, resolved Production and nested routes', () => {
    const [card] = buildImageDraftHubCards({ drafts: imageDrafts, projects, productions })

    expect(card).toMatchObject({
      id: 'image-new',
      title: 'Capa Portal Norte',
      projectName: 'Portal Norte',
      productionName: 'Campanha multimodal',
      href: '/imagens?draft=image-new&project=project-1&production=production-1',
      productionHref: '/projetos/project-1/producoes/production-1',
      meta: 'Prompt gerado',
    })
  })

  it('keeps legacy image drafts without Production safe', () => {
    const cards = buildImageDraftHubCards({ drafts: imageDrafts, projects, productions })
    const legacy = cards.find((card) => card.id === 'image-legacy')

    expect(legacy).toMatchObject({
      title: 'Imagem legada sem Production',
      productionName: null,
      href: '/imagens?draft=image-legacy&project=project-1',
      productionHref: null,
    })
  })

  it('builds video cards without claiming identity is applied', () => {
    const [card] = buildVideoDraftHubCards({ drafts: videoDrafts, projects, productions })

    expect(card).toMatchObject({
      kind: 'video',
      title: 'Rascunho de video',
      meta: '2 cenas',
      href: '/videos?draft=video-1&project=project-1&production=production-1',
    })
  })

  it('filters by Project, Production, status and search', () => {
    const cards = buildImageDraftHubCards({ drafts: imageDrafts, projects, productions })

    expect(filterDraftHubCards(cards, { projectId: 'project-1' })).toHaveLength(2)
    expect(filterDraftHubCards(cards, { productionId: 'production-1' })).toHaveLength(1)
    expect(filterDraftHubCards(cards, { status: 'Rascunho' })).toHaveLength(2)
    expect(filterDraftHubCards(cards, { search: 'legada' })).toHaveLength(1)
  })

  it('returns Productions scoped to the selected Project by recent update', () => {
    expect(getProductionsForProject(productions, 'project-1')).toEqual([productions[0]])
    expect(getProductionsForProject(productions, null)).toEqual([])
  })

  it('resolves Production labels defensively for selectors', () => {
    expect(getDraftHubProductionLabel(productions[0], projects)).toBe('Campanha multimodal')
  })

  it('builds safe empty states for Project and Production prerequisites', () => {
    expect(getDraftHubEmptyState({
      kind: 'image',
      projectCount: 0,
      productionCount: 0,
      totalDraftCount: 0,
      filteredDraftCount: 0,
      hasFilters: false,
    })).toMatchObject({ kind: 'no-projects', href: '/projetos?new=true' })

    expect(getDraftHubEmptyState({
      kind: 'video',
      projectCount: 1,
      productionCount: 0,
      totalDraftCount: 0,
      filteredDraftCount: 0,
      hasFilters: false,
    })).toMatchObject({ kind: 'no-productions', href: '/projetos' })
  })

  it('distinguishes no drafts from no filter results', () => {
    expect(getDraftHubEmptyState({
      kind: 'image',
      projectCount: 1,
      productionCount: 1,
      totalDraftCount: 0,
      filteredDraftCount: 0,
      hasFilters: false,
    })).toMatchObject({ kind: 'no-drafts' })

    expect(getDraftHubEmptyState({
      kind: 'image',
      projectCount: 1,
      productionCount: 1,
      totalDraftCount: 2,
      filteredDraftCount: 0,
      hasFilters: true,
    })).toMatchObject({ kind: 'no-filter-results', actionLabel: 'Limpar filtros' })
  })

  it('does not mutate input objects', () => {
    const projectSnapshot = structuredClone(projects)
    const productionSnapshot = structuredClone(productions)
    const draftSnapshot = structuredClone(imageDrafts)

    buildImageDraftHubCards({ drafts: imageDrafts, projects, productions })
    buildVideoDraftHubCards({ drafts: videoDrafts, projects, productions })

    expect(projects).toEqual(projectSnapshot)
    expect(productions).toEqual(productionSnapshot)
    expect(imageDrafts).toEqual(draftSnapshot)
  })

  it('builds explicit route helpers', () => {
    expect(draftRoute('image', 'draft-1', 'project-1', 'production-1')).toBe(
      '/imagens?draft=draft-1&project=project-1&production=production-1',
    )
    expect(productionHref('project-1', 'production-1')).toBe(
      '/projetos/project-1/producoes/production-1',
    )
  })

  it('keeps global media hubs focused on creation before recent drafts', () => {
    const imagePage = readFileSync(join(process.cwd(), 'app/(dashboard)/imagens/page.tsx'), 'utf8')
    const videoPage = readFileSync(join(process.cwd(), 'app/(dashboard)/videos/page.tsx'), 'utf8')

    expect(imagePage).toContain("'Imagens'")
    expect(videoPage).toContain("'Vídeos'")
    expect(imagePage.indexOf('Criar nova imagem')).toBeLessThan(imagePage.indexOf('Rascunhos recentes'))
    expect(videoPage.indexOf('Criar novo vídeo')).toBeLessThan(videoPage.indexOf('Rascunhos recentes'))
    expect(imagePage).toContain('ViewModeToggle')
    expect(videoPage).toContain('ViewModeToggle')
  })

  it('uses responsive list density for image and video hubs', () => {
    const imagePage = readFileSync(join(process.cwd(), 'app/(dashboard)/imagens/page.tsx'), 'utf8')
    const videoPage = readFileSync(join(process.cwd(), 'app/(dashboard)/videos/page.tsx'), 'utf8')
    const oldDenseGrid = 'md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_120px_150px_170px]'

    for (const source of [imagePage, videoPage]) {
      expect(source).not.toContain(oldDenseGrid)
      expect(source).not.toContain('hidden grid-cols-[minmax(220px,1.4fr)')
      expect(source).not.toContain('2xl:grid-cols-[minmax(220px,1.4fr)')
      expect(source).toContain('grid gap-2 text-sm md:grid-cols-2')
      expect(source).toContain('text-xs text-muted-foreground">Project:')
      expect(source).toContain('text-xs text-muted-foreground">Production:')
      expect(source).toContain('flex flex-wrap gap-2')
      expect(source).not.toContain('<table')
    }
  })
})
