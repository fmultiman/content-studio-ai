import { describe, expect, it } from 'vitest'
import { dataUrlToFile, renderOutputFilename } from '@/lib/creative/authoring'

const ONE_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

describe('renderOutputFilename', () => {
  it('produces a deterministic, non-sensitive filename from a timestamp', () => {
    expect(renderOutputFilename(1700000000000)).toBe('static-render-1700000000000.png')
  })

  it('never embeds project, content, or channel piece identifiers', () => {
    const name = renderOutputFilename(123)
    expect(name).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
  })
})

describe('dataUrlToFile', () => {
  it('converts a PNG data URL into a File with the PNG MIME type preserved', () => {
    const dataUrl = `data:image/png;base64,${ONE_PIXEL_PNG_BASE64}`
    const file = dataUrlToFile(dataUrl, 'static-render-1.png')
    expect(file).toBeInstanceOf(File)
    expect(file.type).toBe('image/png')
    expect(file.name).toBe('static-render-1.png')
    expect(file.size).toBeGreaterThan(0)
  })

  it('uses a generated filename when none is provided', () => {
    const dataUrl = `data:image/png;base64,${ONE_PIXEL_PNG_BASE64}`
    const file = dataUrlToFile(dataUrl)
    expect(file.name).toMatch(/^static-render-\d+\.png$/)
  })

  it('rejects a malformed render (not a data URL)', () => {
    expect(() => dataUrlToFile('not-a-data-url')).toThrow(/Render invalido/)
  })

  it('rejects an empty string', () => {
    expect(() => dataUrlToFile('')).toThrow(/Render invalido/)
  })
})
