# PHASE 2C — PRIMITIVE DISCOVERY & AUTHORING PROOF

## Objective

Prove the complete cycle:

```
Project
  → primitives available for that Project
  → primitive selection (paper slot / tape slot)
  → semantic AuthoringState
  → preview updates immediately
  → render request (manifest + selection, no PrimitiveRef in manifest)
  → server-side resolution (primitive key → LibraryFile → S3 presigned URL)
  → DocumentaryCard
  → PNG 1080×1350
```

Using the two real Phase 2B primitives:
- `paper-card-light-01` (LibraryFile `afa6868e-a2d6-473d-9df7-bbf713ad8b02`)
- `tape-kraft-short-01` (LibraryFile `3f593474-05c0-4de3-a537-de50a1abb906`)

Project: **Portal Comunidades Alternativas**
Pack: **organic-collage@0.1.0**

---

## Existing Authoring Surface Audit

### Surface: `/dev/creative-preview`

| Component | Classification | Phase 2C Action |
|-----------|---------------|-----------------|
| `AuthoringState` type | REUSE + ADAPT | Added `primitiveSelection` and `primitiveTransforms` |
| `DocumentaryCardPreviewTuning` | REUSE | Untouched |
| Reducer pattern | REUSE + EXTEND | Added primitive selection/reset/transform actions |
| `Slider` component | REUSE | Reused for primitive transforms |
| Hero picker (asset cards) | REUSE | Model for primitive picker |
| `deriveManifestFromState` | REUSE | Manifest boundary preserved; no PrimitiveRef added |
| Render round-trip button | REUSE + EXTEND | Now passes `primitiveSelection` alongside manifest |
| `resolvePreviewInput` | REUSE | Unchanged; preview uses fixture fallback for browser |
| Debug panel | REUSE + EXTEND | Added "Primitive Selection State" section |
| Wave 5/6 fixture paper/tape | DEV-ONLY | Remain as explicit fallback when no selection |

### What Changed

No existing behavior was broken. The surface was extended:
- Left panel now shows a **Primitives** section (project-scoped, only for identity A)
- Each slot (paper, tape) has a compact picker showing primitives by category
- Transform sliders added per slot (offsetX, offsetY, rotation, scale, opacity)
- Reset per slot restores to default key + default transforms
- `derivedManifest` (debug panel) confirms no PrimitiveRef added
- Render request now includes `primitiveSelection` when available

---

## Project-Scoped Discovery

### Implementation

**`lib/creative/primitives/discovery.ts`** — new file

```typescript
listPrimitivesForProject(projectRef: string): PrimitiveDiscoveryResult
listPrimitivesForProjectByCategory(projectRef, category): PrimitiveListItem[]
selectPrimitiveAssetRef(projectRef, key): PrimitiveSelection | null
getCatalogForProject(projectRef): ProjectPrimitiveCatalog | null
```

The catalog is an in-code registry (no DB, no S3 access during discovery).
Only `PORTAL_PROJECT_REF = 'project:portal-comunidades-alternativas'` is registered.

### Public Discovery Result Shape

```typescript
type PrimitiveListItem = {
  key: string             // 'paper-card-light-01'
  display_name: string    // 'Papel kraft claro'
  category: 'paper' | 'tape'
  pack_key: string        // 'organic-collage'
  pack_version: string    // '0.1.0'
  version: string         // '0.1.0'
  scope: 'project'
  project_ref: string     // 'project:portal-comunidades-alternativas'
  library_file_ref: string // opaque UUID — UI must not display this
}
```

**No `storage_path`, no `url`, no signed URL** exposed in discovery results.

### Project Scope

- `listPrimitivesForProject('project:portal-comunidades-alternativas')` → 2 primitives
- `listPrimitivesForProject('project:acme-labs')` → `{ found: false, reason: 'project_not_found' }`
- Primitives do **not** appear system-wide

---

## Primitive Picker UI

### Rendered in `/dev/creative-preview`

The picker is conditionally rendered only when `availablePrimitives.length > 0` (requires identity A / Portal project).

| Slot | Category | Default Key | Options V0 |
|------|----------|-------------|------------|
| Paper | `paper` | `paper-card-light-01` | 1 |
| Tape | `tape` | `tape-kraft-short-01` | 1 |

Each item shows:
- Alpha checker indicator (all primitives are alpha PNGs)
- `display_name` (product concept)
- `key` + version (technical)
- Category pill
- Active state indicator

### Reset Behavior

- **Reset paper** → `{ paper: 'paper-card-light-01' }` + reset paper transforms to defaults
- **Reset tape** → `{ tape: 'tape-kraft-short-01' }` + reset tape transforms to defaults
- Reset does **not** delete the LibraryFile or modify the catalog

---

## AuthoringState Integration

### New Fields

```typescript
interface AuthoringState {
  // ... existing fields ...

  // Phase 2C
  primitiveSelection: {
    paper?: string   // primitive key (not library file ID, not signed URL)
    tape?: string    // primitive key
  }
  primitiveTransforms: {
    paper: { offsetX, offsetY, rotation, scale, opacity }
    tape:  { offsetX, offsetY, rotation, scale, opacity }
  }
}
```

### Key Rules

- `primitiveSelection` contains **semantic keys only** — never LibraryFile IDs, signed URLs, or storage paths
- `primitiveTransforms` contains authoring-layer adjustments; these are **not** in the manifest
- Initial state for identity A: `paper: 'paper-card-light-01'`, `tape: 'tape-kraft-short-01'`
- Initial state for identity B: empty selection (no project catalog)
- Changing identity resets both selection and transforms

---

## Manifest Boundary

**`deriveManifestFromState(state): StaticRenderManifest`** — unchanged

The neutral `StaticRenderManifest` **does not** contain any `PrimitiveRef`.
Primitive selection travels **beside** the manifest in the render request via the new `primitiveSelection` field.

```typescript
// What the page sends to /dev/creative-preview/render:
{
  manifest: StaticRenderManifest,   // NEUTRAL — no PrimitiveRef
  overrides: { documentaryCard: ... },
  primitiveSelection: {              // SEPARATE — semantic keys only
    projectRef: 'project:portal-comunidades-alternativas',
    paper: 'paper-card-light-01',
    tape: 'tape-kraft-short-01',
  }
}
```

**`derivePrimitiveSelectionRequest(state): PrimitiveSelectionRequest | undefined`** — new function

Returns `undefined` when:
- Identity has no project primitive catalog (identity B)
- No primitives are selected (both undefined)

---

## Preview Path

The browser preview (`DocumentaryCard` tree in the page) uses the **fixture fallback** for paper and tape materials when in the browser context. The selection state determines what gets sent to the render script, but the visual position/shape of the paper and tape panels is accurate in the preview (same component tree).

**Reason**: Production presigned URLs require async S3 access, which is incompatible with the synchronous preview resolution (`resolvePreviewInput`). This is a documented constraint — the preview proves layout and structure; the final render proves assets.

---

## Transform Model

Transforms are authoring-layer only:

| Transform | Default | Bounds | Applied at |
|-----------|---------|--------|------------|
| offsetX | 0 | ±120px | Authoring state |
| offsetY | 0 | ±120px | Authoring state |
| rotation | 0 | ±15° | Authoring state |
| scale | 1 | 0.5–2.0 | Authoring state |
| opacity | 1 | 0–1 | Authoring state |

**Transforms are NOT in the neutral manifest.** They are authoring-layer data that would need to be promoted to reproducible render input in a future phase. Currently they survive the round-trip as part of the render request context, not the manifest.

Z-order remains template-owned (not editable) in Phase 2C.

---

## Render Round-Trip

### Proof Script

`scripts/creative/phase-2c-render-proof.mjs` — demonstrates the full cycle from selection to PNG.

### Resolution in Render Script

`scripts/creative/render-authoring-request.ts` — extended to:

1. Parse `primitiveSelection` from the request
2. Look up `selectPrimitiveAssetRef(projectRef, key)` from the catalog
3. Map `library_file_ref` → known storage path (hardcoded for Phase 2C proof)
4. Call `createPresignedReadUrl(storagePath)` — runtime only, never persisted
5. Build a `ResolvedAsset` for each slot
6. Pass `primitiveMaterials: { paper, tape }` to the Remotion composition

The `StaticRenderManifest` passed to `resolveStaticRenderManifest()` is **not modified** — the primitive materials flow separately to the composition.

### Evidence

Saved to `.tmp/creative/productization/phase-2c/` (git-ignored):

```
authoring-primitives-final-render.png   — 1080×1350 PNG
execution-summary-redacted.json         — run metadata (no signed URLs)
```

**Round-trip result:**
- Canvas: 1080×1350
- Primitive paper: `paper-card-light-01` (real S3)
- Primitive tape: `tape-kraft-short-01` (real S3)
- Render duration: ~10s (Chromium warm)
- Diagnostics: 0

---

## Preview / Final Parity

| Dimension | Preview | Final Render |
|-----------|---------|-------------|
| Paper position | Template default (fixture) | Template default (fixture) |
| Tape position | Template default (fixture) | Template default (fixture) |
| Paper texture | `torn-paper-cream-01.png` (fixture proxy) | `paper-card-light-01.png` (real S3) |
| Tape texture | `tape-kraft-01.png` (fixture proxy) | `tape-kraft-short-01.png` (real S3) |
| Hero asset | Fixture WebP | Fixture WebP |
| Content text | Same | Same |
| Identity tokens | Same fixture A | Same fixture A |
| Transforms | Applied in UI state | Not yet promoted to render (Phase 2C constraint) |

**Parity constraint**: Primitive transforms (offsetX, offsetY, rotation, scale, opacity) are visible in the authoring state and UI but are not yet wired through the final render path. This is a known and documented limitation — transforms would need a shared render input representation to survive the round-trip.

---

## Product UI Status

The `/dev/creative-preview` surface is the authoring lab. It begins to look like a product feature:
- Uses the existing app color palette and code-style styling
- Primitive picker UI is consistent with the hero picker pattern
- Debug panel shows state without exposing secrets
- Render result shows primitive keys used in the render

**Gap to full Product UI:**
- No authentication/project selector integration (uses fixture identity)
- No real project loading from Supabase
- Browser preview uses fixture fallback (documented)
- Transform promotion to render not yet implemented

These are the next productization slices, not blockers for Phase 2C.

---

## Browser Verification

The browser env (Supabase/auth) is not available in this worktree without env pull. The smoke visual was attempted:
- `vercel link` + `vercel env pull` → `.env.local` created temporarily
- After the render proof, `.env.local` and `.vercel` were removed
- The render script executed successfully (see Evidence above)
- Browser interactive smoke blocked by the same pre-existing auth constraint (all routes require Supabase — confirmed in Phase 1C / Wave 6)

**Status: `COMPONENT_AND_RENDER_PROOF`** — browser interactive smoke blocked by environment, same constraint as all previous phases.

---

## Tests

### New Test Files

**`lib/creative/primitives/__tests__/discovery.test.ts`** — 16 tests
- Project primitives listed correctly
- Unknown project returns `project_not_found`
- Scope isolation (Portal prims not available for other projects)
- Category filtering (paper/tape)
- `selectPrimitiveAssetRef` → `library_file` AssetRef
- Missing key returns `null`
- No storage_path or signed URL in any public output

**`lib/creative/__tests__/authoring-primitive-selection.test.ts`** — 19 tests
- Initial state has correct defaults (paper, tape keys)
- `projectRefForIdentity` mapping
- `derivePrimitiveSelectionRequest` → request with/without selection
- Selection never contains signed URLs
- `deriveManifestFromState` → no PrimitiveRef in manifest
- Reset behavior (paper/tape to defaults + transform reset)
- `primitiveSelectionSchema` and `authoringRenderRequestSchema` validation
- Backward compat: schema valid without `primitiveSelection`

### Coverage of Required Test Categories

| Category | Status |
|----------|--------|
| DISCOVERY: project primitives listed | ✓ PASS |
| DISCOVERY: wrong project filtered | ✓ PASS |
| DISCOVERY: category filtering paper/tape | ✓ PASS |
| DISCOVERY: unknown project behaves explicitly | ✓ PASS |
| AUTHORING STATE: primitive selection persists | ✓ PASS |
| AUTHORING STATE: reset restores default | ✓ PASS |
| AUTHORING STATE: signed URLs never stored | ✓ PASS |
| RESOLUTION: selection → descriptor → AssetRef | ✓ PASS |
| RESOLUTION: renderer primitive-agnostic | ✓ PASS (manifest has no PrimitiveRef) |
| UI: paper/tape picker renders | Component proof (build PASS) |
| UI: selecting item updates preview state | Verified in reducer + state shape |
| UI: selection remains project-scoped | ✓ PASS (discovery scoping test) |
| ROUND-TRIP: render request receives selected assets | ✓ PASS (proof script) |
| ROUND-TRIP: final render uses same primitive keys | ✓ PASS (execution-summary-redacted.json) |
| ROUND-TRIP: transforms survive | PARTIAL — AuthoringState, not yet in render |
| REGRESSION: content editing remains working | ✓ PASS (497/497 no regression) |
| REGRESSION: hero tuning remains working | ✓ PASS |
| REGRESSION: DocumentaryCard static path remains working | ✓ PASS |
| REGRESSION: timeline path remains working | ✓ PASS |

---

## Baseline

### Incoming (Phase 2B)

- Tests: 462/462
- Typecheck: PASS
- Lint: 0 errors / 45 warnings
- Build: PASS

### Phase 2C Final

- Tests: **497/497** (+35, 0 regression)
- Typecheck: **PASS**
- Lint: **0 errors / 45 warnings** (identical)
- Build: **PASS**

---

## Remaining UX Debt

1. **Browser preview with real S3 assets** — requires async primitive material resolution in the browser context (e.g., API route that proxies S3 presigned URLs without exposing them)
2. **Transform promotion to render** — the authoring transforms (offsetX, offsetY, rotation, scale, opacity) are not yet wired to the final render output
3. **Real project selector** — current UI uses fixture identity A/B; should query real projects from Supabase
4. **Multiple primitive options per slot** — currently 1 per category; will scale when more primitives are ingested
5. **System/shared primitive ownership** — deferred from Phase 2B, still deferred

---

## Phase 2C Verdict

**PASS_WITH_CONSTRAINTS**

All core gate requirements met:
1. ✓ Primitives discovered by project (catalog-based, no S3 access during discovery)
2. ✓ Paper/tape picker functional (compact, project-scoped)
3. ✓ Semantic selection (primitive keys only)
4. ✓ Preview updates (fixture proxy + same DocumentaryCard tree)
5. ✓ Selection never contains signed URLs
6. ✓ Project scope preserved (Portal-only, Acme Labs gets no primitives)
7. ✓ Render round-trip functions (real S3 primitive assets in final PNG)
8. ✓ Final PNG uses selected primitives (confirmed in execution summary)
9. ~ Transforms in AuthoringState but not yet promoted to final render (documented)
10. ✓ Renderer remains primitive-agnostic (StaticRenderManifest has no PrimitiveRef)
11. ✓ Baseline without regression (497/497, 0 lint errors)

**Constraints:**
- Browser interactive smoke blocked by pre-existing auth environment constraint (same as all previous phases)
- Transform round-trip not yet promoted to render output

---

## Commit

`feat: add project primitive authoring proof`

Files added:
- `lib/creative/primitives/discovery.ts`
- `lib/creative/primitives/__tests__/discovery.test.ts`
- `lib/creative/__tests__/authoring-primitive-selection.test.ts`
- `scripts/creative/phase-2c-render-proof.mjs`
- `docs/productization/creative-rendering/PHASE_2C_PRIMITIVE_DISCOVERY_AUTHORING.md`

Files modified:
- `lib/creative/authoring/types.ts` (added Phase 2C fields)
- `lib/creative/authoring/authoring-state.ts` (added Phase 2C functions)
- `lib/creative/authoring/render-request.ts` (added `primitiveSelection`)
- `lib/creative/authoring/index.ts` (exports Phase 2C symbols)
- `scripts/creative/render-authoring-request.ts` (resolves primitives)
- `app/dev/creative-preview/page.tsx` (picker UI + wiring)

---

## Recommended Next Productization Slice

**Phase 2D options (choose one):**

**Option A — Transform Round-Trip**
Promote `primitiveTransforms` to the render input so that transforms applied in the authoring UI are faithfully reproduced in the final PNG. Requires a shared `PrimitiveRenderInput` concept (separate from the neutral manifest).

**Option B — Real Project Loading**
Replace fixture identity A/B with real Supabase project selection. Wire `listPrimitivesForProject` to use a live project ref from the database. Proves the authoring surface is genuinely product-connected.

**Option C — Browser Preview with Real Assets**
Add an API route that proxies S3 presigned URLs for the browser preview, removing the fixture-fallback constraint. The URL is never stored client-side; it is fetched on demand.

Recommended order: **A → B → C** for increasing product readiness.
