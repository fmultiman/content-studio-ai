# VIDEO_CANVAS_OUTPUT_FORMAT_V1

This mission makes the VideoDraft's **output stage** (width × height) explicit authoring truth. Before it, every Video output was 1080×1920 because of one adapter constant, not because the draft said so. Now the draft owns its stage. Source media, the preview viewport and presets cannot redefine it, and the active Template's own declaration decides honestly which stages it can draw.

## 1. Starting checkpoint

`791c4f51cc5d62ea750ab62beea78a677eb63d54` (VIDEO_HIERARCHICAL_SCENE_TIMING_SPIKE_V1 docs), equal on local, `origin/main` and remote `main`, clean tree.

## 2. A0 — factual geometry audit (code before changes)

| Concept | Current value source | Persisted? | Derived? | Should own it | Change |
|---|---|---|---|---|---|
| VideoDraft stage | `DEFAULT_TIMELINE_CANVAS = {1080,1920}` in `video-draft-to-timeline.ts` (adapter fallback; no caller passed `canvas`) | no | constant | **VideoDraft** | new authored field |
| `video_drafts` table | `scenes` JSONB **array**, `timeline` JSONB (temporal authority) | — | — | — | additive `canvas` column (§4) |
| Draft creation (`POST /api/video-drafts`) | no geometry | no | — | draft | accepts optional `canvas` |
| Editor load/save | `persistedVideoSnapshot` / `buildVideoDraftSaveBody` had no geometry | no | — | draft | carry `canvas` |
| Live Player | `compositionWidth/Height = manifest.specification` | no | from manifest | manifest ← draft | none (already data-driven) |
| Editor viewport | `usePreviewViewport({ surfaceWidth: DEFAULT_TIMELINE_CANVAS… })` | no | constant | authored stage | use authored stage |
| TimelineManifest `specification` | adapter input `canvas ?? DEFAULT_TIMELINE_CANVAS` | no (derived) | yes | draft | pass authored stage |
| Render snapshot | `buildRenderExecutionSnapshot` → adapter without `canvas` | frozen in `render_executions.input_snapshot` | yes | draft | pass authored stage |
| `render_executions.output_width/height` | reported by worker from the composition | yes | from render | output fact | none |
| Enqueue route | re-runs `resolveTimelineManifest` (Template check incl. canvas) | — | — | — | select `canvas`; readable error |
| Worker (VPS) | `remotion-entry.tsx` `calculateMetadata` reads `specification.width/height`; `selectComposition` → `renderMedia` | — | from snapshot | manifest | **none** |
| Remotion Studio root | `remotion/Root.tsx` same `calculateMetadata` | — | — | — | none |
| Template renderer | `layoutKit`: `sx = width/1080`, `sy = height/1350` (independent X/Y scale from a 1080×1350 reference; font size follows X) | — | — | Template | none (compatibility audited, §7) |
| Template declaration | `editorial.documentary-card` `canvas_support: declared_sizes [1080×1350, 1080×1920]`, enforced by `validateTemplateCanvas` in both resolvers | code | — | Template | reused as the compatibility truth |
| Root overlays | `IndependentSegments`: `unit = width/1080`, lower third at `bottom: height*0.14` | — | — | renderer | none |
| Media fit | Scene hero and B-roll are `object-fit: cover` inside their boxes; media never sizes the stage | — | — | Scene/root item | none |
| Output Player | fixed `aspect-[9/16]` box | — | constant | the MP4's own dimensions | size from `output_width/height` |
| Header | literal "Video · Reel 9:16" | — | constant | derived label | Formato control |
| Gallery | lists the render as a video output; no geometry assumption found | — | — | — | none |

**Conclusion:** the pipeline (manifest → Player/worker) was already data-driven; only the source of truth was missing. Nothing in the worker bundle needed to change.

## 3. A1 — authority decision

**VideoDraft owns canonical renderable width × height.** Stored as concrete pixels `{ width, height }`, never as an aspect label alone. Presets and ratios are UI derived from the numbers.

## 4. Persisted shape and migration 037

`video_drafts.canvas JSONB NULL` — `{ "width": 1080, "height": 1350 }`.

- `scenes` is a JSONB array (no room for a document-level key without reshaping it) and `timeline` is the **temporal** root authority; the stage is **spatial/output** authority, so putting it in `timeline` would mix authorities. A small additive column was the truthful option (same reasoning as 035/036).
- `scripts/037_add_video_draft_canvas.sql`: `ADD COLUMN IF NOT EXISTS canvas JSONB` + comment. Re-executable, no default, no backfill. Applied to production before the push; 13 existing drafts all stayed `NULL`.
- Validation stays in the app: `validateVideoCanvas` (`lib/creative/video-editor/video-canvas.ts`), used by `PATCH/POST /api/video-drafts` (`INVALID_VIDEO_CANVAS`, 400). Absent field = keep the stored value; `null` = back to legacy.
- `VideoDraft.canvas?: VideoCanvas | null` in `lib/types.ts`.

## 5. A2 — backward compatibility

Missing/`null` canvas → `LEGACY_VIDEO_CANVAS` 1080×1920, the stage every draft already rendered at. Old drafts are never rewritten: an unauthored draft's dirty snapshot and save body are byte-identical to before (`canvas` key only when authored). A malformed stored value reads as legacy rather than breaking the editor. Choosing 9:16 explicitly **is** authored state (stored `{1080,1920}`), distinct from "never chosen".

## 6. A3/A4 — presets and custom bounds

Presets (shortcuts; dimensions persist, the label is derived by `matchVideoCanvasPreset`):

| Preset | Size |
|---|---|
| Vertical 9:16 | 1080×1920 |
| Feed / Retrato 4:5 | 1080×1350 |
| Quadrado 1:1 | 1080×1080 |
| Horizontal 16:9 | 1920×1080 |
| Personalizado | width × height |

Custom bounds (platform, independent of any Template):

- integers only;
- **even** width and height: H.264 output is yuv420p (4:2:0 chroma), which needs even dimensions;
- each side **360–1920 px**: below 360 the Template's 1080-reference typography becomes unreadable; 1920 is the largest preset side, capping a frame at 1920×1920 ≈ 3.7 MP, ≤ 1.8× the proven 1080×1920 production footprint, so VPS render time and memory stay within a small multiple of what has been measured;
- only `width` and `height` keys (no `aspect_ratio`, no preset id).

## 7. A10/A11 — Template compatibility audit

Real draft `7b12b65d…` content (Cover, Lista, Citação with element timing, root lower third), rendered locally through the same `TimelineComposition` at each shape, left to right 9:16 · 4:5 · 1:1 · 16:9 (evidence: `evidence/video-canvas-output-format-v1/template-audit-{cover,list,quote}-9x16-4x5-1x1-16x9.jpg`; the fixture hero replaces signed Library images):

| Layout | 9:16 1080×1920 | 4:5 1080×1350 | 1:1 1080×1080 | 16:9 1920×1080 |
|---|---|---|---|---|
| Cover | SUPPORTED (proven in production) | SUPPORTED (native reference geometry) | DEGRADED BUT SAFE (vertical compression, decorations clipped at the bottom) | DEGRADED (title ×1.78 from X-scaled type, hero squashed into its box, decorations clipped) |
| Lista | SUPPORTED | SUPPORTED | DEGRADED (last items crowd the bottom/lower third) | UNSUPPORTED (intro text overlaps the list; last item leaves the frame) |
| Citação | SUPPORTED | SUPPORTED | DEGRADED BUT SAFE (quote text touches its paper edge) | UNSUPPORTED (intro overlaps bullets; quote and callout text overflow their papers) |

Root cause: layouts position from a 1080×1350 reference with **independent** X/Y scale factors while font size follows X only, so aspect changes stretch geometry non-uniformly.

**Decision:** the Template's existing `canvas_support` declaration (1080×1350, 1080×1920) is the compatibility truth — it is exactly what the audit supports, and the resolver already enforces it before any preview or render. No new metadata tier, no responsive engine.

- **Platform capability** (`validateVideoCanvas`) and **Template compatibility** (`videoTemplateCanvasSupport`, reading the family's descriptor) are separate functions.
- The Formato menu shows all four presets; 1:1 and 16:9 are **disabled with the reason** ("o template atual não desenha este formato"). Custom sizes the Template cannot draw keep "Aplicar" disabled with "O template Editorial Documentary Card desenha apenas 1080×1350 e 1080×1920."
- A stored stage the Template cannot draw (only reachable through the API) is shown truthfully: label "Personalizado 16:9 · 1280×720", the Player is replaced by "O template Editorial Documentary Card não desenha 1280×720. Escolha um formato compatível em Formato.", Render is disabled, and the enqueue route answers `VIDEO_CANVAS_UNSUPPORTED_BY_TEMPLATE` (422) instead of a raw resolver message.

## 8. A7 — source media boundary

Stage → Scene composition → media fitted inside it (`cover`). Nothing in the canvas path reads media dimensions (tested). Swapping a Scene's LibraryFile leaves `specification` unchanged (tested). No crop editor added.

## 9. A8/A9 — Player stage and viewport separation

- `buildLivePreviewInput({ …, canvas })` → same `buildRenderExecutionSnapshot` → `specification` → `@remotion/player` `compositionWidth/Height`. The stage changes shape immediately, with no render.
- The editor viewport's surface is the authored stage (`usePreviewViewport({ surfaceWidth: stage.width, surfaceHeight: stage.height })`). Changing the stage (or reverting to a different saved stage) runs **Fit**; zoom/pan remain UI state, never in the save body or dirty snapshot (tested).

## 10. A12/A13 — UI placement and save semantics

Header: `Video · [Feed / Retrato 4:5 · 1080×1350 ▾]` (`components/creative/video/video-canvas-control.tsx`), document-level, not in any Scene tab. The Inspector "Formato" metadata row reads the same stage.

Change → "Alterações não salvas" → Salvar → reload → identical dimensions. "Voltar ao salvo" restores the previous stage (proved: 4:5 → revert → legacy 9:16, "Salvo"). The Fit caused by a change never makes the draft dirty on its own.

## 11. A5/A14 — document level, temporal work unchanged

One stage per VideoDraft; no per-Scene canvas. Tests prove Scene durations, segment start/duration, Scene 3 `element_timing` (`quote 15+60`, `tape1 15+60`, `callout 45+75`), root items and the sequence-end bed keep their exact frames across 9:16, 4:5 and 16:9. Live Player at 4:5 (local, real draft): 169 no quote; 170 quote; 199 no callout; 200 callout; 229 quote, lower third gone (ends 225); 230 quote gone.

## 12. A15 — Player / render parity

One chain: `VideoDraft.canvas` → `buildRenderExecutionSnapshot` → adapter `canvas` → `specification` → (a) Live Player composition, (b) frozen `input_snapshot` → claim → worker `calculateMetadata` → MP4. Tested: the Live Player manifest equals the render snapshot manifest for legacy and 4:5.

## 13. Worker

**No worker change.** None of the changed files is in `infra/render-worker-runtime/export.mjs` (49 files checked); the worker already sizes from `specification`. No tarball, no operator step. The VPS worker in production is still the hierarchical-timing bundle (sha256 `522abb88…6f16a2c`).

## 14. Production proof

Feature `358a05195d91a68e17098738eddabf5fc1502d5c` pushed (local = `origin/main` = remote); Vercel Production deployment `6676974193` **success**. Migration 037 applied before the push.

**Local editor (real draft, production DB):** legacy draft opened as "Vertical 9:16 · 1080×1920", not authored, "Salvo"; menu showed 9:16/4:5 enabled and 1:1/16:9 disabled with the reason; 4:5 → stage 270×337 (from 270×480), dirty, timeline still 275 frames; "Voltar ao salvo" → legacy 9:16, "Salvo"; 4:5 again → Salvar → DB `{"width":1080,"height":1350}` with Scenes, Scene 3 timing and root items untouched → reload identical, Player composition natively 1080×1350. Custom dialog: `1081×1920` → "Largura precisa ser par…", `4000×1080` → "…entre 360 e 1920 px", `1280×720` → Template message, `1080×1920` → Aplicar enabled. API: `{1081,1920}` → 400 `INVALID_VIDEO_CANVAS`; `aspect_ratio` key → 400; `{1280,720}` → 200 and reloads as "Personalizado 16:9 · 1280×720" with the Player blocker and Render disabled; recovered to 4:5 through the menu.

**VPS renders (same draft, 3 Scenes, B-roll, lower third, two concurrent audio items, Scene 3 element timing):**

| Execution | Stage | ffprobe | Frames | Output Player |
|---|---|---|---|---|
| `123a4e63-1bc8-4928-9519-3b34eec9de23` | 4:5 authored | h264 1080×1350, 30/1 fps, aac, 9.216 s | 275 | box `aspect-ratio: 1080 / 1350` (439×549), video 1080×1350, readyState 4 |
| `5a184555-9424-409f-b4c8-5d68042ccccd` | 9:16 authored explicitly | h264 1080×1920, 30/1 fps, aac, 9.216 s | 275 | box `1080 / 1920`, video 1080×1920, readyState 4 |

- 4:5 frames (`evidence/…/vps-4x5-frames-45-140-169-170-200-230.jpg`): 45 Cover; 140 Lista with the root lower third; 169 Citação without quote/callout; 170 quote + tape; 200 callout; 230 quote and lower third gone. Element timing and root items are unchanged by the stage.
- **9:16 explicit is byte-identical to the pre-feature legacy render** `4e85ee7f` (VIDEO_HIERARCHICAL_SCENE_TIMING_SPIKE_V1 render A, no canvas): same file MD5 `5ad4bc1f79faf2f01d6f0353bd8b5158`, same decoded video MD5 and audio MD5.
- Audio unaffected: bed+voice overlap window 4–6 s is −15.3 dB mean / −5.6 dB max in both the 4:5 and 9:16 renders (same as Audio V1 / hierarchical renders).
- Gallery: 58 outputs (was 56), "Vídeo renderizado · Novo vídeo" first; its viewer plays the newest render with `object-fit: contain`, so any shape displays correctly.
- The "Salvar e renderizar" path saved the explicit 9:16 before enqueueing (snapshot `specification` 1080×1920×275).

**Static regression (A18):** the real 10-slide Instagram Carousel (`1247e54b…`) opens with TPL./CONT./ASSETS/ESTILO/ELEM. intact and no Video format control; `Gerar PNG` on slide 5 → `99112de8-0e69-48e9-b753-c0a354585d86`, snapshot canvas 1080×1350, output PNG 1080×1350.

**Test data restored:** draft `7b12b65d…` back to `canvas = NULL` (legacy), Scene 3 at 4 s with `quote {15,60}` / `callout {45}`, 4 root items; zero drafts carry a canvas. Executions `123a4e63…`, `5a184555…` (video) and `99112de8…` (static) are left as evidence.

## 15. Tests and gates

- New `lib/creative/video-editor/__tests__/video-canvas.test.ts` (20 tests): legacy fallback, explicit dimensions, preset derivation, custom validation, save/reload + dirty, canvas ≠ media, canvas ≠ viewport, Player/render parity, render-route freezing, Template compatibility + resolver refusal, temporal invariance, Static unaffected.
- Updated two text-pinning assertions (`video-editor-surface.test.ts` save call; Gate B `temporal-items.test.ts` render-route select/snapshot) to the new contract.
- Full suite **95 files / 1250 tests** pass; `tsc --noEmit` clean; ESLint clean on all changed files; `pnpm build` success.

## 16. Final checkpoint

- Feature: `358a05195d91a68e17098738eddabf5fc1502d5c`, Vercel Production `6676974193` success.
- Final SHA: `03904acd8d41b4ec09c8f3551fc6e5773361c98f` (the docs commit recording this validation; recorded by the VIDEO_FREE_SCENE_COMPOSITION_V1 housekeeping, since a commit cannot print its own hash).
- Migration: `037_add_video_draft_canvas.sql` (additive, applied). Worker: unchanged.
- Not committed: `.env.local`, `.next/`, `tsbuildinfo`, `infra/render-worker-runtime/dist/`, `.tmp/` (audit renders), scratch files, downloaded MP4s.

## 17. Known limitations

- The current Template draws only 9:16 and 4:5. 1:1, 16:9 and custom sizes are platform-valid but blocked while it is active; a Template that declares them (or a Template-free composition) is what unlocks them.
- No per-Scene canvas, crop/focal editor or safe-area editor.
- `fps` stays the fixed 30 (not authorable).
- The legacy `/dev/creative-preview` page keeps its own dev-only portrait/reel switch.
