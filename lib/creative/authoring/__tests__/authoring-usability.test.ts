/**
 * Creative Editor — Authoring Usability Completion V1.
 * Assets (slots, origins, Trocar / Usar padrão, hero), frozen identity,
 * Template anatomy, render state (attached / stale), save semantics, Style
 * source honesty, autosave wiring.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  EDITORIAL_DOCUMENTARY_COLLAGE_TEMPLATE,
  getTemplateLayout,
  layoutAssetSlots,
  layoutElementsFrontFirst,
  slotView,
} from '@/lib/creative/templates/template-definitions'
import { previewOverrideAssets, resolveSlotResource, type SlotLibraryFile } from '../asset-slots'
import { authoringReducer } from '../reducer'
import { createInitialAuthoringState, deriveAssetOverridesRequest, deriveManifestFromState } from '../authoring-state'
import { PersistedAuthoredSlideSchema, authoringStateToPersistedSlide, defaultCarouselSlides, persistedSlideToAuthoringState } from '../carousel-state'
import { hydrateRenderJobs, isRenderStale, startRenderJob, attachExecution, applyExecutionUpdate } from '../static-render-jobs'
import { buildStaticRenderExecutionSnapshot, parseStaticRenderExecutionSnapshot } from '@/lib/render-execution/static-snapshot'
import { resolveStaticRuntimeInput } from '@/lib/render-execution/resolve-static-runtime-input'
import { resolveStaticRenderManifest } from '@/lib/creative/resolution/resolve-static-render'
import { IDENTITY_FIXTURES } from '@/lib/creative/identity/fixtures'
import { adaptProjectIdentityToVisualTokens } from '@/lib/creative/integration/project-identity-adapter'
import type { PrimitiveListItem } from '@/lib/creative/primitives/discovery'
import type { AuthoringProductContext } from '../types'

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf-8')
const PAGE = read('app', '(dashboard)', 'projetos', '[id]', 'conteudos', '[editorialContentId]', 'channel-pieces', '[channelPieceId]', 'editar-visual', 'page.tsx')

const template = EDITORIAL_DOCUMENTARY_COLLAGE_TEMPLATE
const cover = getTemplateLayout(template, 'cover')!
const info = getTemplateLayout(template, 'info')!

const HERO_FILE = '6f3a0b3e-2c7b-4c3e-9a51-1f2d3c4b5a69'
const ORNAMENT_FILE = '0c5e2b9d-8a41-4c1f-b0a2-5d6e7f8a9b10'
const PAPER_LF = 'afa6868e-a2d6-473d-9df7-bbf713ad8b02'

const files = new Map<string, SlotLibraryFile>([
  [HERO_FILE, { id: HERO_FILE, name: 'capa-livro.jpg', public_url: 'https://signed.example/capa.jpg', thumbnail_url: null, mime_type: 'image/jpeg', origin: 'upload' }],
  [ORNAMENT_FILE, { id: ORNAMENT_FILE, name: 'slide-1-de-2-abc.png', public_url: 'https://signed.example/render.png', thumbnail_url: null, mime_type: 'image/png', origin: 'studio_render' }],
  [PAPER_LF, { id: PAPER_LF, name: 'paper-card-light-01.png', public_url: 'https://signed.example/paper.png', thumbnail_url: null, mime_type: 'image/png', origin: 'upload' }],
])
const primitives: PrimitiveListItem[] = [
  { key: 'paper-card-light-01', display_name: 'Papel kraft claro', category: 'paper', pack_key: 'organic-collage', pack_version: '0.1.0', version: '0.1.0', scope: 'project', project_ref: 'p', library_file_ref: PAPER_LF },
]

const productContext = {
  projectId: 'project-1', projectName: 'Portal', productionId: null, productionTitle: null, editorialContentId: 'ec', editorialContentTitle: 'EC',
  channelPieceId: 'cp', channel: 'instagram', format: 'carousel', projectIdentity: { schema_version: 1 }, identitySnapshot: IDENTITY_FIXTURES[0],
} as unknown as AuthoringProductContext

describe('Template anatomy (read-only, registry-derived)', () => {
  it('lists the active layout elements front-first straight from the Template', () => {
    expect(layoutElementsFrontFirst(cover).map((element) => element.id)).toEqual([...cover.defaultStackOrder].reverse())
    expect(layoutElementsFrontFirst(cover).map((element) => element.label)).toContain('Imagem principal')
  })

  it('Cover and Info anatomies differ (Hero/Nota only on Cover, Cartões/Fonte only on Info)', () => {
    const coverIds = layoutElementsFrontFirst(cover).map((element) => element.id)
    const infoIds = layoutElementsFrontFirst(info).map((element) => element.id)
    expect(coverIds).toContain('hero')
    expect(coverIds).toContain('note')
    expect(infoIds).not.toContain('hero')
    expect(infoIds).toContain('card1')
    expect(infoIds).toContain('source')
  })

  it('exposes the content image (Imagem principal) as a Cover slot, derived from the element contract', () => {
    const coverSlots = layoutAssetSlots(template, cover).map(({ slot }) => slot.id)
    expect(coverSlots.slice(0, 2)).toEqual(['paper', 'hero'])
    expect(coverSlots).toContain('hero')
    expect(layoutAssetSlots(template, info).map(({ slot }) => slot.id)).not.toContain('hero')
    expect(slotView(template, 'hero')).toMatchObject({ role: 'content', label: 'Imagem principal' })
  })

  it('the page renders the anatomy from the registry, with no second hardcoded structure', () => {
    // CREATIVE_EDITOR_TRUTHFUL_CONSTRAINTS_CLEANUP_V1: both anatomies render inside the collapsed reference disclosure.
    expect(PAGE).toMatch(/<TemplateReference template=\{template\} layout=\{layout\} \/>/)
    const panels = read('components', 'creative', 'authoring', 'inspector-panels.tsx')
    expect(panels).toMatch(/<TemplateFamilyAnatomy template=\{template\} \/>/)
    expect(panels).toMatch(/<TemplateAnatomy template=\{template\} layout=\{layout\} \/>/)
    expect(panels).toMatch(/layoutElementsFrontFirst\(layout\)/)
    expect(panels).toMatch(/layoutAssetSlots\(template, layout\)/)
    expect(panels).not.toMatch(/Adicionar elemento|Excluir elemento|Renomear/)
  })
})

describe('Assets — slot resource and origin', () => {
  const state = createInitialAuthoringState('cover')

  it('a Template default reads as Origem: Template, not replaceable to default', () => {
    const resource = resolveSlotResource(slotView(template, 'ornament'), { ...state, primitiveSelection: {} }, files, primitives)
    expect(resource).toMatchObject({ name: 'Ornamento celeste dourado', origin: 'template', replaced: false, thumbnailUrl: '/creative-fixtures/pack-b/ornament-celestial-gold-01.png' })
  })

  it('the Project primitive (paper) reads as Origem: Projeto with its product name', () => {
    const resource = resolveSlotResource(slotView(template, 'paper'), state, files, primitives)
    expect(resource).toMatchObject({ name: 'Papel kraft claro', origin: 'project', replaced: true, libraryFileId: PAPER_LF })
  })

  it('an override from a saved studio render reads as Imagem gerada; an upload as Projeto', () => {
    const withOverrides = { ...state, assetOverrides: { ornament: { libraryFileId: ORNAMENT_FILE }, hero: { libraryFileId: HERO_FILE } } }
    expect(resolveSlotResource(slotView(template, 'ornament'), withOverrides, files, primitives)).toMatchObject({ origin: 'generated', replaced: true })
    expect(resolveSlotResource(slotView(template, 'hero'), withOverrides, files, primitives)).toMatchObject({ name: 'capa-livro.jpg', origin: 'project', replaced: true })
  })

  it('flags an override whose LibraryFile is no longer available', () => {
    const resource = resolveSlotResource(slotView(template, 'hero'), { ...state, assetOverrides: { hero: { libraryFileId: '11111111-1111-4111-8111-111111111111' } } }, files, primitives)
    expect(resource).toMatchObject({ missing: true, replaced: true })
  })

  it('Trocar persists per slide; Usar padrão removes the override (and the paper/tape catalog choice)', () => {
    let next = authoringReducer(state, { type: 'SET_ASSET_OVERRIDE', slot: 'hero', libraryFileId: HERO_FILE })
    next = authoringReducer(next, { type: 'SET_ASSET_OVERRIDE', slot: 'paper', libraryFileId: HERO_FILE })
    expect(next.assetOverrides).toEqual({ hero: { libraryFileId: HERO_FILE }, paper: { libraryFileId: HERO_FILE } })
    next = authoringReducer(next, { type: 'USE_TEMPLATE_DEFAULT_ASSET', slot: 'paper' })
    expect(next.assetOverrides).toEqual({ hero: { libraryFileId: HERO_FILE } })
    expect(next.primitiveSelection.paper).toBeUndefined()
    expect(next.primitiveSelection.tape).toBe('tape-kraft-short-01')
    next = authoringReducer(next, { type: 'USE_TEMPLATE_DEFAULT_ASSET', slot: 'hero' })
    expect(next.assetOverrides).toBeUndefined()
    expect(resolveSlotResource(slotView(template, 'paper'), next, files, primitives).origin).toBe('template')
  })

  it('persists assetOverrides (hero LibraryFile) through save/reload and rejects invalid shapes', () => {
    const [slide] = defaultCarouselSlides('project:portal-comunidades-alternativas')
    const loaded = persistedSlideToAuthoringState(slide, productContext, 'portrait')
    const edited = authoringReducer(loaded, { type: 'SET_ASSET_OVERRIDE', slot: 'hero', libraryFileId: HERO_FILE })
    const persisted = JSON.parse(JSON.stringify(authoringStateToPersistedSlide(edited, slide.id, slide.order)))
    expect(PersistedAuthoredSlideSchema.safeParse(persisted).success).toBe(true)
    expect(persistedSlideToAuthoringState(persisted, productContext, 'portrait').assetOverrides).toEqual({ hero: { libraryFileId: HERO_FILE } })
    expect(PersistedAuthoredSlideSchema.safeParse({ ...persisted, assetOverrides: { hero: { libraryFileId: 'not-a-uuid' } } }).success).toBe(false)
    expect(PersistedAuthoredSlideSchema.safeParse({ ...persisted, assetOverrides: { villain: { libraryFileId: HERO_FILE } } }).success).toBe(false)
  })

  it('the preview paints overrides with the worker shapes (material: contain; hero: content cover)', () => {
    const overrides = previewOverrideAssets({ ornament: { libraryFileId: ORNAMENT_FILE }, hero: { libraryFileId: HERO_FILE } }, files)
    expect(overrides.materials.ornament).toMatchObject({ ref: ORNAMENT_FILE, source: 'library_file', fit: 'contain', url: 'https://signed.example/render.png' })
    expect(overrides.hero).toMatchObject({ ref: HERO_FILE, source: 'library_file', fit: 'cover' })
  })
})

describe('Render reproducibility — frozen LibraryFile identity', () => {
  const identitySnapshot = IDENTITY_FIXTURES[0]
  const manifestWithHero = (() => {
    const base = deriveManifestFromState(createInitialAuthoringState('cover'), { index: 1, total: 2 })
    return { ...base, assets: { ...base.assets, hero: { type: 'library_file' as const, ref: HERO_FILE, fit: 'cover' as const } } }
  })()
  const frozen = {
    hero: { libraryFileId: HERO_FILE, mimeType: 'image/jpeg', name: 'capa-livro.jpg' },
    ornament: { libraryFileId: ORNAMENT_FILE, mimeType: 'image/png', name: 'slide-1-de-2-abc.png' },
  }
  const rows = [
    { id: HERO_FILE, storage_path: 'users/u/library/capa-livro.jpg', deleted_at: null },
    { id: ORNAMENT_FILE, storage_path: 'users/u/library/render.png', deleted_at: null },
    // A newer file in the same project must never be picked instead.
    { id: '22222222-2222-4222-8222-222222222222', storage_path: 'users/u/library/capa-livro-v2.jpg', deleted_at: null },
  ]

  it('a library_file hero is a valid Cover manifest binding (the enqueue validation path)', () => {
    expect(resolveStaticRenderManifest(manifestWithHero, { identitySnapshot }).valid).toBe(true)
  })

  it('freezes identities in the snapshot and refreshes only URLs at claim time', async () => {
    const snapshot = JSON.parse(JSON.stringify(buildStaticRenderExecutionSnapshot({ manifest: manifestWithHero, identitySnapshot, assetOverrides: frozen, slide: null })))
    expect(parseStaticRenderExecutionSnapshot(snapshot).ok).toBe(true)
    expect(JSON.stringify(snapshot)).not.toMatch(/X-Amz|https:\/\//)
    const first = await resolveStaticRuntimeInput({ rawSnapshot: snapshot, libraryFiles: rows, createPresignedReadUrl: async (path) => `https://signed.example/${path}?t=1` })
    const second = await resolveStaticRuntimeInput({ rawSnapshot: snapshot, libraryFiles: rows, createPresignedReadUrl: async (path) => `https://signed.example/${path}?t=2` })
    if (!first.ok || !second.ok) throw new Error('resolution failed')
    expect(first.staticInput.resolvedInput.resolvedAssets.hero).toMatchObject({ ref: HERO_FILE, source: 'library_file', fit: 'cover', url: 'https://signed.example/users/u/library/capa-livro.jpg?t=1' })
    expect(first.staticInput.primitiveMaterials?.ornament).toMatchObject({ ref: ORNAMENT_FILE, fit: 'contain' })
    expect(second.staticInput.resolvedInput.resolvedAssets.hero.ref).toBe(HERO_FILE)
    expect(second.staticInput.resolvedInput.resolvedAssets.hero.url).toContain('t=2')
  })

  it('fails the claim (never substitutes) when a frozen LibraryFile is gone or foreign', async () => {
    const snapshot = JSON.parse(JSON.stringify(buildStaticRenderExecutionSnapshot({ manifest: manifestWithHero, identitySnapshot, assetOverrides: frozen, slide: null })))
    const result = await resolveStaticRuntimeInput({ rawSnapshot: snapshot, libraryFiles: rows.filter((row) => row.id !== HERO_FILE), createPresignedReadUrl: async () => 'https://signed.example/x' })
    expect(result).toMatchObject({ ok: false, code: 'ASSET_LIBRARY_FILE_UNAVAILABLE' })
  })

  it('rejects a snapshot override with a non-image MIME type', () => {
    const bad = JSON.parse(JSON.stringify(buildStaticRenderExecutionSnapshot({ manifest: manifestWithHero, identitySnapshot, assetOverrides: { hero: { libraryFileId: HERO_FILE, mimeType: 'video/mp4', name: 'x.mp4' } }, slide: null })))
    expect(parseStaticRenderExecutionSnapshot(bad).ok).toBe(false)
  })

  it('the enqueue route validates ownership/project/type before freezing, and binds the Cover hero to it', () => {
    const route = read('app', 'api', 'creative', 'static-authoring', 'render', 'route.ts')
    expect(route).toMatch(/\.from\('library_files'\)[\s\S]*\.in\('id', ids\)[\s\S]*\.eq\('user_id', user\.id\)[\s\S]*\.eq\('project_id', project\.id\)/)
    expect(route).toMatch(/file\.deleted_at \|\| file\.kind !== 'image' \|\| !OVERRIDE_IMAGE_MIME_TYPES\.has/)
    expect(route).toMatch(/ASSET_OVERRIDE_FORBIDDEN/)
    expect(route).toMatch(/hero: \{ type: 'library_file' as const, ref: heroOverride\.libraryFileId, fit: 'cover' as const \}/)
  })

  it('the render request carries only identities (never URLs) for overrides', () => {
    const state = authoringReducer(createInitialAuthoringState('cover'), { type: 'SET_ASSET_OVERRIDE', slot: 'hero', libraryFileId: HERO_FILE })
    expect(deriveAssetOverridesRequest(state)).toEqual({ hero: { libraryFileId: HERO_FILE } })
    expect(deriveAssetOverridesRequest(createInitialAuthoringState('cover'))).toBeUndefined()
    expect(PAGE).toMatch(/\.\.\.\(assetOverrides \? \{ assetOverrides \} : \{\}\)/)
  })
})

describe('Render state — attached, idempotent, stale', () => {
  const slide = { id: 'slide-2', index: 2, total: 2 }
  const execution = (id: string, attached: boolean) => ({ id, status: 'completed' as const, queued_at: '2026-09-24T03:00:00Z', completed_at: '2026-09-24T03:00:20Z', failed_at: null, error_message: null, error_code: null, slide, attached_to_piece: attached })

  it('hydrates an already-attached render as "✓ Salvo nesta peça" (server-authoritative, survives reload)', () => {
    const jobs = hydrateRenderJobs({}, [execution('exec-1', true)], new Set(['slide-2']))
    expect(jobs['slide-2'].save).toBe('saved')
    expect(hydrateRenderJobs({}, [execution('exec-1', false)], new Set(['slide-2']))['slide-2'].save).toBe('idle')
  })

  it('a NEW render is not yet saved to the piece', () => {
    let jobs = hydrateRenderJobs({}, [execution('exec-1', true)], new Set(['slide-2']))
    jobs = startRenderJob(jobs, slide, 1000, 'sig-new')
    jobs = attachExecution(jobs, 'slide-2', 'exec-2', 'queued')
    jobs = applyExecutionUpdate(jobs, { id: 'exec-2', status: 'completed', error_message: null, error_code: null }, 2000)
    expect(jobs['slide-2']).toMatchObject({ executionId: 'exec-2', phase: 'ready', save: 'idle' })
  })

  it('marks the render stale after an authored change and clears on a new render of the current state', () => {
    let jobs = startRenderJob({}, slide, 1000, 'sig-A')
    jobs = attachExecution(jobs, 'slide-2', 'exec-A', 'queued')
    jobs = applyExecutionUpdate(jobs, { id: 'exec-A', status: 'completed', error_message: null, error_code: null }, 2000)
    expect(isRenderStale(jobs['slide-2'], 'sig-A')).toBe(false)
    expect(isRenderStale(jobs['slide-2'], 'sig-B')).toBe(true)
    jobs = startRenderJob(jobs, slide, 3000, 'sig-B')
    expect(isRenderStale(jobs['slide-2'], 'sig-B')).toBe(false) // still rendering: not "stale", just in progress
    jobs = attachExecution(jobs, 'slide-2', 'exec-B', 'queued')
    jobs = applyExecutionUpdate(jobs, { id: 'exec-B', status: 'completed', error_message: null, error_code: null }, 4000)
    expect(isRenderStale(jobs['slide-2'], 'sig-B')).toBe(false)
  })

  it('a hydrated render compares against the state at load (edits after load are provably absent)', () => {
    const jobs = hydrateRenderJobs({}, [execution('exec-1', false)], new Set(['slide-2']), { 'slide-2': 'sig-at-load' })
    expect(isRenderStale(jobs['slide-2'], 'sig-at-load')).toBe(false)
    expect(isRenderStale(jobs['slide-2'], 'sig-after-edit')).toBe(true)
    expect(isRenderStale(hydrateRenderJobs({}, [execution('exec-1', false)], new Set(['slide-2']))['slide-2'], 'x')).toBe(false)
  })

  it('the upload route is idempotent per render execution (no second LibraryFile for the same output)', () => {
    const route = read('app', 'api', 'channel-piece-media', 'upload', 'route.ts')
    const guard = route.indexOf(".eq('source_render_execution_id', renderExecutionId)")
    const upload = route.indexOf('await uploadLibraryFile(')
    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(upload) // checked BEFORE any S3 upload / LibraryFile insert
    expect(route).toMatch(/alreadyAttached: true \}, \{ status: 200 \}/)
    expect(route).toMatch(/reattached: true/)
  })

  it('the executions list reports attached_to_piece from LibraryFile + ChannelPieceMedia (never browser memory)', () => {
    const route = read('app', 'api', 'render-executions', 'route.ts')
    expect(route).toMatch(/\.in\('source_render_execution_id', executions\.map/)
    expect(route).toMatch(/\.eq\('channel_piece_id', channelPieceId\)/)
    expect(route).toMatch(/attached_to_piece: attached\.has\(execution\.id\)/)
  })

  it('the header shows ✓ Salvo nesta peça and the stale hint', () => {
    expect(PAGE).toMatch(/data-testid="render-attached"[^>]*>✓ Salvo nesta peça</)
    expect(PAGE).toMatch(/data-testid="render-stale"[^>]*>Alterações ainda não renderizadas</)
  })
})

describe('Save / restore / render semantics', () => {
  it('names the last-saved action "Voltar ao salvo" (not undo) with an explicit tooltip', () => {
    expect(PAGE).toMatch(/title="Descartar alterações não salvas e restaurar o último estado salvo\."[^>]*><Undo2[^>]*\/>Voltar ao salvo/)
    expect(PAGE).not.toMatch(/\/>Reverter</)
  })

  it('Restaurar padrão do Template is a draft mutation whose confirmation says Save is still required', () => {
    expect(PAGE).toMatch(/Restaurar padrão do Template/)
    // CREATIVE_EDITOR_TRUTHFUL_CONSTRAINTS_CLEANUP_V1: "ao slide atual" in a carousel, "à arte" in a single piece.
    expect(PAGE).toMatch(/Os valores padrão do Template serão aplicados \{isCarousel \? 'ao slide atual' : 'à arte'\}\. Clique em Salvar para persistir\./)
    // restoreSlideDefault only replaces the draft slide; it never calls saveNow().
    const restore = PAGE.slice(PAGE.indexOf('function restoreSlideDefault'), PAGE.indexOf('const previewInput'))
    expect(restore).not.toMatch(/saveNow\(/)
  })

  it('Salvar is enabled only when the draft differs from the saved state', () => {
    expect(PAGE).toMatch(/disabled=\{!dirty && saveStatus !== 'error'\} onClick=\{\(\) => void saveNow\(\)\}/)
    // CREATIVE_EDITOR_FREE_DEFAULT_AND_TEMPLATE_ENTRY_V1: every static format, either mode; before any
    // save the bootstrap (a blank free canvas) is the clean baseline, never an unsaved edit.
    expect(PAGE).toMatch(/const currentSnapshot = units \? persistedSnapshot\(mode, slides, freeSlides, templateId\) : null/)
    expect(PAGE).toMatch(/const dirty = currentSnapshot !== null && currentSnapshot !== \(lastSavedSnapshot \?\? baselineSnapshot\)/)
  })

  it('Gerar PNG never saves authoring state', () => {
    const renderFn = PAGE.slice(PAGE.indexOf('async function render()'), PAGE.indexOf('// Poll every active execution'))
    expect(renderFn).not.toMatch(/saveNow\(|static-authoring-state/)
  })

  it('autosave: OFF by default, same PUT as Salvar after a 600 ms debounce, only when dirty', () => {
    expect(PAGE).toMatch(/window\.localStorage\.getItem\(AUTOSAVE_PREF_KEY\) === 'true'/)
    // The load-time skip is consumed BEFORE the autosave/dirty gate, so it can only ever
    // swallow the hydration run — never the author's first edit after enabling autosave.
    const effect = PAGE.slice(PAGE.indexOf('if (!units) return'), PAGE.indexOf('setTimeout(() => { void saveNow() }, 600)'))
    expect(effect.indexOf('skipNextAutosaveRef.current = false')).toBeGreaterThan(-1)
    expect(effect.indexOf('skipNextAutosaveRef.current = false')).toBeLessThan(effect.indexOf('if (!autosaveEnabled || !dirty) return'))
    expect(PAGE).toMatch(/setTimeout\(\(\) => \{ void saveNow\(\) \}, 600\)/)
  })
})

describe('Estilo — honest source of truth', () => {
  it('the adapter ignores Project Identity for typography/colors today (Studio defaults)', () => {
    const a = adaptProjectIdentityToVisualTokens('p1', { schema_version: 1, expression: { visual_identity: 'A' } } as never)
    const b = adaptProjectIdentityToVisualTokens('p1', { schema_version: 1, expression: { visual_identity: 'totally different' } } as never)
    expect(a.typography).toEqual(b.typography)
    expect(a.colors).toEqual(b.colors)
  })

  it('the Estilo panel says so and never claims Project Identity inheritance', () => {
    const panels = read('components', 'creative', 'authoring', 'inspector-panels.tsx')
    const style = panels.slice(panels.indexOf('export function StyleSourcePanel'))
    expect(style).toMatch(/Padrão do Studio\./)
    expect(style).toMatch(/A Identidade do Projeto ainda não define tipografia nem cores visuais; estes valores não vêm dela\./)
    expect(PAGE).not.toMatch(/Tipografia e cores vêm da Identidade do Projeto/)
  })
})
