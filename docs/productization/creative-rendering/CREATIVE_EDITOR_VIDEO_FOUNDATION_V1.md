# CREATIVE EDITOR VIDEO — FOUNDATION V1

Status: implemented. Factual record, not a redesign contract.
Date: 2026-09-25

"The same Creative Editor, now with time."

## 1. Starting checkpoint

| Check | Value |
|---|---|
| Expected starting SHA | `40198f1bf4e5f5d5f5ba0ee25cdf4d3fcd2c3af0` |
| `origin/main` / remote `main` | `40198f1bf4e5f5d5f5ba0ee25cdf4d3fcd2c3af0` |
| Vercel Production (GitHub deployment status) | `40198f1…` — `success` |
| Working tree | clean |

The Traycer worktree branch (`traycer/witty-puma`, `2b00163`) was a stale pre-squash branch (its content already landed in main as #28/#29). Work started on a fresh branch from `origin/main`; nothing was reset or discarded.

## 2. Context used

- `HANDOFF.md` (Creative Editor Video / Timeline UX, 2026-09-25) and, from `docs/discovery/creative-rendering/google-drive/` in the primary checkout (not versioned in this repo): `CREATIVE_EDITOR_AUTHORING_MODEL_V1` (§§5–10, 23–25), `TIMELINE_MANIFEST_V1` (all, incl. §22), `RENDER_ARCHITECTURE_V1` §36, `REMOTION_ADAPTER_MAPPING_V1` §20.
- Not reread: `CREATIVE_WORKSPACE_PRODUCTIZATION_STATUS_V1`, `CREATIVE_RENDERING_DOCS_INDEX_V1`, `TIMELINE_SCHEMA_V1` (no conflict required them).
- Executing code: `/videos` page + `SceneCard` + `StoryboardModal`, `/api/video-drafts` (GET/POST/PATCH), `/api/video-drafts/:id/render`, `render_executions` routes, `adaptVideoDraftToTimelineManifest`, `buildRenderExecutionSnapshot`, `resolveTimelineManifest`, `prepareTimelineLibraryFileAssets` / `patchResolvedTimelineAssets`, `resolve-runtime-input.ts`, `remotion/timeline/*`, the Static editor page + `CreativeWorkbench`.
- Mid-mission product clarifications from the user (route/entry boundary and `/imagens`–`/videos`–Library–Creative Editor–Gallery responsibilities), incorporated in §6.

## 3. Factual re-entry (what the code actually does)

- **Authority:** `VideoDraft { id, project_id, production_id, name, scenes: VideoScene[] }`. `VideoScene { id, order, description, prompt, image_url, library_file_id?, duration (s), movement }`. **Array order** is the sequence (the adapter iterates `draft.scenes` as stored); `order` is a 1-based label kept consistent by `/videos`.
- **Persistence:** `PATCH /api/video-drafts { id, name, projectId, productionId, scenes }` rewrites the whole `scenes` JSON after server-side ownership + LibraryFile/Project binding validation. `/videos` autosaves this every 800ms.
- **Adapter:** each Scene becomes one `template` segment on track `video-main`: `editorial.documentary-card` / `cover`, contiguous `start_frame`, `duration_frames = max(1, round(duration × 30))`, `content.title = "Cena {order}"` (placeholder), `assets.hero` = `library_file` AssetRef or the fixture hero, `movement → MotionSpec` (`static→none`, `zoom_in→slow_push`, `pan_*`/`tilt_*`→`slow_pan`; `zoom_out`/`dolly` → `none` + diagnostic). `description`/`prompt`/`image_url` are never mapped.
- **Render:** `POST /api/video-drafts/:id/render` re-reads the **saved** draft server-side, builds the signed-URL-free snapshot, inserts `render_executions` through the service role; resident VPS worker → Remotion → MinIO; `/output-url` presigns the MP4. Gallery reads `/api/gallery/video-outputs`.
- **Remotion boundary:** `lib/creative/__tests__/renderer-isolation.test.ts` forbids `remotion` / `@remotion/*` imports in `app/`, `lib/`, `components/` (except `app/dev/creative-preview`). `@remotion/player@4.0.526` was installed but unused by the product.

## 4. `/videos` responsibility classification

| Capability (as found) | Class | Foundation V1 disposition |
|---|---|---|
| Rascunhos / VideoDraft list, filters | 2 · KEEP IN VIDEO HUB (transitional) | kept; each draft gains **Creative Editor** (primary) + **Abrir (clássico)** |
| Novo Vídeo / Criar na Production | 2 · hub entry into authoring | kept as "Criar na Production (editor clássico)"; new **Criar no Creative Editor** creates the VideoDraft (same `POST /api/video-drafts`) and opens it |
| Salvar Rascunho | 1 · MOVE/REUSE | same PATCH reused by the editor's explicit **Salvar** |
| Cenas (SceneCard list) | 1 · MOVE/REUSE | CENAS view + Inspector |
| Storyboard modal | 1 · converges into CENAS | no distinct capability (thumbnail, number, duration, movement, description, click-to-jump) → CENAS cards; no third mode |
| Adicionar Cena | 1 | CENAS `+` (inserted after the selected Scene) |
| Library asset picker | 1 | Inspector · Assets (same `ProjectLibraryAssetPicker`) |
| Duration | 1 | Scene context header (Inspector) + Timeline right edge — same `VideoScene.duration` |
| Movement | 1 | Inspector · Motion (existing vocabulary, preset truthfully labelled) |
| Scene description | 1 | Inspector · Conteúdo (labelled as brief; not drawn in the video) |
| Generated prompt | 4 · GENERATION/ASSISTANCE | Conteúdo › "Assistência" block; not montage truth |
| Inline image upload (`image_url` base64) | 6 · LEGACY/DEFER | not offered in the editor; legacy value flagged as unused |
| Gerar Vídeo / Renderizar Novamente | 1 · final render action | header **Renderizar vídeo** (existing route) |
| Resultado / completed MP4 player | 3 · OUTPUT/CONSUMPTION | kept in `/videos`; the editor has its own separate **Output Player** dialog |
| Preparar publicação (QuickFlow) | 5 · PUBLICATION | stays in `/videos`; not part of temporal authoring |

The legacy workspace is untouched except: a **Abrir no Creative Editor** shortcut, and `SceneCard` keeps a Timeline-authored non-preset duration selectable.

## 5. Research Gate A (short)

- Installed: `remotion`, `@remotion/player`, `@remotion/renderer`, `@remotion/bundler` **4.0.526**.
- `PlayerRef` (installed `.d.ts`): `play`, `pause`, `toggle`, `seekTo(frame)`, `getCurrentFrame()`, `isPlaying()`, `addEventListener`. Events: `frameupdate` (every frame, playback and seek), `play`, `pause`, `seeked`, `ended`, `error`. `inputProps` changes re-render the composition without remounting when `component` is stable.
- Official docs (Remotion MCP): `delayRender()` has **no effect in the Player** (preview); buffering is `useBufferState`. So `TypographyReadyBoundary` is harmless in the Player.
- Timing model: `from`/`durationInFrames` ≙ our neutral `start_frame`/`duration_frames`; Timeline geometry is ours (`x = start × pxPerFrame`, `width = duration × pxPerFrame`).
- Reference UI (HyperFrames Studio / Remotion "build a timeline" per AUTHORING_MODEL §24): Preview / Timeline / Inspector as separate panes, playhead = single shared time, blocks derived from start/duration. Nothing adopted as code or domain.
- No blocker.

## 6. Entry / routing decision

**Canonical route: `/creative-editor/video/[draftId]`** (`app/(dashboard)/creative-editor/video/[draftId]/page.tsx`).

- The Creative Editor is an independent authoring/composition surface, not a child of `/videos`. The first scaffold (`/videos/[draftId]/editor`) was moved before any commit. `/creative-editor` was added to the auth middleware's protected paths.
- Responsibilities (user clarification, 2026-09-25):
  - `/imagens` = AI image / source-media generation + its history.
  - `/videos` = AI video/clip source-media generation + its history. **Not** the Video editor, the canonical VideoDraft workspace, the mandatory launcher or the owner of composition state. AI video generation does not exist yet and was not faked.
  - Library = reusable media for authoring.
  - Creative Editor = authoring / composition.
  - Gallery = rendered outputs.
- `/videos` links into the editor are **migration shortcuts**. Other valid entries (future): Video ChannelPieces (YouTube, Reel, TikTok), Project/Production context, a VideoDraft link. The URL carries only the VideoDraft id; Project/Production come from the draft.
- No ChannelPiece ↔ VideoDraft link, FK or migration was introduced. Helper: `videoCreativeEditorHref()` in `lib/creative/video-editor/video-workspace.ts`.
- The Static route (`…/channel-pieces/[channelPieceId]/editar-visual`) is unchanged.

## 7. Live Authoring Player architecture

```
VideoScene[] (in memory, saved or not)
 → buildRenderExecutionSnapshot        (same function the render route freezes)
 → resolveTimelineManifest(identitySnapshot override)
 → patch library_file slots with /api/library-files display URLs (transient)
 → remotion/player/LiveTimelinePlayer  → <Player component=TimelineComposition>
```

- `lib/creative/video-editor/live-preview-input.ts`: the transient manifest equals the render snapshot's manifest for the same scenes (tested). Signed URLs only enter the in-memory `ResolvedTimelineInput`.
- `remotion/player/LiveTimelinePlayer.tsx` is the **only** product → Remotion entry (lives in the adapter surface). The isolation test now also asserts that product code imports nothing else from `@/remotion/*`.
- `TimelineComposition`/`TemplateSegment` gained one optional seam, `adaptTemplateProps`, defaulting to the existing `remotionTemplateProps`. The final render path is byte-for-byte unchanged. The Player passes identity because Next serves fixtures/materials at `/creative-fixtures/…` (the Remotion bundle serves them at `/public/…`).
- Same Template, component tree, asset bindings, semantic motion and frame timing as the final render. **Pixel parity is not claimed** (browser fonts/compositing vs worker Chromium).
- Controls: own transport (start, ±1 frame, play/pause, end, timecode, `f N · Cena K`), keyboard (Space, ←/→, Shift = 1s, Home/End), preview zoom (Fit/25/33/50%).
- Remotion prints its company-license notice in the console. `acknowledgeRemotionLicense` was deliberately **not** set: that is a licensing decision for the owner.

## 8. Scene authoring (CENAS) and Inspector

- CENAS (default view): Scene cards (Library thumbnail or the Template's default hero, number, duration, motion, description, live progress bar) + prev/next + `+ Cena`. Selecting a card seeks to the Scene start.
- Inspector (same floating Dockview palette as Static):
  - A contextual **Scene header** above the tabs: range, duration input, move ←/→, remove (with confirm, minimum 1 Scene).
  - Tabs: **Template** (fixed `Documentary Card · Capa`, video name, format/count/duration), **Conteúdo**, **Assets**, **Estilo**, **Motion**.
- **No Elementos tab:** VideoScene carries no per-element state and the video adapter passes no tuning/stack, so the tab would be empty.
- **No generic Timing tab:** timing is the contextual Scene header.
- Header: `Creative Editor · Video · Reel 9:16 · Cena N · Contexto`, then save status, **Voltar ao salvo**, Auto-save (off by default, separate preference key), **Salvar**, render status / **Ver vídeo renderizado**, **Renderizar vídeo**.

## 9. `currentFrame` / playhead ownership

- One cursor: `lib/creative/video-editor/frame-cursor.ts`, a tiny external store read with `useSyncExternalStore`. It is UI state and never persisted.
- The Player is the clock (`frameupdate → cursor.set`). Every seek (transport, keyboard, ruler scrub, Scene select) calls `player.seekTo(f)` + `cursor.set(f)`. There is no second clock.
- Only the timecode readout, the Timeline playhead and the CENAS progress bars subscribe. The first implementation kept `currentFrame` in page state, and playback re-rendered the whole editor every frame (~80ms long tasks, ≈12 fps). With the cursor store, playback runs in real time (≈30 fps effective in dev mode, 6 long tasks in 3s).

## 10. Timeline Lite semantics (primary Scenes only)

`lib/creative/video-editor/scene-timeline.ts` (pure) + `components/creative/video/scene-timeline.tsx`.

- **Ranges** derived contiguously from array order + `duration` with the adapter's exact rounding (tested equal to manifest segments). There is no authored start frame.
- **Ruler:** tick step chosen so ticks are ≥56px apart. Click/drag on the ruler (or empty track) scrubs.
- **Playhead:** reads the cursor and auto-follows during playback.
- **Block click** = select the Scene (same `selectedIndex` as CENAS/Inspector).
- **Horizontal drag** = **REORDER** (target from the dragged centre vs midpoints of the remaining Scenes). This never creates gaps.
- **Right edge** = **DURATION** (0.5–60s). Downstream Scenes shift by re-derivation, previewed live and committed on release.
- **Snap** (8 screen px): whole seconds, playhead, other Scene edges. There is a toggle, and Alt disables it during a drag.
- **Temporal zoom:** 9 px/frame levels, anchored on the playhead (buttons) or pointer (Ctrl/⌘ + wheel). Fit on first open.
- **Horizontal scroll:** native.
- **Nothing viewport-related is persisted:** px/frame, scroll, ticks, selection, playhead and panel mode are not in `VideoScene`, the save body or the manifest (tested).
- **Not implemented:** `source_in`/`source_out`, ripple/roll/slip/slide, gaps, overlapping tracks.

## 11. Persistence

- Explicit **Salvar** = `PATCH /api/video-drafts` with `buildVideoDraftSaveBody()` → `{ id, name, projectId, productionId, scenes }`. Each scene carries exactly the 8 VideoScene fields (tested).
- Dirty tracking compares `{name, scenes}`. **Voltar ao salvo** restores the last saved snapshot.
- Timeline durations are stored as `frames / 30` rounded to 4 decimals (e.g. `2.7667`), which round-trips exactly through the adapter.
- Loading keeps array order and renumbers `order` only.

## 12. Final-render regression

- **Renderizar vídeo** calls the existing `POST /api/video-drafts/:id/render` with a fresh idempotency key. The render uses the **saved** VideoDraft, so with unsaved edits the button reads **Salvar e renderizar** (explicit coupling, Render ≠ Save).
- Polling, output URL and download go through the existing `render_executions` routes. There were no worker/runtime changes, no new queue and no new renderer.
- The Output Player is a separate `<video>` in a dialog. The Live Player never plays an MP4.

## 13. Validation

**Automated:**
- New tests: `lib/creative/video-editor/__tests__/{scene-timeline,live-preview-and-authoring,video-editor-surface}.test.ts` (38 tests), plus an extended `renderer-isolation.test.ts`.
- `pnpm test`: 88 files / 1125 tests green. `pnpm typecheck` green. ESLint on changed files: 0 errors (2 pre-existing warnings in untouched `/videos` code). `pnpm build` green (`ƒ /creative-editor/video/[draftId]`).

**Real local interaction** (production Supabase/VPS through `next dev`), draft `7b12b65d-4d8a-4f33-9f65-0aedf961c6e9` (Portal Comunidades Alternativas / Teste Timeline Portal):
- **Entry and authoring**
  - Created via Hub **Criar no Creative Editor** → opened at `/creative-editor/video/7b12b65d…`.
  - Added Scenes. Picked 3 distinct Library images (`slide-10`, `slide-8`, `slide-6`).
  - Set 3s / 5s / 2.5s through the Inspector, and Motion `zoom_in` / `pan_left` / `static`.
  - The Player painted the signed S3 image plus Template materials, at 315 frames.
- **Player and cursor**
  - Play advanced in real time, and playhead == timecode in every sample.
  - Pause was stable. Shift+→ gave +30f and ← gave −1f.
  - Ruler scrub went 6s → 1s → 9s, with the Player following.
- **Timeline edits**
  - Zoom levels 3.2 → 6.4 → 4.8 → Fit, anchored on the playhead. Horizontal scroll worked.
  - Block geometry was exactly `12 + start × ppf` / `duration × ppf − 2`.
  - Drag-reorder moved the 2.5s Scene first, re-deriving contiguous ranges 0/75/165.
  - Right-edge trims: 118f → snapped to 120f ("snap 1s"); Alt → 83f; near the playhead (250) → snapped to 250 (47f).
  - The Inspector and CENAS showed the same values.
- **Persistence**
  - Salvar, then reload → CENAS 4s / 2.77s / 1.57s, TIMELINE 0/120, 120/83, 203/47.
  - DB `scenes` = durations 4 / 2.7667 / 1.5667, 8 keys each.
- **Final render**
  - Renderizar vídeo → execution `352331eb-3940-4235-83ed-023995bb2df1` queued → claimed → completed.
  - Output: 1080×1920 `video/mp4`, 2.4 MB, 8.384s (≈ 250f).
  - The Output Player played and seeked. The Gallery API lists the execution.

**Environment notes** (not product defects):
- The embedded test browser throttles rAF in non-visible tabs.
- It does not deliver CSS `animationend`, so Radix dialogs stayed mounted until dispatched manually.
- Its automated drag grabs block centres, so edge trims were driven with pointer events on the handle.

Production smoke: see §16.

## 14. Explicit boundary before independent temporal segments

VideoScene[] represents a **single contiguous primary-Scene lane**. It cannot honestly represent B-roll over a Scene, continuous audio, independently timed captions/lower thirds, or overlays crossing Scene boundaries (no track, no start independent of sequence position, no source range). Foundation V1 did **not** hit a case requiring them, so nothing was added: no hidden JSON, no editable persisted TimelineManifest.

What the next step must decide, not solve incidentally:

- **What VideoScene cannot represent:** a segment whose start is independent of Scene order, overlap with the primary lane, and non-visual (audio) media.
- **Minimum authored temporal semantics:** a segment with `track kind` (overlay | audio | caption), `start_frame`, `duration_frames`, a payload (AssetRef / Template element content / volume/fade), and a relation to Scenes or to the global timeline.
- **Candidate authority place:** a versioned `segments` section inside VideoDraft (same document, same PATCH, same ownership) vs a dedicated table. It must stay ONE authority with VideoScene[].
- **Effects to decide:**
  - Adapter: emit additional tracks/segments.
  - TimelineManifest: already has `overlay`/`audio`/`caption` tracks; no schema change expected for V0 kinds.
  - Migration: JSON-only if inside VideoDraft.
  - Backward compatibility: absent `segments` ≡ today's behaviour.

## 15. Research Gate B — next planned mission (recorded only)

It starts with the first genuinely overlapping case: main visual / talking head + B-roll + text / lower third + continuous audio. Topics:

- Remotion timeline/editor references and HyperFrames implementation (licence review before any reuse).
- Interaction primitives for free-positioned segments: drag, trim, snap, zoom, scroll.
- Semantic tracks.
- Source ranges only if real clips require them.
- Audio preview in the Player.
- Performance only on evidence.

Gate B also covers the §14 authority decision.

## 16. Delivery

- Implementation commit: see git history on `main` ("feat: creative editor video foundation v1").
- Final SHA and production smoke: recorded in the follow-up docs commit.
