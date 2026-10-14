// PROVIDER_COST_ATTRIBUTION_V1 — shared fixtures: the reviewed OpenAI GPT Image 2 / Google Veo pricing SQL applied to a
// Production-shaped PGlite registry (061 + 062 + FUTURE-064 Slice D = what Production has today). Test-only.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PGlite } from '@electric-sql/pglite'
import { UP as SLICE_D_UP, loadWireRows, prodLike, toVersions } from './image-pricing-fixtures'

const SQL_DIR = join(process.cwd(), 'docs', 'productization', 'sql')
export const PCA_UP = readFileSync(join(SQL_DIR, 'PROVIDER_COST_ATTRIBUTION_V1_openai_image_veo_pricing.up.sql'), 'utf8')
export const PCA_DOWN = readFileSync(join(SQL_DIR, 'PROVIDER_COST_ATTRIBUTION_V1_openai_image_veo_pricing.down.sql'), 'utf8')

export const GPT_IMAGE_2 = 'gpt-image-2'
export const VEO_STANDARD = 'veo-3.1-generate-preview'
export const VEO_FAST = 'veo-3.1-fast-generate-preview'
export const VEO_LITE = 'veo-3.1-lite-generate-preview'
export const VEO_MODELS = [VEO_STANDARD, VEO_FAST, VEO_LITE]
export const PCA_SCOPE = `((provider = 'openai' AND model = '${GPT_IMAGE_2}') OR (provider = 'gemini' AND model IN ('${VEO_STANDARD}', '${VEO_FAST}', '${VEO_LITE}')))`

export const SLICE_D_CHECK = "CHECK((usage_category=ANY(ARRAY['input'::text,'cached_input'::text,'output'::text,'image_output'::text,'unit'::text])))"
export const PCA_CHECK =
  "CHECK((usage_category=ANY(ARRAY['input'::text,'cached_input'::text,'output'::text,'image_output'::text,'image_input'::text,'unit'::text,'video_second_720p'::text,'video_second_1080p'::text,'video_second_4k'::text])))"

/** Production TODAY: 061 + 062 + Slice D (28 rows, 5-category constraint). */
export async function productionToday(): Promise<PGlite> {
  const db = await prodLike()
  await db.exec(SLICE_D_UP)
  return db
}

/** The registries before / after the reviewed SQL, in the app's own validated shape. */
export async function registriesBeforeAndAfter() {
  const before = await productionToday()
  const beforeRows = await loadWireRows(before)
  await before.close()
  const after = await productionToday()
  await after.exec(PCA_UP)
  const afterRows = await loadWireRows(after)
  await after.close()
  return { beforeRows, afterRows, before: toVersions(beforeRows), after: toVersions(afterRows) }
}
