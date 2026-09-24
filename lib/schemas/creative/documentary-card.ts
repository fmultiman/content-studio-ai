import { z } from 'zod'
import { AssetRefSchema } from './primitives'

// ─── Wave 2 — Neutral Schemas ───────────────────────────────────────────────
//
// editorial.documentary-card@0.1.0 content/asset contracts.
//
// Decision C5 (Wave 2): variant-specific schemas, not one large object full
// of optional flags. Variants: `cover`, `info`, `list` (Carousel Growth V1),
// `grid`, `map`, `network`, `quote`, `closing` (Carousel Completion V1) —
// "standard" is prior nomenclature and must not appear as a variant here.
//
// Decision C6 (Wave 2): cover uses `detail_note?`, not a generic `footer`.
// `footer` appeared in earlier examples but is not carried forward as a
// fictitious compatibility field. Info has its own fields; if a genuinely
// distinct footer concept emerges later, the contract can evolve then.
//
// These are template-specific schemas — the core StaticRenderManifest/
// TimelineManifest never import them directly. The (Wave 3) Template
// Registry resolves a TemplateRef to the right content/asset schema and
// validates `content`/`assets` in a second stage.

// ─── Cover ───────────────────────────────────────────────────────────────────

export const DocumentaryCardCoverContentSchema = z
  .object({
    eyebrow: z.string().trim().min(1).max(48).optional(),
    title: z.string().trim().min(1).max(120),
    subtitle: z.string().trim().min(1).max(220).optional(),
    source_line: z.string().trim().min(1).max(160).optional(),
    detail_note: z.string().trim().min(1).max(240).optional(),
    // Creative Editor Template Foundation V1: the brand block's label (Pack B
    // Slide 1 shows the project name beside the logo). Optional — absent on
    // every manifest authored before it existed.
    brand_label: z.string().trim().min(1).max(80).optional(),
  })
  .strict()

export type DocumentaryCardCoverContent = z.infer<typeof DocumentaryCardCoverContentSchema>

// Cover requires a hero; logo is optional and normally resolved from
// Project Identity rather than repeated in every manifest.
export const DocumentaryCardCoverAssetsSchema = z
  .object({
    hero: AssetRefSchema,
    logo: AssetRefSchema.optional(),
  })
  .strict()

export type DocumentaryCardCoverAssets = z.infer<typeof DocumentaryCardCoverAssetsSchema>

// ─── Info ────────────────────────────────────────────────────────────────────
//
// Decision C5: body_blocks are plain paragraphs (no arbitrary rich text in
// V0). fact_cards: 1..2 per composition — a need for 3+ likely signals a
// different variant, not a bigger info.

export const DocumentaryCardFactCardSchema = z
  .object({
    primary: z.string().trim().min(1).max(64),
    secondary: z.string().trim().min(1).max(96).optional(),
    tertiary: z.string().trim().min(1).max(64).optional(),
  })
  .strict()

export type DocumentaryCardFactCard = z.infer<typeof DocumentaryCardFactCardSchema>

export const DocumentaryCardInfoContentSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    intro: z.string().trim().min(1).max(220).optional(),

    body_blocks: z.array(z.string().trim().min(1).max(600)).min(1).max(2),
    fact_cards: z.array(DocumentaryCardFactCardSchema).min(1).max(2),

    source_line: z.string().trim().min(1).max(160).optional(),
    annotation: z.string().trim().min(1).max(140).optional(),
  })
  .strict()

export type DocumentaryCardInfoContent = z.infer<typeof DocumentaryCardInfoContentSchema>

// Info does not depend on a hero — all asset slots are optional.
export const DocumentaryCardInfoAssetsSchema = z
  .object({
    logo: AssetRefSchema.optional(),
    supporting_image: AssetRefSchema.optional(),
  })
  .strict()

export type DocumentaryCardInfoAssets = z.infer<typeof DocumentaryCardInfoAssetsSchema>

// ─── Shared: closed icon set ─────────────────────────────────────────────────
//
// Code-drawn line icons (components/creative/documentary-card/icons.tsx), shared
// by every layout that sets content next to an icon. Closed on purpose: a slide
// that needs a new icon adds one entry here AND its drawing — never an upload.

export const DOCUMENTARY_CARD_ICONS = [
  // Lista (Slides 3–5)
  'microphone', 'pencil', 'book', 'dot', 'nuclear', 'globe', 'factory', 'cart', 'leaf',
  // Grade (Slide 6)
  'tree', 'buildings', 'harvest', 'house', 'star', 'people', 'consensus', 'gear', 'community', 'lock', 'sprout',
  // Rede / Encerramento (Slides 8, 10)
  'radio', 'magazine', 'newspaper', 'bulletin', 'tape', 'photo', 'envelope',
] as const
export type DocumentaryCardIcon = (typeof DOCUMENTARY_CARD_ICONS)[number]
const IconSchema = z.enum(DOCUMENTARY_CARD_ICONS)

/** An icon next to a short label (Grade tiles/ideas, Encerramento materials). */
export const DocumentaryCardIconLabelSchema = z
  .object({
    icon: IconSchema,
    label: z.string().trim().min(1).max(48),
  })
  .strict()

export type DocumentaryCardIconLabel = z.infer<typeof DocumentaryCardIconLabelSchema>

// ─── List ────────────────────────────────────────────────────────────────────
//
// Carousel Growth V1 (Pack A Slide 3 anatomy, recurring in Slides 4/5):
// a title, a short intro, 2..4 icon-led rows and ONE documentary content image
// with its caption; Completion V1 adds an optional closing callout (Slide 5).
// Text may mark emphasis with **double asterisks** (bold only; no other
// markup) — the one bounded rich-text affordance, because Pack A sets names
// and titles in bold inside the sentence.

/** @deprecated alias — the List icons are the shared closed set. */
export const DOCUMENTARY_CARD_LIST_ICONS = DOCUMENTARY_CARD_ICONS
export type DocumentaryCardListIcon = DocumentaryCardIcon

export const DocumentaryCardListItemSchema = z
  .object({
    icon: IconSchema,
    text: z.string().trim().min(1).max(220),
  })
  .strict()

export type DocumentaryCardListItem = z.infer<typeof DocumentaryCardListItemSchema>

export const DocumentaryCardListContentSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    intro: z.string().trim().min(1).max(260).optional(),
    items: z.array(DocumentaryCardListItemSchema).min(2).max(4),
    image_caption: z.string().trim().min(1).max(160).optional(),
    callout: z.string().trim().min(1).max(260).optional(),
  })
  .strict()

export type DocumentaryCardListContent = z.infer<typeof DocumentaryCardListContentSchema>

// List's content image is required, exactly like Cover's hero.
export const DocumentaryCardListAssetsSchema = z
  .object({
    hero: AssetRefSchema,
    logo: AssetRefSchema.optional(),
  })
  .strict()

export type DocumentaryCardListAssets = z.infer<typeof DocumentaryCardListAssetsSchema>

/** Layouts without a content image: logo only. */
const LogoOnlyAssetsSchema = z
  .object({
    logo: AssetRefSchema.optional(),
  })
  .strict()

// ─── Grid ────────────────────────────────────────────────────────────────────
//
// Completion V1 (Pack A Slide 6): a typology — 2..6 icon tiles — plus an
// optional secondary row of up to 6 cross-cutting ideas under its own heading.

export const DocumentaryCardGridContentSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    intro: z.string().trim().min(1).max(260).optional(),
    tiles: z.array(DocumentaryCardIconLabelSchema).min(2).max(6),
    ideas_title: z.string().trim().min(1).max(80).optional(),
    ideas: z.array(DocumentaryCardIconLabelSchema).max(6).optional(),
  })
  .strict()

export type DocumentaryCardGridContent = z.infer<typeof DocumentaryCardGridContentSchema>
export const DocumentaryCardGridAssetsSchema = LogoOnlyAssetsSchema

// ─── Map ─────────────────────────────────────────────────────────────────────
//
// Completion V1 (Pack A Slide 7): places placed by their federative unit on a
// code-drawn Brazil map (IBGE UF geometry) with a legend, an optional "and
// more" line and a note. A pin marks the UF, never an exact location.

export const BRAZIL_UF_CODES = [
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA',
  'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
] as const

export const DocumentaryCardMapPlaceSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    uf: z.enum(BRAZIL_UF_CODES),
  })
  .strict()

export type DocumentaryCardMapPlace = z.infer<typeof DocumentaryCardMapPlaceSchema>

export const DocumentaryCardMapContentSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    intro: z.string().trim().min(1).max(260).optional(),
    places: z.array(DocumentaryCardMapPlaceSchema).min(1).max(12),
    places_more: z.string().trim().min(1).max(60).optional(),
    note: z.string().trim().min(1).max(160).optional(),
  })
  .strict()

export type DocumentaryCardMapContent = z.infer<typeof DocumentaryCardMapContentSchema>
export const DocumentaryCardMapAssetsSchema = LogoOnlyAssetsSchema

// ─── Network ─────────────────────────────────────────────────────────────────
//
// Completion V1 (Pack A Slide 8): 3..9 linked cards (publications, groups…)
// with an optional kicker and an optional icon-led callout with bullets.

export const DocumentaryCardNetworkNodeSchema = z
  .object({
    title: z.string().trim().min(1).max(48),
    subtitle: z.string().trim().min(1).max(60).optional(),
  })
  .strict()

export type DocumentaryCardNetworkNode = z.infer<typeof DocumentaryCardNetworkNodeSchema>

export const DocumentaryCardCalloutSchema = z
  .object({
    icon: IconSchema,
    text: z.string().trim().min(1).max(260),
    bullets: z.array(z.string().trim().min(1).max(48)).max(9).optional(),
  })
  .strict()

export type DocumentaryCardCallout = z.infer<typeof DocumentaryCardCalloutSchema>

export const DocumentaryCardNetworkContentSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    kicker: z.string().trim().min(1).max(80).optional(),
    intro: z.string().trim().min(1).max(260).optional(),
    nodes: z.array(DocumentaryCardNetworkNodeSchema).min(3).max(9),
    callout: DocumentaryCardCalloutSchema.optional(),
  })
  .strict()

export type DocumentaryCardNetworkContent = z.infer<typeof DocumentaryCardNetworkContentSchema>
export const DocumentaryCardNetworkAssetsSchema = LogoOnlyAssetsSchema

// ─── Quote ───────────────────────────────────────────────────────────────────
//
// Completion V1 (Pack A Slide 9): a pull quote as the focal element, with an
// intro, up to 4 bullets, one wide content image and an optional callout.

export const DocumentaryCardQuoteContentSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    intro: z.string().trim().min(1).max(260).optional(),
    bullets: z.array(z.string().trim().min(1).max(120)).max(4).optional(),
    quote: z.string().trim().min(1).max(200),
    callout: z.string().trim().min(1).max(200).optional(),
  })
  .strict()

export type DocumentaryCardQuoteContent = z.infer<typeof DocumentaryCardQuoteContentSchema>

// The wide content image is required (like Cover/List's hero).
export const DocumentaryCardQuoteAssetsSchema = DocumentaryCardListAssetsSchema

// ─── Closing ─────────────────────────────────────────────────────────────────
//
// Completion V1 (Pack A Slide 10): closing statement, up to 6 icon-labelled
// items, an invitation (title / text / contact), the brand block and a tagline.
// The title may carry manual line breaks (\n).

export const DocumentaryCardClosingContentSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    body: z.array(z.string().trim().min(1).max(260)).min(1).max(3),
    items: z.array(DocumentaryCardIconLabelSchema).max(6).optional(),
    cta_title: z.string().trim().min(1).max(80).optional(),
    cta_text: z.string().trim().min(1).max(200).optional(),
    contact: z.string().trim().min(1).max(120).optional(),
    tagline: z.string().trim().min(1).max(80).optional(),
    brand_label: z.string().trim().min(1).max(80).optional(),
  })
  .strict()

export type DocumentaryCardClosingContent = z.infer<typeof DocumentaryCardClosingContentSchema>
export const DocumentaryCardClosingAssetsSchema = LogoOnlyAssetsSchema
