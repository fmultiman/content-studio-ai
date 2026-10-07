import { describe, expect, it, vi } from 'vitest'
import { box, ftyp, hdlr, mvhd, tkhd, trak } from './mp4-fixture'
import { MAX_MOOV_BYTES, parseMoovBox, probeMp4, type RangeReader } from '../mp4-metadata'

function file(parts: Uint8Array[]): Buffer {
  return Buffer.concat(parts)
}

function reader(bytes: Buffer): RangeReader & ReturnType<typeof vi.fn> {
  return vi.fn(async (start: number, end: number) => new Uint8Array(bytes.subarray(start, Math.min(end + 1, bytes.length)))) as never
}

describe('MP4 container metadata', () => {
  it('reads duration and video-track dimensions, skipping audio tracks', () => {
    const moov = box('moov', mvhd(0, 1000, 12_345), trak('soun', 0, 0), trak('vide', 1920, 1080))
    expect(parseMoovBox(moov)).toEqual({ durationMs: 12_345, width: 1920, height: 1080 })
  })

  it('supports 64-bit version-1 headers and scales by the timescale', () => {
    const moov = box('moov', mvhd(1, 90_000, 450_000), trak('vide', 720, 1280))
    expect(parseMoovBox(moov)).toEqual({ durationMs: 5000, width: 720, height: 1280 })
  })

  it('leaves unknown values null instead of guessing', () => {
    expect(parseMoovBox(box('moov', mvhd(0, 1000, 0)))).toEqual({ durationMs: null, width: null, height: null })
    expect(parseMoovBox(box('moov', mvhd(0, 0, 5000)))).toEqual({ durationMs: null, width: null, height: null })
    expect(parseMoovBox(box('moov', trak('vide', 0, 0)))).toEqual({ durationMs: null, width: null, height: null })
    expect(parseMoovBox(new Uint8Array([1, 2, 3]))).toEqual({ durationMs: null, width: null, height: null })
  })

  it('finds a trailing moov with header-sized ranged reads and never reads the media payload', async () => {
    const mdat = box('mdat', Buffer.alloc(5 * 1024 * 1024, 7))
    const moov = box('moov', mvhd(0, 1000, 8000), trak('vide', 640, 360))
    const bytes = file([ftyp, mdat, moov])
    const read = reader(bytes)
    expect(await probeMp4(read, bytes.length)).toEqual({ durationMs: 8000, width: 640, height: 360 })
    const spans = read.mock.calls.map(([start, end]) => end - start + 1)
    // ftyp, mdat and moov headers, then moov in full: the 5 MiB payload is skipped by arithmetic.
    expect(read.mock.calls).toHaveLength(4)
    expect(Math.max(...spans)).toBe(moov.length)
    expect(spans.reduce((a, b) => a + b, 0)).toBeLessThan(1024)
  })

  it('returns nulls for non-MP4 data, truncated boxes and oversized moov', async () => {
    const nothing = { durationMs: null, width: null, height: null }
    const junk = Buffer.alloc(64, 1)
    expect(await probeMp4(reader(junk), junk.length)).toEqual(nothing)
    const truncated = file([ftyp, Buffer.from([0, 0, 0xff, 0xff, 0x6d, 0x6f, 0x6f, 0x76, 0, 0, 0, 0, 0, 0, 0, 0])])
    expect(await probeMp4(reader(truncated), truncated.length)).toEqual(nothing)
    const huge = Buffer.alloc(16)
    huge.writeUInt32BE(MAX_MOOV_BYTES + 1, 0)
    huge.write('moov', 4, 'ascii')
    const big = file([ftyp, huge])
    expect(await probeMp4(reader(big), MAX_MOOV_BYTES + 1 + ftyp.length)).toEqual(nothing)
  })

  it('propagates storage read failures to the caller', async () => {
    const failing: RangeReader = async () => { throw new Error('s3 down') }
    await expect(probeMp4(failing, 1024)).rejects.toThrow('s3 down')
  })
})
