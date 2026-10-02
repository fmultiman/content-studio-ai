import type { CSSProperties } from 'react'
import type { DocumentaryCardCoverContent } from '@/lib/schemas/creative/documentary-card'
import { STACK_TOP_Z } from '@/lib/creative/templates/element-stack'
import { layoutTitleLineHeight } from '@/lib/creative/templates/template-definitions'
import { AssetLayer, AssetSurface, AssetTextLayer, BrandLogo, GrainOverlay, PlateImage, Sparkle, localTypography, materialMetrics, materialUrl, type CardPalette, type PlateGeometry } from './primitives'
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
  const isHidden = (id: string) => context.hidden.has(id)
  const hideStyle = (id: string): CSSProperties => (isHidden(id) ? { display: 'none' } : {})
  const transforms = context.primitiveTransforms
  const url = (name: Parameters<typeof materialUrl>[0]) => materialUrl(name, context.materialBaseUrl, context.materialUrls)
  const heroScale = context.mode === 'video' && context.motion?.preset === 'slow_push' ? 1 + (context.progress * 0.06) : 1

  const heroTuning = context.previewTuning?.hero
  const titleTuning = context.previewTuning?.title
  const fixedText: CSSProperties = { opacity: context.contentOpacity, position: 'absolute', zIndex: STACK_TOP_Z }
  const [noteLabel, ...noteRest] = (content.detail_note ?? '').split(':')
  const noteBody = noteRest.join(':').trim()
  // COVER_ELEMENT_COMPLETENESS_V1 — Chamada / Introdução / Fonte editorial / Assinatura are Template Elements: painted from the
  // stack (on top by default), hideable, and positioned by their bounded tuning. Absent tuning = the Template position.
  const positioned = (id: string, tuning: { offsetX: number; offsetY: number; rotation: number } | undefined, base = ''): CSSProperties => ({
    zIndex: z(id, STACK_TOP_Z),
    ...hideStyle(id),
    transform: `${base ? `${base} ` : ''}translate(${tuning?.offsetX ?? 0}px, ${tuning?.offsetY ?? 0}px) rotate(${tuning?.rotation ?? 0}deg)`,
    transformOrigin: 'top left',
  })
  // CREATIVE_EDITOR_REAL_SMOKE_CORRECTNESS_HARDENING_V1 — the Cover's Hero is the book cover ALONE: there is no pale backing/moldura
  // Element. The box is the one the photo always occupied by default (the former plate minus its 14px border margin), so the image
  // keeps its size and placement. Saved state of the removed backing (`hiddenElements`/`elementOrder` 'heroFrame', the legacy
  // `tuning.hero.frame` toggle) names an Element this layout no longer has: it is ignored here and dropped by the shared normalizers.
  const heroPlate: PlateGeometry = { height: y(676) - x(28), left: x(580), padding: 0, rotation: 3.2, top: y(214) + x(14), width: x(440) }

  return (
    <>
      {/* Template chrome — background, grain, stars. Not authored elements. */}
      <div style={{ background: isDark ? 'radial-gradient(120% 90% at 20% 10%, #16203a 0%, #0b1020 55%, #070a14 100%)' : `linear-gradient(160deg, ${palette.background}, #f3ead8)`, inset: 0, position: 'absolute' }} />
      <GrainOverlay color={isDark ? '#f0d9a8' : palette.ink} style={{ inset: 0, position: 'absolute' }} />
      {[[318, 44, 26], [480, 100, 12], [34, 648, 14], [474, 790, 18], [690, 1210, 16], [1040, 40, 10]].map(([left, top, size]) => (
        <Sparkle key={`${left}-${top}`} color={gold} size={x(size)} style={{ left: x(left), opacity: .85, top: y(top), zIndex: 1 }} />
      ))}

      {/* Authored elements — painted from the normalized stack. */}
      <AssetLayer label="Ornamento celeste" url={url('ornament')} metrics={materialMetrics('ornament')} contain={context.materialContain?.ornament} box={{ left: x(478), top: y(-26), width: x(380) }} transform={transforms?.ornament} zIndex={z('ornament', 11)} hidden={isHidden('ornament')} filter={isDark ? undefined : 'brightness(.7)'} />
      <AssetLayer label="Fragmento de mapa" url={url('archival')} metrics={materialMetrics('archival')} contain={context.materialContain?.archival} box={{ left: x(826), top: y(1054), width: x(430) }} rotation={90} transform={transforms?.archival} zIndex={z('archival', 12)} hidden={isHidden('archival')} shadow />
      <AssetLayer label="Ramo de folhas" url={url('botanicalLeaf')} metrics={materialMetrics('botanicalLeaf')} contain={context.materialContain?.botanicalLeaf} box={{ left: x(405), top: y(842), width: x(280) }} rotation={-8} flipX transform={transforms?.botanicalLeaf} zIndex={z('botanicalLeaf', 13)} hidden={isHidden('botanicalLeaf')} />

      {/* Hero ("Imagem principal"): the book cover, tilted like the Pack B book. Always `contain`: the COMPLETE artwork stays visible (no crop state exists; the unused box stays transparent). */}
      <PlateImage geometry={heroPlate} tuning={heroTuning} zIndex={z('hero', 14)} hidden={isHidden('hero')} frameHidden label="Imagem principal">
        <AssetSurface asset={context.assets.hero} label="Documentary hero evidence fixture" style={{ backgroundColor: 'transparent', backgroundSize: 'contain', filter: 'saturate(.88) contrast(1.05)', inset: 0, position: 'absolute', transform: `scale(${heroScale})`, transformOrigin: context.assets.hero?.focal_point ? `${context.assets.hero.focal_point.x * 100}% ${context.assets.hero.focal_point.y * 100}%` : 'center' }} />
      </PlateImage>

      <AssetLayer label="Botânica seca" url={url('botanical')} metrics={materialMetrics('botanical')} contain={context.materialContain?.botanical} box={{ left: x(968), top: y(498), width: x(190) }} rotation={14} transform={transforms?.botanical} zIndex={z('botanical', 15)} hidden={isHidden('botanical')} />
      <AssetLayer label="Fita da imagem" url={url('tape')} metrics={materialMetrics('tape')} contain={context.materialContain?.tape} box={{ left: x(742), top: y(176), width: x(158) }} rotation={6} transform={transforms?.tape1 ?? transforms?.tape} zIndex={z('tape1', 16)} hidden={isHidden('tape1')} filter="saturate(.85)" />

      {/* Papel da nota (the paper) + Nota da edição (its text): two independent Elements. The text takes the paper's box and transform channel, is painted ABOVE the paper by default, and each owns its visibility: hiding the paper leaves the text, hiding the text leaves the paper. */}
      <AssetLayer label="Papel da nota" url={url('paperScrap')} metrics={materialMetrics('paperScrap')} contain={context.materialContain?.paperScrap} box={{ left: x(598), top: y(906), width: x(408) }} rotation={-1.5} transform={transforms?.note} zIndex={z('note', 17)} hidden={isHidden('note')} shadow />
      {content.detail_note ? (
        <AssetTextLayer label="Nota da edição" metrics={materialMetrics('paperScrap')} box={{ left: x(598), top: y(906), width: x(408) }} rotation={-1.5} transform={transforms?.note} zIndex={z('noteText', 17)} hidden={isHidden('noteText')}>
          <div style={{ color: titleInk, fontFamily: context.tokens.typography.body.family, fontSize: x(21), left: '11%', lineHeight: 1.34, position: 'absolute', right: '9%', top: '25%' }}>
            {noteBody ? <><div style={{ fontWeight: 700 }}>{noteLabel}:</div><div>{noteBody}</div></> : content.detail_note}
          </div>
        </AssetTextLayer>
      ) : null}
      <AssetLayer label="Fita da nota" url={url('tape')} metrics={materialMetrics('tape')} contain={context.materialContain?.tape} box={{ left: x(694), top: y(880), width: x(138) }} rotation={-3} transform={transforms?.tape2 ?? transforms?.tape} zIndex={z('tape2', 18)} hidden={isHidden('tape2')} filter="saturate(.85)" />

      {/* Papel do título + Título: siblings, so each owns its own layer. */}
      <AssetLayer label="Papel do título" url={url('tornPaper')} metrics={materialMetrics('tornPaper')} contain={context.materialContain?.tornPaper} box={{ left: x(12), top: y(228), width: x(586), height: y(356) }} rotation={-1} transform={transforms?.paper} zIndex={z('paper', 19)} hidden={isHidden('paper')} shadow />
      <div
        style={{
          color: titleInk,
          fontFamily: context.tokens.typography.display.family,
          fontSize: x(62),
          fontWeight: context.tokens.typography.display.weight,
          left: x(56),
          letterSpacing: '-.02em',
          lineHeight: titleTuning?.lineHeight ?? layoutTitleLineHeight(context.templateId, 'cover') ?? 1.02,
          position: 'absolute',
          textTransform: 'uppercase',
          top: y(276),
          width: x(500),
          zIndex: z('title', 20), ...hideStyle('title'),
          ...localTypography(context, 'title'),
          transform: `translate(${titleTuning?.offsetX ?? 0}px, ${titleTuning?.offsetY ?? 0}px) rotate(${-1 + (titleTuning?.rotation ?? 0)}deg)`,
          transformOrigin: 'top left',
        }}
      >
        {content.title}
      </div>

      {/* Template text (fixed layer). */}
      <div aria-label={context.sequence ? `Página ${context.sequence.index} de ${context.sequence.total}` : undefined} style={{ ...fixedText, background: '#d9c49a', color: titleInk, fontFamily: context.tokens.typography.display.family, fontSize: x(24), fontWeight: context.tokens.typography.display.weight, left: x(56), padding: `${y(12)}px ${x(18)}px`, top: y(76), transform: 'rotate(-1.5deg)', clipPath: 'polygon(2% 6%, 98% 0, 100% 92%, 4% 100%, 0 20%)', ...(context.sequence?.index && context.sequence?.total ? {} : { display: 'none' }) }}>
        {context.sequence?.index}
      </div>
      {content.eyebrow ? (
        <div data-element="Chamada" style={{ ...fixedText, borderBottom: `1.5px solid ${gold}`, color: gold, fontFamily: context.tokens.typography.label?.family ?? context.tokens.typography.body.family, fontSize: x(21), fontWeight: 600, left: x(58), letterSpacing: '.2em', paddingBottom: y(10), textTransform: 'uppercase', top: y(180), ...positioned('kicker', context.previewTuning?.kicker), ...localTypography(context, 'kicker') }}>{content.eyebrow}</div>
      ) : null}
      {content.subtitle ? (
        <div data-element="Introdução" style={{ ...fixedText, color: text, fontFamily: context.tokens.typography.body.family, fontSize: x(30), left: x(74), lineHeight: 1.3, maxWidth: x(470), top: y(608), ...positioned('intro', context.previewTuning?.intro, `translateY(${context.contentTranslateY}px)`), ...localTypography(context, 'intro') }}>{content.subtitle}</div>
      ) : null}
      {content.source_line ? (
        <div data-element="Fonte editorial" style={{ ...fixedText, alignItems: 'center', color: text, display: 'flex', fontFamily: context.tokens.typography.body.family, fontSize: x(19), fontStyle: 'italic', gap: x(16), left: x(62), top: y(798), ...positioned('source', context.previewTuning?.source), ...localTypography(context, 'source') }}>
          <span aria-hidden="true" style={{ background: gold, display: 'inline-block', height: 1.5, width: x(52) }} />
          {content.source_line}
        </div>
      ) : null}
      {/* Assinatura = Logo da marca: ONE Element, the COMPLETE logo asset (slot "logo"). The file already carries the brand name, so no name text is drawn. */}
      <BrandLogo asset={context.assets.logo} palette={{ ...palette, foreground: text, accent: gold }} width={x(400)} height={x(118)} style={{ ...fixedText, bottom: y(58), left: x(110), ...positioned('brandLogo', context.previewTuning?.brand) }} />
    </>
  )
}
