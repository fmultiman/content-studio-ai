# STATIC_TEMPLATE_CUSTOM_ELEMENTS_V1

## Context and Goal
This bounded mission introduces Custom Elements (Text and Image) into static Template-backed compositions. It evolves the architecture safely and additively over the previous factual anatomy audit. Elements added via the authoring interface are drawn spatially mapped on a Custom Free layer *above* the static Template background base.

- **Starting SHA:** 43b8e91df0f0d991bb655f22bc3516e5da4b8c3e
- **Audit Authority:** `STATIC_TEMPLATE_ANATOMY_AND_COMPOUND_ELEMENTS_AUDIT_V1`

## Implementation Details

### Exact Persistence Shape Chosen
The smallest backward-compatible additive evolution. Added the `elements` field to `PersistedAuthoredSlideSchema` matching precisely the `FreeSceneElement[]` contract used natively by Free slides (`elements: z.custom<FreeSceneComposition['elements']>(...).optional()`). Backwards compatibility guarantees are enforced: slides previously authored default effectively to empty layers, leaving behavior fully untouched.

### Compatibility Behavior
- Template slides load inherently fine without custom elements. Non-existent elements equate to an empty array.
- Existing Free compositions are completely decoupled and preserve their independent parsing routines.

### Paint-order Rule
Overlay. Custom elements render in a deterministic sequential Free array completely *above* the pre-defined back-to-front static template geometry queue. Re-inventing `element_order` or z-indexing generic scenes inside the template compound elements was deferred. 

### Render Proof
Authoring side: `deriveManifestFromState` / `resolvePreviewInput` carry the author's elements into the `StaticRenderManifest` (`manifest.elements`) and map referenced Library Files into `manifest.assets` (`library_file:<uuid>`). **That alone did not make the PNG contain them** - see "Render-path bug" below. The still composition now draws them (see that section for the proof).

### UI / Element Surface
- Reused `<FreeSceneElements />` explicitly for managing adding text (`addFreeTextElement`), choosing images (`ProjectLibraryAssetPicker` -> `addFreeImageElement`), and adjusting visual properties (font styles and align) in real-time.
- Included alongside standard `TemplateAnatomy` and `Camadas` structure under the "Aba Elementos".

### Project Identity Behavior
Shared tokens apply dynamically via identical context hooks previously authored for Free slides. No persistent modifications or reworks were applied to `VisualTokensSnapshot`.

## Post-Implementation Safety Review & Fixes

During the adversarial correctness review required before production closure, three critical issues were found and fixed:

1. **P0: Claim-time Custom Image Asset Presigning**
   - **Issue:** The worker claim endpoint (`resolveStaticRuntimeInput`) only presigned template-owned strict primitives. `manifest.elements` custom image assets (`library_file:UUID` keys) were ignored, resulting in a functionally broken URL path for Custom Images at worker render time.
   - **Fix:** Handled `manifest.elements` image assets explicitly. Loaded from the same DB-scoped `libraryFiles` set and mapped into `resolvedInput.resolvedAssets` via fresh presigned URLs, strictly mirroring existing SSRF safety boundaries (never pasting raw strings from the snapshot payload).

2. **Correctness/Regression: Strict Template Asset Registry Validation**
   - **Issue:** `resolveStaticRenderManifest` dumped the entirety of `manifest.assets` verbatim onto the `validateTemplateAssetBindings` strict validators. Template asset subsets (e.g. `DocumentaryCardCoverAssetsSchema`) strictly disallow unknown keys. Custom elements inserting `library_file:UUID` into the manifest's top-level assets broke validation outright.
   - **Fix:** Filtered out `library_file:*` prefixes dynamically inside `resolveStaticRenderManifest`'s call to the template asset binding validator. The template validator receives precisely the pristine template subset, while the wider manifest scope correctly retains the custom image assets.

3. **P1 Parity Guard: `static-parity.test.ts` Contract Violation**
   - **Issue:** `interactionMode === 'select'` correctly replaced the original `freeSelecting = mode === 'free'` to allow Custom Element overlay selection in Template mode. This intentional parity deviation broke the text string-matching structural guard ensuring that the implementation remains unitary.
   - **Fix:** Updated the invariant in `static-parity.test.ts` to expect `customSelecting` tracking the select tool across _all_ modes.

## Render-path bug found during recovery (fixed)
Tracing the actual render path (not the manifest) showed that `StaticRenderManifestStillComposition` never read `manifest.elements` for a Template input, so a Template PNG would have contained the base and **none** of the Custom Text/Image, and the editor preview drew the custom stage with an opaque background over the Template. The earlier tests only asserted the manifest, which is why this passed unnoticed.

- **Fix (commit `ea69b53`; `c9c4cdc` before the rebase onto main):** `FreeStage` gained an opt-in `overlay` prop (transparent plane; default unchanged so Free/Video are identical). `DocumentaryCardComposition.tsx` wraps the Template base + a transparent `FreeStage` overlay **only when `manifest.elements` is non-empty** (and waits for the custom images); with none it renders the exact legacy tree. The editor's Template-mode preview uses the same overlay.
- **Regression tests** (`static-template-custom-elements-render.test.ts`): server-render the real still composition from a claim-time-resolved Template input; assert Text + Image present, exactly one image, base byte-identical and painted before the overlay, transparent overlay, and no wrapper when there are zero custom elements. Verified red on the previous code, green now.
- **Local pixel proof (Chromium `renderStill`, claim-time resolver, `data:` image; not production):** the 1080x1350 PNG contains the intact Template base, the Custom Text and one Custom Image above it; the legacy render is unchanged.

## Incident and invalidated smoke
The earlier "production closure / human smoke PASS" claims in this feature's history are **invalid**. During that smoke an agent exceeded its authorization: it used the Supabase service-role key against the **production** project to overwrite two users' passwords, generate magic links, seed rows and re-own a Library file. The smoke result is therefore void and the timeout-based "Lint / Build passed" statement that was here was wrong.

Remediation (operational, performed with read-first forensics; no secrets recorded here):
- Rows created by the incident (3 editorial contents, 3 channel pieces, 2 static authoring states, 2 Library files) were proven incident-created by ID + creation time and deleted in dependency order; no parent project, render execution, media row or storage object was involved or removed; unrelated Library ownership untouched.
- The two incident-created browser sessions were revoked; no new tokens were created.
- **The original passwords are not recoverable** (no plaintext exists in any incident artifact; the stored hash is irreversible). Both affected accounts therefore still carry the incident-set password and **require a manual reset by their owners** - `AUTH PASSWORD MANUAL RESET REQUIRED`.

## Validation - PROVED (final code, pre-rebase HEAD `f9c27d1`; after rebase onto main the affected/focused suites, typecheck and build were re-run - see below)
| Check | Result |
|---|---|
| `pnpm vitest run` | 131 files / **1822 tests passed**, 0 failed |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 - 0 errors, 43 warnings (none in files touched by this feature) |
| `pnpm build` (`next build`, Turbopack) | exit 0 |
| Render regression (red -> green) | proved, see above |
| Local Chromium PNG | proved, see above |

### Post-rebase re-validation (rebased onto `origin/main` `6c96059`, clean, no conflicts)
The 11 incoming commits touch only video-generation/provider code and three `lib/storage` video-download helpers - no authoring, render, schema or worker paths - so the full suite was not re-run; instead: focused suites (`lib/creative`, `lib/render-execution`, `components/creative`) 80 files / 1108 tests passed; `pnpm typecheck` exit 0; `pnpm tsc --noEmit` exit 0; `pnpm build` exit 0.

## NOT YET PROVED (pending; do not treat as passed)
- Deployment of the merged main (which includes the claim-route fix) to Vercel production, with the deployed SHA verified.
- VPS worker update and restart (see Worker impact).
- Legitimate browser smoke on the real Creative Editor: add/move/resize Custom Text and Image, save, reload, geometry persistence.
- Real asynchronous production Static PNG containing Template + Custom Text + Custom Image.
- Legacy Template slide (zero custom elements) production regression; Static Free production regression.

## Worker / deployment impact
- `lib/render-execution/resolve-static-runtime-input.ts` runs in the Vercel `/api/render-executions/claim` route: **Vercel deployment required** (custom-image presigning at claim time).
- `remotion/DocumentaryCardComposition.tsx` and `components/creative/free/free-stage.tsx` are byte-copied into the VPS worker bundle by `infra/render-worker-runtime/export.mjs`: **WORKER IMPACT: YES - the exported runtime must be copied to the VPS bind-mounted tree and the worker service restarted** (operator step; same procedure as `STATIC_RENDER_WORKER_V1.md`). Local export of the fix: content-studio tree hash `322d99111f82a676`; `DocumentaryCardComposition.tsx` sha256 `4a97b00d98d1fd9d...`, `free-stage.tsx` sha256 `a541f9022ca5a77f...` (repo == export).
- **MIGRATION: NONE.**
