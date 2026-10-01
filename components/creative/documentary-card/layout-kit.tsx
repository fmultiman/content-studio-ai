import type { CSSProperties, ReactNode } from 'react'
import { STACK_TOP_Z } from '@/lib/creative/templates/element-stack'
import { layoutTitleLineHeight } from '@/lib/creative/templates/template-definitions'
import { AssetLayer, GrainOverlay, Sparkle, elementTransform, materialMetrics, materialUrl } from './primitives'
import type { DocumentaryCardVisualContext } from './types'

/**
 * Portal Carousel Completion V1 — the shared grammar of the layouts rebuilt
 * from Pack A (Grade, Mapa, Rede, Citação, Encerramento), identical to
 * Lista's: 1080×1350 reference coordinates, z-index from the normalized
 * element stack, template text/chrome on the fixed top layer.
 */
export function layoutKit(context: DocumentaryCardVisualContext) {
  const sx = context.canvas.width / 1080
  const sy = context.canvas.height / 1350
  const isDark = context.resolvedAppearance === 'dark'
  return {
    x: (value: number) => value * sx,
    y: (value: number) => value * sy,
    isDark,
    ink: isDark ? '#efe4cc' : '#1d2a22',
    muted: isDark ? '#cdbf9f' : '#6d6150',
    green: '#23382c',
    gold: isDark ? '#c9a45c' : '#9a7a3a',
    paperInk: '#1d2a22',
    display: context.tokens.typography.display,
    body: context.tokens.typography.body.family,
    transforms: context.primitiveTransforms,
    z: (id: string, fallback: number) => context.stack.zIndex[id] ?? fallback,
    /** Static Detail Polish V1: authored hidden element (paints nothing). */
    hidden: (id: string) => context.hidden.has(id),
    hideStyle: (id: string): CSSProperties => (context.hidden.has(id) ? { display: 'none' } : {}),
    url: (name: Parameters<typeof materialUrl>[0]) => materialUrl(name, context.materialBaseUrl, context.materialUrls),
    fixedText: { opacity: context.contentOpacity, position: 'absolute', zIndex: STACK_TOP_Z } as CSSProperties,
    /**
     * STATIC_TEMPLATE_ATOMIC_VISUAL_ELEMENTS_V1 — a text/brand unit that used to sit on the fixed top layer with no identity.
     * It is an Element now: painted from the stack (on top by default, exactly where the fixed layer was) and hideable.
     */
    fixedAtom: (id: string, fallbackZ: number = STACK_TOP_Z): CSSProperties => ({
      opacity: context.contentOpacity,
      position: 'absolute',
      zIndex: context.stack.zIndex[id] ?? fallbackZ,
      ...(context.hidden.has(id) ? { display: 'none' } : {}),
    }),
  }
}

export type LayoutKit = ReturnType<typeof layoutKit>

/** Template chrome: background tone (green or navy night when dark), grain, a few stars. Not authored elements. */
export function LayoutBackground({ kit, night = false, stars = [] }: { kit: LayoutKit; night?: boolean; stars?: readonly (readonly [number, number, number])[] }) {
  const dark = night
    ? 'radial-gradient(120% 90% at 20% 10%, #16203a 0%, #0b1020 55%, #070a14 100%)'
    : 'radial-gradient(120% 90% at 30% 10%, #1b2a24 0%, #0f1a15 60%, #09110d 100%)'
  return (
    <>
      <div style={{ background: kit.isDark ? dark : 'radial-gradient(120% 90% at 30% 20%, #f4ecdb 0%, #eadfc8 70%, #ddcfb2 100%)', inset: 0, position: 'absolute' }} />
      <GrainOverlay color={kit.isDark ? '#f0d9a8' : '#6b5a3a'} style={{ inset: 0, position: 'absolute' }} />
      {stars.map(([left, top, size]) => <Sparkle key={`${left}-${top}`} color={kit.gold} size={kit.x(size)} style={{ left: kit.x(left), opacity: .75, top: kit.y(top), zIndex: 1 }} />)}
    </>
  )
}

/** The sequence badge (same as Info/Lista). */
export function SequenceBadge({ context, kit }: { context: DocumentaryCardVisualContext; kit: LayoutKit }) {
  if (!context.sequence?.index || !context.sequence?.total) return null
  const { x, y, green } = kit
  return (
    <div aria-label={`Página ${context.sequence.index} de ${context.sequence.total}`} style={{ ...kit.fixedText, background: '#d6c29a', clipPath: 'polygon(3% 8%, 97% 0, 100% 90%, 5% 100%, 0 22%)', height: y(112), left: x(16), top: y(28), transform: 'rotate(-2deg)', width: x(230) }}>
      <div style={{ border: `2px solid ${green}`, borderRadius: '50%', color: green, fontFamily: kit.display.family, fontSize: x(34), fontWeight: kit.display.weight, left: x(52), padding: `${y(6)}px ${x(22)}px`, position: 'absolute', top: y(26) }}>
        {context.sequence.index}
      </div>
    </div>
  )
}

/** Faixa do título + Título as sibling elements (each owns its own stack layer), like Lista. */
export function TitleOnStrip({ context, kit, title, top = 150, height = 250, fontSize = 62 }: { context: DocumentaryCardVisualContext; kit: LayoutKit; title: string; top?: number; height?: number; fontSize?: number }) {
  const { x, y } = kit
  const tuning = context.previewTuning?.title
  return (
    <>
      <AssetLayer label="Faixa do título" url={kit.url('paperStrip')} metrics={materialMetrics('paperStrip')} contain={context.materialContain?.paperStrip} box={{ left: x(40), top: y(top), width: x(1000), height: y(height) }} rotation={-0.8} transform={kit.transforms?.paperStrip} zIndex={kit.z('paperStrip', 30)} hidden={kit.hidden('paperStrip')} shadow />
      <div
        style={{
          alignItems: 'center',
          color: kit.green,
          display: 'flex',
          fontFamily: kit.display.family,
          fontSize: x(fontSize),
          fontWeight: kit.display.weight,
          height: y(height - 60),
          left: x(96),
          letterSpacing: '-.01em',
          lineHeight: tuning?.lineHeight ?? layoutTitleLineHeight(context.templateId, context.variant) ?? 1.04,
          position: 'absolute',
          textTransform: 'uppercase',
          top: y(top + 30),
          width: x(890),
          zIndex: kit.z('title', 31),
          ...kit.hideStyle('title'),
          transform: `translate(${tuning?.offsetX ?? 0}px, ${tuning?.offsetY ?? 0}px) rotate(${-0.8 + (tuning?.rotation ?? 0)}deg)`,
          transformOrigin: 'top left',
        }}
      >
        {title}
      </div>
    </>
  )
}

/** One authored element made of template geometry (tiles, network, map): a full-canvas group with the element's transform. */
export function ElementGroup({ id, label, kit, transformKey, zFallback, children }: { id: string; label: string; kit: LayoutKit; transformKey: keyof NonNullable<LayoutKit['transforms']>; zFallback: number; children: ReactNode }) {
  if (kit.hidden(id)) return null
  return (
    <div aria-label={label} data-element={label} style={{ inset: 0, position: 'absolute', zIndex: kit.z(id, zFallback), ...elementTransform(0, kit.transforms?.[transformKey]) }}>
      {children}
    </div>
  )
}
