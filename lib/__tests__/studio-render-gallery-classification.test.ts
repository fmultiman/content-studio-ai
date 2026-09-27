/**
 * Creative Editor Template Foundation V1 — Gallery vs Arquivos discovery.
 *
 *   uploaded Project asset             -> Arquivos / "Arquivos do projeto"
 *   saved Creative Editor PNG          -> Galeria / "Imagens geradas"
 *   scratch static execution (unsaved) -> neither (not a LibraryFile)
 *
 * Behavioral where the logic is pure (buildGalleryOutputs, save helper);
 * source assertions for routes/pages, the repo's route-testing convention.
 */
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildGalleryOutputs, type StudioRenderSource } from '../gallery-output-library'
import { saveRenderFileToChannelPiece } from '../creative/authoring/save-render'

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf-8')

const studioRender: StudioRenderSource = {
  id: 'lf-render-1',
  project_id: 'project-1',
  name: 'slide-1-de-2-d65f13ee.png',
  public_url: 'https://signed.example/render.png',
  thumbnail_url: null,
  created_at: '2026-09-24T00:43:22Z',
  updated_at: '2026-09-24T00:43:22Z',
  origin: 'studio_render',
  kind: 'image',
  deleted_at: null,
}

describe('buildGalleryOutputs — studio renders', () => {
  it('lists a saved Creative Editor PNG as a Gallery image, tagged as a studio render', () => {
    const [item] = buildGalleryOutputs({ images: [], projects: [{ id: 'project-1', name: 'Portal' }], studioRenders: [studioRender] })
    expect(item).toMatchObject({ id: 'lf-render-1', mediaType: 'image', source: 'studio_render', title: 'Creative Editor · Slide 1/2', projectName: 'Portal', imageUrl: 'https://signed.example/render.png', videoPreviewEndpoint: null })
  })

  it('never lists an uploaded LibraryFile (paper/tape) even if one is passed in', () => {
    const upload = { ...studioRender, id: 'lf-paper', name: 'paper-card-light-01.png', origin: 'upload' as const }
    expect(buildGalleryOutputs({ images: [], studioRenders: [upload] })).toEqual([])
  })

  it('never lists a trashed studio render', () => {
    expect(buildGalleryOutputs({ images: [], studioRenders: [{ ...studioRender, deleted_at: '2026-09-24T01:00:00Z' }] })).toEqual([])
  })

  it('never turns a completed scratch static execution into a Gallery item (only the explicit save does)', () => {
    const scratch = { id: 'd65f13ee-640a-4e25-a69a-833db150a086', video_draft_id: null, status: 'completed' as const, completed_at: '2026-09-24T00:41:57Z', queued_at: '2026-09-24T00:41:40Z', kind: 'static_still' as const }
    expect(buildGalleryOutputs({ images: [], executions: [scratch as never] })).toEqual([])
  })

  it('leaves AI images and video renders unchanged (no source tag)', () => {
    const outputs = buildGalleryOutputs({
      images: [{ id: 'img-1', project_id: 'project-1', user_input: 'x', generated_prompt: null, image_url: 'https://a/i.png', thumbnail_url: null, storage_path: null, thumbnail_path: null, status: 'approved', created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z' } as never],
      executions: [{ id: 'exec-v', video_draft_id: 'vd-1', status: 'completed', completed_at: '2026-09-02T00:00:00Z', queued_at: '2026-09-02T00:00:00Z', kind: 'video' } as never],
      studioRenders: [studioRender],
    })
    expect(outputs.find((output) => output.id === 'img-1')).not.toHaveProperty('source')
    expect(outputs.find((output) => output.id === 'exec-v')).toMatchObject({ mediaType: 'video' })
    expect(outputs.find((output) => output.id === 'exec-v')).not.toHaveProperty('source')
  })
})

describe('Salvar nesta peça — classification boundary', () => {
  it('sends the originating execution id with the explicit save', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ libraryFile: { id: 'lf' }, channelPieceMedium: { id: 'cpm' } }), { status: 201 }))
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'slide-1-de-2-d65f13ee.png', { type: 'image/png' })
    const result = await saveRenderFileToChannelPiece({ file, channelPieceId: 'cp', renderExecutionId: 'd65f13ee-640a-4e25-a69a-833db150a086', fetchImpl })
    expect(result.ok).toBe(true)
    const body = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData
    expect(body.get('renderExecutionId')).toBe('d65f13ee-640a-4e25-a69a-833db150a086')
  })

  it('the Creative Editor passes the job execution id when saving', () => {
    const page = read('app', '(dashboard)', 'projetos', '[id]', 'conteudos', '[editorialContentId]', 'channel-pieces', '[channelPieceId]', 'editar-visual', 'page.tsx')
    expect(page).toMatch(/saveRenderFileToChannelPiece\(\{ file, channelPieceId: context\.channelPiece\.id, renderExecutionId: executionId \}\)/)
  })

  it('the upload route marks studio_render ONLY after verifying the caller owns a completed static_still execution of this piece', () => {
    const route = read('app', 'api', 'channel-piece-media', 'upload', 'route.ts')
    expect(route).toMatch(/\.from\('render_executions'\)[\s\S]*\.eq\('id', renderExecutionId\)[\s\S]*\.eq\('user_id', user\.id\)/)
    expect(route).toMatch(/execution\.kind !== 'static_still' \|\| execution\.status !== 'completed' \|\| execution\.channel_piece_id !== channelPieceId/)
    expect(route).toMatch(/renderExecutionId \? \{ origin: 'studio_render', source_render_execution_id: renderExecutionId \} : \{\}/)
    // Plain uploads keep the column default ('upload'): no origin written without a verified execution.
    expect(route.match(/origin: 'studio_render'/g)).toHaveLength(1)
  })
})

describe('Discovery surfaces', () => {
  it('library-files API filters by origin and rejects unknown values', () => {
    const route = read('app', 'api', 'library-files', 'route.ts')
    expect(route).toMatch(/if \(origin && origin !== 'all'\) query = query\.eq\('origin', origin\)/)
    expect(route).toMatch(/origin !== 'upload' && origin !== 'studio_render' && origin !== 'all'/)
  })

  it('Arquivos keeps static studio PNGs out while including explicitly saved studio videos', () => {
    const arquivos = read('app', '(dashboard)', 'arquivos', 'page.tsx')
    expect(arquivos).toMatch(/params\.set\('origin', 'all'\)/)
    expect(arquivos).toMatch(/file\.origin !== 'studio_render' \|\| file\.kind === 'video'/)
  })

  it('Adicionar mídia: studio renders under "Imagens geradas", uploads under "Arquivos do projeto"', () => {
    const picker = read('components', 'publication', 'media-picker-dialog.tsx')
    expect(picker).toMatch(/origin=studio_render&kind=image/)
    expect(picker).toMatch(/library-files\?projectId=\$\{encodeURIComponent\(projectId\)\}&origin=upload/)
    expect(picker).toMatch(/\{studioRenders\.map\(\(file\) => \(\s*<LibraryCard/)
  })

  it('Galeria fetches studio renders in isolation (a failure never blanks images/videos)', () => {
    const gallery = read('app', '(dashboard)', 'galeria', 'page.tsx')
    expect(gallery).toMatch(/fetch\('\/api\/library-files\?origin=studio_render&kind=image'\)/)
    expect(gallery).toMatch(/setStudioRenders\(\[\]\)/)
  })

  it('the piece media list labels a saved render as "Imagem gerada"', () => {
    const section = read('components', 'publication', 'channel-piece-media-section.tsx')
    expect(section).toMatch(/item\.image_id \|\| item\.library_origin === 'studio_render' \? 'Imagem gerada' : 'Arquivo do projeto'/)
  })
})
