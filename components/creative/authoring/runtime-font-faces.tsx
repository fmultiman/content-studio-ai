'use client'

import { RUNTIME_FONT_FAMILIES, runtimeFontFaceCss } from '@/lib/creative/typography/resolve-typography'

/**
 * CREATIVE_EDITOR_CONTEXTUAL_STYLES_AND_TYPOGRAPHY_V1 — declares the supported runtime fonts to the editor document.
 * The editor previously relied on the browser having them installed; the font picker and the canvas now paint the
 * SAME registry faces the render worker declares for the final PNG (one registry, no second font list).
 */
export function RuntimeFontFaces() {
  return <style data-testid="runtime-font-faces" dangerouslySetInnerHTML={{ __html: runtimeFontFaceCss(RUNTIME_FONT_FAMILIES) }} />
}
