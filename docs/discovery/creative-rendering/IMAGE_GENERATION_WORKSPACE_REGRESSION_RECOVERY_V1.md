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
