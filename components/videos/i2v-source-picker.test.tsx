// @vitest-environment jsdom
// VIDEO_I2V_SOURCE_BROWSER_V1 — the compact field + Image Source browser (Geradas por IA | Galeria | Arquivos | Enviar).
import { useState } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { i2vSourceFields, type I2vSourceSelection } from '@/lib/video-generation/i2v-source'
import { IMAGE_REFERENCE_MAX_BYTES, type ImageSourceProfile } from '@/lib/media-source/profile'
import {
  PROD_CURRENT,
  PROD_OTHER,
  PROJECT,
  OTHER_PROJECT,
  aiRow,
  deferred,
  freshState,
  installI2vFetch,
  libraryRow,
  type I2vFixtureState,
} from '@/lib/__tests__/helpers/i2v-source-fixtures'

let state: I2vFixtureState

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        then: (resolve: (value: unknown) => void) => resolve({ data: state.productions }),
      }
      return chain
    },
  }),
}))

import { I2vSourcePicker } from './i2v-source-picker'

let changes: Array<I2vSourceSelection | null> = []

function Harness({ projectId = PROJECT, productionId = PROD_CURRENT, profile }: { projectId?: string; productionId?: string | null; profile?: ImageSourceProfile }) {
  const [value, setValue] = useState<I2vSourceSelection | null>(null)
  return (
    <>
      <I2vSourcePicker
        profile={profile}
        projectId={projectId}
        productionId={productionId}
        value={value}
        onChange={(next) => {
          changes.push(next)
          setValue(next)
        }}
      />
      <output data-testid="request-fields">{JSON.stringify(i2vSourceFields('image_to_video', value?.source ?? null))}</output>
    </>
  )
}

beforeAll(() => {
  const proto = window.HTMLElement.prototype as any
  proto.hasPointerCapture ??= () => false
  proto.setPointerCapture ??= () => undefined
  proto.releasePointerCapture ??= () => undefined
  proto.scrollIntoView ??= () => undefined
  ;(window as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }
})

let fetchMock: ReturnType<typeof installI2vFetch>
beforeEach(() => {
  state = freshState()
  changes = []
  fetchMock = installI2vFetch(state)
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const open = async () => {
  render(<Harness />)
  fireEvent.click(screen.getByTestId('i2v-source-choose'))
  await screen.findByTestId('i2v-source-browser')
}
const tab = (name: 'ai' | 'gallery' | 'library' | 'upload') => fireEvent.click(screen.getByTestId(`i2v-source-tab-${name}`))
const fields = () => JSON.parse(screen.getByTestId('request-fields').textContent || '{}')
const browseRequests = (scope: string) => state.requests.filter((url) => url.startsWith('/api/library-files/browse?') && new URL(url, 'http://x').searchParams.get('scope') === scope)
const lastParams = (scope: string) => new URL(browseRequests(scope).at(-1)!, 'http://x').searchParams

const chooseProduction = async (label: string | RegExp) => {
  fireEvent.keyDown(screen.getByTestId('i2v-source-production-filter'), { key: 'Enter' })
  fireEvent.click(await screen.findByRole('option', { name: label }))
}

describe('image-reference profile on the shared chooser', () => {
  const openReference = async () => {
    render(<Harness profile="image-reference" />)
    fireEvent.click(screen.getByTestId('i2v-source-choose'))
    await screen.findByTestId('i2v-source-browser')
  }

  it('passes the explicit profile to generated images and Library browse', async () => {
    state.ai = [aiRow('webp', { mime_type: 'image/webp' })]
    state.library = [libraryRow('ref-webp', { mime_type: 'image/webp', production_id: PROD_CURRENT })]
    await openReference()
    await screen.findByTestId('i2v-ai-option-webp')
    expect(state.requests).toContain(`/api/images/browse?projectId=${PROJECT}&profile=image-reference`)
    tab('library')
    await screen.findByTestId('i2v-library-option-ref-webp')
    expect(lastParams('arquivos').get('format')).toBe('image-reference')
    fireEvent.click(screen.getByTestId('i2v-library-option-ref-webp'))
    expect(changes.at(-1)?.source).toEqual({ type: 'library', id: 'ref-webp' })
  })

  it('uploads WebP durably through S3 and Library registration with Project/profile context', async () => {
    await openReference()
    tab('upload')
    await waitFor(() => expect(screen.getByTestId('i2v-upload-destination').textContent).toContain('Maitê'))
    const input = screen.getByTestId('i2v-upload-input')
    expect(input.getAttribute('accept')).toBe('image/png,image/jpeg,image/webp')
    fireEvent.change(input, { target: { files: [new File(['webp'], 'referencia.webp', { type: 'image/webp' })] } })
    await waitFor(() => expect(changes.at(-1)?.source).toEqual({ type: 'library', id: 'lib-uploaded' }))
    expect(state.uploads.presign).toMatchObject({ folder: 'library', profile: 'image-reference', projectId: PROJECT, mimeType: 'image/webp', fileSize: 4 })
    expect(state.uploads.put?.type).toBe('image/webp')
    expect(state.uploads.save).toMatchObject({ projectId: PROJECT, profile: 'image-reference', mimeType: 'image/webp', storageProvider: 's3' })
  })

  it('accepts exactly 10 MiB and refuses larger references before any upload request', async () => {
    await openReference()
    tab('upload')
    await waitFor(() => expect(screen.getByTestId('i2v-upload-destination').textContent).toContain('Maitê'))
    const input = screen.getByTestId('i2v-upload-input')
    const tooLarge = new File(['x'], 'big.png', { type: 'image/png' })
    Object.defineProperty(tooLarge, 'size', { value: IMAGE_REFERENCE_MAX_BYTES + 1 })
    fireEvent.change(input, { target: { files: [tooLarge] } })
    expect(screen.getByRole('alert').textContent).toContain('10 MiB')
    expect(state.uploads.presign).toBeUndefined()
    const atLimit = new File(['x'], 'limit.png', { type: 'image/png' })
    Object.defineProperty(atLimit, 'size', { value: IMAGE_REFERENCE_MAX_BYTES })
    fireEvent.change(input, { target: { files: [atLimit] } })
    await waitFor(() => expect(state.uploads.save?.fileSize).toBe(IMAGE_REFERENCE_MAX_BYTES))
  })
})

describe('compact field', () => {
  it('15. the browser is collapsed initially: only "Escolher uma imagem", no grid and no request', () => {
    render(<Harness />)
    expect(screen.getByTestId('i2v-source-choose').textContent).toContain('Escolher uma imagem')
    expect(screen.queryByTestId('i2v-source-browser')).toBeNull()
    expect(state.requests).toEqual([])
  })

  it('16. "Escolher uma imagem" opens the browser with the four categories, by their full names', async () => {
    await open()
    expect(['ai', 'gallery', 'library', 'upload'].map((entry) => screen.getByTestId(`i2v-source-tab-${entry}`).textContent)).toEqual(['Geradas por IA', 'Galeria', 'Arquivos', 'Enviar'])
    expect(screen.getByRole('tab', { name: 'Geradas por IA' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tablist', { name: 'Origem da imagem' })).toBeTruthy()
  })

  it('17. switching category shows that category’s panel', async () => {
    await open()
    for (const entry of ['gallery', 'library', 'upload', 'ai'] as const) {
      tab(entry)
      expect(screen.getByTestId(`i2v-source-panel-${entry}`)).toBeTruthy()
      expect(screen.getByTestId(`i2v-source-tab-${entry}`).getAttribute('aria-selected')).toBe('true')
    }
  })

  it('18/19. choosing an image collapses the browser and shows a compact summary (thumbnail, name, origin)', async () => {
    await open()
    fireEvent.click(await screen.findByTestId('i2v-ai-option-img-1'))
    expect(screen.queryByTestId('i2v-source-browser')).toBeNull()
    expect(screen.queryByTestId('i2v-source-choose')).toBeNull()
    const summary = screen.getByTestId('i2v-source-summary')
    expect(summary.getAttribute('data-category')).toBe('ai')
    expect(screen.getByTestId('i2v-source-summary-name').textContent).toBe('Imagem IA img-1')
    expect(screen.getByTestId('i2v-source-summary-category').textContent).toBe('Gerada por IA')
    expect(within(summary).getByRole('img', { name: /Imagem de origem/ })).toBeTruthy()
  })

  it('20. "Trocar" reopens the browser with the current choice marked', async () => {
    await open()
    fireEvent.click(await screen.findByTestId('i2v-ai-option-img-1'))
    fireEvent.click(screen.getByTestId('i2v-source-change'))
    const option = await screen.findByTestId('i2v-ai-option-img-1')
    expect(option.getAttribute('aria-pressed')).toBe('true')
  })

  it('21. the remove action clears the source', async () => {
    await open()
    fireEvent.click(await screen.findByTestId('i2v-ai-option-img-1'))
    fireEvent.click(screen.getByTestId('i2v-source-clear'))
    expect(screen.getByTestId('i2v-source-choose')).toBeTruthy()
    expect(fields()).toEqual({})
    expect(changes.at(-1)).toBeNull()
  })

  it('"Fechar" collapses without choosing', async () => {
    await open()
    fireEvent.click(screen.getByTestId('i2v-source-close'))
    expect(screen.queryByTestId('i2v-source-browser')).toBeNull()
    expect(changes).toEqual([])
  })

  it('45. every control of the chooser is a type="button" (nothing can submit the generation form)', async () => {
    await open()
    tab('library')
    await screen.findByTestId('i2v-source-filters')
    const offenders = [...document.querySelectorAll('button')].filter((button) => button.getAttribute('type') !== 'button')
    expect(offenders.map((button) => button.textContent)).toEqual([])
  })
})

describe('Geradas por IA', () => {
  it('26/9. lists the Project’s generated images from `images` only (one endpoint, Project only)', async () => {
    state.ai = [aiRow('img-1'), aiRow('img-x', { project_id: OTHER_PROJECT })]
    await open()
    await screen.findByTestId('i2v-ai-option-img-1')
    expect(screen.queryByTestId('i2v-ai-option-img-x')).toBeNull()
    expect(state.requests.filter((url) => url.startsWith('/api/images/browse'))).toEqual([`/api/images/browse?projectId=${PROJECT}`])
    expect(state.requests.some((url) => url.startsWith('/api/library-files'))).toBe(false)
  })

  it('9. selecting one submits source_image_id only', async () => {
    await open()
    fireEvent.click(await screen.findByTestId('i2v-ai-option-img-1'))
    expect(fields()).toEqual({ sourceImageId: 'img-1' })
  })

  it('27/11. empty state is truthful: no mention of Creative Editor renders or Galeria', async () => {
    state.ai = []
    await open()
    const empty = await screen.findByTestId('i2v-ai-empty')
    expect(empty.textContent).toBe('Nenhuma imagem gerada por IA neste projeto.')
    expect(empty.textContent).not.toMatch(/Galeria|Creative|Arquivos/)
  })

  it('28. a failed query is NOT an empty list: it shows an error and a working retry', async () => {
    state.aiFail = true
    await open()
    expect(await screen.findByTestId('i2v-ai-failed')).toBeTruthy()
    expect(screen.queryByTestId('i2v-ai-empty')).toBeNull()
    expect(document.body.textContent).not.toMatch(/status 500|Error:/)
    state.aiFail = false
    fireEvent.click(screen.getByText('Tentar novamente'))
    await screen.findByTestId('i2v-ai-option-img-1')
  })

  it('29/30. pages are bounded; "Carregar mais" appends the next page with no duplicates', async () => {
    state.ai = Array.from({ length: 7 }, (_, index) => aiRow(`img-${index + 1}`))
    await open()
    await screen.findByTestId('i2v-ai-option-img-1')
    expect(screen.getAllByTestId(/^i2v-ai-option-/)).toHaveLength(3)
    fireEvent.click(screen.getByTestId('i2v-ai-load-more'))
    await waitFor(() => expect(screen.getAllByTestId(/^i2v-ai-option-/)).toHaveLength(6))
    fireEvent.click(screen.getByTestId('i2v-ai-load-more'))
    await waitFor(() => expect(screen.getAllByTestId(/^i2v-ai-option-/)).toHaveLength(7))
    expect(screen.queryByTestId('i2v-ai-load-more')).toBeNull()
    const ids = screen.getAllByTestId(/^i2v-ai-option-/).map((node) => node.getAttribute('data-testid'))
    expect(new Set(ids).size).toBe(ids.length)
    expect(state.requests.filter((url) => url.includes('/api/images/browse') && url.includes('cursor='))).toHaveLength(2)
  })

  it('31. only eligible formats are offered (the server already filters; the chooser never lists a WebP)', async () => {
    state.ai = [aiRow('png'), aiRow('webp', { mime_type: 'image/webp' }), aiRow('jpeg', { mime_type: 'image/jpeg' })]
    await open()
    await screen.findByTestId('i2v-ai-option-png')
    expect(screen.getByTestId('i2v-ai-option-jpeg')).toBeTruthy()
    expect(screen.queryByTestId('i2v-ai-option-webp')).toBeNull()
  })

  it('shows the Production as context when known, and still lists images without one', async () => {
    state.ai = [aiRow('with', { production_id: PROD_CURRENT }), aiRow('without')]
    await open()
    expect((await screen.findByTestId('i2v-ai-option-with')).textContent).toContain('Production Atual')
    expect(screen.getByTestId('i2v-ai-option-without')).toBeTruthy()
  })
})

describe('Galeria', () => {
  const studio = (id: string, overrides: Record<string, unknown> = {}) => libraryRow(id, { origin: 'studio_render', folder: '/', name: 'slide-2-de-5-abc.png', production_id: PROD_CURRENT, ...overrides })

  it('37. lists Creative Editor image outputs only, through the typed gallery scope (no origin expression from the browser)', async () => {
    state.library = [studio('g1', { production_id: PROD_CURRENT }), libraryRow('upload-1'), libraryRow('video-1', { kind: 'video', mime_type: 'video/mp4' }), studio('gvid', { kind: 'video', mime_type: 'video/mp4' })]
    state.ai = [aiRow('img-1')]
    await open()
    tab('gallery')
    await screen.findByTestId('i2v-gallery-option-g1')
    expect(screen.getAllByTestId(/^i2v-gallery-option-/)).toHaveLength(1)
    expect(screen.queryByTestId('i2v-gallery-option-upload-1')).toBeNull()
    expect(screen.queryByTestId('i2v-gallery-option-gvid')).toBeNull()
    const params = lastParams('gallery')
    expect(Object.fromEntries(params)).toMatchObject({ scope: 'gallery', kind: 'image', format: 'i2v-image' })
    expect(params.has('origin')).toBe(false)
  })

  it('4. never lists AI `images` rows (they live under Geradas por IA)', async () => {
    state.ai = [aiRow('img-1')]
    state.library = [studio('g1')]
    await open()
    tab('gallery')
    await screen.findByTestId('i2v-gallery-option-g1')
    expect(screen.queryByTestId('i2v-gallery-option-img-1')).toBeNull()
    expect(state.requests.filter((url) => url.startsWith('/api/images/browse')).length).toBe(1) // only the AI tab's own initial load
  })

  it('32/39. defaults to the current Production, shows the tile with Galeria title and Production metadata', async () => {
    state.library = [studio('g1', { production_id: PROD_CURRENT }), studio('g2', { production_id: PROD_OTHER }), studio('g3', { production_id: null })]
    await open()
    tab('gallery')
    const tile = await screen.findByTestId('i2v-gallery-option-g1')
    expect(lastParams('gallery').get('production')).toBe(PROD_CURRENT)
    expect(tile.textContent).toContain('Creative Editor · Slide 2/5')
    expect(tile.textContent).toContain('Production Atual')
    expect(screen.queryByTestId('i2v-gallery-option-g2')).toBeNull()
  })

  it('33. "Todas as Productions" widens to the whole Project', async () => {
    state.library = [studio('g1', { production_id: PROD_CURRENT }), studio('g2', { production_id: PROD_OTHER }), studio('g3', { production_id: null })]
    await open()
    tab('gallery')
    await screen.findByTestId('i2v-gallery-option-g1')
    await chooseProduction('Todas as Productions')
    await screen.findByTestId('i2v-gallery-option-g2')
    expect(screen.getAllByTestId(/^i2v-gallery-option-/)).toHaveLength(3)
    expect(lastParams('gallery').get('production')).toBe('all')
  })

  it('34. "Sem Production" shows only unscoped renders, labelled truthfully', async () => {
    state.library = [studio('g1', { production_id: PROD_CURRENT }), studio('g3', { production_id: null })]
    await open()
    tab('gallery')
    await screen.findByTestId('i2v-gallery-option-g1')
    await chooseProduction('Sem Production')
    const tile = await screen.findByTestId('i2v-gallery-option-g3')
    expect(screen.queryByTestId('i2v-gallery-option-g1')).toBeNull()
    expect(tile.textContent).toContain('Sem Production associada')
  })

  it('35. search is debounced (one request for a burst of keystrokes) and sent as q', async () => {
    state.library = [studio('g1', { name: 'slide-1-de-3-a.png' }), studio('g2', { name: 'capa-b.png' })]
    await open()
    tab('gallery')
    await screen.findByTestId('i2v-gallery-option-g1')
    await chooseProduction('Todas as Productions')
    const before = browseRequests('gallery').length
    const input = screen.getByTestId('i2v-source-search')
    for (const text of ['c', 'ca', 'cap', 'capa']) fireEvent.change(input, { target: { value: text } })
    await waitFor(() => expect(lastParams('gallery').get('q')).toBe('capa'), { timeout: 2000 })
    expect(browseRequests('gallery').length).toBe(before + 1)
    expect(input.getAttribute('maxlength')).toBe('100')
  })

  it('36. pagination: bounded page, "Carregar mais", no duplicates', async () => {
    state.library = Array.from({ length: 5 }, (_, index) => studio(`g${index + 1}`, { production_id: PROD_CURRENT }))
    await open()
    tab('gallery')
    await screen.findByTestId('i2v-gallery-option-g1')
    expect(screen.getAllByTestId(/^i2v-gallery-option-/)).toHaveLength(3)
    fireEvent.click(screen.getByTestId('i2v-gallery-load-more'))
    await waitFor(() => expect(screen.getAllByTestId(/^i2v-gallery-option-/)).toHaveLength(5))
    expect(screen.queryByTestId('i2v-gallery-load-more')).toBeNull()
  })

  it('10/38. selecting uses the EXISTING LibraryFile: source_library_file_id only, no copy/promotion request', async () => {
    state.library = [studio('g1', { production_id: PROD_CURRENT })]
    await open()
    tab('gallery')
    fireEvent.click(await screen.findByTestId('i2v-gallery-option-g1'))
    expect(fields()).toEqual({ sourceLibraryFileId: 'g1' })
    expect(screen.getByTestId('i2v-source-summary-category').textContent).toBe('Galeria')
    expect(state.requests.filter((url) => /save-to-library|presign|upload/.test(url))).toEqual([])
    expect(state.requests.every((url) => !(url.startsWith('/api/library-files') && !url.startsWith('/api/library-files/browse')))).toBe(true)
  })

  it('empty states: truthful copy for Galeria; filtered/search empty is "Nenhuma imagem encontrada."', async () => {
    state.library = []
    await open()
    tab('gallery')
    expect((await screen.findByTestId('i2v-gallery-empty')).textContent).toBe('Nenhuma imagem encontrada.')
    await chooseProduction('Todas as Productions')
    await waitFor(() => expect(screen.getByTestId('i2v-gallery-empty').textContent).toBe('Nenhum render de imagem disponível na Galeria.'))
  })

  it('error is distinct from empty', async () => {
    state.libraryFail = true
    await open()
    tab('gallery')
    expect(await screen.findByTestId('i2v-gallery-failed')).toBeTruthy()
    expect(screen.queryByTestId('i2v-gallery-empty')).toBeNull()
  })
})

describe('Arquivos', () => {
  beforeEach(() => {
    state.library = [
      libraryRow('root-a', { production_id: PROD_CURRENT, folder: '/Maitê', name: 'capa.png' }),
      libraryRow('root-b', { production_id: PROD_OTHER, folder: '/Maitê', name: 'outra.png' }),
      libraryRow('root-c', { folder: '/Maitê', name: 'solta.png' }),
      libraryRow('ref-a', { production_id: PROD_CURRENT, folder: '/Maitê/Referências', name: 'rosto-maria.png' }),
      libraryRow('faces-a', { folder: '/Maitê/Referências/Rostos', name: 'rosto-joao.png' }),
      libraryRow('studio-a', { origin: 'studio_render', folder: '/', name: 'slide-1-de-1-x.png', production_id: PROD_CURRENT }),
      libraryRow('webp-a', { mime_type: 'image/webp', folder: '/Maitê', name: 'nao.webp' }),
      libraryRow('trash-a', { folder: '/Maitê', deleted_at: '2026-09-02T00:00:00Z' }),
      libraryRow('other-proj', { project_id: OTHER_PROJECT, folder: '/Maitê' }),
      libraryRow('video-a', { kind: 'video', mime_type: 'video/mp4', folder: '/Maitê' }),
    ]
  })
  const openLibrary = async () => {
    await open()
    tab('library')
    await screen.findByTestId('i2v-folder-nav')
  }
  const options = () => screen.queryAllByTestId(/^i2v-library-option-/).map((node) => node.getAttribute('data-testid')!.replace('i2v-library-option-', ''))

  it('48/47. uses the scalable browse: scope=arquivos, kind=image, PNG/JPEG format, the current folder and (default) current Production', async () => {
    await openLibrary()
    await waitFor(() => expect(options()).toEqual(['root-a']))
    const params = lastParams('arquivos')
    expect(Object.fromEntries(params)).toEqual({ projectId: PROJECT, scope: 'arquivos', kind: 'image', format: 'i2v-image', production: PROD_CURRENT, folder: '/Maitê' })
    expect(state.requests.some((url) => url.startsWith('/api/library-files?'))).toBe(false)
  })

  it('6/7/51/52. static renders, non-PNG/JPEG, video, trashed and other-Project files never appear', async () => {
    await openLibrary()
    await chooseProduction('Todas as Productions')
    await waitFor(() => expect(options().sort()).toEqual(['root-a', 'root-b', 'root-c']))
    for (const hidden of ['studio-a', 'webp-a', 'trash-a', 'other-proj', 'video-a']) expect(options()).not.toContain(hidden)
  })

  it('40/41/42. Production filter: current (default), all, unscoped', async () => {
    await openLibrary()
    await waitFor(() => expect(options()).toEqual(['root-a']))
    await chooseProduction('Todas as Productions')
    await waitFor(() => expect(options().length).toBe(3))
    await chooseProduction('Sem Production')
    await waitFor(() => expect(options()).toEqual(['root-c']))
    expect(lastParams('arquivos').get('production')).toBe('unscoped')
  })

  it('43/44/45. folder navigation: child folders, breadcrumbs, back and root', async () => {
    await openLibrary()
    await chooseProduction('Todas as Productions')
    await waitFor(() => expect(options().length).toBe(3))
    expect(screen.getByTestId('i2v-crumb-0').textContent).toBe('Maitê')
    expect(screen.getByTestId('i2v-folder-back').hasAttribute('disabled')).toBe(true)

    fireEvent.click(screen.getByTestId('i2v-folder-f-ref'))
    await waitFor(() => expect(options()).toEqual(['ref-a']))
    expect(lastParams('arquivos').get('folder')).toBe('/Maitê/Referências')
    expect(screen.getByTestId('i2v-breadcrumbs').textContent).toBe('Maitê/Referências')

    fireEvent.click(screen.getByTestId('i2v-folder-f-faces'))
    await waitFor(() => expect(options()).toEqual(['faces-a']))
    expect(screen.getByTestId('i2v-breadcrumbs').textContent).toBe('Maitê/Referências/Rostos')

    fireEvent.click(screen.getByTestId('i2v-folder-back'))
    await waitFor(() => expect(options()).toEqual(['ref-a']))
    fireEvent.click(screen.getByTestId('i2v-crumb-0'))
    await waitFor(() => expect(options().length).toBe(3))
    expect(screen.getByTestId('i2v-folder-back').hasAttribute('disabled')).toBe(true)
  })

  it('46. an ACTIVE search spans the whole Project + Production context (no folder), shows the folder on each result, and hides the folder navigation', async () => {
    await openLibrary()
    await chooseProduction('Todas as Productions')
    await waitFor(() => expect(options().length).toBe(3))
    fireEvent.change(screen.getByTestId('i2v-source-search'), { target: { value: 'rosto' } })
    await waitFor(() => expect(options().sort()).toEqual(['faces-a', 'ref-a']), { timeout: 2000 })
    const params = lastParams('arquivos')
    expect(params.get('q')).toBe('rosto')
    expect(params.has('folder')).toBe(false)
    expect(screen.queryByTestId('i2v-folder-nav')).toBeNull()
    expect(screen.getByTestId('i2v-library-option-faces-a').textContent).toContain('Rostos')
    // clearing the search returns to folder browsing
    fireEvent.change(screen.getByTestId('i2v-source-search'), { target: { value: '' } })
    await screen.findByTestId('i2v-folder-nav')
  })

  it('49/50. pagination keeps a deterministic order, never duplicates, and never auto-fetches the rest', async () => {
    state.library = Array.from({ length: 8 }, (_, index) => libraryRow(`p${index + 1}`, { production_id: PROD_CURRENT, folder: '/Maitê' }))
    await openLibrary()
    await waitFor(() => expect(options()).toEqual(['p1', 'p2', 'p3']))
    expect(browseRequests('arquivos')).toHaveLength(1)
    fireEvent.click(screen.getByTestId('i2v-library-load-more'))
    await waitFor(() => expect(options()).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6']))
    fireEvent.click(screen.getByTestId('i2v-library-load-more'))
    await waitFor(() => expect(options()).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']))
    expect(screen.queryByTestId('i2v-library-load-more')).toBeNull()
  })

  it('11. selecting submits source_library_file_id only, with origin + folder in the summary', async () => {
    await openLibrary()
    fireEvent.click(await screen.findByTestId('i2v-library-option-root-a'))
    expect(fields()).toEqual({ sourceLibraryFileId: 'root-a' })
    expect(screen.getByTestId('i2v-source-summary-category').textContent).toBe('Arquivos')
    expect(screen.getByTestId('i2v-source-summary-context').textContent).toContain('Production Atual')
    expect(screen.getByTestId('i2v-source-summary-context').textContent).toContain('Arquivos / Maitê')
  })

  it('53. a Production of another Project is refused by the server and the chooser shows an error, not a fake empty list', async () => {
    state.productions = [{ id: PROD_CURRENT, title: 'Production Atual' }]
    await open()
    tab('library')
    await screen.findByTestId('i2v-folder-nav')
    // the server rejects an unknown/foreign Production with 404 -> failed state (never "empty")
    state.productions = []
    state.requests.length = 0
    await chooseProduction('Todas as Productions')
    await chooseProduction(/Production atual/)
    expect(await screen.findByTestId('i2v-library-failed')).toBeTruthy()
    expect(screen.queryByTestId('i2v-library-empty')).toBeNull()
  })

  it('empty folder/filter uses the truthful copy; failures are distinct; a folder-list failure does not block search', async () => {
    state.library = []
    await openLibrary()
    expect((await screen.findByTestId('i2v-library-empty')).textContent).toBe('Nenhuma imagem encontrada nesta pasta/filtro.')
    cleanup()
    state = freshState()
    state.foldersFail = true
    fetchMock = installI2vFetch(state)
    vi.stubGlobal('fetch', fetchMock)
    state.library = [libraryRow('x1', { folder: '/Qualquer', production_id: PROD_CURRENT })]
    await open()
    tab('library')
    expect(await screen.findByTestId('i2v-folders-failed')).toBeTruthy()
    expect(await screen.findByTestId('i2v-library-option-x1')).toBeTruthy()
  })

  it('the Production list is the Project’s own and the filter offers exactly the three choices', async () => {
    await openLibrary()
    fireEvent.keyDown(screen.getByTestId('i2v-source-production-filter'), { key: 'Enter' })
    const labels = (await screen.findAllByRole('option')).map((node) => node.textContent)
    expect(labels).toEqual(['Production atual (Production Atual)', 'Todas as Productions', 'Sem Production'])
  })
})

describe('Enviar', () => {
  const file = (name = 'foto.png', type = 'image/png') => new File([new Uint8Array([1, 2, 3])], name, { type })
  const pickFile = (f: File) => fireEvent.change(screen.getByTestId('i2v-upload-input'), { target: { files: [f] } })
  const openUpload = async () => {
    await open()
    tab('upload')
    await screen.findByTestId('i2v-upload')
  }

  it('22. shows the truthful notice and the destination (Project Library root + current Production)', async () => {
    await openUpload()
    expect(screen.getByTestId('i2v-upload-notice').textContent).toBe('A imagem será adicionada aos seus Arquivos.')
    await waitFor(() => expect(screen.getByTestId('i2v-upload-destination').textContent).toContain('Arquivos / Maitê'))
    expect(screen.getByTestId('i2v-upload-destination').textContent).toContain('Production: Production Atual')
  })

  it('54/57/58/59/61/62/63. PNG: canonical Library upload, current Project + Production, Project root, auto-selected as source_library_file_id', async () => {
    await openUpload()
    await waitFor(() => expect(screen.getByTestId('i2v-upload-destination').textContent).toContain('Maitê'))
    pickFile(file())
    await waitFor(() => expect(screen.queryByTestId('i2v-source-browser')).toBeNull())
    expect(state.uploads.presign).toEqual({ folder: 'library', prefix: '/Maitê', mimeType: 'image/png', filename: 'foto.png' })
    expect(state.uploads.put).toEqual({ url: 'https://upload.example.test/put', type: 'image/png' })
    expect(state.uploads.save).toMatchObject({ projectId: PROJECT, productionId: PROD_CURRENT, folder: '/Maitê', name: 'foto.png', kind: 'image', mimeType: 'image/png', fileSize: 3, storageProvider: 's3', storagePath: 'users/u1/library/uuid/foto.png' })
    expect(fields()).toEqual({ sourceLibraryFileId: 'lib-uploaded' })
    expect(screen.getByTestId('i2v-source-summary-category').textContent).toBe('Upload')
    // the only writes are the canonical Library ones — no temporary/disposable source record
    const writes = state.requests.filter((url) => !url.includes('/browse') && !url.includes('folders') && !url.startsWith('https://'))
    expect(writes.sort()).toEqual(['/api/library-files', '/api/storage/presign-image-upload'])
  })

  it('55. JPEG is accepted (.jpg is JPEG)', async () => {
    await openUpload()
    await waitFor(() => expect(screen.getByTestId('i2v-upload-destination').textContent).toContain('Maitê'))
    pickFile(file('retrato.jpg', 'image/jpeg'))
    await waitFor(() => expect(fields()).toEqual({ sourceLibraryFileId: 'lib-uploaded' }))
    expect(state.uploads.save.mimeType).toBe('image/jpeg')
  })

  it('56. an unsupported format is refused before any request and leaves the source untouched', async () => {
    await openUpload()
    for (const [name, type] of [['a.webp', 'image/webp'], ['a.gif', 'image/gif'], ['a.svg', 'image/svg+xml']] as const) {
      pickFile(file(name, type))
      expect((await screen.findByTestId('i2v-upload-error')).textContent).toMatch(/Formato não compatível com Image → Vídeo/)
    }
    expect(state.uploads.presign).toBeUndefined()
    expect(fields()).toEqual({})
  })

  it('60. the Arquivos folder in view is the destination when one is selected', async () => {
    await open()
    tab('library')
    await screen.findByTestId('i2v-folder-nav')
    fireEvent.click(screen.getByTestId('i2v-folder-f-ref'))
    tab('upload')
    await waitFor(() => expect(screen.getByTestId('i2v-upload-destination').textContent).toContain('Arquivos / Referências'))
    pickFile(file())
    await waitFor(() => expect(fields()).toEqual({ sourceLibraryFileId: 'lib-uploaded' }))
    expect(state.uploads.presign.prefix).toBe('/Maitê/Referências')
    expect(state.uploads.save.folder).toBe('/Maitê/Referências')
    expect(state.uploads.save.productionId).toBe(PROD_CURRENT)
  })

  it.each(['presign', 'put', 'save'] as const)('64. a failure at "%s" shows an error, changes nothing and keeps any previous selection', async (failAt) => {
    await open()
    fireEvent.click(await screen.findByTestId('i2v-ai-option-img-1'))
    fireEvent.click(screen.getByTestId('i2v-source-change'))
    await screen.findByTestId('i2v-source-browser')
    tab('upload')
    await waitFor(() => expect(screen.getByTestId('i2v-upload-destination').textContent).toContain('Maitê'))
    state.uploadFailAt = failAt
    pickFile(file())
    expect((await screen.findByTestId('i2v-upload-error')).textContent).toMatch(/Nada foi alterado/)
    expect(fields()).toEqual({ sourceImageId: 'img-1' })
    expect(screen.getByTestId('i2v-upload-input').hasAttribute('disabled')).toBe(false)
  })

  it('shows progress while uploading and blocks a second upload', async () => {
    await openUpload()
    await waitFor(() => expect(screen.getByTestId('i2v-upload-destination').textContent).toContain('Maitê'))
    const gate = deferred()
    state.gate = (url) => (url === '/api/storage/presign-image-upload' ? gate.promise : null)
    pickFile(file())
    expect(await screen.findByTestId('i2v-upload-progress')).toBeTruthy()
    expect(screen.getByRole('progressbar').getAttribute('aria-busy')).toBe('true')
    expect(screen.getByTestId('i2v-upload-input').hasAttribute('disabled')).toBe(true)
    await act(async () => gate.resolve())
    await waitFor(() => expect(fields()).toEqual({ sourceLibraryFileId: 'lib-uploaded' }))
  })

  it('while a file is in flight, other categories, "Fechar" and the field actions are locked, so the upload always ends in a selection', async () => {
    await open()
    fireEvent.click(await screen.findByTestId('i2v-ai-option-img-1'))
    fireEvent.click(screen.getByTestId('i2v-source-change'))
    await screen.findByTestId('i2v-source-browser')
    tab('upload')
    await waitFor(() => expect(screen.getByTestId('i2v-upload-destination').textContent).toContain('Maitê'))
    const gate = deferred()
    state.gate = (url) => (url === '/api/storage/presign-image-upload' ? gate.promise : null)
    pickFile(file())
    await screen.findByTestId('i2v-upload-progress')
    expect(screen.getByTestId('i2v-source-tab-ai').hasAttribute('disabled')).toBe(true)
    expect(screen.getByTestId('i2v-source-tab-library').hasAttribute('disabled')).toBe(true)
    expect(screen.getByTestId('i2v-source-tab-upload').hasAttribute('disabled')).toBe(false)
    expect(screen.getByTestId('i2v-source-close').hasAttribute('disabled')).toBe(true)
    expect(screen.getByTestId('i2v-source-change').hasAttribute('disabled')).toBe(true)
    expect(screen.getByTestId('i2v-source-clear').hasAttribute('disabled')).toBe(true)
    await act(async () => gate.resolve())
    await waitFor(() => expect(fields()).toEqual({ sourceLibraryFileId: 'lib-uploaded' }))
    expect(screen.getByTestId('i2v-source-change').hasAttribute('disabled')).toBe(false)
  })

  it('65. the upload control is a file input inside no <form>, and nothing in the chooser can submit one', async () => {
    const view = render(
      <form data-testid="outer-form" onSubmit={(event) => { event.preventDefault(); throw new Error('the generation form must not submit') }}>
        <Harness />
      </form>,
    )
    fireEvent.click(screen.getByTestId('i2v-source-choose'))
    await screen.findByTestId('i2v-source-browser')
    tab('upload')
    tab('library')
    tab('gallery')
    fireEvent.click(screen.getByTestId('i2v-source-close'))
    expect(view.container.querySelector('input[type=file]')).toBeNull()
  })
})

describe('async safety', () => {
  const studio = (id: string, overrides: Record<string, unknown> = {}) => libraryRow(id, { origin: 'studio_render', folder: '/', production_id: PROD_CURRENT, ...overrides })

  it('67. a slow response for a category the user already left never shows up in the new one', async () => {
    state.library = [studio('g1')]
    state.ai = [aiRow('img-1')]
    const slow = deferred()
    state.gate = (url) => (url.startsWith('/api/images/browse') ? slow.promise : null)
    await open()
    tab('gallery')
    await screen.findByTestId('i2v-gallery-option-g1')
    await act(async () => slow.resolve())
    expect(screen.queryByTestId('i2v-ai-option-img-1')).toBeNull()
    expect(screen.getAllByTestId(/^i2v-gallery-option-/)).toHaveLength(1)
  })

  it('68. a slow OLD search response is ignored once a newer search has answered', async () => {
    state.library = [studio('g-alpha', { name: 'alpha.png' }), studio('g-beta', { name: 'beta.png' })]
    await open()
    tab('gallery')
    await screen.findByTestId('i2v-gallery-option-g-alpha')
    const slow = deferred()
    state.gate = (url) => (url.includes('q=alpha') ? slow.promise : null)
    fireEvent.change(screen.getByTestId('i2v-source-search'), { target: { value: 'alpha' } })
    await waitFor(() => expect(state.requests.some((url) => url.includes('q=alpha'))).toBe(true), { timeout: 2000 })
    fireEvent.change(screen.getByTestId('i2v-source-search'), { target: { value: 'beta' } })
    await waitFor(() => expect(screen.queryByTestId('i2v-gallery-option-g-beta')).toBeTruthy(), { timeout: 2000 })
    await act(async () => slow.resolve())
    expect(screen.getAllByTestId(/^i2v-gallery-option-/).map((node) => node.getAttribute('data-testid'))).toEqual(['i2v-gallery-option-g-beta'])
  })

  it('66. a slow response from the OLD Project is dropped after the Project changes', async () => {
    state.ai = [aiRow('img-old'), aiRow('img-new', { project_id: OTHER_PROJECT })]
    const slow = deferred()
    state.gate = (url) => (url.includes(`projectId=${PROJECT}`) && url.startsWith('/api/images/browse') ? slow.promise : null)
    const view = render(<Harness key={PROJECT} projectId={PROJECT} />)
    fireEvent.click(screen.getByTestId('i2v-source-choose'))
    await screen.findByTestId('i2v-ai-loading')
    view.rerender(<Harness key={OTHER_PROJECT} projectId={OTHER_PROJECT} />)
    fireEvent.click(screen.getByTestId('i2v-source-choose'))
    await screen.findByTestId('i2v-ai-option-img-new')
    await act(async () => slow.resolve())
    expect(screen.queryByTestId('i2v-ai-option-img-old')).toBeNull()
  })

  it('69/70. loading is announced (role=status) and errors are announced (role=alert)', async () => {
    const slow = deferred()
    state.gate = (url) => (url.startsWith('/api/images/browse') ? slow.promise : null)
    await open()
    expect((await screen.findByTestId('i2v-ai-loading')).getAttribute('role')).toBe('status')
    state.aiFail = true
    await act(async () => slow.resolve())
    expect((await screen.findByTestId('i2v-ai-failed')).getAttribute('role')).toBe('alert')
  })

  it('a late "Carregar mais" page from a previous filter is dropped', async () => {
    state.library = Array.from({ length: 8 }, (_, index) => studio(`g${index + 1}`))
    await open()
    tab('gallery')
    await screen.findByTestId('i2v-gallery-option-g1')
    const slow = deferred()
    state.gate = (url) => (url.includes('cursor=') ? slow.promise : null)
    fireEvent.click(screen.getByTestId('i2v-gallery-load-more'))
    await chooseProduction('Sem Production')
    await waitFor(() => expect(screen.queryByTestId('i2v-gallery-empty')).toBeTruthy())
    await act(async () => slow.resolve())
    expect(screen.queryAllByTestId(/^i2v-gallery-option-/)).toHaveLength(0)
  })
})

describe('mobile contract (390px) and accessibility', () => {
  it('71/72. category tabs scroll instead of overflowing; long names truncate; the grid is fluid', async () => {
    state.ai = [aiRow('long', { name: 'um-nome-de-arquivo-extremamente-longo-que-nao-pode-quebrar-o-layout-do-modal-em-390px.png' })]
    await open()
    const tabs = screen.getByTestId('i2v-source-tabs')
    expect(tabs.className).toMatch(/overflow-x-auto/)
    for (const entry of ['ai', 'gallery', 'library', 'upload']) expect(screen.getByTestId(`i2v-source-tab-${entry}`).className).toMatch(/shrink-0/)
    expect(screen.getByTestId('i2v-source-tab-ai').className).toMatch(/whitespace-nowrap/)
    const tile = await screen.findByTestId('i2v-ai-option-long')
    expect(tile.className).toMatch(/min-w-0/)
    expect(tile.querySelector('span')!.className).toMatch(/truncate/)
    expect(tile.getAttribute('title')).toContain('um-nome-de-arquivo-extremamente-longo')
    expect(screen.getByTestId('i2v-ai-grid').className).toMatch(/grid-cols-2/)
    expect(screen.getByTestId('i2v-source-browser').className).not.toMatch(/\bw-\[\d/)
  })

  it('a long selected name truncates inside the compact summary', async () => {
    state.ai = [aiRow('long', { name: 'x'.repeat(200) })]
    await open()
    fireEvent.click(await screen.findByTestId('i2v-ai-option-long'))
    expect(screen.getByTestId('i2v-source-summary-name').className).toMatch(/truncate/)
    expect(screen.getByTestId('i2v-source-summary').className).toMatch(/min-w-0/)
  })

  it('46. tabs, tiles and folders are keyboard-reachable buttons with state, names and alt text', async () => {
    state.library = [libraryRow('l1', { production_id: PROD_CURRENT })]
    await open()
    const aiTile = await screen.findByTestId('i2v-ai-option-img-1')
    expect(aiTile.tagName).toBe('BUTTON')
    expect(aiTile.getAttribute('aria-pressed')).toBe('false')
    expect(aiTile.querySelector('img')!.getAttribute('alt')).toBe('Imagem IA img-1')
    tab('library')
    await screen.findByTestId('i2v-folder-nav')
    expect(screen.getByRole('navigation', { name: 'Pastas de Arquivos' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Voltar para a pasta anterior' })).toBeTruthy()
    expect(screen.getByLabelText('Buscar')).toBeTruthy()
    expect(screen.getByLabelText('Filtrar por Production')).toBeTruthy()
    expect(screen.getByTestId('i2v-source-tab-library').getAttribute('aria-selected')).toBe('true')
  })
})
