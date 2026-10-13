// VEO_KLING_FIRST_LAST_FRAME_V1 — the FIRST frame and the (optional) LAST frame of an image_to_video generation.
//
// "First/Last Frame" DEFINES the start and the end of the clip. It is NOT "Reference Images" (identity / appearance /
// style guidance), which this product does not offer. The two frames are two independent, durable identities:
//
//   first frame  -> sourceImageId | sourceLibraryFileId        (unchanged since I2V V1; stored in source_image_id /
//                                                                source_library_file_id, so single-image I2V is untouched)
//   last frame   -> lastFrameImageId | lastFrameLibraryFileId  (same XOR rule, same trust chain)
//
// The last frame has no database column of its own: its identity lives in the attempt's immutable `request_config`
// (`first_frame` / `last_frame` = { type, id }) and in the Session working state (`lastFrame`). These are ids that name
// durable records — never a presigned URL, a storage path or a browser URL.
//
// Pure and client-safe (no server imports).

import type { I2vSource } from './i2v-source'

export type FrameIdentity = I2vSource

export interface LastFrameFields {
  lastFrameImageId?: string
  lastFrameLibraryFileId?: string
}

/** Request fields for the current last frame: exactly one, or none outside image_to_video. */
export function lastFrameFields(operation: string | null, lastFrame: FrameIdentity | null): LastFrameFields {
  if (operation !== 'image_to_video' || !lastFrame) return {}
  return lastFrame.type === 'library' ? { lastFrameLibraryFileId: lastFrame.id } : { lastFrameImageId: lastFrame.id }
}

const isIdentity = (value: unknown): value is FrameIdentity => {
  if (!value || typeof value !== 'object') return false
  const entry = value as { type?: unknown; id?: unknown }
  return (entry.type === 'generated' || entry.type === 'library') && typeof entry.id === 'string' && entry.id.length > 0
}

/** The frame identities an attempt recorded. Both are null for text_to_video and for rows from before first/last frame. */
export function readFrameIdentities(config: unknown): { firstFrame: FrameIdentity | null; lastFrame: FrameIdentity | null } {
  const source = config && typeof config === 'object' ? (config as Record<string, unknown>) : {}
  return {
    firstFrame: isIdentity(source.first_frame) ? source.first_frame : null,
    lastFrame: isIdentity(source.last_frame) ? source.last_frame : null,
  }
}

/** The immutable record of the frames an attempt was submitted with (merged into request_config). */
export function frameConfig(first: FrameIdentity | null, last: FrameIdentity | null): Record<string, unknown> {
  return {
    ...(first ? { first_frame: { type: first.type, id: first.id } } : {}),
    ...(last ? { last_frame: { type: last.type, id: last.id } } : {}),
  }
}

/** One quiet history line, or null for an attempt that used a single (or no) image. */
export function describeFrameProvenance(generation: { request_config?: Record<string, unknown> | null }): string | null {
  const { lastFrame } = readFrameIdentities(generation.request_config)
  return lastFrame ? 'Primeiro e último quadro: o vídeo parte da imagem inicial e termina na imagem final.' : null
}
