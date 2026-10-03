'use client'

import { BrandOwnershipNote, ElementTransformControls, FixedElementNote, FollowsOwnerNote } from '@/components/creative/authoring/primitive-controls'
import { resolveElementCapabilities, transformBindingFor } from '@/lib/creative/authoring/element-capabilities'
import type { AuthoringAction, AuthoringState } from '@/lib/creative/authoring'
import type { EditorElement } from '@/lib/creative/authoring/editor-workspace'
import { STATIC_COVER_CONTENT_FIELDS } from '@/lib/creative/authoring/layout-content-fields'
import { getLayoutElement, type TemplateLayoutDefinition } from '@/lib/creative/templates/template-definitions'
import { SLOT_ORIGIN_LABELS, type SlotResource } from '@/lib/creative/authoring/asset-slots'

/**
 * The open Template Element's own controls — resolved from its CLASS, not wired per Element
 * (CREATIVE_EDITOR_ELEMENT_BASELINE_CAPABILITIES_V1; extracted from the Static editor page by COVER_ELEMENT_COMPLETENESS_V1).
 *
 * `resolveElementCapabilities` decides WHICH controls exist (class baseline + safe extras the Element's source supports +
 * explicit exceptions); the Element's existing binding decides WHERE each value is stored (a material transform channel or a
 * tuning group). Nothing is offered that the authored state and the renderer cannot honour:
 *  - `follows`   an atom anchored to another (a text on its paper, a frame under its image): no spatial control, it takes its
 *                anchor's position and stays an independent Element (own visibility, own paint order);
 *  - `fixed`     Template geometry with a written reason (see FIXED_ELEMENT_EXCEPTIONS): visibility and order only;
 *  - otherwise   Posição X/Y, Rotação, Escala and Opacidade as far as the Element's source stores them (Entrelinha lives in Estilos).
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
  const resolved = resolveElementCapabilities(definition ?? { id: elementId, kind: 'material', control })
  const isText = resolved.elementClass === 'text'

  const provenance = (() => {
    if (isText) return null // Do NOT pretend text has a media asset.
    if (!resolved.capabilities.assetReplace) {
      // A procedural Template unit: no file, no Library identity — and no fake replace control.
      return (
        <div className="border-t border-border/60 pt-3 mt-3">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground block mb-1.5">Recurso</span>
          <div className="flex flex-col gap-0.5 rounded-md border border-border/40 bg-muted/20 p-2 text-[11px]">
             <span className="font-medium text-foreground">Gerado pelo Template</span>
          </div>
        </div>
      )
    }
    if (!resource) return null
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
  })()

  const renderInner = () => {
    if (control.type === 'fixed') return <FixedElementNote isText={isText} reason={resolved.exception?.reason} />
    if (control.type === 'follows') {
      const owner = elements.find((element) => element.key === control.parent)
      const field = state.variant === 'cover' && elementId === 'noteText' ? STATIC_COVER_CONTENT_FIELDS.find((descriptor) => descriptor.key === 'detail_note') : undefined
      return <FollowsOwnerNote ownerLabel={owner?.label ?? control.parent} content={field?.label} />
    }
    const binding = transformBindingFor(control)
    if (!binding) return null
    return (
      <div className="space-y-2">
        <ElementTransformControls
          capabilities={resolved.capabilities}
          fields={binding.fields}
          values={binding.read(state)}
          onChange={(field, value) => dispatch(binding.write(state, field, value))}
          onReset={() => dispatch(binding.reset(state))}
        />
        {resolved.elementClass === 'brandAsset' ? <BrandOwnershipNote projectName={state.productContext?.projectName} /> : null}
      </div>
    )
  }

  return (
    <div>
      {renderInner()}
      {provenance}
    </div>
  )
}
