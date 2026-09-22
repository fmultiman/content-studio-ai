import { readFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { resolveStaticRenderManifest } from '@/lib/creative/resolution/resolve-static-render'
import { resolveTemplateComponent } from '@/lib/creative/templates/component-resolver'

const manifestRoot = path.resolve(process.cwd(), 'scripts/creative/fixtures/static-render-manifests')
const manifestFiles = [
  'documentary-card-cover-1080x1350-a.json',
  'documentary-card-info-1080x1350-a.json',
  'documentary-card-cover-1080x1920-a.json',
  'documentary-card-cover-1080x1350-b.json',
]

async function readManifest(name: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(manifestRoot, name), 'utf8')) as unknown
}

describe('Wave 5 official static render path contracts', () => {
  it('resolves every official manifest through the Wave 3 resolver', async () => {
    for (const file of manifestFiles) {
      const result = resolveStaticRenderManifest(await readManifest(file))
      expect(result.valid, file).toBe(true)
    }
  })

  it('resolves the registered component_key without a project-specific branch', async () => {
    const a = resolveStaticRenderManifest(await readManifest(manifestFiles[0]))
    const b = resolveStaticRenderManifest(await readManifest(manifestFiles[3]))
    expect(a.valid && b.valid).toBe(true)
    if (!a.valid || !b.valid) return
    expect(a.value.resolvedTemplate.descriptor.component_key).toBe('editorial.documentary-card')
    expect(resolveTemplateComponent(a.value.resolvedTemplate.descriptor.component_key)).toBeDefined()
    expect(b.value.resolvedTemplate.descriptor.component_key).toBe(a.value.resolvedTemplate.descriptor.component_key)
    expect(a.value.tokens).not.toEqual(b.value.tokens)
  })

  it('keeps cover hero binding and info optional-hero binding distinct', async () => {
    const cover = resolveStaticRenderManifest(await readManifest(manifestFiles[0]))
    const info = resolveStaticRenderManifest(await readManifest(manifestFiles[1]))
    expect(cover.valid && info.valid).toBe(true)
    if (!cover.valid || !info.valid) return
    expect(cover.value.resolvedAssets.hero?.mime_type).toBe('image/webp')
    expect(info.value.resolvedAssets.hero).toBeUndefined()
  })

  it('uses the manifest canvas for both 4:5 and 9:16 official inputs', async () => {
    const portrait = resolveStaticRenderManifest(await readManifest(manifestFiles[0]))
    const reel = resolveStaticRenderManifest(await readManifest(manifestFiles[2]))
    expect(portrait.valid && reel.valid).toBe(true)
    if (!portrait.valid || !reel.valid) return
    expect(portrait.value.manifest.canvas).toMatchObject({ width: 1080, height: 1350 })
    expect(reel.value.manifest.canvas).toMatchObject({ width: 1080, height: 1920 })
  })

  it('confirms material fixtures are alpha-backed and the hero remains intentionally opaque', async () => {
    const assets = [
      ['torn-paper-cream-01.png', true],
      ['tape-kraft-01.png', true],
      ['documentary-card-hero-01.webp', false],
    ] as const
    for (const [file, expectedAlpha] of assets) {
      const metadata = await sharp(path.resolve(process.cwd(), 'public/creative-fixtures', file)).metadata()
      expect(metadata.hasAlpha, file).toBe(expectedAlpha)
    }
  })
})
