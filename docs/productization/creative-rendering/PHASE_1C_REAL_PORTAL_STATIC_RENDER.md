# Phase 1C — Real Portal Static Render Proof

**Date:** 2026-09-21  
**Scope:** read-only DEV/local verification and static render validation  
**Verdict:** `PASS_WITH_CONSTRAINTS`

## 1. Objective

This phase attempted the first end-to-end Content Studio → Project Identity → LibraryFile → storage → StaticRenderManifest → Documentary Card → PNG proof. It deliberately did not add RenderExecution, queues, workers, migrations, cloud infrastructure, or Pack B primitives.

## 2. Environment used

The checkout was clean on branch `traycer/content-studio-ai-soft-yak`, HEAD `cefe5b5f4d9cdff217b2f582189b227f3274d82c` (`feat: integrate LibraryFile assets with creative rendering`). No `.env*` file and no DEV Supabase/S3 variables were present in this worktree or process environment. No production database, mutation, or credential was used.

The official static path was run locally with the repository's existing Remotion adapter. Next build completed successfully.

## 3. Live vs simulated status

| Boundary | Result | Evidence/classification |
|---|---|---|
| Project row | **NOT PROVEN LIVE** | No authorized DEV data-access credentials/configuration available |
| Project Identity row | **NOT PROVEN LIVE** | Adapter is real, input was not fetched from a database |
| LibraryFile row | **NOT PROVEN LIVE** | Phase 1B used an in-memory canonical record |
| S3/storage object | **NOT PROVEN LIVE** | Phase 1B injected a `picsum.photos` URL; it was not S3 |
| Chromium asset fetch | **CONTROL ONLY** | Network-shaped/canonical proof, not a real storage object |
| Static renderer → PNG | **PASS** | Official `run-static-manifest` path produced 1080×1350 PNG |

The Phase 1B report's “PASS” is therefore narrowed factually here: architectural integration was proven, while live DB/S3 integration remains pending.

## 4. Real Project and Project Identity path

The canonical product path is the existing Supabase server/data-access layer reading `projects`, followed by `Project.identity` (`lib/types.ts`) and `adaptProjectIdentityToVisualTokens` (`lib/creative/integration/project-identity-adapter.ts`). The adapter remains persistence-agnostic and does not query Supabase.

The adapter currently maps no persisted visual token fields because Project Identity V1 is primarily textual. Typography, colors, spacing, and brand remain explicit defaults in `CREATIVE_IDENTITY_DEFAULTS`. They must be reported as `DEFAULTED`, never as persisted project data. No live project was selected because the required DEV environment was unavailable.

## 5. Real LibraryFile and storage path

The existing read path is Supabase `library_files` access through the authenticated service/API layer, followed by `adaptLibraryFileToResolvedAsset` (`lib/creative/integration/library-file-adapter.ts`) and the existing `createPresignedReadUrl` abstraction (`lib/storage/s3.ts`). `LibraryFile` has `id`, project ownership, kind, MIME, and `storage_path`; it has no width/height fields. Signed URLs are runtime-only and must not be persisted or logged.

No live LibraryFile lookup or S3 presign was executed in this environment. The existing adapter and negative behavior remain covered by tests; live URL resolution, MIME verification, Chromium loading of the real object, and expiry-before-render remain open.

## 6. Static render flow

The official local control render used `scripts/creative/run-static-manifest.mjs` → `render-static-manifest.ts` → `resolveStaticRenderManifest` → template registry → Remotion static adapter. It generated `documentary-card-cover-1080x1350-a.png` in 9.6 seconds at 1080×1350 with no diagnostics, using repository fixtures. This is a canonical control, not a real Portal output.

The evidence was copied locally as `.tmp/creative/productization/phase-1c/portal-documentary-card-canonical-control.png` solely to make the distinction visible. No `portal.*` branch or core dependency was introduced. A Quote Card live proof was not attempted.

## 7. Security

No credentials, signed URL, token, or secret was written to source, documentation, or the execution summary. No database or storage mutation occurred. The creative core remains free of Supabase, AWS SDK, Next API, and database imports; integration details stay above it.

## 8. Measurements

| Measurement | Result |
|---|---:|
| Identity fetch/preparation | Not measured live; no DEV data source |
| LibraryFile fetch | Not measured live |
| Presigned URL preparation | Not measured live |
| Asset access | Control only; real S3 pending |
| Static render duration | 9,602 ms (canonical fixture control) |
| Total live end-to-end | Not measured |

## 9. Failure behavior and dimensions

Existing adapter/tests cover missing storage path, unsupported/non-image MIME, missing LibraryFile-shaped input, and presign failure without exposing secrets. Missing Project/Identity/LibraryFile and inaccessible/expired real assets were not forced against live data. `LibraryFile` dimensions remain `unknown`; no new probing architecture was added.

## 10. Validation baseline

- Focused integration/static tests: **24/24 PASS** (5 files).
- Full suite: **457/457 PASS** (36 files).
- Typecheck: **PASS**.
- Lint: **0 errors / 45 warnings** (pre-existing warning baseline).
- Build: **PASS** — Next.js 16.2.4, 38 routes generated.

## 11. Phase 1C gate

`PASS_WITH_CONSTRAINTS` is the maximum factual gate. The renderer, adapters, official static path, security boundary, and full validation pass. Gate items 1–6 (live Project, Identity, LibraryFile, real storage object, real URL, and Chromium consumption) cannot be claimed because this checkout has no authorized DEV environment/configuration. This is not an architecture escalation: it is an environment availability constraint.

## 12. Remaining constraints and recommendation

Do not start async infrastructure. The next slice should first provision or attach an explicitly authorized DEV-only read path (without changing tenancy, auth, bucket ownership, or schema), select an existing safe Project and associated LibraryFile read-only, run the same static orchestration, verify MIME/Chromium access before expiry, and then replace this control evidence with a redacted live execution summary. If credentials or policy require new authority, stop with `ARCHITECTURE / ENVIRONMENT ESCALATION REQUIRED`.
