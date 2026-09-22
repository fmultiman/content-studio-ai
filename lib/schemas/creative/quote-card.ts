import { z } from 'zod'

/** editorial.quote-card@0.1.0 template-specific content contract. */
export const QuoteCardContentSchema = z
  .object({
    eyebrow: z.string().trim().min(1).max(48).optional(),
    quote: z.string().trim().min(1).max(600),
    attribution: z.string().trim().min(1).max(160).optional(),
    source_line: z.string().trim().min(1).max(160).optional(),
  })
  .strict()

export type QuoteCardContent = z.infer<typeof QuoteCardContentSchema>

/** Quote Card deliberately has no required assets in Wave 9A. */
export const QuoteCardAssetsSchema = z.object({}).strict()

export type QuoteCardAssets = z.infer<typeof QuoteCardAssetsSchema>
