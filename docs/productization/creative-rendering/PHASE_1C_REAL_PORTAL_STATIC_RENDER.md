# Phase 1C — Real Portal Static Render Proof

**Date:** 2026-09-21  
**Scope:** read-only shared-development-preproduction verification and live static render validation
**Verdict:** `PASS`

## 1. Objective

This phase attempted the first end-to-end Content Studio → Project Identity → LibraryFile → storage → StaticRenderManifest → Documentary Card → PNG proof. It deliberately did not add RenderExecution, queues, workers, migrations, cloud infrastructure, or Pack B primitives.

## 2. Environment used

The checkout was clean on branch `traycer/content-studio-ai-soft-yak`, at the prior verification commit `d6fce5f75c8d42a73457eea420ff8140e2404272`. The authorized environment label is `SHARED_DEVELOPMENT_PREPRODUCTION`, using Supabase ref `nuhdhnasuohizxtmyiju` through the read-only connector. Vercel project `fmultimans-projects/content-studio-ai` supplied the Development environment variables temporarily. No production mutation or credential was used.

The official static path was run locally with the repository's existing Remotion adapter. Next build completed successfully.

## 3. Live vs simulated status

| Boundary | Result | Evidence/classification |
|---|---|---|
| Project row | **LIVE PASS** | Read-only connector selected active project `Alquimia Cibernética` (safe redacted ref `0b04df8b…e8187`) |
| Project Identity row | **LIVE PASS** | Canonical `projects.identity` was read; textual fields were present |
| LibraryFile row | **LIVE PASS** | Two non-deleted `image/png` rows belong to the same project |
| S3/storage object | **LIVE PASS** | Existing VPS S3-compatible storage, presign and GET succeeded |
| Chromium asset fetch | **LIVE PASS** | Remotion Chromium loaded the real PNG URL |
| Static renderer → PNG | **PASS** | Official `run-static-manifest` path produced 1080×1350 PNG |

The Phase 1B report's “PASS” is therefore narrowed factually here: architectural integration was proven, while live DB/S3 integration remains pending.

## 4. Real Project and Project Identity path

The canonical product path is the existing Supabase server/data-access layer reading `projects`, followed by `Project.identity` (`lib/types.ts`) and `adaptProjectIdentityToVisualTokens` (`lib/creative/integration/project-identity-adapter.ts`). The adapter remains persistence-agnostic and does not query Supabase.

The live Identity contained persisted textual fields (`foundation`, `relationship`, `expression`, `governance`, and `practice`). Phase 1A consumed this canonical payload successfully and produced a valid `VisualTokensSnapshot`. Typography, colors, spacing, and brand remain `DEFAULTED`, because Project Identity V1 does not persist those visual token fields.

## 5. Real LibraryFile and storage path

The existing read path is Supabase `library_files` access through the authenticated service/API layer, followed by `adaptLibraryFileToResolvedAsset` (`lib/creative/integration/library-file-adapter.ts`) and the existing `createPresignedReadUrl` abstraction (`lib/storage/s3.ts`). `LibraryFile` has `id`, project ownership, kind, MIME, and `storage_path`; it has no width/height fields. Signed URLs are runtime-only and must not be persisted or logged.

The live lookup returned compatible image rows with `kind=image`, `mime_type=image/png`, `storage_provider=s3`, and non-null `storage_path`; no dimensions are persisted. The existing adapter accepted the canonical shape. The versioned S3 implementation is AWS SDK S3-compatible, uses the VPS endpoint `https://s3.multihuman.com.br`, bucket `content-studio`, default region `us-east-1`, and path-style addressing unless disabled. Calling `createPresignedReadUrl` with the live path was blocked because the process has no S3 credentials/configuration. No URL was logged or persisted.

## 6. Static render flow

The official local control render used `scripts/creative/run-static-manifest.mjs` → `render-static-manifest.ts` → `resolveStaticRenderManifest` → template registry → Remotion static adapter. It generated `documentary-card-cover-1080x1350-a.png` in 9.6 seconds at 1080×1350 with no diagnostics, using repository fixtures. This is a canonical control, not a real Portal output.

The evidence was copied locally as `.tmp/creative/productization/phase-1c/portal-documentary-card-canonical-control.png` solely to make the distinction visible. No `portal.*` branch or core dependency was introduced. A Quote Card live proof was not attempted.

## 7. Security

The live evidence is `.tmp/creative/productization/phase-1c-live/alquimia-cibernetica-documentary-card-live.png`, produced through the official `StaticRenderManifestStill` Remotion adapter with the real LibraryFile asset. Its redacted runtime summary is `execution-summary-redacted.json` in the same directory.

No credentials, signed URL, token, or secret was written to source, documentation, or the execution summary. No database or storage mutation occurred. The creative core remains free of Supabase, AWS SDK, Next API, and database imports; integration details stay above it.

## 8. Measurements

| Measurement | Result |
|---|---:|
| Identity fetch/preparation | Connector lookup/adaptation passed; timing not instrumented |
| LibraryFile fetch | Connector lookup passed; timing not instrumented |
| Presigned URL preparation | 35 ms |
| Asset access | 3,392 ms (GET and body read) |
| Static render duration | 2,178 ms |
| Total live end-to-end | 44,564 ms (includes bundle) |

## 9. Failure behavior and dimensions

Existing adapter/tests cover missing storage path, unsupported/non-image MIME, missing LibraryFile-shaped input, and presign failure without exposing secrets. Missing Project/Identity/LibraryFile and inaccessible/expired real assets were not forced destructively against live data. `LibraryFile` dimensions remain `unknown`; no new probing architecture was added.

## 10. Validation baseline

- Focused integration/static tests: **24/24 PASS** (5 files).
- Full suite: **457/457 PASS** (36 files).
- Typecheck: **PASS**.
- Lint: **0 errors / 45 warnings** (pre-existing warning baseline).
- Build: **PASS** — Next.js 16.2.4.

## 11. Phase 1C gate

`PASS` is now the factual gate. Project, Identity, LibraryFile, Vercel Development env delivery, real storage access, presigning, Chromium asset fetch, and the official static PNG all passed. No mutation or secret persistence occurred, and the Creative Core remained persistence- and renderer-agnostic.

## 12. Remaining constraints and recommendation

Do not start async infrastructure. This Phase 1C proof is complete; any next slice must be decided separately.

## Live DEV Verification

**Date:** 2026-09-21
**Starting HEAD:** `d6fce5f75c8d42a73457eea420ff8140e2404272`
**Environment:** `SHARED_DEVELOPMENT_PREPRODUCTION`
**Authorization mechanism:** Supabase read-only connector, explicitly authorized by the user for ref `nuhdhnasuohizxtmyiju`.
**Vercel env source:** `LIVE` — linked project `fmultimans-projects/content-studio-ai`.
**Vercel env scope:** `Development` (application classification remains `SHARED_DEVELOPMENT_PREPRODUCTION`).
**Storage:** `SHARED_DEVELOPMENT_PREPRODUCTION_STORAGE` — existing VPS S3-compatible storage.

The connector read only the required schema and rows. It selected the active project `Alquimia Cibernética` with a non-null Identity and two compatible image LibraryFiles in the same project. No write, mutation, or sensitive row dump was performed.

| Live check | Result |
|---|---|
| Authorized environment | **PASS — SHARED_DEVELOPMENT_PREPRODUCTION** |
| Project lookup | **PASS** |
| Project Identity lookup | **PASS** |
| Phase 1A adapter on live Identity | **PASS** |
| LibraryFile lookup | **PASS** |
| S3 configuration | **PASS** |
| S3 presign/object access | **PASS** |
| Chromium live asset fetch | **PASS** |
| Live PNG | **PASS** — 1080×1350 PNG |

The official Vercel pull made the Development variables available only to the local proof process. Presence was checked without printing values. `createPresignedReadUrl` generated the runtime-only URL; a real GET returned `image/png`, and Chromium consumed the same asset during render. The temporary `.env.local`, `.vercel` link, and runner were removed after execution. No credential or signed URL was persisted.

**Live verification gate:** `PASS` (`SUPABASE LIVE = PASS`, `PROJECT LIVE = PASS`, `PROJECT IDENTITY LIVE = PASS`, `LIBRARYFILE LIVE = PASS`, `S3 VPS = LIVE`, `S3 PRESIGN = PASS`, `S3 OBJECT ACCESS = PASS`, `CHROMIUM FETCH = PASS`, `STATIC PNG = PASS`).

### VPS storage verification

**Storage environment:** `SHARED_DEVELOPMENT_PREPRODUCTION_STORAGE` (VPS)

The provider is the existing VPS S3-compatible service at `https://s3.multihuman.com.br`, bucket `content-studio`. Vercel Development is the normal approved configuration mechanism. Only GET/presign behavior was used; no upload, delete, overwrite, bucket creation, or policy change was attempted.
