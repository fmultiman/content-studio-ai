// @vitest-environment jsdom
// VIDEO_I2V_LIBRARY_SOURCE_PICKER_V1
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { normalizeKlingMcpVideoCapabilities } from '@/lib/provider-connections/kling-mcp-video-capabilities'
import { whoAmIFixture } from '@/lib/__tests__/helpers/kling-who-am-i-fixture'
import { describeMcpConnection, describeRestConnection } from '@/lib/video-generation/connections'
import type { VideoGenerationConnectionDescriptor } from '@/lib/video-generation/capabilities'
import type { ProviderConnectionRow } from '@/lib/provider-connections/types'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))

let generatedRows: Array<{ id: string; image_url: string; user_input: string }> = []
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        neq: () => chain,
        order: () => chain,
        limit: () => Promise.resolve({ data: generatedRows }),
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

const libFile = (overrides: Record<string, unknown> = {}) => ({
  id: 'lib-1',
  project_id: 'proj-1',
  kind: 'image',
  name: 'capa-do-lancamento.png',
  deleted_at: null,
  thumbnail_url: 'https://s3.example.test/lib-1.png?sig=1',
  public_url: null,
  ...overrides,
})

let libraryStatus = 200
let libraryFiles: any[] = []
const fetchMock = vi.fn()
const libraryRequests: string[] = []

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
  libraryRequests.length = 0
  libraryStatus = 200
  generatedRows = [{ id: 'img-1', image_url: 'https://img.example.test/a.png', user_input: 'Uma raposa' }]
  libraryFiles = [libFile()]
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/video-generations/connections') {
      return new Response(JSON.stringify({ connections: [describeRestConnection('configured'), mcpDescriptor()] }), { status: 200 })
    }
    if (url.startsWith('/api/library-files?')) {
      libraryRequests.push(url)
      return new Response(JSON.stringify({ files: libraryFiles }), { status: libraryStatus })
    }
    if (url === '/api/video-generations' && init?.method === 'POST') return new Response(JSON.stringify({ generation: { id: 'g1' } }), { status: 200 })
    return new Response('{}', { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const renderDialog = () =>
  render(<CreateVideoGenerationDialog open onOpenChange={() => undefined} projectId="proj-1" productionId="prod-1" />)

const submittedBody = () => {
  const call = fetchMock.mock.calls.find(([url, init]) => url === '/api/video-generations' && init?.method === 'POST')
  return call ? JSON.parse(call[1].body as string) : null
}

const tab = (group: 'generated' | 'library') => fireEvent.click(screen.getByTestId(`i2v-source-tab-${group}`))
const pickGenerated = async (id = 'img-1') => fireEvent.click(await screen.findByTestId(`i2v-source-option-generated-${id}`))
const pickLibrary = async (id = 'lib-1') => {
  tab('library')
  fireEvent.click(await screen.findByTestId(`i2v-source-option-library-${id}`))
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

describe('Image-to-Video source picker (Geradas + Arquivos)', () => {
  it('shows "Imagem de Origem" with generated and Arquivos groups, and no longer says generated-only', async () => {
    await openPicker()
    expect(screen.getByText('Imagem de Origem')).toBeTruthy()
    expect(screen.getByTestId('i2v-source-tab-generated').textContent).toBe('Geradas')
    expect(screen.getByTestId('i2v-source-tab-library').textContent).toBe('Arquivos')
    expect(document.body.textContent).not.toMatch(/imagem gerada neste Projeto/i)
    expect(document.body.textContent).not.toMatch(/source_(image|library)|storage_path/i)
  })

  it('generated images stay visible and selectable (existing behavior)', async () => {
    await openPicker()
    const option = await screen.findByTestId('i2v-source-option-generated-img-1')
    expect(option.textContent).toContain('Uma raposa')
    fireEvent.click(option)
    expect(screen.getByTestId('i2v-source-option-generated-img-1').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('i2v-source-summary').textContent).toContain('Uma raposa (Geradas)')
  })

  it('Library images are visible and selectable; the Library is queried by Project and kind image only', async () => {
    await openPicker()
    tab('library')
    const option = await screen.findByTestId('i2v-source-option-library-lib-1')
    expect(option.textContent).toContain('capa-do-lancamento.png')
    expect(libraryRequests).toEqual(['/api/library-files?projectId=proj-1&kind=image'])
    fireEvent.click(option)
    expect(screen.getByTestId('i2v-source-summary').textContent).toContain('capa-do-lancamento.png (Arquivos)')
  })

  it('video, deleted and other-Project files are never offered, even if the list contained them', async () => {
    libraryFiles = [
      libFile(),
      libFile({ id: 'lib-video', kind: 'video', name: 'clipe.mp4' }),
      libFile({ id: 'lib-trash', deleted_at: '2026-09-01T00:00:00Z', name: 'lixeira.png' }),
      libFile({ id: 'lib-other', project_id: 'proj-other', name: 'outro.png' }),
    ]
    await openPicker()
    tab('library')
    await screen.findByTestId('i2v-source-option-library-lib-1')
    for (const id of ['lib-video', 'lib-trash', 'lib-other']) expect(screen.queryByTestId(`i2v-source-option-library-${id}`)).toBeNull()
  })

  it('a generated selection submits source_image_id only', async () => {
    await openPicker()
    await pickGenerated()
    const body = await generate()
    expect(body.sourceImageId).toBe('img-1')
    expect('sourceLibraryFileId' in body).toBe(false)
  })

  it('a Library selection submits source_library_file_id only (never converted to an image id)', async () => {
    await openPicker()
    await pickLibrary()
    const body = await generate()
    expect(body.sourceLibraryFileId).toBe('lib-1')
    expect('sourceImageId' in body).toBe(false)
    expect(JSON.stringify(body)).not.toMatch(/storage|signed|thumbnail|s3\.example/)
  })

  it('switching generated → Library leaves no stale image id, and Library → generated leaves no stale file id', async () => {
    await openPicker()
    await pickGenerated()
    await pickLibrary()
    expect(screen.getByTestId('i2v-source-summary').textContent).toContain('(Arquivos)')
    tab('generated')
    expect((await screen.findByTestId('i2v-source-option-generated-img-1')).getAttribute('aria-pressed')).toBe('false')
    const toLibrary = await generate()
    expect(toLibrary.sourceLibraryFileId).toBe('lib-1')
    expect('sourceImageId' in toLibrary).toBe(false)
  })

  it('switching Library → generated leaves only the image id', async () => {
    await openPicker()
    await pickLibrary()
    tab('generated')
    await pickGenerated()
    const body = await generate()
    expect(body.sourceImageId).toBe('img-1')
    expect('sourceLibraryFileId' in body).toBe(false)
  })

  it('changing the connection (API ↔ MCP) does not corrupt the selected source', async () => {
    await openPicker()
    await pickLibrary()
    fireEvent.click(screen.getByTestId('video-connection-option-mcp'))
    await waitFor(() => expect(screen.getByTestId('video-connection-option-mcp').getAttribute('aria-checked')).toBe('true'))
    expect(screen.getByTestId('i2v-source-summary').textContent).toContain('capa-do-lancamento.png (Arquivos)')
    const body = await generate()
    expect(body.connectionRef).toMatch(/^kling:/)
    expect(body.connectionRef).not.toBe('kling:api')
    expect(body.sourceLibraryFileId).toBe('lib-1')
    expect('sourceImageId' in body).toBe(false)
  })

  it('leaving image_to_video drops the source: text_to_video submits neither, and coming back starts empty', async () => {
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

  it('returning to image_to_video after a text_to_video detour shows no stale selection', async () => {
    await openPicker()
    await pickLibrary()
    fireEvent.mouseDown(screen.getByTestId('operation-text_to_video'))
    fireEvent.click(screen.getByTestId('operation-text_to_video'))
    await waitFor(() => expect(screen.queryByTestId('i2v-source-picker')).toBeNull())
    fireEvent.mouseDown(screen.getByTestId('operation-image_to_video'))
    fireEvent.click(screen.getByTestId('operation-image_to_video'))
    await waitFor(() => expect(screen.getByTestId('i2v-source-picker')).toBeTruthy())
    expect(screen.getByTestId('i2v-source-summary').textContent).toMatch(/Escolha uma imagem/)
  })

  it('without a source image_to_video is not submitted', async () => {
    await openPicker()
    typePrompt()
    fireEvent.click(screen.getByTestId('generate-video'))
    await Promise.resolve()
    expect(submittedBody()).toBeNull()
  })
})

describe('Image-to-Video source picker — empty and failure states', () => {
  it('no generated images: explains how to get one and points at Arquivos; Library stays usable', async () => {
    generatedRows = []
    await openPicker()
    // With nothing generated but files in Arquivos, the chooser opens on Arquivos.
    await screen.findByTestId('i2v-source-option-library-lib-1')
    tab('generated')
    expect((await screen.findByTestId('i2v-source-empty-generated')).textContent).toMatch(/Gere uma imagem/)
    expect(screen.queryByTestId('i2v-source-empty-all')).toBeNull()
  })

  it('no Library images: explains how to upload/save into Arquivos; generated stays usable', async () => {
    libraryFiles = []
    await openPicker()
    await screen.findByTestId('i2v-source-option-generated-img-1')
    tab('library')
    expect((await screen.findByTestId('i2v-source-empty-library')).textContent).toMatch(/Envie ou salve uma imagem em Arquivos/)
  })

  it('neither available: one clear message (no Gallery path is suggested)', async () => {
    generatedRows = []
    libraryFiles = []
    await openPicker()
    const message = await screen.findByTestId('i2v-source-empty-all')
    expect(message.textContent).toMatch(/Gere uma imagem ou envie\/salve uma em Arquivos/)
    expect(document.body.textContent).not.toMatch(/Galeria/)
  })

  it('a Library load failure is not "empty": it offers a retry, and generated images still work', async () => {
    libraryStatus = 500
    await openPicker()
    await pickGenerated()
    tab('library')
    expect(await screen.findByTestId('i2v-source-library-failed')).toBeTruthy()
    expect(screen.queryByTestId('i2v-source-empty-library')).toBeNull()
    libraryStatus = 200
    fireEvent.click(screen.getByText('Tentar novamente'))
    await screen.findByTestId('i2v-source-option-library-lib-1')
  })
})
