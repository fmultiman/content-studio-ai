'use client'

/**
 * CREATIVE_EDITOR_CONTEXTUAL_STYLES_AND_TYPOGRAPHY_V1 — ESTILOS follows the selection (UI-only `selectedTarget`):
 *
 *   no selection          → ESTILOS DA COMPOSIÇÃO: the truthful, inherited Identity facts (edited in the Project).
 *   Template text Element → ESTILOS · <ELEMENT>: its local typography, where its Element declares the capability.
 *   other Template Element→ truthful note (no invented image/paper styling).
 *   Custom / Free Text    → ESTILOS · <TEXT>: role, preset + numeric size, optional family.
 *   Custom / Free Image   → truthful note.
 *
 * Selection never dirties state; only a style edit does (it dispatches / patches authored state).
 */
import { StyleSourcePanel } from '@/components/creative/authoring/inspector-panels'
import { FreeTextStyleControls, TemplateTextStyleControls } from '@/components/creative/authoring/text-style-controls'
import { freeElementLabel } from '@/components/creative/video/free-scene-panels'
import { clampTuningValue, setTuningField } from '@/lib/creative/authoring/authoring-state'
import type { AuthoringAction } from '@/lib/creative/authoring/reducer'
import type { AuthoringState } from '@/lib/creative/authoring/types'
import type { FreeTextPatch } from '@/lib/creative/video-editor/free-composition'
import { TITLE_LINE_HEIGHT_BOUNDS, elementLocalTypography, getLayoutElement, type TemplateLayoutDefinition } from '@/lib/creative/templates/template-definitions'
import type { VisualTokensSnapshot } from '@/lib/schemas/creative/primitives'
import type { FreeSceneElement } from '@/lib/types'

export type StylesTarget = { kind: 'template-element' | 'free-element'; elementId: string }

const KIND_NOTES: Record<'image' | 'material' | 'shape', string> = {
  image: 'Imagem do Template: não tem estilo de texto. O recurso se troca em Assets; posição e visibilidade ficam em Elementos.',
  material: 'Material do Template (papel, fita, recorte…): não tem estilo de texto. O recurso se troca em Assets; posição e visibilidade ficam em Elementos.',
  shape: 'Forma desenhada pelo Template: não tem estilo de texto. Posição e visibilidade ficam em Elementos.',
}

function Note({ headline, children, testId }: { headline: string; children: React.ReactNode; testId: string }) {
  return (
    <div className="space-y-2" data-testid="style-source" data-target={testId}>
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground" data-testid="style-headline">{headline}</h3>
      <p className="text-[11px] leading-snug text-muted-foreground" data-testid={testId}>{children}</p>
    </div>
  )
}

function Panel({ headline, children }: { headline: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3" data-testid="style-source" data-target="element-styles">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground" data-testid="style-headline">{headline}</h3>
      {children}
    </div>
  )
}

export function StylesTab({ tokens, free = false, unitLabel = 'slide', target, template, freeElements, onPatchFreeText }: {
  tokens: VisualTokensSnapshot | undefined
  /** A Template-less (Free) composition. */
  free?: boolean
  unitLabel?: 'slide' | 'cena'
  target: StylesTarget | null
  /** Template mode: the active Layout + authored state (Template Elements' local typography). */
  template?: { layout: TemplateLayoutDefinition | null | undefined; state: AuthoringState; dispatch: (action: AuthoringAction) => void }
  /** The Free slide's elements, or the Template slide's Custom Elements. */
  freeElements: readonly FreeSceneElement[]
  onPatchFreeText: (elementId: string, patch: FreeTextPatch) => void
}) {
  if (target?.kind === 'free-element') {
    const element = freeElements.find((candidate) => candidate.id === target.elementId)
    if (element) {
      const headline = `ESTILOS · ${freeElementLabel(element).toUpperCase()}`
      if (element.kind === 'image') return <Note headline={headline} testId="style-image-note">Imagem: não tem estilo de texto. O arquivo se troca em Assets; posição, encaixe e visibilidade ficam em Elementos.</Note>
      return (
        <Panel headline={headline}>
          <FreeTextStyleControls element={element} tokens={tokens} onPatch={(patch) => onPatchFreeText(element.id, patch)} />
        </Panel>
      )
    }
  }

  if (target?.kind === 'template-element' && template?.layout) {
    const { layout, state, dispatch } = template
    const definition = getLayoutElement(layout, target.elementId)
    if (definition) {
      const headline = `ESTILOS · ${definition.label.toUpperCase()}`
      if (definition.kind !== 'text') return <Note headline={headline} testId="style-nontext-note">{KIND_NOTES[definition.kind]}</Note>
      const capability = elementLocalTypography(layout, definition.id)
      if (!capability) return <Note headline={headline} testId="style-composite-note">Este texto é um bloco composto: o Template define o tamanho de cada parte, então ele segue a Identidade e o layout. O que ele diz está em Conteúdo; onde ele fica, em Elementos.</Note>
      const lineHeightDefault = definition.id === 'title' ? definition.typography?.lineHeight : undefined
      const clearLineHeight = () => {
        const { lineHeight: _removed, ...title } = state.tuning.title
        void _removed
        dispatch({ type: 'SET_TUNING', tuning: { ...state.tuning, title } })
      }
      return (
        <Panel headline={headline}>
          <TemplateTextStyleControls
            capability={capability}
            override={state.typography?.[definition.id]}
            tokens={tokens}
            titleLineHeight={lineHeightDefault !== undefined ? {
              value: state.tuning.title.lineHeight,
              defaultValue: lineHeightDefault,
              min: TITLE_LINE_HEIGHT_BOUNDS.min,
              max: TITLE_LINE_HEIGHT_BOUNDS.max,
              onChange: (value) => dispatch({ type: 'SET_TUNING', tuning: setTuningField(state.tuning, 'title', 'lineHeight', clampTuningValue('title', 'lineHeight', value)) }),
            } : undefined}
            onPatch={(patch) => dispatch({ type: 'SET_TYPOGRAPHY_OVERRIDE', elementId: definition.id, patch })}
            onReset={() => {
              dispatch({ type: 'RESET_TYPOGRAPHY_OVERRIDE', elementId: definition.id })
              if (lineHeightDefault !== undefined && state.tuning.title.lineHeight !== undefined) clearLineHeight()
            }}
          />
        </Panel>
      )
    }
  }

  return <StyleSourcePanel tokens={tokens} free={free} unitLabel={unitLabel} contextHeadline="ESTILOS DA COMPOSIÇÃO" />
}
