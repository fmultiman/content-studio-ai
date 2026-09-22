import { describe, expect, it } from 'vitest'
import { createProjectPrimitiveCatalog, PrimitiveDescriptorSchema, selectProjectPrimitive } from '../catalog'

const projectRef = 'project:portal-comunidades-alternativas'
const paper = {
  key: 'paper-card-light-01', version: '0.1.0', scope: 'project' as const, project_ref: projectRef,
  display_name: 'Paper card light', pack_key: 'organic-collage', pack_version: '0.1.0', category: 'paper' as const,
  library_file_ref: 'afa6868e-a2d6-473d-9df7-bbf713ad8b02', allowed_roles: ['decoration'] as ['decoration'], placeable: true as const,
  origin: 'generated' as const, license_class: 'studio_owned', provenance: 'User-curated decorative material; non-evidentiary.',
  validation: { mime_type: 'image/png' as const, width: 1254, height: 1254, has_alpha: true as const, file_size: 1766502, sha256: '169da9d67c85ff7ca741313849dd43df7df48c4b2609dcc91b8804236ac9bdd5' },
}
const tape = { ...paper, key: 'tape-kraft-short-01', display_name: 'Kraft tape short', category: 'tape' as const, library_file_ref: '3f593474-05c0-4de3-a537-de50a1abb906', validation: { ...paper.validation, width: 2172, height: 724, file_size: 1678859, sha256: '7123c21653661521ddb99d44c9060e49d90ac00d42463a77510aab0ae63be1e3' } }

describe('project primitive catalog', () => {
  it('resolves project-scoped descriptors to ordinary library_file AssetRefs', () => {
    const catalog = createProjectPrimitiveCatalog({ project_ref: projectRef, pack_key: 'organic-collage', pack_version: '0.1.0', descriptors: [paper, tape] })
    const selected = selectProjectPrimitive(catalog, 'paper-card-light-01')
    expect(selected.descriptor.scope).toBe('project')
    expect(selected.asset_ref).toEqual({ type: 'library_file', ref: paper.library_file_ref, version: '0.1.0', checksum: paper.validation.sha256 })
    expect(JSON.stringify(selected)).not.toContain('storage_path')
    expect(JSON.stringify(selected)).not.toContain('signed')
  })

  it('fails unknown keys explicitly', () => {
    const catalog = createProjectPrimitiveCatalog({ project_ref: projectRef, pack_key: 'organic-collage', pack_version: '0.1.0', descriptors: [paper] })
    expect(() => selectProjectPrimitive(catalog, 'missing')).toThrow(/Unknown project primitive/)
  })

  it('rejects descriptors without required alpha validation', () => {
    expect(PrimitiveDescriptorSchema.safeParse({ ...paper, validation: { ...paper.validation, has_alpha: false } }).success).toBe(false)
  })
})
