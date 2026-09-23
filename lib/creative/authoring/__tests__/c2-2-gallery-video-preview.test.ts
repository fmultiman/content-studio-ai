/**
 * Phase 2I-C2.2 — Gallery video preview correction.
 *
 * Root cause: the Gallery preview modal rendered
 * `<video src={output.downloadUrl}>` directly, where `downloadUrl` is the
 * attachment-disposition ENDPOINT (`/api/render-executions/:id/output-url?
 * disposition=attachment`) — an API route that returns `{ url, expiresAt }`
 * JSON, not a video stream. The browser's <video> tag issued a GET to that
 * endpoint (matching the reported Network evidence) and failed to decode
 * the JSON response as media, producing a black player stuck at 0:00 —
 * while the exact same execution's MP4 played fine from /videos, which
 * correctly fetches the JSON first and assigns the resolved `url` to the
 * player. These are source-regex tests, matching this repo's existing
 * convention for this exact file (see the Phase 2I-C1 hydration tests
 * above in this same describe block's file).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const galleryPageSource = readFileSync(
  join(process.cwd(), 'app', '(dashboard)', 'galeria', 'page.tsx'),
  'utf-8',
)
const galleryLibrarySource = readFileSync(
  join(process.cwd(), 'lib', 'gallery-output-library.ts'),
  'utf-8',
)

describe('Phase 2I-C2.2 — Gallery Visualizar never uses the attachment endpoint', () => {
  it('the modal video player source comes from a fetched inline signed URL, not output.downloadUrl', () => {
    expect(galleryPageSource).not.toMatch(/<video[\s\S]{0,80}src=\{output\.downloadUrl\}/)
    expect(galleryPageSource).toMatch(/<video[\s\S]{0,80}src=\{videoPreviewUrl\}/)
  })

  it('the preview fetch targets videoPreviewEndpoint (no disposition param)', () => {
    expect(galleryPageSource).toMatch(/fetch\(endpoint\)/)
    expect(galleryPageSource).toMatch(/loadVideoPreview\(output\.videoPreviewEndpoint\)/)
  })

  it('gallery-output-library sets videoPreviewEndpoint without a disposition query param', () => {
    const match = galleryLibrarySource.match(/videoPreviewEndpoint: `([^`]*)`/)
    expect(match).not.toBeNull()
    expect(match![1]).not.toContain('disposition')
  })
})

describe('Phase 2I-C2.2 — Baixar still uses the attachment endpoint, resolved before navigating', () => {
  it('handleDownload fetches the attachment endpoint and only navigates using the resolved url', () => {
    expect(galleryPageSource).toMatch(/const response = await fetch\(output\.downloadUrl\)/)
    expect(galleryPageSource).toMatch(/link\.href = data\.url/)
    // Regression guard: never assign the raw endpoint string directly as
    // the anchor href for a video download again.
    expect(galleryPageSource).not.toMatch(/link\.href = output\.downloadUrl/)
  })

  it('download endpoint still carries disposition=attachment', () => {
    const match = galleryLibrarySource.match(/downloadUrl: `([^`]*)`/)
    expect(match).not.toBeNull()
    expect(match![1]).toContain('disposition=attachment')
  })
})

describe('Phase 2I-C2.2 — modal preview lifecycle', () => {
  it('clears previous video preview state before deciding whether to fetch a new one (covers both item-switch and close)', () => {
    expect(galleryPageSource).toMatch(
      /useEffect\(\(\) => \{[\s\S]{0,800}setVideoPreviewUrl\(null\)\s*setVideoPreviewError\(null\)\s*setIsLoadingVideoPreview\(false\)/,
    )
  })

  it('the clearing effect is keyed on the target item, not the whole output object', () => {
    const effectMatch = galleryPageSource.match(
      /setVideoPreviewUrl\(null\)[\s\S]*?\}, \[([^\]]*)\]\)/,
    )
    expect(effectMatch).not.toBeNull()
    expect(effectMatch![1]).toContain('output?.id')
  })

  it('reopening (a fresh output?.id) re-fetches rather than reusing stale state', () => {
    expect(galleryPageSource).toMatch(/return loadVideoPreview\(output\.videoPreviewEndpoint\)/)
  })

  it('a failed preview fetch shows a bounded error with retry, never fakes playback', () => {
    expect(galleryPageSource).toMatch(/setVideoPreviewError\('Não foi possível carregar a prévia do vídeo\.'\)/)
    expect(galleryPageSource).toMatch(/onClick=\{retryVideoPreview\}/)
    expect(galleryPageSource).not.toMatch(/videoPreviewError[\s\S]{0,120}<video/)
  })

  it('Download remains reachable independent of preview loading/error state', () => {
    expect(galleryPageSource).toMatch(/disabled=\{!output\.canDownload\}/)
    expect(galleryPageSource).toMatch(/onClick=\{\(\) => onDownload\(output\)\}/)
  })
})

describe('Phase 2I-C2.2 — video cards never show the broken-image state', () => {
  it('GalleryImageFrame has a dedicated video branch before the "Imagem indisponível" fallback', () => {
    const start = galleryPageSource.indexOf('function GalleryImageFrame(')
    const end = galleryPageSource.indexOf('function GalleryEmptyStateView(')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const frameSource = galleryPageSource.slice(start, end)
    expect(frameSource).toMatch(/output\.mediaType === 'video' && !imageUrl/)
    expect(frameSource).toMatch(/Vídeo renderizado/)
    // The video branch's `if` check must appear textually BEFORE the
    // broken-image label IN CODE (single-quoted JSX text, not the
    // surrounding doc comment's double-quoted mention of the same phrase),
    // proving it short-circuits rather than falling through to it.
    expect(frameSource.indexOf("'video' && !imageUrl")).toBeLessThan(
      frameSource.indexOf("'Imagem indisponível'"),
    )
  })

  it('does not introduce a new thumbnail-generation backend or a fake thumbnail', () => {
    expect(galleryLibrarySource).toMatch(/thumbnailUrl: null,\s*\n\s*downloadUrl: `\/api\/render-executions/)
  })
})

describe('Phase 2I-C2.2 — image Gallery behavior is unaffected', () => {
  it('the image branch of GalleryImageFrame is unchanged (still keys off thumbnailUrl/imageUrl + hasError)', () => {
    expect(galleryPageSource).toMatch(/const imageUrl = output\.thumbnailUrl \|\| output\.imageUrl/)
    expect(galleryPageSource).toMatch(/onError=\{\(\) => setHasError\(true\)\}/)
  })

  it('the modal still renders GalleryImageFrame for non-video items', () => {
    expect(galleryPageSource).toMatch(/<GalleryImageFrame key=\{output\.id\} output=\{output\} \/>/)
  })
})
