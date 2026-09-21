# Phase 2B — Project-scoped Visual Primitive starter pack

**Date:** 2026-09-21  
**Environment:** `SHARED_DEVELOPMENT_PREPRODUCTION`  
**Storage:** `SHARED_DEVELOPMENT_PREPRODUCTION_STORAGE` (existing VPS S3-compatible storage)  
**Verdict:** `PASS`

## 1. Objective

This slice proves two real project-scoped visual primitives through the
existing product asset path:

```text
real LibraryFile → existing S3 presign/read → primitive descriptor/catalog
→ semantic selection → AssetRef → LibraryFile adapter → ResolvedAsset
→ Documentary Card → static PNG and timeline frame
```

No new upload, LibraryFile record, migration, schema, RLS, system user,
system/shared ownership path, authoring UI, or async infrastructure was added.

## 2. Previous ownership escalation and new decision

The first Phase 2B attempt correctly stopped because current `library_files`
requires a real `user_id` and its RLS/API path is user-owned. The user then
confirmed that these two files were uploaded manually through the normal
Library UI into the legitimate project **Portal Comunidades Alternativas**.

**DECISION:** this starter pack is intentionally `PROJECT_SCOPED`; the files
belong to the authenticated user and that project. `SYSTEM_CURATED / SHARED`
ownership remains a deferred capability and is not represented by a fake
project, special user, or policy bypass.

## 3. Live Project and LibraryFiles

**FACT:** read-only Supabase lookup found one active project:

```text
project:8659505e-cd48-4937-9dd9-3f18058210a0
Portal Comunidades Alternativas
user: 35428fd4-4784-4934-9af9-82a606aad77e
```

Both rows are associated with that project and user, are not deleted, have
`kind=image`, `mime_type=image/png`, and folder
`/Portal Comunidades Alternativas/assets/pack-b-staging`.

| Primitive key | LibraryFile ref | file size | dimensions | alpha | SHA-256 |
|---|---|---:|---:|---|---|
| `paper-card-light-01` | `afa6868e-a2d6-473d-9df7-bbf713ad8b02` | 1,766,502 | 1254×1254 | true | `169da9d67c85ff7ca741313849dd43df7df48c4b2609dcc91b8804236ac9bdd5` |
| `tape-kraft-short-01` | `3f593474-05c0-4de3-a537-de50a1abb906` | 1,678,859 | 2172×724 | true | `7123c21653661521ddb99d44c9060e49d90ac00d42463a77510aab0ae63be1e3` |

IDs above are safe LibraryFile references; storage paths and signed URLs are
not recorded.

## 4. Real storage validation

For each LibraryFile, the existing `createPresignedReadUrl` helper generated a
runtime-only URL. A GET returned HTTP 200, `image/png`, and the exact stored
byte count. `sharp` decoded both objects and confirmed dimensions and
`has_alpha=true`; SHA-256 was calculated from the fetched object bytes.

The original local staging files were not used in the render and no PNG was
copied into the worktree.

## 5. Pack identity and descriptor model

The approved Phase 2A convention is used:

```text
pack_key: organic-collage
pack_version: 0.1.0
primitive version: 0.1.0
scope: project
```

The implementation is in `lib/creative/primitives/catalog.ts`:

- `PrimitiveDescriptor` points to exactly one `library_file_ref`;
- required semantic fields include key/version, project scope, category,
  placeable, decoration role, origin, license class, provenance, and validated
  PNG facts;
- the descriptor does not duplicate storage paths, AWS details, credentials, or
  signed URLs;
- catalog discovery is an in-memory/versioned code boundary and does not access
  S3.

The two descriptors use `origin=generated`, `allowed_roles=[decoration]`,
`license_class=studio_owned`, and explicit non-evidentiary provenance.

## 6. Validation harness

`lib/creative/primitives/raster-validation.ts` implements only the required
minimum inspection: PNG signature/decode, MIME/format, width, height, alpha,
file size, and SHA-256. Alpha is required and false/invalid inputs fail.

No batch importer, transcoder, moderation service, UI, dedup service, or
system/shared ownership implementation was added.

## 7. Catalog and semantic selection

The catalog resolves:

```text
paper-card-light-01 → project descriptor → LibraryFile id
tape-kraft-short-01 → project descriptor → LibraryFile id
```

`selectProjectPrimitive` converts the selected descriptor into an ordinary
`AssetRef { type: "library_file", ref, version, checksum }`. No `PrimitiveRef`
was added to neutral manifests. Unknown keys and invalid descriptors fail
explicitly.

## 8. Documentary Card integration

Only the existing material debt was changed. `DocumentaryCard` now accepts
optional selected project primitive materials for the semantic `paper` and
`tape` slots. The component remains unaware of Project, Pack, catalog, S3, or
Supabase concepts.

When no primitive materials are supplied, the existing fixture materials remain
an explicit regression-control fallback. There is no silent fallback in the
live proof: both selected materials are supplied as resolved LibraryFile
assets.

The existing hero, layout, botanical, pin, frame, ornament, and identity logic
were not redesigned. Deterministic placement/rotation/opacity remains owned by
the existing template component; no editor state or freeform layer system was
introduced.

## 9. Static proof

The official Remotion `StaticRenderManifestStill` composition rendered:

```text
.tmp/creative/productization/phase-2b/documentary-card-primitives-static.png
```

Canvas: **1080×1350**. The PNG visibly contains the fetched paper material and
tape material, while the hero continues through the existing control path.

## 10. Timeline proof

The same resolved primitive assets and shared Documentary Card tree rendered a
timeline frame (frame 30) without a video-specific primitive branch:

```text
.tmp/creative/productization/phase-2b/documentary-card-primitives-timeline-frame.png
```

Canvas: **1080×1920**. No MP4 was rendered.

## 11. Evidence summary

Redacted summary:

```text
.tmp/creative/productization/phase-2b/execution-summary-redacted.json
```

It records project scope, pack/version, primitive keys, safe LibraryFile refs,
MIME/dimensions/alpha/hash, resolution status, output sizes, duration, and
security flags. It contains no signed URL, query string, credential, token, or
secret.

End-to-end proof duration was approximately 18.2 seconds, including bundling.

## 12. Tests and validation

- Primitive/catalog focused tests: **5/5 PASS**.
- Full suite: **462/462 PASS** across 38 files.
- Typecheck: **PASS**.
- Lint: **0 errors / 45 warnings** (existing warning baseline).
- Build: **PASS** — Next.js 16.2.4; production compilation completed.
- Static PNG: **PASS**.
- Timeline frame: **PASS**.

Added tests cover descriptor validation, project scope, unknown keys, alpha
requirements, AssetRef boundary, and raster inspection. Existing Documentary
Card, timeline, and isolation tests remain passing.

## 13. Mutation and security accounting

| Operation | Result |
|---|---|
| New S3 upload | 0 |
| New LibraryFile record | 0 |
| Existing object overwrite/delete | 0 |
| DB/schema/RLS mutation | 0 |
| Project/Identity mutation | 0 |
| Signed URL persisted | 0 |
| Credential/secret logged or committed | 0 |
| Other staging assets imported | 0 |

The temporary Vercel env files and local link were removed after the proof.
`git status` contains no `.env` or `.vercel` file.

## 14. Remaining primitive debt

- `SYSTEM_CURATED / SHARED` ownership remains deferred.
- The catalog is project-scoped and code-backed; no database primitive table was
  created.
- Generic authoring discovery, picker UI, drag/drop, and persisted layer editing
  remain future work.
- The existing LibraryFile model still does not persist dimensions/alpha;
  descriptor registration carries the validated snapshot.
- Only paper and tape were integrated; all other Pack B files remain untouched.

## 15. Phase 2B final verdict

**PASS**

All required project-scoped gates passed: two real LibraryFiles were found and
legitimately owned, both real S3 objects validated with alpha, descriptors are
versioned and project-scoped, catalog selection produces normal AssetRefs, the
existing adapter/resolution path is reused, Documentary Card consumes both
real materials, static and timeline proofs pass, no neutral `PrimitiveRef` was
introduced, and the validation baseline has no relevant regression.

## 16. Next slice recommendation

Stop here. The next productization decision should be made separately between
project-scoped authoring/discovery for these primitives and a future explicit
system/shared ownership design. Do not import the remaining Pack B assets or
start async rendering infrastructure from this result.
