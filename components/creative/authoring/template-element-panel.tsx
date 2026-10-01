'use client'

import { BrandOwnershipNote, FixedElementNote, FollowsOwnerNote, HeroTuningControls, PrimitiveTransformControls, TitleTuningControls } from '@/components/creative/authoring/primitive-controls'
import { DEFAULT_POSITION_TUNING, DEFAULT_PRIMITIVE_TRANSFORMS, resetTuningGroup, setTuningField, type AuthoringAction, type AuthoringState, type TuningGroup } from '@/lib/creative/authoring'
import type { EditorElement } from '@/lib/creative/authoring/editor-workspace'
import { STATIC_COVER_CONTENT_FIELDS } from '@/lib/creative/authoring/layout-content-fields'
import { getLayoutElement, type TemplateLayoutDefinition } from '@/lib/creative/templates/template-definitions'

/**
 * The open Template Element's own controls: exactly what its Template control contract supports
 * (COVER_ELEMENT_COMPLETENESS_V1 extracted this from the Static editor page so the same code is
 * testable). Nothing here is offered that the renderer/authored state cannot honour:
 *  - `follows`   an atom anchored to another (a text on its paper, a frame under its image): no spatial control, it takes its
 *                anchor's position and stays an independent Element (own visibility, own paint order);
 *  - `fixed`     Template geometry (STATIC_TEMPLATE_ATOMIC_VISUAL_ELEMENTS_V1): visibility and order only;
 *  - `tuning`    bounded X/Y/rotation (Entrelinha lives in Estilos);
 *  - `transform` the material sliders.
 */
export function TemplateElementPanel({ elementId, state, layout, elements, dispatch }: {
  elementId: string
  state: AuthoringState
  layout: TemplateLayoutDefinition | null | undefined
  elements: readonly EditorElement[]
  dispatch: (action: AuthoringAction) => void
}) {
  const control = elements.find((element) => element.key === elementId)?.control
  if (!control) return null
  const set = (group: TuningGroup, field: string, value: number) => dispatch({ type: 'SET_TUNING', tuning: setTuningField(state.tuning, group, field, value) })
  const reset = (group: TuningGroup) => dispatch({ type: 'SET_TUNING', tuning: resetTuningGroup(state.tuning, group) })

  const definition = layout ? getLayoutElement(layout, elementId) : null
  if (control.type === 'fixed') return <FixedElementNote isText={definition?.kind === 'text'} />
  if (control.type === 'follows') {
    const owner = elements.find((element) => element.key === control.parent)
    const field = state.variant === 'cover' && elementId === 'noteText' ? STATIC_COVER_CONTENT_FIELDS.find((descriptor) => descriptor.key === 'detail_note') : undefined
    return <FollowsOwnerNote ownerLabel={owner?.label ?? control.parent} content={field?.label} />
  }
  if (control.type === 'tuning' && control.group === 'hero') {
    return <HeroTuningControls tuning={state.tuning.hero} onChange={(field, value) => set('hero', field, value)} onReset={() => reset('hero')} />
  }
  if (control.type === 'tuning') {
    const group = control.group
    // CREATIVE_EDITOR_CONTEXTUAL_STYLES_AND_TYPOGRAPHY_V1: Entrelinha (how the text looks) moved to ESTILOS · Título; it still
    // edits the same `tuning.title.lineHeight`. Elementos keeps only WHERE the Element is.
    return (
      <div className="space-y-2">
        <TitleTuningControls tuning={{ ...DEFAULT_POSITION_TUNING, ...state.tuning[group] }} onChange={(field, value) => set(group, field, value)} onReset={() => reset(group)} />
        {group === 'brand' ? <BrandOwnershipNote projectName={state.productContext?.projectName} /> : null}
      </div>
    )
  }
  const key = control.key
  return (
    <PrimitiveTransformControls
      slot={key}
      transforms={state.primitiveTransforms[key] ?? DEFAULT_PRIMITIVE_TRANSFORMS}
      onChange={(field, value) => dispatch({ type: 'SET_PRIMITIVE_TRANSFORM', slot: key, field, value })}
      onReset={() => dispatch({ type: 'RESET_PRIMITIVE_TRANSFORMS', slot: key })}
    />
  )
}
