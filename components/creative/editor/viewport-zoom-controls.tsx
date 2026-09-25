'use client'

import type { ReactNode } from 'react'
import { Crosshair, Maximize, Minus, MoreHorizontal, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { VIEWPORT_ZOOM_LEVELS, type ViewportAction, type ViewportZoom } from '@/lib/creative/authoring/viewport'

/**
 * Preview Surface zoom group shared by the Static Canvas and the Video Live
 * Player: − / Fit·N% + explicit levels / + / viewport actions (Ajustar,
 * Centralizar, 100%). Viewport only — never authoring, never dirty.
 * `trailing` hosts workspace controls such as the Inspector launcher.
 */
export function ViewportZoomControls({ zoom, fitScale, onZoomChange, onStep, onAction, trailing }: {
  zoom: ViewportZoom
  fitScale: number
  onZoomChange: (zoom: ViewportZoom) => void
  onStep: (direction: 1 | -1) => void
  onAction: (action: ViewportAction) => void
  trailing?: ReactNode
}) {
  return (
    <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Zoom">
      <Button size="icon-sm" variant="outline" onClick={() => onStep(-1)} aria-label="Diminuir zoom"><Minus className="h-3.5 w-3.5" /></Button>
      <select aria-label="Zoom da prévia" className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={zoom === 'fit' ? 'fit' : String(zoom)} onChange={(event) => onZoomChange(event.target.value === 'fit' ? 'fit' : Number(event.target.value))}>
        <option value="fit">Fit · {Math.round(fitScale * 100)}%</option>
        {VIEWPORT_ZOOM_LEVELS.map((level) => <option key={level} value={level}>{Math.round(level * 100)}%</option>)}
      </select>
      <Button size="icon-sm" variant="outline" onClick={() => onStep(1)} aria-label="Aumentar zoom"><Plus className="h-3.5 w-3.5" /></Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button size="icon-sm" variant="ghost" aria-label="Ações de viewport" title="Ações de viewport" data-testid="viewport-actions"><MoreHorizontal className="h-3.5 w-3.5" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onAction('fit')} data-testid="viewport-fit"><Maximize className="mr-2 h-3.5 w-3.5" />Ajustar à tela</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onAction('center')} data-testid="viewport-center"><Crosshair className="mr-2 h-3.5 w-3.5" />Centralizar</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onAction('actual')} data-testid="viewport-100">100% centralizado</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {trailing}
    </div>
  )
}
