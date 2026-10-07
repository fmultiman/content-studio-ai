import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { MediaIntegrityError, sha256OfStream, verifyingChunks } from '../streaming'

function pieces(count: number, size: number): AsyncIterable<Uint8Array> {
  return {
    async *[Symbol.asyncIterator]() {
      for (let i = 0; i < count; i += 1) yield new Uint8Array(size).fill(i % 251)
    },
  }
}

function expectedHash(count: number, size: number) {
  const hash = createHash('sha256')
  for (let i = 0; i < count; i += 1) hash.update(new Uint8Array(size).fill(i % 251))
  return hash.digest('hex')
}

describe('stream hashing', () => {
  it('hashes a 64 MiB stream chunk by chunk, holding only one piece at a time', async () => {
    const alive = { current: 0, max: 0 }
    const source: AsyncIterable<Uint8Array> = {
      async *[Symbol.asyncIterator]() {
        for (let i = 0; i < 64; i += 1) {
          alive.current += 1
          alive.max = Math.max(alive.max, alive.current)
          yield new Uint8Array(1024 * 1024).fill(i % 251)
          alive.current -= 1
        }
      },
    }
    const concat = vi.spyOn(Buffer, 'concat')
    const result = await sha256OfStream(source)
    expect(result).toEqual({ hash: expectedHash(64, 1024 * 1024), byteLength: 64 * 1024 * 1024 })
    expect(alive.max).toBe(1)
    // No whole-object join happened anywhere in the hash path.
    expect(concat).not.toHaveBeenCalled()
    concat.mockRestore()
  })

  it('hashes a real Node readable', async () => {
    const result = await sha256OfStream(Readable.from([Buffer.from('abc'), Buffer.from('def')]))
    expect(result.hash).toBe(createHash('sha256').update('abcdef').digest('hex'))
    expect(result.byteLength).toBe(6)
  })
})

describe('verifyingChunks', () => {
  const hash = expectedHash(4, 1000)

  it('passes bytes through unchanged and accepts an exact match at the end', async () => {
    const seen: number[] = []
    for await (const chunk of verifyingChunks(pieces(4, 1000), { byteLength: 4000, sha256: hash })) seen.push(chunk.byteLength)
    expect(seen).toEqual([1000, 1000, 1000, 1000])
  })

  it('fails the stream when the bytes no longer match the immutable hash', async () => {
    const run = async () => { for await (const _ of verifyingChunks(pieces(4, 1000), { byteLength: 4000, sha256: 'a'.repeat(64) })) { /* drain */ } }
    await expect(run()).rejects.toMatchObject({ name: 'MediaIntegrityError', code: 'HASH_MISMATCH' })
  })

  it('rejects a longer or shorter object than the artifact size', async () => {
    const longer = async () => { for await (const _ of verifyingChunks(pieces(4, 1000), { byteLength: 3500, sha256: null })) { /* drain */ } }
    await expect(longer()).rejects.toBeInstanceOf(MediaIntegrityError)
    const shorter = async () => { for await (const _ of verifyingChunks(pieces(2, 1000), { byteLength: 4000, sha256: null })) { /* drain */ } }
    await expect(shorter()).rejects.toMatchObject({ code: 'LENGTH_MISMATCH' })
  })

  it('destroys the underlying storage stream when the read fails', async () => {
    const destroy = vi.fn()
    const source = Object.assign({
      async *[Symbol.asyncIterator]() { yield new Uint8Array(10); throw new Error('connection reset') },
    }, { destroy })
    const run = async () => { for await (const _ of verifyingChunks(source, { byteLength: 100, sha256: null })) { /* drain */ } }
    await expect(run()).rejects.toThrow('connection reset')
    expect(destroy).toHaveBeenCalledTimes(1)
  })
})
