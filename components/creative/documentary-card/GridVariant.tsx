import type { DocumentaryCardGridContent } from '@/lib/schemas/creative/documentary-card'
import { AssetLayer, AssetTextLayer, materialMetrics, type CardPalette } from './primitives'
import { DocumentaryIcon } from './icons'
import { ElementGroup, LayoutBackground, SequenceBadge, TitleOnStrip, layoutKit } from './layout-kit'
import { renderEmphasis } from './ListVariant'
import type { DocumentaryCardVisualContext } from './types'

/** Columns per tile count: 2–3 in one row, 4 as 2×2, 5–6 as 3 + rest. */
export function gridColumns(count: number): number {
  return count <= 3 ? count : count === 4 ? 2 : 3
}

/**
 * Editorial Documentary Collage · layout "grid" (Grade) — Portal Carousel
 * Completion V1, Pack A Slide 6: a typology of icon medallions ("Grade de
 * temas", one authored element) and an optional band of cross-cutting ideas
 * on a paper scrap ("Papel das ideias").
 */
export function GridVariant({ context }: { context: DocumentaryCardVisualContext; palette: CardPalette }) {
  const content = context.content as DocumentaryCardGridContent
  const kit = layoutKit(context)
  const { x, y, isDark, ink, gold, green, paperInk, body, transforms } = kit
  const tiles = content.tiles ?? []
  const ideas = content.ideas ?? []
  const hasIdeas = ideas.length > 0 || Boolean(content.ideas_title)
  const columns = gridColumns(tiles.length)
  const rows = Math.ceil(tiles.length / Math.max(columns, 1))
  const cellWidth = 960 / Math.max(columns, 1)
  const areaTop = content.intro ? 560 : 470
  const rowHeight = hasIdeas ? 230 : 280

  return (
    <>
      <LayoutBackground kit={kit} stars={[[1030, 520, 10], [40, 1030, 12]]} />

      {/* Authored elements — painted from the normalized stack. */}
      <AssetLayer label="Fragmento de arquivo" url={kit.url('archival')} metrics={materialMetrics('archival')} contain={context.materialContain?.archival} box={{ left: x(760), top: y(1190), width: x(360) }} rotation={6} transform={transforms?.archival} zIndex={kit.z('archival', 11)} hidden={kit.hidden('archival')} filter="sepia(.35)" shadow />
      <AssetLayer label="Ramo de folhas" url={kit.url('botanicalLeaf')} metrics={materialMetrics('botanicalLeaf')} contain={context.materialContain?.botanicalLeaf} box={{ left: x(912), top: y(430), width: x(200) }} rotation={160} flipX transform={transforms?.botanicalLeaf} zIndex={kit.z('botanicalLeaf', 12)} hidden={kit.hidden('botanicalLeaf')} />

      <ElementGroup id="tiles" label="Grade de temas" kit={kit} transformKey="card1" zFallback={13}>
        {tiles.map((tile, index) => {
          const row = Math.floor(index / columns)
          const inRow = row === rows - 1 ? tiles.length - row * columns : columns
          const offset = (columns - inRow) * cellWidth / 2
          const cx = 60 + offset + cellWidth * (index % columns) + cellWidth / 2
          const cy = areaTop + rowHeight * row + 80
          return (
            <div key={index} style={{ alignItems: 'center', display: 'flex', flexDirection: 'column', left: x(cx - 150), position: 'absolute', top: y(cy - 80), width: x(300) }}>
              <div style={{ alignItems: 'center', background: isDark ? 'radial-gradient(circle at 40% 35%, #2a3d33 0%, #1c2b24 100%)' : 'radial-gradient(circle at 40% 35%, #f3e3bf 0%, #e3cc9c 100%)', border: `2px solid ${gold}`, borderRadius: '50%', boxShadow: '0 10px 22px rgba(0,0,0,.18)', display: 'flex', height: x(150), justifyContent: 'center', width: x(150) }}>
                <DocumentaryIcon icon={tile.icon} color={isDark ? '#d9c79b' : green} size={x(86)} strokeWidth={2} />
              </div>
              <div style={{ color: ink, fontFamily: body, fontSize: x(29), fontWeight: 600, lineHeight: 1.15, marginTop: y(12), textAlign: 'center' }}>{tile.label}</div>
            </div>
          )
        })}
      </ElementGroup>

      {/* Papel das ideias: the cross-cutting ideas on a wide paper scrap. */}
      {hasIdeas ? (
        <>
        <AssetLayer label="Papel das ideias" url={kit.url('paperScrap')} metrics={materialMetrics('paperScrap')} contain={context.materialContain?.paperScrap} box={{ left: x(34), top: y(1046), width: x(1012), height: y(280) }} rotation={-0.6} transform={transforms?.note} zIndex={kit.z('note', 14)} hidden={kit.hidden('note')} shadow />
        <AssetTextLayer label="Ideias transversais" metrics={materialMetrics('paperScrap')} box={{ left: x(34), top: y(1046), width: x(1012), height: y(280) }} rotation={-0.6} transform={transforms?.note} zIndex={kit.z('ideasText', 14)} hidden={kit.hidden('ideasText')}>
          <div style={{ color: paperInk, display: 'flex', flexDirection: 'column', inset: 0, justifyContent: 'center', padding: `0 ${x(36)}px`, position: 'absolute' }}>
            {content.ideas_title ? <div style={{ fontFamily: body, fontSize: x(27), fontWeight: 600, marginBottom: y(18), textAlign: 'center' }}>{content.ideas_title}</div> : null}
            <div style={{ display: 'flex', justifyContent: 'space-around' }}>
              {ideas.map((idea, index) => (
                <div key={index} style={{ alignItems: 'center', display: 'flex', flexDirection: 'column', gap: y(8), width: `${100 / Math.max(ideas.length, 1)}%` }}>
                  <DocumentaryIcon icon={idea.icon} color={green} size={x(56)} strokeWidth={2.2} />
                  <div style={{ fontFamily: body, fontSize: x(19), lineHeight: 1.2, textAlign: 'center' }}>{idea.label}</div>
                </div>
              ))}
            </div>
          </div>
        </AssetTextLayer>
        </>
      ) : null}

      <TitleOnStrip context={context} kit={kit} title={content.title} fontSize={58} />
      <AssetLayer label="Fita do título" url={kit.url('tape')} metrics={materialMetrics('tape')} contain={context.materialContain?.tape} box={{ left: x(64), top: y(140), width: x(140) }} rotation={-9} transform={transforms?.tape1 ?? transforms?.tape} zIndex={kit.z('tape1', 32)} hidden={kit.hidden('tape1')} filter="saturate(.85)" />

      {/* Template text (fixed layer). */}
      <SequenceBadge context={context} kit={kit} />
      {content.intro ? (
        <div style={{ ...kit.fixedAtom('intro'), color: ink, fontFamily: body, fontSize: x(31), left: x(70), lineHeight: 1.36, top: y(428), width: x(820), ...kit.localType('intro') }}>{renderEmphasis(content.intro)}</div>
      ) : null}
    </>
  )
}
