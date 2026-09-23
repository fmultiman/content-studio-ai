---
title: Static Render Worker V1
---

# Static Render Worker V1

## Handoff and completion record

This document records the interrupted Claude/Opus handoff and the GPT-5.6 Sol completion work. The starting local, origin/main, remote main and deployed application revision was `cfedd1984bd7ceb5bdcb468eec5582b0b4b01c39`. The worktree already contained substantial uncommitted changes; they were preserved.

Opus completed the initial audit and most of the implementation before rate limiting: the additive execution schema, kind-aware scratch target, static snapshot helpers, static enqueue/claim/complete/output routes, worker composition registration and `/render-still` implementation, coordinator dispatch, save helper, and the first local worker proofs. The interruption occurred while wiring the Creative Editor page.

Sol verified and completed the page wiring, corrected the claim-time primitive boundary by freezing primitive LibraryFile identities in the enqueue snapshot, fixed regression-test compatibility around attempt projections, applied and verified migration 034, exported the worker, ran fresh local static proofs, and ran the full validation gates.

## Final architecture

Static and video retain separate media contracts while sharing the execution state machine.

- Static: current authoring state -> canonical `StaticRenderManifest` snapshot -> `static_still` execution -> claim-time signed asset resolution -> VPS `/render-still` -> Remotion `renderStill` -> private `output.png`.
- Video: `TimelineManifest` -> `video` execution -> VPS `/render` -> Remotion `renderMedia` -> private `output.mp4`.

No Chromium or Remotion rendering runs in the Vercel request lifecycle.

## Migration 034

`scripts/034_add_static_still_render_executions.sql` adds:

- explicit `render_executions.kind` (`video` or `static_still`);
- nullable `channel_piece_id` for static subject association;
- optional output dimensions;
- a strict kind/subject check: video requires `video_draft_id` and no ChannelPiece; static requires `channel_piece_id` and no VideoDraft;
- a partial ChannelPiece lookup index.

It was applied to Supabase project `nuhdhnasuohizxtmyiju` as migration `20260923233354_add_static_still_render_executions`. Production verification found five existing video rows, zero null `video_draft_id` values, zero static rows, the expected columns and constraints, and the index. The claim RPC was also explicitly restricted to `service_role`; browser roles cannot call it.

## Frozen snapshot and claim-time assets

The enqueue route authenticates and authorizes Project -> EditorialContent -> ChannelPiece ownership, validates the current request, server-compiles identity/source/context/canvas, and stores a deep-cloned JSON snapshot. Unsaved local edits are included in the request; authoring state is never implicitly saved. Later authoring edits cannot mutate the execution input.

The snapshot contains semantic primitive selection plus frozen primitive LibraryFile identities and validation metadata. Claim resolves only those immutable identities from ownership-scoped LibraryFile rows and generates fresh presigned URLs in memory. Signed URLs and storage hosts are rejected from persisted snapshots.

## Routes and lifecycle

`POST /api/creative/static-authoring/render` returns a queued execution quickly. `POST /api/render-executions/claim` branches by explicit kind; video claim payloads remain unchanged and static claims carry `staticInput`. The coordinator dispatches static jobs to `/render-still` and video jobs to `/render`, preserving attempts, leases, retries and stale-worker fencing.

Completion derives the authoritative scratch target from execution kind and rejects wrong attempts, paths or MIME types. Static output is private at `users/{userId}/renders/scratch/{executionId}/output.png`; video remains `output.mp4`. Output URL and same-origin stream routes require session ownership and completed status. MinIO credentials and internal URLs never reach the browser.

## Editor UX

Each slide owns an independent render job. The lifecycle is `Enfileirando…` -> `Na fila…` -> `Renderizando…` -> `PNG pronto`, with visible failure and retry. Polling uses the authorized execution endpoint by execution id, so switching slides cannot rebind a result. Recent static executions can hydrate on reopen for 24 hours. A completed PNG is previewed through a short-lived authorized URL.

`Gerar PNG` never saves authoring state and never creates a LibraryFile. `Salvar nesta peça` explicitly streams the private scratch PNG through the existing upload boundary, which creates the durable LibraryFile and ChannelPieceMedia only after the user action.

## Worker and local smoke

The exported worker registers `StaticRenderManifestStill`, uses real Remotion `renderStill`, emits PNG, includes Pack B assets under `public/creative-fixtures/pack-b/`, and keeps video `/render` on `renderMedia`. Export produced 37 files and portable coordinator/entrypoint bundles.

Fresh local exported-worker proof against the real Portal ChannelPiece state succeeded:

- Slide 1: 1080x1350 PNG, render `11,769ms`, wall `11,785ms`.
- Slide 2: 1080x1350 PNG, render `4,233ms`, wall `4,243ms`.

## Validation

- `pnpm typecheck`: pass.
- `pnpm test`: 73 files, 887 tests passed.
- Changed-source ESLint: pass.
- `pnpm build`: pass.
- Focused lifecycle, scratch-target and stale-attempt tests: pass.

Full-repository ESLint still reports inherited errors in ignored/interrupted `.tmp` proof files and unrelated baseline warnings; changed source files lint clean.

## External deployment status

The exported runtime is ready for the established manual VPS deployment to `content-studio-execution_render-worker`. This environment has no SSH credentials or Portainer control, so VPS update/health, Vercel push/READY, real VPS Slide 1/2 smoke, authenticated production editor smoke, and production explicit-save smoke remain operator gates. No claim of those external results is made here.
