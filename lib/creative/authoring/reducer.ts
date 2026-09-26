import { defaultContentForVariant } from './authoring-state'
import { DEFAULT_PRIMITIVE_TRANSFORMS, DEFAULT_PRIMITIVE_TRANSFORMS_STATE, DEFAULT_TUNING } from './types'
import type { AuthoringAppearance, AuthoringCanvas, AuthoringContent, AuthoringCoverContent, AuthoringHeroRef, AuthoringIdentity, AuthoringInfoContent, AuthoringState, AuthoringVariant, DocumentaryCardPreviewTuning, PrimitiveTransforms } from './types'
import type { PrimitiveTransformSlot } from '@/lib/creative/primitives/transforms'
import type { AuthoringAssetSlotId } from '@/lib/creative/templates/template-definitions'

/** DocumentaryCardListContentSchema item bounds. */
export const LIST_ITEMS_MIN = 2
export const LIST_ITEMS_MAX = 4

/** A location inside a slide's structured content: object keys and array indexes. */
export type ContentPath = readonly (string | number)[]

type Json = Record<string, unknown> | unknown[]

function setIn(value: unknown, path: ContentPath, next: unknown): unknown {
  if (path.length === 0) return next
  const [head, ...rest] = path
  if (Array.isArray(value)) return value.map((item, index) => index === head ? setIn(item, rest, next) : item)
  const record = (value ?? {}) as Record<string, unknown>
  return { ...record, [head]: setIn(record[head as string], rest, next) }
}

function deleteIn(value: unknown, path: ContentPath): unknown {
  if (path.length === 0) return value
  const [head, ...rest] = path
  if (Array.isArray(value)) return rest.length === 0 ? value.filter((_, index) => index !== head) : value.map((item, index) => index === head ? deleteIn(item, rest) : item)
  const record = { ...((value ?? {}) as Record<string, unknown>) }
  if (rest.length === 0) delete record[head as string]
  else record[head as string] = deleteIn(record[head as string], rest)
  return record
}

export function getContentAt(value: unknown, path: ContentPath): unknown {
  return path.reduce<unknown>((current, key) => (current as Json | undefined)?.[key as never], value)
}

export type AuthoringAction =
  | { type: 'SET_VARIANT'; variant: AuthoringVariant }
  | { type: 'SET_APPEARANCE'; appearance: AuthoringAppearance }
  | { type: 'SET_IDENTITY'; identity: AuthoringIdentity }
  | { type: 'SET_CANVAS'; canvas: AuthoringCanvas }
  | { type: 'SET_HERO_REF'; ref: AuthoringHeroRef | undefined }
  | { type: 'SET_COVER_FIELD'; field: keyof AuthoringCoverContent; value: string }
  | { type: 'SET_INFO_FIELD'; field: keyof AuthoringInfoContent; value: string }
  | { type: 'SET_INFO_BODY'; value: string }
  /**
   * Structured layouts (Lista, Grade, Mapa, Rede, Citação, Encerramento): set
   * one value in the slide's content. `optional` fields are REMOVED when set
   * to '' / undefined (their schema requires min(1) when present).
   */
  | { type: 'SET_CONTENT_VALUE'; path: ContentPath; value: unknown; optional?: boolean }
  /** Append an item to a content list, bounded by the layout schema's max. */
  | { type: 'ADD_CONTENT_ITEM'; path: ContentPath; item: unknown; max: number }
  /** Remove one item from a content list, bounded by the layout schema's min. */
  | { type: 'REMOVE_CONTENT_ITEM'; path: ContentPath; index: number; min: number }
  | { type: 'SET_TUNING'; tuning: DocumentaryCardPreviewTuning }
  | { type: 'RESET_TUNING' }
  | { type: 'RESET_CONTENT' }
  | { type: 'SET_PRIMITIVE_PAPER'; key: string | undefined }
  | { type: 'SET_PRIMITIVE_TAPE'; key: string | undefined }
  | { type: 'RESET_PRIMITIVE_PAPER' }
  | { type: 'RESET_PRIMITIVE_TAPE' }
  | { type: 'SET_PRIMITIVE_TRANSFORM'; slot: PrimitiveTransformSlot; field: keyof PrimitiveTransforms; value: number }
  | { type: 'RESET_PRIMITIVE_TRANSFORMS'; slot: PrimitiveTransformSlot }
  /** Template Foundation V1: authored stack for the current slide (paint order, back -> front, already normalized by the caller). */
  | { type: 'SET_ELEMENT_ORDER'; order: string[] }
  /** Back to the template layout's default stack. */
  | { type: 'RESET_ELEMENT_ORDER' }
  /** Static Detail Polish V1 — Camadas eye: show/hide ONE element (authored; stack, transform and tuning untouched). */
  | { type: 'TOGGLE_ELEMENT_VISIBILITY'; id: string }
  /** Assets "Trocar": a Project LibraryFile fills this slot. */
  | { type: 'SET_ASSET_OVERRIDE'; slot: AuthoringAssetSlotId; libraryFileId: string }
  /** Assets "Usar padrão": drop the slot's Project resource (override AND catalog primitive) -> Template default. */
  | { type: 'USE_TEMPLATE_DEFAULT_ASSET'; slot: AuthoringAssetSlotId }

/** The bounded structured-content actions (the ones LayoutContentForm dispatches). */
export type ContentAction = Extract<AuthoringAction, { type: 'SET_CONTENT_VALUE' | 'ADD_CONTENT_ITEM' | 'REMOVE_CONTENT_ITEM' }>

export function isContentAction(action: { type: string }): action is ContentAction {
  return action.type === 'SET_CONTENT_VALUE' || action.type === 'ADD_CONTENT_ITEM' || action.type === 'REMOVE_CONTENT_ITEM'
}

/**
 * Pure structured-content edit, shared by the Static slide reducer and the
 * Video Scene composition (VIDEO_SCENE_COMPOSITION_PARITY_V1). Returns the
 * SAME reference when a bounded list edit is refused (min/max).
 */
export function applyContentAction(content: unknown, action: ContentAction): unknown {
  switch (action.type) {
    case 'SET_CONTENT_VALUE': {
      const cleared = action.value === undefined || action.value === ''
      return action.optional && cleared ? deleteIn(content, action.path) : setIn(content, action.path, action.value)
    }
    case 'ADD_CONTENT_ITEM': {
      const list = getContentAt(content, action.path)
      const items = Array.isArray(list) ? list : []
      if (items.length >= action.max) return content
      return setIn(content, action.path, [...items, action.item])
    }
    case 'REMOVE_CONTENT_ITEM': {
      const list = getContentAt(content, action.path)
      if (!Array.isArray(list) || list.length <= action.min) return content
      return setIn(content, action.path, list.filter((_, index) => index !== action.index))
    }
  }
}

export function authoringReducer(state: AuthoringState, action: AuthoringAction): AuthoringState {
  switch (action.type) {
    // A layout switch changes the element set, so an authored stack for the old layout no longer applies.
    case 'SET_VARIANT': return { ...state, variant: action.variant, heroRef: undefined, contentOverride: defaultContentForVariant(action.variant, state.identity), elementOrder: undefined }
    // Slice 1 — Portal Carousel V1: appearance is independent of variant, so
    // switching variant deliberately does NOT touch it here.
    case 'SET_APPEARANCE': return { ...state, appearance: action.appearance }
    case 'SET_IDENTITY': return { ...state, identity: action.identity, heroRef: undefined, contentOverride: defaultContentForVariant(state.variant, action.identity), primitiveSelection: action.identity === 'a' ? { paper: 'paper-card-light-01', tape: 'tape-kraft-short-01' } : {}, primitiveTransforms: { ...DEFAULT_PRIMITIVE_TRANSFORMS_STATE } }
    case 'SET_CANVAS': return { ...state, canvas: action.canvas }
    case 'SET_HERO_REF': return { ...state, heroRef: action.ref }
    case 'SET_COVER_FIELD': return { ...state, contentOverride: { ...(state.contentOverride as AuthoringCoverContent), [action.field]: action.value } }
    case 'SET_INFO_FIELD': return { ...state, contentOverride: { ...(state.contentOverride as AuthoringInfoContent), [action.field]: action.value } }
    case 'SET_INFO_BODY': return { ...state, contentOverride: { ...(state.contentOverride as AuthoringInfoContent), body_blocks: action.value.split('\n').filter(Boolean) } }
    case 'SET_CONTENT_VALUE':
    case 'ADD_CONTENT_ITEM':
    case 'REMOVE_CONTENT_ITEM': {
      const contentOverride = applyContentAction(state.contentOverride, action)
      return contentOverride === state.contentOverride ? state : { ...state, contentOverride: contentOverride as AuthoringContent }
    }
    case 'SET_TUNING': return { ...state, tuning: action.tuning }
    case 'RESET_TUNING': return { ...state, tuning: DEFAULT_TUNING }
    case 'RESET_CONTENT': return { ...state, contentOverride: defaultContentForVariant(state.variant, state.identity), heroRef: undefined }
    case 'SET_PRIMITIVE_PAPER': return { ...state, primitiveSelection: { ...state.primitiveSelection, paper: action.key }, primitiveTransforms: { ...state.primitiveTransforms, paper: { ...DEFAULT_PRIMITIVE_TRANSFORMS } } }
    case 'SET_PRIMITIVE_TAPE': return { ...state, primitiveSelection: { ...state.primitiveSelection, tape: action.key }, primitiveTransforms: { ...state.primitiveTransforms, tape: { ...DEFAULT_PRIMITIVE_TRANSFORMS } } }
    case 'RESET_PRIMITIVE_PAPER': return { ...state, primitiveSelection: { ...state.primitiveSelection, paper: 'paper-card-light-01' }, primitiveTransforms: { ...state.primitiveTransforms, paper: { ...DEFAULT_PRIMITIVE_TRANSFORMS } } }
    case 'RESET_PRIMITIVE_TAPE': return { ...state, primitiveSelection: { ...state.primitiveSelection, tape: 'tape-kraft-short-01' }, primitiveTransforms: { ...state.primitiveTransforms, tape: { ...DEFAULT_PRIMITIVE_TRANSFORMS } } }
    case 'SET_PRIMITIVE_TRANSFORM': return { ...state, primitiveTransforms: { ...state.primitiveTransforms, [action.slot]: { ...(state.primitiveTransforms[action.slot] ?? DEFAULT_PRIMITIVE_TRANSFORMS), [action.field]: action.value } } }
    case 'RESET_PRIMITIVE_TRANSFORMS': return { ...state, primitiveTransforms: { ...state.primitiveTransforms, [action.slot]: { ...DEFAULT_PRIMITIVE_TRANSFORMS } } }
    case 'SET_ELEMENT_ORDER': return { ...state, elementOrder: [...action.order] }
    case 'TOGGLE_ELEMENT_VISIBILITY': {
      const current = state.hiddenElements ?? []
      const next = current.includes(action.id) ? current.filter((id) => id !== action.id) : [...current, action.id]
      return { ...state, hiddenElements: next.length > 0 ? next : undefined }
    }
    case 'RESET_ELEMENT_ORDER': return { ...state, elementOrder: undefined }
    case 'SET_ASSET_OVERRIDE': return { ...state, assetOverrides: { ...(state.assetOverrides ?? {}), [action.slot]: { libraryFileId: action.libraryFileId } } }
    case 'USE_TEMPLATE_DEFAULT_ASSET': {
      const { [action.slot]: _removed, ...rest } = state.assetOverrides ?? {}
      void _removed
      const primitiveSelection = action.slot === 'paper' || action.slot === 'tape'
        ? Object.fromEntries(Object.entries(state.primitiveSelection).filter(([key]) => key !== action.slot))
        : state.primitiveSelection
      return { ...state, primitiveSelection, assetOverrides: Object.keys(rest).length > 0 ? rest : undefined }
    }
    default: return state
  }
}
