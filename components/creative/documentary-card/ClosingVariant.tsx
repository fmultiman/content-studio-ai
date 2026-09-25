import type { DocumentaryCardClosingContent } from '@/lib/schemas/creative/documentary-card'
import { AssetLayer, BrandMark, materialMetrics, type CardPalette } from './primitives'
import { DocumentaryIcon } from './icons'
import { LayoutBackground, SequenceBadge, layoutKit } from './layout-kit'
import { renderEmphasis } from './ListVariant'
import type { DocumentaryCardVisualContext } from './types'
import { layoutTitleLineHeight } from '@/lib/creative/templates/template-definitions'

/**
 * Editorial Documentary Collage · layout "closing" (Encerramento) — Portal
 * Carousel Completion V1, Pack A Slide 10: the closing statement (title with
 * manual line breaks), icon-labelled materials, an invitation with contact on
 * a paper scrap ("Papel do convite"), the brand block and a tagline. Dark
 * uses the Cover's night tone so the carousel closes as it opens.
 */
export function ClosingVariant({ context, palette }: { context: DocumentaryCardVisualContext; palette: CardPalette }) {
  const content = context.content as DocumentaryCardClosingContent
  const kit = layoutKit(context)
  const { x, y, isDark, ink, gold, green, paperInk, body, display, transforms } = kit
  const items = content.items ?? []
  const hasInvite = Boolean(content.cta_title || content.cta_text || content.contact)
  const titleTuning = context.previewTuning?.title
  const titleInk = isDark ? '#f1e7d2' : green

  return (
    <>
      <LayoutBackground kit={kit} night stars={[[560, 60, 12], [880, 420, 14], [980, 900, 10], [60, 820, 10]]} />

      <AssetLayer label="Ornamento celeste" url={kit.url('ornament')} metrics={materialMetrics('ornament')} contain={context.materialContain?.ornament} box={{ left: x(660), top: y(-50), width: x(460) }} transform={transforms?.ornament} zIndex={kit.z('ornament', 11)} hidden={kit.hidden('ornament')} filter={isDark ? undefined : 'brightness(.7)'} />
      <AssetLayer label="Ramo de folhas" url={kit.url('botanicalLeaf')} metrics={materialMetrics('botanicalLeaf')} contain={context.materialContain?.botanicalLeaf} box={{ left: x(860), top: y(1060), width: x(280) }} rotation={-16} transform={transforms?.botanicalLeaf} zIndex={kit.z('botanicalLeaf', 12)} hidden={kit.hidden('botanicalLeaf')} />
      <AssetLayer label="Botânica seca" url={kit.url('botanical')} metrics={materialMetrics('botanical')} contain={context.materialContain?.botanical} box={{ left: x(-26), top: y(1040), width: x(140) }} rotation={18} transform={transforms?.botanical} zIndex={kit.z('botanical', 13)} hidden={kit.hidden('botanical')} />

      {/* Papel do convite: invitation + contact. */}
      {hasInvite ? (
        <>
          <AssetLayer label="Papel do convite" url={kit.url('paperScrap')} metrics={materialMetrics('paperScrap')} contain={context.materialContain?.paperScrap} box={{ left: x(40), top: y(846), width: x(1000), height: y(250) }} rotation={-0.8} transform={transforms?.note} zIndex={kit.z('note', 14)} hidden={kit.hidden('note')} shadow>
            <div style={{ alignItems: 'center', color: paperInk, display: 'flex', gap: x(30), inset: 0, padding: `0 ${x(64)}px`, position: 'absolute' }}>
              <DocumentaryIcon icon="envelope" color={green} size={x(76)} strokeWidth={2} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: y(6) }}>
                {content.cta_title ? <div style={{ color: green, fontFamily: body, fontSize: x(30), fontWeight: 700, letterSpacing: '.02em', textTransform: 'uppercase' }}>{content.cta_title}</div> : null}
                {content.cta_text ? <div style={{ fontFamily: body, fontSize: x(25), lineHeight: 1.3 }}>{renderEmphasis(content.cta_text)}</div> : null}
                {content.contact ? <div style={{ fontFamily: body, fontSize: x(25), fontWeight: 600, marginTop: y(6) }}>{content.contact}</div> : null}
              </div>
            </div>
          </AssetLayer>
          <AssetLayer label="Fita do convite" url={kit.url('tape')} metrics={materialMetrics('tape')} contain={context.materialContain?.tape} box={{ left: x(470), top: y(826), width: x(140) }} rotation={3} transform={transforms?.tape1 ?? transforms?.tape} zIndex={kit.z('tape1', 15)} hidden={kit.hidden('tape1')} filter="saturate(.85)" />
        </>
      ) : null}

      {/* Título: the closing statement, manual line breaks kept. */}
      <div style={{ color: titleInk, fontFamily: display.family, fontSize: x(72), fontWeight: display.weight, left: x(70), letterSpacing: '.01em', lineHeight: titleTuning?.lineHeight ?? layoutTitleLineHeight(context.templateId, 'closing') ?? 1.06, position: 'absolute', textTransform: 'uppercase', top: y(168), whiteSpace: 'pre-line', width: x(860), zIndex: kit.z('title', 16), ...kit.hideStyle('title'), transform: `translate(${titleTuning?.offsetX ?? 0}px, ${titleTuning?.offsetY ?? 0}px) rotate(${titleTuning?.rotation ?? 0}deg)`, transformOrigin: 'top left' }}>
        {content.title}
      </div>

      {/* Template text (fixed layer). */}
      <SequenceBadge context={context} kit={kit} />
      <div style={{ ...kit.fixedText, color: ink, display: 'flex', flexDirection: 'column', fontFamily: body, fontSize: x(29), gap: y(16), left: x(70), lineHeight: 1.38, top: y(430), width: x(860) }}>
        {(content.body ?? []).map((paragraph, index) => <p key={index} style={{ margin: 0 }}>{renderEmphasis(paragraph)}</p>)}
      </div>
      {items.length > 0 ? (
        <div style={{ ...kit.fixedText, display: 'flex', justifyContent: 'space-between', left: x(50), top: y(640), width: x(980) }}>
          {items.map((item, index) => (
            <div key={index} style={{ alignItems: 'center', color: ink, display: 'flex', flexDirection: 'column', gap: y(10), width: `${100 / items.length}%` }}>
              <DocumentaryIcon icon={item.icon} color={gold} size={x(66)} strokeWidth={2} />
              <div style={{ fontFamily: body, fontSize: x(21), lineHeight: 1.2, textAlign: 'center' }}>{item.label}</div>
            </div>
          ))}
        </div>
      ) : null}
      <div aria-hidden="true" style={{ ...kit.fixedText, borderTop: `2px dotted ${gold}`, left: x(70), opacity: .7, top: y(808), width: x(940) }} />
      <BrandMark asset={context.assets.logo} palette={{ ...palette, foreground: ink, accent: gold }} tokens={context.tokens} label={content.brand_label} logoSize={x(140)} style={{ ...kit.fixedText, left: x(96), top: y(1124) }} />
      {content.tagline ? (
        <div style={{ ...kit.fixedText, color: gold, fontFamily: body, fontSize: x(22), fontWeight: 600, left: 0, letterSpacing: '.28em', textAlign: 'center', textTransform: 'uppercase', top: y(1296), width: x(1080) }}>{content.tagline}</div>
      ) : null}
    </>
  )
}
