'use client'

/**
 * Creative Editor Video Foundation V1 — CENAS view (default authoring mode).
 *
 * The high-level Scene sequence: the legacy /videos Storyboard modal's
 * capabilities (thumbnail, number, duration, movement, description, click to
 * jump) converge here, next to navigation and "Adicionar cena". Same
 * VideoScene[] as the TIMELINE view; switching views copies nothing.
 */
import { ArrowLeft, ArrowRight, ImageIcon, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { VideoScene } from '@/lib/types'
import { formatSeconds, type SceneRange } from '@/lib/creative/video-editor/scene-timeline'
import { useFrameCursor, type FrameCursor } from '@/lib/creative/video-editor/frame-cursor'

type SceneStripProps = {
  scenes: readonly VideoScene[]
  ranges: readonly SceneRange[]
  cursor: FrameCursor
  selectedIndex: number
  thumbnails: Readonly<Record<string, string | undefined>>
  motionLabel: (movement: string | null) => string
  canAdd: boolean
  onSelect: (index: number) => void
  onAdd: () => void
}

export function SceneStrip({ scenes, ranges, cursor, selectedIndex, thumbnails, motionLabel, canAdd, onSelect, onAdd }: SceneStripProps) {
  return (
    <div className="flex min-w-0 items-stretch gap-2 px-3 py-2" data-testid="scene-strip">
      <div className="flex shrink-0 flex-col justify-center gap-1">
        <Button size="icon-sm" variant="outline" onClick={() => onSelect(Math.max(0, selectedIndex - 1))} disabled={selectedIndex <= 0} aria-label="Cena anterior"><ArrowLeft className="h-3.5 w-3.5" /></Button>
        <Button size="icon-sm" variant="outline" onClick={() => onSelect(Math.min(scenes.length - 1, selectedIndex + 1))} disabled={selectedIndex >= scenes.length - 1} aria-label="Próxima cena"><ArrowRight className="h-3.5 w-3.5" /></Button>
      </div>
      <ol className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1" aria-label="Cenas">
        {scenes.map((scene, index) => {
          const range = ranges[index]
          const selected = index === selectedIndex
          const thumb = thumbnails[scene.id]
          return (
            <li key={scene.id} className="shrink-0">
              <button
                type="button"
                onClick={() => onSelect(index)}
                aria-pressed={selected}
                aria-label={`Cena ${index + 1} de ${scenes.length}`}
                className={cn(
                  'group flex w-36 flex-col overflow-hidden rounded-md border bg-card text-left text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  selected ? 'border-primary ring-1 ring-primary' : 'border-border/60 hover:border-border',
                )}
                data-testid="scene-strip-card"
                data-scene-id={scene.id}
              >
                <div className="relative h-14 w-full bg-muted">
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element -- short-lived signed display URL
                    <img src={thumb} alt="" className="h-full w-full object-cover" draggable={false} />
                  ) : (
                    <div className="flex h-full items-center justify-center text-muted-foreground"><ImageIcon className="h-5 w-5" /></div>
                  )}
                  <span className="absolute left-1 top-1 rounded bg-black/70 px-1 font-medium text-white">Cena {index + 1}</span>
                  <span className="absolute right-1 top-1 rounded bg-black/70 px-1 tabular-nums text-white">{formatSeconds(scene.duration)}</span>
                  {range ? <SceneProgress cursor={cursor} range={range} /> : null}
                </div>
                <div className="space-y-0.5 px-1.5 py-1">
                  <p className="truncate text-muted-foreground">{motionLabel(scene.movement)}</p>
                  <p className="line-clamp-1 text-foreground/80">{scene.description?.trim() || 'Sem descrição'}</p>
                </div>
              </button>
            </li>
          )
        })}
        <li className="shrink-0">
          <button
            type="button"
            onClick={onAdd}
            disabled={!canAdd}
            className="flex h-full w-20 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border/70 text-[11px] text-muted-foreground hover:border-border hover:text-foreground disabled:opacity-50"
            aria-label="Adicionar cena"
            data-testid="add-scene"
          >
            <Plus className="h-4 w-4" />Cena
          </button>
        </li>
      </ol>
    </div>
  )
}

/** Playhead progress inside a Scene card (the only per-frame part of CENAS). */
function SceneProgress({ cursor, range }: { cursor: FrameCursor; range: SceneRange }) {
  const frame = useFrameCursor(cursor)
  const active = frame >= range.startFrame && frame < range.endFrame
  const progress = active ? (frame - range.startFrame) / range.durationFrames : 0
  return <span className="absolute inset-x-0 bottom-0 h-0.5"><span className="block h-full bg-red-500" style={{ width: `${Math.round(progress * 100)}%` }} /></span>
}
