// VIDEO_MEDIA_ARTIFACT_AND_STREAMING_FOUNDATION_V1
//
// Factual MP4 container metadata WITHOUT downloading the object. An ISO-BMFF
// file is a sequence of top-level boxes; each header (8 or 16 bytes) states the
// box size, so the `moov` box (which holds duration and track dimensions) can
// be located with a handful of tiny ranged reads even when it sits at the end
// of a multi-hundred-MB file. Only `moov` itself is ever read in full, capped
// at MAX_MOOV_BYTES. Unreadable or unrecognised containers yield nulls: this
// module never estimates a value.

export type Mp4Facts = {
  durationMs: number | null
  width: number | null
  height: number | null
}

/** Inclusive byte range read; may return fewer bytes at end of object. */
export type RangeReader = (start: number, end: number) => Promise<Uint8Array>

export const MAX_MOOV_BYTES = 8 * 1024 * 1024
const MAX_TOP_LEVEL_BOXES = 64
const EMPTY: Mp4Facts = { durationMs: null, width: null, height: null }

type Box = { type: string; start: number; headerSize: number; size: number }

function fourcc(view: DataView, offset: number) {
  return String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3))
}

function view(bytes: Uint8Array) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function readU64(data: DataView, offset: number): number {
  const high = data.getUint32(offset)
  const low = data.getUint32(offset + 4)
  const value = high * 2 ** 32 + low
  return Number.isSafeInteger(value) ? value : Number.NaN
}

/** Parses child boxes in `bytes[from, to)`. Stops at the first malformed box. */
function childBoxes(data: DataView, from: number, to: number): Box[] {
  const boxes: Box[] = []
  let offset = from
  while (offset + 8 <= to) {
    let size = data.getUint32(offset)
    const type = fourcc(data, offset + 4)
    let headerSize = 8
    if (size === 1) {
      if (offset + 16 > to) break
      size = readU64(data, offset + 8)
      headerSize = 16
    } else if (size === 0) {
      size = to - offset
    }
    if (!Number.isFinite(size) || size < headerSize || offset + size > to) break
    boxes.push({ type, start: offset, headerSize, size })
    offset += size
  }
  return boxes
}

function parseMvhdDurationMs(data: DataView, box: Box): number | null {
  const body = box.start + box.headerSize
  if (body + 4 > box.start + box.size) return null
  const version = data.getUint8(body)
  let timescale: number
  let duration: number
  if (version === 1) {
    if (body + 32 > box.start + box.size) return null
    timescale = data.getUint32(body + 20)
    duration = readU64(data, body + 24)
  } else if (version === 0) {
    if (body + 20 > box.start + box.size) return null
    timescale = data.getUint32(body + 12)
    duration = data.getUint32(body + 16)
  } else {
    return null
  }
  if (!timescale || !Number.isFinite(duration) || duration <= 0) return null
  return Math.round((duration * 1000) / timescale)
}

function isVideoTrack(data: DataView, trak: Box): boolean {
  const mdia = childBoxes(data, trak.start + trak.headerSize, trak.start + trak.size).find((box) => box.type === 'mdia')
  if (!mdia) return false
  const hdlr = childBoxes(data, mdia.start + mdia.headerSize, mdia.start + mdia.size).find((box) => box.type === 'hdlr')
  if (!hdlr) return false
  const body = hdlr.start + hdlr.headerSize
  if (body + 12 > hdlr.start + hdlr.size) return false
  return fourcc(data, body + 8) === 'vide'
}

/** tkhd ends with width and height as 16.16 fixed point in both box versions. */
function parseTkhdDimensions(data: DataView, tkhd: Box): { width: number; height: number } | null {
  const end = tkhd.start + tkhd.size
  if (end - 8 < tkhd.start + tkhd.headerSize + 4) return null
  const width = Math.round(data.getUint32(end - 8) / 65536)
  const height = Math.round(data.getUint32(end - 4) / 65536)
  return width > 0 && height > 0 ? { width, height } : null
}

/** Pure parse of a complete `moov` box (header included). */
export function parseMoovBox(moov: Uint8Array): Mp4Facts {
  const data = view(moov)
  const [root] = childBoxes(data, 0, moov.byteLength)
  if (!root || root.type !== 'moov') return EMPTY
  const children = childBoxes(data, root.start + root.headerSize, root.start + root.size)
  const mvhd = children.find((box) => box.type === 'mvhd')
  const durationMs = mvhd ? parseMvhdDurationMs(data, mvhd) : null
  let dimensions: { width: number; height: number } | null = null
  for (const trak of children.filter((box) => box.type === 'trak')) {
    if (!isVideoTrack(data, trak)) continue
    const tkhd = childBoxes(data, trak.start + trak.headerSize, trak.start + trak.size).find((box) => box.type === 'tkhd')
    dimensions = tkhd ? parseTkhdDimensions(data, tkhd) : null
    if (dimensions) break
  }
  return { durationMs, width: dimensions?.width ?? null, height: dimensions?.height ?? null }
}

/**
 * Locates and parses `moov` using ranged reads of box headers only. Returns
 * all-null facts for anything that is not a well-formed MP4 or whose `moov`
 * exceeds MAX_MOOV_BYTES. Reader failures propagate to the caller.
 */
export async function probeMp4(read: RangeReader, totalSize: number): Promise<Mp4Facts> {
  if (!Number.isSafeInteger(totalSize) || totalSize < 16) return EMPTY
  let offset = 0
  for (let boxIndex = 0; boxIndex < MAX_TOP_LEVEL_BOXES && offset + 8 <= totalSize; boxIndex += 1) {
    const header = await read(offset, Math.min(offset + 15, totalSize - 1))
    if (header.byteLength < 8) return EMPTY
    const data = view(header)
    let size = data.getUint32(0)
    const type = fourcc(data, 4)
    if (boxIndex === 0 && type !== 'ftyp') return EMPTY
    if (size === 1) {
      if (header.byteLength < 16) return EMPTY
      size = readU64(data, 8)
    } else if (size === 0) {
      size = totalSize - offset
    }
    if (!Number.isFinite(size) || size < 8 || offset + size > totalSize) return EMPTY
    if (type === 'moov') {
      if (size > MAX_MOOV_BYTES) return EMPTY
      const moov = await read(offset, offset + size - 1)
      return moov.byteLength === size ? parseMoovBox(moov) : EMPTY
    }
    offset += size
  }
  return EMPTY
}
