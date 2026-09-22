import { type ResolvedAsset } from '@/lib/creative/assets/resolve-asset'
import type { LibraryFile } from '@/lib/types'
// In a fully live environment, this would import the real s3 client:
// import { createPresignedReadUrl } from '@/lib/storage/s3'

export type ProductAssetAdapterContext = {
  // We inject the dependency to maintain purity and environment agnosticism in the CLI
  createPresignedReadUrl: (path: string) => Promise<string | null>
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
  // the exact MIME type.
  if (file.kind !== 'image' || !file.mime_type?.startsWith('image/')) {
    // Only image files are formally supported within Documentary/Quote visuals 
    // at this Phase. SVG is excluded until sanitization strategy is proven.
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
    mime_type: file.mime_type,
    // Size is retrieved if available in LibraryFile schema, but usually
    // `file_size` is bytes. Image dimensions aren't on typical LibraryFile V1
    // without a child Media schema. We defer probing to the renderer.
    alt: file.name, 
  }
}
