'use client'

import type { PrimitiveListItem } from '@/lib/creative/primitives/discovery'
import type { PrimitiveTransforms } from '@/lib/creative/primitives/transforms'

export function PrimitivePicker({ slot, label, primitives, selectedKey, onSelect, onReset }: { slot: 'paper' | 'tape'; label: string; primitives: PrimitiveListItem[]; selectedKey?: string; onSelect: (key: string | undefined) => void; onReset: () => void }) {
  const available = primitives.filter((primitive) => primitive.category === slot)
  // "Padrão" (with a tooltip spelling out the action) replaces the bare, ambiguous "Reset": this
  // restores the ASSET the template/default selects for this slot — never an authored element's
  // position/visibility, which is a separate, deferred concern (see Element tab / tuning controls).
  return <div className="space-y-2"><div className="flex items-center justify-between"><span className="text-xs font-medium">{label}</span><button type="button" className="text-xs text-muted-foreground underline-offset-4 hover:underline" onClick={onReset} title="Restaurar asset padrão">Padrão</button></div>{available.length === 0 ? <p className="text-xs text-muted-foreground">Nenhum primitive {slot} disponível.</p> : <div className="space-y-1">{available.map((primitive) => { const active = primitive.key === selectedKey; return <button key={primitive.key} type="button" className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-xs ${active ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted/50'}`} onClick={() => onSelect(active ? undefined : primitive.key)}><span><span className="font-medium">{primitive.display_name}</span><span className="ml-2 text-muted-foreground">{primitive.category}</span></span>{active && <span>✓</span>}</button> })}</div>}</div>
}

function Slider({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void }) {
  return <label className="grid grid-cols-[5rem_1fr_3rem] items-center gap-2 text-xs text-muted-foreground"><span>{label}</span><input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} /><output className="text-right tabular-nums text-foreground">{value.toFixed(2)}</output></label>
}

export function PrimitiveTransformControls({ slot, transforms, onChange, onReset }: { slot: 'paper' | 'paperStrip' | 'tape' | 'tape1' | 'tape2' | 'tape3' | 'botanical' | 'pin'; transforms: PrimitiveTransforms; onChange: (field: keyof PrimitiveTransforms, value: number) => void; onReset: () => void }) {
  return <div className="space-y-2"><Slider label="offset X" value={transforms.offsetX} min={-120} max={120} step={1} onChange={(value) => onChange('offsetX', value)} /><Slider label="offset Y" value={transforms.offsetY} min={-120} max={120} step={1} onChange={(value) => onChange('offsetY', value)} /><Slider label="rotation" value={transforms.rotation} min={-15} max={15} step={0.5} onChange={(value) => onChange('rotation', value)} /><Slider label="scale" value={transforms.scale} min={0.5} max={2} step={0.01} onChange={(value) => onChange('scale', value)} /><Slider label="opacity" value={transforms.opacity} min={0} max={1} step={0.01} onChange={(value) => onChange('opacity', value)} /><div className="pt-1"><button type="button" className="text-xs text-muted-foreground underline-offset-4 hover:underline" onClick={onReset}>Restaurar este elemento</button></div></div>
}

/** Bounded template-sanctioned position refinement for the Title element. Reuses TitleTuning's own shape/bounds — no parallel transform system. */
export function TitleTuningControls({ tuning, onChange, onReset }: { tuning: { offsetX: number; offsetY: number; rotation: number }; onChange: (field: 'offsetX' | 'offsetY' | 'rotation', value: number) => void; onReset: () => void }) {
  return <div className="space-y-2"><Slider label="offset X" value={tuning.offsetX} min={-60} max={60} step={1} onChange={(value) => onChange('offsetX', value)} /><Slider label="offset Y" value={tuning.offsetY} min={-60} max={60} step={1} onChange={(value) => onChange('offsetY', value)} /><Slider label="rotation" value={tuning.rotation} min={-2} max={2} step={0.1} onChange={(value) => onChange('rotation', value)} /><div className="pt-1"><button type="button" className="text-xs text-muted-foreground underline-offset-4 hover:underline" onClick={onReset}>Restaurar este elemento</button></div></div>
}

/** Bounded template-sanctioned position/scale refinement for the Hero element. Reuses HeroTuning's own shape/bounds — no parallel transform system. */
export function HeroTuningControls({ tuning, onChange, onReset }: { tuning: { offsetX: number; offsetY: number; rotation: number; scale: number }; onChange: (field: 'offsetX' | 'offsetY' | 'rotation' | 'scale', value: number) => void; onReset: () => void }) {
  return <div className="space-y-2"><Slider label="offset X" value={tuning.offsetX} min={-120} max={120} step={1} onChange={(value) => onChange('offsetX', value)} /><Slider label="offset Y" value={tuning.offsetY} min={-120} max={120} step={1} onChange={(value) => onChange('offsetY', value)} /><Slider label="rotation" value={tuning.rotation} min={-4} max={4} step={0.1} onChange={(value) => onChange('rotation', value)} /><Slider label="scale" value={tuning.scale} min={0.9} max={1.15} step={0.01} onChange={(value) => onChange('scale', value)} /><div className="pt-1"><button type="button" className="text-xs text-muted-foreground underline-offset-4 hover:underline" onClick={onReset}>Restaurar este elemento</button></div></div>
}
