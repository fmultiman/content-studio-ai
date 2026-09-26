# VIDEO_HIERARCHICAL_SCENE_TIMING_SPIKE_V1

This mission is an implementation spike with real product proof: does the proven root temporal model (Scenes + independent root items) extend cleanly to elements *inside* one Scene, without a second clock, without turning every Template element into a Track, and without a database migration? The target is bounded, Template-declared, Scene-local element timing, exposed hierarchically in the same global Timeline, previewed in the Live Player and rendered on the real VPS worker.

## 1. Starting checkpoint

`98b79c4facf4773f9b57bee20d1fb6f45f80b457` — the VIDEO_AUDIO_AUTHORING_V1 docs commit, equal on local, `origin/main` and remote `main` at mission start. Previous chain: Single Writer → Scene Composition Parity → Gate B → Audio Authoring V1.

## 2. Phase 0 — factual Scene/Element audit

- **VideoScene** (`lib/types.ts`) already carries `duration`, `movement`, `composition` (spatial: `layout`, `content`, `element_order`, `hidden_elements`) and `library_file_id`. There was no temporal field beside the whole-Scene `duration`.
- **Template Registry** (`lib/creative/templates/template-definitions.ts`) declares each layout's `elements: TemplateElementDefinition[]` (id, label, kind, asset slot). Elements are spatial composition instances; nothing described *when* an element participates versus the whole Scene.
- **Render seam:** the shared Template renderer already accepts `hiddenElements` (from authored `hidden_elements`) plus the current local `frame` through `createProps`, so a render-time "is this element active at this frame" hook could plug into the same seam without inventing a new one.
- **Motion** is Scene-level only (`fade`, `slow_push`, `slow_pan`, `zoom_in` on the whole composition), applied before any per-element concern.
- **Neutral manifest** (`timeline.v0`, `TemplateSegmentPayload`) is a strict, validated contract; any new field here also has to reach the worker, so it directly gates the deployment order.
- **Selection model** before this mission: Scene, or root temporal item (B-roll/lower-third/audio). No element-level temporal selection existed.
- **Static** shares the same Template render tree (`TemplateSegment`-adjacent components) but has no frame/`Sequence` context; it renders a single still.

### Element matrix — Citação (Quote) layout, `editorial.documentary-card` / `variant: quote`

| Element | Real id | Spatial today | Motion today | Temporalizable | Why |
| --- | --- | --- | --- | --- | --- |
| Título + Faixa | `title` (+ `paperStrip`) | `TitleOnStrip`, hideable | whole-Scene `fade` only | **yes**, strip as companion | content-bearing; the strip is its backing |
| Papel da citação + Fita | `quote` (+ `tape1`) | asset layer, hideable | same | **yes**, tape as companion | focal content; the tape sits on it |
| Imagem | `hero` | div, `hideStyle` | `slow_push` (Cover only, not drawn on Quote) | **yes** | self-contained content image |
| Caixa de destaque | `callout` | asset layer, only if content has one | same | **yes** | self-contained content box |
| Ramo de folhas | `botanicalLeaf` | decorative | — | no | decoration, not content |
| Intro, bullets, sequence badge | not elements | fixed text layer, drawn directly from `content` | — | no | not element-backed; would need a Template change to acquire an identity |

Other layouts (Cover, List) were audited and rejected for this spike: their distinguishing content (`intro`, `eyebrow`, bullet list) is drawn straight from `content` by the layout renderer, with no per-unit element identity to attach timing to. Quote is the only layout where at least two real, independently addressable elements can enter/exit at different moments without inventing anything.

## 3. Chosen pressure case

Scene 3 ("O que ficou", Quote layout) of the real production draft `7b12b65d-4d8a-4f33-9f65-0aedf961c6e9` (Project "Portal Comunidades Alternativas", Production "Teste Timeline Portal"). Four real elements (`title`, `quote`, `hero`, `callout`) are simultaneously visible, spatially distinguishable, and the Scene already coexists with root B-roll, a root lower-third and two concurrent root audio items — so the proof can show internal timing and root timing side by side in one real Scene, with no fake elements created.

## 4. Temporalizability

Additive Template metadata: `TemplateElementDefinition.timing?: { companions?: readonly string[] }` (`lib/creative/templates/template-definitions.ts`). An element is temporalizable iff its definition carries a `timing` key; `companions` names sibling elements (backing/decoration) that move with it but have no independent timing of their own.

Declared **only** on the Quote layout: `title` (`companions: ['paperStrip']`), `quote` (`companions: ['tape1']`), `hero` (`{}`), `callout` (`{}`). No other layout declares it. `botanicalLeaf` and the fixed text units are not declared, so they remain full-Scene. No database migration — this is Template Registry metadata, not persisted VideoDraft state.

`lib/creative/video-editor/element-timing.ts`: `temporalElements(layout)` and `isTemporalElement(layout, elementId)` read this declaration; nothing else in the app infers temporalizability.

## 5. Element timing != Element Motion

Kept rigorously separate. Timing (`element_timing`) only decides *when* an element participates. Motion (`movement`/`fade`/`slow_push`/`slow_pan`/`zoom_in`) still only decides *how* the whole Scene or an element visually behaves while it is drawn, and is untouched by this mission. Verified: changing an element's timing does not reset Scene Motion, Scene duration or any root item; changing Scene Motion does not touch `element_timing`. No per-element animation/keyframe system was added.

## 6. Persistence decision

`VideoScene.element_timing?: Record<string, { start_frame: number; duration_frames?: number }>` (`lib/types.ts`), stored **next to** `duration` and `movement`, not inside the spatial `composition` object.

- **Is it spatial composition state?** No — it never affects layout, position or visibility rules; it only affects the temporal window in which an otherwise-composed element is drawn.
- **Is it temporal Scene state beside Motion/duration?** Yes — same family as `duration`, orthogonal to `movement`.
- **Putting it inside `composition` would incorrectly mix spatial and temporal authority** and would also make `setSceneLayout` (which resets `composition`) accidentally responsible for timing semantics it shouldn't own.
- The persisted semantics express exactly: element identity → Scene-local start → Scene-local duration/end intent. No global position, no current Scene start, no duplication of root timing.
- The default (start 0, no duration = full Scene) is stored as **no entry at all**, so an untouched Scene's JSON is byte-identical to before this mission. No migration.

`setSceneLayout` drops `element_timing` on layout switch, exactly like it already resets `composition.element_order`/`hidden_elements` — a new layout's elements have no relationship to the old timing values.

## 7. Canonical local time and local → global mapping

Scene-local Element timing is frame-based, at the canonical 30 fps, and is representable independently of where the Scene currently sits in the root sequence: `{start_frame, duration_frames?}` are Scene-local integers. The mapping to global time is deterministic and computed only at read time:

```
globalFrame = sceneStartFrame + localFrame
```

`sceneTimingRows(scene, sceneStartFrame, sceneDurationFrames)` derives the global-frame rows the Timeline draws; the persisted values it reads are never rewritten by this derivation.

## 8. Reorder proof (critical proof)

Authored on the real draft: Scene 3 `element_timing = { quote: {start_frame:15, duration_frames:60}, callout: {start_frame:45} }` (title/hero left at Scene-default, full participation).

- Before reorder: Scene 3 global start 155 → `quote` global 170–230, `callout` global 200–275 (follows Scene end).
- Scene 3 moved to position 1 (global start 0) → `quote` global 15–75, `callout` global 45–120. Child rows moved with the Scene.
- **The persisted values stayed exactly `{15,60}` / `{45}`.** Only the derived global range changed. Root items (B-roll, lower-third, both audio items) stayed at their original absolute root frames — they did not move with Scene 3, proving Scene-local timing is genuinely separate from root timing.
- Save + reload preserved the identical `element_timing`, and the Live Player matched: at global 14 nothing from Scene 3 yet; 15 `quote` present; 45 `callout` present; 60 root B-roll starts (unaffected, still covers the Scene by absolute position); 75 `quote` gone; 120 Scene 1 (Cover) with no leak from Scene 3's elements.
- Scene order was restored afterward.

This is the mission's central architectural proof: the Scene owns and keeps its local values; only the projection changes.

## 9. Scene retime decision and proof

Evaluated: (1) destructively clamp the authored value — rejected, loses authored intent and is not reversible if the Scene grows back; (2) preserve authored values and derive effective clipping at the Scene boundary — **chosen**; (3) block the Scene duration edit while timed elements exist — rejected, couples Scene duration editing to an unrelated child concern and would make the everyday Creative Editor non-Template-driven; (4) a bounded `scene-end` anchor — folded into outcome (2), since "no `duration_frames`" already means "follows the Scene end" and needs no extra anchor keyword.

`effectiveElementRange(timing, sceneDurationFrames)` (`lib/creative/video-editor/element-timing.ts`) computes, from the **unmodified authored** value: `startFrame`, `endFrame` (Scene-local, end-exclusive, clipped to the Scene), `followsScene` (no `duration_frames`), `clipped` (a fixed range whose authored end exceeds the Scene duration), `outside` (the authored start is at or past the Scene duration, so the element has no effective range at all).

**Retime proof** (production draft, Scene 3 authored `quote:{15,60}`, `callout:{45}`):
- Scene set to **2 s (60 frames):** `quote` effective range clips to local 15–60 (duration 45, `clipped`), `callout` (no fixed duration, `followsScene`) simply ends at the new Scene end (60) with no clipping flag needed since it never had a fixed end. The Inspector showed the amber clipped warning on `quote`; the audio bed (root, `end_anchor: sequence_end`) followed the shorter total duration in the same save.
- Scene optionally set to **1 s (30 frames):** `callout`'s authored start (45) is now at/after the Scene duration (30), so its effective range is empty (`outside`) — no leak, no crash, no silent rewrite.
- Save/reload after each step preserved the exact authored `{15,60}` / `{45}` — clipping is **never** written back.
- Scene restored to 4 s (120 frames) afterward; on reload the values returned to their full, unclipped effective ranges.

Adapter diagnostics: `element_timing_clipped` / `element_timing_outside_scene` (`lib/creative/timeline-adapter/video-draft-to-timeline.ts`), surfaced as Inspector warnings — deterministic, visible, Save/reload-stable, render-stable, with no hidden mutation.

## 10. Visibility precedence

`hidden = authored hidden_elements ∪ elements inactive at the local frame`. Hidden always wins: an element hidden via the existing spatial `hidden_elements` control never renders regardless of its timing window. Timing duration `0`/`outside` is not used as a substitute for visibility — they are enforced as genuinely distinct concepts, both funnelled into the renderer's single `hiddenElements` set.

## 11. Element order interaction

`composition.element_order` (spatial z-order/stack order) is completely untouched by this mission. Child-row order in the hierarchical Timeline is derived from **Template anatomy order** (`temporalElements(layout)`, i.e. the order elements are declared in the layout definition), not from `element_order` and not persisted as a temporal row order.

## 12. Neutral manifest / render contract

`TemplateSegmentPayload.element_timing?: { element_id, start_frame, duration_frames }[]` — Segment-local frames, **already clipped**, companions expanded into the same range as the element they follow, and the field is **absent entirely** when the Scene has no temporal elements (old payloads stay byte-identical). `validateTimelineSemantics` rejects duplicate `element_id`s and any range extending past the segment. Companion expansion happens in `deriveSegmentElementTiming` (`element-timing.ts`): for every element with authored timing, both its own id and each id in `timing.companions` get the identical effective range.

## 13. Renderer mapping and Remotion isolation

`remotion/timeline/frame-model.ts` exports `inactiveElementIds(timing, localFrame)` (end-exclusive), a pure frame → element-id-set function. `remotion/timeline/TemplateSegment.tsx` calls it once per frame and unions the result into the same `hiddenElements` set the Template renderer already consumed for authored visibility. No Remotion `Sequence`, `Series` or interpolation config is persisted anywhere in authored truth — the persisted vocabulary stays Scene → element identity → local timing; `Sequence`-like behaviour is an internal implementation choice confined to these two worker files.

## 14. Shared Static renderer caution

Static's `renderStill` path shares the Template render tree but has no per-frame `Sequence`/timeline context, so `inactiveElementIds` is simply never invoked on that path — Static keeps rendering the full spatial composition it always did. Verified in production after the VPS worker update: a fresh `Gerar PNG` on the same 10-slide Instagram Carousel used for the Audio V1 regression check (Project "Portal Comunidades Alternativas", channel piece `1247e54b-8f55-492e-825d-ed9b927f2e63`, slide 5) produced execution `38f42604-7596-48af-a396-1e9cbbb86357`, `completed`, 1080×1350 — identical dimensions and no error, confirming the new worker bundle does not regress Static.

## 15. Hierarchical Timeline UX

A disclosure chevron appears only on Scene rows whose layout has at least one temporal element (Scene 3 here); a double-click on the Scene row mirrors the chevron. Expanding shows child rows in Template element order (`title`, `quote`, `hero`, `callout` — only the ones with an active/authored range are visually distinguished, but all four are addressable), positioned on the **same global ruler**, inside a tinted band matching the Scene's interval, with root lanes (B-roll, Texto, ÁUDIO 1/2) shifting below the expanded children. Child rectangles never extend outside the Scene's effective interval (they use the already-clipped range). Collapsed, the Timeline is pixel-for-pixel the Audio V1 Timeline.

## 16. Expand/collapse state boundary

Expansion is local `useState` inside `SceneTimeline`, keyed by Scene id — never saved to the draft, never sent to the API, and does not mark the draft dirty. Verified: expanding/collapsing Scene 3 left "Salvo" unchanged; reload does not restore expansion (by design — it is viewport state, not authored state).

## 17. Selection model

A third temporal selection context was added: selecting a child element row keeps the **owning Scene** selected, opens the Elementos tab, focuses that element's Camadas entry, and seeks the Live Player to the element's (global) start frame — reusing the existing Inspector grammar instead of adding a permanent global "Timing" tab.

## 18. Element Timing Inspector

A "Timing na cena" section appears under the selected element's existing spatial controls: start (s), end mode (**Até o fim da cena** / **Duração fixa**), duration (s) when fixed, a "Cena inteira" reset (clears the entry back to the implicit full-Scene default), and the clipped/outside warning when the current Scene duration cuts the authored range short. Seconds on screen, canonical frames persisted, via `setSceneElementTiming` / `resetSceneElementTiming`.

## 19. Live Player proof

On the real production draft, original Scene order, Scene 3 global 155–275:

| Global frame | Result |
| --- | --- |
| 154 | Scene 2, no leak |
| 155–169 | Scene 3, neither `quote` nor `callout` yet |
| 170 | `quote` + `tape1` enter (visually confirmed: paper + tape appear) |
| 199 | still no `callout` |
| 200 | `callout` enters (visually confirmed: green box appears) |
| 229 | `quote` still present |
| 230 | `quote` gone; root lower-third (135–225) also correctly gone by here |
| 274 | `callout` still present (last frame of the full-length render) |

Root lower-third (135–225) and B-roll (60–120) behaved exactly as their own independent root anchoring dictates, with no coupling to the Scene-internal timing feature.

## 20. Scene-boundary and root-coexistence proof

No Scene-internal element ever rendered outside its owning Scene's interval in any of the checks above (170/230/274 boundaries, plus the reorder proof in §8). Root B-roll, root lower-third and both root audio items were present at their absolute root positions throughout, in both the original order and the reordered draft — Scene hierarchy did not reinterpret them as Scene children.

## 21. AUDIO V1 coexistence and regression

Confirmed unaffected end to end. Two concurrent root audio items still coexist on the derived `audio-main` track with no persisted lane: the bed (`gain 0.6`, `fade_in 30`/`fade_out 45`, `end_anchor: sequence_end`) and the voice (`gain 1`, `fade 15/15`, `source_in_frame 60`, fixed `duration_frames 120`).

The two VPS renders in §22 give a direct, measured regression proof:

- **Bed correctly follows the new total duration.** In the full-length render its `duration_frames` is 275 (0–275); in the Scene-3-shortened render it is recalculated to 215 (0–215) — exactly the Audio V1 "follow whole video" contract reacting to the Scene retime, unrelated to element timing itself.
- **Voice item is unaffected** (`start_frame 90`, `duration_frames 120` in both renders — it fits inside 215 unchanged).
- **Audio levels are identical where the content is identical:** mean/max volume in the pre-voice window (1.5–2.5 s) and the bed+voice overlap window (4–6 s) matched to 0.1 dB between the two renders (−23.6/−13.6 dB and −15.3/−5.6 dB respectively in both). Only the bed's fade-out tail differs (−33.0/−19.9 dB in the 275-frame render's last 0.7 s vs. −37.8/−23.4 dB in the 215-frame render's last 0.3 s) — the expected effect of the fade envelope correctly re-proportioning itself to the shorter total, not a regression.

## 22. Real VPS execution and objective frame evidence

Two production VPS renders of draft `7b12b65d…`, on the new worker (after the operator's tarball update):

- **Render A** (`4e85ee7f-3da7-4508-bdba-096bec2a6752`) — original Scene order, full Scene 3 (4 s). Total 275 frames, 1080×1920, h264+aac, 9.216 s container duration. Frozen snapshot: Scene 3 `element_timing = [{quote,15,60},{tape1,15,60},{callout,45,75}]` (segment-local, already companion-expanded).
- **Render B** (`912f258b-858b-43e7-98f8-5886e0098714`) — Scene 3 retimed to 2 s. Total 215 frames, 1080×1920, h264+aac, 7.210667 s. Frozen snapshot: Scene 3 `duration_frames 60`; `element_timing = [{quote,15,45},{tape1,15,45},{callout,45,15}]` — both ranges clipped to fit the 60-frame Scene exactly as §9 predicted.

Extracted and visually inspected frames (both renders, both downloaded and probed with ffprobe/ffmpeg):

| Frame | Render | Observation |
| --- | --- | --- |
| 169 | A & B (byte-identical PNG, 957,632 bytes) | neither `quote` nor `callout`; lower-third visible |
| 170 | A & B (byte-identical PNG, 1,293,547 bytes) | `quote` + `tape1` present (identical in both — the entry point is untouched by the retime) |
| 199 | A & B | `quote` present, no `callout` yet |
| 200 | A & B | `callout` enters |
| 229 | A | `quote` present |
| 230 | A | `quote` gone; lower-third gone (past its own 225 root end) |
| 274 | A (last frame) | `callout` present |
| 214 | B (last frame, shortened) | **both** `quote` and `callout` still present — proving the clipped ranges (45 and 15 frames respectively) correctly reach exactly to the new Scene end instead of disappearing early or leaking past it |

No element leaked outside its owning Scene in either render; root B-roll/lower-third/audio behaved identically to their own independent contracts in both.

## 23. Output Player and Gallery

In production, the editor's "Ver vídeo renderizado" dialog loaded render B (`912f258b…`, `readyState 4`, `duration 7.210667`, matching the VPS output exactly) — the most recent execution for the draft. "Abrir na Galeria" opened the Gallery with "Vídeo renderizado / Novo vídeo" (status GERADA, Project "Portal Comunidades Alternativas", Production "Teste Timeline Portal") listed first, consistent with the Audio V1 precedent.

## 24. Regressions

- **Scene composition:** Motion, content, assets and layering for all three Scenes are unaffected by the timing feature (§5, §11).
- **Gate B root regression:** B-roll (root, 60–120/60–120 in both renders), lower-third (root, 135–225), absolute anchoring, and Scene reordering (§8) all behave exactly as before.
- **Audio V1 regression:** confirmed in §21 with matched dB levels.
- **Static regression:** confirmed in §14 with a fresh production PNG on the new worker.

## 25. Responsive

Checked at 1440/1024/768/390 in the local editor with Scene 3 expanded and a child element selected: no page-level horizontal overflow at any width; the Timeline scrolls internally (measured `scrollWidth` 612 px vs. `clientWidth` 274 px at 390, confirming the internal scroller carries the overflow instead of the page); the Inspector's "Timing na cena" section remained reachable and usable in the narrow/mobile flow.

## 26. Worker deployment

Worker files changed (verified against the export list, matching the commit diff exactly):

- `remotion/timeline/TemplateSegment.tsx` — extends `hiddenElements` with `inactiveElementIds(...)`.
- `remotion/timeline/frame-model.ts` — new `inactiveElementIds` pure function.
- `lib/creative/templates/template-definitions.ts` — additive `timing` metadata on 4 Quote-layout elements only (no behavior change by itself; only meaningful once the two files above read it).

The old worker does not run the app's zod validation at runtime, so it would have silently ignored `element_timing` and rendered every element for the whole Scene (safe but wrong) — which is why the safe order (worker updated, confirmed healthy, **then** push) was followed, per the mission's mandated deployment sequence.

- Local exported-worker smoke: a 90-frame 1080×1920 MP4 rendered successfully with the exported bundle before commit.
- Tarball: `content-studio-video-hierarchical-scene-timing-v1.tar.gz`.
- SHA-256: `522abb88817caef609089c4e2b5be4bc4d76c70ad87a1facf19aeffbad6f16a2c`.
- Operator confirmed the VPS updated and healthy before the push proceeded.

## 27. Database / schema changes

None. `VideoScene.element_timing` is additive optional JSONB inside the existing `video_drafts.scenes` column. No migration, no new table (`SceneTimeline`/`SceneTrack`/`ElementTiming`/`Track`/`Segment`/`Clip`/`NestedSequence` were all avoided as instructed).

## 28. Tests, typecheck, lint, build

- New `lib/creative/video-editor/__tests__/element-timing.test.ts`: 27 tests — old-Scene-no-timing full-Scene default, temporalizable/non-temporalizable resolution, local→global mapping, reorder preserving authored values, retime clipping/outside, Save/reload, visibility precedence, element-order independence, Motion independence, expansion-not-persisted/not-dirty (covered at the component level), deterministic child ordering, child geometry bounded to the Scene, root-item independence, Audio V1 row independence, and preview/render (segment payload) parity.
- Full suite: **94 files / 1230 tests pass.**
- `tsc --noEmit`: clean.
- `eslint .`: 0 errors; 42 pre-existing warnings, none in changed files.
- `pnpm build`: success.

## 29. Production smoke summary

Draft `7b12b65d-4d8a-4f33-9f65-0aedf961c6e9`, production URL `https://content.multihuman.com.br/creative-editor/video/7b12b65d-4d8a-4f33-9f65-0aedf961c6e9`:

- Retime proof (§9) and reorder proof (§8) both run against the real draft.
- Two VPS renders (§22), Output Player + Gallery (§23), Static regression (§14) all run in production after the operator's worker update.
- Final restored state, verified via read-only SQL and the editor UI: Scene 3 `duration: 4`, `element_timing: {quote:{start_frame:15,duration_frames:60}, callout:{start_frame:45}}`, draft "Salvo" (not dirty), Live Player total `00:09.16` (275 frames) — byte-identical to the state the mission started from.

## 30. Git state and excluded files

Feature commit `a34ba6161fcaeb42154c7139d28f825f40b14352` (`feat(video): add hierarchical scene element timing`) — local, `origin/main` and remote all equal; Vercel deployment `6676230734`, Production, state `success`.

Excluded from every commit in this mission: `next-env.d.ts` (incidental), `.env.local`, `.next/`, `infra/render-worker-runtime/dist/` (including the tarball), `.tmp/`, scratch scripts, and generated test media. Working tree is clean.

## 31. Remaining limitations

- Only the Quote layout is temporalizable today. Cover and List cannot be, without a Template change, because their distinguishing content (intro text, bullet list) is drawn directly from `content` and has no element identity to attach timing to.
- Child timing bars are click-to-select only; there is no drag-to-retime on the child row itself (the Inspector is the only way to change values) — a deliberate scope cut, not a bug.
- Live Player sync during active scrubbing/playback is approximate (HTML media element drift), exact when paused, and exact in the final render — the same characteristic already documented for Audio V1.
- No keyframes, curves, per-element animation, transitions, or captions were added, as scoped.

## 32. Verdict

**B — the mechanism is clean, proven and should stay in production, but is not ready to broaden without another explicit decision.** The hierarchical timing model held up under every proof this mission ran (reorder, retime, visibility precedence, root coexistence, Audio V1 coexistence, Static isolation, two real VPS renders with frame-level evidence). It was not forced to A because expanding it to Cover or List needs a real Template decision first — those layouts' distinguishing content is not element-backed today, so "just declare `timing` on more elements" does not work there without first giving that content a real element identity.

**Recommended next pressure:** before adding more layouts, decide whether fixed-layer text units (intro, bullets, sequence badge) should become real, addressable Template elements — that is the actual blocker to generalizing this feature, not the timing model itself. Audio ducking (flagged as the likely next audio pressure in Audio V1) is an unrelated, independent next candidate.

VIDEO_HIERARCHICAL_SCENE_TIMING_SPIKE_V1_COMPLETE

VERDICT: B
