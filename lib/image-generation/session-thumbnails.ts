// IMAGE_GENERATION_WORKSPACE_REGRESSION_RECOVERY_V1
//
// "Gerações recentes" cards need the thumbnail of each Session's CURRENT image. The Session row only
// carries `current_image_id`, so the list route resolves it server-side: one owner-scoped batch read of
// `images`, then a presigned URL for a thumbnail key proven to be this owner's (falling back to the
// stored URL only for legacy rows with no key). A Session without a current image, or an image with no
// usable thumbnail, gets `thumbnailUrl: null` (intentional placeholder). Nothing is fabricated.

import type { SupabaseClient } from '@supabase/supabase-js'
import { isTrustedImageStoragePath } from '@/lib/storage/image-path'
import { presignImageObject } from '@/lib/storage/image-storage'

type ThumbRow = { id: string; thumbnail_url: string | null; thumbnail_path: string | null }

export async function resolveSessionThumbnails(
  db: SupabaseClient,
  userId: string,
  currentImageIds: ReadonlyArray<string | null>,
  presign: typeof presignImageObject = presignImageObject,
): Promise<Map<string, string>> {
  const ids = [...new Set(currentImageIds.filter((id): id is string => typeof id === 'string' && id.length > 0))]
  const out = new Map<string, string>()
  if (ids.length === 0) return out
  const { data, error } = await db.from('images').select('id, thumbnail_url, thumbnail_path').eq('user_id', userId).in('id', ids)
  if (error || !data) return out
  await Promise.all((data as ThumbRow[]).map(async (row) => {
    let url: string | null = null
    if (row.thumbnail_path) {
      url = isTrustedImageStoragePath(userId, row.thumbnail_path, 'thumbnail')
        ? await presign(userId, row.thumbnail_path, 'thumbnail').catch(() => null)
        : null
    }
    // Legacy rows (no key) keep their stored URL; a row with an untrusted key is never signed or echoed.
    if (!url && !row.thumbnail_path && row.thumbnail_url) url = row.thumbnail_url
    if (url) out.set(row.id, url)
  }))
  return out
}
