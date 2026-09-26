'use client'

/**
 * VIDEO_CANVAS_OUTPUT_FORMAT_V1 — document-level "Formato" control.
 *
 * Sets the VideoDraft's output stage (width × height). Presets are shortcuts;
 * the label is derived from the dimensions. A stage the active Template does
 * not declare is shown but cannot be applied, with the reason — the platform
 * accepts it, the Template cannot draw it.
 */
import { useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import {
  VIDEO_CANVAS_LIMITS, VIDEO_CANVAS_PRESETS, matchVideoCanvasPreset, validateVideoCanvas, videoCanvasRatio, videoTemplateCanvasSupport,
  type VideoCanvas,
} from '@/lib/creative/video-editor/video-canvas'

export function videoCanvasLabel(canvas: VideoCanvas): string {
  return `${videoCanvasRatio(canvas)} · ${canvas.width}×${canvas.height}`
}

export function VideoCanvasControl({ canvas, authored, onChange }: {
  /** The stage in effect (authored or the legacy default). */
  canvas: VideoCanvas
  /** False = the draft never set a stage (legacy 1080×1920 in effect). */
  authored: boolean
  onChange: (canvas: VideoCanvas) => void
}) {
  const [customOpen, setCustomOpen] = useState(false)
  const [width, setWidth] = useState(String(canvas.width))
  const [height, setHeight] = useState(String(canvas.height))
  const preset = matchVideoCanvasPreset(canvas)
  const support = videoTemplateCanvasSupport(canvas)
  const supportedList = support.supportedSizes.map((size) => `${size.width}×${size.height}`).join(' e ')

  const parsed = validateVideoCanvas({ width: Number(width), height: Number(height) })
  const customSupport = parsed.ok ? videoTemplateCanvasSupport(parsed.canvas) : null
  const customMessage = !parsed.ok
    ? parsed.message
    : !customSupport?.supported ? `O template ${customSupport?.templateLabel} desenha apenas ${supportedList}.` : null

  function openCustom() {
    setWidth(String(canvas.width))
    setHeight(String(canvas.height))
    setCustomOpen(true)
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 shrink-0 gap-1 px-1.5 text-xs text-muted-foreground" title={authored ? 'Formato do vídeo (tamanho de saída)' : 'Formato do vídeo — padrão legado, ainda não escolhido neste rascunho'} data-testid="video-canvas-trigger" data-width={canvas.width} data-height={canvas.height} data-authored={authored}>
            <span className="font-medium text-foreground">{preset ? preset.label : 'Personalizado'}</span>
            <span>{videoCanvasLabel(canvas)}</span>
            <ChevronDown className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72 max-w-[calc(100vw-2rem)]" data-testid="video-canvas-menu">
          <DropdownMenuLabel className="text-xs">Formato do vídeo</DropdownMenuLabel>
          <p className="px-2 pb-1.5 text-[11px] text-muted-foreground">Tamanho de saída de todas as cenas e itens da timeline. Imagens e vídeos se ajustam dentro dele.</p>
          <DropdownMenuSeparator />
          {VIDEO_CANVAS_PRESETS.map((option) => {
            const presetSupport = videoTemplateCanvasSupport(option)
            const selected = option.width === canvas.width && option.height === canvas.height
            return (
              <DropdownMenuItem
                key={option.id}
                disabled={!presetSupport.supported}
                onSelect={() => { if (!selected) onChange({ width: option.width, height: option.height }) }}
                className="flex items-start gap-2"
                data-testid="video-canvas-preset"
                data-preset={option.id}
                data-supported={presetSupport.supported}
              >
                <Check className={selected ? 'mt-0.5 h-3.5 w-3.5' : 'mt-0.5 h-3.5 w-3.5 opacity-0'} />
                <span className="flex min-w-0 flex-col">
                  <span className="text-xs font-medium">{option.label} {option.ratio}</span>
                  <span className="text-[11px] text-muted-foreground">{option.width}×{option.height}{presetSupport.supported ? '' : ' · o template atual não desenha este formato'}</span>
                </span>
              </DropdownMenuItem>
            )
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={openCustom} className="text-xs" data-testid="video-canvas-custom">Personalizado…</DropdownMenuItem>
          {!support.supported ? <p className="px-2 pb-1 pt-1.5 text-[11px] text-amber-600 dark:text-amber-400" role="alert">O template {support.templateLabel} não desenha o formato atual.</p> : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={customOpen} onOpenChange={setCustomOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Formato personalizado</DialogTitle>
            <DialogDescription>
              Largura e altura em pixels, números pares entre {VIDEO_CANVAS_LIMITS.minSide} e {VIDEO_CANVAS_LIMITS.maxSide}.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="video-canvas-width" className="text-xs">Largura (px)</Label>
              <Input id="video-canvas-width" inputMode="numeric" value={width} onChange={(event) => setWidth(event.target.value)} data-testid="video-canvas-width" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="video-canvas-height" className="text-xs">Altura (px)</Label>
              <Input id="video-canvas-height" inputMode="numeric" value={height} onChange={(event) => setHeight(event.target.value)} data-testid="video-canvas-height" />
            </div>
          </div>
          {customMessage ? <p className="text-xs text-amber-600 dark:text-amber-400" role="alert" data-testid="video-canvas-custom-message">{customMessage}</p> : null}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCustomOpen(false)}>Cancelar</Button>
            <Button
              size="sm"
              disabled={customMessage !== null}
              onClick={() => { if (parsed.ok) { onChange(parsed.canvas); setCustomOpen(false) } }}
              data-testid="video-canvas-custom-apply"
            >
              Aplicar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
