import { z } from 'zod'
import { AssetRefSchema } from './primitives'

// ─── Wave 2 — Neutral Schemas ───────────────────────────────────────────────
//
// editorial.documentary-card@0.1.0 content/asset contracts.
//
// Decision C5 (Wave 2): variant-specific schemas, not one large object full
// of optional flags. Variants are `cover`, `info` and (Carousel Growth V1) `list` — "standard" is
// prior nomenclature and must not appear as an announced variant here.
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

// ─── List ────────────────────────────────────────────────────────────────────
//
// Carousel Growth V1 (Pack A Slide 3 anatomy, recurring in Slides 5/6/10):
// a title, a short intro, 2..4 icon-led rows and ONE documentary content image
// with its caption. Icons are a closed, code-backed set — not arbitrary
// uploads. Text may mark emphasis with **double asterisks** (bold only; no
// other markup) — the one bounded rich-text affordance, because Pack A sets
// names and titles in bold inside the sentence.

export const DOCUMENTARY_CARD_LIST_ICONS = ['microphone', 'pencil', 'book'] as const
export type DocumentaryCardListIcon = (typeof DOCUMENTARY_CARD_LIST_ICONS)[number]

export const DocumentaryCardListItemSchema = z
  .object({
    icon: z.enum(DOCUMENTARY_CARD_LIST_ICONS),
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
