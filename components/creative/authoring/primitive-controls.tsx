'use client'

import { useState } from 'react'
import type { PrimitiveListItem } from '@/lib/creative/primitives/discovery'
import type { PrimitiveTransforms, PrimitiveTransformSlot } from '@/lib/creative/primitives/transforms'
import type { ElementCapability, TransformField, TransformFieldSpecs } from '@/lib/creative/authoring/element-capabilities'

export function PrimitivePicker({ slot, label, primitives, selectedKey, onSelect, onReset }: { slot: 'paper' | 'tape'; label: string; primitives: PrimitiveListItem[]; selectedKey?: string; onSelect: (key: string | undefined) => void; onReset: () => void }) {
  const available = primitives.filter((primitive) => primitive.category === slot)
  // "Padrão" (with a tooltip spelling out the action) replaces the bare, ambiguous "Reset": this
  // restores the ASSET the template/default selects for this slot — never an authored element's
  // position/visibility, which is a separate, deferred concern (see Element tab / tuning controls).
  return <div className="space-y-2"><div className="flex items-center justify-between"><span className="text-xs font-medium">{label}</span><button type="button" className="text-xs text-muted-foreground underline-offset-4 hover:underline" onClick={onReset} title="Restaurar asset padrão">Padrão</button></div>{available.length === 0 ? <p className="text-xs text-muted-foreground">Nenhum primitive {slot} disponível.</p> : <div className="space-y-1">{available.map((primitive) => { const active = primitive.key === selectedKey; return <button key={primitive.key} type="button" className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-xs ${active ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted/50'}`} onClick={() => onSelect(active ? undefined : primitive.key)}><span><span className="font-medium">{primitive.display_name}</span><span className="ml-2 text-muted-foreground">{primitive.category}</span></span>{active && <span>✓</span>}</button> })}</div>}</div>
}

function formatValue(value: number, precision: number): string {
  if (precision === 0) return String(Math.round(value))
  return value.toFixed(precision)
}

/**
 * CREATIVE_EDITOR_NUMERIC_RANGE_AND_SLIDER_POLICY_V1
 * A unified control combining a slider (soft range) with an editable numeric input (hard safety bounds).
 *
 * - Slider thumb reflects the value clamped to [min, max], so out-of-range values visually pin at the endpoint.
 * - Numeric input displays and edits the exact authored value up to [hardMin, hardMax].
 * - ONE authored value: neither creates a second state truth; editing either calls onChange with the authored number.
 */
function Slider({
  label,
  value,
  min,
  max,
  hardMin = min,
  hardMax = max,
  step,
  precision = 2,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  hardMin?: number
  hardMax?: number
  step: number
  precision?: number
  onChange: (value: number) => void
}) {
  const sliderMin = min
  const sliderMax = max
  const clampedSliderValue = Math.min(sliderMax, Math.max(sliderMin, value))
  const formatted = formatValue(value, precision)

  const [draft, setDraft] = useState(formatted)
  const [syncedValue, setSyncedValue] = useState(value)
  const [isFocused, setIsFocused] = useState(false)

  // Keep draft in sync with external value updates when the input is NOT focused
  if (!isFocused && syncedValue !== value) {
    setSyncedValue(value)
    setDraft(formatted)
  }

  const handleSliderChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.target.value)
    onChange(next)
  }

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value
    setDraft(raw)
    if (raw.trim() === '') return
    const parsed = Number(raw)
    if (Number.isFinite(parsed) && parsed >= hardMin && parsed <= hardMax) {
      onChange(parsed)
    }
  }

  const handleFocus = () => {
    setIsFocused(true)
  }

  const handleBlur = () => {
    setIsFocused(false)
    const trimmed = draft.trim()
    if (trimmed === '') {
      setDraft(formatted)
      return
    }
    const parsed = Number(trimmed)
    if (!Number.isFinite(parsed)) {
      setDraft(formatted)
      return
    }
    const clamped = Math.min(hardMax, Math.max(hardMin, parsed))
    onChange(clamped)
    setDraft(formatValue(clamped, precision))
    setSyncedValue(clamped)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      handleBlur()
      ;(event.target as HTMLInputElement).blur()
    } else if (event.key === 'Escape') {
      setDraft(formatted)
      setIsFocused(false)
      ;(event.target as HTMLInputElement).blur()
    }
  }

  return (
    <div className="grid grid-cols-[4.25rem_minmax(0,1fr)_3.25rem] items-center gap-2 text-xs text-muted-foreground">
      <span>{label}</span>
      <input
        aria-label={label}
        type="range"
        min={sliderMin}
        max={sliderMax}
        step={step}
        value={clampedSliderValue}
        onChange={handleSliderChange}
        className="w-full accent-primary"
      />
      <input
        aria-label={`${label} (valor numérico)`}
        type="number"
        inputMode="decimal"
        min={hardMin}
        max={hardMax}
        step={step}
        value={draft}
        onFocus={handleFocus}
        onChange={handleInputChange}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className="h-6 w-full rounded border border-input bg-background px-1 text-right text-xs tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
    </div>
  )
}

export function PrimitiveTransformControls({ slot, transforms, onChange, onReset }: { slot: PrimitiveTransformSlot; transforms: PrimitiveTransforms; onChange: (field: keyof PrimitiveTransforms, value: number) => void; onReset: () => void }) {
  return (
    <div className="space-y-2">
      <Slider label="Posição X" value={transforms.offsetX} min={-120} max={120} hardMin={-600} hardMax={600} step={1} precision={0} onChange={(value) => onChange('offsetX', value)} />
      <Slider label="Posição Y" value={transforms.offsetY} min={-120} max={120} hardMin={-600} hardMax={600} step={1} precision={0} onChange={(value) => onChange('offsetY', value)} />
      <Slider label="Rotação" value={transforms.rotation} min={-15} max={15} hardMin={-45} hardMax={45} step={0.5} precision={1} onChange={(value) => onChange('rotation', value)} />
      <Slider label="Escala" value={transforms.scale} min={0.5} max={2} hardMin={0.1} hardMax={5} step={0.01} precision={2} onChange={(value) => onChange('scale', value)} />
      <Slider label="Opacidade" value={transforms.opacity} min={0} max={1} hardMin={0} hardMax={1} step={0.01} precision={2} onChange={(value) => onChange('opacity', value)} />
      <div className="pt-1"><button type="button" className="text-xs text-muted-foreground underline-offset-4 hover:underline" onClick={onReset}>Restaurar elemento</button></div>
    </div>
  )
}

/**
 * Bounded template-sanctioned position refinement for the Title element. Reuses TitleTuning's own shape/bounds — no parallel transform system.
 * Static Detail Polish V1: `lineHeight` (Entrelinha) appears only when the Template element declares the capability;
 * the slider shows the effective value (override, else the Template default).
 */
export function TitleTuningControls({ tuning, onChange, onReset, lineHeight }: { tuning: { offsetX: number; offsetY: number; rotation: number; lineHeight?: number }; onChange: (field: 'offsetX' | 'offsetY' | 'rotation' | 'lineHeight', value: number) => void; onReset: () => void; lineHeight?: { defaultValue: number; min: number; max: number } }) {
  return (
    <div className="space-y-2">
      <Slider label="Posição X" value={tuning.offsetX} min={-60} max={60} hardMin={-300} hardMax={300} step={1} precision={0} onChange={(value) => onChange('offsetX', value)} />
      <Slider label="Posição Y" value={tuning.offsetY} min={-60} max={60} hardMin={-300} hardMax={300} step={1} precision={0} onChange={(value) => onChange('offsetY', value)} />
      <Slider label="Rotação" value={tuning.rotation} min={-2} max={2} hardMin={-15} hardMax={15} step={0.1} precision={1} onChange={(value) => onChange('rotation', value)} />
      {lineHeight ? <Slider label="Entrelinha" value={tuning.lineHeight ?? lineHeight.defaultValue} min={lineHeight.min} max={lineHeight.max} hardMin={lineHeight.min} hardMax={lineHeight.max} step={0.01} precision={2} onChange={(value) => onChange('lineHeight', value)} /> : null}
      <div className="pt-1"><button type="button" className="text-xs text-muted-foreground underline-offset-4 hover:underline" onClick={onReset}>Restaurar elemento</button></div>
    </div>
  )
}

/**
 * Bounded template-sanctioned position/scale refinement for the Hero element. Reuses HeroTuning's own shape/bounds — no parallel transform system.
 * COVER_ELEMENT_COMPLETENESS_V1: when the Element declares a frame (`presentation.frame`), a bounded on/off for its
 * frame and paper-coloured backing — independent of which image fills the Hero.
 */
export function HeroTuningControls({ tuning, onChange, onReset }: { tuning: { offsetX: number; offsetY: number; rotation: number; scale: number }; onChange: (field: 'offsetX' | 'offsetY' | 'rotation' | 'scale', value: number) => void; onReset: () => void }) {
  return (
    <div className="space-y-2">
      <Slider label="Posição X" value={tuning.offsetX} min={-120} max={120} hardMin={-600} hardMax={600} step={1} precision={0} onChange={(value) => onChange('offsetX', value)} />
      <Slider label="Posição Y" value={tuning.offsetY} min={-120} max={120} hardMin={-600} hardMax={600} step={1} precision={0} onChange={(value) => onChange('offsetY', value)} />
      <Slider label="Rotação" value={tuning.rotation} min={-4} max={4} hardMin={-20} hardMax={20} step={0.1} precision={1} onChange={(value) => onChange('rotation', value)} />
      <Slider label="Escala" value={tuning.scale} min={0.5} max={2} hardMin={0.1} hardMax={5} step={0.01} precision={2} onChange={(value) => onChange('scale', value)} />
      <div className="pt-1"><button type="button" className="text-xs text-muted-foreground underline-offset-4 hover:underline" onClick={onReset}>Restaurar elemento</button></div>
    </div>
  )
}

/** COVER_ELEMENT_COMPLETENESS_V1 — a semantic child of a spatial owner: it moves with its owner and has no spatial control of its own. */
/** An atom that takes its anchor's POSITION only: it stays its own Element (own visibility, own place in Camadas). */
export function FollowsOwnerNote({ ownerLabel, content }: { ownerLabel: string; content?: string }) {
  return <p className="text-[11px] leading-snug text-muted-foreground" data-testid="follows-owner-note">Acompanha a posição, a rotação, a escala e a opacidade de “{ownerLabel}”, mas é um elemento independente: ocultar “{ownerLabel}” não oculta este, e ocultar este não oculta “{ownerLabel}”.{content ? ` O texto se edita em Conteúdo (${content}).` : ''}</p>
}
/** An atom whose position is Template geometry: own visibility and paint order, no spatial control. */
export function FixedElementNote({ isText, reason }: { isText: boolean; reason?: string }) {
  return <p className="text-[11px] leading-snug text-muted-foreground" data-testid="fixed-element-note" data-exception-reason={reason} title={reason}>Posição fixa do Template: este elemento tem visibilidade e ordem próprias, mas não tem ajuste de posição.{isText ? ' O texto se edita em Conteúdo.' : ''}</p>
}

/** COVER_ELEMENT_COMPLETENESS_V1 — the brand block's authored facts: what it shows and where each part comes from. */
export function BrandOwnershipNote({ projectName }: { projectName?: string }) {
  return <p className="text-[11px] leading-snug text-muted-foreground" data-testid="brand-ownership-note">O logo vem do Template e pode ser trocado em Assets (Logo da marca); o nome{projectName ? ` (“${projectName}”)` : ''} vem do Projeto e é um elemento à parte (Nome da marca).</p>
}

const ELEMENT_TRANSFORM_ROWS: readonly { field: TransformField; capability: Extract<ElementCapability, 'position' | 'rotation' | 'scale' | 'opacity'>; label: string }[] = [
  { field: 'offsetX', capability: 'position', label: 'Posição X' },
  { field: 'offsetY', capability: 'position', label: 'Posição Y' },
  { field: 'rotation', capability: 'rotation', label: 'Rotação' },
  { field: 'scale', capability: 'scale', label: 'Escala' },
  { field: 'opacity', capability: 'opacity', label: 'Opacidade' },
]

/**
 * CREATIVE_EDITOR_ELEMENT_BASELINE_CAPABILITIES_V1 — the ONE placement control set of a Template Element: always in the same
 * order (Posição X/Y, Rotação, Escala, Opacidade), offering exactly the capabilities the registry resolved for it. The values
 * and ranges come from the Element's own existing source (its binding); this component stores nothing.
 *
 * CREATIVE_EDITOR_NUMERIC_RANGE_AND_SLIDER_POLICY_V1 — uses soft slider ranges and hard safety bounds.
 */
export function ElementTransformControls({ capabilities, fields, values, onChange, onReset }: {
  capabilities: Readonly<Record<ElementCapability, boolean>>
  fields: TransformFieldSpecs
  values: Readonly<Record<TransformField, number>>
  onChange: (field: TransformField, value: number) => void
  onReset: () => void
}) {
  return (
    <div className="space-y-2" data-testid="element-transform-controls">
      {ELEMENT_TRANSFORM_ROWS.map(({ field, capability, label }) => {
        const spec = fields[field]
        if (!capabilities[capability] || !spec) return null
        return (
          <Slider
            key={field}
            label={label}
            value={values[field]}
            min={spec.sliderMin ?? spec.min}
            max={spec.sliderMax ?? spec.max}
            hardMin={spec.hardMin}
            hardMax={spec.hardMax}
            step={spec.step}
            precision={spec.precision}
            onChange={(value) => onChange(field, value)}
          />
        )
      })}
      <div className="pt-1">
        <button type="button" className="text-xs text-muted-foreground underline-offset-4 hover:underline" onClick={onReset}>
          Restaurar elemento
        </button>
      </div>
    </div>
  )
}
