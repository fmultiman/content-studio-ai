import type { DocumentaryCardNetworkContent } from '@/lib/schemas/creative/documentary-card'
import { AssetLayer, AssetTextLayer, materialMetrics, type CardPalette } from './primitives'
import { DocumentaryIcon } from './icons'
import { ElementGroup, LayoutBackground, SequenceBadge, TitleOnStrip, layoutKit } from './layout-kit'
import { renderEmphasis } from './ListVariant'
import type { DocumentaryCardVisualContext } from './types'

/** Cards per row for 3..9 nodes (Pack A Slide 8 uses 3 / 2 / 4 for nine). */
export function networkRows(count: number): number[] {
  const patterns: Record<number, number[]> = { 3: [3], 4: [2, 2], 5: [3, 2], 6: [3, 3], 7: [3, 4], 8: [3, 2, 3], 9: [3, 2, 4] }
  return patterns[count] ?? [count]
}

type CardBox = { left: number; top: number; width: number; height: number; row: number }

/** Card boxes (reference px) for the network area [60..1020] × [top..top+h]. */
export function networkLayout(count: number, top: number, bottom: number): CardBox[] {
  const rows = networkRows(count)
  const gap = 24
  const rowGap = 30
  const height = Math.min(128, (bottom - top - rowGap * (rows.length - 1)) / rows.length)
  const boxes: CardBox[] = []
  rows.forEach((perRow, row) => {
    const width = Math.min(300, (960 - gap * (perRow - 1)) / perRow)
    const rowWidth = width * perRow + gap * (perRow - 1)
    const start = 60 + (960 - rowWidth) / 2
    for (let col = 0; col < perRow; col += 1) boxes.push({ left: start + col * (width + gap), top: top + row * (height + rowGap), width, height, row })
  })
  return boxes
}

/** Links: neighbours in a row + each card to the nearest cards of the next row. */
export function networkLinks(boxes: readonly CardBox[]): [number, number][] {
  const links: [number, number][] = []
  const center = (box: CardBox) => box.left + box.width / 2
  boxes.forEach((box, index) => {
    const next = boxes[index + 1]
    if (next && next.row === box.row) links.push([index, index + 1])
    const below = boxes.map((candidate, candidateIndex) => ({ candidate, candidateIndex })).filter(({ candidate }) => candidate.row === box.row + 1)
    below
      .filter(({ candidate }) => Math.abs(center(candidate) - center(box)) < Math.max(box.width, candidate.width) * 0.95)
      .forEach(({ candidateIndex }) => links.push([index, candidateIndex]))
  })
  return links
}

/**
 * Editorial Documentary Collage · layout "network" (Rede) — Portal Carousel
 * Completion V1, Pack A Slide 8: linked paper cards ("Cartões da rede", one
 * authored element) and an optional icon-led callout with bullets on dark
 * paper ("Caixa de destaque").
 */
export function NetworkVariant({ context }: { context: DocumentaryCardVisualContext; palette: CardPalette }) {
  const content = context.content as DocumentaryCardNetworkContent
  const kit = layoutKit(context)
  const { x, y, isDark, ink, gold, paperInk, body, display, transforms } = kit
  const nodes = content.nodes ?? []
  const callout = content.callout
  const areaTop = content.intro ? 612 : 520
  const areaBottom = callout ? 1024 : 1260
  const boxes = networkLayout(nodes.length, areaTop, areaBottom)
  const links = networkLinks(boxes)
  const bullets = callout?.bullets ?? []

  return (
    <>
      <LayoutBackground kit={kit} stars={[[640, 40, 14], [1040, 470, 10], [30, 590, 12]]} />

      <AssetLayer label="Ornamento celeste" url={kit.url('ornament')} metrics={materialMetrics('ornament')} contain={context.materialContain?.ornament} box={{ left: x(720), top: y(-40), width: x(400) }} transform={transforms?.ornament} zIndex={kit.z('ornament', 11)} hidden={kit.hidden('ornament')} filter={isDark ? undefined : 'brightness(.7)'} />

      {/* Conexões da rede (procedural): the dashed links share the cards' transform channel and are their own Element, under the cards. */}
      <ElementGroup id="links" label="Conexões da rede" kit={kit} transformKey="card1" zFallback={12}>
        <svg aria-hidden="true" width={x(1080)} height={y(1350)} viewBox="0 0 1080 1350" preserveAspectRatio="none" style={{ inset: 0, position: 'absolute' }}>
          {links.map(([from, to]) => {
            const a = boxes[from]; const b = boxes[to]
            const sameRow = a.row === b.row
            const x1 = sameRow ? a.left + a.width : a.left + a.width / 2
            const y1 = sameRow ? a.top + a.height / 2 : a.top + a.height
            const x2 = sameRow ? b.left : b.left + b.width / 2
            const y2 = sameRow ? b.top + b.height / 2 : b.top
            return (
              <g key={`${from}-${to}`}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={gold} strokeWidth={2} strokeDasharray="4 6" opacity={0.85} />
                <circle cx={(x1 + x2) / 2} cy={(y1 + y2) / 2} r={5} fill={gold} />
              </g>
            )
          })}
        </svg>
      </ElementGroup>

      {/* Cartões da rede (the papers) + Textos dos cartões (their text): two Elements sharing the same card boxes and group transform. */}
      <ElementGroup id="cards" label="Cartões da rede" kit={kit} transformKey="card1" zFallback={12}>
        {nodes.map((node, index) => {
          const box = boxes[index]
          return (
            <AssetLayer key={index} url={kit.url('paperScrap')} metrics={materialMetrics('paperScrap')} contain={context.materialContain?.paperScrap} box={{ left: x(box.left), top: y(box.top), width: x(box.width), height: y(box.height) }} rotation={index % 2 === 0 ? -1.2 : 1} shadow />
          )
        })}
      </ElementGroup>
      <ElementGroup id="cardsText" label="Textos dos cartões" kit={kit} transformKey="card1" zFallback={12}>
        {nodes.map((node, index) => {
          const box = boxes[index]
          return (
            <AssetTextLayer key={index} metrics={materialMetrics('paperScrap')} box={{ left: x(box.left), top: y(box.top), width: x(box.width), height: y(box.height) }} rotation={index % 2 === 0 ? -1.2 : 1}>
              <div style={{ alignItems: 'center', color: paperInk, display: 'flex', flexDirection: 'column', inset: 0, justifyContent: 'center', padding: `0 ${x(18)}px`, position: 'absolute', textAlign: 'center' }}>
                <div style={{ fontFamily: display.family, fontSize: x(node.title.length > 22 ? 21 : 24), fontWeight: display.weight, lineHeight: 1.12, textTransform: 'uppercase' }}>{node.title}</div>
                {node.subtitle ? <div style={{ fontFamily: body, fontSize: x(17), lineHeight: 1.2, marginTop: y(4) }}>{node.subtitle}</div> : null}
              </div>
            </AssetTextLayer>
          )
        })}
      </ElementGroup>

      {/* Caixa de destaque: icon + text + bullets on dark paper. */}
      {callout ? (
        <>
        <AssetLayer label="Caixa de destaque" url={kit.url('paperDark')} metrics={materialMetrics('paperDark')} contain={context.materialContain?.paperDark} box={{ left: x(40), top: y(1040), width: x(1000), height: y(292) }} rotation={-0.4} transform={transforms?.paperDark} zIndex={kit.z('callout', 13)} hidden={kit.hidden('callout')} shadow />
        <AssetTextLayer label="Texto do destaque" metrics={materialMetrics('paperDark')} box={{ left: x(40), top: y(1040), width: x(1000), height: y(292) }} rotation={-0.4} transform={transforms?.paperDark} zIndex={kit.z('calloutText', 13)} hidden={kit.hidden('calloutText')}>
          <div style={{ color: '#efe4cc', display: 'flex', flexDirection: 'column', gap: y(16), inset: 0, justifyContent: 'center', padding: `0 ${x(56)}px`, position: 'absolute' }}>
            <div style={{ alignItems: 'center', display: 'flex', gap: x(28) }}>
              <DocumentaryIcon icon={callout.icon} color="#c9a45c" size={x(88)} strokeWidth={2} />
              <div style={{ fontFamily: body, fontSize: x(25), lineHeight: 1.34 }}>{renderEmphasis(callout.text)}</div>
            </div>
            {bullets.length > 0 ? (
              <div style={{ display: 'grid', fontFamily: body, fontSize: x(22), gap: `${y(8)}px ${x(20)}px`, gridTemplateColumns: 'repeat(3, 1fr)', paddingLeft: x(8) }}>
                {bullets.map((bullet, index) => (
                  <div key={index} style={{ alignItems: 'center', display: 'flex', gap: x(12) }}>
                    <span aria-hidden="true" style={{ background: '#c9a45c', borderRadius: '50%', flexShrink: 0, height: x(8), width: x(8) }} />
                    <span>{bullet}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </AssetTextLayer>
        </>
      ) : null}

      <TitleOnStrip context={context} kit={kit} title={content.title} fontSize={62} />

      {/* Template text (fixed layer). */}
      <SequenceBadge context={context} kit={kit} />
      {content.kicker ? (
        <div style={{ ...kit.fixedAtom('kicker'), color: gold, fontFamily: body, fontSize: x(27), fontWeight: 700, left: x(70), letterSpacing: '.04em', top: y(424), textTransform: 'uppercase', ...kit.localType('kicker'), ...kit.placed('kicker') }}>{content.kicker}</div>
      ) : null}
      {content.intro ? (
        <div style={{ ...kit.fixedAtom('intro'), color: ink, fontFamily: body, fontSize: x(28), left: x(70), lineHeight: 1.34, top: y(content.kicker ? 468 : 430), width: x(920), ...kit.localType('intro'), ...kit.placed('intro') }}>{renderEmphasis(content.intro)}</div>
      ) : null}
    </>
  )
}
