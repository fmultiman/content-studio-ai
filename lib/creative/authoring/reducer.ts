import { defaultContentForVariant } from './authoring-state'
import { DEFAULT_PRIMITIVE_TRANSFORMS, DEFAULT_PRIMITIVE_TRANSFORMS_STATE, DEFAULT_TUNING } from './types'
import type { AuthoringAppearance, AuthoringCanvas, AuthoringCoverContent, AuthoringHeroRef, AuthoringIdentity, AuthoringInfoContent, AuthoringListContent, AuthoringListItem, AuthoringState, AuthoringVariant, DocumentaryCardPreviewTuning, PrimitiveTransforms } from './types'

/** DocumentaryCardListContentSchema bounds. */
export const LIST_ITEMS_MIN = 2
export const LIST_ITEMS_MAX = 4
import type { PrimitiveTransformSlot } from '@/lib/creative/primitives/transforms'
import type { AuthoringAssetSlotId } from '@/lib/creative/templates/template-definitions'

export type AuthoringAction =
  | { type: 'SET_VARIANT'; variant: AuthoringVariant }
  | { type: 'SET_APPEARANCE'; appearance: AuthoringAppearance }
  | { type: 'SET_IDENTITY'; identity: AuthoringIdentity }
  | { type: 'SET_CANVAS'; canvas: AuthoringCanvas }
  | { type: 'SET_HERO_REF'; ref: AuthoringHeroRef | undefined }
  | { type: 'SET_COVER_FIELD'; field: keyof AuthoringCoverContent; value: string }
  | { type: 'SET_INFO_FIELD'; field: keyof AuthoringInfoContent; value: string }
  | { type: 'SET_INFO_BODY'; value: string }
  /** Layout "Lista": text fields (title / intro / image_caption). */
  | { type: 'SET_LIST_FIELD'; field: 'title' | 'intro' | 'image_caption'; value: string }
  | { type: 'SET_LIST_ITEM'; index: number; item: Partial<AuthoringListItem> }
  /** Bounded by the Lista schema: 2..4 items. */
  | { type: 'ADD_LIST_ITEM' }
  | { type: 'REMOVE_LIST_ITEM'; index: number }
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
  /** Assets "Trocar": a Project LibraryFile fills this slot. */
  | { type: 'SET_ASSET_OVERRIDE'; slot: AuthoringAssetSlotId; libraryFileId: string }
  /** Assets "Usar padrão": drop the slot's Project resource (override AND catalog primitive) -> Template default. */
  | { type: 'USE_TEMPLATE_DEFAULT_ASSET'; slot: AuthoringAssetSlotId }

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
    case 'SET_LIST_FIELD': {
      const content = state.contentOverride as AuthoringListContent
      // Optional fields are omitted when cleared (the schema requires min(1) when present).
      if (action.field !== 'title' && !action.value) {
        const { [action.field]: _cleared, ...rest } = content
        void _cleared
        return { ...state, contentOverride: rest as AuthoringListContent }
      }
      return { ...state, contentOverride: { ...content, [action.field]: action.value } }
    }
    case 'SET_LIST_ITEM': {
      const content = state.contentOverride as AuthoringListContent
      return { ...state, contentOverride: { ...content, items: content.items.map((item, index) => index === action.index ? { ...item, ...action.item } : item) } }
    }
    case 'ADD_LIST_ITEM': {
      const content = state.contentOverride as AuthoringListContent
      if (content.items.length >= LIST_ITEMS_MAX) return state
      return { ...state, contentOverride: { ...content, items: [...content.items, { icon: 'book', text: 'Novo item' }] } }
    }
    case 'REMOVE_LIST_ITEM': {
      const content = state.contentOverride as AuthoringListContent
      if (content.items.length <= LIST_ITEMS_MIN) return state
      return { ...state, contentOverride: { ...content, items: content.items.filter((_, index) => index !== action.index) } }
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
