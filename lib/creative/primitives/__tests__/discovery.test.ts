import { describe, expect, it } from 'vitest'
import {
  listPrimitivesForProject,
  listPrimitivesForProjectByCategory,
  selectPrimitiveAssetRef,
  getCatalogForProject,
  PORTAL_PROJECT_REF,
  ORGANIC_COLLAGE_PACK_KEY,
  ORGANIC_COLLAGE_PACK_VERSION,
} from '../discovery'

describe('listPrimitivesForProject', () => {
  it('finds primitives for Portal project', () => {
    const result = listPrimitivesForProject(PORTAL_PROJECT_REF)
    expect(result.found).toBe(true)
    if (!result.found) throw new Error('unreachable')
    expect(result.project_ref).toBe(PORTAL_PROJECT_REF)
    expect(result.primitives.length).toBe(2)
  })

  it('returns project_not_found for unknown project', () => {
    const result = listPrimitivesForProject('project:does-not-exist')
    expect(result.found).toBe(false)
    if (result.found) throw new Error('unreachable')
    expect(result.reason).toBe('project_not_found')
  })

  it('does NOT expose storage_path or signed URLs', () => {
    const result = listPrimitivesForProject(PORTAL_PROJECT_REF)
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('storage_path')
    expect(serialized).not.toContain('signed')
    expect(serialized).not.toContain('Signature')
    expect(serialized).not.toContain('s3.amazonaws')
  })

  it('portal primitives do NOT appear for other project', () => {
    const result = listPrimitivesForProject('project:acme-labs')
    expect(result.found).toBe(false)
  })
})

describe('listPrimitivesForProjectByCategory', () => {
  it('filters paper category correctly', () => {
    const papers = listPrimitivesForProjectByCategory(PORTAL_PROJECT_REF, 'paper')
    expect(papers.length).toBeGreaterThanOrEqual(1)
    expect(papers.every((p) => p.category === 'paper')).toBe(true)
    expect(papers.some((p) => p.key === 'paper-card-light-01')).toBe(true)
  })

  it('filters tape category correctly', () => {
    const tapes = listPrimitivesForProjectByCategory(PORTAL_PROJECT_REF, 'tape')
    expect(tapes.length).toBeGreaterThanOrEqual(1)
    expect(tapes.every((p) => p.category === 'tape')).toBe(true)
    expect(tapes.some((p) => p.key === 'tape-kraft-short-01')).toBe(true)
  })

  it('returns empty array for unknown project', () => {
    const result = listPrimitivesForProjectByCategory('project:unknown', 'paper')
    expect(result).toEqual([])
  })
})

describe('selectPrimitiveAssetRef', () => {
  it('paper resolves to library_file AssetRef', () => {
    const selection = selectPrimitiveAssetRef(PORTAL_PROJECT_REF, 'paper-card-light-01')
    expect(selection).not.toBeNull()
    expect(selection!.asset_ref.type).toBe('library_file')
    expect(selection!.asset_ref.ref).toBe('afa6868e-a2d6-473d-9df7-bbf713ad8b02')
    expect(selection!.descriptor.category).toBe('paper')
    expect(selection!.descriptor.scope).toBe('project')
    expect(selection!.descriptor.project_ref).toBe(PORTAL_PROJECT_REF)
    expect(selection!.descriptor.pack_key).toBe(ORGANIC_COLLAGE_PACK_KEY)
    expect(selection!.descriptor.pack_version).toBe(ORGANIC_COLLAGE_PACK_VERSION)
  })

  it('tape resolves to library_file AssetRef', () => {
    const selection = selectPrimitiveAssetRef(PORTAL_PROJECT_REF, 'tape-kraft-short-01')
    expect(selection).not.toBeNull()
    expect(selection!.asset_ref.type).toBe('library_file')
    expect(selection!.asset_ref.ref).toBe('3f593474-05c0-4de3-a537-de50a1abb906')
    expect(selection!.descriptor.category).toBe('tape')
  })

  it('unknown key returns null (not throw)', () => {
    const result = selectPrimitiveAssetRef(PORTAL_PROJECT_REF, 'non-existent-key')
    expect(result).toBeNull()
  })

  it('unknown project returns null', () => {
    const result = selectPrimitiveAssetRef('project:unknown', 'paper-card-light-01')
    expect(result).toBeNull()
  })

  it('selection AssetRef never contains storage_path or signed URL', () => {
    const selection = selectPrimitiveAssetRef(PORTAL_PROJECT_REF, 'paper-card-light-01')
    const serialized = JSON.stringify(selection)
    expect(serialized).not.toContain('storage_path')
    expect(serialized).not.toContain('signed')
    expect(serialized).not.toContain('Signature')
    expect(serialized).not.toContain('url')
  })
})

describe('getCatalogForProject', () => {
  it('returns catalog for Portal', () => {
    const catalog = getCatalogForProject(PORTAL_PROJECT_REF)
    expect(catalog).not.toBeNull()
    expect(catalog!.project_ref).toBe(PORTAL_PROJECT_REF)
  })

  it('returns null for unknown project', () => {
    const catalog = getCatalogForProject('project:unknown')
    expect(catalog).toBeNull()
  })
})

describe('primitive scope: project isolation', () => {
  it('primitives are project-scoped (not system-wide)', () => {
    const result = listPrimitivesForProject(PORTAL_PROJECT_REF)
    if (!result.found) throw new Error('unreachable')
    expect(result.primitives.every((p) => p.scope === 'project')).toBe(true)
    expect(result.primitives.every((p) => p.project_ref === PORTAL_PROJECT_REF)).toBe(true)
  })

  it('discovery catalog does not expose LibraryFile storage internals in the public item shape', () => {
    const result = listPrimitivesForProject(PORTAL_PROJECT_REF)
    if (!result.found) throw new Error('unreachable')
    // PrimitiveListItem only has library_file_ref (opaque UUID), not storage_path or signed URL
    const item = result.primitives[0]!
    expect('storage_path' in item).toBe(false)
    expect('url' in item).toBe(false)
    // library_file_ref is present (needed for render pipeline) but is opaque
    expect(typeof item.library_file_ref).toBe('string')
  })
})
