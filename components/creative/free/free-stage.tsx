import React from 'react'
import type { FreeSegmentPayload } from '@/lib/schemas/creative/timeline'

/**
 * CREATIVE_EDITOR_FREE_DEFAULT_AND_TEMPLATE_ENTRY_V1 — the ONE drawing of a free
 * (Template-less) composition, shared by:
 *  - the Video `free` segment (remotion/timeline/FreeSegment.tsx, inside its Sequence);
 *  - the Static free still (remotion/DocumentaryCardComposition.tsx, renderStill);
 *  - the Static editor preview (plain DOM).
 *
 * It is pure spatial rendering: positioned boxes (fractions of the stage,
 * origin top-left), style-token ROLES, and already-resolved image URLs. No
 * timeline, no Template, no persisted state. Paint order = element order
 * (back -> front). Text size is a semantic step scaled by the stage's SHORTER
 * side, so a composition keeps its proportions on any stage.
 */

export type FreeStageElement = FreeSegmentPayload['elements'][number]

/** Text size steps as a fraction of the stage's shorter side (1080 → 38 / 54 / 81 / 119 px). */
export const FREE_TEXT_SIZE_SCALE = { small: 0.035, medium: 0.05, large: 0.075, title: 0.11 } as const

type RoleToken = { family: string; weight?: number; style?: string }
export type FreeStageTokens = {
  colors: Record<string, string | undefined> & { background: string; foreground: string }
  typography: { display: RoleToken; body: RoleToken }
}

export type FreeStageImage = React.ComponentType<{ src: string; alt?: string; style?: React.CSSProperties }>

function boxStyle(element: FreeStageElement, width: number, height: number, zIndex: number): React.CSSProperties {
  const { x, y, width: w, height: h } = element.box
  return { position: 'absolute', left: x * width, top: y * height, width: w * width, height: h * height, overflow: 'hidden', zIndex }
}

export function FreeStage({ elements, width, height, tokens, imageUrl, ImageComponent, inactive, dataAttributes }: {
  elements: readonly FreeStageElement[]
  width: number
  height: number
  tokens: FreeStageTokens
  /** Resolved (runtime-only) URL of an image element's asset ref; undefined = not drawn. */
  imageUrl: (assetRef: string) => { url?: string; alt?: string } | undefined
  /** Remotion `Img` in renders (waits for load); a plain `img` in the editor. */
  ImageComponent: FreeStageImage
  /** Elements not drawn at this instant (Video element timing); their paint slot is kept. */
  inactive?: ReadonlySet<string>
  dataAttributes?: Record<string, string>
}) {
  const { colors, typography } = tokens
  const shortSide = Math.min(width, height)
  return (
    // isolation: the elements' z-index stays INSIDE this composition, so later tracks (root B-roll, lower thirds) still paint above it.
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', isolation: 'isolate', background: colors.background }} {...dataAttributes}>
      {elements.map((element, index) => {
        if (inactive?.has(element.element_id)) return null
        if (element.kind === 'image') {
          const asset = imageUrl(element.asset_ref)
          if (!asset?.url) return null
          return (
            <div key={element.element_id} style={boxStyle(element, width, height, index + 1)} data-free-element={element.element_id} data-free-kind="image">
              <ImageComponent src={asset.url} alt={asset.alt ?? ''} style={{ width: '100%', height: '100%', objectFit: element.fit, display: 'block' }} />
            </div>
          )
        }
        const role = typography[element.typography]
        return (
          <div
            key={element.element_id}
            style={{
              ...boxStyle(element, width, height, index + 1),
              color: colors[element.color] ?? colors.foreground,
              fontFamily: role.family,
              fontWeight: role.weight,
              fontStyle: role.style as React.CSSProperties['fontStyle'],
              fontSize: FREE_TEXT_SIZE_SCALE[element.size] * shortSide,
              lineHeight: element.typography === 'display' ? 1.08 : 1.3,
              textAlign: element.align,
              whiteSpace: 'pre-wrap',
              overflowWrap: 'break-word',
            }}
            data-free-element={element.element_id}
            data-free-kind="text"
          >
            {element.text}
          </div>
        )
      })}
    </div>
  )
}
