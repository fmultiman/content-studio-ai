# IMAGE_GENERATION_WORKSPACE_REGRESSION_RECOVERY_V1

P0 recovery. Starting `origin/main`: `a75eaf402b1d28852c4a7f5a288a94760dffdf7f`.

## Root causes

**Create / Continuar fell back to the hub.** `app/(dashboard)/imagens/geracoes/[sessionId]/page.tsx` (PR #128, `f19e87b`) read the id from the page `params` prop. Next.js 16 passes `params` as a Promise, so the id was `undefined`, `canonicalSessionId` was falsy, and after `isDataReady` the shared shell rendered the hub inside the canonical URL. Session creation itself worked, so Sessions existed. Fix: `useParams()` (the accessor the Video Session route already uses).

**Recent generations without thumbnails.** PR #128 replaced the old drafts list (which rendered `draft.image_url`) with Session cards that never rendered an image, and `GET /api/image-generation-sessions` returned no thumbnail field (Production: 25 Sessions, 12 with `currentImageId`, none with a thumbnail). Data was intact. Fix: the list route resolves each Session's current-image thumbnail server-side (`lib/image-generation/session-thumbnails.ts`: owner-scoped read, presigned owner key, stored URL only for legacy rows with no key, otherwise `null` -> placeholder) and `ImageSessionCard` renders it.

## Why CI and Vercel stayed green

No test rendered the route. The only route test asserted source text, and build/types/lint cannot see a Promise read as an object. New tests render the real route page and shell (`components/images/image-workspace-route.test.tsx`, five of which fail against the old page) and `lib/__tests__/image-route-convergence.test.ts` guards the App Router tree against synchronously typed `params`. Release gate: `docs/CRITICAL_UX_FLOW_RELEASE_GATE.md`.

## Video sanity (factual)

During the investigation `/videos/geracoes/11912666-ecbc-4b71-b810-3c24aecd41fc` was opened in Production (authenticated, read-only). The Video Generation Workspace opened, showed "Salvo" and the attempt history. The Video route uses `useParams()` and does not have this bug. No Video production code was changed.

## Residual investigation (NOT part of this PR): `VIDEO_GENERATION_AUTOSAVE_REGRESSION_AUDIT_V1`

`components/videos/video-generation-workspace.test.tsx` does not mount `GenerationSessionNavigationProvider` (the dashboard layout supplies it in the app), so all 12 tests fail on `main` with `GenerationSessionNavigationProvider is missing`. A local experiment wrapping the render in that provider made 9 of 12 pass, leaving 3 failing:

- `8 & 9` optimistic concurrency conflict (409): conflict UX / Reload Server Version;
- `10` conflict resolution "Keep local version": the request carries `expectedUpdatedAt` `2026-10-03T12:00:00.000Z` where the test expects `2026-10-03T13:00:00.000Z`;
- `24 & 25` Reuse Settings: `save-status-saved` never appears.

It is not known whether these are stale test expectations after `GENERATION_SESSION_AUTOSAVE_RELIABILITY_V1` (PR #130) or a real Video autosave/conflict defect. They were not investigated or fixed here. The audit should first restore the provider wrapper, then decide per test.

## Preview smoke and controlled exception

Rollback point: `a75eaf402b1d28852c4a7f5a288a94760dffdf7f` (pre-fix `main`). Preview smoke ran against PR #137 head `da03be7a631890153b48bc3c176dbe666efa0936`, authenticated, on 2026-10-07.

| Smoke | Result | Evidence |
|---|---|---|
| 1 New Image Session | PASS | POST `/api/image-generation-sessions` 201 -> `/imagens/geracoes/7d6d9716-57c2-4592-bb72-49ce9adfd6ae`, stable URL, workspace + prompt + "Salvo", no hub |
| 2 Existing Session | PASS for route/prompt/config hydration; output media NOT validated | `/imagens/geracoes/97508404-c5a9-4d30-ac0a-ac5b7ae0706d`; `<img>` present but did not decode |
| 3 Thumbnail | FAIL in Preview (not representative) | 0 of 12 `thumbnailUrl`, 20 placeholders |
| 4 Refresh | PASS | route and prompt/config rehydrated |
| 5 Back / reopen | PASS | state persisted |
| 6 Video sanity | PASS | `/videos/geracoes/11912666-ecbc-4b71-b810-3c24aecd41fc` opened, "Salvo" |

**Preview media smoke was non-representative because its S3 signing environment did not match Production.** On Preview the existing `/api/images/<id>/signed-url` route (untouched by this PR) returns an unsigned URL that does not decode; on Production it returns a signed URL that decodes. The `images` rows are intact (`thumbnail_path` of the form `users/<owner>/images/<uuid>/thumb.webp`). Focused thumbnail/resolver tests pass.

The owner explicitly authorized merging PR #137 as a CONTROLLED EXCEPTION to the pre-merge smoke gate, with the full six-step smoke repeated on Production immediately after the deploy. **This is not permission to routinely skip Preview smoke.**

## Residual infrastructure item: `PREVIEW_MEDIA_ENVIRONMENT_PARITY_V1`

Goal: make Preview able to exercise the same media read/signing paths (S3 presigning of images, thumbnails and videos) that authenticated release smokes need, without weakening secret isolation. Not implemented here.
