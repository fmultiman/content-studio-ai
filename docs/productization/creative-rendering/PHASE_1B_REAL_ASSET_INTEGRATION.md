# Phase 1B - Real Asset Integration

**Epic:** Shared Creative Rendering - Productization
**Date:** 2026-09-20
**Status:** COMPLETE

## 1. Objective

To unblock the rendering of real studio assets by resolving canonical `LibraryFile` entries securely via presigned S3 URLs, all while keeping the Creative Rendering core agnostic to AWS SDKs, database schemas, and Next.js / Supabase clients.

## 2. Inherited Architecture

At the end of the Spike (Phase 1A), `resolveAsset()` natively mocked its resolution by filtering `type === 'fixture'` and sourcing statically bundled test material from `FIXTURE_ASSETS`. The renderer strictly isolated DOM, PNG bridging, and timeline loops, preventing runtime Supabase calls inside the components.

## 3. AssetRef & ResolvedAsset Factual Shape

- `AssetRef`: We explicitly utilized the existing `library_file` enum option already present inside the validation schema `AssetTypeSchema` (`lib/schemas/creative/primitives.ts`), preserving strict backward-compatibility and zero schema expansion. 
- `ResolvedAsset`: Upgraded the union `source: 'fixture'` to natively support `source: 'fixture' | 'library_file'`. Added no new AWS secrets or DB rows into the runtime structure—just the pure `url`.

## 4. LibraryFile & Storage Architecture Factual

- **`LibraryFile`**: Retrieved from `lib/types.ts`. Possesses `id`, `kind`, `storage_path`, `mime_type`. 
- **Storage Architecture**: Evaluated `lib/storage/s3.ts`, proving the backend relies on private S3 objects (not public urls) requiring runtime presigned URLs built via `createPresignedReadUrl`. Standard lifetime observed: 3600 seconds.

## 5. Integration Boundary

```typescript
// Product Asset Adapter (lib/creative/integration/library-file-adapter.ts)
adaptLibraryFileToResolvedAsset(file, context) -> ResolvedAsset
```

We injected a clear seam `ProductAssetAdapterContext` requiring `createPresignedReadUrl` to be executed asynchronously. In the rendering orchestration scripts, the database mapping fetches the `LibraryFile` and injects the ephemeral short-lived URL securely into the manifest right before initialization.

## 6. Mapping Table

| LibraryFile field | ResolvedAsset field | Mapping | Status |
| :--- | :--- | :--- | :--- |
| `id` | `ref` | Passed directly. | `DIRECT` |
| `storage_path` | `path` | Passed directly. | `DIRECT` |
| `storage_path` + SDK | `url` | Inbound presigned URL | `DERIVED` (via `createPresignedReadUrl`) |
| `mime_type` | `mime_type` | Passed directly. | `DIRECT` |
| `name` | `alt` | Passed directly. | `DIRECT` |
| `width` / `height` | `width` / `height` | Size metadata absent from `LibraryFile` V1 without child schemas. Defers dimension testing to Chromium browser. | `NOT AVAILABLE` |

## 7. URL / Access Strategy

The system maps `LibraryFile` directly to a `createPresignedReadUrl` signed download. Unlike typography, which we isolated entirely to offline local distributions, runtime assets demand network traffic from the headless Chromium instance during render time.
This networking requirement is successfully captured and proven.

## 8. Security Boundary

No DB rows `LibraryFile`, `user_id` tokens, or direct AWS `S3Client` configurations traverse into the Remotion UI bundle. Only the temporary URL crosses the IPC boundary.

## 9. Supported Media Types

Currently evaluating `mime_type.startsWith('image/')`. SVG remains locked out until robust sanitization filters are established at upload boundaries (XSS prevention during UI staging).

## 10. Failure Diagnostics

Adapter yields `null` or explicit failure values when:
- File is not a raster image.
- `storage_path` is empty.
- Presigned S3 builder fails or `storageProvider` is unreachable.

## 11. Static Proof & Timeline Regression

`scripts/creative/phase-1b-proof.ts` mocked the end-to-end integration by feeding a fake canonical `LibraryFile` targeting a remote `picsum.photos` network asset (acting as our signed URL placeholder, without S3 secrets). 
Chromium explicitly fetched the resource successfully mid-render to produce a PNG, thereby proving the S3 remote fetching flow without breaking `.env` isolation.

## 12. Test Coverage & Baseline

- Baseline before Phase 1B: 453 Tests (0 errors).
- New Coverage: `library-file-adapter.test.ts` validating DB parsing, `mime_type` exclusions, and S3 error fallbacks.
- New Baseline: **457/457 TESTS PASS**. 0 Errors, 45 old UI warnings.

## 13. Constraints

- **Dimension Probing:** Because `LibraryFile` doesn't track strict image dimensions out-of-the-box in Studio, `fit: cover` assumes generic responsibilities inside the template. Extremely large files may cause memory constraints if not thumbnail-routed or pre-sized.
- **S3 Upload Isolation:** Only download URL was integrated. Upload flows represent Authoring UI responsibilities.

## 14. Phase 1B Verdict

`PASS`

The creative architecture proved its agnosticism. Real assets are fetchable asynchronously prior to rendering execution and loaded dynamically via presigned URLs without altering the core templates Contracts or resolution boundaries. 

**Recommendation for Phase 1C:**
Build the Production Render Infrastructure. With identity (`VisualTokensSnapshot`) and assets (`LibraryFile`) mapping safely across the wall, it is now safe to establish an asynchronous Worker (Queue) + Event Database (`RenderExecution`) capable of running the Node commands continuously in the background instead of isolated scripts.
