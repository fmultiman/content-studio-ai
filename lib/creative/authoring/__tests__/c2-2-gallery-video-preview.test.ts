/**
 * Phase 2I-C2.2 — Gallery video preview correction (re-pointed at the Wave 1A-2 S2 Gallery).
 *
 * Root cause (unchanged, and still guarded here): the Gallery preview modal once rendered
 * `<video src={output.downloadUrl}>` directly, where `downloadUrl` is the attachment-disposition ENDPOINT
 * (`/api/render-executions/:id/output-url?disposition=attachment`) - an API route that returns `{ url, expiresAt }` JSON, not a
 * video stream. The browser's <video> tag issued a GET to that endpoint and failed to decode the JSON as media, producing a black
 * player stuck at 0:00, while the same MP4 played fine from /videos, which fetches the JSON first and assigns the resolved `url`.
 *
 * Since Wave 1A-2 S2 the media layer lives in `components/gallery/gallery-media.tsx` (fed by the per-item endpoints that
 * `lib/gallery/outputs.ts` names in `access`). These are source-regex tests, matching this repo's convention for this file; the
 * runtime behaviour of the same rules is exercised in `components/gallery/gallery-page.test.tsx`.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const read = (...segments: string[]) => readFileSync(join(process.cwd(), ...segments), 'utf-8').replace(/\r\n/g, '\n')
const galleryPageSource = read('app', '(dashboard)', 'galeria', 'page.tsx')
const mediaSource = read('components', 'gallery', 'gallery-media.tsx')
const outputsSource = read('lib', 'gallery', 'outputs.ts')
const uiModelSource = read('lib', 'gallery', 'ui-model.ts')

describe('Phase 2I-C2.2 — Gallery Visualizar never uses the attachment endpoint', () => {
  it('the modal video player source comes from a fetched inline signed URL, never from an endpoint', () => {
    expect(mediaSource).not.toMatch(/<video[\s\S]{0,120}src=\{output\.access/)
    expect(mediaSource).not.toMatch(/<video[\s\S]{0,120}src=\{[^}]*Endpoint/)
    expect(mediaSource).toMatch(/<video[\s\S]{0,120}src=\{state\.url\}/)
  })

  it('the preview fetch targets previewEndpoint (no disposition param); only a download uses the other one', () => {
    expect(mediaSource).toMatch(/purpose === 'download' \? item\.access\.downloadEndpoint : item\.access\.previewEndpoint/)
    expect(mediaSource).toMatch(/useOutputMedia\(output, 'preview', true\)/)
  })

  it('the canonical outputs set previewEndpoint without a disposition query param', () => {
    const previews = outputsSource.match(/previewEndpoint: `[^`]*`/g) ?? []
    expect(previews.length).toBeGreaterThanOrEqual(3)
    for (const preview of previews) expect(preview).not.toContain('disposition')
  })
})

describe('Phase 2I-C2.2 — Baixar still uses the attachment endpoint, resolved before navigating', () => {
  it('download fetches the attachment endpoint and only navigates using the resolved url', () => {
    expect(mediaSource).toMatch(/const answer = await fetchMediaUrl\(output, 'download'\)/)
    expect(mediaSource).toMatch(/anchor\(answer\.url, ''\)/)
    // Regression guard: never assign the raw endpoint string as the anchor href again.
    expect(mediaSource).not.toMatch(/link\.href = output\.access/)
    expect(mediaSource).not.toMatch(/anchor\(output\.access/)
  })

  it('download endpoints of renders and AI videos still carry disposition=attachment', () => {
    expect((outputsSource.match(/downloadEndpoint: `[^`]*disposition=attachment`/g) ?? []).length).toBe(2)
  })
})

describe('Phase 2I-C2.2 — modal preview lifecycle', () => {
  it('clears the previous media state before deciding whether to fetch a new one (covers both item-switch and close)', () => {
    expect(mediaSource).toMatch(/if \(!item \|\| !enabled\) \{[\s\S]{0,200}setState\(\{ status: 'idle' \}\)[\s\S]{0,40}return/)
    expect(mediaSource).toMatch(/setState\(\{ status: 'loading' \}\)/)
  })

  it('the effect is keyed on the target item, not the whole output object', () => {
    const effect = mediaSource.match(/\}, \[(item\?\.key[^\]]*)\]\)/)
    expect(effect).not.toBeNull()
    expect(effect![1]).toContain('item?.key')
    expect(effect![1]).not.toMatch(/\bitem\b(?!\?\.key)/)
  })

  it('reopening a preview re-fetches (the dialog content is keyed by output) rather than reusing stale state', () => {
    expect(galleryPageSource).toMatch(/<GalleryPreviewMedia key=\{output\.key\} output=\{output\} \/>/)
    expect(mediaSource).toMatch(/return \(\) => abort\.abort\(\)/)
  })

  it('a failed preview shows a bounded error with retry, never fakes playback', () => {
    expect(mediaSource).toMatch(/describeMediaFailure\(state\.reason\)/)
    expect(mediaSource).toMatch(/onClick=\{retry\}/)
    // The player/picture is only rendered after the failed branch has returned.
    expect(mediaSource.indexOf("state.status === 'failed'")).toBeLessThan(mediaSource.indexOf('<video'))
  })

  it('Download remains reachable independent of preview loading/error state', () => {
    expect(galleryPageSource).toMatch(/<Button type="button" onClick=\{\(\) => onDownload\(output\)\}>/)
    expect(galleryPageSource).not.toMatch(/disabled=\{!output\.canDownload\}/)
  })
})

describe('Phase 2I-C2.2 — video cards never show the broken-image state', () => {
  it('the media frame has a dedicated video branch that returns before the picture fallback and never fetches', () => {
    const start = mediaSource.indexOf('export function GalleryMediaFrame(')
    const end = mediaSource.indexOf('/** Large picture / player')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const frame = mediaSource.slice(start, end)
    expect(frame).toMatch(/if \(!isPicture\) \{/)
    expect(frame).toMatch(/data-testid="gallery-video-placeholder"/)
    expect(frame).toMatch(/useOutputMedia\(output, 'thumbnail', isPicture && near\)/) // a video never asks for a thumbnail
    expect(frame.indexOf('if (!isPicture)')).toBeLessThan(frame.indexOf('Carregando…'))
    expect(mediaSource).toMatch(/video_render: 'Vídeo renderizado'/)
  })

  it('does not introduce a new thumbnail-generation backend or a fake thumbnail', () => {
    expect(mediaSource).not.toMatch(/poster=|thumbnail-generation|canvas|ffmpeg/i)
    expect(uiModelSource).toMatch(/export function mediaRenderer/)
  })
})

describe('Phase 2I-C2.2 — pictures keep their behaviour', () => {
  it('a picture resolves lazily, retries once when its URL expired, then shows the honest placeholder', () => {
    expect(mediaSource).toMatch(/useNearViewport\(\)/)
    expect(mediaSource).toMatch(/if \(!retried\.current\) \{\s*retried\.current = true\s*retry\(\)/)
    expect(mediaSource).toMatch(/broken > 1/)
  })

  it('the modal renders a picture (not a player) for AI images and static renders', () => {
    expect(mediaSource).toMatch(/renderer === 'video' \? \(/)
    expect(mediaSource).toMatch(/data-testid="gallery-preview-image"/)
  })
})
