import type { CSSProperties, ReactNode } from 'react'
import type { DocumentaryCardFactCard, DocumentaryCardInfoContent } from '@/lib/schemas/creative/documentary-card'
import { STACK_TOP_Z } from '@/lib/creative/templates/element-stack'
import { AssetLayer, AssetTextLayer, BrandMark, GrainOverlay, brandLogoPlacement, localTypography, materialMetrics, materialUrl, type CardPalette } from './primitives'
import type { DocumentaryCardVisualContext } from './types'

/**
 * Pack B Slide 2 sets its title on two strips: the first clause on a light
 * strip, the rest on a dark one ("UMA PERGUNTA," / "DUAS EDIÇÕES"). Splits
 * after the first comma; without one, splits the words in half.
 */
export function splitInfoTitle(title: string): [string, string] {
  const trimmed = title.trim()
  const comma = trimmed.indexOf(',')
  if (comma > 0 && comma < trimmed.length - 1) return [trimmed.slice(0, comma + 1).trim(), trimmed.slice(comma + 1).trim()]
  const words = trimmed.split(/\s+/)
  if (words.length < 2) return [trimmed, '']
  const half = Math.ceil(words.length / 2)
  return [words.slice(0, half).join(' '), words.slice(half).join(' ')]
}

/**
 * Editorial Documentary Collage · layout "info" — reconstructed from Pack B
 * Slide 2 (docs/discovery/creative-rendering/visual-reference-pack/pack-b/02.png)
 * out of the template's transparent asset slots. Same conventions as
 * CoverVariant: 1080×1350 reference coordinates, z-index from the
 * normalized element stack, template text on the fixed top layer.
 */
/** The Info title is two lines of different sizes set by the Template: only its family is locally overridable. */
function localFamily(context: DocumentaryCardVisualContext, id: string): CSSProperties {
  const family = context.typographyOverrides?.[id]?.fontFamily
  return family ? { fontFamily: family } : {}
}

export function InfoVariant({ context, palette }: { context: DocumentaryCardVisualContext; palette: CardPalette }) {
  const content = context.content as DocumentaryCardInfoContent
  const sx = context.canvas.width / 1080
  const sy = context.canvas.height / 1350
  const x = (value: number) => value * sx
  const y = (value: number) => value * sy
  const isDark = context.resolvedAppearance === 'dark'
  const ink = isDark ? '#efe4cc' : '#1d2a22'
  const green = '#23382c'
  const cream = '#f1e7d2'
  const gold = '#b8923f'
  const z = (id: string, fallback: number) => context.stack.zIndex[id] ?? fallback
  const isHidden = (id: string) => context.hidden.has(id)
  const hideStyle = (id: string): CSSProperties => (isHidden(id) ? { display: 'none' } : {})
  const transforms = context.primitiveTransforms
  const url = (name: Parameters<typeof materialUrl>[0]) => materialUrl(name, context.materialBaseUrl, context.materialUrls)
  const fixedText: CSSProperties = { opacity: context.contentOpacity, position: 'absolute', zIndex: STACK_TOP_Z }

  const titleTuning = context.previewTuning?.title
  const sourceTuning = context.previewTuning?.source
  const [titleLineOne, titleLineTwo] = splitInfoTitle(content.title)
  const titleTransform = `translate(${titleTuning?.offsetX ?? 0}px, ${titleTuning?.offsetY ?? 0}px) rotate(${titleTuning?.rotation ?? 0}deg)`
  const display = context.tokens.typography.display
  const body = context.tokens.typography.body.family

  const factCard = (fact: DocumentaryCardFactCard | undefined, color: string): ReactNode => fact ? (
    <div style={{ alignItems: 'center', color, display: 'flex', flexDirection: 'column', inset: 0, justifyContent: 'center', paddingTop: y(26), position: 'absolute', textAlign: 'center' }}>
      <div style={{ fontFamily: display.family, fontSize: x(84), fontWeight: display.weight, lineHeight: 1 }}>{fact.primary}</div>
      <div aria-hidden="true" style={{ background: gold, height: 2, margin: `${y(16)}px 0 ${y(12)}px`, width: x(46) }} />
      {fact.secondary ? <div style={{ fontFamily: body, fontSize: x(30), lineHeight: 1.18, maxWidth: '82%' }}>{fact.secondary}</div> : null}
      {fact.tertiary ? <div style={{ fontFamily: body, fontSize: x(30), lineHeight: 1.18, marginTop: y(4) }}>{fact.tertiary}</div> : null}
    </div>
  ) : null

  return (
    <>
      {/* Template chrome — background paper tone, grain, brand card. Not authored elements. */}
      <div style={{ background: isDark ? 'radial-gradient(120% 90% at 30% 10%, #1b2a24 0%, #0f1a15 60%, #09110d 100%)' : 'radial-gradient(120% 90% at 30% 20%, #f4ecdb 0%, #eadfc8 70%, #ddcfb2 100%)', inset: 0, position: 'absolute' }} />
      <GrainOverlay color={isDark ? '#f0d9a8' : '#6b5a3a'} style={{ inset: 0, position: 'absolute' }} />

      {/* Authored elements — painted from the normalized stack. */}
      <AssetLayer label="Fragmento de arquivo" url={url('archival')} metrics={materialMetrics('archival')} contain={context.materialContain?.archival} box={{ left: x(650), top: y(660), width: x(560) }} rotation={87} transform={transforms?.archival} zIndex={z('archival', 11)} hidden={isHidden('archival')} filter="sepia(.35)" shadow />
      <AssetLayer label="Ramo de folhas" url={url('botanicalLeaf')} metrics={materialMetrics('botanicalLeaf')} contain={context.materialContain?.botanicalLeaf} box={{ left: x(-176), top: y(246), width: x(420) }} rotation={-42} transform={transforms?.botanicalLeaf} zIndex={z('botanicalLeaf', 12)} hidden={isHidden('botanicalLeaf')} />
      <AssetLayer label="Fita do ramo 1" url={url('tape')} metrics={materialMetrics('tape')} contain={context.materialContain?.tape} box={{ left: x(26), top: y(456), width: x(128) }} rotation={-20} transform={transforms?.tape1 ?? transforms?.tape} zIndex={z('tape1', 13)} hidden={isHidden('tape1')} filter="saturate(.7) brightness(1.08)" />
      <AssetLayer label="Fita do ramo 2" url={url('tape')} metrics={materialMetrics('tape')} contain={context.materialContain?.tape} box={{ left: x(-8), top: y(642), width: x(124) }} rotation={9} transform={transforms?.tape2 ?? transforms?.tape} zIndex={z('tape2', 14)} hidden={isHidden('tape2')} filter="saturate(.7) brightness(1.08)" />
      <AssetLayer label="Botânica seca" url={url('botanical')} metrics={materialMetrics('botanical')} contain={context.materialContain?.botanical} box={{ left: x(990), top: y(606), width: x(118) }} rotation={-10} transform={transforms?.botanical} zIndex={z('botanical', 15)} hidden={isHidden('botanical')} />

      {/* Cartão = the paper + its text, two Elements: the text takes the paper's box and transform channel and owns its visibility. */}
      {content.fact_cards[0] ? (
        <>
          <AssetLayer label="Cartão 1" url={url('paperDark')} metrics={materialMetrics('paperDark')} contain={context.materialContain?.paperDark} box={{ left: x(664), top: y(478), width: x(360), height: y(350) }} rotation={3} transform={transforms?.card1} zIndex={z('card1', 16)} hidden={isHidden('card1')} shadow />
          <AssetTextLayer label="Texto do cartão 1" metrics={materialMetrics('paperDark')} box={{ left: x(664), top: y(478), width: x(360), height: y(350) }} rotation={3} transform={transforms?.card1} zIndex={z('card1Text', 16)} hidden={isHidden('card1Text')}>
            {factCard(content.fact_cards[0], cream)}
          </AssetTextLayer>
        </>
      ) : null}
      <AssetLayer label="Pin do cartão 1" url={url('pin')} metrics={materialMetrics('pin')} contain={context.materialContain?.pin} box={{ left: x(832), top: y(486), width: x(58) }} rotation={-8} transform={transforms?.pin} zIndex={z('pin', 17)} hidden={isHidden('pin')} />
      {content.fact_cards[1] ? (
        <>
          <AssetLayer label="Cartão 2" url={url('tornPaper')} metrics={materialMetrics('tornPaper')} contain={context.materialContain?.tornPaper} box={{ left: x(588), top: y(820), width: x(404), height: y(352) }} rotation={3.5} transform={transforms?.paper} zIndex={z('paper', 18)} hidden={isHidden('paper')} shadow />
          <AssetTextLayer label="Texto do cartão 2" metrics={materialMetrics('tornPaper')} box={{ left: x(588), top: y(820), width: x(404), height: y(352) }} rotation={3.5} transform={transforms?.paper} zIndex={z('card2Text', 18)} hidden={isHidden('card2Text')}>
            {factCard(content.fact_cards[1], green)}
          </AssetTextLayer>
        </>
      ) : null}
      <AssetLayer label="Pin do cartão 2" url={url('pin')} metrics={materialMetrics('pin')} contain={context.materialContain?.pin} box={{ left: x(790), top: y(828), width: x(58) }} rotation={-6} transform={transforms?.pin2} zIndex={z('pin2', 19)} hidden={isHidden('pin2')} />
      <AssetLayer label="Fita inferior" url={url('tape')} metrics={materialMetrics('tape')} contain={context.materialContain?.tape} box={{ left: x(48), top: y(1012), width: x(122) }} rotation={16} transform={transforms?.tape3 ?? transforms?.tape} zIndex={z('tape3', 20)} hidden={isHidden('tape3')} filter="saturate(.8)" />

      {/* Título: light strip (first clause) over which the dark strip (rest) sits. */}
      <AssetLayer label="Faixa do título" url={url('paperStrip')} metrics={materialMetrics('paperStrip')} contain={context.materialContain?.paperStrip} box={{ left: x(116), top: y(152), width: x(748), height: y(170) }} rotation={-1} transform={transforms?.paperStrip} zIndex={z('paperStrip', 21)} hidden={isHidden('paperStrip')} shadow />
      {titleLineTwo ? (
        <AssetLayer label="Faixa escura do título" url={url('paperDark')} metrics={materialMetrics('paperDark')} contain={context.materialContain?.paperDark} box={{ left: x(150), top: y(292), width: x(676), height: y(190) }} rotation={1.2} transform={transforms?.paperDark} zIndex={z('paperDark', 22)} hidden={isHidden('paperDark')} shadow />
      ) : null}
      <div style={{ fontFamily: display.family, fontWeight: display.weight, inset: 0, pointerEvents: 'none', position: 'absolute', textTransform: 'uppercase', zIndex: z('title', 23), ...hideStyle('title'), ...localFamily(context, 'title'), transform: titleTransform, transformOrigin: 'top left' }}>
        <div style={{ color: green, fontSize: x(86), left: x(152), letterSpacing: '-.01em', lineHeight: 1, position: 'absolute', top: y(196), transform: 'rotate(-1deg)', whiteSpace: 'nowrap' }}>{titleLineOne}</div>
        {titleLineTwo ? (
          <div style={{ color: cream, fontSize: x(82), left: x(196), letterSpacing: '-.01em', lineHeight: 1, position: 'absolute', top: y(344), transform: 'rotate(1deg)', whiteSpace: 'nowrap' }}>
            {titleLineTwo}
            <div aria-hidden="true" style={{ background: gold, borderRadius: 2, height: 3, marginTop: y(14), opacity: .9, width: '100%' }} />
          </div>
        ) : null}
      </div>

      {content.source_line ? (
        <div style={{ color: isDark ? '#cdbf9f' : '#6d6150', fontFamily: body, fontSize: x(24), fontStyle: 'italic', fontWeight: 400, left: x(56), lineHeight: 1.3, maxWidth: x(300), position: 'absolute', top: y(1152), zIndex: z('source', 24), ...hideStyle('source'), ...localTypography(context, 'source'), transform: `translate(${sourceTuning?.offsetX ?? 0}px, ${sourceTuning?.offsetY ?? 0}px) rotate(${-4 + (sourceTuning?.rotation ?? 0)}deg)`, transformOrigin: 'top left' }}>
          {content.source_line}
        </div>
      ) : null}

      {/* Template text (fixed layer). */}
      {context.sequence?.index && context.sequence?.total ? (
        <div aria-label={`Página ${context.sequence.index} de ${context.sequence.total}`} style={{ ...fixedText, background: '#d6c29a', clipPath: 'polygon(3% 8%, 97% 0, 100% 90%, 5% 100%, 0 22%)', height: y(112), left: x(16), top: y(28), transform: 'rotate(-2deg)', width: x(230) }}>
          <div style={{ border: `2px solid ${green}`, borderRadius: '50%', color: green, fontFamily: display.family, fontSize: x(34), fontWeight: display.weight, left: x(52), padding: `${y(6)}px ${x(22)}px`, position: 'absolute', top: y(26) }}>
            {context.sequence.index}
          </div>
        </div>
      ) : null}
      <div style={{ ...fixedText, color: ink, fontFamily: body, fontSize: x(29), left: x(168), lineHeight: 1.36, top: y(572), transform: `translateY(${context.contentTranslateY}px)`, width: x(420), zIndex: z('bodyText', STACK_TOP_Z), ...hideStyle('bodyText') }}>
        {content.body_blocks.map((block, index) => (
          <div key={index}>
            {index > 0 ? <div aria-hidden="true" style={{ background: gold, height: 2, margin: `${y(26)}px 0 ${y(30)}px`, opacity: .8, transform: 'rotate(-1deg)', width: x(240) }} /> : null}
            <p style={{ margin: 0 }}>{block}</p>
          </div>
        ))}
      </div>
      {content.annotation ? (
        <div style={{ ...fixedText, color: isDark ? '#cdbf9f' : '#7a6d5a', fontFamily: body, fontSize: x(24), fontStyle: 'italic', fontWeight: 400, left: x(944), lineHeight: 1.3, top: y(262), transform: 'rotate(-6deg)', width: x(126), zIndex: z('annotation', STACK_TOP_Z), ...hideStyle('annotation') }}>{content.annotation}</div>
      ) : null}
      {/* Faixa da chamada (paper) + Chamada (its text): two Elements sharing the banner's fixed box. */}
      <div style={{ ...fixedText, left: x(760), top: y(1160), zIndex: z('introBanner', STACK_TOP_Z + 1), ...hideStyle('introBanner') }}>
        <AssetLayer label="Faixa da chamada" url={url('paperDark')} metrics={materialMetrics('paperDark')} contain={context.materialContain?.paperDark} box={{ left: 0, top: 0, width: x(360), height: y(210) }} rotation={-2} shadow />
      </div>
      {content.intro ? (
        <div style={{ ...fixedText, left: x(760), top: y(1160), zIndex: z('introText', STACK_TOP_Z + 1), ...hideStyle('introText') }}>
          <AssetTextLayer label="Chamada" metrics={materialMetrics('paperDark')} box={{ left: 0, top: 0, width: x(360), height: y(210) }} rotation={-2}>
            <div style={{ alignItems: 'center', color: '#d9c79b', display: 'flex', fontFamily: display.family, fontSize: x(19), inset: 0, justifyContent: 'center', letterSpacing: '.16em', lineHeight: 1.5, padding: `0 ${x(46)}px`, position: 'absolute', textAlign: 'center', textTransform: 'uppercase' }}>{content.intro}</div>
          </AssetTextLayer>
        </div>
      ) : null}
      {/* Aba da marca (paper) + Logo da marca (artwork): two Elements; the logo is the "logo" asset slot. */}
      <div style={{ ...fixedText, right: x(-16), top: y(-18), zIndex: z('brandTab', STACK_TOP_Z), ...hideStyle('brandTab') }}>
        <AssetLayer label="Aba da marca" url={url('paperDark')} metrics={materialMetrics('paperDark')} contain={context.materialContain?.paperDark} box={{ left: -x(300), top: 0, width: x(310), height: y(230) }} rotation={4} shadow />
      </div>
      <div style={{ ...fixedText, right: x(-16), top: y(-18), zIndex: z('brandLogo', STACK_TOP_Z), ...hideStyle('brandLogo') }}>
        <BrandMark show="logo" asset={context.assets.logo} palette={{ ...palette, accent: gold }} tokens={context.tokens} logoSize={x(128)} style={{ position: 'absolute', right: x(84), top: y(58), ...brandLogoPlacement(context.previewTuning?.brand, { width: x(128), height: x(128), anchorX: 0.5, anchorY: 0.5 }) }} />
      </div>
    </>
  )
}
