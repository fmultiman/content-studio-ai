import { type ResolvedAsset } from '@/lib/creative/assets/resolve-asset'
import type { LibraryFile } from '@/lib/types'
// In a fully live environment, this would import the real s3 client:
// import { createPresignedReadUrl } from '@/lib/storage/s3'

export type ProductAssetAdapterContext = {
  // We inject the dependency to maintain purity and environment agnosticism in the CLI
  createPresignedReadUrl: (path: string) => Promise<string | null>
}

/** Raster images (not SVG), plus the video/audio containers the render engine decodes today. */
export const RENDERABLE_VIDEO_MIME = ['video/mp4', 'video/webm', 'video/quicktime'] as const
export const RENDERABLE_AUDIO_MIME = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/webm'] as const

export function isRenderableLibraryFile(file: Pick<LibraryFile, 'kind' | 'mime_type'>): boolean {
  const mime = file.mime_type ?? ''
  if (file.kind === 'image') return mime.startsWith('image/') && mime !== 'image/svg+xml'
  if (file.kind === 'video') return (RENDERABLE_VIDEO_MIME as readonly string[]).includes(mime)
  if (file.kind === 'audio') return (RENDERABLE_AUDIO_MIME as readonly string[]).includes(mime)
  return false
}

/**
 * Product Asset Adapter
 * 
 * Adapts a canonical database `LibraryFile` into a `ResolvedAsset` ready
 * for the Creative Rendering core, performing S3 presigning asynchronously
 * and guaranteeing rendering pipelines don't touch DB clients or AWS SDKs.
 */
export async function adaptLibraryFileToResolvedAsset(
  file: LibraryFile,
  context: ProductAssetAdapterContext
): Promise<ResolvedAsset | null> {
  // The renderer primarily needs raster formats for documentaries, but we map
  // the exact MIME type. VIDEO_TIMELINE_GATE_B adds the bounded media the
  // independent timeline layer references (B-roll video, audio); which slot may
  // use which kind is enforced by the caller (templates take images only).
  if (!isRenderableLibraryFile(file)) {
    // SVG is excluded until sanitization strategy is proven.
    return null
  }

  // A LibraryFile without a storage path cannot be safely downloaded by Remotion
  if (!file.storage_path) {
    return null
  }

  const url = await context.createPresignedReadUrl(file.storage_path)
  if (!url) {
    return null
  }

  return {
    ref: file.id,
    source: 'library_file',
    path: file.storage_path,
    url,
    // isRenderableLibraryFile guarantees a concrete MIME type here.
    mime_type: file.mime_type ?? 'application/octet-stream',
    // Size is retrieved if available in LibraryFile schema, but usually
    // `file_size` is bytes. Image dimensions aren't on typical LibraryFile V1
    // without a child Media schema. We defer probing to the renderer.
    alt: file.name, 
  }
}
