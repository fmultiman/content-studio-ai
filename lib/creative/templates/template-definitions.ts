/**
 * Creative Editor Template Foundation V1 — the product-level Template registry.
 *
 * A TemplateDefinition gives the code-backed renderer an explicit product
 * identity: a reusable visual SYSTEM with its own template-scoped layouts,
 * supported appearances, semantic asset slots, authored elements and a
 * default element stack per layout. It is NOT:
 *  - a ChannelPiece-owned record (a piece only references `templateId`);
 *  - an appearance ("Light"/"Dark" are appearances OF a layout);
 *  - a generic JSON scene graph — rendering stays code-backed through the
 *    renderer identified by `renderer` (DocumentaryCard today);
 *  - a database catalog (deliberately deferred — see
 *    docs/productization/creative-rendering/CREATIVE_EDITOR_TEMPLATE_FOUNDATION_V1.md).
 *
 * Renderer-shared: DocumentaryCard (Editor preview AND the VPS worker's
 * Remotion bundle) reads layout element lists and default stacks from here,
 * so this module must stay pure data + pure functions with no imports.
 */

export const EDITORIAL_DOCUMENTARY_COLLAGE_V1 = 'editorial-documentary-collage-v1' as const
/** Every authored state without an explicit templateId predates the registry and was authored with this template. */
export const DEFAULT_TEMPLATE_ID = EDITORIAL_DOCUMENTARY_COLLAGE_V1

export type TemplateAppearance = 'light' | 'dark'

/** Renderer material identifiers (DocumentaryCard `materialUrls` keys). */
export type TemplateMaterialName =
  | 'tornPaper'
  | 'paperStrip'
  | 'paperDark'
  | 'paperScrap'
  | 'archival'
  | 'tape'
  | 'pin'
  | 'botanical'
  | 'botanicalLeaf'
  | 'ornament'

export type AssetSlotId =
  | 'paper'
  | 'paperStrip'
  | 'paperDark'
  | 'paperScrap'
  | 'archival'
  | 'tape'
  | 'pin'
  | 'botanical'
  | 'botanicalLeaf'
  | 'ornament'

/**
 * Authoring Usability Completion V1 — a slot the author can fill from the
 * Project Library: every material slot plus the layout's content image
 * ('hero', the Cover's Imagem principal). Content images are not template
 * materials: they render through the manifest's `assets.hero`, never through
 * `materialUrls`.
 */
export type AuthoringAssetSlotId = AssetSlotId | 'hero'
export const AUTHORING_ASSET_SLOT_IDS: readonly AuthoringAssetSlotId[] = [
  'hero', 'paper', 'paperStrip', 'paperDark', 'paperScrap', 'archival', 'tape', 'pin', 'botanical', 'botanicalLeaf', 'ornament',
]

/** Pixel metrics of an asset file: full size + the visible (alpha) bounding box. */
export type AssetMetrics = {
  width: number
  height: number
  visible: { x: number; y: number; width: number; height: number }
}

export type AssetSlotDefinition = {
  id: AssetSlotId
  label: string
  material: TemplateMaterialName
  /** Template-bundled default resource (future "Template Asset"; today a Pack B fixture under public/creative-fixtures). */
  defaultAsset: { key: string; label: string; path: string; metrics: AssetMetrics }
  /** When set, a Project primitive of this category may replace the default (Assets tab picker). */
  projectCategory?: 'paper' | 'tape'
}

/** Per-element transform channel keys (persisted `primitiveTransforms`). */
export type ElementTransformKey =
  | 'paper'
  | 'paperStrip'
  | 'paperDark'
  | 'tape1'
  | 'tape2'
  | 'tape3'
  | 'botanical'
  | 'botanicalLeaf'
  | 'pin'
  | 'pin2'
  | 'archival'
  | 'ornament'
  | 'note'
  | 'card1'

export type TemplateElementControl =
  | { type: 'transform'; key: ElementTransformKey }
  | { type: 'tuning'; group: 'hero' | 'title' | 'source' }

export type TemplateElementDefinition = {
  /** Stable, template-scoped element id (persisted in `elementOrder`). */
  id: string
  /** Product-facing label — the only name users ever see. */
  label: string
  kind: 'text' | 'image' | 'material'
  assetSlot?: AuthoringAssetSlotId
  control: TemplateElementControl
}

export type TemplateLayoutDefinition = {
  id: string
  label: string
  supportedAppearances: readonly TemplateAppearance[]
  defaultAppearance: TemplateAppearance
  elements: readonly TemplateElementDefinition[]
  /** Paint order, BACK first → FRONT last. The Camadas UI shows it reversed (front on top). */
  defaultStackOrder: readonly string[]
}

/** A content-image slot (Imagem principal): filled by content media, default = the template's example image. */
export type ContentImageSlotDefinition = {
  id: 'hero'
  label: string
  defaultAsset: { key: string; label: string; path: string }
}

/** Uniform read-only view of any slot a layout uses (Template anatomy, Assets tab). */
export type AuthoringSlotView = {
  id: AuthoringAssetSlotId
  label: string
  role: 'material' | 'content'
  defaultAsset: { key: string; label: string; path: string }
  projectCategory?: 'paper' | 'tape'
}

export type TemplateDefinition = {
  id: string
  name: string
  category: string
  description: string
  /** Code-backed renderer this template is drawn by (StaticRenderManifest template ref + component binding). */
  renderer: { componentKey: string; templateRef: { id: string; version: string; scope: 'system' } }
  assetSlots: Readonly<Record<AssetSlotId, AssetSlotDefinition>>
  contentImageSlots: Readonly<Record<'hero', ContentImageSlotDefinition>>
  layouts: readonly TemplateLayoutDefinition[]
}

const PACK_B = 'pack-b'

const ASSET_SLOTS: Readonly<Record<AssetSlotId, AssetSlotDefinition>> = {
  paper: {
    id: 'paper', label: 'Papel claro', material: 'tornPaper', projectCategory: 'paper',
    defaultAsset: { key: 'paper-card-light-01', label: 'Papel kraft claro', path: `${PACK_B}/paper-card-light-01.png`, metrics: { width: 1254, height: 1254, visible: { x: 28, y: 260, width: 1214, height: 774 } } },
  },
  paperStrip: {
    id: 'paperStrip', label: 'Faixa de papel', material: 'paperStrip',
    defaultAsset: { key: 'paper-strip-light-01', label: 'Faixa de papel clara', path: `${PACK_B}/paper-strip-light-01.png`, metrics: { width: 1448, height: 1086, visible: { x: 41, y: 289, width: 1374, height: 514 } } },
  },
  paperDark: {
    id: 'paperDark', label: 'Papel escuro', material: 'paperDark',
    defaultAsset: { key: 'paper-card-dark-01', label: 'Papel verde escuro', path: `${PACK_B}/paper-card-dark-01.png`, metrics: { width: 1448, height: 1086, visible: { x: 95, y: 181, width: 1260, height: 747 } } },
  },
  paperScrap: {
    id: 'paperScrap', label: 'Recorte de papel', material: 'paperScrap',
    defaultAsset: { key: 'paper-scrap-light-01', label: 'Recorte de papel claro', path: `${PACK_B}/paper-scrap-light-01.png`, metrics: { width: 1254, height: 1254, visible: { x: 44, y: 286, width: 1171, height: 701 } } },
  },
  archival: {
    id: 'archival', label: 'Fragmento de arquivo', material: 'archival',
    defaultAsset: { key: 'paper-archival-fragment-01', label: 'Fragmento de arquivo', path: `${PACK_B}/paper-archival-fragment-01.png`, metrics: { width: 1448, height: 1086, visible: { x: 33, y: 119, width: 1396, height: 858 } } },
  },
  tape: {
    id: 'tape', label: 'Fita', material: 'tape', projectCategory: 'tape',
    defaultAsset: { key: 'tape-kraft-short-01', label: 'Fita kraft curta', path: `${PACK_B}/tape-kraft-short-01.png`, metrics: { width: 2172, height: 724, visible: { x: 186, y: 122, width: 1887, height: 467 } } },
  },
  pin: {
    id: 'pin', label: 'Pin', material: 'pin',
    defaultAsset: { key: 'pin-brass-01', label: 'Pin de latão', path: `${PACK_B}/pin-brass-01.png`, metrics: { width: 1254, height: 1254, visible: { x: 399, y: 302, width: 504, height: 694 } } },
  },
  botanical: {
    id: 'botanical', label: 'Botânica seca', material: 'botanical',
    defaultAsset: { key: 'botanical-dried-sprig-01', label: 'Ramo seco com flores', path: `${PACK_B}/botanical-dried-sprig-01.png`, metrics: { width: 1086, height: 1448, visible: { x: 196, y: 66, width: 719, height: 1326 } } },
  },
  botanicalLeaf: {
    id: 'botanicalLeaf', label: 'Ramo de folhas', material: 'botanicalLeaf',
    defaultAsset: { key: 'botanical-sprig-large-01', label: 'Ramo de folhas grande', path: `${PACK_B}/botanical-sprig-large-01.png`, metrics: { width: 1254, height: 1254, visible: { x: 140, y: 25, width: 1075, height: 1210 } } },
  },
  ornament: {
    id: 'ornament', label: 'Ornamento celeste', material: 'ornament',
    defaultAsset: { key: 'ornament-celestial-gold-01', label: 'Ornamento celeste dourado', path: `${PACK_B}/ornament-celestial-gold-01.png`, metrics: { width: 1254, height: 1254, visible: { x: 60, y: 29, width: 1135, height: 1190 } } },
  },
}

const t = (key: ElementTransformKey): TemplateElementControl => ({ type: 'transform', key })

/** Pack B Slide 1 — reconstructed from docs/discovery/creative-rendering/visual-reference-pack/pack-b/01.png. */
const COVER_LAYOUT: TemplateLayoutDefinition = {
  id: 'cover',
  label: 'Cover',
  supportedAppearances: ['dark', 'light'],
  defaultAppearance: 'dark',
  elements: [
    { id: 'title', label: 'Título', kind: 'text', control: { type: 'tuning', group: 'title' } },
    { id: 'paper', label: 'Papel do título', kind: 'material', assetSlot: 'paper', control: t('paper') },
    { id: 'hero', label: 'Imagem principal', kind: 'image', assetSlot: 'hero', control: { type: 'tuning', group: 'hero' } },
    { id: 'tape1', label: 'Fita da imagem', kind: 'material', assetSlot: 'tape', control: t('tape1') },
    { id: 'note', label: 'Nota da edição', kind: 'material', assetSlot: 'paperScrap', control: t('note') },
    { id: 'tape2', label: 'Fita da nota', kind: 'material', assetSlot: 'tape', control: t('tape2') },
    { id: 'botanical', label: 'Botânica seca', kind: 'material', assetSlot: 'botanical', control: t('botanical') },
    { id: 'botanicalLeaf', label: 'Ramo de folhas', kind: 'material', assetSlot: 'botanicalLeaf', control: t('botanicalLeaf') },
    { id: 'archival', label: 'Fragmento de mapa', kind: 'material', assetSlot: 'archival', control: t('archival') },
    { id: 'ornament', label: 'Ornamento celeste', kind: 'material', assetSlot: 'ornament', control: t('ornament') },
  ],
  defaultStackOrder: ['ornament', 'archival', 'botanicalLeaf', 'hero', 'botanical', 'tape1', 'note', 'tape2', 'paper', 'title'],
}

/** Pack B Slide 2 — reconstructed from docs/discovery/creative-rendering/visual-reference-pack/pack-b/02.png. */
const INFO_LAYOUT: TemplateLayoutDefinition = {
  id: 'info',
  label: 'Info',
  supportedAppearances: ['light', 'dark'],
  defaultAppearance: 'light',
  elements: [
    { id: 'title', label: 'Título', kind: 'text', control: { type: 'tuning', group: 'title' } },
    { id: 'source', label: 'Fonte', kind: 'text', control: { type: 'tuning', group: 'source' } },
    { id: 'paperStrip', label: 'Faixa do título', kind: 'material', assetSlot: 'paperStrip', control: t('paperStrip') },
    { id: 'paperDark', label: 'Faixa escura do título', kind: 'material', assetSlot: 'paperDark', control: t('paperDark') },
    { id: 'card1', label: 'Cartão 1', kind: 'material', assetSlot: 'paperDark', control: t('card1') },
    { id: 'pin', label: 'Pin do cartão 1', kind: 'material', assetSlot: 'pin', control: t('pin') },
    { id: 'paper', label: 'Cartão 2', kind: 'material', assetSlot: 'paper', control: t('paper') },
    { id: 'pin2', label: 'Pin do cartão 2', kind: 'material', assetSlot: 'pin', control: t('pin2') },
    { id: 'tape1', label: 'Fita do ramo 1', kind: 'material', assetSlot: 'tape', control: t('tape1') },
    { id: 'tape2', label: 'Fita do ramo 2', kind: 'material', assetSlot: 'tape', control: t('tape2') },
    { id: 'tape3', label: 'Fita inferior', kind: 'material', assetSlot: 'tape', control: t('tape3') },
    { id: 'botanicalLeaf', label: 'Ramo de folhas', kind: 'material', assetSlot: 'botanicalLeaf', control: t('botanicalLeaf') },
    { id: 'botanical', label: 'Botânica seca', kind: 'material', assetSlot: 'botanical', control: t('botanical') },
    { id: 'archival', label: 'Fragmento de arquivo', kind: 'material', assetSlot: 'archival', control: t('archival') },
  ],
  defaultStackOrder: ['archival', 'botanicalLeaf', 'tape1', 'tape2', 'botanical', 'card1', 'pin', 'paper', 'pin2', 'tape3', 'paperStrip', 'paperDark', 'title', 'source'],
}

export const EDITORIAL_DOCUMENTARY_COLLAGE_TEMPLATE: TemplateDefinition = {
  id: EDITORIAL_DOCUMENTARY_COLLAGE_V1,
  name: 'Editorial Documentary Collage',
  category: 'editorial',
  description: 'Colagem documental editorial: papéis rasgados, fitas, pins e botânicas sobre uma composição de memória.',
  renderer: { componentKey: 'editorial.documentary-card', templateRef: { id: 'editorial.documentary-card', version: '0.1.0', scope: 'system' } },
  assetSlots: ASSET_SLOTS,
  contentImageSlots: {
    hero: { id: 'hero', label: 'Imagem principal', defaultAsset: { key: 'documentary-card-hero-01', label: 'Imagem de exemplo do template', path: 'documentary-card-hero-01.webp' } },
  },
  layouts: [COVER_LAYOUT, INFO_LAYOUT],
}

const TEMPLATE_DEFINITIONS: Readonly<Record<string, TemplateDefinition>> = {
  [EDITORIAL_DOCUMENTARY_COLLAGE_V1]: EDITORIAL_DOCUMENTARY_COLLAGE_TEMPLATE,
}

export function listTemplateDefinitions(): readonly TemplateDefinition[] {
  return Object.values(TEMPLATE_DEFINITIONS)
}

export function isRegisteredTemplateId(id: unknown): id is string {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(TEMPLATE_DEFINITIONS, id)
}

/** Strict lookup — null for anything not registered. */
export function getTemplateDefinition(id: string): TemplateDefinition | null {
  return isRegisteredTemplateId(id) ? TEMPLATE_DEFINITIONS[id] : null
}

/**
 * Load-time resolution of a persisted templateId. Missing (legacy rows) →
 * the first template, which is what those rows were authored with. An
 * unknown id never crashes the editor: it also falls back, flagged so the
 * caller can surface it. Writes reject unknown ids instead (see carousel-state).
 */
export function resolveAuthoringTemplate(raw: unknown): { template: TemplateDefinition; fallback: boolean } {
  if (raw === undefined || raw === null) return { template: TEMPLATE_DEFINITIONS[DEFAULT_TEMPLATE_ID], fallback: false }
  if (isRegisteredTemplateId(raw)) return { template: TEMPLATE_DEFINITIONS[raw], fallback: false }
  return { template: TEMPLATE_DEFINITIONS[DEFAULT_TEMPLATE_ID], fallback: true }
}

/** Layout ids are template-scoped: 'cover' only means something inside a given template. */
export function getTemplateLayout(template: TemplateDefinition, layoutId: string): TemplateLayoutDefinition | null {
  return template.layouts.find((layout) => layout.id === layoutId) ?? null
}

export function isAppearanceSupported(template: TemplateDefinition, layoutId: string, appearance: string): appearance is TemplateAppearance {
  const layout = getTemplateLayout(template, layoutId)
  return Boolean(layout && (layout.supportedAppearances as readonly string[]).includes(appearance))
}

export function getLayoutElement(layout: TemplateLayoutDefinition, elementId: string): TemplateElementDefinition | null {
  return layout.elements.find((element) => element.id === elementId) ?? null
}

export function slotView(template: TemplateDefinition, slotId: AuthoringAssetSlotId): AuthoringSlotView {
  if (slotId === 'hero') {
    const slot = template.contentImageSlots.hero
    return { id: slot.id, label: slot.label, role: 'content', defaultAsset: slot.defaultAsset }
  }
  const slot = template.assetSlots[slotId]
  return {
    id: slot.id,
    label: slot.label,
    role: 'material',
    defaultAsset: { key: slot.defaultAsset.key, label: slot.defaultAsset.label, path: slot.defaultAsset.path },
    ...(slot.projectCategory ? { projectCategory: slot.projectCategory } : {}),
  }
}

/** Slots actually used by a layout's elements, in first-use order, with the elements that use each. */
export function layoutAssetSlots(template: TemplateDefinition, layout: TemplateLayoutDefinition): { slot: AuthoringSlotView; elements: TemplateElementDefinition[] }[] {
  const bySlot = new Map<AuthoringAssetSlotId, TemplateElementDefinition[]>()
  for (const element of layout.elements) {
    if (!element.assetSlot) continue
    bySlot.set(element.assetSlot, [...(bySlot.get(element.assetSlot) ?? []), element])
  }
  return [...bySlot.entries()].map(([slotId, elements]) => ({ slot: slotView(template, slotId), elements }))
}

/** Elements of a layout front-most first (the order the Camadas list and the anatomy show). */
export function layoutElementsFrontFirst(layout: TemplateLayoutDefinition): TemplateElementDefinition[] {
  return [...layout.defaultStackOrder].reverse().map((id) => getLayoutElement(layout, id)).filter((element): element is TemplateElementDefinition => Boolean(element))
}

export const ELEMENT_TRANSFORM_KEYS: readonly ElementTransformKey[] = [
  'paper', 'paperStrip', 'paperDark', 'tape1', 'tape2', 'tape3', 'botanical', 'botanicalLeaf', 'pin', 'pin2', 'archival', 'ornament', 'note', 'card1',
]
