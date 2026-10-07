// Synthetic ISO-BMFF builders for tests (no real media involved).

export function box(type: string, ...payload: Uint8Array[]): Uint8Array {
  const body = Buffer.concat(payload)
  const out = Buffer.alloc(8 + body.length)
  out.writeUInt32BE(out.length, 0)
  out.write(type, 4, 'ascii')
  body.copy(out, 8)
  return out
}

export function mvhd(version: 0 | 1, timescale: number, duration: number): Uint8Array {
  if (version === 0) {
    const body = Buffer.alloc(100)
    body.writeUInt32BE(timescale, 12)
    body.writeUInt32BE(duration, 16)
    return box('mvhd', body)
  }
  const body = Buffer.alloc(112)
  body[0] = 1
  body.writeUInt32BE(timescale, 20)
  body.writeBigUInt64BE(BigInt(duration), 24)
  return box('mvhd', body)
}

export function tkhd(width: number, height: number): Uint8Array {
  const body = Buffer.alloc(84)
  body.writeUInt32BE(Math.round(width * 65536), 76)
  body.writeUInt32BE(Math.round(height * 65536), 80)
  return box('tkhd', body)
}

export function hdlr(handler: string): Uint8Array {
  const body = Buffer.alloc(24)
  body.write(handler, 8, 'ascii')
  return box('hdlr', body)
}

export function trak(handler: string, width: number, height: number): Uint8Array {
  return box('trak', tkhd(width, height), box('mdia', hdlr(handler)))
}

export const ftyp = box('ftyp', Buffer.from('isom0000isomiso2', 'ascii'))


export function makeMp4(options: { durationMs: number; width: number; height: number; payloadBytes?: number }): Buffer {
  const mdat = box('mdat', Buffer.alloc(options.payloadBytes ?? 256, 9))
  const moov = box('moov', mvhd(0, 1000, options.durationMs), trak('vide', options.width, options.height))
  return Buffer.concat([ftyp, mdat, moov])
}
