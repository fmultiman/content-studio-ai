import type { DocumentaryCardQuoteContent } from '@/lib/schemas/creative/documentary-card'
import { AssetLayer, AssetSurface, AssetTextLayer, PlateFrame, PlateImage, materialMetrics, type CardPalette, type PlateGeometry } from './primitives'
import { DocumentaryIcon } from './icons'
import { LayoutBackground, SequenceBadge, TitleOnStrip, layoutKit } from './layout-kit'
import { renderEmphasis } from './ListVariant'
import type { DocumentaryCardVisualContext } from './types'

/**
 * Editorial Documentary Collage · layout "quote" (Citação) — Portal Carousel
 * Completion V1, Pack A Slide 9: a pull quote on light paper as the focal
 * element, intro + bullets beside it, one wide content image ("Imagem",
 * the replaceable content-image slot) and an optional callout on dark paper.
 */
export function QuoteVariant({ context, palette }: { context: DocumentaryCardVisualContext; palette: CardPalette }) {
  const content = context.content as DocumentaryCardQuoteContent
  const kit = layoutKit(context)
  const { x, y, ink, green, paperInk, body, display, transforms } = kit
  const bullets = content.bullets ?? []
  const heroTuning = context.previewTuning?.hero
  const bulletsTop = content.intro ? 610 : 440
  const heroPlate: PlateGeometry = { height: y(330), left: x(36), padding: x(12), rotation: -0.8, top: y(896), width: x(1008) }

  return (
    <>
      <LayoutBackground kit={kit} stars={[[560, 410, 10], [1040, 890, 10]]} />

      <AssetLayer label="Ramo de folhas" url={kit.url('botanicalLeaf')} metrics={materialMetrics('botanicalLeaf')} contain={context.materialContain?.botanicalLeaf} box={{ left: x(870), top: y(-40), width: x(260) }} rotation={150} flipX transform={transforms?.botanicalLeaf} zIndex={kit.z('botanicalLeaf', 11)} hidden={kit.hidden('botanicalLeaf')} />

      {/* Moldura da imagem (procedural): the pale archival border, under the image. Independent of it. */}
      <PlateFrame geometry={heroPlate} tuning={heroTuning} zIndex={kit.z('heroFrame', 11)} hidden={kit.hidden('heroFrame')} background="#ece2cc" shadow="0 22px 40px rgba(0, 0, 0, .35)" />
      {/* Imagem: the wide content image. Painted whatever the frame does. */}
      <PlateImage geometry={heroPlate} tuning={heroTuning} zIndex={kit.z('hero', 12)} hidden={kit.hidden('hero')} frameHidden={kit.hidden('heroFrame')} label="Imagem">
        <AssetSurface asset={context.assets.hero} label="Imagem" style={{ backgroundColor: palette.paper, backgroundSize: context.assets.hero?.fit === 'contain' ? 'contain' : 'cover', filter: 'saturate(.8) contrast(1.04)', inset: 0, position: 'absolute' }} />
      </PlateImage>

      {/* Caixa de destaque (optional). */}
      {content.callout ? (
        <>
          <AssetLayer label="Caixa de destaque" url={kit.url('paperDark')} metrics={materialMetrics('paperDark')} contain={context.materialContain?.paperDark} box={{ left: x(110), top: y(1176), width: x(860), height: y(146) }} rotation={-0.5} transform={transforms?.paperDark} zIndex={kit.z('callout', 13)} hidden={kit.hidden('callout')} shadow />
          <AssetTextLayer label="Texto do destaque" metrics={materialMetrics('paperDark')} box={{ left: x(110), top: y(1176), width: x(860), height: y(146) }} rotation={-0.5} transform={transforms?.paperDark} zIndex={kit.z('calloutText', 13)} hidden={kit.hidden('calloutText')}>
            <div style={{ alignItems: 'center', color: '#efe4cc', display: 'flex', fontFamily: body, fontSize: x(26), gap: x(26), inset: 0, lineHeight: 1.34, padding: `0 ${x(52)}px`, position: 'absolute' }}>
              <DocumentaryIcon icon="leaf" color="#c9a45c" size={x(60)} />
              <div>{renderEmphasis(content.callout)}</div>
            </div>
          </AssetTextLayer>
        </>
      ) : null}

      {/* Papel da citação: the focal pull quote. */}
      <AssetLayer label="Papel da citação" url={kit.url('tornPaper')} metrics={materialMetrics('tornPaper')} contain={context.materialContain?.tornPaper} box={{ left: x(574), top: y(436), width: x(470), height: y(430) }} rotation={2.4} transform={transforms?.paper} zIndex={kit.z('quote', 14)} hidden={kit.hidden('quote')} shadow />
      <AssetTextLayer label="Texto da citação" metrics={materialMetrics('tornPaper')} box={{ left: x(574), top: y(436), width: x(470), height: y(430) }} rotation={2.4} transform={transforms?.paper} zIndex={kit.z('quoteText', 14)} hidden={kit.hidden('quoteText')}>
        <div style={{ color: paperInk, inset: 0, padding: `${y(40)}px ${x(52)}px`, position: 'absolute' }}>
          <div aria-hidden="true" style={{ color: green, fontFamily: display.family, fontSize: x(120), fontWeight: display.weight, height: y(70), lineHeight: 1 }}>“</div>
          <div style={{ fontFamily: display.family, fontSize: x(content.quote.length > 90 ? 32 : 40), lineHeight: 1.22, marginTop: y(6) }}>{content.quote}</div>
          <div aria-hidden="true" style={{ bottom: y(-10), color: green, fontFamily: display.family, fontSize: x(120), fontWeight: display.weight, position: 'absolute', right: x(52) }}>”</div>
        </div>
      </AssetTextLayer>
      <AssetLayer label="Fita da citação" url={kit.url('tape')} metrics={materialMetrics('tape')} contain={context.materialContain?.tape} box={{ left: x(740), top: y(414), width: x(150) }} rotation={-6} transform={transforms?.tape1 ?? transforms?.tape} zIndex={kit.z('tape1', 15)} hidden={kit.hidden('tape1')} filter="saturate(.85)" />

      <TitleOnStrip context={context} kit={kit} title={content.title} fontSize={62} />

      {/* Template text (fixed layer). */}
      <SequenceBadge context={context} kit={kit} />
      {content.intro ? (
        <div style={{ ...kit.fixedAtom('intro'), color: ink, fontFamily: body, fontSize: x(29), left: x(70), lineHeight: 1.36, top: y(430), width: x(480), ...kit.localType('intro'), ...kit.placed('intro') }}>{renderEmphasis(content.intro)}</div>
      ) : null}
      {bullets.length > 0 ? (
        <div style={{ ...kit.fixedAtom('bullets'), display: kit.hidden('bullets') ? 'none' : 'flex', flexDirection: 'column', gap: y(18), left: x(70), top: y(bulletsTop), width: x(470), ...kit.placed('bullets') }}>
          {bullets.map((bullet, index) => (
            <div key={index} style={{ alignItems: 'flex-start', color: ink, display: 'flex', fontFamily: body, fontSize: x(25), gap: x(20), lineHeight: 1.32 }}>
              <span aria-hidden="true" style={{ background: kit.isDark ? '#c9a45c' : green, borderRadius: '50%', flexShrink: 0, height: x(16), marginTop: y(9), width: x(16) }} />
              <span>{renderEmphasis(bullet)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </>
  )
}
