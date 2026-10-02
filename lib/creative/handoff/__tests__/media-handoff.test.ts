import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  HANDOFF_MEDIA_PARAM, handoffCompatibility, isHandoffCompatible, parseIncomingMediaParam, prioritizeByProduction, staticHandoffHref, videoHandoffHref,
} from '@/lib/creative/handoff/media-handoff'

// GENERATED_MEDIA_TO_CREATIVE_EDITOR_HANDOFF_V1 — the pure contract.

const ID = '11111111-1111-4111-8111-111111111111'

describe('incoming media parameter', () => {
  it('accepts exactly one UUID and normalizes its case', () => {
    expect(parseIncomingMediaParam(ID)).toBe(ID)
    expect(parseIncomingMediaParam(` ${ID.toUpperCase()} `)).toBe(ID)
  })

  it.each([null, undefined, '', 'abc', `${ID}/../x`, `${ID}?x=1`, 'https://signed.example/a.png', 'users/u/library/f/a.png'])('ignores %s (the editor opens normally)', (value) => {
    expect(parseIncomingMediaParam(value as string | null | undefined)).toBeNull()
  })

  it('ignores a repeated parameter (an array is never an identity)', () => {
    expect(parseIncomingMediaParam([ID, ID])).toBeNull()
  })
})

describe('compatibility matrix (audited against the executing editors)', () => {
  it('image -> Static + Video', () => {
    expect(handoffCompatibility({ kind: 'image', mime_type: 'image/png' })).toEqual({ static: true, video: true })
    expect(handoffCompatibility({ kind: 'image', mime_type: 'image/webp' })).toEqual({ static: true, video: true })
  })

  it('video -> Video only (never the Static editor)', () => {
    expect(handoffCompatibility({ kind: 'video', mime_type: 'video/mp4' })).toEqual({ static: false, video: true })
    expect(isHandoffCompatible({ kind: 'video', mime_type: 'video/mp4' }, 'static')).toBe(false)
  })

  it('unsupported kinds and non-renderable MIME types have no target', () => {
    for (const file of [
      { kind: 'audio', mime_type: 'audio/mpeg' },
      { kind: 'document', mime_type: 'application/pdf' },
      { kind: 'other', mime_type: null },
      { kind: 'image', mime_type: 'image/svg+xml' },
      { kind: 'image', mime_type: null },
      { kind: 'video', mime_type: 'video/x-matroska' },
    ] as const) expect(handoffCompatibility(file)).toEqual({ static: false, video: false })
  })
})

describe('navigation contract', () => {
  const staticTarget = { projectId: 'p1', editorialContentId: 'e1', channelPieceId: 'c1' }

  it('Static uses the canonical editar-visual route + the stable media id', () => {
    expect(staticHandoffHref(staticTarget, ID)).toBe(`/projetos/p1/conteudos/e1/channel-pieces/c1/editar-visual?${HANDOFF_MEDIA_PARAM}=${ID}`)
  })

  it('Video uses the canonical creative-editor route + the stable media id', () => {
    expect(videoHandoffHref('d1', ID)).toBe(`/creative-editor/video/d1?media=${ID}`)
  })

  it('carries ONLY the LibraryFile id: no signed URL, storage path or provider data can reach the URL', () => {
    const hrefs = [staticHandoffHref(staticTarget, ID), videoHandoffHref('d1', ID)]
    for (const href of hrefs) {
      const url = new URL(href, 'https://app.example')
      expect([...url.searchParams.keys()]).toEqual(['media'])
      expect(url.searchParams.get('media')).toBe(ID)
      expect(href).not.toMatch(/X-Amz|signature|storage_path|users\/|library\/|https?:\/\/|provider|task|source_image|generation/i)
    }
  })

  it('the helper module has no input that could smuggle a URL (identity-only signature)', () => {
    const source = readFileSync(join(process.cwd(), 'lib', 'creative', 'handoff', 'media-handoff.ts'), 'utf-8')
    expect(source).not.toMatch(/public_url|storage_path|signedUrl|thumbnail_url/)
  })
})

describe('Production is context, never a boundary', () => {
  const targets = [
    { id: 'a', productionId: 'P2' }, { id: 'b', productionId: null }, { id: 'c', productionId: 'P1' }, { id: 'd', productionId: 'P1' },
  ]

  it('same-Production targets come first; every other Project target stays available, order preserved', () => {
    expect(prioritizeByProduction(targets, 'P1').map((t) => t.id)).toEqual(['c', 'd', 'a', 'b'])
  })

  it('a LibraryFile without a Production (NULL) leaves the order untouched and drops nothing', () => {
    expect(prioritizeByProduction(targets, null).map((t) => t.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('a different Production in the same Project is never filtered out', () => {
    expect(prioritizeByProduction(targets, 'P9')).toHaveLength(4)
  })
})
