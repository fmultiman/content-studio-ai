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
 *
 * STATIC_TEMPLATE_ATOMIC_VISUAL_ELEMENTS_V1 — 'logo' is the artwork of the brand signature
 * (Logo da marca). Like 'hero' it is a content asset (manifest `assets.logo`), filled from the
 * existing LibraryFile model; it is NOT a Project Identity redesign.
 */
export type AuthoringAssetSlotId = AssetSlotId | 'hero' | 'logo'
export const AUTHORING_ASSET_SLOT_IDS: readonly AuthoringAssetSlotId[] = [
  'hero', 'logo', 'paper', 'paperStrip', 'paperDark', 'paperScrap', 'archival', 'tape', 'pin', 'botanical', 'botanicalLeaf', 'ornament',
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
  | 'introBanner'
  | 'brandTab'
  | 'divider'

/** `tuning` groups an Element can be positioned by (DocumentaryCardPreviewTuning keys). */
export type TemplateTuningGroup = 'hero' | 'title' | 'source' | 'intro' | 'kicker' | 'brand' | 'body' | 'annotation' | 'items' | 'legend' | 'bullets' | 'tagline'

export type TemplateElementControl =
  | { type: 'transform'; key: ElementTransformKey }
  | { type: 'tuning'; group: TemplateTuningGroup }
  /**
   * COVER_ELEMENT_COMPLETENESS_V1 — a semantic child of a spatial owner: it takes its
   * owner's position/rotation/scale, so it has no spatial control of its own (only
   * visibility and paint order). Hiding the owner also hides the child.
   */
  | { type: 'follows'; parent: string }
  /**
   * STATIC_TEMPLATE_ATOMIC_VISUAL_ELEMENTS_V1 — fixed Template geometry: an independent visible unit (own visibility +
   * paint order) with no spatial control. CREATIVE_EDITOR_ELEMENT_BASELINE_CAPABILITIES_V1: NO Element uses this today —
   * "the component does not wire it yet" is not a reason, and every former fixed Element now has an authored placement.
   * It remains only for a unit whose geometry is semantically derived from another Template unit; using it requires an
   * entry in the Editor's capability registry (SEMANTIC_FIXED_EXCEPTIONS) stating that relationship.
   */
  | { type: 'fixed' }

/**
 * Static Detail Polish V1 — bounded typographic capability of a text element.
 * `lineHeight` is the Template default the renderer uses when the slide has
 * no "Entrelinha" override; only elements that declare it expose the control.
 */
export type TemplateElementTypography = {
  /** Template default Entrelinha (the Title's `tuning.title.lineHeight` overrides it). Absent = not exposed. */
  lineHeight?: number
  /**
   * CREATIVE_EDITOR_CONTEXTUAL_STYLES_AND_TYPOGRAPHY_V1 — the Element takes a LOCAL typography override
   * (Styles). `role` = the Identity role whose family is the default; `fontSizePx` = the Template default size
   * on the 1080px reference canvas (absent = the size is composite, so only the family is overridable).
   * Only single-style text blocks declare it; a block with several sizes does not pretend to.
   */
  local?: { role: 'display' | 'body' | 'label'; fontSizePx?: number }
}

/** Safe authored range for a title's line-height (display serif, uppercase). */
export const TITLE_LINE_HEIGHT_BOUNDS = { min: 0.8, max: 1.5 } as const

export type TemplateElementDefinition = {
  /** Stable, template-scoped element id (persisted in `elementOrder`). */
  id: string
  /** Product-facing label — the only name users ever see. */
  label: string
  /** `shape` = a procedural (CSS/SVG) unit: it has Element identity but no file behind it. */
  kind: 'text' | 'image' | 'material' | 'shape'
  assetSlot?: AuthoringAssetSlotId
  control: TemplateElementControl
  /** Authorable typography (Entrelinha). Absent = not exposed. */
  typography?: TemplateElementTypography
  /**
   * COVER_ELEMENT_COMPLETENESS_V1 / STATIC_TEMPLATE_ATOMIC_VISUAL_ELEMENTS_V1 — where an Element the
   * Template GAINED after a slide's paint order was authored is placed when that order lacks it.
   * Absent = right after its nearest preceding default neighbour (the existing rule); 'front' = on top,
   * so a unit that always painted above the whole stack (fixed text) keeps doing so for saved slides;
   * `{ above | below }` = directly over/under another Element, so a text that always sat on its paper
   * (or a frame under its image) keeps doing so whatever the saved order is.
   */
  stackPlacement?: 'front' | { above: string } | { below: string }
  /**
   * STATIC_TEMPLATE_ATOMIC_VISUAL_ELEMENTS_V1 — ids this Element replaces: a compound Element that was
   * split into atoms. A persisted id of the compound (in `hiddenElements` / `elementOrder`) keeps its
   * meaning: it expands to every atom that declares it.
   */
  replaces?: readonly string[]
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
  id: 'hero' | 'logo'
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
  contentImageSlots: Readonly<Record<'hero' | 'logo', ContentImageSlotDefinition>>
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
const follows = (parent: string): TemplateElementControl => ({ type: 'follows', parent })

/*
 * STATIC_TEMPLATE_ATOMIC_VISUAL_ELEMENTS_V1 — every meaningful independent visible unit of a layout is
 * its own Element (an "atom"): own visibility, own place in the paint order, and — when a file is behind
 * it — its own Asset Slot. A paper and the text printed on it are two atoms; a photo and its frame are two
 * atoms; a logo and the brand name are two atoms. Nothing here is a Group or a parent: an atom that
 * `follows` another only takes its position (never its visibility). Procedural units (frames, links,
 * pins, rules) are `shape` Elements: identity and visibility, no fake file.
 *
 * Transform classification per atom: `transform`/`tuning` = independent; `follows` = moves with its
 * anchor; `fixed` = Template geometry. Text that used to be painted on the fixed top layer keeps painting
 * on top by default (`stackPlacement: 'front'`), so legacy output is unchanged.
 */

/** Pack B Slide 1 — reconstructed from docs/discovery/creative-rendering/visual-reference-pack/pack-b/01.png. */
const COVER_LAYOUT: TemplateLayoutDefinition = {
  id: 'cover',
  label: 'Cover',
  supportedAppearances: ['dark', 'light'],
  defaultAppearance: 'dark',
  elements: [
    { id: 'title', label: 'Título', kind: 'text', control: { type: 'tuning', group: 'title' }, typography: { lineHeight: 1.02, local: { role: 'display', fontSizePx: 62 } } },
    { id: 'paper', label: 'Papel do título', kind: 'material', assetSlot: 'paper', control: t('paper') },
    // CREATIVE_EDITOR_REAL_SMOKE_CORRECTNESS_HARDENING_V1: the Cover's Hero is the content image alone (the book cover): no pale backing/moldura Element.
    { id: 'hero', label: 'Imagem principal', kind: 'image', assetSlot: 'hero', control: { type: 'tuning', group: 'hero' } },
    { id: 'tape1', label: 'Fita da imagem', kind: 'material', assetSlot: 'tape', control: t('tape1') },
    // The editorial note: `note` is the paper (spatial owner); `noteText` (content `detail_note`) is ITS OWN Element, painted above it.
    { id: 'note', label: 'Papel da nota', kind: 'material', assetSlot: 'paperScrap', control: t('note') },
    { id: 'noteText', label: 'Nota da edição', kind: 'text', control: follows('note'), stackPlacement: { above: 'note' } },
    { id: 'tape2', label: 'Fita da nota', kind: 'material', assetSlot: 'tape', control: t('tape2') },
    { id: 'botanical', label: 'Botânica seca', kind: 'material', assetSlot: 'botanical', control: t('botanical') },
    { id: 'botanicalLeaf', label: 'Ramo de folhas', kind: 'material', assetSlot: 'botanicalLeaf', control: t('botanicalLeaf') },
    { id: 'archival', label: 'Fragmento de mapa', kind: 'material', assetSlot: 'archival', control: t('archival') },
    { id: 'ornament', label: 'Ornamento celeste', kind: 'material', assetSlot: 'ornament', control: t('ornament') },
    // Text/brand units that used to be drawn on the fixed top layer without identity; they keep painting on top by default.
    { id: 'kicker', label: 'Chamada', kind: 'text', control: { type: 'tuning', group: 'kicker' }, stackPlacement: 'front', typography: { local: { role: 'label', fontSizePx: 21 } } },
    { id: 'intro', label: 'Introdução', kind: 'text', control: { type: 'tuning', group: 'intro' }, stackPlacement: 'front', typography: { local: { role: 'body', fontSizePx: 30 } } },
    { id: 'source', label: 'Fonte editorial', kind: 'text', control: { type: 'tuning', group: 'source' }, stackPlacement: 'front', typography: { local: { role: 'body', fontSizePx: 19 } } },
    // The signature is ONE Element: the COMPLETE logo asset (the logo file already carries the brand name; no separate name text is drawn).
    { id: 'brandLogo', label: 'Logo da marca', kind: 'image', assetSlot: 'logo', control: { type: 'tuning', group: 'brand' }, stackPlacement: 'front', replaces: ['brand'] },
  ],
  defaultStackOrder: ['ornament', 'archival', 'botanicalLeaf', 'hero', 'botanical', 'tape1', 'note', 'noteText', 'tape2', 'paper', 'title', 'kicker', 'intro', 'source', 'brandLogo'],
}

/** Pack B Slide 2 — reconstructed from docs/discovery/creative-rendering/visual-reference-pack/pack-b/02.png. */
const INFO_LAYOUT: TemplateLayoutDefinition = {
  id: 'info',
  label: 'Info',
  supportedAppearances: ['light', 'dark'],
  defaultAppearance: 'light',
  elements: [
    { id: 'title', label: 'Título', kind: 'text', control: { type: 'tuning', group: 'title' }, typography: { local: { role: 'display' } } },
    { id: 'source', label: 'Fonte', kind: 'text', control: { type: 'tuning', group: 'source' }, typography: { local: { role: 'body', fontSizePx: 24 } } },
    { id: 'paperStrip', label: 'Faixa do título', kind: 'material', assetSlot: 'paperStrip', control: t('paperStrip') },
    { id: 'paperDark', label: 'Faixa escura do título', kind: 'material', assetSlot: 'paperDark', control: t('paperDark') },
    { id: 'card1', label: 'Cartão 1', kind: 'material', assetSlot: 'paperDark', control: t('card1') },
    { id: 'card1Text', label: 'Texto do cartão 1', kind: 'text', control: follows('card1'), stackPlacement: { above: 'card1' } },
    { id: 'pin', label: 'Pin do cartão 1', kind: 'material', assetSlot: 'pin', control: t('pin') },
    { id: 'paper', label: 'Cartão 2', kind: 'material', assetSlot: 'paper', control: t('paper') },
    { id: 'card2Text', label: 'Texto do cartão 2', kind: 'text', control: follows('paper'), stackPlacement: { above: 'paper' } },
    { id: 'pin2', label: 'Pin do cartão 2', kind: 'material', assetSlot: 'pin', control: t('pin2') },
    { id: 'tape1', label: 'Fita do ramo 1', kind: 'material', assetSlot: 'tape', control: t('tape1') },
    { id: 'tape2', label: 'Fita do ramo 2', kind: 'material', assetSlot: 'tape', control: t('tape2') },
    { id: 'tape3', label: 'Fita inferior', kind: 'material', assetSlot: 'tape', control: t('tape3') },
    { id: 'botanicalLeaf', label: 'Ramo de folhas', kind: 'material', assetSlot: 'botanicalLeaf', control: t('botanicalLeaf') },
    { id: 'botanical', label: 'Botânica seca', kind: 'material', assetSlot: 'botanical', control: t('botanical') },
    { id: 'archival', label: 'Fragmento de arquivo', kind: 'material', assetSlot: 'archival', control: t('archival') },
    // Fixed-layer units (they used to paint on the top layer with no identity).
    { id: 'bodyText', label: 'Texto principal', kind: 'text', control: { type: 'tuning', group: 'body' }, stackPlacement: 'front' },
    { id: 'annotation', label: 'Anotação', kind: 'text', control: { type: 'tuning', group: 'annotation' }, stackPlacement: 'front' },
    { id: 'introBanner', label: 'Faixa da chamada', kind: 'material', assetSlot: 'paperDark', control: t('introBanner'), stackPlacement: 'front' },
    { id: 'introText', label: 'Chamada', kind: 'text', control: follows('introBanner'), stackPlacement: { above: 'introBanner' } },
    { id: 'brandTab', label: 'Aba da marca', kind: 'material', assetSlot: 'paperDark', control: t('brandTab'), stackPlacement: 'front' },
    { id: 'brandLogo', label: 'Logo da marca', kind: 'image', assetSlot: 'logo', control: { type: 'tuning', group: 'brand' }, stackPlacement: 'front' },
  ],
  defaultStackOrder: ['archival', 'botanicalLeaf', 'tape1', 'tape2', 'botanical', 'card1', 'card1Text', 'pin', 'paper', 'card2Text', 'pin2', 'tape3', 'paperStrip', 'paperDark', 'title', 'source', 'bodyText', 'annotation', 'introBanner', 'introText', 'brandTab', 'brandLogo'],
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
    { id: 'title', label: 'Título', kind: 'text', control: { type: 'tuning', group: 'title' }, typography: { lineHeight: 1.04, local: { role: 'display', fontSizePx: 64 } } },
    { id: 'paperStrip', label: 'Faixa do título', kind: 'material', assetSlot: 'paperStrip', control: t('paperStrip') },
    { id: 'heroFrame', label: 'Moldura da imagem', kind: 'shape', control: follows('hero'), stackPlacement: { below: 'hero' } },
    { id: 'hero', label: 'Imagem do documento', kind: 'image', assetSlot: 'hero', control: { type: 'tuning', group: 'hero' } },
    { id: 'tape1', label: 'Fita do documento', kind: 'material', assetSlot: 'tape', control: t('tape1') },
    { id: 'note', label: 'Papel da legenda', kind: 'material', assetSlot: 'paperScrap', control: t('note') },
    { id: 'noteText', label: 'Legenda da imagem', kind: 'text', control: follows('note'), stackPlacement: { above: 'note' } },
    { id: 'tape2', label: 'Fita da legenda', kind: 'material', assetSlot: 'tape', control: t('tape2') },
    { id: 'botanicalLeaf', label: 'Ramo de folhas', kind: 'material', assetSlot: 'botanicalLeaf', control: t('botanicalLeaf') },
    { id: 'botanical', label: 'Botânica seca', kind: 'material', assetSlot: 'botanical', control: t('botanical') },
    { id: 'archival', label: 'Fragmento de arquivo', kind: 'material', assetSlot: 'archival', control: t('archival') },
    // Completion V1 (Slide 5): optional closing callout on dark paper.
    { id: 'callout', label: 'Caixa de destaque', kind: 'material', assetSlot: 'paperDark', control: t('paperDark') },
    { id: 'calloutText', label: 'Texto do destaque', kind: 'text', control: follows('callout'), stackPlacement: { above: 'callout' } },
    { id: 'intro', label: 'Introdução', kind: 'text', control: { type: 'tuning', group: 'intro' }, stackPlacement: 'front', typography: { local: { role: 'body', fontSizePx: 31 } } },
    { id: 'items', label: 'Itens da lista', kind: 'text', control: { type: 'tuning', group: 'items' }, stackPlacement: 'front' },
    { id: 'brandLogo', label: 'Logo da marca', kind: 'image', assetSlot: 'logo', control: { type: 'tuning', group: 'brand' }, stackPlacement: 'front' },
  ],
  defaultStackOrder: ['archival', 'botanicalLeaf', 'heroFrame', 'hero', 'tape1', 'botanical', 'callout', 'calloutText', 'note', 'noteText', 'tape2', 'paperStrip', 'title', 'intro', 'items', 'brandLogo'],
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
    { id: 'title', label: 'Título', kind: 'text', control: { type: 'tuning', group: 'title' }, typography: { lineHeight: 1.04, local: { role: 'display', fontSizePx: 58 } } },
    { id: 'paperStrip', label: 'Faixa do título', kind: 'material', assetSlot: 'paperStrip', control: t('paperStrip') },
    { id: 'tape1', label: 'Fita do título', kind: 'material', assetSlot: 'tape', control: t('tape1') },
    { id: 'tiles', label: 'Grade de temas', kind: 'text', control: t('card1') },
    { id: 'note', label: 'Papel das ideias', kind: 'material', assetSlot: 'paperScrap', control: t('note') },
    { id: 'ideasText', label: 'Ideias transversais', kind: 'text', control: follows('note'), stackPlacement: { above: 'note' } },
    { id: 'botanicalLeaf', label: 'Ramo de folhas', kind: 'material', assetSlot: 'botanicalLeaf', control: t('botanicalLeaf') },
    { id: 'archival', label: 'Fragmento de arquivo', kind: 'material', assetSlot: 'archival', control: t('archival') },
    { id: 'intro', label: 'Introdução', kind: 'text', control: { type: 'tuning', group: 'intro' }, stackPlacement: 'front', typography: { local: { role: 'body', fontSizePx: 31 } } },
  ],
  defaultStackOrder: ['archival', 'botanicalLeaf', 'tiles', 'note', 'ideasText', 'paperStrip', 'tape1', 'title', 'intro'],
}

/** Mapa — places pinned by federative unit on a code-drawn Brazil map, with legend and note (Pack A Slide 7). */
const MAP_LAYOUT: TemplateLayoutDefinition = {
  id: 'map',
  label: 'Mapa',
  supportedAppearances: ['light', 'dark'],
  defaultAppearance: 'light',
  elements: [
    { id: 'title', label: 'Título', kind: 'text', control: { type: 'tuning', group: 'title' }, typography: { lineHeight: 1.04, local: { role: 'display', fontSizePx: 58 } } },
    { id: 'paperStrip', label: 'Faixa do título', kind: 'material', assetSlot: 'paperStrip', control: t('paperStrip') },
    { id: 'map', label: 'Mapa do Brasil', kind: 'shape', control: t('card1') },
    { id: 'mapPins', label: 'Pinos dos lugares', kind: 'shape', control: follows('map'), stackPlacement: { above: 'map' } },
    { id: 'note', label: 'Nota do mapa', kind: 'material', assetSlot: 'paperScrap', control: t('note') },
    { id: 'noteText', label: 'Texto da nota do mapa', kind: 'text', control: follows('note'), stackPlacement: { above: 'note' } },
    { id: 'tape1', label: 'Fita da nota', kind: 'material', assetSlot: 'tape', control: t('tape1') },
    { id: 'botanicalLeaf', label: 'Ramo de folhas', kind: 'material', assetSlot: 'botanicalLeaf', control: t('botanicalLeaf') },
    { id: 'botanical', label: 'Botânica seca', kind: 'material', assetSlot: 'botanical', control: t('botanical') },
    { id: 'intro', label: 'Introdução', kind: 'text', control: { type: 'tuning', group: 'intro' }, stackPlacement: 'front', typography: { local: { role: 'body', fontSizePx: 30 } } },
    { id: 'legend', label: 'Legenda dos lugares', kind: 'text', control: { type: 'tuning', group: 'legend' }, stackPlacement: 'front' },
  ],
  defaultStackOrder: ['botanicalLeaf', 'map', 'mapPins', 'botanical', 'note', 'noteText', 'tape1', 'paperStrip', 'title', 'intro', 'legend'],
}

/** Rede — 3..9 linked cards plus an optional icon-led callout with bullets (Pack A Slide 8). */
const NETWORK_LAYOUT: TemplateLayoutDefinition = {
  id: 'network',
  label: 'Rede',
  supportedAppearances: ['dark', 'light'],
  defaultAppearance: 'dark',
  elements: [
    { id: 'title', label: 'Título', kind: 'text', control: { type: 'tuning', group: 'title' }, typography: { lineHeight: 1.04, local: { role: 'display', fontSizePx: 62 } } },
    { id: 'paperStrip', label: 'Faixa do título', kind: 'material', assetSlot: 'paperStrip', control: t('paperStrip') },
    { id: 'links', label: 'Conexões da rede', kind: 'shape', control: follows('cards'), stackPlacement: { below: 'cards' } },
    { id: 'cards', label: 'Cartões da rede', kind: 'material', assetSlot: 'paperScrap', control: t('card1') },
    { id: 'cardsText', label: 'Textos dos cartões', kind: 'text', control: follows('cards'), stackPlacement: { above: 'cards' } },
    { id: 'callout', label: 'Caixa de destaque', kind: 'material', assetSlot: 'paperDark', control: t('paperDark') },
    { id: 'calloutText', label: 'Texto do destaque', kind: 'text', control: follows('callout'), stackPlacement: { above: 'callout' } },
    { id: 'ornament', label: 'Ornamento celeste', kind: 'material', assetSlot: 'ornament', control: t('ornament') },
    { id: 'kicker', label: 'Chamada', kind: 'text', control: { type: 'tuning', group: 'kicker' }, stackPlacement: 'front', typography: { local: { role: 'body', fontSizePx: 27 } } },
    { id: 'intro', label: 'Introdução', kind: 'text', control: { type: 'tuning', group: 'intro' }, stackPlacement: 'front', typography: { local: { role: 'body', fontSizePx: 28 } } },
  ],
  defaultStackOrder: ['ornament', 'links', 'cards', 'cardsText', 'callout', 'calloutText', 'paperStrip', 'title', 'kicker', 'intro'],
}

/** Citação — a pull quote as focal point, with intro, bullets, one wide content image and a callout (Pack A Slide 9). */
const QUOTE_LAYOUT: TemplateLayoutDefinition = {
  id: 'quote',
  label: 'Citação',
  supportedAppearances: ['light', 'dark'],
  defaultAppearance: 'light',
  elements: [
    // VIDEO_HIERARCHICAL_SCENE_TIMING_SPIKE_V1: the four content-bearing units of this layout take
    // Scene-local timing. The units drawn WITH each (title strip, quote text + tape, image frame, callout
    // text) are its companions: they enter and leave with it.
    { id: 'title', label: 'Título', kind: 'text', control: { type: 'tuning', group: 'title' }, typography: { lineHeight: 1.04, local: { role: 'display', fontSizePx: 62 } }, timing: { companions: ['paperStrip'] } },
    { id: 'paperStrip', label: 'Faixa do título', kind: 'material', assetSlot: 'paperStrip', control: t('paperStrip') },
    { id: 'quote', label: 'Papel da citação', kind: 'material', assetSlot: 'paper', control: t('paper'), timing: { companions: ['quoteText', 'tape1'] } },
    { id: 'quoteText', label: 'Texto da citação', kind: 'text', control: follows('quote'), stackPlacement: { above: 'quote' } },
    { id: 'tape1', label: 'Fita da citação', kind: 'material', assetSlot: 'tape', control: t('tape1') },
    { id: 'heroFrame', label: 'Moldura da imagem', kind: 'shape', control: follows('hero'), stackPlacement: { below: 'hero' } },
    { id: 'hero', label: 'Imagem', kind: 'image', assetSlot: 'hero', control: { type: 'tuning', group: 'hero' }, timing: { companions: ['heroFrame'] } },
    { id: 'callout', label: 'Caixa de destaque', kind: 'material', assetSlot: 'paperDark', control: t('paperDark'), timing: { companions: ['calloutText'] } },
    { id: 'calloutText', label: 'Texto do destaque', kind: 'text', control: follows('callout'), stackPlacement: { above: 'callout' } },
    { id: 'botanicalLeaf', label: 'Ramo de folhas', kind: 'material', assetSlot: 'botanicalLeaf', control: t('botanicalLeaf') },
    { id: 'intro', label: 'Introdução', kind: 'text', control: { type: 'tuning', group: 'intro' }, stackPlacement: 'front', typography: { local: { role: 'body', fontSizePx: 29 } } },
    { id: 'bullets', label: 'Tópicos', kind: 'text', control: { type: 'tuning', group: 'bullets' }, stackPlacement: 'front' },
  ],
  defaultStackOrder: ['botanicalLeaf', 'heroFrame', 'hero', 'callout', 'calloutText', 'quote', 'quoteText', 'tape1', 'paperStrip', 'title', 'intro', 'bullets'],
}

/** Encerramento — closing statement, icon-labelled items, an invitation with contact, brand and tagline (Pack A Slide 10). */
const CLOSING_LAYOUT: TemplateLayoutDefinition = {
  id: 'closing',
  label: 'Encerramento',
  supportedAppearances: ['dark', 'light'],
  defaultAppearance: 'dark',
  elements: [
    { id: 'title', label: 'Título', kind: 'text', control: { type: 'tuning', group: 'title' }, typography: { lineHeight: 1.06, local: { role: 'display', fontSizePx: 72 } } },
    { id: 'note', label: 'Papel do convite', kind: 'material', assetSlot: 'paperScrap', control: t('note') },
    { id: 'inviteText', label: 'Texto do convite', kind: 'text', control: follows('note'), stackPlacement: { above: 'note' } },
    { id: 'tape1', label: 'Fita do convite', kind: 'material', assetSlot: 'tape', control: t('tape1') },
    { id: 'ornament', label: 'Ornamento celeste', kind: 'material', assetSlot: 'ornament', control: t('ornament') },
    { id: 'botanicalLeaf', label: 'Ramo de folhas', kind: 'material', assetSlot: 'botanicalLeaf', control: t('botanicalLeaf') },
    { id: 'botanical', label: 'Botânica seca', kind: 'material', assetSlot: 'botanical', control: t('botanical') },
    { id: 'body', label: 'Texto de apoio', kind: 'text', control: { type: 'tuning', group: 'body' }, stackPlacement: 'front' },
    { id: 'items', label: 'Itens do encerramento', kind: 'text', control: { type: 'tuning', group: 'items' }, stackPlacement: 'front' },
    { id: 'divider', label: 'Linha pontilhada', kind: 'shape', control: t('divider'), stackPlacement: 'front' },
    { id: 'brandLogo', label: 'Logo da marca', kind: 'image', assetSlot: 'logo', control: { type: 'tuning', group: 'brand' }, stackPlacement: 'front' },
    { id: 'tagline', label: 'Frase final', kind: 'text', control: { type: 'tuning', group: 'tagline' }, stackPlacement: 'front' },
  ],
  defaultStackOrder: ['ornament', 'botanicalLeaf', 'botanical', 'note', 'inviteText', 'tape1', 'title', 'body', 'items', 'divider', 'brandLogo', 'tagline'],
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
    logo: { id: 'logo', label: 'Logo da marca', defaultAsset: { key: 'comunidades-alternativas-logo-v1', label: 'Logo padrão do Template', path: 'comunidades-alternativas-logo-v1.svg' } },
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
/** The local-typography capability of a Template text Element, or null when it takes none. */
export function elementLocalTypography(layout: TemplateLayoutDefinition | null | undefined, elementId: string): NonNullable<TemplateElementTypography['local']> | null {
  const element = layout ? getLayoutElement(layout, elementId) : null
  return element?.kind === 'text' ? (element.typography?.local ?? null) : null
}

export function layoutTitleLineHeight(templateId: string | undefined, layoutId: string): number | undefined {
  const template = getTemplateDefinition(templateId ?? DEFAULT_TEMPLATE_ID) ?? getTemplateDefinition(DEFAULT_TEMPLATE_ID)
  const layout = template ? getTemplateLayout(template, layoutId) : null
  return layout ? getLayoutElement(layout, 'title')?.typography?.lineHeight : undefined
}

/** True when the layout draws the content image ('hero'): Cover, Lista and Citação do; the others do not. */
export function layoutUsesContentImage(layout: TemplateLayoutDefinition | null): boolean {
  return Boolean(layout?.elements.some((element) => element.assetSlot === 'hero'))
}

/** True when the layout draws the brand logo artwork ('logo'): the layouts with a brand signature. */
export function layoutUsesLogo(layout: TemplateLayoutDefinition | null): boolean {
  return Boolean(layout?.elements.some((element) => element.assetSlot === 'logo'))
}

export function slotView(template: TemplateDefinition, slotId: AuthoringAssetSlotId): AuthoringSlotView {
  if (slotId === 'hero' || slotId === 'logo') {
    const slot = template.contentImageSlots[slotId]
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
  'paper', 'paperStrip', 'paperDark', 'tape1', 'tape2', 'tape3', 'botanical', 'botanicalLeaf', 'pin', 'pin2', 'archival', 'ornament', 'note', 'card1', 'introBanner', 'brandTab', 'divider',
]
