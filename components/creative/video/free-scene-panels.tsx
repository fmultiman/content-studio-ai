'use client'

/**
 * VIDEO_FREE_SCENE_COMPOSITION_V1 — Inspector panels for a Scene composed
 * WITHOUT a Template. Everything edits the Scene's own `composition`
 * (`{ kind: 'free', elements }`) through the pure helpers in free-composition.ts.
 * Geometry is shown in % of the stage and stored as fractions; styles are
 * style-token ROLES only.
 *
 * CREATIVE_EDITOR_FREE_DEFAULT_AND_TEMPLATE_ENTRY_V1: the Elementos panel is
 * generic over its HOST (a Video Scene or a Static free slide) — the same free
 * composition and helpers; only Video passes `onTiming`.
 */
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Clock, Eye, EyeOff, ImagePlus, Trash2, Type } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type { FreeElementBox, FreeSceneElement } from '@/lib/types'
import {
  MAX_FREE_ELEMENTS, MAX_FREE_TEXT_LENGTH, freeElements, moveFreeElement, removeFreeElement, setFreeElementBox, setFreeElementHidden,
  updateFreeElement, type FreeHost, type FreeImagePatch, type FreeTextPatch,
} from '@/lib/creative/video-editor/free-composition'

const TYPOGRAPHY_LABELS = { display: 'Título', body: 'Texto' } as const
const COLOR_LABELS = { foreground: 'Principal', background: 'Fundo', accent: 'Destaque', muted: 'Suave' } as const
const SIZE_LABELS = { small: 'P', medium: 'M', large: 'G', title: 'Título' } as const
const ALIGN_LABELS = { left: 'Esquerda', center: 'Centro', right: 'Direita' } as const
const FIT_LABELS = { cover: 'Preencher', contain: 'Conter' } as const

export function freeElementLabel(element: FreeSceneElement, fileName?: string): string {
  if (element.kind === 'image') return fileName ?? 'Imagem'
  const first = element.text.split('\n')[0].trim()
  return first ? first.slice(0, 40) : 'Texto vazio'
}

/** How the panel names its unit and stage (Video Scene vs Static piece/slide). */
export type FreeUnitWording = { unit: 'cena' | 'slide' | 'arte'; stage: string }
const VIDEO_WORDING: FreeUnitWording = { unit: 'cena', stage: 'do formato do vídeo' }

type ElementsProps<T extends FreeHost & { id: string }> = {
  scene: T
  fileNames: ReadonlyMap<string, string>
  openId: string | null
  onOpen: (id: string | null) => void
  onEdit: (edit: (scene: T) => T) => void
  wording?: FreeUnitWording
  onAddText: () => void
  onAddImage: () => void
  onReplaceImage: (elementId: string) => void
  /** VIDEO_FREE_ELEMENT_TIMING_V1: opens the element's Scene-local timing (same section as Template elements). */
  onTiming?: (elementId: string) => void
  /** CREATIVE_EDITOR_TRUTHFUL_CONSTRAINTS_CLEANUP_V1: after a removal, so the host drops any stale selection of that id. */
  onRemoved?: (elementId: string) => void
  /**
   * STATIC_TEMPLATE_ANATOMY_TREE_V1: a Template slide's custom-element list renders the add actions
   * under their own heading (see `FreeElementAddActions`) and names its own empty state. Absent =
   * the unchanged Free/Video panel (actions above the list, "em branco" orientation).
   */
  hideAddActions?: boolean
  emptyMessage?: string
}

/** The bounded author actions of a free host (Texto / Imagem da Biblioteca) — Text and Image only. */
export function FreeElementAddActions({ full, onAddText, onAddImage }: { full: boolean; onAddText: () => void; onAddImage: () => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={onAddText} disabled={full} data-testid="free-add-text"><Type className="h-3.5 w-3.5" />Texto</Button>
      <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={onAddImage} disabled={full} data-testid="free-add-image"><ImagePlus className="h-3.5 w-3.5" />Imagem da Biblioteca</Button>
    </div>
  )
}

/** Elementos tab of a free composition: the only authoring surface for its elements (list = paint order, front on top). */
export function FreeSceneElements<T extends FreeHost & { id: string }>({ scene, fileNames, openId, onOpen, onEdit, onAddText, onAddImage, onReplaceImage, onTiming, onRemoved, hideAddActions = false, emptyMessage, wording = VIDEO_WORDING }: ElementsProps<T>) {
  const elements = freeElements(scene)
  const full = elements.length >= MAX_FREE_ELEMENTS
  // Shown front-most first (like Camadas); stored back -> front.
  const listed = [...elements].reverse()
  return (
    <div className="space-y-2" data-testid="free-scene-elements">
      {hideAddActions ? null : <FreeElementAddActions full={full} onAddText={onAddText} onAddImage={onAddImage} />}
      {elements.length === 0 ? (
        <p className="rounded-md border border-dashed border-border/60 p-2 text-[11px] text-muted-foreground" data-testid="free-scene-empty">{emptyMessage ?? `${wording.unit === 'cena' ? 'Cena' : wording.unit === 'slide' ? 'Slide' : 'Arte'} em branco (composição livre). Adicione um texto ou uma imagem, ou escolha um template na aba Template.`}</p>
      ) : (
        <ol className="space-y-1" aria-label={`Elementos ${wording.unit === 'slide' ? 'do slide' : `da ${wording.unit}`} (frente no topo)`}>
          {listed.map((element) => {
            const index = elements.indexOf(element)
            const open = openId === element.id
            const label = freeElementLabel(element, element.kind === 'image' ? fileNames.get(element.library_file_id) : undefined)
            return (
              <li key={element.id} className={cn('rounded-md border', open ? 'border-primary/60' : 'border-border/60')} data-testid="free-element" data-element-id={element.id} data-kind={element.kind} data-hidden={element.hidden === true}>
                <div className="flex items-center gap-1 px-1.5 py-1">
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-1 text-left text-xs" onClick={() => onOpen(open ? null : element.id)} aria-expanded={open} data-testid="free-element-toggle">
                    {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
                    <span className="shrink-0 text-[10px] uppercase text-muted-foreground">{element.kind === 'text' ? 'Texto' : 'Imagem'}</span>
                    <span className={cn('truncate', element.hidden && 'text-muted-foreground line-through')}>{label}</span>
                  </button>
                  <Button size="icon-sm" variant="ghost" aria-label={element.hidden ? 'Mostrar' : 'Ocultar'} title={element.hidden ? 'Mostrar' : 'Ocultar'} onClick={() => onEdit((current) => setFreeElementHidden(current, element.id, !element.hidden))} data-testid="free-element-visibility">{element.hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</Button>
                  <Button size="icon-sm" variant="ghost" aria-label="Trazer para frente" title="Trazer para frente" disabled={index === elements.length - 1} onClick={() => onEdit((current) => moveFreeElement(current, element.id, 'forward'))} data-testid="free-element-forward"><ArrowUp className="h-3.5 w-3.5" /></Button>
                  <Button size="icon-sm" variant="ghost" aria-label="Enviar para trás" title="Enviar para trás" disabled={index === 0} onClick={() => onEdit((current) => moveFreeElement(current, element.id, 'backward'))} data-testid="free-element-backward"><ArrowDown className="h-3.5 w-3.5" /></Button>
                  <Button size="icon-sm" variant="ghost" className="text-muted-foreground hover:text-destructive" aria-label="Remover elemento" title="Remover elemento (o arquivo da Biblioteca não é apagado)" onClick={() => { onEdit((current) => removeFreeElement(current, element.id)); if (open) onOpen(null); onRemoved?.(element.id) }} data-testid="free-element-remove"><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
                {open ? (
                  <div className="space-y-3 border-t border-border/40 p-2">
                    {onTiming ? <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => onTiming(element.id)} data-testid="free-element-timing"><Clock className="h-3.5 w-3.5" />Timing na cena</Button> : null}
                    {element.kind === 'text' ? (
                      <TextFields sceneId={scene.id} element={element} onPatch={(patch) => onEdit((current) => updateFreeElement(current, element.id, patch))} />
                    ) : (
                      <ImageFields fileName={fileNames.get(element.library_file_id)} fit={element.fit} onReplace={() => onReplaceImage(element.id)} onPatch={(patch) => onEdit((current) => updateFreeElement(current, element.id, patch))} />
                    )}
                    <GeometryFields sceneId={scene.id} element={element} onBox={(box) => onEdit((current) => setFreeElementBox(current, element.id, box))} />
                  </div>
                ) : null}
              </li>
            )
          })}
        </ol>
      )}
      {elements.length === 0 && emptyMessage ? null : <p className="text-[11px] text-muted-foreground" data-testid="free-scene-elements-note">A lista mostra a frente no topo; a prévia e o render desenham na mesma ordem. Posição e tamanho são em % {wording.stage}.</p>}
    </div>
  )
}

function Choice<T extends string>({ label, value, options, labels, onChange, testId }: { label: string; value: T; options: readonly T[]; labels: Record<T, string>; onChange: (value: T) => void; testId: string }) {
  return (
    <div className="space-y-1">
      <span className="text-[11px] font-medium">{label}</span>
      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <Button key={option} size="sm" variant={option === value ? 'default' : 'outline'} role="radio" aria-checked={option === value} className="h-7 px-2 text-xs" onClick={() => { if (option !== value) onChange(option) }} data-testid={testId} data-value={option}>{labels[option]}</Button>
        ))}
      </div>
    </div>
  )
}

function TextFields({ sceneId, element, onPatch }: { sceneId: string; element: Extract<FreeSceneElement, { kind: 'text' }>; onPatch: (patch: FreeTextPatch) => void }) {
  return (
    <div className="space-y-2" data-testid="free-text-fields">
      <div className="space-y-1">
        <Label htmlFor={`free-text-${sceneId}-${element.id}`} className="text-[11px]">Texto</Label>
        <Textarea id={`free-text-${sceneId}-${element.id}`} value={element.text} maxLength={MAX_FREE_TEXT_LENGTH} rows={3} onChange={(event) => onPatch({ text: event.target.value })} data-testid="free-text-input" />
      </div>
      <Choice label="Fonte (papel do estilo)" value={element.typography} options={['display', 'body'] as const} labels={TYPOGRAPHY_LABELS} onChange={(typography) => onPatch({ typography })} testId="free-text-typography" />
      <Choice label="Cor (papel do estilo)" value={element.color} options={['foreground', 'background', 'accent', 'muted'] as const} labels={COLOR_LABELS} onChange={(color) => onPatch({ color })} testId="free-text-color" />
      <Choice label="Tamanho" value={element.size} options={['small', 'medium', 'large', 'title'] as const} labels={SIZE_LABELS} onChange={(size) => onPatch({ size })} testId="free-text-size" />
      <Choice label="Alinhamento" value={element.align} options={['left', 'center', 'right'] as const} labels={ALIGN_LABELS} onChange={(align) => onPatch({ align })} testId="free-text-align" />
    </div>
  )
}

function ImageFields({ fileName, fit, onReplace, onPatch }: { fileName?: string; fit: 'cover' | 'contain'; onReplace: () => void; onPatch: (patch: FreeImagePatch) => void }) {
  return (
    <div className="space-y-2" data-testid="free-image-fields">
      <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 p-1.5">
        <span className="min-w-0 truncate text-xs" title={fileName} data-testid="free-image-file">{fileName ?? 'Arquivo da Biblioteca'}</span>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onReplace} data-testid="free-image-replace">Trocar</Button>
      </div>
      <Choice label="Enquadramento" value={fit} options={['cover', 'contain'] as const} labels={FIT_LABELS} onChange={(next) => onPatch({ fit: next })} testId="free-image-fit" />
    </div>
  )
}

const pct = (fraction: number) => Number((fraction * 100).toFixed(1))

function GeometryFields({ sceneId, element, onBox }: { sceneId: string; element: FreeSceneElement; onBox: (box: Partial<FreeElementBox>) => void }) {
  const { box } = element
  const fields: readonly [keyof FreeElementBox, string][] = [['x', 'X'], ['y', 'Y'], ['width', 'Largura'], ['height', 'Altura']]
  return (
    <div className="space-y-2" data-testid="free-geometry">
      <span className="text-[11px] font-medium">Posição e tamanho (% do formato)</span>
      <div className="grid grid-cols-4 gap-1.5">
        {fields.map(([key, label]) => (
          <div key={key} className="space-y-1">
            <Label htmlFor={`free-${key}-${sceneId}-${element.id}`} className="text-[11px]">{label}</Label>
            <Input
              key={`${element.id}:${key}:${box[key]}`}
              id={`free-${key}-${sceneId}-${element.id}`}
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step={1}
              defaultValue={pct(box[key])}
              className="h-8 px-1.5"
              onBlur={(event) => { const value = Number(event.target.value); if (Number.isFinite(value) && pct(box[key]) !== value) onBox({ [key]: value / 100 }) }}
              onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur() }}
              data-testid={`free-geometry-${key}`}
            />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-1">
        <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => onBox({ x: (1 - box.width) / 2 })} data-testid="free-geometry-center-x">Centralizar ↔</Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => onBox({ y: (1 - box.height) / 2 })} data-testid="free-geometry-center-y">Centralizar ↕</Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => onBox({ x: 0, y: 0, width: 1, height: 1 })} data-testid="free-geometry-fill">Palco inteiro</Button>
      </div>
    </div>
  )
}
