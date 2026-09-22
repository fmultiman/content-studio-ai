/**
 * Phase 2C — Project-Scoped Primitive Discovery
 *
 * Provides `listPrimitivesForProject` — the minimal capability to discover
 * available primitives for a given project without touching S3.
 *
 * The catalog is versionated in code (starter pack organic-collage@0.1.0).
 * No DB, no storage access, no signed URL generation.
 *
 * Scope: PROJECT_SCOPED. System/shared ownership is DEFERRED.
 */

import {
  createProjectPrimitiveCatalog,
  selectProjectPrimitive,
  type PrimitiveDescriptor,
  type ProjectPrimitiveCatalog,
  type PrimitiveSelection,
} from './catalog'

// ── Canonical project ref for Portal Comunidades Alternativas ─────────────────

export const PORTAL_PROJECT_REF = 'project:portal-comunidades-alternativas'

// ── Pack identity ──────────────────────────────────────────────────────────────

export const ORGANIC_COLLAGE_PACK_KEY = 'organic-collage'
export const ORGANIC_COLLAGE_PACK_VERSION = '0.1.0'

// ── Primitive descriptors (validated PhP 2B) ──────────────────────────────────

const PAPER_CARD_LIGHT_01: PrimitiveDescriptor = {
  key: 'paper-card-light-01',
  version: '0.1.0',
  scope: 'project',
  project_ref: PORTAL_PROJECT_REF,
  display_name: 'Papel kraft claro',
  pack_key: ORGANIC_COLLAGE_PACK_KEY,
  pack_version: ORGANIC_COLLAGE_PACK_VERSION,
  category: 'paper',
  library_file_ref: 'afa6868e-a2d6-473d-9df7-bbf713ad8b02',
  allowed_roles: ['decoration'],
  placeable: true,
  origin: 'generated',
  license_class: 'studio_owned',
  provenance: 'User-curated decorative material; non-evidentiary.',
  validation: {
    mime_type: 'image/png',
    width: 1254,
    height: 1254,
    has_alpha: true,
    file_size: 1766502,
    sha256: '169da9d67c85ff7ca741313849dd43df7df48c4b2609dcc91b8804236ac9bdd5',
  },
}

const TAPE_KRAFT_SHORT_01: PrimitiveDescriptor = {
  key: 'tape-kraft-short-01',
  version: '0.1.0',
  scope: 'project',
  project_ref: PORTAL_PROJECT_REF,
  display_name: 'Fita kraft curta',
  pack_key: ORGANIC_COLLAGE_PACK_KEY,
  pack_version: ORGANIC_COLLAGE_PACK_VERSION,
  category: 'tape',
  library_file_ref: '3f593474-05c0-4de3-a537-de50a1abb906',
  allowed_roles: ['decoration'],
  placeable: true,
  origin: 'generated',
  license_class: 'studio_owned',
  provenance: 'User-curated decorative material; non-evidentiary.',
  validation: {
    mime_type: 'image/png',
    width: 2172,
    height: 724,
    has_alpha: true,
    file_size: 1678859,
    sha256: '7123c21653661521ddb99d44c9060e49d90ac00d42463a77510aab0ae63be1e3',
  },
}

// ── Catalog registry: project_ref → catalog ───────────────────────────────────

const CATALOG_REGISTRY: Readonly<Record<string, ProjectPrimitiveCatalog>> = {
  [PORTAL_PROJECT_REF]: createProjectPrimitiveCatalog({
    project_ref: PORTAL_PROJECT_REF,
    pack_key: ORGANIC_COLLAGE_PACK_KEY,
    pack_version: ORGANIC_COLLAGE_PACK_VERSION,
    descriptors: [PAPER_CARD_LIGHT_01, TAPE_KRAFT_SHORT_01],
  }),
}

// ── Public discovery API ───────────────────────────────────────────────────────

export type PrimitiveListItem = {
  key: string
  display_name: string
  category: 'paper' | 'tape'
  pack_key: string
  pack_version: string
  version: string
  scope: 'project'
  project_ref: string
  /** Opaque LibraryFile identifier — UI MUST NOT display this */
  library_file_ref: string
}

export type PrimitiveDiscoveryResult =
  | { found: true; project_ref: string; primitives: PrimitiveListItem[] }
  | { found: false; reason: 'project_not_found' | 'no_primitives_registered' }

/**
 * List all available primitives for a given project.
 * Does NOT access S3 or Supabase — catalog-only lookup.
 */
export function listPrimitivesForProject(projectRef: string): PrimitiveDiscoveryResult {
  const catalog = CATALOG_REGISTRY[projectRef]
  if (!catalog) {
    return { found: false, reason: 'project_not_found' }
  }
  const primitives: PrimitiveListItem[] = Object.values(catalog.descriptors).map((d) => ({
    key: d.key,
    display_name: d.display_name,
    category: d.category,
    pack_key: d.pack_key,
    pack_version: d.pack_version,
    version: d.version,
    scope: d.scope,
    project_ref: d.project_ref,
    library_file_ref: d.library_file_ref,
  }))

  if (primitives.length === 0) {
    return { found: false, reason: 'no_primitives_registered' }
  }

  return { found: true, project_ref: catalog.project_ref, primitives }
}

/**
 * List primitives filtered by category for a given project.
 */
export function listPrimitivesForProjectByCategory(
  projectRef: string,
  category: 'paper' | 'tape',
): PrimitiveListItem[] {
  const result = listPrimitivesForProject(projectRef)
  if (!result.found) return []
  return result.primitives.filter((p) => p.category === category)
}

/**
 * Select a specific primitive by key for a project and return the AssetRef.
 * Returns null when the key does not exist in this project's catalog.
 */
export function selectPrimitiveAssetRef(
  projectRef: string,
  key: string,
): PrimitiveSelection | null {
  const catalog = CATALOG_REGISTRY[projectRef]
  if (!catalog) return null
  try {
    return selectProjectPrimitive(catalog, key)
  } catch {
    return null
  }
}

/**
 * Look up a catalog for a project — null when the project has no primitive catalog.
 * Useful for internal resolution without going through the public API.
 */
export function getCatalogForProject(projectRef: string): ProjectPrimitiveCatalog | null {
  return CATALOG_REGISTRY[projectRef] ?? null
}
