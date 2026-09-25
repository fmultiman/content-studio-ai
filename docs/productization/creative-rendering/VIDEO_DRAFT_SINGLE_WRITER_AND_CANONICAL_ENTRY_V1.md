# VIDEO_DRAFT_SINGLE_WRITER_AND_CANONICAL_ENTRY_V1

Resolves **P0-1** of `docs/architecture/CONTENT_AGENT_STUDIO_PRODUCT_DOMAIN_ARCHITECTURE_REVIEW_V1.md`: VideoDraft had two product writers. After this mission, `/creative-editor/video/[draftId]` is the **only** product surface that authors `VideoDraft` / `VideoScene[]`.

## 1. Starting point

- Starting SHA: `f0f168e29a4fd5500af734565a87dbe3a2ca87be`. It was equal on local HEAD, `origin/main` and remote `main`, and the tree was clean.
- Authority: `video_drafts` (`scenes` JSONB, `project_id`, `production_id`) through `/api/video-drafts`. This is unchanged.

## 2. Writer / entry matrix

| Surface | Before | After |
|---|---|---|
| `/creative-editor/video/[draftId]` | Writer (explicit Save + opt-in Auto-save, `PATCH { id, name, projectId, productionId, scenes }`), render, Output Player | **Only writer.** Unchanged behaviour. An unknown or foreign id now shows "Rascunho de vídeo não encontrado ou sem acesso." instead of the raw DB error. |
| `/videos?draft=<id>` (classic workspace) | **Second writer.** 800 ms autosave `PATCH` of full `scenes` (last write wins), base64 `image_url` uploads into scenes, render, result player, QuickFlow | **Not authoring.** A server redirect (`proxy.ts`) sends a valid id to `/creative-editor/video/<id>`, and an invalid id to `/videos`. A client fallback on `/videos` does the same. |
| `/videos` (no `draft`) | Hub + create form + classic workspace | **Hub only.** Create → canonical editor, "Rascunhos recentes" → "Abrir" (canonical), "Preparar publicação" (QuickFlow), "Ver Production". No PATCH, autosave, scene UI or render. |
| `/videos?project=&production=` | Classic creation in-place | Hub with Project/Production **preselected**. Creation hands off to the editor. |
| `/videos/rascunhos` | Row → `/videos?draft=` | Row → canonical editor. Delete (lifecycle) unchanged. |
| Production page | "Abrir" → `/videos?draft=`; "Criar Vídeo" → `/videos?project=&production=` | "Abrir" → canonical editor; "Criar Vídeo" creates the draft → canonical editor. Unlink (`PATCH { id, productionId: null, linkOnly: true }`) unchanged. |
| Dashboard "continue" | `/videos?draft=` | canonical editor |
| Draft hub cards (`lib/draft-hub.ts` `draftRoute`) | `/videos?draft=&project=&production=` | canonical editor (images unchanged: `/imagens?draft=`) |
| Gallery "Abrir origem" (video) | `/videos?draft=` | canonical editor |
| Gallery "Visualizar" / "Baixar" (video) | output endpoints | **unchanged** output endpoints (`/api/render-executions/:id/output-url`, `?disposition=attachment`) |

## 3. Legacy mutation paths (removed)

The following lived in the classic `app/(dashboard)/videos/page.tsx` and were deleted with the rewrite:

1. **Autosave.** An 800 ms debounced `PATCH /api/video-drafts` with the full `scenes` array (last write wins against the Creative Editor).
2. **Explicit save.** "Salvar rascunho", the same PATCH.
3. **Creation in place.** `POST /api/video-drafts`, then editing in the same page.
4. **Scene media.** Base64 `image_url` scene uploads, plus Library selection through `updateVideoSceneLibraryFile`.
5. **Render.** `POST /api/video-drafts/:id/render`, plus polling and the result player. The Creative Editor keeps the same, server-authoritative path.
6. **Scene UI.** `components/videos/scene-card.tsx` and `components/videos/storyboard-modal.tsx`, now deleted (they had no other importers).

The only remaining non-editor `PATCH /api/video-drafts` is the Production unlink (`linkOnly: true`, touches `production_id` only). A structural test pins that.

## 4. Decisions

- **Redirect, not read-only.** The legacy view had nothing a viewer needs that the canonical editor lacks: preview, render and output all live there. A read-only copy would have been a third rendering of the same document. The redirect sits in `proxy.ts`, before any page code runs, so no legacy authoring state is ever mounted. The client fallback on `/videos` covers client-side navigations that do not hit the proxy.
- **Id validation.** Only a UUID is turned into an editor URL (lower-cased). Anything else goes to `/videos`, so a malformed value can never build an arbitrary path.
- **Context params are dropped.** `project` and `production` in the old URL are ignored on redirect because the VideoDraft row carries `project_id` and `production_id` itself. Old URLs therefore encode no ownership the draft does not already represent (no stop condition).
- **QuickFlow kept.** "Preparar publicação" was the one non-authoring capability of the classic page, and it moved to each draft in the `/videos` hub, prefilled from the draft name, scene descriptions and prompts. No user-visible loss (no stop condition).
- **Dependency-free routes.** Route helpers moved to `lib/creative/video-editor/video-routes.ts` (no imports), because `proxy.ts` runs on every request and must not bundle Template registries. `video-workspace.ts` re-exports them.
- **Scope held.** No ChannelPiece↔VideoDraft relation, no schema or migration, no `/videos` redesign beyond removing the workspace, no Static route change.

## 5. Creation behaviour

`createVideoDraftForCreativeEditor({ projectId, productionId })` (`lib/creative/video-editor/video-draft-entry.ts`):

- It POSTs `/api/video-drafts` with `{ name: 'Novo vídeo', projectId, productionId, scenes: [createVideoScene([])] }`, the same contract as before (Production required).
- On success it returns the canonical href. The caller does `router.push(href)`.
- On failure it returns the API error and does not navigate.
- Both entry points use it: Production "Criar Vídeo" and the `/videos` hub "Criar no Creative Editor". Both buttons are disabled while the request is in flight.
- Verified in the browser: a double click (60 ms apart) created **exactly one** draft (9 → 10) and landed in its editor.

## 6. API authority

`/api/video-drafts` (GET by id, list, POST, PATCH, `linkOnly`) and `/api/video-drafts/[id]/render` are **unchanged**. The Creative Editor PATCH body is the same `{ id, name, projectId, productionId, scenes }`. No API, schema or worker change.

## 7. Auth

- `/creative-editor` is in `protectedPaths` (`lib/supabase/middleware.ts`).
- The redirect happens before `updateSession`, but its target is protected. An anonymous `/videos?draft=<id>` therefore goes 307 → `/creative-editor/video/<id>` → 307 `/login`. Verified against `next start`.
- The draft load is owner-scoped (`.eq('user_id', user.id)`), so a foreign or unknown id cannot be read and shows the neutral "não encontrado ou sem acesso" message. Project and Production scoping come from the draft row, as before.

## 8. Render regression

- In the canonical editor (browser, dev server against production Supabase and the VPS worker), "Renderizar vídeo" ran queued → claimed → completed.
- Result: execution `6633333e-85ab-44c7-b1a9-41104066fd90`, 1080×1920 MP4, 9.2 s.
- The Output Player loaded the signed URL (`readyState 4`).
- In the Gallery, the new item "Vídeo renderizado · Novo vídeo" plays in "Visualizar", and "Abrir origem" opens the canonical editor.
- The worker did not change.

## 9. Dev harness (`/dev/creative-preview`)

- **Before:** the page was a client component with no guard, and it returned 200 in production. Only its `render` route checked `NODE_ENV`.
- **Fix:** a new server layout `app/dev/layout.tsx` calls `notFound()` when `NODE_ENV === 'production'`. It is small, local and covers every `/dev/*` page, with no new auth architecture.
- **Verified:** `next start` returns `/dev/creative-preview` → 404. Dev still renders it.
- Test: `lib/creative/video-editor/__tests__/dev-harness-guard.test.ts`.

## 10. Tests

**New `lib/creative/video-editor/__tests__/single-writer.test.ts`** (runtime unless noted):

- `legacyVideoAuthoringRedirect`: valid, uppercase, malformed and empty ids, no `draft`, other paths.
- `proxy` run with a real `NextRequest`: 307 to the canonical route without touching the session, and every other request still goes through `updateSession`.
- `createVideoDraftForCreativeEditor`: POST body, canonical href, error with no href.
- Canonical hrefs from `draftRoute`, `buildVideoDraftHubCards`, `buildRecentWorkItems` and the Gallery `sourceHref`, while `videoPreviewEndpoint` and `downloadUrl` stay output URLs.
- Structural: a repo scan finds exactly two non-API files that PATCH `/api/video-drafts`, the canonical editor and the Production unlink (`linkOnly`, no `scenes`).
- Structural: the `/videos` hub has no PATCH, autosave, scene state, SceneCard, Storyboard or render, and the legacy components are deleted.
- Structural: Production, rascunhos, hub, dashboard, draft-hub and gallery contain no `/videos?draft=`.
- Structural: owner-scoped load and the neutral error message.

**New `dev-harness-guard.test.ts`:** 404 in production, renders in development.

**Retargeted:**

- `video-render-ux-wiring.test.ts` and `c2-gallery-videos-product.test.ts` now pin the same render, Output Player, download, bounded-error and polling-safety guarantees on the canonical editor instead of the deleted workspace. The Gallery assertions are kept.
- `video-editor-surface.test.ts` hub block: no "Abrir (clássico)" and no `<SceneCard`.
- `draft-hub.test.ts`: the video card href is canonical.
- `states-forms-polish.test.tsx`: removed the block about the deleted SceneCard. That file does not run under Vitest's include.

**Results:**

- `pnpm test`: 91 files / 1146 tests passed.
- `tsc --noEmit`: clean.
- ESLint on the changed files: 0 errors. One pre-existing warning on the Production page ChannelPiece effect (line 220, `4871ac9`), untouched.
- `pnpm build`: success.

## 11. Browser validation (local, authenticated)

| Check | Result |
|---|---|
| `/videos` hub | Lists drafts with Abrir / Preparar publicação / Ver Production; no authoring UI |
| Legacy deep link `/videos?draft=<id>&project=…` | Lands on the canonical editor in "Salvo" state; `updated_at` unchanged (no write, no dirty state); no loop |
| `/videos?draft=<unknown uuid>` | Canonical editor → "Rascunho de vídeo não encontrado ou sem acesso." |
| `/videos/rascunhos` row | Canonical editor |
| Production "Abrir" | Canonical editor; no `/videos?` links on the page |
| Production "Criar Vídeo" (double click) | Exactly 1 draft created → its editor |
| Edit → Salvar → reload | Persisted; "Salvo" after reload |
| Opt-in Auto-save | Persisted without an explicit save |
| Live Player | Plays (00:00.00 → 00:02.46) |
| Timeline | "3 cenas · 9.17s" |
| Render → Output Player | Completed; MP4 1080×1920, 9.2 s |
| Gallery | Video item previews the output; "Abrir origem" → canonical editor |
| Dashboard continue | Canonical editor links only |
| Hub "Preparar publicação" | QuickFlow opens prefilled from the draft |
| In-app back / forward (hub → editor → back → forward) | Correct pages; editor comes back "Salvo" |
| Static editor smoke (ChannelPiece "editar-visual") | Loads, "Salvo", slide content rendered |
| Anonymous (`next start`) | legacy → canonical → `/login`; `/dev/creative-preview` 404 |

**Environment note (not a product issue):** in the embedded Traycer browser, a *full-load* `goBack`/`goForward` pair sometimes leaves the restored page unhydrated. This happens identically on untouched routes (`/galeria` → `/projetos`), and a reload fixes it. In-app history navigation works.

**Test data created:**

- Draft `f2fd6913-464d-4732-bdd4-a705134be9a4` ("Novo vídeo", Production "Teste Timeline Portal").
- One render execution on draft `7b12b65d-…`.

## 12. Production smoke

Recorded in §14 after deploy.

## 13. Remaining legacy code

- **`lib/video-scene-state.ts`:** no product importer is left (it was only used by the deleted workspace). It is kept because cleanup is out of scope and it is harmless.
- **Generation `/videos` naming:** `/videos` still presents itself as the video hub. AI video generation does not exist and is not faked (non-goal).
- **`video_drafts` rows without a Production:** they still open in the editor. POST continues to require a Production.
- **Production page:** it still lists video drafts next to the hub (the duplication is noted in the architecture review).

## 14. Final checkpoint

- Feature SHA and production smoke: see the follow-up record commit.
- The worker did not change.
