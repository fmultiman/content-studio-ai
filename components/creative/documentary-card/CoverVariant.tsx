import type { CSSProperties } from 'react'
import type { DocumentaryCardCoverContent } from '@/lib/schemas/creative/documentary-card'
import { AssetSurface, Botanical, BrandMark, NetworkLines, PaperPlane, SequenceMarker, Tape, type CardPalette } from './primitives'
import type { DocumentaryCardVisualContext } from './types'

export function CoverVariant({ context, palette }: { context: DocumentaryCardVisualContext; palette: CardPalette }) {
  const content = context.content as DocumentaryCardCoverContent
  const titleSize = context.canvas.height >= 1800 ? 78 : 72
  const isDark = palette.background.toLowerCase() === '#0b1020'
  const mutedInk = isDark ? '#f3ead8' : palette.ink
  const heroScale = context.mode === 'video' && context.motion?.preset === 'slow_push' ? 1 + (context.progress * 0.06) : 1

  return (
    <>
      <div style={{ background: `linear-gradient(160deg, ${palette.background}, ${isDark ? '#102b2b' : '#f7efdf'})`, inset: 0, position: 'absolute' }} />
      <NetworkLines color={palette.accent} style={{ height: '22%', opacity: .52, position: 'absolute', right: '-3%', top: '4%', width: '43%' }} />
      <Botanical color={palette.accent} style={{ bottom: '4%', height: '25%', opacity: .6, position: 'absolute', right: '2%', width: '14%' }} />
      <Botanical color={palette.accent} style={{ bottom: '16%', height: '19%', opacity: .4, position: 'absolute', left: '0%', transform: 'scaleX(-1)', width: '12%' }} />
      <PaperPlane color={palette.paper} rotation={-1.2} style={{ left: '5%', minHeight: context.canvas.height >= 1800 ? '27%' : '26%', padding: '3% 4%', position: 'absolute', top: '26%', width: '57%' }}>
        <div style={{ color: palette.ink, fontFamily: context.tokens.typography.display.family, fontSize: titleSize, fontWeight: context.tokens.typography.display.weight, letterSpacing: '-.035em', lineHeight: .95, maxWidth: '100%', textTransform: 'uppercase' }}>{content.title}</div>
      </PaperPlane>
      <div style={{ color: mutedInk, fontFamily: context.tokens.typography.label?.family ?? context.tokens.typography.body.family, fontSize: 25, fontWeight: 700, letterSpacing: '.14em', left: '7%', opacity: context.contentOpacity, position: 'absolute', textTransform: 'uppercase', top: '20%' }}>{content.eyebrow}</div>
      <div style={{ color: mutedInk, fontFamily: context.tokens.typography.body.family, fontSize: context.canvas.height >= 1800 ? 32 : 29, left: '7%', lineHeight: 1.24, maxWidth: '48%', opacity: context.contentOpacity, position: 'absolute', top: '60%', transform: `translateY(${context.contentTranslateY}px)` }}>{content.subtitle}</div>
      <div style={{ color: mutedInk, fontFamily: context.tokens.typography.body.family, fontSize: 20, fontStyle: 'italic', left: '7%', opacity: context.contentOpacity, position: 'absolute', top: '76%' }}>{content.source_line}</div>
      <div style={{ borderLeft: `2px solid ${palette.accent}`, color: mutedInk, fontFamily: context.tokens.typography.body.family, fontSize: 18, left: '7%', lineHeight: 1.25, maxWidth: '34%', opacity: context.contentOpacity, paddingLeft: 14, position: 'absolute', top: '82%' }}>{content.detail_note}</div>
      <PaperPlane color={palette.paperAlt} rotation={3.1} style={{ bottom: '12%', height: '29%', padding: 26, position: 'absolute', right: '7%', width: '39%' }}>
        <AssetSurface asset={context.assets.hero} label="Documentary hero evidence" style={{ backgroundBlendMode: 'multiply', backgroundColor: palette.paper, height: '100%', inset: 0, opacity: .94, position: 'absolute', transform: `scale(${heroScale})`, transformOrigin: context.assets.hero?.focal_point ? `${context.assets.hero.focal_point.x * 100}% ${context.assets.hero.focal_point.y * 100}%` : 'center' }} />
        <Tape color={palette.paperAlt} rotation={-9} style={{ left: '28%', position: 'absolute', top: -14 }} />
      </PaperPlane>
      <SequenceMarker color={palette.accent} ink={mutedInk} index={context.sequence?.index} total={context.sequence?.total} style={{ left: '7%', position: 'absolute', top: '7%' }} />
      <BrandMark asset={context.assets.logo} palette={palette} tokens={context.tokens} style={{ bottom: '4%', left: '7%', opacity: context.contentOpacity, position: 'absolute' }} />
    </>
  )
}
