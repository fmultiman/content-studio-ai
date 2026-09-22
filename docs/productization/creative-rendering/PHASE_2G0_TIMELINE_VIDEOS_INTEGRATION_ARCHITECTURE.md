# Phase 2G0 — Timeline Product Shell: Existing Videos Integration Architecture

**Nature:** Read-only architecture/integration study. No source, schema, migration, API, or UI change was made. Evidence labels: **FACT** (verified in code/schema/docs), **INFERENCE** (reasoned from facts), **RECOMMENDATION** (proposed decision), **OPEN QUESTION** (unresolved).

## 1. Executive Summary

**FACT.** Two fully separate universes exist today under the same domain umbrella:
1. **Videos product** (`/videos`, `video_drafts`, `VideoScene[]`) — a real, working, autosaving storyboard *authoring* UI with **zero** real generation and **zero** real rendering. "Gerar Vídeo" is an explicit 3-second `setTimeout` simulation with a toast admitting it (`"Este é um fluxo simulado"`).
2. **Timeline creative core** (`TimelineManifest`, `resolveTimelineManifest`, `remotion/timeline/*`) — a proven, tested, real H.264-MP4-producing rendering pipeline (Wave 8: 180 frames/6.0s → real MP4 in 117.8s), sharing its neutral schema layer, asset resolution, identity, primitives, and template registry with the already-productized Static path.

**FACT.** These two universes have **never been connected**. `grep` across the entire codebase found zero references to `VideoScene`/`VideoDraft` inside `lib/creative/**` or `lib/schemas/creative/**`, and zero references to `TimelineManifest`/`TimelineComposition`/`resolve-timeline` inside `app/**`. They evolved on parallel, non-intersecting tracks.

**RECOMMENDATION (headline):** Videos **can** evolve into the Timeline product shell, but only through an explicit adapter (`VideoDraft.scenes → TimelineManifest`) — not by treating the two as already compatible, and not by replacing `VideoDraft`. This matches, word for word, the direction already set in `PHASE_2D0_CREATIVE_WORKSPACE_PRODUCT_ARCHITECTURE.md` (§7, §11, §22) before any Timeline-specific code existed to verify it against; this phase confirms that recommendation still holds against the real current code.

**Verdict: `VIDEOS_CAN_EVOLVE_WITH_STRUCTURAL_ADAPTATION`**

## 2. Scope / Method

Read-only audit of: `app/(dashboard)/videos/**`, `app/api/video-drafts/**`, `app/api/videos/**`, `components/videos/**`, `lib/types.ts` (Video/VideoDraft/VideoScene/ImageDraft), `lib/draft-hub.ts`, `scripts/001_create_tables.sql` / `010_add_image_draft_workspace_state.sql` / `020_create_productions.sql`, the full `lib/creative/**` and `lib/schemas/creative/**` timeline surface, `remotion/timeline/**`, and the discovery docs listed as authorities plus `WAVE_7_TIMELINE_VIDEO_PREVIEW.md`, `WAVE_8_TIMELINE_MP4_RENDER_PATH.md`, `WAVE_10_FINAL_SPIKE_VERDICT.md`. No `/videos`, `/imagens`, `video_drafts`, `image_drafts`, or `draft-hub.ts` file was modified. `git status` confirmed clean before and after.

## 3. Current Videos Product Map

| Piece | File(s) | Classification |
|---|---|---|
| Draft hub (list/filter/create-in-Production) | `app/(dashboard)/videos/page.tsx` (`renderVideoHub`), `app/(dashboard)/videos/rascunhos/page.tsx`, `lib/draft-hub.ts` | PRODUCT NAVIGATION |
| Scene list authoring (add/update/delete/reorder-by-delete) | `app/(dashboard)/videos/page.tsx` | AUTHORING |
| Per-scene editor (description, image upload, duration, movement, AI prompt-text button) | `components/videos/scene-card.tsx` | AUTHORING |
| Storyboard overview (thumbnail grid, click-to-scroll) | `components/videos/storyboard-modal.tsx` | AUTHORING / PRODUCT NAVIGATION |
| Scene prompt-text generation (GPT chat completion, text only) | `app/api/videos/generate-scene-prompt/route.ts` | GENERATION (text-only, not media) |
| VideoDraft CRUD + autosave (800ms debounce + `beforeunload` + explicit button) | `app/api/video-drafts/route.ts` | DRAFT MANAGEMENT |
| "Gerar Vídeo" | `app/(dashboard)/videos/page.tsx: handleGenerateVideo` | **SIMULATED** — not a real classification bucket; explicitly fake |
| "Preparar publicação" → `QuickFlowDialog` | `components/publication/quick-flow-dialog.tsx` | PRODUCT NAVIGATION (text copy into a *new*, unlinked `EditorialContent`+`ChannelPiece`) |
| Scene image storage | `components/videos/scene-card.tsx: handleFileChange` | **ASSET MANAGEMENT — does not exist.** Images are read client-side via `FileReader.readAsDataURL` and stored as a raw base64 `data:` URL directly inside the `scenes` JSONB column. No S3 upload, no `LibraryFile`, no `Image` row is ever created. |
| Timeline rendering | none wired to Videos | **RENDERING — does not exist for this product.** The proven `TimelineManifest → Remotion → MP4` path (§8) is never invoked from `/videos`. |
| Legacy `videos` table (`scripts/001_create_tables.sql`) | — | **DEAD.** `grep -rn ".from('videos')"` across the repo returns zero matches. Superseded entirely by `video_drafts`; not used by any route. |

## 4. VideoDraft Semantics

Schema (`scripts/002_create_drafts_tables.sql`, `020_create_productions.sql`; type in `lib/types.ts`): `id, user_id, project_id (nullable), production_id (nullable), name, scenes (JSONB, no DB-level schema), created_at, updated_at`.

1. **What does it represent today?** **FACT:** a named, autosaved authoring session holding an ordered list of scenes — an authoring document, not a rendered output and not a domain content entity.
2. **Project-scoped?** **FACT:** yes, `project_id` nullable at the DB level.
3. **Content-scoped (to EditorialContent)?** **FACT:** no — no `editorial_content_id` column exists, no code references one.
4. **Relates to Production?** **FACT:** yes, `production_id` nullable in schema, but **the API enforces it as required** — `POST /api/video-drafts` returns 422 `PRODUCTION_REQUIRED` without one, and the UI blocks saving with "Production obrigatória." (`app/(dashboard)/videos/page.tsx: handleSaveDraft`).
5. **Relates to EditorialContent?** **FACT:** no FK. `PUBLICATION_DOMAIN_DECISIONS.md` §21 lists `"FK direta EditorialContent → VideoDraft"` as explicitly out of scope, "implícita via production_id compartilhado" only.
6. **Relates to ChannelPiece?** **FACT:** no FK, and no reverse reference either. The only bridge is `QuickFlowDialog`, which *copies text* (scene descriptions/prompts) into a brand-new `EditorialContent` + `ChannelPiece` it creates — a one-way, one-time text copy, not a structural link. Saving the `VideoDraft` again afterward does not update that `ChannelPiece`.
7. **Can one VideoDraft represent a quick clip, a Reel, a long-form video, or all of the above?** **FACT (by construction):** yes to all three — `scenes` is an unbounded array; nothing in the schema, API, or UI caps or floors its length. A one-scene draft and a fifty-scene draft are both valid rows today.
8. **Is VideoDraft already effectively an authoring document?** **FACT: yes.** It already has exactly what Static authoring (Phase 2F0 §10) identified as *missing* and deliberately deferred: a real, autosaving, named, resumable session (800ms debounce, `beforeunload` flush, explicit "Salvar Rascunho," draft-hub listing, "load and continue" via `loadDraft`). This is a significant existing asset the Timeline shell should preserve, not rebuild.
9. **State on VideoDraft vs VideoScene:** `VideoDraft` owns identity/ownership/naming/production context and the *ordered collection*; `VideoScene` owns per-scene content (`description`, `prompt`, `image_url`, `duration`, `movement`). There is no separate `order` persistence mechanism beyond the array index / the `order` field being reassigned on delete — no scene-level table, no scene IDs referenced elsewhere.
10. **Important state currently missing:** no `status` field at all (unlike `ImageDraft.image_status` or `ChannelPiece.status`) — a `VideoDraft` cannot today be marked ready/approved/archived; no channel/format/target field (§10); no schema validation of `scenes` at the API boundary (confirmed — `PHASE_2D0` §7 flagged this too: `"scenes JSONB sem um schema Zod de cena no boundary"`); no real asset reference (only inline base64).

## 5. VideoScene Semantics

`{ id, order, description, prompt: string | null, image_url: string | null, duration: number (seconds), movement: string | null }`.

**FACT:** `image_url` is a misleading name — it is not a URL to any stored resource; it is either `null` or a full base64 `data:image/...` string produced by client-side `FileReader`. **FACT:** `movement` is a free-ish string from a fixed UI list (`static, zoom_in, zoom_out, pan_left, pan_right, tilt_up, tilt_down, dolly`) with no schema enum enforcing it server-side. **FACT:** `duration` is in whole seconds from a fixed picker (2/3/4/5/8/10), not frames — a unit mismatch against `TimelineManifest`, which is frame-based (`FrameSchema`, `duration_frames`) (§9, §13).

## 6. Generation vs Authoring Boundary

**FACT:** there is currently no video or image *generation* wired into Videos at all. The only AI call (`/api/videos/generate-scene-prompt`) produces a **text prompt string** via a GPT chat completion — intended for future pasting into an external AI video/image tool, per its own system prompt ("ready to paste into an AI video or image model"). It does not call any image or video generation provider, and its output is never sent anywhere automatically.

**FACT:** the only way a scene gets an "image" today is a manual file picked by the user, converted to base64 in the browser, and stored inline. There is no path from a generated clip to a `LibraryFile`, because there is no generation step producing a clip.

**Evaluating the desired boundary** (`Video AI Generator → Asset/Library → Timeline Authoring`): **INFERENCE:** this boundary does not exist today, but it does not conflict with anything either — because there is currently *nothing* on the generation side to reconcile. The existing product only occupies the "Timeline Authoring" box; "Video AI Generator" and "Asset/Library" are both greenfield for video. The boundary is sound and worth keeping as a target, but building it is new work, not an integration of two existing halves.

## 7. Single Clip vs Long Video

Hypothesis: a single 5–10s clip and a 10-minute video should use the same Timeline authoring model with different complexity (1 scene → quick clip; many scenes → Reel/long-form).

**FACT:** nothing in `VideoDraft`/`VideoScene`/the API caps scene count, so the *authoring* side already supports this range mechanically. **FACT:** `PHASE_2D0` §22 already reached the same conclusion in principle ("uma única scene válida para clip rápido").

**FACT (the real constraint):** `TimelineManifest.render_intent.purpose` includes `'preview' | 'rough_cut' | 'final'` and rendering is proven only at small scale — Wave 8's one real MP4 proof is 180 frames / 6.0 seconds and took 117.8 seconds to render locally (roughly 20× realtime, single template segment, no audio/captions). Nothing in the spike evidence establishes how this scales to many scenes or minutes of runtime; Wave 10 explicitly lists async production infrastructure (queues/workers) as unproven and deferred.

**Classification: `SUPPORTED_WITH_EXTENSION`.** The authoring shape supports the range as-is; the render path is proven only at clip scale and needs an adapter (§4/§13) plus (later, not now) a real answer for how a many-minute render is produced without blocking a request for tens of minutes — that answer is explicitly **not** designed in this phase (would require job/queue infrastructure this phase is told not to invent).

## 8. Current Preview/Render Behavior

Revalidating `PHASE_2D0`'s claim that Videos rendering is simulated: **confirmed, unchanged.** `handleGenerateVideo` in `app/(dashboard)/videos/page.tsx` is:
```
await new Promise(resolve => setTimeout(resolve, 3000))
toast({ title: 'Vídeo em processamento!', description: 'Este é um fluxo simulado...' })
```
No fetch, no API call, no file is produced. The page's own on-screen banner states this outright: *"Este módulo está preparado para integração futura com APIs de geração de vídeo. Atualmente, o fluxo é simulado."*

**Preview:** `StoryboardModal` shows a static, scrollable list of scene thumbnails (raw `image_url`/base64) for navigation — it is not a scrubbable timeline, has no motion, no playback, no Remotion involvement.

**Proven Timeline render core (separate from Videos):** `scripts/creative/render-timeline-manifest.ts` / `run-timeline-manifest.mjs` + `remotion/timeline/TimelineComposition.tsx` + `TemplateSegment.tsx`, backed by `lib/schemas/creative/timeline.ts` (`TimelineManifestSchema`) and `lib/creative/resolution/resolve-timeline.ts` (`resolveTimelineManifest` → `ResolvedTimelineInput`). **FACT:** a real rendered MP4 artifact exists in this worktree at `.tmp/creative/timeline-render/documentary-card-cover-1080x1920-a.mp4` (untracked, gitignored `.tmp/`), produced by this path — corroborating Wave 8/10's written claims with a locally-observable file, not just documentation.

**Exact gap between CURRENT VIDEOS and the PROVEN TIMELINE RENDER CORE:** total — zero code path connects them. The gap is not a bug to fix; it is integration work that has never been started.

## 9. Current Domain Relationships

```
Project 1──N Production 1──N VideoDraft   (production_id enforced by API, though nullable in schema)
Project 1──N Production 1──N EditorialContent 1──N ChannelPiece   (existing, productized for Static)
VideoDraft  ⇢ (no FK) ⇢  ChannelPiece      (only a one-time text-copy via QuickFlowDialog)
ChannelPieceMedia → LibraryFile | Image    (existing, productized for Static; §14)
```
**FACT:** `Production` is the only real, structural meeting point between the Static chain and the Timeline chain today — both `EditorialContent` and `VideoDraft` hang off the same `Production`, but neither points at the other.

## 10. Channel / Target Modeling

**FACT:** `VideoDraft`/`VideoScene` carry **no** channel or format field whatsoever. Video-shaped publication targets (`reel`, `short`, `video_description`, plus Instagram `story`) already live exclusively on `ChannelPiece.channel` / `ChannelPiece.format` (`scripts/021_create_publication_entities.sql`), and Static authoring's own `staticAuthoringTarget()` (Phase 2E-A) already explicitly *rejects* these formats as "belongs to timeline mode" — i.e., the domain has already reserved this modeling slot for `ChannelPiece`, not duplicated it anywhere else.

**RECOMMENDATION:** do not add channel/format to `VideoDraft`. When a Timeline shell needs a target (canvas/aspect, duration constraints, export format, template compatibility), it should read it from the `ChannelPiece` it is contextualized under — exactly mirroring how Static reads `context.target` from the ChannelPiece today (Phase 2E-A). This requires the `ChannelPiece ⇢ VideoDraft` structural link that does not yet exist (§9, §12) — until that link exists, a Timeline session opened directly from a `VideoDraft` (no ChannelPiece) has no target to read and must fall back to a default (e.g. 9:16, matching Reel/Story), same as Static falls back to sensible defaults absent stronger signal.

## 11. Shared Creative Core Reuse Matrix

| Capability | Classification | Evidence |
|---|---|---|
| Project Identity | **REUSE AS-IS** | Same `identity.snapshot_ref` / adapter already used by both Static and the `TimelineManifest.identity` field; no video-specific identity concept exists or is needed |
| `LibraryFile` | **REUSE AS-IS** | Generic, `kind` already includes `video`; already the approved target for rendered video output (`CPM-D13`, §14) |
| `AssetRef` / `ResolvedAsset` | **ADAPT** | The neutral schema/type is shared and already used by `resolveTimelineManifest`, but `resolve-asset.ts`'s `library_file` branch is a stub (`url: ''`, comment: *"Empty until resolved by integration layer or authoring proxy"*) — the same gap Wave 10 flagged (*"No connection exists between real LibraryFile records... and the AssetRef pipeline"*), still true today. Static solved this with bespoke server-side glue (`static-authoring/render/route.ts` resolving real primitives directly, bypassing `resolveAsset`'s stub) rather than upgrading the shared resolver — Timeline would need the equivalent bespoke glue, not automatic reuse |
| Visual Primitives + transforms | **REUSE AS-IS** | Explicitly regression-tested through the timeline path already: `PHASE_2D_A_PRIMITIVE_TRANSFORM_ROUNDTRIP.md` §12 rendered frame 90 of a real timeline composition using the identical `PrimitiveTransforms` model, "não foi criado um sistema paralelo" |
| Template Registry | **REUSE AS-IS** | `resolveTemplate`/`validateTemplateMode` etc. used identically by both `resolve-static-render.ts` and `resolve-timeline.ts` |
| AuthoringState concepts | **VIDEO-SPECIFIC (today)** | The static `AuthoringState`/reducer model has no video/scene/timeline shape; `VideoDraft.scenes` is its own, already-functional authoring state and should not be replaced by it — see §4.8 |
| Shared React components (`DocumentaryCard`, etc.) | **REUSE AS-IS** | `TemplateSegment.tsx` already renders the same component trees inside a timeline frame, per Wave 9A/10 |
| `TimelineManifest` | **REUSE AS-IS** (as the render input contract) | Mature, neutral, already-tested schema; the gap is what *produces* one from `VideoDraft`, not the schema itself |
| `ResolvedTimelineInput` | **REUSE AS-IS** | Same resolver used regardless of what produces the manifest |
| Remotion compositions | **REUSE AS-IS** | `TimelineComposition`/`TemplateSegment` already proven end-to-end to real MP4 |
| Typography | **REUSE AS-IS** | Deterministic typography (Wave 9B/9C) is shared, not static-specific |
| Diagnostics | **REUSE AS-IS** | `diagnostics.ts` resolution-result shape is identical between `resolve-static-render.ts` and `resolve-timeline.ts` |
| Output persistence pattern (`LibraryFile` + `ChannelPieceMedia`, explicit save) | **REUSE AS-IS** | Same pattern, same route shape works for `kind: 'video'` (§14) |

## 12. Static vs Timeline Context

Static's proven chain (Phase 2E-A/2F-A): `ChannelPiece → contextual shell → Shared Creative Core → render → explicit Save → LibraryFile + ChannelPieceMedia`.

**FACT, not assumption:** the analogous Timeline chain **cannot** start purely from `ChannelPiece → VideoDraft` today, because no FK connects them (§9). Three candidate starting points were evaluated against actual code, not assumed:

| Candidate | Verdict | Why |
|---|---|---|
| `VideoDraft` alone (current reality) | **Correct starting point today** | It is the only entity that already has real, working authoring/autosave/ownership; it is Project+Production-scoped exactly like `ChannelPiece` |
| `ChannelPiece → VideoDraft` | **Future target, not buildable yet** | Requires the missing FK (§9) — explicitly deferred by `PUBLICATION_DOMAIN_DECISIONS.md` §21, not something this phase should force into existence |
| `EditorialContent → ChannelPiece → VideoDraft` | **Rejected as the entry point** | `EditorialContent` is editorial text, not a video-editing surface; nothing in the domain treats it as one, and static's own precedent enters at `ChannelPiece`, not `EditorialContent` |

**RECOMMENDATION:** the Timeline shell should contextualize `VideoDraft` first (matching current reality and `PHASE_2D0`'s own conclusion), and treat "target ChannelPiece" as an *optional*, later-addable pointer on `VideoDraft` — the same incremental posture Static took (real context first, output-persistence wiring second, in two separate phases 2E-A → 2F-A).

## 13. TimelineManifest Integration

**FACT:** `TimelineManifest` already has a field explicitly reserved for exactly this future link: `TimelineContextSchema.video_work_ref` (optional, `RefSchema`) — with a code comment stating *"VideoWork does not exist in the product yet, so `video_work_ref` is optional. No VideoWork table, no migration, no persistent placeholder is created to support this field."* This is strong existing evidence that the schema authors already anticipated bridging to a real domain host without forcing a new entity — `VideoDraft`'s id is the natural value for that ref once a bridge exists.

**Unit mismatch to resolve in an adapter (not now):** `VideoScene.duration` is in seconds; `TimelineManifest` segments are in frames (`duration_frames`, `fps` on `TimelineSpecification`). Converting is arithmetic (`duration_frames = round(duration_seconds * fps)`), not a modeling problem.

## 14. Output Lifecycle

Revalidating `CPM-D13` (`docs/CHANNEL_PIECE_MEDIA_DECISIONS.md`): **confirmed, verbatim:** *"Vídeos via `library_files`... Fluxo futuro aprovado: `VideoDraft → renderização/exportação → LibraryFile (kind: 'video') → ChannelPieceMedia`."* This is not aspirational — the schema already enforces it: `library_files.kind` already includes `'video'`, and `channel_piece_media`'s exactly-one-source constraint already accepts a `library_file_id` pointing at a video `kind` (Phase 2F0 confirmed the equivalent path for images end-to-end, §5–§7 there).

**How a future MP4 render should enter this path without over-reaching:** identical shape to Phase 2F-A's static save action —
1. Render produces an MP4 (ephemeral, in a temp/output location) — no auto-save.
2. An explicit user action ("Salvar nesta peça") uploads it through the **same, already-existing** `POST /api/channel-piece-media/upload` route (already accepts `video/mp4`, `video/webm`, `video/quicktime` in its MIME whitelist — confirmed in Phase 2F-A's audit of that exact route).
3. Role/position stay server-decided (first save → `primary`, subsequent → `carousel_item`) — **no automatic approval** (`ChannelPiece.status` untouched), **no automatic publish** (`Distribution` still doesn't exist), **no silent replacement** of a previous video (CPM's existing primary-demotion behavior handles that exactly as it already does for images).

**No new persistence work is required for this to work** — it is the same route, same tables, same rules already proven for static output.

## 15. Existing Videos UI Audit

| Part | Classification | Notes |
|---|---|---|
| Scene list (add/delete/reorder) | **PROMOTE** | Solid existing pattern; reorder is currently index-based only (no drag persisted — `GripVertical` icon is decorative, no drag handler wired), worth carrying forward as-is |
| Scene editor card | **ADAPT** | Content fields (description) promote directly; `image_url` (base64) and `duration` (seconds) need adapting into `AssetRef`/`frames` once a real Timeline segment model is wired |
| Asset chooser (manual file picker) | **GENERATOR-SPECIFIC / DEV-LIKE** | Base64-inline is a prototype shortcut, not a real asset pipeline — should be replaced (not promoted) by a real upload-to-`LibraryFile` flow when Timeline authoring is built, mirroring Static's `PrimitivePicker` pattern |
| Prompt controls (`Gerar` button) | **REUSE** | The text-prompt-assist pattern itself is sound and channel-agnostic; can stay as a scene-level "assist my prompt" helper regardless of what eventually consumes the prompt |
| Duration / movement selects | **ADAPT** | Movement vocabulary (`zoom_in`, `pan_left`, etc.) should be checked against `MotionSpecSchema`'s supported values before being trusted 1:1 — not verified equal in this phase (OPEN QUESTION) |
| Storyboard modal | **PROMOTE** | Good existing navigation pattern; could gain real timeline semantics later without needing a redesign now |
| Render/export ("Gerar Vídeo") | **DEPRECATE LATER** | Entirely simulated; replace, don't adapt, once real rendering is wired — nothing in it is reusable beyond the button's visual slot |
| Draft hub / filters / "criar na Production" | **PROMOTE** | Shared `lib/draft-hub.ts` pattern, already generic across image/video; keep as the Timeline shell's entry surface |
| Context header (Project/Production identity banner) | **REUSE** | `WorkspaceIdentityContext` component already used identically by Videos and (implicitly, via the same identity-summary pattern) elsewhere |

No redesign was performed or proposed — this is a classification only.

## 16. Creative Studio Relationship

**RECOMMENDATION:** a future global navigation entry ("Studio Criativo") can point at the **existing** `/videos` route (or a URL-compatible evolution of it) without renaming or rewriting anything now. This is purely a navigation/IA concern — `PHASE_2D0` already reached the same conclusion (§(Creative Studio menu is a product-navigation concern, not a domain entity, and the current per-surface routes can be linked from it without an immediate merge). Nothing evaluated in this phase requires resolving that question now, and this phase does not implement it.

## 17. Conflicts / Risks

- **No conflict** was found between the existing `VideoDraft`/`VideoScene` model and the Timeline render core's data shape — they simply never met. An adapter, not a rewrite, resolves this.
- **Risk (performance):** Wave 8's ~20× realtime render cost is proven only at 6-second/single-segment scale; nothing in the evidence base tells us how a multi-scene, multi-minute video would perform or whether it would require queue/worker infrastructure this phase is told not to build. This is a real, unresolved risk for any "long video" ambition, not a blocker for a single-clip slice.
- **Risk (asset gap):** `resolveAsset`'s `library_file` stub (§11) means a Timeline authoring/render path touching real uploaded assets needs the same kind of bespoke integration Static built for itself — budget for that, don't assume it's free.
- **Risk (schema-less scenes):** `scenes` JSONB has no server-side schema validation today (`PHASE_2D0` §7) — any adapter reading real `VideoDraft.scenes` rows must defensively validate shape rather than trust it, since years of manually-entered drafts could contain malformed or legacy-shaped scene objects.

## 18. Minimal Migration Path

Derived from the evidence above, each step independently provable without a big-bang rewrite, without replacing `VideoDraft`, without a parallel renderer, without a duplicate Library, and without a duplicate target enum:

1. **Contextualize `VideoDraft`** the same way Static contextualized `ChannelPiece` (Phase 2E-A): a real, authenticated, ownership-checked route that opens a specific `VideoDraft` by id within its real Project/Production, reusing the existing `WorkspaceIdentityContext` pattern already present in `/videos`.
2. **Build the `VideoDraft.scenes → TimelineManifest` adapter** (pure function, unit-testable in isolation, no UI yet): one scene → one `template` segment (reusing whatever template the scene's content implies) or one `media` segment (if/when a real asset exists); seconds → frames conversion; single-scene drafts produce a valid, minimal, one-segment manifest (proving the "quick clip" case first, per §7's `SUPPORTED_WITH_EXTENSION` finding).
3. **Wire real asset resolution for at least one asset kind** (e.g., a real `LibraryFile` image used as a scene's static background) — the bespoke glue identified as missing in §11, proven end-to-end for one case before generalizing.
4. **Reuse the existing Timeline renderer as-is** (`resolveTimelineManifest` → `TimelineComposition` → real MP4) against the adapter's output — no new renderer, no new Remotion composition.
5. **Persist the render through the existing output model** (§14) — explicit save, existing `channel-piece-media/upload` route, `kind: 'video'`, no automatic approval/publish.

Each step is independently demonstrable (a script/test proving it) before the next is attempted, exactly mirroring how Static's own 2E-A → 2F-A sequence worked.

## 19. Deferred Capabilities

- Real AI video/image generation wired into scenes (currently: none exists; out of scope to build now).
- `ChannelPiece ⇢ VideoDraft` structural FK (currently: text-copy only via `QuickFlowDialog`; deferred per `PUBLICATION_DOMAIN_DECISIONS.md` §21).
- Long-form (many-minute) render performance/infrastructure (queues/workers) — explicitly not designed here.
- `VideoDraft.status` (draft/ready/approved/archived) — does not exist; not proposed here without validated need.
- Drag-to-reorder scenes (icon exists, no handler) — cosmetic gap, not architectural, not addressed here.
- Movement-vocabulary ↔ `MotionSpecSchema` compatibility audit — flagged as an open question, not resolved here.
- Creative Studio global navigation entry — product-navigation only, not implemented here.

## 20. Recommended Next Slice

**One slice only, matching the evidence's own natural first step:** build and unit-test the **`VideoDraft.scenes → TimelineManifest` adapter** for the single-scene case (§18 step 2), as a pure function with no UI and no new route — proving that a real, currently-existing `VideoDraft` row (fetched, not fabricated) can produce a schema-valid `TimelineManifest` that `resolveTimelineManifest` accepts, using only fixture/template assets (deferring the real-asset gap, §11/§18 step 3, to its own later slice). This is the smallest step that materially moves Videos toward the Timeline architecture without touching `/videos` UI, without new APIs, and without the harder real-asset or long-form-performance problems.

## 21. Architecture Verdict

**`VIDEOS_CAN_EVOLVE_WITH_STRUCTURAL_ADAPTATION`**

`VideoDraft` is a real, working, already-autosaving authoring document — the correct host to preserve, not replace. The Timeline render core is separately proven and production-grade at small scale. Nothing about the two conflicts; they simply require an explicit adapter to meet, plus a small, already-scoped amount of new work on real asset resolution and (eventually, not now) long-form render performance. No new entity, no parallel renderer, no schema change, and no duplicate target modeling are required to begin.
