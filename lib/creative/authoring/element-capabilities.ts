/**
 * CREATIVE_EDITOR_ELEMENT_BASELINE_CAPABILITIES_V1 — the lightweight UI capability registry of Template Elements.
 *
 * It answers ONE question for the Inspector: "which controls are valid for this Element?". It is NOT a second source of
 * authored state and persists nothing: every value still lives where it always lived (`hiddenElements` for visibility,
 * `primitiveTransforms` / `tuning` for placement, `assetOverrides` for resources, `elementOrder` for paint order,
 * `typography` for local type). The class decides WHETHER a control exists; the binding below decides HOW the value is
 * stored — the UI can be uniform while persistence stays domain-specific.
 *
 * Principle: Template constraints protect composition grammar; they do not arbitrarily remove safe manipulation
 * from a user-selectable Element. A visual class therefore has a BASELINE (a floor, never a ceiling: a control a source
 * supports beyond it stays), and the only way to omit a baseline capability is an explicit SEMANTIC exception (see
 * CapabilityExceptionReason): an Element that `follows` its owner, or a `fixed` unit whose geometry is derived from another
 * Template unit, with the evidence written down. "Not implemented yet" is never an exception. Omission by
 * "this component forgot to wire it" is not a state the model allows: `missingBaseline` reports it and the registry
 * test fails on it.
 *
 * Lives beside (not inside) template-definitions.ts: that file is bundled verbatim by the render worker and stays pure
 * data; this module is Editor-only and never read by the renderer.
 */
import type { AuthoringAction } from './reducer'
import { resetTuningGroup, setTuningField, type TuningGroup } from './authoring-state'
import {
  MATERIAL_TRANSFORM_POLICY,
  policyForTuningField,
  type NumericRangePolicy,
} from './numeric-policy'
import { DEFAULT_PRIMITIVE_TRANSFORMS, type AuthoringState } from './types'
import type { TemplateElementControl, TemplateElementDefinition } from '@/lib/creative/templates/template-definitions'

// ── Class model ───────────────────────────────────────────────────────────────

/**
 * Shared manipulation semantics, derived from the Element's Template identity (`kind` + asset slot) — never listed per
 * Element:
 *  - text              any text Element (kind 'text');
 *  - contentImage      the layout's content image, filled from the Project Library ('hero' slot);
 *  - brandAsset        the brand signature artwork ('logo' slot) — ONE complete logo;
 *  - decorativeAsset   a replaceable collage material (paper, tape, pin, botanical, archival, ornament);
 *  - proceduralVisual  a code-drawn unit with Element identity but no file (frame, map, links, rule).
 */
export type ElementClass = 'text' | 'contentImage' | 'brandAsset' | 'decorativeAsset' | 'proceduralVisual'

export function elementClassOf(definition: Pick<TemplateElementDefinition, 'kind' | 'assetSlot'>): ElementClass {
  if (definition.kind === 'text') return 'text'
  if (definition.kind === 'shape') return 'proceduralVisual'
  if (definition.kind === 'image') return definition.assetSlot === 'logo' ? 'brandAsset' : 'contentImage'
  return 'decorativeAsset'
}

// ── Capabilities and baseline ─────────────────────────────────────────────────

export type ElementCapability = 'visibility' | 'position' | 'scale' | 'rotation' | 'opacity' | 'assetReplace'

const VISUAL_BASELINE: readonly ElementCapability[] = ['visibility', 'position', 'scale', 'rotation', 'opacity']

/** The FLOOR of each class. Text has no Size/Opacity here: Size is typography (Estilos) and text opacity is not classified. */
export const ELEMENT_CLASS_BASELINE: Readonly<Record<ElementClass, readonly ElementCapability[]>> = {
  text: ['visibility', 'position', 'rotation'],
  contentImage: [...VISUAL_BASELINE, 'assetReplace'],
  brandAsset: [...VISUAL_BASELINE, 'assetReplace'],
  decorativeAsset: [...VISUAL_BASELINE, 'assetReplace'],
  // A procedural unit is drawn by the Template: it never pretends to have a file or a Library identity.
  proceduralVisual: VISUAL_BASELINE,
}

// ── Explicit exceptions ───────────────────────────────────────────────────────

/**
 * Why an Element may legitimately omit the spatial baseline. ONLY a semantic relationship qualifies:
 *  - follows-owner         its place is the place of its owner (text printed on a paper, a frame under its image, pins on a map);
 *  - derived-geometry      its geometry is structurally derived from another Template unit;
 *  - compound-relationship moving it alone would break an intentional compound Template relationship.
 * "Not implemented yet", "deferred", "fixed in the current code" and "the component does not support it" are NOT reasons: an
 * Element that merely lacks wiring gets the missing control (or its class is corrected), never an exception.
 */
export type CapabilityExceptionReason = 'follows-owner' | 'derived-geometry' | 'compound-relationship'
export const SEMANTIC_EXCEPTION_REASONS: readonly CapabilityExceptionReason[] = ['follows-owner', 'derived-geometry', 'compound-relationship']

export const CAPABILITY_EXCEPTION_EXPLANATIONS: Readonly<Record<CapabilityExceptionReason, string>> = {
  'follows-owner': "Its place is its owner Element's place: it takes the owner's position, rotation, scale and opacity, and stays independent only in visibility and paint order.",
  'derived-geometry': 'Its geometry is structurally derived from another Template unit, so it has no placement of its own.',
  'compound-relationship': 'Moving it alone would break an intentional compound Template relationship with another unit.',
}

/**
 * `control: { type: 'fixed' }` Elements that omit the spatial baseline, with the SEMANTIC relationship that justifies it
 * (`evidence` names the Template unit it depends on). Deliberately EMPTY: the audit found every formerly fixed Element
 * (Info Texto principal / Anotação / Faixa da chamada / Aba da marca, the `intro` / `kicker` / Itens / Legenda / Tópicos /
 * Texto de apoio / Frase final text blocks, Encerramento's Linha pontilhada) was only unwired — Cover already positions the same
 * roles through tuning and Grade's compound block through a transform channel — so each got its authored placement instead.
 * A `fixed` Element without an entry here is reported by `missingBaseline` and fails the registry test.
 */
export const SEMANTIC_FIXED_EXCEPTIONS: Readonly<Record<string, { reason: Exclude<CapabilityExceptionReason, 'follows-owner'>; evidence: string }>> = {}

/** The spatial capabilities an Element loses under an exception. Visibility and paint order are never omitted. */
const SPATIAL: readonly ElementCapability[] = ['position', 'scale', 'rotation', 'opacity']

// ── State binding: HOW each control is stored (existing sources only) ────────

export type TransformField = 'offsetX' | 'offsetY' | 'rotation' | 'scale' | 'opacity'
export const TRANSFORM_FIELDS: readonly TransformField[] = ['offsetX', 'offsetY', 'rotation', 'scale', 'opacity']
export type TransformFieldSpec = {
  /** Soft slider minimum for comfortable UI manipulation. */
  sliderMin: number
  /** Soft slider maximum for comfortable UI manipulation. */
  sliderMax: number
  /** Hard safety minimum: rejects invalid values, protects renderer/schema stability. */
  hardMin: number
  /** Hard safety maximum: protects renderer/schema stability, layout bounds. */
  hardMax: number
  /** Slider step increment. */
  step: number
  /** Decimal precision for numeric display/input (0 = integer, 1, 2). */
  precision: number
  /** Backwards compatibility alias for sliderMin. */
  min: number
  /** Backwards compatibility alias for sliderMax. */
  max: number
}
export type TransformFieldSpecs = Readonly<Partial<Record<TransformField, TransformFieldSpec>>>

/**
 * CREATIVE_EDITOR_NUMERIC_RANGE_AND_SLIDER_POLICY_V1
 * Material transform channels: soft slider ranges for comfortable interaction,
 * wide hard bounds for safety and stability.
 */
const TRANSFORM_CHANNEL_SPECS: TransformFieldSpecs = {
  offsetX: {
    ...MATERIAL_TRANSFORM_POLICY.offsetX,
    min: MATERIAL_TRANSFORM_POLICY.offsetX.sliderMin,
    max: MATERIAL_TRANSFORM_POLICY.offsetX.sliderMax,
  },
  offsetY: {
    ...MATERIAL_TRANSFORM_POLICY.offsetY,
    min: MATERIAL_TRANSFORM_POLICY.offsetY.sliderMin,
    max: MATERIAL_TRANSFORM_POLICY.offsetY.sliderMax,
  },
  rotation: {
    ...MATERIAL_TRANSFORM_POLICY.rotation,
    min: MATERIAL_TRANSFORM_POLICY.rotation.sliderMin,
    max: MATERIAL_TRANSFORM_POLICY.rotation.sliderMax,
  },
  scale: {
    ...MATERIAL_TRANSFORM_POLICY.scale,
    min: MATERIAL_TRANSFORM_POLICY.scale.sliderMin,
    max: MATERIAL_TRANSFORM_POLICY.scale.sliderMax,
  },
  opacity: {
    ...MATERIAL_TRANSFORM_POLICY.opacity,
    min: MATERIAL_TRANSFORM_POLICY.opacity.sliderMin,
    max: MATERIAL_TRANSFORM_POLICY.opacity.sliderMax,
  },
}

/** Which authored fields each tuning group stores. */
const TUNING_GROUP_FIELDS: Readonly<Record<TuningGroup, readonly TransformField[]>> = {
  hero: ['offsetX', 'offsetY', 'rotation', 'scale', 'opacity'],
  brand: ['offsetX', 'offsetY', 'rotation', 'scale', 'opacity'],
  title: ['offsetX', 'offsetY', 'rotation'],
  source: ['offsetX', 'offsetY', 'rotation'],
  kicker: ['offsetX', 'offsetY', 'rotation'],
  intro: ['offsetX', 'offsetY', 'rotation'],
  body: ['offsetX', 'offsetY', 'rotation'],
  annotation: ['offsetX', 'offsetY', 'rotation'],
  items: ['offsetX', 'offsetY', 'rotation'],
  legend: ['offsetX', 'offsetY', 'rotation'],
  bullets: ['offsetX', 'offsetY', 'rotation'],
  tagline: ['offsetX', 'offsetY', 'rotation'],
}

function tuningSpecs(group: TuningGroup): TransformFieldSpecs {
  return Object.fromEntries(
    TUNING_GROUP_FIELDS[group].map((field) => {
      const policy = policyForTuningField(group, field)
      if (!policy) throw new Error(`policyForTuningField is missing for ${group}.${field}`)
      return [
        field,
        {
          ...policy,
          min: policy.sliderMin,
          max: policy.sliderMax,
        },
      ]
    }),
  )
}

export type ElementTransformBinding = {
  /** Where the value lives: a per-Element transform channel, or the slide's tuning group. */
  source: 'transform-channel' | 'tuning'
  /** The fields this source stores, with their current ranges. A field absent here cannot be offered. */
  fields: TransformFieldSpecs
  /** Effective values (an unauthored field reads its Template default). */
  read: (state: AuthoringState) => Record<TransformField, number>
  /** The existing action that stores ONE field in its existing source. */
  write: (state: AuthoringState, field: TransformField, value: number) => AuthoringAction
  /** The existing action that restores the Template default of this Element's placement. */
  reset: (state: AuthoringState) => AuthoringAction
}

/** null = the control gives the Element no spatial state of its own (`follows` / `fixed`). */
export function transformBindingFor(control: TemplateElementControl): ElementTransformBinding | null {
  if (control.type === 'follows' || control.type === 'fixed') return null
  if (control.type === 'transform') {
    const slot = control.key
    return {
      source: 'transform-channel',
      fields: TRANSFORM_CHANNEL_SPECS,
      read: (state) => ({ ...DEFAULT_PRIMITIVE_TRANSFORMS, ...state.primitiveTransforms[slot] }),
      write: (_state, field, value) => ({ type: 'SET_PRIMITIVE_TRANSFORM', slot, field, value }),
      reset: () => ({ type: 'RESET_PRIMITIVE_TRANSFORMS', slot }),
    }
  }
  const group = control.group
  return {
    source: 'tuning',
    fields: tuningSpecs(group),
    read: (state) => ({ ...DEFAULT_PRIMITIVE_TRANSFORMS, ...(state.tuning[group] as Partial<Record<TransformField, number>> | undefined) }),
    write: (state, field, value) => ({ type: 'SET_TUNING', tuning: setTuningField(state.tuning, group, field, value) }),
    reset: (state) => ({ type: 'SET_TUNING', tuning: resetTuningGroup(state.tuning, group) }),
  }
}

// ── Resolver ──────────────────────────────────────────────────────────────────

export type ResolvedElementCapabilities = {
  elementClass: ElementClass
  /** What the Inspector offers. Derived; never persisted. */
  capabilities: Readonly<Record<ElementCapability, boolean>>
  /** Set when the Element omits the spatial baseline on purpose; the explanation is the visible reason. */
  exception: { reason: CapabilityExceptionReason; explanation: string } | null
  /**
   * Baseline capabilities the Element lacks WITHOUT a documented exception (a source that cannot store a baseline
   * field). Must be [] for every Template Element — the registry test enforces it, so a gap is a failing build, not a
   * silently missing control.
   */
  missingBaseline: readonly ElementCapability[]
}

const SPATIAL_FIELDS: Readonly<Record<'position' | 'scale' | 'rotation' | 'opacity', readonly TransformField[]>> = {
  position: ['offsetX', 'offsetY'],
  scale: ['scale'],
  rotation: ['rotation'],
  opacity: ['opacity'],
}

export function resolveElementCapabilities(definition: Pick<TemplateElementDefinition, 'kind' | 'assetSlot' | 'control' | 'id'>): ResolvedElementCapabilities {
  const elementClass = elementClassOf(definition)
  const baseline = ELEMENT_CLASS_BASELINE[elementClass]
  const binding = transformBindingFor(definition.control)

  const exceptionReason: CapabilityExceptionReason | null = definition.control.type === 'follows'
    ? 'follows-owner'
    : definition.control.type === 'fixed' ? (SEMANTIC_FIXED_EXCEPTIONS[definition.id]?.reason ?? null) : null
  const exception = exceptionReason ? { reason: exceptionReason, explanation: CAPABILITY_EXCEPTION_EXPLANATIONS[exceptionReason] } : null

  // A spatial capability exists exactly when the Element's existing source can store it (so no control is ever offered
  // that the authored state and the renderer cannot honour) — including safe extras beyond the class floor.
  const supports = (capability: keyof typeof SPATIAL_FIELDS) => Boolean(binding) && SPATIAL_FIELDS[capability].every((field) => binding!.fields[field])
  const capabilities: Record<ElementCapability, boolean> = {
    visibility: true,
    position: supports('position'),
    scale: supports('scale'),
    rotation: supports('rotation'),
    opacity: supports('opacity'),
    assetReplace: baseline.includes('assetReplace') && Boolean(definition.assetSlot),
  }

  const missingBaseline = baseline.filter((capability) => {
    if (capabilities[capability]) return false
    // Omission is allowed only under a documented exception (a `fixed` Element with no semantic entry has none), and only for the spatial capabilities.
    return !(exception && SPATIAL.includes(capability))
  })
  return { elementClass, capabilities, exception, missingBaseline }
}
