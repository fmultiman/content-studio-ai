# VIDEO_TIMELINE_GATE_B_INDEPENDENT_TEMPORAL_COMPOSITION_V1

Architecture gate plus a working product spike. The question it answers: **what is the minimum persisted authoring model for independent temporal content**, meaning content whose timing is not a Scene's duration?

## 1. Starting checkpoint

- `44bbdfa11ceaa1381a16aca9426432c2da381007`, equal on local HEAD, `origin/main` and remote `main`, with a clean tree.
- Previous state (VIDEO_SCENE_COMPOSITION_PARITY_V1): a Scene is an authored composition plus a duration, persisted in `VideoScene` JSONB. The root Timeline is the contiguous primary Scene sequence.

## 2. Phase 0 — factual temporal map (executable code, before any change)

| Layer | What exists | Track? | Segment? |
|---|---|---|---|
| **Authoring truth** | `video_drafts`: `id, user_id, project_id, production_id, name, scenes jsonb, created_at, updated_at`. `scenes[]` = `VideoScene` (duration, movement, composition, hero). **No other temporal field, no metadata column.** | no | no |
| **Derived timeline** | `adaptVideoDraftToTimelineManifest` → `TimelineManifest` (`timeline.v0`): **one** track `video-main`, one `template` segment per Scene, contiguous `start_frame` from array order + duration | derived contract | derived contract |
| **Neutral contract (capability)** | `TimelineManifestSchema` already has `tracks[]` of kind `video/audio/overlay/caption` with `order`, and segment kinds `template`, **`media`** (asset_ref, source in/out, fit, transform), **`audio`** (asset_ref, gain, source in/out, fades), **`text`** (text, role incl. `lower_third`), `caption`, plus a manifest-level `assets` map. Validation checks unique ids, known track refs and in-bounds timing. **Overlap is already expressible.** | neutral contract | neutral contract |
| **Resolution** | `resolveTimelineManifest` resolves only `template` segments and the manifest `assets` map (library_file → placeholder URL); `prepareTimelineLibraryFileAssets` presigns only template-segment slots | — | — |
| **UI timeline** | `SceneTimeline` (Timeline Lite): one lane of Scene blocks. Geometry derived from frames; zoom, scroll, drag, snap and playhead are viewport state | UI projection (one lane) | UI projection |
| **Render timeline** | `TimelineComposition`: renders `template` segments of `video`/`overlay` tracks by track order; **ignores** `media`, `audio`, `text` | renderer grouping | renderer object |
| **Media** | `LibraryFileKind` = image/video/audio/document/other. Arquivos uploads any file and classifies it by MIME; S3 presign knows mp4/mp3; the listing signs every kind. **But** `adaptLibraryFileToResolvedAsset` accepts `image` only. The test Project and the whole DB contain **no audio or video file yet** | — | — |
| **Worker** | exported Remotion tree (`TimelineComposition`, `TemplateSegment`, `DocumentaryCard`…) with `renderMedia` h264 (+ an AAC track, silent today). `server.mjs` passes `resolvedInput` through untouched. Claim loads **all** project LibraryFiles (any kind) and presigns the manifest's library_file refs | — | — |
| **Live Player** | `@remotion/player` isolated in `remotion/player/LiveTimelinePlayer.tsx`; product code imports only its controller type | — | — |

Conclusions:

- **Track and Segment exist today only as a neutral/derived render contract and a renderer grouping.** They are not persisted domain concepts, and the UI shows a single primary lane.
- No old `/videos` concept remains relevant: that writer was removed in VIDEO_DRAFT_SINGLE_WRITER.

## 3. Phase 1 — candidate authority models

| Criterion | A. Scene owns nested items | B. VideoDraft owns independent items (typed, flat) | C. VideoDraft owns persisted Tracks → Segments | D. Typed collections per kind (`brolls[]`, `texts[]`, `audios[]`) |
|---|---|---|---|---|
| Crosses Scene boundaries | **no**: an item is clipped by, or has to be re-parented to, its Scene | yes | yes | yes |
| Audio spans whole draft | no (would live in Scene 1 and overflow it) | yes | yes | yes |
| B-roll moves independently | no (moving it changes its owner) | yes | yes | yes |
| Scene reorder understandable | items silently travel with Scenes (this is anchoring by accident) | explicit anchor semantics | explicit | explicit |
| Save/reload | yes (scenes JSONB) | one additive JSONB column | one column (Tracks JSONB) or tables | one column |
| Clean manifest derivation | awkward (item start = Scene start + offset, overflow) | direct: item → segment, kind → track | direct | direct |
| Same truth for Player and render | yes | yes | yes | yes |
| Forces Track as a domain entity | no | **no** (lane = derived from kind) | **yes**, before any evidence needs user-managed tracks | no |
| Future source in/out | per item | per media item (kind payload) | per segment | per collection |
| Engine-neutral | yes | yes | yes | yes |
| Second source of truth | no | no | risk: Tracks duplicate what `kind` already says | no, but three shapes to validate/order/select |

**E. (smaller)** Represent B-roll or lower thirds as Scene Elements with timing fields. **Rejected:** that is exactly the element-with-hidden-timing the mission forbids, and it cannot cross a Scene boundary.

## 4. Decision

**Model B.** VideoDraft owns one list of independent, typed temporal items next to `scenes`. This adds one column, `video_drafts.timeline jsonb` (nullable), holding authored root temporal state:

```ts
timeline: {
  version: 1
  items: Array<{
    id: string                  // stable authored identity
    kind: 'visual' | 'text' | 'audio'
    start_frame: number         // int ≥ 0, absolute root-timeline frame (30 fps)
    duration_frames: number     // int ≥ 1 (placement duration, NOT a source trim)
    // kind payload
    // visual: { library_file_id, fit?: 'cover' | 'contain' }        B-roll over the primary Scene
    // text:   { text, style: 'lower_third' }                       one bounded presentation
    // audio:  { library_file_id, volume: 0..1 }
  }>
}
```

- **Why one column:** `scenes` is a JSONB array, so a root field cannot be added without reshaping it. This is the same factual constraint migration 035 met for Static (`template_id`). One additive, nullable column is sufficient. There are no new tables: no Track table, no Segment table, no Clip table.
- **Why not persisted Tracks (C):** nothing in the proof needs user-created or reordered tracks. A lane is fully determined by `kind` (B-ROLL = visual, TEXTO = text, ÁUDIO = audio). Persisting Tracks would duplicate `kind` as a second, divergent truth.
- **Why not per-kind collections (D):** the items share one temporal envelope (id, start, duration) and the same timeline gestures (select, move, resize, delete, snap). One list with a `kind` discriminator is smaller to validate, sort and edit, and a new kind stays additive.
- **Why not Scene-nested (A):** it cannot represent crossing a Scene boundary or whole-draft audio, which are the core of Gate B.

**Invariants:**

- **One authoring truth:** `scenes` (primary sequence) + `timeline.items` (independent layer), both in the same VideoDraft row and saved by the same PATCH.
- **`TimelineManifest` stays derived:** it is built on demand for preview and for render, and never persisted as authoring.
- **Nothing viewport-related is persisted:** zoom, scroll, px/s, selection and playhead are UI state.
- **No engine types are persisted:** no Remotion Sequence, Series, interpolation or component names. Frames are the canonical unit because `timeline.v0` already is.

## 5. Track verdict

**Track is a derived projection, not an authored entity.**

- In the UI, lanes are derived from item kind: PRIMÁRIO (Scenes), B-ROLL, TEXTO, ÁUDIO.
- In the manifest, tracks are derived: `video-main`, `video-broll`, `overlay-text`, `audio-main`, with a deterministic `order`, emitted only when used.
- One lane per kind, and items of the same kind may not overlap. That keeps stacking deterministic without a persisted row index.
- **Productization trigger for persisted track semantics:** two concurrent items of the same kind (music under a voice-over, two stacked B-rolls). The smallest evolution would be an item-level `lane` integer, still not a Track entity.

## 6. Segment verdict

- **"Segment" is not a Content Studio domain concept.** It is the neutral render contract's term. The domain concept is an **independent temporal item**: a common temporal envelope (`id`, `kind`, `start_frame`, `duration_frames`) plus a kind-specific payload.
- Items **map** to manifest segments: visual → `media`, text → `text`, audio → `audio`. The mapping is 1:1 but the concepts are not the same: authored anchoring, validation and UI live in the domain, while the manifest carries only resolved placement.

## 7. Primary Scenes

Primary Scenes stay special and unchanged. They remain the contiguous narrative sequence and own their composition and duration. They are not flattened into generic clips.

## 8. Anchoring semantics and Scene reorder

- **Chosen anchor: ABSOLUTE timeline frames.** An item's `start_frame` and `duration_frames` are its own. Reordering, adding, removing or retiming primary Scenes changes **what is under** an item, never **where** the item is.
- **Why absolute first:** it is the only anchor that serves all three proof items. Whole-draft audio and a B-roll deliberately spanning two Scenes have no single owning Scene. A Scene-relative anchor would make crossing a boundary ambiguous (which Scene owns it?).
- **Scene-relative anchoring is deferred:** `{ scene_id, offset }` is the natural anchor for a lower third that labels one Scene. It would be an additive `anchor` field on an item, not a new structure. Boundary/range anchors are deferred with it.
- **Shortening the primary sequence:** an item past the new end is **clipped in the derived manifest** (dropped if it starts after the end), with a diagnostic. The authored item is never rewritten. The Timeline marks the sequence end and flags such items.
- **Proven in the browser:** Scene 3 was moved first and shortened to 1 s. The Scenes became 0+30, 30+90, 120+65 (185 frames), while the B-roll (60+60), lower third (135+90) and audio (0+275) kept their frames, and the two items past the end were flagged. "Voltar ao salvo" restored everything.

## 9. B-roll model

| Question | Answer |
|---|---|
| Who owns the LibraryFile reference? | the item (`library_file_id`, identity only, never a URL) |
| Who owns the start? | the item (`start_frame`, absolute) |
| Who owns the duration? | the item (`duration_frames`, placement, not a trim) |
| Replace or overlay? | **overlays** the primary Scene full-frame for its interval (`fit` cover or contain); the Scene keeps playing underneath |
| Stacking | above the primary track (track order 1), below text (order 2) |
| Live Player | same `TimelineComposition`; the media URL comes from the signed Library listing |
| Final render | neutral `media` segment → presigned `resolvedAssets[asset_ref]` at claim → `<Sequence>` + `<OffthreadVideo muted>` (or `<Img>` for images) |
| Source media | plays from its **source start**; its sound is muted (sound belongs to audio items). **Source in/out is deferred** (§14). |

`LibraryFile` ≠ temporal item: the file is media identity; the item is placement.

## 10. Lower-third / text model

- A `text` item (`style: 'lower_third'`, `text` ≤ 120 characters, with an optional second line after a line break). It has one bounded presentation: identity typography on a dark band with a gold rule, plus a short fade in/out.
- It is **not** a Scene Element and not another Scene: it has its own timing, sits on the overlay track (order 2, above B-roll) and crosses Scene boundaries.
- **Captions:** not productized. The envelope could carry caption text, but captions have very different density and authoring (many short timed lines, transcript sync). They likely need their own item kind or artifact, which the neutral `caption` segment and the manifest's `captions` binding already anticipate. Lower-third semantics must not be stretched to cover them.

## 11. Audio model

- An `audio` item: `library_file_id` (a renderable audio file), `start_frame`, `duration_frames`, `volume` 0..1.
- By default it is added at 0 with the whole primary sequence as its duration (continuous bed). Afterwards it is independent: it does not follow later Scene changes.
- It renders as `<Sequence>` + `<Audio volume>`, and `render_intent.audio` becomes true.
- No waveform, fades UI, envelopes, ducking, mixer, EQ or effects.

## 12. LibraryFile / media boundary

- Real media came in through the existing product upload path (Arquivos: presign → PUT → `POST /api/library-files`, kind derived from MIME).
- `adaptLibraryFileToResolvedAsset` now accepts a **bounded** set: raster images (not SVG), `video/mp4|webm|quicktime`, and common audio containers. **Template slots stay image-only**, enforced where they are prepared; Static snapshots already only accept image MIME types.
- The API rejects timeline media that is outside the draft's Project, trashed, not renderable, or the wrong kind for the item. The render route re-checks before enqueueing.
- No Library redesign.

## 13. Stacking

Visual z-order is **track order**, not Timeline row order:

1. primary Scene (`video-main`, 0);
2. B-roll (`video-broll`, 1);
3. text overlay (`overlay-text`, 2).

Audio (`audio-main`, 3) has no picture. The Timeline's lane order happens to match, but it is layout only. `TimelineComposition` sorts tracks by `order` and paints in that DOM order inside one stacking context. The Scene card's `isolation: isolate` keeps its internal z-indexes from leaking.

## 14. Source in/out (deferred)

- The neutral `media`/`audio` segments already have `source_in_frame`/`source_out_frame`, but the authored model does **not** expose them.
- Placement duration ≠ source trim. A video item plays from its first frame for `duration_frames`; the render proof shows the burned-in source clock at t=0.50 s and t=1.50 s at item-local frames 15 and 45.
- A future trim adds `source_in_frame` to visual/audio items (additive), with no slip/slide tooling.

## 15. Transitions (analysis only)

- A cut between two primary Scenes is a property of that **boundary**: it needs both neighbours and moves with reorder.
- The neutral contract already models it as `transition_out` on a segment (an A→B boundary property), not as a free-floating object.
- Fades in and out of an independent item (B-roll in/out) are item-local.
- **Recommendation:** Scene-to-Scene transitions as a boundary property derived from `scenes`, and item fades as item properties. **No independent transition object is needed** for either. Not implemented.

## 16. Nested Scene timeline (analysis)

- Independent root items **reduce** the need for a nested Scene view. Everything proven here (timing that differs from a Scene's own duration) lives on the root timeline with absolute anchoring.
- A nested view would only become necessary for **intra-Scene element timing** (e.g. the title enters 1 s after the hero). That is Element motion and remains unresolved (Element ≠ Track).
- Not implemented: no nested ruler, playhead or tracks.

## 17. TimelineManifest mapping

**No schema change was needed.** `timeline.v0` already had the tracks, segment kinds and manifest-level `assets` the proof needed.

| Authored item | Track | Manifest segment | Manifest asset |
|---|---|---|---|
| `scenes[]` (unchanged) | `video-main` (order 0) | contiguous `template` segments | hero AssetRef in the segment |
| `visual` | `video-broll` (1) | `media { asset_ref, fit }` | `assets["library_file:<id>"] = { type, ref, fit }` |
| `text` | `overlay-text` (2) | `text { text, role: 'lower_third' }` | — |
| `audio` | `audio-main` (3) | `audio { asset_ref, gain }` | `assets["library_file:<id>"]` |

**Details:**

- Tracks are emitted only when used, so a draft without items produces exactly the pre-Gate-B manifest (tested).
- `render_intent.audio` follows the presence of audio items.
- The neutral resolver validates the overlap. Manifest-level assets are presigned at claim time (and taken from the Library listing in the Live Player).
- There is no persisted manifest, no Supabase or UI concept, no URL (verified in the frozen snapshot: no `https`, no `X-Amz`) and no engine name.

## 18. Live Player mapping

- The editor passes the in-memory `timeline` together with the `scenes` into `buildLivePreviewInput`, and from there into the same snapshot builder the render route uses. A test asserts the preview manifest **equals** the render snapshot manifest.
- The Player (`@remotion/player`, isolated in `remotion/player/`) paints the same `TimelineComposition`.
- **Editing an item's timing updates the Live Player immediately** with no render. Seek probes at frames 30/75/100/145/170/240 matched the authored ranges: B-roll over Scene 1 **and** Scene 2, lower third in Scene 2 **and** Scene 3, audio tags mounted.

## 19. Final render mapping

The path is unchanged: saved VideoDraft (scenes + timeline) → render route (validates media, freezes the snapshot, validates the manifest) → `render_executions` → claim (project-scoped LibraryFiles, presign manifest assets) → `ResolvedTimelineInput` → worker `TimelineComposition` → Remotion/Chromium → MinIO → Output Player / Gallery. No new renderer was added.

## 20. Engine-neutrality boundary

- **Authored:** `timeline.items` hold Content Studio concepts only (kind, frames, LibraryFile id, text, volume). A test checks the domain module has no `remotion` import, and that the manifest JSON carries no engine names.
- **Engine detail:** `<Sequence>`, `<OffthreadVideo>`, `<Img>` and `<Audio>` live only in `remotion/timeline/IndependentSegments.tsx`.
- A different preview or render engine would consume the same neutral manifest. No multi-engine framework was built.

## 21. Persistence and backward compatibility

- **Storage:** `video_drafts.timeline` (JSONB, nullable), migration `scripts/036_add_video_draft_timeline.sql`. It is additive and re-executable, and was applied to production before the web deploy (the old web code ignores the column).
- **Legacy drafts:** `NULL` means no items. There is no read migration, and drafts without items produce the same save snapshot and manifest as before.
- **PATCH:** it writes `timeline` only when the body includes it, so a client that omits it never wipes the layer.
- **Never persisted:** zoom, scroll, px/s, selection, playhead, the dock, and the TimelineManifest. The stored value (§25) contains only the three authored items.

## 22. Timeline UX

- **TIMELINE view:** the existing Timeline Lite plus three lanes (B-roll, Texto, Áudio) under "Cenas", a label gutter, and "+ B-roll / + Texto / + Áudio" buttons.
- **Adding:**
  - B-roll/Áudio open the existing Project Library picker (images/video, or audio, with renderable MIME types only);
  - Texto is created at the playhead;
  - audio defaults to the whole sequence.
- **Editing:** select, drag to move (keeping duration), drag the right edge to resize. Snap covers whole seconds, the playhead, Scene boundaries and other item edges, with Alt as bypass. Proven: a drag snapped to the Scene edge at frame 90, and an Alt drag returned exactly to frame 60 unsnapped.
- **Inspector:** selecting an item switches it to a bounded item panel (start/duration, kind payload, "Trocar", fit, volume, remove, "Voltar à cena") with no Scene tabs mixed in. Selecting a Scene switches back.
- **CENAS** stays the simple narrative mode: no items shown there.

## 23. Tests

**New `lib/creative/video-editor/__tests__/temporal-items.test.ts` (19 tests):**

- backward compatibility (read, derived manifest, save body/snapshot);
- independent timing and overlap, including cross-Scene B-roll and lower third plus whole-draft audio;
- derived tracks and paint order, with no URLs or engine names;
- neutral resolver acceptance;
- clipping without rewriting;
- absolute anchoring under reorder;
- lane edits (free placement, bounded move/resize, remove, update);
- item snapping;
- save round-trip;
- rejection of invalid temporal state (including non-authored fields such as `zoom`, `manifest`, `track_id`);
- media refs and the API/render-route wiring;
- preview manifest ≡ render snapshot manifest, plus preview media resolution and missing-asset reporting;
- claim-time presigning and the image-only template guard;
- bounded renderable MIME types;
- renderer track-order dispatch and worker export inclusion.

**Updated string pins:** `static-parity.test.ts` (Inspector chosen by selection context) and `video-editor-surface.test.ts` (the save body carries the timeline).

**Results:**

- `pnpm test`: 92 files / 1185 tests passed.
- Typecheck: clean.
- ESLint on changed files: clean.
- `pnpm build`: success.

## 24. Worker

- **Changed renderer files:**
  - `remotion/timeline/TimelineComposition.tsx`: paints all segment kinds by track order.
  - `remotion/timeline/IndependentSegments.tsx` (new).
  - Plus the list entry in `infra/render-worker-runtime/export.mjs`.
- **Unchanged:** worker infrastructure (`server.mjs`, coordinator, entrypoint, container).
- **Package:** export 54 files; tarball `content-studio-video-timeline-gate-b-v1.tar.gz`, 56 entries, sha256 `c3801c362e9106d522952517037d7361dbe67aca51ec7006ba002e47fd0ac526`; renderer files byte-identical to `8b20f41`.
- **Local proof:** the exported `server.mjs` rendered the real draft through the real claim chain (`resolveRuntimeInput`): 1080×1920, 275 frames, h264 + aac (`evidence/video-timeline-gate-b-v1/local-exported-worker-frames.jpg`).
- **Deployment order:** the operator updated the VPS worker first, then `8b20f41` was pushed (Vercel Production success).

## 25. Real browser validation

**Setup:**

- Real Project "Portal Comunidades Alternativas".
- Real 3-Scene draft `7b12b65d…`: Cover·Light / Lista·Dark / Citação·Light, 90 + 65 + 120 frames, Scene boundaries at 90 and 155.
- Two real Project LibraryFiles created through the Arquivos upload path:
  - `gateb-broll-arquivo.mp4` (`664a9e53…`, 5 s H.264, generated test clip with a burned-in source clock);
  - `gateb-trilha-pad.mp3` (`03e92637…`, 10 s generated chord pad).
- Both are labelled test media, not editorial footage.

| # | Check | Result |
|---|---|---|
| 1 | Existing 3 Scenes still render | yes (Live Player + VPS MP4) |
| 2 | TIMELINE shows the primary sequence | 0+90, 90+65, 155+120 |
| 3–5 | B-roll, text, audio visible | three lanes; items `visual@60+60`, `text@135+90`, `audio@0+275` |
| 6–7 | Select each type → contextual Inspector | item panel per kind (no Scene tabs); selecting a Scene brings the Scene tabs back |
| 8 | Drag the visual item | 60 → 87 (unsnapped at that distance), back to 60 with Alt; a later drag snapped to the Scene edge (90) |
| 9 | Resize a duration | lower third 90 → 116 frames by its right edge (then set back) |
| 10 | Lower third across a Scene boundary | 135–225 crosses 155 |
| 11 | Audio spans every Scene | 0–275 |
| 12–14 | Save → reload → exact | API `timeline` identical before/after reload; UI identical; "Salvo" |
| 15 | Scene composition unchanged | `scenes` byte-identical before/after |
| 16 | Reorder semantics | items kept absolute frames (§8); discarded with "Voltar ao salvo" |
| 17 | Scrub | seeks to 30/75/100/145/170/240 matched the authored ranges |
| 18–19 | Play across a boundary with an item active | production, window painting: 2.30 → 2.76 s (Cover + B-roll, audio playing) → 4.76 s (Lista + lower third; B-roll ended at 4.0 s) → 5.76 s (Citação + the **same** lower third, which crossed 5.17 s while active); audio playing throughout |
| 20–21 | Temporal zoom / horizontal scroll | unchanged Timeline Lite zoom; lanes live in the same horizontally scrolling content |
| 22 | Dock collapsed / normal / expanded | "Recolher painel" → 0, "Expandir painel" → restored; CENAS and TIMELINE give identical dock/viewport/Player sizes (the lanes do not grow the dock) |
| 23 | No viewport state persisted | stored `timeline` = 3 items with frames/ids/text/volume only |
| 24 | No TimelineManifest persisted | `video_drafts` has only `scenes` + `timeline`; the manifest exists only in `render_executions.input_snapshot` (a render record, as before) |

## 26. VPS render proof (production)

**Execution `5210bf77-9d6e-43b3-b0c2-2678cc26a044`:** queued 04:17:48, claimed 04:17:55, completed 04:19:37. Output: 1080×1920, h264 + aac, 275 frames, 9.216 s, 4.6 MB.

**Frozen snapshot (read-only SQL):**

- tracks `video-main:0`, `video-broll:1`, `overlay-text:2`, `audio-main:3`;
- segments `media@60+60`, `text@135+90`, `audio@0+275`;
- Scenes `cover/list/quote`;
- assets = LibraryFile identities only;
- `render_intent.audio: true`;
- **no `https`, no `X-Amz`**.

**Frames (evidence `evidence/video-timeline-gate-b-v1/vps-render-frames.jpg`):**

| Frame | Content |
|---|---|
| 30 | Scene 1 |
| 75 | B-roll over Scene 1, source clock t=0.50 s |
| 105 | B-roll after the Scene 1→2 cut, t=1.50 s |
| 145 | Scene 2 + lower third |
| 175 | Scene 3 + the same lower third |
| 240 | Scene 3 alone |

The timing matches authored frames exactly. The output duration is the primary sequence (275 frames).

**Audio continuity:** mean volume −23.8 / −18.7 / −20.2 / −17.6 dB at 0.5–1 s, 2.7–3.3 s (across the 3.0 s cut), 4.9–5.5 s (across the 5.17 s cut) and 8–8.5 s.

**Output Player and Gallery:** the Output Player plays execution `5210bf77…` (readyState 4, 9.216 s). The Gallery lists "Novo vídeo" first, and its preview plays the same execution.

![VPS render frames](evidence/video-timeline-gate-b-v1/vps-render-frames.jpg)

## 27. Regressions

- **Scene composition:** layout, appearance, content, hero assets, hidden/ordered elements, Motion and duration are unchanged in the snapshot and visible in the MP4 frames (Cover·Light with the eyebrow, Lista·Dark with the CIP page, Citação with its quote and callout). Scene selection, save/reload and the Live Player are covered by §25. All VIDEO_SCENE_COMPOSITION_PARITY_V1 tests pass.
- **Static, on the updated worker:** the 10-slide Carousel opens "Salvo". Slide 4 of 10 was navigated; Template/Conteúdo/Assets/Elementos are intact. **Gerar PNG** → static execution `063a149b…` completed at 1080×1350 in ≈ 10 s.
- **Responsive (production, painting window):** at 1440 / 1024 / 768 / 390 there is no page-level horizontal overflow; the Timeline fits the viewport and its controls are reachable; the 3 lanes and 3 items are present and scroll horizontally inside the Timeline. At 390 the Timeline is a safe fallback (reachable, scrollable), not a desktop NLE.

## 28. Known limitations

- Items of the same kind cannot overlap (one lane per kind). Music under a voice-over, or two stacked B-rolls, need an item-level `lane` first.
- Anchoring is absolute only; Scene-relative anchors are deferred (§8).
- There is no source in/out; video plays from its start and is muted (§14).
- There is one lower-third presentation; no styling controls.
- The audio item does not auto-extend when Scenes grow later; it is clipped when they shrink.
- The proof media are generated test files uploaded through the real product path.

## 29. Rejected over-generalizations

- A persisted Track entity or table.
- A generic Segment table/entity in the domain.
- A Clip table.
- Scene-nested timing.
- Lower third as a Scene Element.
- Transition objects.
- Persisted TimelineManifest.
- A multi-engine framework.
- Waveforms, mixer, keyframes.
- Captions via lower thirds.

## 30. Gate B verdict

**B. MODEL NEEDS ONE BOUNDED DOMAIN EVOLUTION — and that evolution is now in place.**

The minimum independent temporal authority is proven end to end: authored, persisted, reloaded, previewed, derived to the unchanged neutral manifest and rendered on the VPS.

The one domain evolution required was a single additive root field, `video_drafts.timeline` (typed items with absolute frames). No Track, Segment or Clip entity was needed, and `timeline.v0` needed no change. With it applied, the current model extends cleanly: productization needs no further architectural change. The remaining work is product scope: lanes per kind, anchors, source trim, captions.

## 31. Recommended next mission

**VIDEO_AUDIO_AUTHORING_V1.** The proof exposed exactly one structural gap that real use hits first: a second concurrent audio item (voice-over over music) is impossible under one-lane-per-kind. Audio is also the most common independent layer.

Smallest scope:

- an item-level `lane` for audio;
- per-item fade in/out;
- audio "span the whole video" semantics that follow Scene retiming;
- source in for audio.

B-roll and overlay productization can follow on the same envelope.

## 32. Deferred questions

1. Scene-relative / boundary anchors: when does a lower third follow its Scene?
2. Multiple same-kind lanes: an item `lane` field vs a persisted track.
3. Source in/out for video and audio.
4. Caption artifact model.
5. Scene-boundary transitions as a derived property.
6. Intra-Scene element timing (the only real driver for a nested Scene view).
7. Whether audio should auto-follow the total duration.

## 33. Final checkpoint

- **Feature:** `8b20f411fee4eaaf8f7c92a13241a8a5a348b223` (Vercel Production success).
- **Final SHA:** the docs commit recording this validation, verified on local, `origin/main` and remote `main`, with its Vercel Production deployment.
- **Migration:** `036_add_video_draft_timeline` applied to production (additive, nullable).
- **Worker:** updated by the operator with the renderer-only change (§24).
- **Not committed:**
  - `.env.local`, `.next/`, `tsbuildinfo`, the incidental `next-env.d.ts` change;
  - `infra/render-worker-runtime/dist/` (gitignored, including the tarball);
  - `.tmp/` renders, browser data, scratch scripts, and the generated test media sources (removed from `public/` after upload).
