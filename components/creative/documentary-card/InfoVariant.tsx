import type { CSSProperties } from 'react'
import type { DocumentaryCardInfoContent } from '@/lib/schemas/creative/documentary-card'
import { Botanical, BrandMark, GrainOverlay, MaterialTape, PaperPlane, Pin, SequenceMarker, type CardPalette } from './primitives'
import type { DocumentaryCardVisualContext } from './types'

export function InfoVariant({ context, palette }: { context: DocumentaryCardVisualContext; palette: CardPalette }) {
  const content = context.content as DocumentaryCardInfoContent
  const titleSize = context.canvas.height >= 1800 ? 74 : 68
  const cardSize = context.canvas.height >= 1800 ? 210 : 190
  const reel = context.canvas.height >= 1800
  const ink = palette.ink
  const cardStyle: CSSProperties = { color: ink, fontFamily: context.tokens.typography.body.family, padding: 24, position: 'relative' }

  // Same bounded template-sanctioned title refinement as CoverVariant — one
  // shared PreviewTuning shape, no parallel positioning system for Info.
  const titleTuning = context.previewTuning?.title
  const baseTitleStyle: CSSProperties = { left: '7%', padding: '3% 4%', position: 'absolute', top: reel ? '15%' : '16%', width: reel ? '86%' : '81%', zIndex: 20 }
  const titleTextStyle: CSSProperties | undefined = titleTuning
    ? { transform: `translate(${titleTuning.offsetX}px, ${titleTuning.offsetY}px) rotate(${titleTuning.rotation}deg)`, transformOrigin: 'top left' }
    : undefined

  // Final Authoring Polish V2.1: source_line ("Fonte") used to spread the
  // Title's own titleTextStyle, so moving Título also moved the source/credit
  // line below it. It is a visually and semantically independent object —
  // give it its own tuning slot, same bounded shape, no shared style object.
  const sourceTuning = context.previewTuning?.source
  const sourceTextStyle: CSSProperties | undefined = sourceTuning
    ? { transform: `translate(${sourceTuning.offsetX}px, ${sourceTuning.offsetY}px) rotate(${sourceTuning.rotation}deg)`, transformOrigin: 'top left' }
    : undefined

  return (
    <>
      <div style={{ background: `linear-gradient(145deg, ${palette.paper}, ${palette.background})`, inset: 0, position: 'absolute' }} />
      <GrainOverlay color={palette.ink} style={{ inset: 0, position: 'absolute' }} />
      <div style={{ border: `1px solid ${palette.paperAlt}88`, inset: '3%', position: 'absolute' }} />
      <Botanical baseUrl={context.materialBaseUrl} urls={context.materialUrls} primitiveTransform={context.primitiveTransforms?.botanical} style={{ height: '30%', left: '-1%', opacity: .5, position: 'absolute', top: '7%', width: '22%' }} />
      <Botanical baseUrl={context.materialBaseUrl} urls={context.materialUrls} primitiveTransform={context.primitiveTransforms?.botanical} style={{ bottom: '8%', height: '25%', opacity: .4, position: 'absolute', right: '-2%', transform: 'scaleX(-1) rotate(-15deg)', width: '20%' }} />
      <PaperPlane color={palette.paperAlt} rotation={-2.2} material="paperStrip" materialBaseUrl={context.materialBaseUrl} materialUrls={context.materialUrls} primitiveTransform={context.primitiveTransforms?.paperStrip} style={{ ...baseTitleStyle }}>
        <div style={{ ...titleTextStyle, color: ink, fontFamily: context.tokens.typography.display.family, fontSize: titleSize, fontWeight: context.tokens.typography.display.weight, letterSpacing: '-.035em', lineHeight: .96, maxWidth: '92%', textTransform: 'uppercase' }}>{content.title}</div>
      </PaperPlane>
      <div style={{ color: ink, fontFamily: context.tokens.typography.body.family, fontSize: reel ? 30 : 27, left: '9%', lineHeight: 1.28, maxWidth: reel ? '73%' : '51%', opacity: context.contentOpacity, position: 'absolute', top: reel ? '36%' : '38%', transform: `translateY(${context.contentTranslateY}px)`, zIndex: 25 }}>{content.intro}</div>
      <div style={{ color: ink, fontFamily: context.tokens.typography.body.family, fontSize: reel ? 24 : 22, left: '9%', lineHeight: 1.35, maxWidth: reel ? '73%' : '49%', opacity: context.contentOpacity, position: 'absolute', top: reel ? '44%' : '50%', zIndex: 25 }}>{content.body_blocks.map((block, index) => <p key={index} style={{ margin: index ? '18px 0 0' : 0 }}>{block}</p>)}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22, position: 'absolute', right: reel ? '9%' : '7%', top: reel ? '61%' : '46%', width: reel ? '56%' : '34%', zIndex: 30 }}>
        {content.fact_cards.map((fact, index) => (
          // Same fix as CoverVariant's hero: Tape/Pin are siblings of the
          // card's PaperPlane (which clip-paths its own descendants), not
          // children of it, so an authored offset can cross the card's edge
          // without being cut. The wrapper occupies the box the PaperPlane
          // used to occupy, so Tape/Pin's existing coordinates are unchanged.
          <div key={`${fact.primary}-${index}`} style={{ minHeight: cardSize, position: 'relative' }}>
            <PaperPlane color={index === 0 ? palette.paperAlt : palette.foreground} rotation={index === 0 ? 2.3 : -2.1} material="tornPaper" materialBaseUrl={context.materialBaseUrl} materialUrls={context.materialUrls} primitiveTransform={context.primitiveTransforms?.paper} style={{ ...cardStyle, inset: 0, position: 'absolute' }}>
              <div style={{ color: index === 0 ? ink : palette.background, fontFamily: context.tokens.typography.display.family, fontSize: context.canvas.height >= 1800 ? 48 : 42, fontWeight: context.tokens.typography.display.weight }}>{fact.primary}</div>
              <div style={{ color: index === 0 ? ink : palette.background, fontSize: 19, lineHeight: 1.25, marginTop: 12 }}>{fact.secondary}</div>
              <div style={{ color: index === 0 ? ink : palette.background, fontSize: 17, marginTop: 10 }}>{fact.tertiary}</div>
            </PaperPlane>
            <MaterialTape color={palette.paper} rotation={index === 0 ? -7 : 6} baseUrl={context.materialBaseUrl} urls={context.materialUrls} primitiveTransform={context.primitiveTransforms?.[`tape${index + 1}` as 'tape1' | 'tape2' | 'tape3'] ?? context.primitiveTransforms?.tape} style={{ position: 'absolute', right: 38, top: -14 }} />
            <Pin baseUrl={context.materialBaseUrl} urls={context.materialUrls} primitiveTransform={context.primitiveTransforms?.pin} style={{ bottom: 16, right: 16, position: 'absolute' }} />
          </div>
        ))}
      </div>
      <div style={{ ...sourceTextStyle, color: ink, fontFamily: context.tokens.typography.body.family, fontSize: 18, fontStyle: 'italic', left: '9%', maxWidth: '46%', opacity: context.contentOpacity, position: 'absolute', top: reel ? '87%' : '82%', zIndex: 40 }}>{content.source_line}</div>
      <div style={{ color: palette.muted, fontFamily: context.tokens.typography.body.family, fontSize: 18, fontStyle: 'italic', maxWidth: '30%', opacity: context.contentOpacity, position: 'absolute', right: '8%', textAlign: 'right', top: reel ? '91%' : '85%', zIndex: 40 }}>{content.annotation}</div>
      <MaterialTape color={palette.paperAlt} rotation={-4} baseUrl={context.materialBaseUrl} urls={context.materialUrls} primitiveTransform={context.primitiveTransforms?.tape3 ?? context.primitiveTransforms?.tape} style={{ left: reel ? '18%' : '31%', opacity: .7, position: 'absolute', top: reel ? '95%' : '94%', zIndex: 35 }} />
      <SequenceMarker color={palette.accent} ink={ink} index={context.sequence?.index} total={context.sequence?.total} style={{ left: '8%', position: 'absolute', top: '6%', zIndex: 60 }} />
      <BrandMark asset={context.assets.logo} palette={palette} tokens={context.tokens} style={{ bottom: '5%', left: '8%', opacity: context.contentOpacity, position: 'absolute', zIndex: 60 }} />
    </>
  )
}
