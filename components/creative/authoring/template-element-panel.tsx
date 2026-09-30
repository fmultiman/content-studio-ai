'use client'

import { BrandOwnershipNote, FollowsOwnerNote, HeroTuningControls, PrimitiveTransformControls, TitleTuningControls } from '@/components/creative/authoring/primitive-controls'
import { DEFAULT_POSITION_TUNING, DEFAULT_PRIMITIVE_TRANSFORMS, resetTuningGroup, setHeroFrame, setTuningField, type AuthoringAction, type AuthoringState, type TuningGroup } from '@/lib/creative/authoring'
import type { EditorElement } from '@/lib/creative/authoring/editor-workspace'
import { STATIC_COVER_CONTENT_FIELDS } from '@/lib/creative/authoring/layout-content-fields'
import { TITLE_LINE_HEIGHT_BOUNDS, getLayoutElement, type TemplateLayoutDefinition } from '@/lib/creative/templates/template-definitions'

/**
 * The open Template Element's own controls: exactly what its Template control contract supports
 * (COVER_ELEMENT_COMPLETENESS_V1 extracted this from the Static editor page so the same code is
 * testable). Nothing here is offered that the renderer/authored state cannot honour:
 *  - `follows`   a semantic child (Cover's Nota da edição): no spatial control, it follows its owner;
 *  - `tuning`    bounded X/Y/rotation (+ Entrelinha where declared; + the Hero's frame option where declared);
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

  if (control.type === 'follows') {
    const owner = elements.find((element) => element.key === control.parent)
    const field = STATIC_COVER_CONTENT_FIELDS.find((descriptor) => descriptor.key === 'detail_note')
    return <FollowsOwnerNote ownerLabel={owner?.label ?? control.parent} content={field?.label} />
  }
  if (control.type === 'tuning' && control.group === 'hero') {
    const framed = layout ? Boolean(getLayoutElement(layout, elementId)?.presentation?.frame) : false
    return (
      <HeroTuningControls
        tuning={state.tuning.hero}
        onChange={(field, value) => set('hero', field, value)}
        onReset={() => reset('hero')}
        frame={framed ? { framed: state.tuning.hero.frame !== false, onChange: (next) => dispatch({ type: 'SET_TUNING', tuning: setHeroFrame(state.tuning, next) }) } : undefined}
      />
    )
  }
  if (control.type === 'tuning') {
    const group = control.group
    const typography = layout ? getLayoutElement(layout, elementId)?.typography : undefined
    const lineHeight = group === 'title' && typography ? { defaultValue: typography.lineHeight, min: TITLE_LINE_HEIGHT_BOUNDS.min, max: TITLE_LINE_HEIGHT_BOUNDS.max } : undefined
    return (
      <div className="space-y-2">
        <TitleTuningControls tuning={{ ...DEFAULT_POSITION_TUNING, ...state.tuning[group] }} lineHeight={lineHeight} onChange={(field, value) => set(group, field, value)} onReset={() => reset(group)} />
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
