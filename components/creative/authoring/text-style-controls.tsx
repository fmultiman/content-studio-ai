'use client'

/**
 * CREATIVE_EDITOR_CONTEXTUAL_STYLES_AND_TYPOGRAPHY_V1 — the typography controls of ESTILOS for ONE selected text Element.
 *
 *   effective default (Identity role / Template size)  →  optional LOCAL override
 *
 * - Fonte: ONLY the supported runtime registry families, each previewed in its own face. Choosing the effective
 *   default clears the override; nothing resolved is ever stored as a fake override.
 * - Tamanho: a numeric px field (px on the 1080px reference canvas); presets (Free/Custom text) are shortcuts, not the only values.
 * - Entrelinha: Title only, and it edits the one canonical source (`tuning.title.lineHeight`).
 * - Usar padrão: removes the local override, so the upstream default resolves again.
 *
 * These controls own HOW the text looks. WHAT it says is Conteúdo; WHERE it is is Elementos.
 */
import { useState } from 'react'
import { Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FREE_TEXT_SIZE_SCALE } from '@/components/creative/free/free-stage'
import { FONT_SIZE_PX_BOUNDS, RUNTIME_FONT_FAMILIES, type RuntimeFontFamily } from '@/lib/creative/typography/resolve-typography'
import type { VisualTokensSnapshot } from '@/lib/schemas/creative/primitives'
import type { FreeTextElement } from '@/lib/types'
import type { FreeTextPatch } from '@/lib/creative/video-editor/free-composition'

/** Faces the editor preview paints: declared once for the whole editor (the worker declares its own for the render). */
export { RuntimeFontFaces } from './runtime-font-faces'

type IdentityRole = 'display' | 'body' | 'label'
const ROLE_LABELS: Record<IdentityRole, string> = { display: 'Títulos', body: 'Texto', label: 'Rótulos' }

/** The Identity family a role resolves to today (label falls back to body, like the renderer). */
export function identityFamily(tokens: VisualTokensSnapshot | undefined, role: IdentityRole): string | undefined {
  if (!tokens) return undefined
  if (role === 'label') return tokens.typography.label?.family ?? tokens.typography.body.family
  return tokens.typography[role].family
}

export function FontFamilyPicker({ value, defaultFamily, defaultSource, onSelect }: {
  /** The local override, if any. */
  value: RuntimeFontFamily | undefined
  /** The family the Element uses without an override. */
  defaultFamily: string | undefined
  defaultSource: string
  /** A family = set the override; `null` = back to the default. */
  onSelect: (family: RuntimeFontFamily | null) => void
}) {
  const effective = value ?? defaultFamily
  return (
    <div className="space-y-1" data-testid="font-family-picker" data-overridden={value !== undefined}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium">Fonte</span>
        <span className="truncate text-[10px] text-muted-foreground" data-testid="font-family-origin">{value ? 'Personalizada' : `Padrão · ${defaultSource}${defaultFamily ? ` (${defaultFamily})` : ''}`}</span>
      </div>
      <div className="grid grid-cols-1 gap-1" role="radiogroup" aria-label="Fonte">
        {RUNTIME_FONT_FAMILIES.map((family) => {
          const checked = family === effective
          return (
            <button
              key={family}
              type="button"
              role="radio"
              aria-checked={checked}
              data-font-family={family}
              className={`flex items-center justify-between rounded-md border px-2 py-1.5 text-left text-sm ${checked ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted/50'}`}
              // The preview IS the supported face: the same identity the final renderer uses.
              style={{ fontFamily: `"${family}"` }}
              onClick={() => {
                if (family === defaultFamily) { if (value !== undefined) onSelect(null); return }
                if (family !== value) onSelect(family)
              }}
            >
              <span>{family}</span>
              {checked ? <span className="text-xs" aria-hidden="true">✓</span> : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** A bounded numeric px field. Commits only valid values; an emptied field returns to the default. */
export function FontSizeField({ valuePx, defaultPx, onCommit }: {
  /** The explicit size, if any. */
  valuePx: number | undefined
  /** The size the Element uses without an explicit one (px on the 1080px reference), when known. */
  defaultPx: number | undefined
  /** A px value = explicit size; `null` = back to the default. */
  onCommit: (px: number | null) => void
}) {
  const effective = valuePx ?? defaultPx
  const shown = effective === undefined ? '' : String(effective)
  const [draft, setDraft] = useState(shown)
  // The field follows the effective value (a preset click, a reset); a half-typed value keeps its draft until the value changes.
  const [syncedTo, setSyncedTo] = useState(shown)
  if (syncedTo !== shown) { setSyncedTo(shown); setDraft(shown) }
  return (
    <div className="space-y-1">
      <label className="flex items-center justify-between gap-2 text-[11px] font-medium" htmlFor="text-style-size">
        <span>Tamanho</span>
        <span className="text-[10px] font-normal text-muted-foreground" data-testid="font-size-origin">{valuePx !== undefined ? 'Personalizado' : defaultPx !== undefined ? `Padrão · ${defaultPx}px` : 'Padrão'}</span>
      </label>
      <div className="relative">
        <input
          id="text-style-size"
          type="number"
          inputMode="numeric"
          className="h-8 w-full rounded-md border border-input bg-background px-2 pr-7 text-xs"
          min={FONT_SIZE_PX_BOUNDS.min}
          max={FONT_SIZE_PX_BOUNDS.max}
          step={1}
          value={draft}
          data-testid="font-size-input"
          onChange={(event) => {
            const raw = event.target.value
            setDraft(raw)
            if (raw.trim() === '') { if (valuePx !== undefined) onCommit(null); return }
            const parsed = Number(raw)
            if (Number.isFinite(parsed) && parsed >= FONT_SIZE_PX_BOUNDS.min && parsed <= FONT_SIZE_PX_BOUNDS.max) onCommit(Math.round(parsed))
          }}
          onBlur={() => setDraft(shown)}
        />
        <span className="pointer-events-none absolute right-2 top-2 text-[10px] text-muted-foreground">px</span>
      </div>
    </div>
  )
}

function ResetRow({ visible, onReset }: { visible: boolean; onReset: () => void }) {
  if (!visible) return null
  return (
    <div className="pt-1">
      <Button type="button" size="sm" variant="ghost" className="h-7 gap-1 px-1.5 text-[11px]" onClick={onReset} data-testid="text-style-reset" title="Remover o ajuste local e voltar ao padrão">
        <Undo2 className="h-3 w-3" aria-hidden="true" /> Usar padrão
      </Button>
    </div>
  )
}

/** A Template text Element's local typography (single-style blocks only; the Element declares what it takes). */
export function TemplateTextStyleControls({ capability, override, tokens, titleLineHeight, onPatch, onReset }: {
  capability: { role: IdentityRole; fontSizePx?: number }
  override: { fontFamily?: RuntimeFontFamily; fontSizePx?: number } | undefined
  tokens: VisualTokensSnapshot | undefined
  /** The Title's Entrelinha: ONE canonical source (`tuning.title.lineHeight`), edited here. */
  titleLineHeight?: { value: number | undefined; defaultValue: number; min: number; max: number; onChange: (value: number) => void }
  onPatch: (patch: { fontFamily?: RuntimeFontFamily | null; fontSizePx?: number | null }) => void
  onReset: () => void
}) {
  const lineHeightOverridden = titleLineHeight?.value !== undefined
  return (
    <div className="space-y-3" data-testid="template-text-style">
      <FontFamilyPicker value={override?.fontFamily} defaultFamily={identityFamily(tokens, capability.role)} defaultSource={`Identidade · ${ROLE_LABELS[capability.role]}`} onSelect={(family) => onPatch({ fontFamily: family })} />
      {capability.fontSizePx !== undefined
        ? <FontSizeField valuePx={override?.fontSizePx} defaultPx={capability.fontSizePx} onCommit={(px) => onPatch({ fontSizePx: px })} />
        : <p className="text-[11px] text-muted-foreground" data-testid="font-size-composite">O tamanho deste texto é definido pelo Template em mais de uma linha; aqui só a fonte pode ser trocada.</p>}
      {titleLineHeight ? (
        <label className="grid grid-cols-[4.25rem_minmax(0,1fr)_2.5rem] items-center gap-2 text-xs text-muted-foreground">
          <span>Entrelinha</span>
          <input aria-label="Entrelinha" type="range" min={titleLineHeight.min} max={titleLineHeight.max} step={0.01} value={titleLineHeight.value ?? titleLineHeight.defaultValue} onChange={(event) => titleLineHeight.onChange(Number(event.target.value))} />
          <output className="text-right tabular-nums text-foreground">{(titleLineHeight.value ?? titleLineHeight.defaultValue).toFixed(2)}</output>
        </label>
      ) : null}
      <ResetRow visible={override !== undefined || lineHeightOverridden} onReset={onReset} />
    </div>
  )
}

const SIZE_PRESET_LABELS = { small: 'P', medium: 'M', large: 'G', title: 'Título' } as const
const ROLE_CHOICE_LABELS = { display: 'Título', body: 'Texto' } as const
const presetPx = (size: keyof typeof FREE_TEXT_SIZE_SCALE) => Math.round(FREE_TEXT_SIZE_SCALE[size] * 1080)

/** Free / Custom Text typography: the semantic role + preset (existing) plus an optional explicit family and px size. */
export function FreeTextStyleControls({ element, tokens, onPatch }: {
  element: FreeTextElement
  tokens: VisualTokensSnapshot | undefined
  onPatch: (patch: FreeTextPatch) => void
}) {
  const explicit = element.font_family !== undefined || element.font_size_px !== undefined
  return (
    <div className="space-y-3" data-testid="free-text-style">
      <div className="space-y-1">
        <span className="text-[11px] font-medium">Papel da fonte</span>
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Papel da fonte">
          {(['display', 'body'] as const).map((role) => (
            <Button key={role} size="sm" variant={element.typography === role ? 'default' : 'outline'} role="radio" aria-checked={element.typography === role} className="h-7 px-2 text-xs" onClick={() => { if (element.typography !== role) onPatch({ typography: role }) }} data-testid="free-text-typography" data-value={role}>{ROLE_CHOICE_LABELS[role]}</Button>
          ))}
        </div>
      </div>
      <FontFamilyPicker value={element.font_family} defaultFamily={identityFamily(tokens, element.typography)} defaultSource={`Identidade · ${ROLE_LABELS[element.typography]}`} onSelect={(family) => onPatch({ font_family: family })} />
      <div className="space-y-1">
        <span className="text-[11px] font-medium">Atalhos de tamanho</span>
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Atalhos de tamanho">
          {(['small', 'medium', 'large', 'title'] as const).map((size) => {
            // A preset is a shortcut: it is the active one only while no explicit px size overrides it.
            const checked = element.font_size_px === undefined && element.size === size
            return <Button key={size} size="sm" variant={checked ? 'default' : 'outline'} role="radio" aria-checked={checked} className="h-7 px-2 text-xs" onClick={() => onPatch({ size, font_size_px: null })} data-testid="free-text-size" data-value={size} title={`${presetPx(size)}px`}>{SIZE_PRESET_LABELS[size]}</Button>
          })}
        </div>
      </div>
      <FontSizeField valuePx={element.font_size_px} defaultPx={presetPx(element.size)} onCommit={(px) => onPatch({ font_size_px: px })} />
      <ResetRow visible={explicit} onReset={() => onPatch({ font_family: null, font_size_px: null })} />
    </div>
  )
}
