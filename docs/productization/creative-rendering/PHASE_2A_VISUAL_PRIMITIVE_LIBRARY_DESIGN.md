# Phase 2A — Visual Primitive Library: architecture & starter pack design

**Status:** DESIGN / DISCOVERY ONLY  
**Date:** 2026-09-21  
**Scope:** no source, schema, migration, storage, asset, UI, or execution changes.

This report audits the current Creative Rendering contracts and records the
smallest safe direction for importing a future reusable visual primitive pack.
Statements are labelled **FACT**, **INFERENCE**, **RECOMMENDATION**, or
**NOT FOUND** so that an external starter pack is not mistaken for live product
data.

## 1. Executive Recommendation

**RECOMMENDATION:** keep one binary in the existing LibraryFile/S3 path and add
a small semantic primitive descriptor/catalog entry that points to that
LibraryFile. Do not create a second binary store and do not make a primitive a
renderer-specific asset type.

The V0 shape is:

```text
primitive descriptor (catalog metadata, stable key/version, role/category,
                     provenance, validation snapshot)
        -> LibraryFile reference
        -> existing S3 presigned-read abstraction
        -> ResolvedAsset
```

Use existing `AssetRef` in render manifests. A new `PrimitiveRef` is **not
needed in neutral manifests now**: primitive discovery/selection belongs above
manifest construction, while the reproducible manifest records the selected
`AssetRef`, version/checksum when available, and placement values.

**RECOMMENDATION:** the first safe implementation slice (Phase 2B) should be a
small, explicit system primitive catalog plus two Documentary Card decoration
slots (paper and tape), backed by approved LibraryFiles and the existing
adapter. It must not become a generic freeform layer editor.

## 2. Current Architecture Facts

### LibraryFile

**FACT** (`lib/types.ts`): the canonical shape is:

```text
id, user_id, project_id?, folder, name, kind, mime_type?, file_size?,
storage_provider, storage_path, public_url, thumbnail_url?, deleted_at?,
created_at, updated_at
```

It has a nullable `project_id`, but ownership is still represented by
`user_id`; it has no semantic category, pack, role, origin, license, alpha
flag, checksum, width, or height. Existing project files therefore work as
project-owned uploads. A system-curated shared asset does not yet have an
explicit system-owner/scope contract.

**FACT** (`lib/creative/integration/library-file-adapter.ts`): the adapter
accepts a canonical LibraryFile and an injected `createPresignedReadUrl`
function. It accepts image MIME values and a storage path, then returns a
`ResolvedAsset` without touching the database or S3 from Creative Core.
Dimensions are deliberately not assumed.

**FACT** (`lib/storage/s3.ts`): the existing S3-compatible abstraction is the
approved storage boundary. It can create a short-lived read URL; no primitive
API exists.

### AssetRef

**FACT** (`lib/schemas/creative/primitives.ts`): `AssetRef` currently contains
`type`, `ref`, optional `version`, `checksum`, `fit`, `focal_point`, and `alt`.
Supported types include `library_file`, `image`, `production_artifact`,
`external`, and `fixture`. It intentionally has no global `role` field; slot
semantics are currently derived from the template schema.

### ResolvedAsset

**FACT** (`lib/creative/assets/resolve-asset.ts`): runtime data contains
`ref`, `source`, `path`, `url`, `mime_type`, optional dimensions, checksum,
version, focal point, alt, and fit. A `library_file` resolution is initially a
placeholder and is completed by the integration adapter. The signed URL is
runtime-only.

### Templates and bindings

**FACT** (`lib/creative/templates/registry.ts` and
`lib/schemas/creative/documentary-card.ts`): the registry is versioned and
system-scoped for Documentary Card. Its current variant asset schemas have
`hero`, optional `logo`, and optional `supporting_image`; there are no
decorative primitive slots or capability filters. The neutral static and
timeline manifests both use a record of `AssetRef` bindings.

**FACT:** the shared React tree is used by still and video adapters. This makes
the same resolved raster asset usable in both modes; motion remains a separate
template concern.

## 3. Existing Asset Debt

### Expected template style

**FACT / EXPECTED TEMPLATE STYLE:** color tokens, CSS clipping, shadows,
gradients, grain, pins, botanical SVG drawing, and layout transforms in
`components/creative/documentary-card/primitives.tsx` are visual behavior of
the Documentary Card component. They are not all candidate library assets.

### Hardcoded asset debt

**FACT / HARDCODED ASSET DEBT:** `MATERIAL_PATHS` names
`torn-paper-cream-01.png` and `tape-kraft-01.png`; the runtime props builder
calls `resolveFixtureAssetSync` for those two fixtures. `PaperPlane` and
`MaterialTape` then apply their own background URLs, color, rotation, and CSS
placement. This is the clearest future primitive seam.

### Fixture-only debt

**FACT / FIXTURE-ONLY DEBT:** the fixture registry in
`lib/creative/assets/resolve-asset.ts` supplies local test/control assets for
hero, torn paper, and tape. Those fixtures are useful regression controls but
are not live LibraryFiles and must not be labelled as imported primitives.

### Potential primitive slots

**INFERENCE / POTENTIAL PRIMITIVE SLOT:** a single paper panel and a single
tape strip can become independently placeable decoration slots. Botanical,
pin, frame, and ornament are future slots only after their component contract
is explicit. Existing `hero` remains a content asset slot, not a decorative
primitive slot.

## 4. LibraryFile vs Primitive

**RECOMMENDATION:** a primitive is not merely a LibraryFile and is not a second
binary object. It is a small semantic descriptor over one LibraryFile.

Conceptually:

```text
PrimitiveDescriptor {
  key, version, scope, display_name,
  pack?, category, allowed_roles,
  library_file_ref,
  origin, license_class, provenance,
  validation: { mime_type, width, height, has_alpha, ... }
}
```

The descriptor is needed because a LibraryFile cannot answer “is this one tape,
is it placeable, which templates may select it, and is it decorative rather
than evidence?” Reusing LibraryFile for bytes avoids a parallel asset system.
The descriptor must never duplicate the file or persist a signed URL.

**NOT FOUND:** no existing persisted primitive descriptor, primitive catalog, or
system asset ownership contract exists in the inspected code.

## 5. Recommended Primitive V0 Model

**RECOMMENDATION:** use a versioned, typed catalog descriptor with stable
technical keys. Keep the descriptor deliberately small and catalog-oriented;
do not build a DAM, marketplace, recipe engine, or editor layer in V0.

Suggested conceptual fields (not implementation in Phase 2A):

```text
key: organic-collage.tape-kraft-short-01
version: 0.1.0
scope: system | project
display_name: Kraft tape — short
pack_key: organic-collage
category: tape
library_file_ref: <LibraryFile id>
allowed_roles: [decoration]
origin: generated
license_class: studio_owned
provenance: external creative generation; non-evidentiary
validation: { mime_type, width, height, has_alpha, file_size, checksum? }
placeable: true
```

`placeable` is a catalog invariant rather than an invitation to support
reference sheets. Reference-only material should not be selectable by a
template slot.

## 6. Ownership Model

**FACT:** LibraryFile is user-owned in its current shape (`user_id`) and can be
linked to a project (`project_id`).

**RECOMMENDATION:** do not represent a reusable system Pack B file as a fake
project upload or by silently assigning it to an arbitrary user. Before import,
define one explicit system-curated ownership/scope boundary that can be enforced
by the data-access layer and storage policy. That is the smallest necessary
future change; it is not a Phase 2A migration.

Until that boundary exists, a project LibraryFile may be used for an
integration experiment only when its ownership and access are explicit. It
must not be advertised as a system primitive.

## 7. Taxonomy

**RECOMMENDATION:** V0 categories are a small controlled vocabulary:

`paper`, `tape`, `pin`, `botanical`, `frame`, `archival`, `ornament`.

These are selection/filtering semantics, not storage folders and not an
ontology. `archival` describes a visual material category (for example, an
archival paper fragment); it does not grant factual/evidence status. Role and
provenance make that distinction explicit.

## 8. Atomicity Rule

**RECOMMENDATION:** one primitive is one independently placeable visual
element. It may contain internal transparency and texture, but its meaning and
transform are one composable unit.

Good: one tape strip, one pin, one botanical sprig.  
Not ideal: three tapes baked into one sheet, multiple pins baked together, or a
complete pre-composed collage.

The named reference sheets (`pack-b-reference-*.png`) are **REFERENCE ONLY**:
keep them outside the selectable Primitive Library. If retained for QA, mark
them non-placeable/reference-only and do not expose them through primitive
slots.

## 9. Metadata Matrix

| Field | V0 disposition | Reason |
|---|---|---|
| `key` | **REQUIRED_V0** | Stable discovery identifier; never a filename-only lookup. |
| `version` | **REQUIRED_V0** | Reproducible catalog selection; aligns with Template Registry versioning. |
| `display_name` | **REQUIRED_V0** | Human selection and diagnostics. |
| `scope` | **REQUIRED_V0** | Distinguishes `system` from `project` until storage policy is explicit. |
| `category` | **REQUIRED_V0** | Small controlled taxonomy for compatible slots. |
| `pack_key` | **OPTIONAL_V0** | Grouping/discovery; not a storage namespace. |
| `library_file_ref` | **REQUIRED_V0** | Single binary source through existing asset infrastructure. |
| `allowed_roles` | **REQUIRED_V0** | Prevents decorative assets from being treated as evidence/hero by accident. |
| `placeable` | **REQUIRED_V0** | Excludes reference sheets and composites from runtime selection. |
| `origin` | **REQUIRED_V0** | `system_curated`, `project_upload`, `external_licensed`, `generated`, or `derived`. |
| `license_class` | **REQUIRED_V0** | Minimal rights classification; not a legal/DAM model. |
| `provenance` | **REQUIRED_V0** | Short source/generation note and review status. |
| `mime_type` | **REQUIRED_V0** | Registration-time validation snapshot; must agree with LibraryFile. |
| `width`, `height` | **REQUIRED_V0 for raster** | Authoring/layout metadata; avoids render-time probing. |
| `has_alpha` | **REQUIRED_V0 for transparent raster** | Pack B suitability and validation invariant. |
| `file_size` | **OPTIONAL_V0** | Useful diagnostics; already exists on LibraryFile. |
| `checksum` | **OPTIONAL_V0 / promote later** | Strong reproducibility, but current LibraryFile/adapter does not provide it consistently. |
| `tags` | **OPTIONAL_V0** | Keep small and curated; not a second taxonomy. |
| capabilities/effects | **DEFER** | Avoid inventing compositing semantics before slots exist. |
| animation/motion metadata | **DEFER** | Motion belongs to template/timeline inputs. |
| focal point/alt/fit | **DEFER or AssetRef** | Existing `AssetRef` already owns these per binding. |
| detailed legal terms, embeddings, similarity, recipes | **DEFER** | Outside the safe V0 boundary. |

## 10. Provenance / Decorative vs Evidence

**RECOMMENDATION:** represent two orthogonal facts:

1. `origin`: how the asset came to the system (`generated`, `system_curated`,
   `project_upload`, `external_licensed`, `derived`); and
2. `allowed_roles`: what the asset is allowed to do (`decoration`, `context`,
   `hero`, `evidence`, etc.).

Pack B generated torn paper is `origin=generated`, `allowed_roles=[decoration]`,
and an explicit non-evidentiary provenance note. A historical photograph used as
factual evidence would require its own provenance and `allowed_roles=[evidence]`;
being a PNG is not sufficient. Do not collapse these concepts into a single
“asset type” or a legal archive system.

## 11. Validation / Harness

**FACT:** `CREATIVE_PRIMITIVE_HARNESS_V0.md` describes inspect → validate →
sanitize → normalize → metadata → preview → publish/register. It is a design
authority, not an implemented import path in this checkout.

**RECOMMENDATION:** validate on ingestion/registration, not repeatedly during a
render. For transparent raster primitives, validate MIME, dimensions, alpha
channel, file size limits, image decode/corruption, and a stable checksum when
available. Reject a non-placeable reference sheet from the runtime catalog.

The renderer should trust a validated descriptor and still fail safely if the
LibraryFile is missing or its presigned read fails. SVG sanitization remains a
separate policy; Pack B is PNG and does not require an SVG exception here.

## 12. Primitive Reference Strategy

### Option A — `PrimitiveRef → Descriptor → LibraryFile → ResolvedAsset`

Semantically clear, but adding a new neutral reference now duplicates the role
of `AssetRef` and would require every renderer/resolver to understand it.

### Option B — `AssetRef → LibraryFile`, semantics elsewhere

Fits the current static/timeline contracts and keeps Creative Core persistence
agnostic. A catalog descriptor can be selected before manifest construction;
the manifest then stores the resulting `AssetRef` plus version/checksum.

### Recommendation

**RECOMMENDATION: Option B for neutral manifests.** Do not add `PrimitiveRef`
now. Add a descriptor/catalog layer above manifest validation, and add typed
template slots that constrain which descriptor categories/roles may be chosen.
If later authoring workflows need to preserve the catalog key separately from
the binary ref, that can be an authoring provenance field without changing the
renderer’s neutral asset contract.

## 13. Template Slot Strategy

**FACT:** current template descriptors have no primitive slots; Documentary Card
imports fixture material behavior through component props.

**RECOMMENDATION:** future descriptors should declare narrow semantic slots,
for example `paper_decoration`, `tape_decoration`, or a capability such as
`category=tape, role=decoration`. Runtime input selects a concrete descriptor,
then emits an ordinary `AssetRef` for resolution.

Do not let `DocumentaryCard` import `tape-kraft-short-01.png` or a pack key.
The smallest first slice is two optional decoration bindings with deterministic
defaults, while preserving the current fixture path as a control until the live
primitive path is proven.

## 14. Transform Ownership

Transforms must be separated by lifecycle:

| Layer | Owns |
|---|---|
| Template defaults | Baseline placement, fit, safe-area, and style defaults for a slot. |
| Authoring state | Temporary drag/selection state and unsaved edits; not render truth. |
| Manifest/render input | Approved reproducible `x`, `y`, `rotation`, `scale`, `opacity`, and `z_order` for each selected primitive placement. |
| Primitive descriptor | Intrinsic metadata only; never a universal placement. |

**RECOMMENDATION:** persist only approved placements that affect a reproducible
render. Keep ephemeral editor selection, hover, snapping guides, and history
out of the manifest. Do not add a generic freeform layer schema in Phase 2A.

## 15. Static / Video Compatibility

**FACT:** the current React component tree is shared by still and video paths;
`ResolvedAsset` is already renderer-neutral.

**RECOMMENDATION:** resolve the same primitive descriptor/AssetRef before either
adapter. A static render consumes fixed placement values; a video template may
animate those values through its existing motion layer. Do not add animation
semantics to the primitive descriptor and do not create separate primitive
libraries for still and video.

## 16. Storage Strategy

### Alternatives

**Repo `/public`:** simple offline loading and easy review, but duplicates the
binary outside LibraryFile, bypasses S3 access/provenance, couples updates to
deployments, and cannot represent one shared asset cleanly.

**Existing S3-compatible storage:** one reusable binary, existing presigned-read
boundary, independent asset lifecycle, and proven live integration. It needs an
explicit system-curated ownership/access policy and a registration workflow.

**Hybrid:** descriptors/catalog metadata versioned and reviewable in code (or a
future registry), binaries represented once as LibraryFiles in the existing S3
storage; local fixtures remain test controls only.

### Recommendation

**RECOMMENDATION: hybrid, with S3/LibraryFile as the canonical binary.** Do not
copy Pack B PNGs into `/public` and do not create a parallel bucket. Keep local
fixtures only for deterministic controls/offline tests, never as the production
primitive copy. This recommendation is contingent on the system ownership
boundary in Section 6 being defined before import.

## 17. Pack Naming / Versioning

**RECOMMENDATION:** treat “Pack B” as a human/starter-pack label, not the
technical identity. Use a stable technical pack key such as
`organic-collage`, aligned with the registry’s `id + version + scope` pattern.

Example:

```text
pack_key: organic-collage
pack_version: 0.1.0
primitive_key: organic-collage.tape-kraft-short-01
primitive_version: 0.1.0
scope: system
```

Do not resolve `latest`; pin versions for reproducible renders. A pack version
groups catalog changes, while an individual descriptor version identifies the
selected primitive metadata/binary revision.

## 18. Starter Pack Mapping

The files below are external and were not inspected or imported. This table is
therefore a **DESIGN classification**, not live registration evidence.

| External name | Classification | V0 category |
|---|---|---|
| `pack-b-reference-card-light-01.png` | REFERENCE ONLY / non-placeable | — |
| `pack-b-reference-card-dark-01.png` | REFERENCE ONLY / non-placeable | — |
| `pack-b-reference-tape-sheet-01.png` | REFERENCE ONLY / non-placeable | — |
| `pack-b-reference-pin-sheet-01.png` | REFERENCE ONLY / non-placeable | — |
| `botanical-sprig-large-01.png` | atomic candidate | botanical |
| `frame-paper-light-01.png` | atomic candidate | frame |
| `frame-paper-dark-celestial-01.png` | atomic candidate; verify it is not a baked collage | frame |
| `paper-card-light-01.png` | atomic candidate | paper |
| `paper-panel-light-01.png` | atomic candidate | paper |
| `paper-panel-dark-celestial-01.png` | atomic candidate; verify ornament is not inseparable | paper |
| `paper-scrap-light-01.png` | atomic candidate | paper |
| `paper-strip-light-01.png` | atomic candidate | paper |
| `paper-card-dark-01.png` | atomic candidate | paper |
| `paper-archival-fragment-01.png` | atomic candidate, decorative unless provenance says otherwise | archival |
| `tape-kraft-short-01.png` | atomic candidate | tape |
| `tape-kraft-long-01.png` | atomic candidate | tape |
| `pin-brass-01.png` | atomic candidate | pin |
| `pin-red-01.png` | atomic candidate | pin |
| `botanical-dried-sprig-01.png` | atomic candidate | botanical |
| `ornament-celestial-gold-01.png` | atomic candidate | ornament |

## 19. Import Workflow

**RECOMMENDATION (design only):**

```text
local PNG
  -> inspect/decode
  -> validate MIME, dimensions, alpha, size, corruption, atomicity
  -> assign origin/license/provenance/category/role
  -> register or upload through the existing LibraryFile/storage path
  -> create semantic primitive descriptor pointing to that LibraryFile
  -> publish immutable catalog version
  -> expose only compatible descriptors to template slots
```

Existing today: LibraryFile data shape, S3 abstraction, presigned reads,
LibraryFile adapter, AssetRef, template registry, and local fixture controls.

Missing/not found: system-curated ownership policy, primitive descriptor
registry, import validator/harness implementation, publication lifecycle, and
primitive slot declarations.

## 20. First Documentary Card Integration Slice

**RECOMMENDATION:** Documentary Card is the smallest meaningful target because
it already has a proven live static path and the exact material debt is visible.

Phase 2B experiment:

1. Register one approved atomic paper primitive and one approved tape primitive
   through the future system ownership path.
2. Add two narrow decoration bindings/slots to the Documentary Card contract.
3. Resolve selected descriptors to ordinary `AssetRef`/`ResolvedAsset` values.
4. Replace only the current fixture material URLs in one controlled variant;
   leave hero/project identity behavior unchanged.
5. Render still and exercise the same shared tree in a non-heavy timeline test.

PASS means: each binary exists once; selection is semantic and not filename
hardcoded; S3 presigned reads resolve; transforms are reproducible; reference
sheets cannot be selected; fixture control remains available; no secrets or
signed URLs persist; Creative Core remains persistence-agnostic.

## 21. Deferred Capabilities

Defer authoring UI, drag/drop, asset browser, generic layer editor, arbitrary
compositing recipes, derived/hybrid primitive generation, marketplace/DAM
features, automated similarity/embeddings, detailed legal rights management,
animation metadata, async execution, and Pack B import mutations.

## 22. Risks / Constraints

- **System ownership gap:** current LibraryFile semantics are project/user
  oriented. Importing system assets before an explicit scope/policy exists risks
  fake tenancy or inaccessible shared files.
- **Semantic leakage:** keeping fixture names in component code will prevent
  reuse; moving directly to a generic layer engine would overshoot the need.
- **Provenance confusion:** “archival” visual styling must not imply historical
  evidence. Role and origin must be independently reviewed.
- **Missing dimensions/alpha in LibraryFile:** descriptor registration must
  capture validation facts; do not add schema columns in this design phase.
- **Version drift:** do not resolve an unpinned `latest` primitive or mutate a
  binary behind an immutable descriptor version.
- **Offline development:** local fixtures are acceptable controls, but are not
  a second canonical primitive library.

## 23. Phase 2B Recommendation

**RECOMMENDATION:** implement the smallest vertical catalog proof, not an
authoring product:

1. settle and test the explicit system-curated ownership/access boundary;
2. implement a typed descriptor/catalog (in the narrowest existing registry
   style) over two approved PNG LibraryFiles;
3. implement registration-time raster validation;
4. add typed Documentary Card paper/tape decoration slots;
5. resolve them through existing `AssetRef` → LibraryFile adapter → S3 path;
6. record deterministic placement values in the render input; and
7. prove still rendering plus a shared-tree timeline regression.

No migration, upload, UI, PrimitiveResolver, RenderExecution, queue, worker, or
Pack B bulk import belongs in Phase 2B until this slice passes.

### Final decisions

1. **Storage:** hybrid; canonical binaries in existing S3 through LibraryFile,
   catalog metadata versioned/reviewable, fixtures control-only.
2. **Primitive model:** semantic descriptor over one LibraryFile, not a second
   stored binary object.
3. **PrimitiveRef:** not in neutral manifests now; use catalog selection plus
   ordinary `AssetRef` with pinned version/checksum where available.
4. **Minimum metadata:** stable key/version, scope, display name, category,
   LibraryFile ref, placeable, allowed roles, origin, license class,
   provenance, and raster validation facts (MIME, dimensions, alpha).
5. **Decorative vs evidence:** independent origin and allowed-role fields;
   generated Pack B decoration is explicitly non-evidentiary.
6. **Transforms:** template defaults in template, ephemeral edits in authoring
   state, approved x/y/rotation/scale/opacity/z-order in reproducible render
   input; never in the reusable descriptor.
7. **First target / next slice:** two paper/tape slots in Documentary Card,
   backed by the existing asset path, with no generic layer system.

**Phase 2A verdict:** DESIGN READY WITH OWNERSHIP CONSTRAINT. The architecture
is sufficiently narrow to guide the next slice, but no external PNG is yet a
registered primitive and the system-curated LibraryFile ownership boundary
must be settled before import.
