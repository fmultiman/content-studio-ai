// CREATIVE_EDITOR_REAL_SMOKE_CORRECTNESS_HARDENING_V1
//
// The ONE server read of "this LibraryFile as the editors display it": the same row shape the Library list
// endpoints return (a short-lived signed read URL in `public_url` / `thumbnail_url`), for a single file.
//
// Why it exists: the stored `public_url` of a Library object is not a usable browser source (the bucket is
// private); only a signed URL is. The Static editor's Canvas draws `public_url` straight from its image cache,
// so any code path that hands the cache the raw table row paints a broken <img> (its alt text is the file name).
// Read-only. Owner-scoped. The Project is a constraint the caller names, never a way to widen the scope.

import type { SupabaseClient } from '@supabase/supabase-js'
import { presignLibraryRead } from '@/lib/storage/library-storage'
import type { SlotLibraryFile } from '@/lib/creative/authoring/asset-slots'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type DisplayFileResolution =
  | { ok: true; file: SlotLibraryFile }
  | { ok: false; code: 'INVALID_REQUEST' | 'NOT_FOUND' }

/** An owned, active IMAGE LibraryFile of the named (owned) Project, with a signed display URL. */
export async function resolveProjectImageDisplayFile(
  supabase: SupabaseClient,
  userId: string,
  params: { fileId: unknown; projectId: unknown },
): Promise<DisplayFileResolution> {
  if (typeof params.fileId !== 'string' || !UUID_RE.test(params.fileId)) return { ok: false, code: 'INVALID_REQUEST' }
  if (typeof params.projectId !== 'string' || !UUID_RE.test(params.projectId)) return { ok: false, code: 'INVALID_REQUEST' }

  // Missing, someone else's, trashed, another Project's and non-image all look the same: nothing is revealed.
  const { data, error } = await supabase
    .from('library_files')
    .select('id, user_id, name, public_url, thumbnail_url, mime_type, origin, storage_path')
    .eq('id', params.fileId)
    .eq('user_id', userId)
    .eq('project_id', params.projectId)
    .eq('kind', 'image')
    .is('deleted_at', null)
    .maybeSingle()
  if (error || !data) return { ok: false, code: 'NOT_FOUND' }

  const signed = await presignLibraryRead(data as { user_id: string; storage_path: string | null }).catch(() => null)
  return {
    ok: true,
    file: {
      id: data.id as string,
      name: data.name as string,
      public_url: signed || (data.public_url as string),
      thumbnail_url: signed || (data.thumbnail_url as string | null),
      mime_type: (data.mime_type as string | null) ?? null,
      origin: data.origin as SlotLibraryFile['origin'],
    },
  }
}
