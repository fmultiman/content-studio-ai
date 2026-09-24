import type { CSSProperties } from 'react'
import type { DocumentaryCardCoverContent } from '@/lib/schemas/creative/documentary-card'
import { STACK_TOP_Z } from '@/lib/creative/templates/element-stack'
import { AssetLayer, AssetSurface, BrandMark, GrainOverlay, Sparkle, materialMetrics, materialUrl, type CardPalette } from './primitives'
import type { DocumentaryCardVisualContext } from './types'

/**
 * Editorial Documentary Collage · layout "cover" — reconstructed from Pack B
 * Slide 1 (docs/discovery/creative-rendering/visual-reference-pack/pack-b/01.png)
 * out of the template's transparent asset slots. Coordinates are authored on
 * the 1080×1350 reference canvas and scaled to the real canvas. Every
 * authored element takes its z-index from the normalized element stack
 * (context.stack); only template text/chrome sits outside it.
 */
export function CoverVariant({ context, palette }: { context: DocumentaryCardVisualContext; palette: CardPalette }) {
  const content = context.content as DocumentaryCardCoverContent
  const sx = context.canvas.width / 1080
  const sy = context.canvas.height / 1350
  const x = (value: number) => value * sx
  const y = (value: number) => value * sy
  const isDark = context.resolvedAppearance === 'dark'
  const text = isDark ? '#efe4cc' : palette.ink
  const gold = isDark ? '#c9a45c' : '#9a7a3a'
  const titleInk = '#1b1a17'
  const z = (id: string, fallback: number) => context.stack.zIndex[id] ?? fallback
  const transforms = context.primitiveTransforms
  const url = (name: Parameters<typeof materialUrl>[0]) => materialUrl(name, context.materialBaseUrl, context.materialUrls)
  const heroScale = context.mode === 'video' && context.motion?.preset === 'slow_push' ? 1 + (context.progress * 0.06) : 1

  const heroTuning = context.previewTuning?.hero
  const titleTuning = context.previewTuning?.title
  const fixedText: CSSProperties = { opacity: context.contentOpacity, position: 'absolute', zIndex: STACK_TOP_Z }
  const [noteLabel, ...noteRest] = (content.detail_note ?? '').split(':')
  const noteBody = noteRest.join(':').trim()

  return (
    <>
      {/* Template chrome — background, grain, stars. Not authored elements. */}
      <div style={{ background: isDark ? 'radial-gradient(120% 90% at 20% 10%, #16203a 0%, #0b1020 55%, #070a14 100%)' : `linear-gradient(160deg, ${palette.background}, #f3ead8)`, inset: 0, position: 'absolute' }} />
      <GrainOverlay color={isDark ? '#f0d9a8' : palette.ink} style={{ inset: 0, position: 'absolute' }} />
      {[[318, 44, 26], [480, 100, 12], [34, 648, 14], [474, 790, 18], [690, 1210, 16], [1040, 40, 10]].map(([left, top, size]) => (
        <Sparkle key={`${left}-${top}`} color={gold} size={x(size)} style={{ left: x(left), opacity: .85, top: y(top), zIndex: 1 }} />
      ))}

      {/* Authored elements — painted from the normalized stack. */}
      <AssetLayer label="Ornamento celeste" url={url('ornament')} metrics={materialMetrics('ornament')} box={{ left: x(478), top: y(-26), width: x(380) }} transform={transforms?.ornament} zIndex={z('ornament', 11)} filter={isDark ? undefined : 'brightness(.7)'} />
      <AssetLayer label="Fragmento de mapa" url={url('archival')} metrics={materialMetrics('archival')} box={{ left: x(826), top: y(1054), width: x(430) }} rotation={90} transform={transforms?.archival} zIndex={z('archival', 12)} shadow />
      <AssetLayer label="Ramo de folhas" url={url('botanicalLeaf')} metrics={materialMetrics('botanicalLeaf')} box={{ left: x(405), top: y(842), width: x(280) }} rotation={-8} flipX transform={transforms?.botanicalLeaf} zIndex={z('botanicalLeaf', 13)} />

      {/* Hero ("Imagem principal"): the content image in a pale photo border, tilted like the Pack B book. */}
      <div
        aria-label="Imagem principal"
        style={{
          background: '#e8dcc3',
          boxShadow: '0 22px 40px rgba(0, 0, 0, .45)',
          height: y(676),
          left: x(566),
          padding: x(14),
          position: 'absolute',
          top: y(214),
          width: x(468),
          zIndex: z('hero', 14),
          transform: `translate(${heroTuning?.offsetX ?? 0}px, ${heroTuning?.offsetY ?? 0}px) rotate(${3.2 + (heroTuning?.rotation ?? 0)}deg) scale(${heroTuning?.scale ?? 1})`,
          transformOrigin: 'center',
        }}
      >
        <div style={{ height: '100%', overflow: 'hidden', position: 'relative', width: '100%' }}>
          <AssetSurface asset={context.assets.hero} label="Documentary hero evidence fixture" style={{ backgroundColor: palette.paper, backgroundSize: context.assets.hero?.fit === 'contain' ? 'contain' : 'cover', filter: 'saturate(.88) contrast(1.05)', inset: 0, position: 'absolute', transform: `scale(${heroScale})`, transformOrigin: context.assets.hero?.focal_point ? `${context.assets.hero.focal_point.x * 100}% ${context.assets.hero.focal_point.y * 100}%` : 'center' }} />
        </div>
      </div>

      <AssetLayer label="Botânica seca" url={url('botanical')} metrics={materialMetrics('botanical')} box={{ left: x(968), top: y(498), width: x(190) }} rotation={14} transform={transforms?.botanical} zIndex={z('botanical', 15)} />
      <AssetLayer label="Fita da imagem" url={url('tape')} metrics={materialMetrics('tape')} box={{ left: x(742), top: y(176), width: x(158) }} rotation={6} transform={transforms?.tape1 ?? transforms?.tape} zIndex={z('tape1', 16)} filter="saturate(.85)" />

      {/* Nota da edição: detail_note on its own paper scrap. */}
      <AssetLayer label="Nota da edição" url={url('paperScrap')} metrics={materialMetrics('paperScrap')} box={{ left: x(598), top: y(906), width: x(408) }} rotation={-1.5} transform={transforms?.note} zIndex={z('note', 17)} shadow>
        {content.detail_note ? (
          <div style={{ color: titleInk, fontFamily: context.tokens.typography.body.family, fontSize: x(21), left: '11%', lineHeight: 1.34, position: 'absolute', right: '9%', top: '25%' }}>
            {noteBody ? <><div style={{ fontWeight: 700 }}>{noteLabel}:</div><div>{noteBody}</div></> : content.detail_note}
          </div>
        ) : null}
      </AssetLayer>
      <AssetLayer label="Fita da nota" url={url('tape')} metrics={materialMetrics('tape')} box={{ left: x(694), top: y(880), width: x(138) }} rotation={-3} transform={transforms?.tape2 ?? transforms?.tape} zIndex={z('tape2', 18)} filter="saturate(.85)" />

      {/* Papel do título + Título: siblings, so each owns its own layer. */}
      <AssetLayer label="Papel do título" url={url('tornPaper')} metrics={materialMetrics('tornPaper')} box={{ left: x(12), top: y(228), width: x(586), height: y(356) }} rotation={-1} transform={transforms?.paper} zIndex={z('paper', 19)} shadow />
      <div
        style={{
          color: titleInk,
          fontFamily: context.tokens.typography.display.family,
          fontSize: x(62),
          fontWeight: context.tokens.typography.display.weight,
          left: x(56),
          letterSpacing: '-.02em',
          lineHeight: 1.02,
          position: 'absolute',
          textTransform: 'uppercase',
          top: y(276),
          width: x(500),
          zIndex: z('title', 20),
          transform: `translate(${titleTuning?.offsetX ?? 0}px, ${titleTuning?.offsetY ?? 0}px) rotate(${-1 + (titleTuning?.rotation ?? 0)}deg)`,
          transformOrigin: 'top left',
        }}
      >
        {content.title}
      </div>

      {/* Template text (fixed layer). */}
      <div style={{ ...fixedText, background: '#d9c49a', color: titleInk, fontFamily: context.tokens.typography.display.family, fontSize: x(24), fontWeight: context.tokens.typography.display.weight, left: x(56), padding: `${y(12)}px ${x(18)}px`, top: y(76), transform: 'rotate(-1.5deg)', clipPath: 'polygon(2% 6%, 98% 0, 100% 92%, 4% 100%, 0 20%)', ...(context.sequence?.index && context.sequence?.total ? {} : { display: 'none' }) }}>
        {context.sequence?.index}/{context.sequence?.total}
      </div>
      {content.eyebrow ? (
        <div style={{ ...fixedText, borderBottom: `1.5px solid ${gold}`, color: gold, fontFamily: context.tokens.typography.label?.family ?? context.tokens.typography.body.family, fontSize: x(21), fontWeight: 600, left: x(58), letterSpacing: '.2em', paddingBottom: y(10), textTransform: 'uppercase', top: y(180) }}>{content.eyebrow}</div>
      ) : null}
      {content.subtitle ? (
        <div style={{ ...fixedText, color: text, fontFamily: context.tokens.typography.body.family, fontSize: x(30), left: x(74), lineHeight: 1.3, maxWidth: x(470), top: y(608), transform: `translateY(${context.contentTranslateY}px)` }}>{content.subtitle}</div>
      ) : null}
      {content.source_line ? (
        <div style={{ ...fixedText, alignItems: 'center', color: text, display: 'flex', fontFamily: context.tokens.typography.body.family, fontSize: x(19), fontStyle: 'italic', gap: x(16), left: x(62), top: y(798) }}>
          <span aria-hidden="true" style={{ background: gold, display: 'inline-block', height: 1.5, width: x(52) }} />
          {content.source_line}
        </div>
      ) : null}
      <BrandMark asset={context.assets.logo} palette={{ ...palette, foreground: text, accent: gold }} tokens={context.tokens} label={content.brand_label} logoSize={x(118)} style={{ ...fixedText, bottom: y(58), left: x(110) }} />
    </>
  )
}
