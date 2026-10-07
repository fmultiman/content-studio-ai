// VIDEO_MEDIA_ARTIFACT_AND_STREAMING_FOUNDATION_V1
//
// Bounded-memory helpers for large immutable media objects. Nothing in this
// module accumulates a whole object: a stream is consumed chunk by chunk and
// only fixed-size state (a running SHA-256 and two counters) survives a chunk.

import { createHash } from 'node:crypto'

export type ByteChunks = AsyncIterable<Uint8Array>

/** A readable object body plus the metadata storage reported for it. */
export type OpenedObject = {
  stream: ByteChunks & { destroy?: (error?: Error) => unknown }
  contentLength: number | null
  contentType: string
}

/** Opens a TRUSTED storage key for streaming. Callers authorize the key first; no URL is accepted. */
export type ObjectStreamOpener = (
  path: string,
  options?: { signal?: AbortSignal; range?: { start: number; end: number } },
) => Promise<OpenedObject | null>

export class MediaIntegrityError extends Error {
  readonly code: 'HASH_MISMATCH' | 'LENGTH_MISMATCH'
  constructor(code: 'HASH_MISMATCH' | 'LENGTH_MISMATCH', message: string) {
    super(message)
    this.name = 'MediaIntegrityError'
    this.code = code
  }
}

/** SHA-256 + exact byte length of a stream, in O(1) memory. */
export async function sha256OfStream(source: ByteChunks): Promise<{ hash: string; byteLength: number }> {
  const hash = createHash('sha256')
  let byteLength = 0
  for await (const chunk of source) {
    hash.update(chunk)
    byteLength += chunk.byteLength
  }
  return { hash: hash.digest('hex'), byteLength }
}

/**
 * Passes chunks through unchanged while hashing them. When the source ends it
 * proves the bytes equal the immutable artifact identity (length and, when
 * given, SHA-256) and throws `MediaIntegrityError` otherwise. A consumer that
 * stops early never reaches the check, so a consumer that needs the guarantee
 * must drain the iterator to its end BEFORE it commits the data anywhere.
 */
export function verifyingChunks(
  source: ByteChunks & { destroy?: (error?: Error) => unknown },
  expected: { byteLength: number | null; sha256: string | null },
): ByteChunks {
  return {
    async *[Symbol.asyncIterator]() {
      const hash = expected.sha256 ? createHash('sha256') : null
      let seen = 0
      try {
        for await (const chunk of source) {
          hash?.update(chunk)
          seen += chunk.byteLength
          if (expected.byteLength !== null && seen > expected.byteLength) {
            throw new MediaIntegrityError('LENGTH_MISMATCH', 'Media is longer than its immutable artifact size.')
          }
          yield chunk
        }
      } catch (error) {
        source.destroy?.(error instanceof Error ? error : undefined)
        throw error
      }
      if (expected.byteLength !== null && seen !== expected.byteLength) {
        throw new MediaIntegrityError('LENGTH_MISMATCH', 'Media is shorter than its immutable artifact size.')
      }
      if (hash && hash.digest('hex') !== expected.sha256) {
        throw new MediaIntegrityError('HASH_MISMATCH', 'Media no longer matches its immutable artifact hash.')
      }
    },
  }
}
