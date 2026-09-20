import type { CSSProperties } from 'react'
import type { DocumentaryCardInfoContent } from '@/lib/schemas/creative/documentary-card'
import { Botanical, BrandMark, PaperPlane, SequenceMarker, Tape, type CardPalette } from './primitives'
import type { DocumentaryCardVisualContext } from './types'

export function InfoVariant({ context, palette }: { context: DocumentaryCardVisualContext; palette: CardPalette }) {
  const content = context.content as DocumentaryCardInfoContent
  const titleSize = context.canvas.height >= 1800 ? 74 : 68
  const cardSize = context.canvas.height >= 1800 ? 210 : 190
  const ink = palette.ink
  const cardStyle: CSSProperties = { color: ink, fontFamily: context.tokens.typography.body.family, padding: 24, position: 'relative' }

  return (
    <>
      <div style={{ background: `linear-gradient(145deg, ${palette.paper}, ${palette.background})`, inset: 0, position: 'absolute' }} />
      <div style={{ border: `1px solid ${palette.paperAlt}88`, inset: '3%', position: 'absolute' }} />
      <Botanical color={palette.accent} style={{ height: '30%', left: '-1%', opacity: .5, position: 'absolute', top: '7%', width: '16%' }} />
      <Botanical color={palette.accent} style={{ bottom: '8%', height: '25%', opacity: .4, position: 'absolute', right: '2%', transform: 'scaleX(-1)', width: '14%' }} />
      <PaperPlane color={palette.paperAlt} rotation={-2.2} style={{ left: '7%', padding: '3% 4%', position: 'absolute', top: '16%', width: '81%' }}>
        <div style={{ color: ink, fontFamily: context.tokens.typography.display.family, fontSize: titleSize, fontWeight: context.tokens.typography.display.weight, letterSpacing: '-.035em', lineHeight: .96, maxWidth: '92%', textTransform: 'uppercase' }}>{content.title}</div>
      </PaperPlane>
      <div style={{ color: ink, fontFamily: context.tokens.typography.body.family, fontSize: context.canvas.height >= 1800 ? 30 : 27, left: '9%', lineHeight: 1.28, maxWidth: '51%', opacity: context.contentOpacity, position: 'absolute', top: '38%', transform: `translateY(${context.contentTranslateY}px)` }}>{content.intro}</div>
      <div style={{ color: ink, fontFamily: context.tokens.typography.body.family, fontSize: context.canvas.height >= 1800 ? 24 : 22, left: '9%', lineHeight: 1.35, maxWidth: '49%', opacity: context.contentOpacity, position: 'absolute', top: '50%' }}>{content.body_blocks.map((block, index) => <p key={index} style={{ margin: index ? '18px 0 0' : 0 }}>{block}</p>)}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22, position: 'absolute', right: '7%', top: '46%', width: '34%' }}>
        {content.fact_cards.map((fact, index) => (
          <PaperPlane key={`${fact.primary}-${index}`} color={index === 0 ? palette.paperAlt : palette.foreground} rotation={index === 0 ? 2.3 : -2.1} style={{ minHeight: cardSize, ...cardStyle }}>
            <div style={{ color: index === 0 ? ink : palette.background, fontFamily: context.tokens.typography.display.family, fontSize: context.canvas.height >= 1800 ? 48 : 42, fontWeight: context.tokens.typography.display.weight }}>{fact.primary}</div>
            <div style={{ color: index === 0 ? ink : palette.background, fontSize: 19, lineHeight: 1.25, marginTop: 12 }}>{fact.secondary}</div>
            <div style={{ color: index === 0 ? ink : palette.background, fontSize: 17, marginTop: 10 }}>{fact.tertiary}</div>
            <Tape color={palette.paper} rotation={index === 0 ? -7 : 6} style={{ position: 'absolute', right: 18, top: -12 }} />
          </PaperPlane>
        ))}
      </div>
      <div style={{ color: ink, fontFamily: context.tokens.typography.body.family, fontSize: 18, fontStyle: 'italic', left: '9%', maxWidth: '46%', opacity: context.contentOpacity, position: 'absolute', top: '82%' }}>{content.source_line}</div>
      <div style={{ color: palette.muted, fontFamily: context.tokens.typography.body.family, fontSize: 18, fontStyle: 'italic', maxWidth: '30%', opacity: context.contentOpacity, position: 'absolute', right: '8%', textAlign: 'right', top: '85%' }}>{content.annotation}</div>
      <SequenceMarker color={palette.accent} ink={ink} index={context.sequence?.index} total={context.sequence?.total} style={{ left: '8%', position: 'absolute', top: '6%' }} />
      <BrandMark asset={context.assets.logo} palette={palette} tokens={context.tokens} style={{ bottom: '5%', left: '8%', opacity: context.contentOpacity, position: 'absolute' }} />
    </>
  )
}
