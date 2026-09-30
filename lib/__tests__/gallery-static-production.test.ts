import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildGalleryOutputs, filterGalleryOutputs, type StudioRenderSource } from '@/lib/gallery-output-library'

// GALLERY_PRODUCTION_DERIVATION_DISPLAY_FIX_V1 — a saved static Creative Editor render (LibraryFile, origin='studio_render')
// shows the Production stored in library_files.production_id (migration 048). Synthetic data only.

const PROJECT_A = 'project-a'
const PROJECT_B = 'project-b'

const projects = [
  { id: PROJECT_A, name: 'Portal Comunidades' },
  { id: PROJECT_B, name: 'Outro Projeto' },
]

const productions = [
  { id: 'prod-a1', project_id: PROJECT_A, title: 'Teste Timeline Portal', intention: 'Timeline do portal' },
  { id: 'prod-a2', project_id: PROJECT_A, title: 'O que são Comunidades Alternativas', intention: 'Explicar' },
  { id: 'prod-b1', project_id: PROJECT_B, title: 'Produção do Outro', intention: 'Outro' },
]

function render(overrides: Partial<StudioRenderSource> & { id: string }): StudioRenderSource {
  return {
    project_id: PROJECT_A,
    name: 'slide-1-de-3-abc.png',
    public_url: `https://cdn.example.test/${overrides.id}.png`,
    thumbnail_url: null,
    created_at: '2026-09-28T10:00:00.000Z',
    updated_at: '2026-09-28T10:05:00.000Z',
    origin: 'studio_render',
    kind: 'image',
    deleted_at: null,
    production_id: null,
    ...overrides,
  }
}

const build = (studioRenders: StudioRenderSource[], extra: Partial<Parameters<typeof buildGalleryOutputs>[0]> = {}, prods = productions) =>
  buildGalleryOutputs({ images: [], projects, productions: prods, studioRenders, ...extra })

describe('static studio_render Gallery items use library_files.production_id', () => {
  it('1. a render with production_id shows that Production (name, id, link, alt)', () => {
    const [item] = build([render({ id: 'r1', production_id: 'prod-a1' })])
    expect(item).toMatchObject({ source: 'studio_render', projectId: PROJECT_A, productionId: 'prod-a1', productionName: 'Teste Timeline Portal' })
    expect(item.productionHref).toBe('/projetos/project-a/producoes/prod-a1')
    expect(item.previewAlt).toContain('Teste Timeline Portal')
  })

  it('2. a render with NULL production_id stays unscoped', () => {
    const [item] = build([render({ id: 'r2', production_id: null })])
    expect(item).toMatchObject({ productionId: null, productionName: null, productionHref: null })
    expect(item.previewAlt).not.toContain('Teste Timeline Portal')
  })

  it('an old row without the field at all is unscoped, not an error', () => {
    const legacy = render({ id: 'legacy' }) as Record<string, unknown>
    delete legacy.production_id
    expect(build([legacy as StudioRenderSource])[0]).toMatchObject({ productionId: null, productionName: null })
  })

  it('3. a production_id of ANOTHER Project is never surfaced (fails closed, even though the DB already forbids it)', () => {
    const [item] = build([render({ id: 'r3', project_id: PROJECT_A, production_id: 'prod-b1' })])
    expect(item).toMatchObject({ productionId: null, productionName: null, productionHref: null })
    expect(item.previewAlt).not.toContain('Produção do Outro')
  })

  it('3b. a render with no Project cannot show a Production', () => {
    expect(build([render({ id: 'r3b', project_id: null, production_id: 'prod-a1' })])[0]).toMatchObject({ productionId: null, productionName: null })
  })

  it('4. a deleted Production (FK set NULL, or simply not loaded) is unscoped', () => {
    expect(build([render({ id: 'r4a', production_id: null })])[0].productionName).toBeNull()
    // id still present on the row but the Production is gone from the loaded list
    expect(build([render({ id: 'r4b', production_id: 'prod-deleted' })])[0]).toMatchObject({ productionId: null, productionName: null, productionHref: null })
  })

  it('5. a renamed Production appears under its CURRENT name; the LibraryFile is not touched', () => {
    const file = render({ id: 'r5', production_id: 'prod-a1' })
    const before = JSON.stringify(file)
    const renamed = productions.map((production) => (production.id === 'prod-a1' ? { ...production, title: 'Nome Novo da Production' } : production))
    expect(build([file], {}, renamed)[0].productionName).toBe('Nome Novo da Production')
    expect(JSON.stringify(file)).toBe(before)
  })

  it('6. a folder move does not change the Production (folder is not an input)', () => {
    const base = render({ id: 'r6', production_id: 'prod-a2' })
    const moved = { ...base, folder: '/Projetos/Portal/Outra Pasta', updated_at: '2026-09-29T00:00:00.000Z' } as StudioRenderSource
    expect(build([moved])[0]).toMatchObject({ productionId: 'prod-a2', productionName: 'O que são Comunidades Alternativas' })
  })

  it('7. neither the Project name, a folder/file name, nor "the only Production" is used as a fallback', () => {
    const onlyOne = [productions[0]]
    const named = render({ id: 'r7', production_id: null, name: 'Teste Timeline Portal.png' })
    const [item] = build([named], {}, onlyOne)
    expect(item).toMatchObject({ productionId: null, productionName: null })
    expect(item.productionName).not.toBe('Portal Comunidades')
  })

  it('the Production filter now includes static renders naturally', () => {
    const outputs = build([render({ id: 'r-a1', production_id: 'prod-a1' }), render({ id: 'r-a2', production_id: 'prod-a2' }), render({ id: 'r-null' })])
    expect(filterGalleryOutputs(outputs, { productionId: 'prod-a1' }).map((item) => item.id)).toEqual(['r-a1'])
    expect(filterGalleryOutputs(outputs, { productionId: 'all' })).toHaveLength(3)
    expect(filterGalleryOutputs(outputs, { search: 'Timeline' }).map((item) => item.id)).toEqual(['r-a1'])
  })
})

describe('regressions: nothing else in the Gallery moves', () => {
  const images = [
    { id: 'img-1', project_id: PROJECT_A, user_input: 'Capa', generated_prompt: 'Capa', image_url: 'https://cdn.example.test/i1.png', thumbnail_url: 'https://cdn.example.test/i1t.png', storage_path: null, thumbnail_path: null, status: 'approved', created_at: '2026-09-20T10:00:00.000Z', updated_at: '2026-09-20T11:00:00.000Z' },
    { id: 'img-2', project_id: PROJECT_A, user_input: 'Sem draft', generated_prompt: 'Sem draft', image_url: 'https://cdn.example.test/i2.png', thumbnail_url: null, storage_path: null, thumbnail_path: null, status: 'generated', created_at: '2026-09-21T10:00:00.000Z', updated_at: '2026-09-21T11:00:00.000Z' },
  ] as Parameters<typeof buildGalleryOutputs>[0]['images']
  const drafts = [{ id: 'draft-1', project_id: PROJECT_A, production_id: 'prod-a1', name: 'Capa aprovada', user_input: 'Capa', current_image_id: 'img-1', updated_at: '2026-09-20T11:00:00.000Z' }]
  const videoDrafts = [{ id: 'vd-1', project_id: PROJECT_A, production_id: 'prod-a2', name: 'Teaser', updated_at: '2026-09-22T10:00:00.000Z' }]
  const executions = [{ id: 'exec-1', video_draft_id: 'vd-1', status: 'completed', completed_at: '2026-09-22T10:05:00.000Z', queued_at: '2026-09-22T10:00:00.000Z', kind: 'video' }] as Parameters<typeof buildGalleryOutputs>[0]['executions']
  const statics = [render({ id: 'r1', production_id: 'prod-a1' }), render({ id: 'r2', production_id: null })]

  const without = buildGalleryOutputs({ images, drafts, projects, productions, executions, videoDrafts, studioRenders: [] })
  const withStatic = buildGalleryOutputs({ images, drafts, projects, productions, executions, videoDrafts, studioRenders: statics })

  it('8/9. generated image Production behavior is unchanged (resolved via draft, and unscoped without one)', () => {
    expect(withStatic.find((item) => item.id === 'img-1')).toMatchObject({ productionId: 'prod-a1', productionName: 'Teste Timeline Portal', draftId: 'draft-1' })
    expect(withStatic.find((item) => item.id === 'img-2')).toMatchObject({ productionId: null, productionName: null, draftId: null })
  })

  it('10. completed video render Production behavior is unchanged', () => {
    expect(withStatic.find((item) => item.id === 'exec-1')).toMatchObject({ mediaType: 'video', productionId: 'prod-a2', productionName: 'O que são Comunidades Alternativas', videoPreviewEndpoint: '/api/render-executions/exec-1/output-url' })
  })

  it('11. item count is unchanged by the Production display (same fixture, same items, same order)', () => {
    const staticsWithoutProduction = buildGalleryOutputs({ images, drafts, projects, productions, executions, videoDrafts, studioRenders: statics.map((file) => ({ ...file, production_id: null })) })
    expect(withStatic.map((item) => item.id)).toEqual(staticsWithoutProduction.map((item) => item.id))
    expect(withStatic).toHaveLength(without.length + statics.length)
  })

  it('12/13/14. thumbnails, actions and Project labels of EVERY item are unchanged by the Production field', () => {
    const staticsWithoutProduction = buildGalleryOutputs({ images, drafts, projects, productions, executions, videoDrafts, studioRenders: statics.map((file) => ({ ...file, production_id: null })) })
    const strip = (items: typeof withStatic) => items.map(({ productionId, productionName, productionHref, previewAlt, ...rest }) => rest)
    expect(strip(withStatic)).toEqual(strip(staticsWithoutProduction))
    const staticItem = withStatic.find((item) => item.id === 'r1')!
    expect(staticItem).toMatchObject({ projectName: 'Portal Comunidades', thumbnailUrl: 'https://cdn.example.test/r1.png', canDownload: true, sourceHref: null, source: 'studio_render', mediaType: 'image', status: 'generated' })
  })

  it('image and video items are byte-identical whether or not static renders are present', () => {
    const nonStatic = (items: typeof withStatic) => items.filter((item) => item.source !== 'studio_render')
    expect(nonStatic(withStatic)).toEqual(nonStatic(without))
  })

  it('a trashed or non-image studio_render is still excluded (visibility rules unchanged)', () => {
    const items = build([render({ id: 'trashed', deleted_at: '2026-09-29T00:00:00.000Z', production_id: 'prod-a1' }), render({ id: 'video', kind: 'video', production_id: 'prod-a1' }), render({ id: 'plain', origin: 'upload', production_id: 'prod-a1' })])
    expect(items).toEqual([])
  })
})

describe('query strategy (no N+1) and untouched neighbours', () => {
  const page = readFileSync(join(process.cwd(), 'app/(dashboard)/galeria/page.tsx'), 'utf8').replace(/\r\n/g, '\n')
  // code only: comments may legitimately mention the chain this fix deliberately does NOT use
  const lib = readFileSync(join(process.cwd(), 'lib/gallery-output-library.ts'), 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

  it('15. Productions are loaded ONCE for the whole Gallery and joined in memory (no per-card query)', () => {
    expect(page.match(/\.from\('productions'\)/g)).toHaveLength(1)
    expect(page).not.toMatch(/productions\/\$\{/)
    expect(lib).not.toMatch(/\bfetch\(|supabase|createClient/)
    expect(lib).toMatch(/const productionById = new Map\(productions\.map/)
  })

  it('the static items reuse the same batched list: no extra Production request was added to the page', () => {
    expect(page.match(/fetch\('\/api\/library-files\?origin=studio_render&kind=image'\)/g)).toHaveLength(1)
    expect(page).toMatch(/setStudioRenders\(payload\.files \|\| \[\]\)/)
  })

  it('does not re-derive through ChannelPiece / EditorialContent at display time', () => {
    expect(lib).not.toMatch(/channel_piece|editorial_content|ChannelPiece|EditorialContent/)
  })

  it('16/17. the Library browse route does not depend on the Gallery builder; the I2V chooser shares only the title helper, never the builder or its data', () => {
    const browse = readFileSync(join(process.cwd(), 'app/api/library-files/browse/route.ts'), 'utf8')
    const browser = readFileSync(join(process.cwd(), 'components/videos/i2v-source-browser.tsx'), 'utf8')
    expect(browse).not.toMatch(/gallery-output-library|buildGalleryOutputs/)
    expect(browser).not.toMatch(/buildGalleryOutputs|\/api\/images\/[^b]/)
    expect([...browser.matchAll(/import \{([^}]+)\} from '@\/lib\/gallery-output-library'/g)].map((match) => match[1].trim())).toEqual(['galleryStudioRenderTitle'])
  })
})
