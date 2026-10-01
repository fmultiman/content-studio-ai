import type { CSSProperties, ReactNode } from 'react'
import type { DocumentaryCardListContent } from '@/lib/schemas/creative/documentary-card'
import { STACK_TOP_Z } from '@/lib/creative/templates/element-stack'
import { layoutTitleLineHeight } from '@/lib/creative/templates/template-definitions'
import { AssetLayer, AssetSurface, AssetTextLayer, BrandMark, GrainOverlay, PlateFrame, PlateImage, Sparkle, materialMetrics, materialUrl, type CardPalette, type PlateGeometry } from './primitives'
import type { DocumentaryCardVisualContext } from './types'
import { DocumentaryIcon } from './icons'

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
  const isHidden = (id: string) => context.hidden.has(id)
  const hideStyle = (id: string): CSSProperties => (isHidden(id) ? { display: 'none' } : {})
  const transforms = context.primitiveTransforms
  const url = (name: Parameters<typeof materialUrl>[0]) => materialUrl(name, context.materialBaseUrl, context.materialUrls)
  const fixedText: CSSProperties = { opacity: context.contentOpacity, position: 'absolute', zIndex: STACK_TOP_Z }
  const display = context.tokens.typography.display
  const body = context.tokens.typography.body.family
  const heroTuning = context.previewTuning?.hero
  const titleTuning = context.previewTuning?.title
  const items = content.items ?? []
  // Completion V1: an optional closing callout takes the bottom band; with a caption too, the image and its caption move up.
  const hasCallout = Boolean(content.callout)
  const compact = hasCallout && Boolean(content.image_caption)
  const heroPlate: PlateGeometry = { height: y(compact ? 540 : 600), left: x(598), padding: x(14), rotation: 2.2, top: y(430), width: x(426) }
  const captionBox = { left: x(588), top: y(compact ? 988 : 1052), width: x(420), height: y(compact ? 150 : 190) }
  const calloutBox = { left: x(48), top: y(1134), width: x(984), height: y(176) }

  return (
    <>
      {/* Template chrome — background tone, grain, a few stars. Not authored elements. */}
      <div style={{ background: isDark ? 'radial-gradient(120% 90% at 30% 10%, #1b2a24 0%, #0f1a15 60%, #09110d 100%)' : 'radial-gradient(120% 90% at 30% 20%, #f4ecdb 0%, #eadfc8 70%, #ddcfb2 100%)', inset: 0, position: 'absolute' }} />
      <GrainOverlay color={isDark ? '#f0d9a8' : '#6b5a3a'} style={{ inset: 0, position: 'absolute' }} />
      {[[548, 1190, 14], [1030, 420, 10], [40, 1262, 12]].map(([left, top, size]) => (
        <Sparkle key={`${left}-${top}`} color={gold} size={x(size)} style={{ left: x(left), opacity: .7, top: y(top), zIndex: 1 }} />
      ))}

      {/* Authored elements — painted from the normalized stack. */}
      <AssetLayer label="Fragmento de arquivo" url={url('archival')} metrics={materialMetrics('archival')} contain={context.materialContain?.archival} box={{ left: x(292), top: y(1150), width: x(390) }} rotation={-4} transform={transforms?.archival} zIndex={z('archival', 11)} hidden={isHidden('archival')} filter="sepia(.35)" shadow />
      <AssetLayer label="Ramo de folhas" url={url('botanicalLeaf')} metrics={materialMetrics('botanicalLeaf')} contain={context.materialContain?.botanicalLeaf} box={{ left: x(-150), top: y(1086), width: x(360) }} rotation={38} transform={transforms?.botanicalLeaf} zIndex={z('botanicalLeaf', 12)} hidden={isHidden('botanicalLeaf')} />

      {/* Moldura da imagem (procedural): the pale archival border, under the image. Independent of it. */}
      <PlateFrame geometry={heroPlate} tuning={heroTuning} zIndex={z('heroFrame', 12)} hidden={isHidden('heroFrame')} background="#ece2cc" shadow="0 22px 40px rgba(0, 0, 0, .38)" />
      {/* Imagem do documento: the content image, pinned like evidence. Painted whatever the frame does. */}
      <PlateImage geometry={heroPlate} tuning={heroTuning} zIndex={z('hero', 13)} hidden={isHidden('hero')} frameHidden={isHidden('heroFrame')} label="Imagem do documento">
        <AssetSurface asset={context.assets.hero} label="Imagem do documento" style={{ backgroundColor: palette.paper, backgroundSize: context.assets.hero?.fit === 'contain' ? 'contain' : 'cover', filter: 'saturate(.85) contrast(1.04)', inset: 0, position: 'absolute' }} />
      </PlateImage>
      <AssetLayer label="Fita do documento" url={url('tape')} metrics={materialMetrics('tape')} contain={context.materialContain?.tape} box={{ left: x(742), top: y(402), width: x(150) }} rotation={-5} transform={transforms?.tape1 ?? transforms?.tape} zIndex={z('tape1', 14)} hidden={isHidden('tape1')} filter="saturate(.85)" />
      <AssetLayer label="Botânica seca" url={url('botanical')} metrics={materialMetrics('botanical')} contain={context.materialContain?.botanical} box={{ left: x(992), top: y(700), width: x(116) }} rotation={-12} transform={transforms?.botanical} zIndex={z('botanical', 15)} hidden={isHidden('botanical')} />

      {/* Papel da legenda + Legenda da imagem: the caption paper and its text are two Elements (only when there is a caption). */}
      {content.image_caption ? (
        <>
          <AssetLayer label="Papel da legenda" url={url('paperScrap')} metrics={materialMetrics('paperScrap')} contain={context.materialContain?.paperScrap} box={captionBox} rotation={-1.8} transform={transforms?.note} zIndex={z('note', 16)} hidden={isHidden('note')} shadow />
          <AssetTextLayer label="Legenda da imagem" metrics={materialMetrics('paperScrap')} box={captionBox} rotation={-1.8} transform={transforms?.note} zIndex={z('noteText', 16)} hidden={isHidden('noteText')}>
            <div style={{ alignItems: 'center', color: paperInk, display: 'flex', fontFamily: body, fontSize: x(23), fontStyle: 'italic', inset: 0, lineHeight: 1.32, padding: `0 ${x(44)}px`, position: 'absolute' }}>
              {content.image_caption}
            </div>
          </AssetTextLayer>
          <AssetLayer label="Fita da legenda" url={url('tape')} metrics={materialMetrics('tape')} contain={context.materialContain?.tape} box={{ left: x(676), top: y(compact ? 968 : 1030), width: x(118) }} rotation={4} transform={transforms?.tape2 ?? transforms?.tape} zIndex={z('tape2', 17)} hidden={isHidden('tape2')} filter="saturate(.85)" />
        </>
      ) : null}

      {/* Caixa de destaque (optional): the closing thought on dark paper, full width. */}
      {hasCallout ? (
        <>
          <AssetLayer label="Caixa de destaque" url={url('paperDark')} metrics={materialMetrics('paperDark')} contain={context.materialContain?.paperDark} box={calloutBox} rotation={-0.6} transform={transforms?.paperDark} zIndex={z('callout', 16)} hidden={isHidden('callout')} shadow />
          <AssetTextLayer label="Texto do destaque" metrics={materialMetrics('paperDark')} box={calloutBox} rotation={-0.6} transform={transforms?.paperDark} zIndex={z('calloutText', 16)} hidden={isHidden('calloutText')}>
            <div style={{ alignItems: 'center', color: '#efe4cc', display: 'flex', fontFamily: body, fontSize: x(28), gap: x(28), inset: 0, lineHeight: 1.36, padding: `0 ${x(56)}px 0 ${x(64)}px`, position: 'absolute' }}>
              <div style={{ flex: 1 }}>{renderEmphasis(content.callout ?? '')}</div>
              <DocumentaryIcon icon="leaf" color="#c9a45c" size={x(64)} />
            </div>
          </AssetTextLayer>
        </>
      ) : null}

      {/* Faixa do título + Título: siblings, so each owns its own layer. */}
      <AssetLayer label="Faixa do título" url={url('paperStrip')} metrics={materialMetrics('paperStrip')} contain={context.materialContain?.paperStrip} box={{ left: x(40), top: y(158), width: x(1000), height: y(236) }} rotation={-0.8} transform={transforms?.paperStrip} zIndex={z('paperStrip', 18)} hidden={isHidden('paperStrip')} shadow />
      <div
        style={{
          color: green,
          fontFamily: display.family,
          fontSize: x(64),
          fontWeight: display.weight,
          left: x(96),
          letterSpacing: '-.01em',
          lineHeight: titleTuning?.lineHeight ?? layoutTitleLineHeight(context.templateId, 'list') ?? 1.04,
          position: 'absolute',
          textTransform: 'uppercase',
          top: y(206),
          width: x(880),
          zIndex: z('title', 19), ...hideStyle('title'),
          transform: `translate(${titleTuning?.offsetX ?? 0}px, ${titleTuning?.offsetY ?? 0}px) rotate(${-0.8 + (titleTuning?.rotation ?? 0)}deg)`,
          transformOrigin: 'top left',
        }}
      >
        {content.title}
      </div>

      {/* Template text (fixed layer): sequence badge, intro, icon rows, brand. */}
      {context.sequence?.index && context.sequence?.total ? (
        <div aria-label={`Página ${context.sequence.index} de ${context.sequence.total}`} style={{ ...fixedText, background: '#d6c29a', clipPath: 'polygon(3% 8%, 97% 0, 100% 90%, 5% 100%, 0 22%)', height: y(112), left: x(16), top: y(28), transform: 'rotate(-2deg)', width: x(230) }}>
          <div style={{ border: `2px solid ${green}`, borderRadius: '50%', color: green, fontFamily: display.family, fontSize: x(34), fontWeight: display.weight, left: x(52), padding: `${y(6)}px ${x(22)}px`, position: 'absolute', top: y(26) }}>
            {context.sequence.index}
          </div>
        </div>
      ) : null}
      {content.intro ? (
        <div style={{ ...fixedText, color: ink, fontFamily: body, fontSize: x(31), left: x(66), lineHeight: 1.36, top: y(446), transform: `translateY(${context.contentTranslateY}px)`, width: x(480), zIndex: z('intro', STACK_TOP_Z), ...hideStyle('intro') }}>
          {renderEmphasis(content.intro)}
          <div aria-hidden="true" style={{ background: gold, height: 2, marginTop: y(26), opacity: .85, width: x(200) }} />
        </div>
      ) : null}
      <div style={{ ...fixedText, display: 'flex', flexDirection: 'column', gap: y(34), left: x(66), top: y(content.intro ? 686 : 470), transform: `translateY(${context.contentTranslateY}px)`, width: x(490), zIndex: z('items', STACK_TOP_Z), ...hideStyle('items') }} data-list-items={items.length}>
        {items.map((item, index) => (
          <div key={index} style={{ alignItems: 'flex-start', display: 'flex', gap: x(26) }}>
            <div style={{ alignItems: 'center', border: `1.5px solid ${gold}`, borderRadius: '50%', display: 'flex', flexShrink: 0, height: x(76), justifyContent: 'center', width: x(76) }}>
              <DocumentaryIcon icon={item.icon} color={isDark ? '#d9c79b' : green} size={x(46)} />
            </div>
            <div style={{ color: ink, fontFamily: body, fontSize: x(26), lineHeight: 1.36, paddingTop: y(4) }}>{renderEmphasis(item.text)}</div>
          </div>
        ))}
      </div>
      <BrandMark show="logo" asset={context.assets.logo} palette={{ ...palette, foreground: ink, accent: gold }} tokens={context.tokens} logoSize={x(96)} style={{ ...fixedText, right: x(48), top: y(36), zIndex: z('brandLogo', STACK_TOP_Z), ...hideStyle('brandLogo') }} />
    </>
  )
}
