import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildGalleryOutputs,
  filterGalleryOutputs,
  GALLERY_SIGNED_URL_TIMEOUT_MS,
  getGalleryEmptyState,
  getGalleryProductionsForProject,
  isGeneratedVisualOutput,
  resolveGalleryDisplayImages,
  resolveGalleryOutputStatus,
  type GalleryOutputItem,
} from '../gallery-output-library'
import type { Image, ImageDraft, Production, Project } from '../types'

const projects: Pick<Project, 'id' | 'name'>[] = [
  { id: 'project-1', name: 'Portal Norte' },
  { id: 'project-2', name: 'Project sem outputs' },
]

const productions: Pick<Production, 'id' | 'project_id' | 'title' | 'intention'>[] = [
  {
    id: 'production-1',
    project_id: 'project-1',
    title: 'Criar campanha Portal NortePortal NorteCampanha multimodal',
    intention: 'Criar campanha Portal Norte',
  },
  {
    id: 'production-2',
    project_id: 'project-2',
    title: 'Production vazia',
    intention: 'Organizar entregaveis',
  },
]

const images: Pick<
  Image,
  | 'id'
  | 'project_id'
  | 'user_input'
  | 'generated_prompt'
  | 'image_url'
  | 'thumbnail_url'
  | 'storage_path'
  | 'thumbnail_path'
  | 'status'
  | 'created_at'
  | 'updated_at'
>[] = [
  {
    id: 'image-approved',
    project_id: 'project-1',
    user_input: 'Capa editorial do Portal Norte',
    generated_prompt: 'Editorial cover with natural light',
    image_url: 'https://example.com/approved.png',
    thumbnail_url: 'https://example.com/approved-thumb.png',
    storage_path: null,
    thumbnail_path: null,
    status: 'approved',
    created_at: '2026-06-27T11:00:00.000Z',
    updated_at: '2026-06-27T12:00:00.000Z',
  },
  {
    id: 'image-generated',
    project_id: 'project-1',
    user_input: 'Imagem gerada em revisao',
    generated_prompt: null,
    image_url: 'https://example.com/generated.png',
    thumbnail_url: null,
    storage_path: null,
    thumbnail_path: null,
    status: 'draft',
    created_at: '2026-06-27T09:00:00.000Z',
    updated_at: '2026-06-27T10:00:00.000Z',
  },
  {
    id: 'image-no-asset',
    project_id: 'project-1',
    user_input: 'Prompt sem imagem',
    generated_prompt: null,
    image_url: null,
    thumbnail_url: null,
    storage_path: null,
    thumbnail_path: null,
    status: 'draft',
    created_at: '2026-06-27T08:00:00.000Z',
    updated_at: '2026-06-27T08:30:00.000Z',
  },
  {
    id: 'image-storage-only',
    project_id: 'project-1',
    user_input: '',
    generated_prompt: 'Stored output',
    image_url: null,
    thumbnail_url: null,
    storage_path: 'images/stored.png',
    thumbnail_path: null,
    status: 'rejected',
    created_at: '2026-06-27T07:00:00.000Z',
    updated_at: '2026-06-27T07:30:00.000Z',
  },
]

const drafts: Pick<
  ImageDraft,
  'id' | 'project_id' | 'production_id' | 'name' | 'user_input' | 'current_image_id' | 'updated_at'
>[] = [
  {
    id: 'draft-1',
    project_id: 'project-1',
    production_id: 'production-1',
    name: 'Capa aprovada',
    user_input: 'Criar capa',
    current_image_id: 'image-approved',
    updated_at: '2026-06-27T12:10:00.000Z',
  },
  {
    id: 'draft-legacy',
    project_id: 'project-1',
    production_id: null,
    name: null,
    user_input: 'Legado sem Production',
    current_image_id: 'image-generated',
    updated_at: '2026-06-27T10:10:00.000Z',
  },
]

function buildOutputs() {
  return buildGalleryOutputs({ images, drafts, projects, productions })
}

describe('UX-H3C gallery output library helpers', () => {
  it('lists only real visual outputs and excludes prompts without assets', () => {
    expect(isGeneratedVisualOutput(images[0])).toBe(true)
    expect(isGeneratedVisualOutput(images[2])).toBe(false)

    const outputs = buildOutputs()

    expect(outputs.map((output) => output.id)).toEqual([
      'image-approved',
      'image-generated',
      'image-storage-only',
    ])
  })

  it('enriches outputs with Project, Production, source and Production routes', () => {
    const [output] = buildOutputs()

    expect(output).toMatchObject({
      title: 'Capa aprovada',
      projectName: 'Portal Norte',
      productionName: 'Campanha multimodal',
      sourceHref: '/imagens?draft=draft-1&project=project-1&production=production-1',
      productionHref: '/projetos/project-1/producoes/production-1',
    })
  })

  it('keeps legacy outputs without Production safe', () => {
    const legacy = buildOutputs().find((output) => output.id === 'image-generated')

    expect(legacy).toMatchObject({
      projectName: 'Portal Norte',
      productionName: null,
      productionHref: null,
      sourceHref: '/imagens?draft=draft-legacy&project=project-1',
    })
  })

  it('uses output status labels without calling generated assets rascunhos', () => {
    expect(resolveGalleryOutputStatus('draft')).toBe('generated')
    expect(resolveGalleryOutputStatus('approved')).toBe('approved')

    const outputs = buildOutputs()
    const generated = outputs.find((output) => output.id === 'image-generated')

    expect(generated?.statusLabel).toBe('Gerada')
  })

  it('orders outputs by recent update', () => {
    expect(buildOutputs().map((output) => output.id)).toEqual([
      'image-approved',
      'image-generated',
      'image-storage-only',
    ])
  })

  it('filters by Project, Production, status and search', () => {
    const outputs = buildOutputs()

    expect(filterGalleryOutputs(outputs, { projectId: 'project-1' })).toHaveLength(3)
    expect(filterGalleryOutputs(outputs, { productionId: 'production-1' })).toHaveLength(1)
    expect(filterGalleryOutputs(outputs, { status: 'approved' })).toHaveLength(1)
    expect(filterGalleryOutputs(outputs, { search: 'aprovada' })).toHaveLength(1)
  })

  it('scopes Production options to the selected Project', () => {
    expect(getGalleryProductionsForProject(productions, 'project-1')).toEqual([productions[0]])
    expect(getGalleryProductionsForProject(productions, 'all')).toEqual(productions)
  })

  it('returns distinct empty states for no Project, no outputs and filters', () => {
    expect(getGalleryEmptyState({
      projectCount: 0,
      outputCount: 0,
      filteredCount: 0,
      hasFilters: false,
    })).toMatchObject({ kind: 'no-projects', href: '/projetos?new=true' })

    expect(getGalleryEmptyState({
      projectCount: 1,
      outputCount: 0,
      filteredCount: 0,
      hasFilters: false,
    })).toMatchObject({ kind: 'no-outputs', href: '/imagens' })

    expect(getGalleryEmptyState({
      projectCount: 1,
      outputCount: 2,
      filteredCount: 0,
      hasFilters: true,
    })).toMatchObject({ kind: 'no-filter-results', href: null })
  })

  it('exposes download only when a downloadable URL exists', () => {
    const outputs = buildOutputs()
    const approved = outputs.find((output) => output.id === 'image-approved') as GalleryOutputItem
    const storageOnly = outputs.find((output) => output.id === 'image-storage-only') as GalleryOutputItem

    expect(approved.canDownload).toBe(true)
    expect(storageOnly.canDownload).toBe(false)
  })

  it('does not mutate input objects', () => {
    const imageSnapshot = structuredClone(images)
    const draftSnapshot = structuredClone(drafts)
    const projectSnapshot = structuredClone(projects)
    const productionSnapshot = structuredClone(productions)

    buildOutputs()

    expect(images).toEqual(imageSnapshot)
    expect(drafts).toEqual(draftSnapshot)
    expect(projects).toEqual(projectSnapshot)
    expect(productions).toEqual(productionSnapshot)
  })

  it('keeps Galeria positioned as outputs while Imagens remains creation and drafts', () => {
    const galleryPage = readFileSync(join(process.cwd(), 'app/(dashboard)/galeria/page.tsx'), 'utf8')

    expect(galleryPage).toContain('Explore imagens geradas nos seus Projects e Productions.')
    expect(galleryPage).toContain('Outputs gerados')
    expect(galleryPage).not.toContain('Criar nova imagem')
    expect(galleryPage).toContain("from('images')")
    expect(galleryPage).toContain("from('image_drafts')")
    expect(galleryPage).not.toContain('Rascunhos')
  })

  it('does not keep a permanent creation CTA in the Galeria header', () => {
    const galleryPage = readFileSync(join(process.cwd(), 'app/(dashboard)/galeria/page.tsx'), 'utf8')

    expect(galleryPage).not.toContain('Criar nova imagem')
    expect(galleryPage).toContain('Ir para Imagens')
    expect(getGalleryEmptyState({
      projectCount: 1,
      outputCount: 0,
      filteredCount: 0,
      hasFilters: false,
    })).toMatchObject({ kind: 'no-outputs', href: '/imagens' })
  })

  it('uses Cards as the default Galeria view with a dedicated persisted preference', () => {
    const galleryPage = readFileSync(join(process.cwd(), 'app/(dashboard)/galeria/page.tsx'), 'utf8')

    expect(galleryPage).toContain("useViewModePreference('gallery-output-view', 'card')")
    expect(galleryPage).toContain('ViewModeToggle')
    expect(galleryPage).toContain("viewMode === 'card'")
    expect(galleryPage).toContain('GalleryOutputListItem')
    expect(galleryPage).not.toContain('image-draft-hub-view')
    expect(galleryPage).not.toContain('video-draft-hub-view')
  })

  it('keeps filters, ordering and actions equivalent between Cards and Lista', () => {
    const outputs = buildOutputs()
    const filtered = filterGalleryOutputs(outputs, {
      projectId: 'project-1',
      status: 'approved',
    })

    expect(filtered.map((output) => output.id)).toEqual(['image-approved'])

    const galleryPage = readFileSync(join(process.cwd(), 'app/(dashboard)/galeria/page.tsx'), 'utf8')
    expect(galleryPage).toContain('GalleryOutputCard')
    expect(galleryPage).toContain('GalleryOutputListItem')
    expect(galleryPage.match(/Visualizar/g)?.length).toBeGreaterThanOrEqual(2)
    expect(galleryPage.match(/Ver Production/g)?.length).toBeGreaterThanOrEqual(2)
    expect(galleryPage.match(/Baixar/g)?.length).toBeGreaterThanOrEqual(2)
  })

  it('keeps the Lista responsive without a horizontal table', () => {
    const galleryPage = readFileSync(join(process.cwd(), 'app/(dashboard)/galeria/page.tsx'), 'utf8')
    const oldDenseGrid = 'lg:grid-cols-[72px_minmax(180px,1.3fr)_minmax(120px,0.8fr)_minmax(120px,0.8fr)_100px_120px_220px]'

    expect(galleryPage).not.toContain('<table')
    expect(galleryPage).not.toContain(oldDenseGrid)
    expect(galleryPage).toContain('hidden grid-cols-[72px_minmax(180px,1.2fr)')
    expect(galleryPage).toContain('md:grid-cols-[72px_minmax(0,1fr)]')
    expect(galleryPage).toContain('md:row-span-3 2xl:row-auto')
    expect(galleryPage).toContain('md:grid-cols-2 2xl:contents')
    expect(galleryPage).toContain('2xl:hidden">Project:')
    expect(galleryPage).toContain('2xl:grid')
    expect(galleryPage).toContain('Sem Production associada')
  })

  it('keeps Galeria in a two-phase layout at intermediate widths and wraps actions safely', () => {
    const galleryPage = readFileSync(join(process.cwd(), 'app/(dashboard)/galeria/page.tsx'), 'utf8')

    expect(galleryPage).toContain("useViewModePreference('gallery-output-view', 'card')")
    expect(galleryPage).toContain('2xl:grid-cols-[72px_minmax(180px,1.2fr)')
    expect(galleryPage).toContain('flex flex-col gap-2 sm:flex-row sm:flex-wrap 2xl:justify-end')
    expect(galleryPage).toContain('sm:min-w-max sm:w-auto')
    expect(galleryPage).not.toContain('xl:grid-cols-[72px_minmax(170px,1.2fr)')
  })

  it('uses a responsive filter grid that keeps clear filters inside the layout', () => {
    const galleryPage = readFileSync(join(process.cwd(), 'app/(dashboard)/galeria/page.tsx'), 'utf8')

    expect(galleryPage).toContain('md:grid-cols-2 2xl:grid-cols-[minmax(220px,1.4fr)')
    expect(galleryPage).toContain('md:col-span-2 2xl:col-span-1')
    expect(galleryPage).toContain('md:justify-self-end 2xl:col-span-1 2xl:self-end')
    expect(galleryPage).not.toContain('md:grid-cols-[minmax(180px,1.4fr)')
  })

  it('resolves signed image URLs without letting a stalled request block loading forever', async () => {
    const resolved = await resolveGalleryDisplayImages(
      images.slice(0, 2),
      async (image) => {
        if (image.id === 'image-approved') {
          return {
            ...image,
            image_url: 'https://example.com/signed-approved.png',
          }
        }

        return await new Promise<typeof image>(() => {})
      },
      5,
    )

    expect(resolved).toEqual([
      {
        ...images[0],
        image_url: 'https://example.com/signed-approved.png',
      },
      images[1],
    ])
  })

  it('falls back safely when signed image resolution fails', async () => {
    const resolved = await resolveGalleryDisplayImages(
      images.slice(0, 1),
      async () => {
        throw new Error('network failed')
      },
      GALLERY_SIGNED_URL_TIMEOUT_MS,
    )

    expect(resolved).toEqual([images[0]])
  })
})
