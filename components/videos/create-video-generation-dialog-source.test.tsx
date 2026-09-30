// @vitest-environment jsdom
// VIDEO_I2V_LIBRARY_SOURCE_PICKER_V1 + VIDEO_I2V_SOURCE_BROWSER_V1 — form-level behavior of the compact source field.
// (The chooser itself — categories, lists, filters, folders, upload, async safety — is covered in i2v-source-picker.test.tsx.)
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { normalizeKlingMcpVideoCapabilities } from '@/lib/provider-connections/kling-mcp-video-capabilities'
import { whoAmIFixture } from '@/lib/__tests__/helpers/kling-who-am-i-fixture'
import { describeMcpConnection, describeRestConnection } from '@/lib/video-generation/connections'
import type { VideoGenerationConnectionDescriptor } from '@/lib/video-generation/capabilities'
import type { ProviderConnectionRow } from '@/lib/provider-connections/types'
import { PROD_CURRENT, PROD_OTHER, PROJECT, OTHER_PROJECT, aiRow, freshState, installI2vFetch, libraryRow, type I2vFixtureState } from '@/lib/__tests__/helpers/i2v-source-fixtures'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))

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

import { CreateVideoGenerationDialog } from './create-video-generation-dialog'

const MCP_ID = '11111111-1111-4111-8111-111111111111'
const NOW = new Date()

function mcpDescriptor(): VideoGenerationConnectionDescriptor {
  const row: ProviderConnectionRow = {
    id: MCP_ID,
    user_id: 'u',
    provider: 'kling',
    connection_method: 'mcp_oauth',
    status: 'connected',
    scopes: ['generation.read', 'account.credit.read', 'generation.create'],
    external_account_id: null,
    capabilities: { membership: { label: 'Pro' }, video: normalizeKlingMcpVideoCapabilities(whoAmIFixture()) },
    last_checked_at: NOW.toISOString(),
    last_error_code: null,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
  }
  return describeMcpConnection(row, NOW)
}

const studio = (id: string, overrides: Record<string, unknown> = {}) =>
  libraryRow(id, { origin: 'studio_render', folder: '/', production_id: PROD_CURRENT, name: 'slide-1-de-2-x.png', ...overrides })

let fetchMock: ReturnType<typeof installI2vFetch>
const dialogFetch = vi.fn()

beforeAll(() => {
  const proto = window.HTMLElement.prototype as any
  proto.hasPointerCapture ??= () => false
  proto.setPointerCapture ??= () => undefined
  proto.releasePointerCapture ??= () => undefined
  proto.scrollIntoView ??= () => undefined
  ;(window as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }
})

beforeEach(() => {
  vi.clearAllMocks()
  state = freshState()
  state.ai = [aiRow('img-1', { name: 'Uma raposa' })]
  state.library = [libraryRow('lib-1', { name: 'capa-do-lancamento.png', production_id: PROD_CURRENT }), studio('gal-1')]
  fetchMock = installI2vFetch(state)
  state.extra = (url, init) => {
    if (url === '/api/video-generations/connections') {
      return new Response(JSON.stringify({ connections: [describeRestConnection('configured'), mcpDescriptor()] }), { status: 200 })
    }
    if (url === '/api/video-generations' && init?.method === 'POST') return new Response(JSON.stringify({ generation: { id: 'g1' } }), { status: 200 })
    return null
  }
  dialogFetch.mockImplementation((...args: [any, any]) => fetchMock(...args))
  vi.stubGlobal('fetch', dialogFetch)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const renderDialog = (projectId = PROJECT, productionId = PROD_CURRENT) =>
  render(<CreateVideoGenerationDialog open onOpenChange={() => undefined} projectId={projectId} productionId={productionId} />)

const submittedBody = () => {
  const call = dialogFetch.mock.calls.find(([url, init]) => url === '/api/video-generations' && init?.method === 'POST')
  return call ? JSON.parse(call[1].body as string) : null
}

const tab = (group: 'ai' | 'gallery' | 'library' | 'upload') => fireEvent.click(screen.getByTestId(`i2v-source-tab-${group}`))
const openBrowser = async () => {
  const trigger = screen.queryByTestId('i2v-source-choose') ?? screen.getByTestId('i2v-source-change')
  fireEvent.click(trigger)
  await screen.findByTestId('i2v-source-browser')
}
const pickAi = async (id = 'img-1') => {
  await openBrowser()
  tab('ai')
  fireEvent.click(await screen.findByTestId(`i2v-ai-option-${id}`))
}
const pickGallery = async (id = 'gal-1') => {
  await openBrowser()
  tab('gallery')
  fireEvent.click(await screen.findByTestId(`i2v-gallery-option-${id}`))
}
const pickLibrary = async (id = 'lib-1') => {
  await openBrowser()
  tab('library')
  fireEvent.click(await screen.findByTestId(`i2v-library-option-${id}`))
}
const typePrompt = () => fireEvent.change(screen.getByPlaceholderText(/Como esta imagem/), { target: { value: 'a câmera se aproxima' } })
const generate = async () => {
  typePrompt()
  fireEvent.click(screen.getByTestId('generate-video'))
  await waitFor(() => expect(submittedBody()).not.toBeNull())
  return submittedBody()
}
const openPicker = async () => {
  renderDialog()
  await waitFor(() => expect(screen.getByTestId('i2v-source-picker')).toBeTruthy())
}
const summaryText = () => screen.queryByTestId('i2v-source-summary')?.textContent ?? ''

describe('Image-to-Video source field (compact) — source identity', () => {
  it('starts compact: "Imagem de Origem" with one "Escolher uma imagem" action and no expanded browser', async () => {
    await openPicker()
    expect(screen.getByText('Imagem de Origem')).toBeTruthy()
    expect(screen.getByTestId('i2v-source-choose').textContent).toContain('Escolher uma imagem')
    expect(screen.queryByTestId('i2v-source-browser')).toBeNull()
    expect(document.body.textContent).not.toMatch(/source_(image|library)|storage_path/i)
  })

  it('9. Geradas por IA submits source_image_id only', async () => {
    await openPicker()
    await pickAi()
    const body = await generate()
    expect(body.sourceImageId).toBe('img-1')
    expect('sourceLibraryFileId' in body).toBe(false)
  })

  it('10. Galeria submits source_library_file_id only (no copy, no promotion)', async () => {
    await openPicker()
    await pickGallery()
    const body = await generate()
    expect(body.sourceLibraryFileId).toBe('gal-1')
    expect('sourceImageId' in body).toBe(false)
    expect(dialogFetch.mock.calls.filter(([url]) => /save-to-library|presign/.test(String(url)))).toEqual([])
  })

  it('11/14. Arquivos submits source_library_file_id only, and never a URL, path or thumbnail', async () => {
    await openPicker()
    await pickLibrary()
    const body = await generate()
    expect(body.sourceLibraryFileId).toBe('lib-1')
    expect('sourceImageId' in body).toBe(false)
    expect(JSON.stringify(body)).not.toMatch(/storage|signed|thumbnail|s3\.example|sig=/)
  })

  it('12. Enviar creates a LibraryFile and submits ONLY its id (current Project + Production)', async () => {
    await openPicker()
    await openBrowser()
    tab('upload')
    await waitFor(() => expect(screen.getByTestId('i2v-upload-destination').textContent).toContain('Maitê'))
    fireEvent.change(screen.getByTestId('i2v-upload-input'), { target: { files: [new File([new Uint8Array([1, 2])], 'minha.png', { type: 'image/png' })] } })
    await waitFor(() => expect(screen.queryByTestId('i2v-source-browser')).toBeNull())
    expect(state.uploads.save).toMatchObject({ projectId: PROJECT, productionId: PROD_CURRENT })
    const body = await generate()
    expect(body.sourceLibraryFileId).toBe('lib-uploaded')
    expect('sourceImageId' in body).toBe(false)
  })

  it('13. strict XOR through every transition: AI -> Galeria -> Arquivos -> AI leaves exactly one identity each time', async () => {
    await openPicker()
    await pickAi()
    expect(summaryText()).toContain('Gerada por IA')
    await pickGallery()
    expect(summaryText()).toContain('Galeria')
    await pickLibrary()
    expect(summaryText()).toContain('Arquivos')
    await pickAi()
    const body = await generate()
    expect(body.sourceImageId).toBe('img-1')
    expect('sourceLibraryFileId' in body).toBe(false)
  })

  it('without a source image_to_video is not submitted', async () => {
    await openPicker()
    typePrompt()
    fireEvent.click(screen.getByTestId('generate-video'))
    await Promise.resolve()
    expect(submittedBody()).toBeNull()
  })

  it('opening and using the chooser never starts a generation by itself', async () => {
    await openPicker()
    await pickLibrary()
    await openBrowser()
    tab('upload')
    tab('gallery')
    await Promise.resolve()
    expect(submittedBody()).toBeNull()
  })
})

describe('Image-to-Video source field — form state rules', () => {
  it('30. a source chosen for one Project never survives a change of Project behind the open dialog, and the new Project starts clean', async () => {
    state.folders.push({ id: 'f-root-2', project_id: OTHER_PROJECT, name: 'Outro', path: '/Outro', parent_path: '/', is_project_root: true })
    state.library.push(libraryRow('lib-2', { project_id: OTHER_PROJECT, name: 'outro-projeto.png', production_id: PROD_CURRENT, folder: '/Outro' }))
    const view = renderDialog()
    await waitFor(() => expect(screen.getByTestId('i2v-source-picker')).toBeTruthy())
    await pickLibrary()
    expect(summaryText()).toContain('capa-do-lancamento.png')

    view.rerender(<CreateVideoGenerationDialog open onOpenChange={() => undefined} projectId={OTHER_PROJECT} productionId={PROD_CURRENT} />)
    expect(screen.getByTestId('i2v-source-choose')).toBeTruthy()
    expect(screen.queryByTestId('i2v-source-summary')).toBeNull()
    await openBrowser()
    tab('library')
    await screen.findByTestId('i2v-library-option-lib-2')
    expect(screen.queryByTestId('i2v-library-option-lib-1')).toBeNull()
    typePrompt()
    fireEvent.click(screen.getByTestId('generate-video'))
    await Promise.resolve()
    expect(submittedBody()).toBeNull()
  })

  it('31. a Production change WITHIN the same Project keeps a valid selected source; the default filter follows the new Production', async () => {
    const view = renderDialog()
    await waitFor(() => expect(screen.getByTestId('i2v-source-picker')).toBeTruthy())
    await pickLibrary()
    view.rerender(<CreateVideoGenerationDialog open onOpenChange={() => undefined} projectId={PROJECT} productionId={PROD_OTHER} />)
    expect(summaryText()).toContain('capa-do-lancamento.png')
    await openBrowser()
    tab('gallery')
    await waitFor(() => expect(state.requests.some((url) => url.startsWith('/api/library-files/browse') && url.includes(`production=${PROD_OTHER}`))).toBe(true))
    fireEvent.click(screen.getByTestId('i2v-source-close'))
    const body = await generate()
    expect(body.sourceLibraryFileId).toBe('lib-1')
    expect(body.productionId).toBe(PROD_OTHER)
  })

  it('33. changing the connection (API <-> MCP) does not corrupt the selected source', async () => {
    await openPicker()
    await pickLibrary()
    fireEvent.click(screen.getByTestId('video-connection-option-mcp'))
    await waitFor(() => expect(screen.getByTestId('video-connection-option-mcp').getAttribute('aria-checked')).toBe('true'))
    expect(summaryText()).toContain('capa-do-lancamento.png')
    const body = await generate()
    expect(body.connectionRef).toMatch(/^kling:/)
    expect(body.connectionRef).not.toBe('kling:api')
    expect(body.sourceLibraryFileId).toBe('lib-1')
    expect('sourceImageId' in body).toBe(false)
  })

  it('32. leaving image_to_video drops the source: text_to_video submits neither', async () => {
    await openPicker()
    await pickLibrary()
    fireEvent.mouseDown(screen.getByTestId('operation-text_to_video'))
    fireEvent.click(screen.getByTestId('operation-text_to_video'))
    await waitFor(() => expect(screen.queryByTestId('i2v-source-picker')).toBeNull())
    fireEvent.change(screen.getByPlaceholderText(/Descreva a cena/), { target: { value: 'uma raposa correndo' } })
    fireEvent.click(screen.getByTestId('generate-video'))
    await waitFor(() => expect(submittedBody()).not.toBeNull())
    const body = submittedBody()
    expect('sourceImageId' in body).toBe(false)
    expect('sourceLibraryFileId' in body).toBe(false)
  })

  it('32. returning to image_to_video after a text_to_video detour shows no stale selection', async () => {
    await openPicker()
    await pickLibrary()
    fireEvent.mouseDown(screen.getByTestId('operation-text_to_video'))
    fireEvent.click(screen.getByTestId('operation-text_to_video'))
    await waitFor(() => expect(screen.queryByTestId('i2v-source-picker')).toBeNull())
    fireEvent.mouseDown(screen.getByTestId('operation-image_to_video'))
    fireEvent.click(screen.getByTestId('operation-image_to_video'))
    await waitFor(() => expect(screen.getByTestId('i2v-source-picker')).toBeTruthy())
    expect(screen.getByTestId('i2v-source-choose')).toBeTruthy()
    expect(screen.queryByTestId('i2v-source-summary')).toBeNull()
  })

  it('"Trocar" replaces the choice without leaving a stale identity', async () => {
    await openPicker()
    await pickAi()
    await pickLibrary()
    const body = await generate()
    expect(body.sourceLibraryFileId).toBe('lib-1')
    expect('sourceImageId' in body).toBe(false)
  })

  it('"Remover" clears the source, so image_to_video is not submitted', async () => {
    await openPicker()
    await pickAi()
    fireEvent.click(screen.getByTestId('i2v-source-clear'))
    typePrompt()
    fireEvent.click(screen.getByTestId('generate-video'))
    await Promise.resolve()
    expect(submittedBody()).toBeNull()
  })
})

describe('390px: the compact summary can never widen the dialog', () => {
  it('the source field and every ancestor up to the DialogContent grid can shrink (min-w-0), so a long nowrap name truncates instead of widening the form', async () => {
    state.ai = [aiRow('img-1', { name: 'um-nome-muito-longo-'.repeat(12) })]
    await openPicker()
    await pickAi()
    const picker = screen.getByTestId('i2v-source-picker')
    expect(picker.className).toMatch(/\bmin-w-0\b/)
    // the dialog form wrapper is a direct child of the DialogContent grid: without min-w-0 the grid track grows to its widest nowrap content
    const wrapper = picker.closest('.space-y-5') as HTMLElement
    expect(wrapper.className).toMatch(/\bmin-w-0\b/)
    expect(wrapper.parentElement?.className).toMatch(/\bgrid\b/)
    for (const id of ['i2v-source-summary', 'i2v-source-summary-name']) {
      expect(screen.getByTestId(id).className).toMatch(/min-w-0|truncate/)
    }
    expect(screen.getByTestId('i2v-source-summary-name').parentElement?.className).toMatch(/min-w-0/)
  })
})

describe('the old flat picker is gone', () => {
  it('no permanent two-tab "Geradas | Arquivos" grid and no unbounded Library query from the new chooser', async () => {
    await openPicker()
    expect(screen.queryByTestId('i2v-source-tab-generated')).toBeNull()
    await pickLibrary()
    expect(dialogFetch.mock.calls.some(([url]) => /^\/api\/library-files\?/.test(String(url)))).toBe(false)
  })
})
