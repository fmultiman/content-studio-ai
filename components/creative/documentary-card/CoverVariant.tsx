import type { CSSProperties } from 'react'
import type { DocumentaryCardCoverContent } from '@/lib/schemas/creative/documentary-card'
import { AssetSurface, Botanical, BrandMark, GrainOverlay, MaterialTape, NetworkLines, PaperPlane, Pin, SequenceMarker, type CardPalette } from './primitives'
import type { DocumentaryCardVisualContext } from './types'

export function CoverVariant({ context, palette }: { context: DocumentaryCardVisualContext; palette: CardPalette }) {
  const content = context.content as DocumentaryCardCoverContent
  const reel = context.canvas.height >= 1800
  const titleSize = reel ? 82 : 76
  // Slice 1 — Portal Carousel V1: appearance is an explicit authoring input,
  // not inferred from a magic background-hex match against the palette.
  const isDark = context.resolvedAppearance === 'dark'
  const mutedInk = isDark ? '#f3ead8' : palette.ink
  const heroScale = context.mode === 'video' && context.motion?.preset === 'slow_push' ? 1 + (context.progress * 0.06) : 1

  // Preview tuning (Wave 6 authoring-only; absent = no change from default)
  const heroTuning = context.previewTuning?.hero
  const titleTuning = context.previewTuning?.title

  const baseHeroStyle: CSSProperties = reel
    ? { height: '35%', right: '10%', top: '47%', width: '67%' }
    : { bottom: '10%', height: '35%', right: '7%', width: '43%' }
  const heroStyle: CSSProperties = heroTuning
    ? {
        ...baseHeroStyle,
        transform: `translate(${heroTuning.offsetX}px, ${heroTuning.offsetY}px) rotate(${heroTuning.rotation}deg) scale(${heroTuning.scale})`,
        transformOrigin: 'center',
      }
    : baseHeroStyle

  const baseTitleStyle: CSSProperties = reel
    ? { left: '7%', minHeight: '20%', padding: '3% 4%', top: '19%', width: '70%' }
    : { left: '4%', minHeight: '27%', padding: '3% 4%', top: '25%', width: '61%' }
  const titleStyle: CSSProperties = titleTuning
    ? {
        ...baseTitleStyle,
        transform: `translate(${titleTuning.offsetX}px, ${titleTuning.offsetY}px) rotate(${titleTuning.rotation}deg)`,
        transformOrigin: 'top left',
      }
    : baseTitleStyle

  return (
    <>
      <div style={{ background: `linear-gradient(160deg, ${palette.background}, ${isDark ? '#102b2b' : '#f7efdf'})`, inset: 0, position: 'absolute' }} />
      <GrainOverlay color={isDark ? '#f0d9a8' : palette.ink} style={{ inset: 0, position: 'absolute' }} />
      <NetworkLines color={palette.accent} style={{ height: reel ? '18%' : '22%', opacity: .52, position: 'absolute', right: '-3%', top: '4%', width: reel ? '51%' : '43%' }} />
      <Botanical baseUrl={context.materialBaseUrl} urls={context.materialUrls} primitiveTransform={context.primitiveTransforms?.botanical} style={{ bottom: reel ? '4%' : '3%', height: reel ? '30%' : '35%', opacity: 1, position: 'absolute', right: '2%', width: reel ? '26%' : '24%' }} />
      <Botanical baseUrl={context.materialBaseUrl} urls={context.materialUrls} primitiveTransform={context.primitiveTransforms?.botanical} style={{ bottom: reel ? '18%' : '16%', height: reel ? '24%' : '29%', opacity: .8, position: 'absolute', left: '-2%', transform: 'scaleX(-1) rotate(-15deg)', width: '22%' }} />
      <PaperPlane color={palette.paperAlt} rotation={1.8} material="tornPaper" materialBaseUrl={context.materialBaseUrl} materialUrls={context.materialUrls} primitiveTransform={context.primitiveTransforms?.paper} style={{ left: reel ? '10%' : '8%', opacity: .78, position: 'absolute', top: reel ? '23%' : '28%', width: reel ? '58%' : '47%', zIndex: 15 }} />
      <PaperPlane color={palette.paper} rotation={reel ? -1.8 : -1.2} material="paperStrip" materialBaseUrl={context.materialBaseUrl} materialUrls={context.materialUrls} primitiveTransform={context.primitiveTransforms?.paperStrip} style={{ ...titleStyle, position: 'absolute', zIndex: 20 }}>
        <div style={{ color: palette.ink, fontFamily: context.tokens.typography.display.family, fontSize: titleSize, fontWeight: context.tokens.typography.display.weight, letterSpacing: '-.04em', lineHeight: .93, maxWidth: '100%', textTransform: 'uppercase' }}>{content.title}</div>
      </PaperPlane>
      <div style={{ color: mutedInk, fontFamily: context.tokens.typography.label?.family ?? context.tokens.typography.body.family, fontSize: 25, fontWeight: 700, letterSpacing: '.14em', left: '7%', opacity: context.contentOpacity, position: 'absolute', textTransform: 'uppercase', top: reel ? '13%' : '20%', zIndex: 25 }}>{content.eyebrow}</div>
      <div style={{ color: mutedInk, fontFamily: context.tokens.typography.body.family, fontSize: reel ? 31 : 29, left: '7%', lineHeight: 1.24, maxWidth: reel ? '68%' : '44%', opacity: context.contentOpacity, position: 'absolute', top: reel ? '40%' : '60%', transform: `translateY(${context.contentTranslateY}px)`, zIndex: 25 }}>{content.subtitle}</div>
      <PaperPlane color={palette.paperAlt} rotation={reel ? 2.2 : 3.1} material="tornPaper" materialBaseUrl={context.materialBaseUrl} materialUrls={context.materialUrls} primitiveTransform={context.primitiveTransforms?.paper} style={{ ...heroStyle, padding: reel ? 28 : 26, position: 'absolute', zIndex: 30 }}>
        <AssetSurface asset={context.assets.hero} label="Documentary hero evidence fixture" style={{ backgroundColor: palette.paper, backgroundSize: context.assets.hero?.fit === 'contain' ? 'contain' : 'cover', border: `1px solid ${palette.ink}55`, height: '100%', inset: 0, opacity: .98, position: 'absolute', transform: `scale(${heroScale})`, transformOrigin: context.assets.hero?.focal_point ? `${context.assets.hero.focal_point.x * 100}% ${context.assets.hero.focal_point.y * 100}%` : 'center', filter: 'saturate(.88) contrast(1.05)' }} />
        <MaterialTape color={palette.paper} rotation={-9} baseUrl={context.materialBaseUrl} urls={context.materialUrls} primitiveTransform={context.primitiveTransforms?.tape} style={{ left: '50%', transform: 'translateX(-50%)', position: 'absolute', top: -22, zIndex: 2 }} />
        <Pin baseUrl={context.materialBaseUrl} urls={context.materialUrls} primitiveTransform={context.primitiveTransforms?.pin} style={{ position: 'absolute', right: 28, top: 22, zIndex: 3 }} />
      </PaperPlane>
      <div style={{ color: mutedInk, fontFamily: context.tokens.typography.body.family, fontSize: reel ? 21 : 20, fontStyle: 'italic', left: '7%', opacity: context.contentOpacity, position: 'absolute', top: reel ? '84%' : '76%', zIndex: 35 }}>{content.source_line}</div>
      <div style={{ borderLeft: `2px solid ${palette.accent}`, color: mutedInk, fontFamily: context.tokens.typography.body.family, fontSize: reel ? 19 : 18, left: '7%', lineHeight: 1.25, maxWidth: reel ? '52%' : '34%', opacity: context.contentOpacity, paddingLeft: 14, position: 'absolute', top: reel ? '88%' : '82%', zIndex: 35 }}>{content.detail_note}</div>
      <SequenceMarker color={palette.accent} ink={mutedInk} index={context.sequence?.index} total={context.sequence?.total} style={{ left: '7%', position: 'absolute', top: '7%', zIndex: 60 }} />
      <BrandMark asset={context.assets.logo} palette={palette} tokens={context.tokens} style={{ bottom: reel ? '3%' : '4%', left: '7%', opacity: context.contentOpacity, position: 'absolute', zIndex: 60 }} />
    </>
  )
}
