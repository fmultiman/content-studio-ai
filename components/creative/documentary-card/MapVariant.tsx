import type { DocumentaryCardMapContent } from '@/lib/schemas/creative/documentary-card'
import { AssetLayer, AssetTextLayer, materialMetrics, type CardPalette } from './primitives'
import { BRAZIL_UF_GEOMETRY, BRAZIL_UF_VIEWBOX, type BrazilUf } from './brazil-uf-geometry'
import { ElementGroup, LayoutBackground, SequenceBadge, TitleOnStrip, layoutKit } from './layout-kit'
import { renderEmphasis } from './ListVariant'
import type { DocumentaryCardVisualContext } from './types'

/** Pin inks, cycled per place (Pack A's legend palette). */
export const MAP_PIN_COLORS = ['#23382c', '#8a8f5a', '#b8923f', '#a86a4a', '#c9a58a', '#c49a2c', '#2f5a3c', '#5e6b2a', '#9c5b3b', '#6b3a22', '#7c8a6a', '#b07a4f'] as const

/** Offsets (map px) for the 2nd, 3rd… place in the same UF, so pins never stack exactly. */
const SAME_UF_OFFSETS: readonly (readonly [number, number])[] = [[0, 0], [16, -12], [-15, 13], [18, 16], [-17, -14], [2, 22]]

const [VB_X, VB_Y, VB_W, VB_H] = BRAZIL_UF_VIEWBOX.split(' ').map(Number)

/** Map-box pixel position of a place: its UF centroid (a state-level position, never an exact location). */
export function projectUf(uf: BrazilUf, size: number, nth = 0): { left: number; top: number } {
  const [lon, lat] = BRAZIL_UF_GEOMETRY[uf].center
  const [dx, dy] = SAME_UF_OFFSETS[nth % SAME_UF_OFFSETS.length]
  return { left: ((lon - VB_X) / VB_W) * size + dx, top: ((-lat - VB_Y) / VB_H) * size + dy }
}

/**
 * Editorial Documentary Collage · layout "map" (Mapa) — Portal Carousel
 * Completion V1, Pack A Slide 7: places pinned by federative unit on a
 * code-drawn Brazil map (IBGE UF geometry, "Mapa do Brasil" element), a
 * legend (template text) and a note on a paper scrap.
 */
export function MapVariant({ context }: { context: DocumentaryCardVisualContext; palette: CardPalette }) {
  const content = context.content as DocumentaryCardMapContent
  const kit = layoutKit(context)
  const { x, y, isDark, ink, muted, paperInk, body, transforms } = kit
  const places = content.places ?? []
  const mapSize = 630
  const seen = new Map<string, number>()
  const pins = places.map((place, index) => {
    const nth = seen.get(place.uf) ?? 0
    seen.set(place.uf, nth + 1)
    return { ...place, color: MAP_PIN_COLORS[index % MAP_PIN_COLORS.length], ...projectUf(place.uf as BrazilUf, mapSize, nth) }
  })

  return (
    <>
      <LayoutBackground kit={kit} stars={[[1020, 560, 10], [620, 1250, 12]]} />

      <AssetLayer label="Ramo de folhas" url={kit.url('botanicalLeaf')} metrics={materialMetrics('botanicalLeaf')} contain={context.materialContain?.botanicalLeaf} box={{ left: x(880), top: y(1080), width: x(260) }} rotation={-18} transform={transforms?.botanicalLeaf} zIndex={kit.z('botanicalLeaf', 11)} hidden={kit.hidden('botanicalLeaf')} />

      <ElementGroup id="map" label="Mapa do Brasil" kit={kit} transformKey="card1" zFallback={12}>
        <div style={{ height: x(mapSize), left: x(24), position: 'absolute', top: y(580), width: x(mapSize) }}>
          <svg aria-label="Mapa do Brasil por UF" role="img" viewBox={BRAZIL_UF_VIEWBOX} width="100%" height="100%" style={{ filter: 'drop-shadow(0 10px 14px rgba(60,40,10,.25))', overflow: 'visible' }}>
            <g transform="scale(0.0001,-0.0001)">
              {Object.entries(BRAZIL_UF_GEOMETRY).map(([uf, geometry]) => (
                <path key={uf} d={geometry.d} fill={isDark ? '#e9ddc6' : '#f3ead6'} stroke={isDark ? '#9c8a66' : '#bca77f'} strokeWidth={1.1} vectorEffect="non-scaling-stroke" />
              ))}
            </g>
          </svg>
          <div style={{ bottom: x(-6), color: muted, fontFamily: body, fontSize: x(15), fontStyle: 'italic', position: 'absolute', right: x(20) }}>Base cartográfica: IBGE</div>
        </div>
      </ElementGroup>

      {/* Pinos dos lugares (procedural): the UF markers share the map's box and transform channel, and are their own Element. */}
      <ElementGroup id="mapPins" label="Pinos dos lugares" kit={kit} transformKey="card1" zFallback={12}>
        <div style={{ height: x(mapSize), left: x(24), position: 'absolute', top: y(580), width: x(mapSize) }}>
          {pins.map((pin, index) => (
            <div key={index} aria-hidden="true" style={{ background: pin.color, border: `${x(2.5)}px solid #fbf5e8`, borderRadius: '50%', boxShadow: '0 2px 4px rgba(0,0,0,.35)', height: x(20), left: x(pin.left - 10), position: 'absolute', top: x(pin.top - 10), width: x(20) }} />
          ))}
        </div>
      </ElementGroup>

      <AssetLayer label="Botânica seca" url={kit.url('botanical')} metrics={materialMetrics('botanical')} contain={context.materialContain?.botanical} box={{ left: x(968), top: y(340), width: x(112) }} rotation={12} transform={transforms?.botanical} zIndex={kit.z('botanical', 13)} hidden={kit.hidden('botanical')} />

      {/* Nota do mapa: the disclaimer on a paper scrap. */}
      {content.note ? (
        <>
          <AssetLayer label="Nota do mapa" url={kit.url('paperScrap')} metrics={materialMetrics('paperScrap')} contain={context.materialContain?.paperScrap} box={{ left: x(40), top: y(1106), width: x(450), height: y(210) }} rotation={-2.5} transform={transforms?.note} zIndex={kit.z('note', 14)} hidden={kit.hidden('note')} shadow />
          <AssetTextLayer label="Texto da nota do mapa" metrics={materialMetrics('paperScrap')} box={{ left: x(40), top: y(1106), width: x(450), height: y(210) }} rotation={-2.5} transform={transforms?.note} zIndex={kit.z('noteText', 14)} hidden={kit.hidden('noteText')}>
            <div style={{ alignItems: 'center', color: paperInk, display: 'flex', fontFamily: body, fontSize: x(25), inset: 0, justifyContent: 'center', lineHeight: 1.3, padding: `0 ${x(46)}px`, position: 'absolute', textAlign: 'center' }}>{content.note}</div>
          </AssetTextLayer>
          <AssetLayer label="Fita da nota" url={kit.url('tape')} metrics={materialMetrics('tape')} contain={context.materialContain?.tape} box={{ left: x(190), top: y(1088), width: x(130) }} rotation={4} transform={transforms?.tape1 ?? transforms?.tape} zIndex={kit.z('tape1', 15)} hidden={kit.hidden('tape1')} filter="saturate(.85)" />
        </>
      ) : null}

      <TitleOnStrip context={context} kit={kit} title={content.title} fontSize={58} />

      {/* Template text (fixed layer): badge, intro, legend. */}
      <SequenceBadge context={context} kit={kit} />
      {content.intro ? (
        <div style={{ ...kit.fixedAtom('intro'), color: ink, fontFamily: body, fontSize: x(30), left: x(70), lineHeight: 1.36, top: y(426), width: x(920) }}>{renderEmphasis(content.intro)}</div>
      ) : null}
      <div style={{ ...kit.fixedAtom('legend'), display: kit.hidden('legend') ? 'none' : 'flex', flexDirection: 'column', gap: y(12), left: x(690), top: y(600), width: x(370) }} data-map-places={places.length}>
        {pins.map((pin, index) => (
          <div key={index} style={{ alignItems: 'center', color: ink, display: 'flex', fontFamily: body, fontSize: x(26), gap: x(16), lineHeight: 1.2 }}>
            <span aria-hidden="true" style={{ background: pin.color, borderRadius: '50%', flexShrink: 0, height: x(18), width: x(18) }} />
            <span>{pin.name} ({pin.uf})</span>
          </div>
        ))}
        {content.places_more ? (
          <div style={{ alignItems: 'center', color: ink, display: 'flex', fontFamily: body, fontSize: x(26), gap: x(16) }}>
            <span aria-hidden="true" style={{ background: '#cdb994', borderRadius: '50%', flexShrink: 0, height: x(18), width: x(18) }} />
            <span>{content.places_more}</span>
          </div>
        ) : null}
      </div>
    </>
  )
}
