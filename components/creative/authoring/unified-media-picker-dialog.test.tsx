// @vitest-environment jsdom
/**
 * CREATIVE_EDITOR_REAL_SMOKE_CORRECTNESS_HARDENING_V1 — Finding A (P0): a picked Library image must reach the
 * Static editor as the SIGNED display row the Canvas can paint, whatever tab it came from.
 *
 * Root cause pinned here: the picker used to read `library_files` straight from Supabase and hand the editor the
 * raw row. Its stored `public_url` is not a browser source (private bucket), so the Canvas <img> failed and showed
 * its alt text — the file name. Every selection now goes through `/api/library-files/:id/display` (signed).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { I2vSourceSelection } from '@/lib/video-generation/i2v-source'

// The first Dialog render in jsdom is slow on a cold transform; the behaviour under test is not time-bound.
vi.setConfig({ testTimeout: 30000 })

const toast = vi.fn()
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }))

// The browser must never be the editor's way to read a LibraryFile row: any direct client read fails the test.
const directRead = vi.fn()
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: (...args: unknown[]) => { directRead(...args); throw new Error('direct library_files read') } }) }))

let browserProps: Record<string, unknown> = {}
vi.mock('@/components/videos/i2v-source-browser', () => ({
  I2vSourceBrowser: (props: { onSelect: (selection: I2vSourceSelection) => void } & Record<string, unknown>) => {
    browserProps = props
    const pick = (selection: I2vSourceSelection) => () => props.onSelect(selection)
    const summary = (category: 'library' | 'gallery' | 'upload' | 'ai') => ({ category, label: 'x', thumbnailUrl: null, productionName: null, folder: null })
    return (
      <div>
        <button data-testid="pick-arquivos" onClick={pick({ source: { type: 'library', id: 'file-arquivos' }, summary: summary('library') })} />
        <button data-testid="pick-galeria" onClick={pick({ source: { type: 'library', id: 'file-galeria' }, summary: summary('gallery') })} />
        <button data-testid="pick-enviar" onClick={pick({ source: { type: 'library', id: 'file-enviado' }, summary: summary('upload') })} />
        <button data-testid="pick-ai" onClick={pick({ source: { type: 'generated', id: 'img-ai' }, summary: summary('ai') })} />
      </div>
    )
  },
}))

import { UnifiedMediaPickerDialog } from './unified-media-picker-dialog'

const PROJECT = '22222222-2222-4222-8222-222222222222'
const signedRow = (id: string) => ({ id, name: `${id}.png`, public_url: `https://signed.example/${id}?X-Amz-Signature=1`, thumbnail_url: `https://signed.example/${id}?X-Amz-Signature=1`, mime_type: 'image/png', origin: 'upload' })
const RAW_URL = 'https://raw-stored.example/private/object.png'

let fetchMock: ReturnType<typeof vi.fn>
let displayFails: Set<string>
beforeEach(() => {
  vi.clearAllMocks()
  displayFails = new Set()
  fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    if (url.startsWith('/api/images/') && init?.method === 'POST') {
      // The promotion route returns the RAW row (unsigned stored url) — exactly what must never reach the Canvas.
      return new Response(JSON.stringify({ result: 'created', libraryFile: { id: 'file-promoted', name: 'ai.png', public_url: RAW_URL, thumbnail_url: null, mime_type: 'image/png' } }), { status: 201 })
    }
    const match = url.match(/^\/api\/library-files\/([^/]+)\/display\?(.*)$/)
    if (match) {
      if (displayFails.has(match[1])) return new Response(JSON.stringify({ error: 'x' }), { status: 404 })
      return new Response(JSON.stringify({ file: signedRow(match[1]) }), { status: 200 })
    }
    return new Response('{}', { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const mount = (onSelect = vi.fn(), onOpenChange = vi.fn()) => {
  render(<UnifiedMediaPickerDialog open onOpenChange={onOpenChange} projectId={PROJECT} productionId="prod-1" onSelect={onSelect} />)
  return { onSelect, onOpenChange }
}

describe('Static media picker — the selection reaches the editor as a signed, paintable row', () => {
  it.each([['Arquivos', 'pick-arquivos', 'file-arquivos'], ['Galeria', 'pick-galeria', 'file-galeria'], ['Enviar (upload)', 'pick-enviar', 'file-enviado']])('3/4/5. %s: the editor receives the signed display row, immediately, with no direct table read', async (_label, testId, fileId) => {
    const { onSelect, onOpenChange } = mount()
    fireEvent.click(screen.getByTestId(testId))
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1))
    const file = onSelect.mock.calls[0][0]
    expect(file).toMatchObject({ id: fileId, mime_type: 'image/png' })
    expect(file.public_url).toContain('X-Amz-Signature')
    expect(file.thumbnail_url).toContain('X-Amz-Signature')
    expect(String(fetchMock.mock.calls[0][0])).toBe(`/api/library-files/${fileId}/display?${new URLSearchParams({ projectId: PROJECT })}`)
    expect(directRead).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('6. a generated AI image is promoted, then loaded like any LibraryFile: the editor never gets the raw promotion row', async () => {
    const { onSelect } = mount()
    fireEvent.click(screen.getByTestId('pick-ai'))
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1))
    const file = onSelect.mock.calls[0][0]
    expect(file.id).toBe('file-promoted')
    expect(file.public_url).toContain('X-Amz-Signature')
    expect(JSON.stringify(file)).not.toContain(RAW_URL)
    const urls = fetchMock.mock.calls.map(([url]) => String(url))
    expect(urls[0]).toBe('/api/images/img-ai/save-to-library')
    expect(urls[1]).toBe(`/api/library-files/file-promoted/display?${new URLSearchParams({ projectId: PROJECT })}`)
    expect(directRead).not.toHaveBeenCalled()
  })

  it('9. an unavailable file is reported and never handed to the editor (the fallback is only for genuinely missing media)', async () => {
    displayFails.add('file-arquivos')
    const { onSelect, onOpenChange } = mount()
    fireEvent.click(screen.getByTestId('pick-arquivos'))
    await waitFor(() => expect(toast).toHaveBeenCalled())
    expect(toast.mock.calls[0][0]).toMatchObject({ variant: 'destructive' })
    expect(onSelect).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('32. the Static picker defaults to ALL Productions (a file with no Production must be visible without touching the filter)', () => {
    mount()
    expect(browserProps.defaultProductionMode).toBe('all')
    // the Production of the editor is still passed (it stays the Production of an upload and the "Production atual" option)
    expect(browserProps.productionId).toBe('prod-1')
    expect(browserProps.projectId).toBe(PROJECT)
  })
})
