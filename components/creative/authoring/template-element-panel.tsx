'use client'

import { BrandOwnershipNote, FixedElementNote, FollowsOwnerNote, HeroTuningControls, PrimitiveTransformControls, TitleTuningControls } from '@/components/creative/authoring/primitive-controls'
import { DEFAULT_POSITION_TUNING, DEFAULT_PRIMITIVE_TRANSFORMS, resetTuningGroup, setTuningField, type AuthoringAction, type AuthoringState, type TuningGroup } from '@/lib/creative/authoring'
import type { EditorElement } from '@/lib/creative/authoring/editor-workspace'
import { STATIC_COVER_CONTENT_FIELDS } from '@/lib/creative/authoring/layout-content-fields'
import { getLayoutElement, type TemplateLayoutDefinition } from '@/lib/creative/templates/template-definitions'
import { SLOT_ORIGIN_LABELS, type SlotResource } from '@/lib/creative/authoring/asset-slots'

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
export function TemplateElementPanel({ elementId, state, layout, elements, dispatch, resource }: {
  elementId: string
  state: AuthoringState
  layout: TemplateLayoutDefinition | null | undefined
  elements: readonly EditorElement[]
  dispatch: (action: AuthoringAction) => void
  resource?: SlotResource
}) {
  const control = elements.find((element) => element.key === elementId)?.control
  if (!control) return null

  const definition = layout ? getLayoutElement(layout, elementId) : null
  const isText = definition?.kind === 'text'

  const provenance = (() => {
    if (isText) return null // Do NOT pretend text has a media asset.
    if (resource) {
      return (
        <div className="border-t border-border/60 pt-3 mt-3">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground block mb-1.5">Recurso usado</span>
          <div className="flex flex-col gap-0.5 rounded-md border border-border/40 bg-muted/20 p-2 text-[11px]">
             <span className="font-medium text-foreground truncate" title={resource.name}>{resource.name}</span>
             <span className="text-muted-foreground flex gap-1">
               Origem: {SLOT_ORIGIN_LABELS[resource.origin] ?? resource.origin}
             </span>
             <span className="text-muted-foreground pt-1.5 italic">— Pode ser trocado em Assets</span>
          </div>
        </div>
      )
    }
    // No resource, not text -> Procedural Template element
    return (
      <div className="border-t border-border/60 pt-3 mt-3">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground block mb-1.5">Recurso</span>
        <div className="flex flex-col gap-0.5 rounded-md border border-border/40 bg-muted/20 p-2 text-[11px]">
           <span className="font-medium text-foreground">Gerado pelo Template</span>
        </div>
      </div>
    )
  })()

  // Inner controls rendering
  const renderInner = () => {
    const set = (group: TuningGroup, field: string, value: number) => dispatch({ type: 'SET_TUNING', tuning: setTuningField(state.tuning, group, field, value) })
    const reset = (group: TuningGroup) => dispatch({ type: 'SET_TUNING', tuning: resetTuningGroup(state.tuning, group) })

    if (control.type === 'fixed') return <FixedElementNote isText={isText} />
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

  return (
    <div>
      {renderInner()}
      {provenance}
    </div>
  )
}
