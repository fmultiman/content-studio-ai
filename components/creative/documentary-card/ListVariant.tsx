import type { CSSProperties, ReactNode } from 'react'
import type { DocumentaryCardListContent, DocumentaryCardListIcon } from '@/lib/schemas/creative/documentary-card'
import { STACK_TOP_Z } from '@/lib/creative/templates/element-stack'
import { AssetLayer, AssetSurface, BrandMark, GrainOverlay, Sparkle, materialMetrics, materialUrl, type CardPalette } from './primitives'
import type { DocumentaryCardVisualContext } from './types'

/**
 * `**bold**` runs -> <strong>. The only markup the List content accepts
 * (DocumentaryCardListContentSchema); anything else renders as plain text.
 */
export function renderEmphasis(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, index) => (
    part.startsWith('**') && part.endsWith('**') && part.length > 4
      ? <strong key={index} style={{ fontWeight: 700 }}>{part.slice(2, -2)}</strong>
      : <span key={index}>{part}</span>
  ))
}

/** Closed, code-backed icon set (line drawings on a 48px grid). */
function ListIcon({ icon, color, size }: { icon: DocumentaryCardListIcon; color: string; size: number }) {
  const common = { fill: 'none', stroke: color, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, strokeWidth: 2.4 }
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" width={size} height={size} style={{ flexShrink: 0 }}>
      {icon === 'microphone' ? (
        <>
          <rect x="17" y="5" width="14" height="23" rx="7" {...common} />
          <path d="M20 11h8M20 16h8M20 21h8" {...common} strokeWidth={1.6} />
          <path d="M11 22c0 8 6 13 13 13s13-5 13-13" {...common} />
          <path d="M24 35v7M16 43h16" {...common} />
        </>
      ) : icon === 'pencil' ? (
        <>
          <path d="M33 6l9 9-24 24-12 3 3-12z" {...common} />
          <path d="M28 11l9 9M9 30l9 9" {...common} />
        </>
      ) : (
        <>
          <path d="M24 13c-5-4-12-5-19-4v27c7-1 14 0 19 4 5-4 12-5 19-4V9c-7-1-14 0-19 4z" {...common} />
          <path d="M24 13v27" {...common} />
          <path d="M9 16c4 0 8 1 11 3M9 22c4 0 8 1 11 3M28 19c3-2 7-3 11-3M28 25c3-2 7-3 11-3" {...common} strokeWidth={1.4} />
        </>
      )}
    </svg>
  )
}

/**
 * Editorial Documentary Collage · layout "list" (Lista) — Portal Carousel
 * Growth V1. Pack A Slide 3's editorial anatomy (title, intro, icon-led rows,
 * one documentary image + caption) set in the Pack B visual language out of
 * the template's existing asset slots. Same conventions as Cover/Info:
 * 1080×1350 reference coordinates, z-index from the normalized element stack,
 * template text/chrome on the fixed top layer.
 */
export function ListVariant({ context, palette }: { context: DocumentaryCardVisualContext; palette: CardPalette }) {
  const content = context.content as DocumentaryCardListContent
  const sx = context.canvas.width / 1080
  const sy = context.canvas.height / 1350
  const x = (value: number) => value * sx
  const y = (value: number) => value * sy
  const isDark = context.resolvedAppearance === 'dark'
  const ink = isDark ? '#efe4cc' : '#1d2a22'
  const green = '#23382c'
  const gold = isDark ? '#c9a45c' : '#9a7a3a'
  const paperInk = '#1d2a22'
  const z = (id: string, fallback: number) => context.stack.zIndex[id] ?? fallback
  const transforms = context.primitiveTransforms
  const url = (name: Parameters<typeof materialUrl>[0]) => materialUrl(name, context.materialBaseUrl, context.materialUrls)
  const fixedText: CSSProperties = { opacity: context.contentOpacity, position: 'absolute', zIndex: STACK_TOP_Z }
  const display = context.tokens.typography.display
  const body = context.tokens.typography.body.family
  const heroTuning = context.previewTuning?.hero
  const titleTuning = context.previewTuning?.title
  const items = content.items ?? []

  return (
    <>
      {/* Template chrome — background tone, grain, a few stars. Not authored elements. */}
      <div style={{ background: isDark ? 'radial-gradient(120% 90% at 30% 10%, #1b2a24 0%, #0f1a15 60%, #09110d 100%)' : 'radial-gradient(120% 90% at 30% 20%, #f4ecdb 0%, #eadfc8 70%, #ddcfb2 100%)', inset: 0, position: 'absolute' }} />
      <GrainOverlay color={isDark ? '#f0d9a8' : '#6b5a3a'} style={{ inset: 0, position: 'absolute' }} />
      {[[548, 1190, 14], [1030, 420, 10], [40, 1262, 12]].map(([left, top, size]) => (
        <Sparkle key={`${left}-${top}`} color={gold} size={x(size)} style={{ left: x(left), opacity: .7, top: y(top), zIndex: 1 }} />
      ))}

      {/* Authored elements — painted from the normalized stack. */}
      <AssetLayer label="Fragmento de arquivo" url={url('archival')} metrics={materialMetrics('archival')} contain={context.materialContain?.archival} box={{ left: x(292), top: y(1150), width: x(390) }} rotation={-4} transform={transforms?.archival} zIndex={z('archival', 11)} filter="sepia(.35)" shadow />
      <AssetLayer label="Ramo de folhas" url={url('botanicalLeaf')} metrics={materialMetrics('botanicalLeaf')} contain={context.materialContain?.botanicalLeaf} box={{ left: x(-150), top: y(1086), width: x(360) }} rotation={38} transform={transforms?.botanicalLeaf} zIndex={z('botanicalLeaf', 12)} />

      {/* Imagem do documento: the content image in a pale archival border, pinned like evidence. */}
      <div
        aria-label="Imagem do documento"
        style={{
          background: '#ece2cc',
          boxShadow: '0 22px 40px rgba(0, 0, 0, .38)',
          height: y(600),
          left: x(598),
          padding: x(14),
          position: 'absolute',
          top: y(430),
          width: x(426),
          zIndex: z('hero', 13),
          transform: `translate(${heroTuning?.offsetX ?? 0}px, ${heroTuning?.offsetY ?? 0}px) rotate(${2.2 + (heroTuning?.rotation ?? 0)}deg) scale(${heroTuning?.scale ?? 1})`,
          transformOrigin: 'center',
        }}
      >
        <div style={{ height: '100%', overflow: 'hidden', position: 'relative', width: '100%' }}>
          <AssetSurface asset={context.assets.hero} label="Imagem do documento" style={{ backgroundColor: palette.paper, backgroundSize: context.assets.hero?.fit === 'contain' ? 'contain' : 'cover', filter: 'saturate(.85) contrast(1.04)', inset: 0, position: 'absolute' }} />
        </div>
      </div>
      <AssetLayer label="Fita do documento" url={url('tape')} metrics={materialMetrics('tape')} contain={context.materialContain?.tape} box={{ left: x(742), top: y(402), width: x(150) }} rotation={-5} transform={transforms?.tape1 ?? transforms?.tape} zIndex={z('tape1', 14)} filter="saturate(.85)" />
      <AssetLayer label="Botânica seca" url={url('botanical')} metrics={materialMetrics('botanical')} contain={context.materialContain?.botanical} box={{ left: x(992), top: y(700), width: x(116) }} rotation={-12} transform={transforms?.botanical} zIndex={z('botanical', 15)} />

      {/* Papel da legenda: image_caption on its own paper scrap. */}
      <AssetLayer label="Papel da legenda" url={url('paperScrap')} metrics={materialMetrics('paperScrap')} contain={context.materialContain?.paperScrap} box={{ left: x(588), top: y(1052), width: x(420), height: y(190) }} rotation={-1.8} transform={transforms?.note} zIndex={z('note', 16)} shadow>
        {content.image_caption ? (
          <div style={{ alignItems: 'center', color: paperInk, display: 'flex', fontFamily: body, fontSize: x(23), fontStyle: 'italic', inset: 0, lineHeight: 1.32, padding: `0 ${x(44)}px`, position: 'absolute' }}>
            {content.image_caption}
          </div>
        ) : null}
      </AssetLayer>
      <AssetLayer label="Fita da legenda" url={url('tape')} metrics={materialMetrics('tape')} contain={context.materialContain?.tape} box={{ left: x(676), top: y(1030), width: x(118) }} rotation={4} transform={transforms?.tape2 ?? transforms?.tape} zIndex={z('tape2', 17)} filter="saturate(.85)" />

      {/* Faixa do título + Título: siblings, so each owns its own layer. */}
      <AssetLayer label="Faixa do título" url={url('paperStrip')} metrics={materialMetrics('paperStrip')} contain={context.materialContain?.paperStrip} box={{ left: x(40), top: y(158), width: x(1000), height: y(236) }} rotation={-0.8} transform={transforms?.paperStrip} zIndex={z('paperStrip', 18)} shadow />
      <div
        style={{
          color: green,
          fontFamily: display.family,
          fontSize: x(64),
          fontWeight: display.weight,
          left: x(96),
          letterSpacing: '-.01em',
          lineHeight: 1.04,
          position: 'absolute',
          textTransform: 'uppercase',
          top: y(206),
          width: x(880),
          zIndex: z('title', 19),
          transform: `translate(${titleTuning?.offsetX ?? 0}px, ${titleTuning?.offsetY ?? 0}px) rotate(${-0.8 + (titleTuning?.rotation ?? 0)}deg)`,
          transformOrigin: 'top left',
        }}
      >
        {content.title}
      </div>

      {/* Template text (fixed layer): sequence badge, intro, icon rows, brand. */}
      {context.sequence?.index && context.sequence?.total ? (
        <div style={{ ...fixedText, background: '#d6c29a', clipPath: 'polygon(3% 8%, 97% 0, 100% 90%, 5% 100%, 0 22%)', height: y(112), left: x(16), top: y(28), transform: 'rotate(-2deg)', width: x(230) }}>
          <div style={{ border: `2px solid ${green}`, borderRadius: '50%', color: green, fontFamily: display.family, fontSize: x(34), fontWeight: display.weight, left: x(52), padding: `${y(6)}px ${x(22)}px`, position: 'absolute', top: y(26) }}>
            {context.sequence.index}/{context.sequence.total}
          </div>
        </div>
      ) : null}
      {content.intro ? (
        <div style={{ ...fixedText, color: ink, fontFamily: body, fontSize: x(31), left: x(66), lineHeight: 1.36, top: y(446), transform: `translateY(${context.contentTranslateY}px)`, width: x(480) }}>
          {renderEmphasis(content.intro)}
          <div aria-hidden="true" style={{ background: gold, height: 2, marginTop: y(26), opacity: .85, width: x(200) }} />
        </div>
      ) : null}
      <div style={{ ...fixedText, display: 'flex', flexDirection: 'column', gap: y(34), left: x(66), top: y(content.intro ? 686 : 470), transform: `translateY(${context.contentTranslateY}px)`, width: x(490) }} data-list-items={items.length}>
        {items.map((item, index) => (
          <div key={index} style={{ alignItems: 'flex-start', display: 'flex', gap: x(26) }}>
            <div style={{ alignItems: 'center', border: `1.5px solid ${gold}`, borderRadius: '50%', display: 'flex', flexShrink: 0, height: x(76), justifyContent: 'center', width: x(76) }}>
              <ListIcon icon={item.icon} color={isDark ? '#d9c79b' : green} size={x(46)} />
            </div>
            <div style={{ color: ink, fontFamily: body, fontSize: x(26), lineHeight: 1.36, paddingTop: y(4) }}>{renderEmphasis(item.text)}</div>
          </div>
        ))}
      </div>
      <BrandMark asset={context.assets.logo} palette={{ ...palette, foreground: ink, accent: gold }} tokens={context.tokens} logoSize={x(96)} style={{ ...fixedText, right: x(48), top: y(36) }} />
    </>
  )
}
