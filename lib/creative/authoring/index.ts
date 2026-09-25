export type { AuthoringState, AuthoringVariant, AuthoringAppearance, AuthoringIdentity, AuthoringCanvas, AuthoringCoverContent, AuthoringInfoContent, AuthoringFactCard, AuthoringListContent, AuthoringListItem, AuthoringListIcon, AuthoringContent, AuthoringHeroRef, AuthoringHeroAsset, DocumentaryCardPreviewTuning, HeroTuning, TitleTuning, AuthoringPrimitiveSelection, AuthoringPrimitiveTransforms, AuthoringProductContext, PrimitiveTransforms } from './types'
export { AUTHORING_VARIANTS, DEFAULT_TUNING, AUTHORING_HERO_ASSETS, DEFAULT_PRIMITIVE_TRANSFORMS, DEFAULT_PRIMITIVE_TRANSFORMS_STATE } from './types'
export { createInitialAuthoringState, createContextualAuthoringState, resolvePreviewInput, deriveManifestFromState, canvasSpecFromAuthoring, defaultContentForVariant, defaultAppearanceForVariant, variantUsesContentImage, variantHasBrandLabel, TUNING_BOUNDS, clampTuningValue, derivePrimitiveSelectionRequest, derivePrimitiveTransformsRequest, deriveTuningOverrides, deriveElementOrderRequest, deriveHiddenElementsRequest, deriveAssetOverridesRequest, projectRefForIdentity } from './authoring-state'
export { authoringRenderRequestSchema, authoringRenderOverridesSchema, documentaryCardPreviewTuningSchema, parseAuthoringRenderRequest, primitiveSelectionSchema, primitiveTransformsBySlotSchema, templateIdSchema, elementOrderSchema } from './render-request'
export type { AuthoringRenderRequest, AuthoringRenderOverrides, PrimitiveSelectionRequest, PrimitiveTransformsRequest } from './render-request'
export { authoringReducer, getContentAt, LIST_ITEMS_MIN, LIST_ITEMS_MAX } from './reducer'
export type { AuthoringAction, ContentPath } from './reducer'
export { dataUrlToFile, renderOutputFilename } from './render-output'
export { initialSaveStatus, isSavedForCurrent, canSave, startSaving, saveSucceeded, saveFailed, resetForNewRender } from './save-state'
export type { SaveState, RenderSaveStatus } from './save-state'
export { saveRenderToChannelPiece, saveRenderFileToChannelPiece, CHANNEL_PIECE_MEDIA_UPLOAD_ROUTE } from './save-render'
export type { SaveRenderResult } from './save-render'
export {
  STATIC_AUTHORING_STATE_SCHEMA_VERSION,
  PersistedAuthoredSlideSchema,
  StaticAuthoringStateSchema,
  sortedSlides,
  authoringStateToPersistedSlide,
  persistedSlideToAuthoringState,
  defaultCarouselSlides,
  createTemplateSlide,
  nextSlideId,
  nextSlideOrder,
} from './carousel-state'
export type { PersistedAuthoredSlide, StaticAuthoringStateContract, TemplateSlideOptions } from './carousel-state'
