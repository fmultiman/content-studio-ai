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

/**
 * Static Detail Polish V1 — bounded typographic capability of a text element.
 * `lineHeight` is the Template default the renderer uses when the slide has
 * no "Entrelinha" override; only elements that declare it expose the control.
 */
export type TemplateElementTypography = { lineHeight: number }

/** Safe authored range for a title's line-height (display serif, uppercase). */
export const TITLE_LINE_HEIGHT_BOUNDS = { min: 0.8, max: 1.5 } as const

export type TemplateElementDefinition = {
  /** Stable, template-scoped element id (persisted in `elementOrder`). */
  id: string
  /** Product-facing label — the only name users ever see. */
  label: string
  kind: 'text' | 'image' | 'material'
  assetSlot?: AuthoringAssetSlotId
  control: TemplateElementControl
  /** Authorable typography (Entrelinha). Absent = not exposed. */
  typography?: TemplateElementTypography
  /**
   * VIDEO_HIERARCHICAL_SCENE_TIMING_SPIKE_V1 — the element may take Scene-local
   * timing in Video (when it participates inside its Scene). Absent = it stays
   * full-Scene spatial composition. `companions` are elements drawn as part of
   * this one (its strip, its tape) that enter and leave with it. Static never
   * reads this.
   */
  timing?: TemplateElementTiming
}

export type TemplateElementTiming = { companions?: readonly string[] }

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

/** Reusable semantic regions of a Template family, independent of one layout's concrete stack. */
export type TemplateAnatomyRegion = {
  id: string
  label: string
  description: string
}

export type TemplateDefinition = {
  id: string
  name: string
  category: string
  description: string
  /** Code-backed renderer this template is drawn by (StaticRenderManifest template ref + component binding). */
  renderer: { componentKey: string; templateRef: { id: string; version: string; scope: 'system' } }
  /** Registry-owned semantic grammar shown read-only in the Creative Editor. */
  anatomy: readonly TemplateAnatomyRegion[]
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
    { id: 'title', label: 'Título', kind: 'text', control: { type: 'tuning', group: 'title' }, typography: { lineHeight: 1.02 } },
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

/**
 * Portal Carousel Growth V1 — "Lista": a title, a short intro, 2..4 icon-led
 * rows and one documentary content image with its caption. Pack A Slide 3's
 * editorial anatomy (the same structure recurs in Pack A Slides 5, 6 and 10),
 * drawn in the Pack B visual language out of this template's existing slots.
 */
const LIST_LAYOUT: TemplateLayoutDefinition = {
  id: 'list',
  label: 'Lista',
  supportedAppearances: ['light', 'dark'],
  defaultAppearance: 'light',
  elements: [
    { id: 'title', label: 'Título', kind: 'text', control: { type: 'tuning', group: 'title' }, typography: { lineHeight: 1.04 } },
    { id: 'paperStrip', label: 'Faixa do título', kind: 'material', assetSlot: 'paperStrip', control: t('paperStrip') },
    { id: 'hero', label: 'Imagem do documento', kind: 'image', assetSlot: 'hero', control: { type: 'tuning', group: 'hero' } },
    { id: 'tape1', label: 'Fita do documento', kind: 'material', assetSlot: 'tape', control: t('tape1') },
    { id: 'note', label: 'Papel da legenda', kind: 'material', assetSlot: 'paperScrap', control: t('note') },
    { id: 'tape2', label: 'Fita da legenda', kind: 'material', assetSlot: 'tape', control: t('tape2') },
    { id: 'botanicalLeaf', label: 'Ramo de folhas', kind: 'material', assetSlot: 'botanicalLeaf', control: t('botanicalLeaf') },
    { id: 'botanical', label: 'Botânica seca', kind: 'material', assetSlot: 'botanical', control: t('botanical') },
    { id: 'archival', label: 'Fragmento de arquivo', kind: 'material', assetSlot: 'archival', control: t('archival') },
    // Completion V1 (Slide 5): optional closing callout on dark paper.
    { id: 'callout', label: 'Caixa de destaque', kind: 'material', assetSlot: 'paperDark', control: t('paperDark') },
  ],
  defaultStackOrder: ['archival', 'botanicalLeaf', 'hero', 'tape1', 'botanical', 'callout', 'note', 'tape2', 'paperStrip', 'title'],
}

/*
 * Portal Carousel Completion V1 — five more reusable layouts, each the
 * structure of one Pack A slide (6–10) drawn in the Pack B language out of the
 * existing slots. Grouped content (tiles, network cards, map) is ONE authored
 * element with one transform; per-item positions are template geometry.
 * Transform channels are reused per layout (a channel is per slide, so e.g.
 * `card1` drives "Grade de temas" here and "Cartão 1" in Info).
 */

/** Grade — a typology of 2..6 icon tiles plus an optional row of cross-cutting ideas (Pack A Slide 6). */
const GRID_LAYOUT: TemplateLayoutDefinition = {
  id: 'grid',
  label: 'Grade',
  supportedAppearances: ['light', 'dark'],
  defaultAppearance: 'light',
  elements: [
    { id: 'title', label: 'Título', kind: 'text', control: { type: 'tuning', group: 'title' }, typography: { lineHeight: 1.04 } },
    { id: 'paperStrip', label: 'Faixa do título', kind: 'material', assetSlot: 'paperStrip', control: t('paperStrip') },
    { id: 'tape1', label: 'Fita do título', kind: 'material', assetSlot: 'tape', control: t('tape1') },
    { id: 'tiles', label: 'Grade de temas', kind: 'text', control: t('card1') },
    { id: 'note', label: 'Papel das ideias', kind: 'material', assetSlot: 'paperScrap', control: t('note') },
    { id: 'botanicalLeaf', label: 'Ramo de folhas', kind: 'material', assetSlot: 'botanicalLeaf', control: t('botanicalLeaf') },
    { id: 'archival', label: 'Fragmento de arquivo', kind: 'material', assetSlot: 'archival', control: t('archival') },
  ],
  defaultStackOrder: ['archival', 'botanicalLeaf', 'tiles', 'note', 'paperStrip', 'tape1', 'title'],
}

/** Mapa — places pinned by federative unit on a code-drawn Brazil map, with legend and note (Pack A Slide 7). */
const MAP_LAYOUT: TemplateLayoutDefinition = {
  id: 'map',
  label: 'Mapa',
  supportedAppearances: ['light', 'dark'],
  defaultAppearance: 'light',
  elements: [
    { id: 'title', label: 'Título', kind: 'text', control: { type: 'tuning', group: 'title' }, typography: { lineHeight: 1.04 } },
    { id: 'paperStrip', label: 'Faixa do título', kind: 'material', assetSlot: 'paperStrip', control: t('paperStrip') },
    { id: 'map', label: 'Mapa do Brasil', kind: 'image', control: t('card1') },
    { id: 'note', label: 'Nota do mapa', kind: 'material', assetSlot: 'paperScrap', control: t('note') },
    { id: 'tape1', label: 'Fita da nota', kind: 'material', assetSlot: 'tape', control: t('tape1') },
    { id: 'botanicalLeaf', label: 'Ramo de folhas', kind: 'material', assetSlot: 'botanicalLeaf', control: t('botanicalLeaf') },
    { id: 'botanical', label: 'Botânica seca', kind: 'material', assetSlot: 'botanical', control: t('botanical') },
  ],
  defaultStackOrder: ['botanicalLeaf', 'map', 'botanical', 'note', 'tape1', 'paperStrip', 'title'],
}

/** Rede — 3..9 linked cards plus an optional icon-led callout with bullets (Pack A Slide 8). */
const NETWORK_LAYOUT: TemplateLayoutDefinition = {
  id: 'network',
  label: 'Rede',
  supportedAppearances: ['dark', 'light'],
  defaultAppearance: 'dark',
  elements: [
    { id: 'title', label: 'Título', kind: 'text', control: { type: 'tuning', group: 'title' }, typography: { lineHeight: 1.04 } },
    { id: 'paperStrip', label: 'Faixa do título', kind: 'material', assetSlot: 'paperStrip', control: t('paperStrip') },
    { id: 'cards', label: 'Cartões da rede', kind: 'material', assetSlot: 'paperScrap', control: t('card1') },
    { id: 'callout', label: 'Caixa de destaque', kind: 'material', assetSlot: 'paperDark', control: t('paperDark') },
    { id: 'ornament', label: 'Ornamento celeste', kind: 'material', assetSlot: 'ornament', control: t('ornament') },
  ],
  defaultStackOrder: ['ornament', 'cards', 'callout', 'paperStrip', 'title'],
}

/** Citação — a pull quote as focal point, with intro, bullets, one wide content image and a callout (Pack A Slide 9). */
const QUOTE_LAYOUT: TemplateLayoutDefinition = {
  id: 'quote',
  label: 'Citação',
  supportedAppearances: ['light', 'dark'],
  defaultAppearance: 'light',
  elements: [
    // VIDEO_HIERARCHICAL_SCENE_TIMING_SPIKE_V1: the four content-bearing units of this layout take
    // Scene-local timing. The title's strip and the quote's tape are drawn WITH them (companions).
    { id: 'title', label: 'Título', kind: 'text', control: { type: 'tuning', group: 'title' }, typography: { lineHeight: 1.04 }, timing: { companions: ['paperStrip'] } },
    { id: 'paperStrip', label: 'Faixa do título', kind: 'material', assetSlot: 'paperStrip', control: t('paperStrip') },
    { id: 'quote', label: 'Papel da citação', kind: 'material', assetSlot: 'paper', control: t('paper'), timing: { companions: ['tape1'] } },
    { id: 'tape1', label: 'Fita da citação', kind: 'material', assetSlot: 'tape', control: t('tape1') },
    { id: 'hero', label: 'Imagem', kind: 'image', assetSlot: 'hero', control: { type: 'tuning', group: 'hero' }, timing: {} },
    { id: 'callout', label: 'Caixa de destaque', kind: 'material', assetSlot: 'paperDark', control: t('paperDark'), timing: {} },
    { id: 'botanicalLeaf', label: 'Ramo de folhas', kind: 'material', assetSlot: 'botanicalLeaf', control: t('botanicalLeaf') },
  ],
  defaultStackOrder: ['botanicalLeaf', 'hero', 'callout', 'quote', 'tape1', 'paperStrip', 'title'],
}

/** Encerramento — closing statement, icon-labelled items, an invitation with contact, brand and tagline (Pack A Slide 10). */
const CLOSING_LAYOUT: TemplateLayoutDefinition = {
  id: 'closing',
  label: 'Encerramento',
  supportedAppearances: ['dark', 'light'],
  defaultAppearance: 'dark',
  elements: [
    { id: 'title', label: 'Título', kind: 'text', control: { type: 'tuning', group: 'title' }, typography: { lineHeight: 1.06 } },
    { id: 'note', label: 'Papel do convite', kind: 'material', assetSlot: 'paperScrap', control: t('note') },
    { id: 'tape1', label: 'Fita do convite', kind: 'material', assetSlot: 'tape', control: t('tape1') },
    { id: 'ornament', label: 'Ornamento celeste', kind: 'material', assetSlot: 'ornament', control: t('ornament') },
    { id: 'botanicalLeaf', label: 'Ramo de folhas', kind: 'material', assetSlot: 'botanicalLeaf', control: t('botanicalLeaf') },
    { id: 'botanical', label: 'Botânica seca', kind: 'material', assetSlot: 'botanical', control: t('botanical') },
  ],
  defaultStackOrder: ['ornament', 'botanicalLeaf', 'botanical', 'note', 'tape1', 'title'],
}

export const EDITORIAL_DOCUMENTARY_COLLAGE_TEMPLATE: TemplateDefinition = {
  id: EDITORIAL_DOCUMENTARY_COLLAGE_V1,
  name: 'Editorial Documentary Collage',
  category: 'editorial',
  description: 'Colagem documental editorial: papéis rasgados, fitas, pins e botânicas sobre uma composição de memória.',
  renderer: { componentKey: 'editorial.documentary-card', templateRef: { id: 'editorial.documentary-card', version: '0.1.0', scope: 'system' } },
  anatomy: [
    { id: 'editorial-content', label: 'Conteúdo editorial', description: 'Texto e informação principal da narrativa do carrossel.' },
    { id: 'content-image', label: 'Imagem de conteúdo', description: 'Imagem principal quando o layout oferece uma área de conteúdo visual.' },
    { id: 'collage-materials', label: 'Materiais de colagem', description: 'Papéis, fitas, pins e botânicas que compõem a linguagem visual editorial.' },
    { id: 'source-credit', label: 'Fonte e crédito', description: 'Crédito editorial usado pelos layouts que exibem uma fonte.' },
  ],
  assetSlots: ASSET_SLOTS,
  contentImageSlots: {
    hero: { id: 'hero', label: 'Imagem principal', defaultAsset: { key: 'documentary-card-hero-01', label: 'Imagem de exemplo do template', path: 'documentary-card-hero-01.webp' } },
  },
  layouts: [COVER_LAYOUT, INFO_LAYOUT, LIST_LAYOUT, GRID_LAYOUT, MAP_LAYOUT, NETWORK_LAYOUT, QUOTE_LAYOUT, CLOSING_LAYOUT],
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

/**
 * Static Detail Polish V1 — the Template default line-height of a layout's
 * Title element, or undefined when the layout does not expose Entrelinha
 * (Info sets its title as two single-line strips). Shared by the Editor and
 * the renderer so an absent override always paints the Template value.
 */
export function layoutTitleLineHeight(templateId: string | undefined, layoutId: string): number | undefined {
  const template = getTemplateDefinition(templateId ?? DEFAULT_TEMPLATE_ID) ?? getTemplateDefinition(DEFAULT_TEMPLATE_ID)
  const layout = template ? getTemplateLayout(template, layoutId) : null
  return layout ? getLayoutElement(layout, 'title')?.typography?.lineHeight : undefined
}

/** True when the layout draws the content image ('hero'): Cover, Lista and Citação do; the others do not. */
export function layoutUsesContentImage(layout: TemplateLayoutDefinition | null): boolean {
  return Boolean(layout?.elements.some((element) => element.assetSlot === 'hero'))
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
