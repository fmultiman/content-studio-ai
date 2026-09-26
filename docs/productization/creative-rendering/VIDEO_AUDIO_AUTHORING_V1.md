# VIDEO_AUDIO_AUTHORING_V1

This mission puts the first real multi-item temporal pressure on the Gate B model: **concurrent audio**. The target is a bed (music or ambience) plus a voice-over or second source, with independent timing, a source offset, per-item volume and per-item fades. It must preview in the Live Player and mix in the final VPS render, without persisting a Track.

## 1. Starting checkpoint

`aed2a63ae43db1e26def04b4dd6287fc5b0fba44` was equal on local HEAD, `origin/main` and remote `main`, with a clean tree. The previous chain was Single Writer → Scene Composition Parity → Gate B.

## 2. Phase 0 — factual audio audit (code before changes)

**Authored audio (Gate B):** `{ id, kind: 'audio', start_frame, duration_frames, library_file_id, volume }`.

- `validateVideoTimeline` rejects **any** same-kind overlap, including audio.
- Edits (`addTemporalItem`, `moveTemporalItem`, `resizeTemporalItem`) clamp against same-kind neighbours.
- The Timeline shows a single ÁUDIO lane.

**Neutral manifest (`timeline.v0`):**

- `AudioSegmentPayloadSchema` = `{ asset_ref, gain (default 1), source_in_frame?, source_out_frame?, fade_in_frames?, fade_out_frames? }`, all in integer frames.
- `validateTimelineSemantics` only checks unique ids, known track references, in-bounds timing and media source ranges. It has **no overlap rule per track**, so overlapping audio segments on one `audio` track are **already legal**.

**Renderer (worker tree):**

- `TimelineComposition` renders every segment of an `audio` track through `AudioSegmentLayer` = `<Sequence from durationInFrames><Audio src volume={gain}/></Sequence>`.
- Several mounted `<Audio>` elements are mixed by the engine; this is how Remotion mixes audio.
- Installed Remotion is 4.0.526 locally and 4.0.448 on the VPS. `Audio` supports a source offset (`startFrom`, renamed `trimBefore` in 4.x with the old name still accepted) and `volume` as a number or a per-frame callback (frame relative to the audio's own start).
- The worker `renderMedia` already emits AAC.

**Player:** the same `TimelineComposition` inside `@remotion/player` (its `AudioForPreview` accepts the same props).

| Concept | Authored today | Neutral manifest | Player | Renderer | Change needed |
|---|---|---|---|---|---|
| Concurrent audio | **no** (same-kind overlap rejected) | **yes** (overlapping segments on one track are legal) | yes (several `<Audio>`) | yes (engine mix) | domain: allow audio-audio overlap; UI: derived rows |
| Source in | no | yes `source_in_frame` | yes (`startFrom`) | yes (`startFrom`) | author + map + adapter prop |
| Source out | no | yes `source_out_frame` | yes | yes | **no** (placement duration + source in suffice) |
| Fade in / out | no | yes `fade_in_frames` / `fade_out_frames` | yes (volume callback) | yes (volume callback) | author + map + adapter envelope |
| Gain / volume | yes `volume` 0..1 | yes `gain` | yes | yes | no |
| Duration | yes fixed `duration_frames` | yes | yes | yes | no |
| Follow whole video | no (fixed number; clipped when shorter, short when longer) | n/a (resolved before the manifest) | n/a | n/a | author an explicit **end anchor** |
| Loop | no | no | engine has `loop` | engine has `loop` | **no** (out of scope) |
| Mute | no | track `muted` flag exists | — | — | **no** (volume 0 exists) |
| Waveform | no | no | — | — | **no** |
| Audio role | no | no | — | — | **no** (no behaviour needs it) |
| Routing / bus / track | derived single track | tracks are free-form | — | — | **no** (see §3) |

**Conclusion:** the neutral contract already expresses concurrent audio, source-in and fades, so **no schema change is needed**. The gaps are in the authored domain, in the UI, and in two adapter props (source offset and fade envelope) in the worker-bundled `IndependentSegments.tsx`.

## 3. Concurrency decision — no persisted lane

- **Two audio items mix; they do not stack.** Nothing about which row an audio item sits on changes the output: no routing, no bus, no track mute/solo/effects, no stacking.
- A persisted `lane` would therefore be authored data **with no output semantics**, so it is not added.
- **UI:** audio rows are a **projection**. `packAudioRows(items)` stable-sorts audio items by `start_frame`, then `id`. Each item goes on the lowest row whose last interval has ended (end-exclusive), and a new row opens only when overlap requires it. Rows are labelled ÁUDIO 1..n and can grow, shrink or reshuffle when items move.
- **Manifest:** one derived `audio-main` track carrying all audio segments (overlap is legal there). No row or track identity is ever written back to the VideoDraft.
- **Visual and text keep the Gate B rule** (one lane per kind, no same-kind overlap): two visuals *would* need authored stacking, and that is not solved here.

**Stop check (persisted lane):** no evidence of routing, buses, track mute/solo/effects, stable user grouping, or output semantics tied to a row. The stop condition was **not** met.

## 4. Final authored audio item

```ts
{
  id, kind: 'audio', start_frame,          // absolute root frame
  library_file_id, volume,                 // 0..1 (unchanged contract)
  duration_frames?: number,                // FIXED placement …
  end_anchor?: 'sequence_end',             // … OR ends with the primary sequence (exactly one of the two)
  source_in_frame?: number,                // frames into the source file (default 0)
  fade_in_frames?: number,                 // linear from silence (default 0)
  fade_out_frames?: number,                // linear to silence (default 0)
}
```

- Frames are at the canonical 30 fps, as everywhere in the timeline.
- **Timeline version stays `1`:** every Gate B value is still valid with the same meaning (fixed, no offset, no fades), and the new fields are optional and additive. Nothing is ambiguous, so no bump is needed.
- **No DB change:** it all lives in the existing `video_drafts.timeline` JSONB.

## 5. Semantics

- **Source in:** belongs to the item. Moving the placement or resizing it never changes it (tested). It maps to neutral `source_in_frame`, and the adapter passes it as the engine's source offset. There is no source-out: the placement duration bounds the playback.
- **Fades:** linear envelope `min(t/fade_in, (dur−t)/fade_out)` × `volume`.
  - For a **fixed** item, `fade_in + fade_out ≤ duration` is enforced by validation. Editing one fade caps it to fit, and resizing is floored at the fade total, so fades are never silently rewritten.
  - For an **anchored** item, whose length depends on the Scenes, the derived segment shrinks both fades proportionally when they no longer fit, and emits a `fade_clamped` diagnostic. The authored values stay.
  - **Crossfade** = two overlapping items, A fading out and B fading in. There is no crossfade object and the fades are not linked.
- **Volume:** unchanged (`volume` 0..1 → neutral `gain`). No mixer, dB automation, buses, ducking or normalization.
- **Fixed vs "Até o fim do vídeo":**
  - `end_anchor: 'sequence_end'` is the explicit intent; the effective end is the current end of the primary sequence, computed at derivation, and never stored.
  - Switching fixed → anchored drops `duration_frames`. Anchored → fixed freezes the current effective length, so nothing jumps.
  - Gate B items stay fixed and are never converted automatically. In the UI, the first audio added to a draft starts as an anchored bed; later audio is fixed at the playhead.
- **Source length (truthful):** "até o fim do vídeo" describes placement only. It does **not** loop, stretch or synthesize. If the file ends earlier, the rest is silence (the engine's behaviour). The Inspector shows a **non-persisted** hint from the browser's media metadata ("Arquivo: 12s") and warns when source-in + placement needs more than the file has. No media-duration persistence was added.

## 6. Timeline and Inspector UX

- **Rows:** B-roll and Texto keep one row each; audio shows **ÁUDIO 1..n** from `packAudioRows`. The row count grows and shrinks as items move (proven: a temporary third audio shared row 2, dragging it into an overlap created ÁUDIO 3, and removing it restored 2 rows).
- **Gestures:** drag moves the start; snap covers seconds, the playhead, Scene edges and item edges (row-agnostic), with Alt as bypass. The right edge resizes fixed items only.
- **Anchored items** show `⇥` and have **no** right-edge handle, so they cannot be resized into a misleading fixed length. Their mode changes only explicitly in the Inspector.
- **Audio Inspector:** file + Trocar, start, "Fim" (Duração fixa / Até o fim do vídeo), duration (fixed) or "Até o fim do vídeo · Xs", Início no arquivo, Fade in, Fade out, Volume, the file-length hint, and Remover.
  - Seconds are shown; frames are persisted.
  - No engine terminology appears.
- **Selection context:** selecting a Scene brings back Template/Conteúdo/Assets/Estilo/Elementos/Motion; B-roll and text keep their Gate B panels.

## 7. Live Player and final render mapping (one preparation)

Both run through the same chain: authored `scenes` + `timeline` → `buildRenderExecutionSnapshot` (same adapter) → neutral manifest → Live Player (`TimelineComposition` in `@remotion/player`) **and** render route → claim → worker (same `TimelineComposition`). A test asserts the preview manifest **equals** the render snapshot manifest for the two-source draft.

Engine details (`<Sequence>`, `<Audio startFrom volume={f => gain·envelope}>`) live only in `remotion/timeline/IndependentSegments.tsx`. A future engine needs only the neutral start / duration / source_in / gain / fade fields.

## 8. Worker

- **Changed file:** only `remotion/timeline/IndependentSegments.tsx` (+20/−2: source offset + fade envelope). No change to `TimelineComposition`, worker infrastructure or export list.
- **Package:** export 54 files; tarball `content-studio-video-audio-authoring-v1.tar.gz`, 56 entries, sha256 `483ccd326a75f3897a96b3cb83b222b9db546e71ca82ddeb736fd0e37e9aad79`, byte-identical to `f2fe38c`.
- **Local exported-worker proof** passed first (§9). The operator updated the VPS, then `f2fe38c` was pushed (Vercel Production success).

## 9. Real two-source proof

**Draft:** the real 3-Scene draft `7b12b65d…` (B-roll 60+60 and lower third 135+90 kept).

**Media:** two real Project LibraryFiles, **generated test media** uploaded through the Arquivos path:

- **Bed** `gateb-trilha-pad.mp3` (`03e92637…`, 10 s, 220/277/330 Hz chord). Anchored to the sequence end, volume 0.6, fade in 1.0 s, fade out 1.5 s.
- **Second source** `gateb-voz-teste.mp3` (`e7d9d8e5…`, 12 s: **880 Hz for source 0–2 s**, pulsed **1320 Hz from 2 s**). Fixed at 3.0–7.0 s (90+120), source-in 2 s, fades 0.5 / 0.5 s.

**Follow in the render:** for the proof render, Scene 3 was set to 3 s (sequence 275 → 245 frames). The bed followed to 0+245 with no edit to it. Scene 3 was restored to 4 s afterwards, and the bed followed back to 275.

**Production VPS render** `4abb682a-3d73-40d9-82c0-409e698f4160`: claimed 06:00:11, completed 06:01:51. Output: 245 frames h264 + aac, 8.21 s.

**Frozen snapshot:** tracks `video-main / video-broll / overlay-text / audio-main`; both audio segments on `audio-main`; bed `0+245 gain 0.6 fade 30/45`; voice `90+120 gain 1 source_in 60 fade 15/15`; **no URL, no signature**.

**Band-limited mean level of the rendered MP4 (dB; ffmpeg bandpass 60 Hz + volumedetect).** The local exported-worker render and the VPS render measured identically:

| Window | 220 Hz (bed) | 880 Hz (voice source 0–2 s) | 1320 Hz (voice after source-in) | Reading |
|---|---|---|---|---|
| 1.5–2.5 s, before the voice | −27.1 | −55.9 | −63.6 | bed only |
| 4.0–6.0 s, overlap | −26.7 | −37.8 | −16.1 | bed **and** voice mixed |
| 7.2–7.6 s, after the voice | −34.9 | −63.8 | −71.6 | bed only (already in its fade-out) |
| 0.0–0.2 s → 0.8–1.0 s | −71.4 → −32.3 | | | bed fade-in rises |
| 3.0–3.1 s → 3.4–3.5 s | | | −45.3 → −15.4 | voice fade-in rises |
| 6.4–6.6 s → 7.9–8.1 s | −24.7 → −44.2 | | | bed fade-out falls |

**Source-in:** during the overlap the 880 Hz band sits ≈22 dB below 1320 Hz. That is exactly the filter-leakage ratio measured on the source file itself where only 1320 Hz exists (−34.9 vs −13.1 dB). So the voice plays from 2 s into its file; without source-in, 3.0–5.0 s would be dominated by 880 Hz.

**Pictures:** frames 75/105 show the B-roll at source t=0.50 s and 1.50 s, frame 175 shows the lower third over Scene 3, and frame 240 shows Scene 3 alone.

**Live Player (production, after restore: 275 frames, 9.16 s).** Play from 0 while polling the player's non-placeholder `<audio>` elements:

| Timeline | Playing | Volume |
|---|---|---|
| 0–3.0 s | `gateb-trilha-pad` only | fade-in 0 → 0.60 |
| 3.0–7.0 s | `gateb-trilha-pad` **and** `gateb-voz-teste` | voice 0.07 at 3.03 s (its fade-in), then 1.00 |
| 7.0 s → end | `gateb-trilha-pad` only | 0.60 → 0.44 → 0.04 (fade-out) |

Paused at 4.07 s, the source positions were: bed at 4.07 s, voice at **3.07 s** (= 4.07 − 3.0 placement + 2.0 source-in). The preview applies the same source offset as the render.

**Output Player** plays `4abb682a…` (readyState 4, 8.21 s). The **Gallery** lists "Novo vídeo" first and its preview plays the same execution.

## 10. Regressions

- **B-roll and lower third:** unchanged (placement, crossing Scene boundaries, text above B-roll). Gate B tests all pass; the frames above confirm it.
- **Absolute anchoring:** Scene reorder moves no independent item (tested).
- **Scene composition:** unchanged (layouts/appearance/content/hero/element state visible in the frames; all parity tests pass).
- **Static, on the updated worker:** the 10-slide Carousel opens "Salvo". Slide 5 of 10 was navigated; Template/Conteúdo/Assets/Elementos are intact. **Gerar PNG** → `691e0612…` completed at 1080×1350.

## 10a. Responsive (production, Timeline mode, voice item selected)

| Width | Page overflow | Timeline | Audio rows | Audio Inspector (end mode, source-in, fades, file hint) | Dock collapse → restore |
|---|---|---|---|---|---|
| 1440 | none | 1171 px, fits | ÁUDIO 1 (bed ⇥), ÁUDIO 2 (voice) | side panel; all fields in view (2 s, 0.5 s, 0.5 s, "Arquivo: 12s.") | 184 → 0 → 184 px (Player grows to 707 px) |
| 1024 | none | 855 px, scrolls internally | both | side panel, in view | not run |
| 768 | none | 652 px, fits | both | stacked below, in view | not run |
| 390 | none | 274 px, scrolls internally | both | stacked below, in view | 165 → 0 → 165 px (Player grows to 523 px); 2 rows after restore |

The Timeline never widens the page; long content scrolls inside its scroller. The page was left at 1440 and "Salvo" (no unsaved edits).

## 11. Tests and gates

**New `lib/creative/video-editor/__tests__/audio-authoring.test.ts` (18 tests):**

- Gate B item defaults and "never follows by itself";
- overlapping audio valid, while visual overlap is still rejected;
- deterministic packing (order-independent, id tie-break, end-exclusive, re-pack on move, anchored bed);
- no row/lane/track persisted or accepted;
- one derived audio track with overlapping segments, resolver-valid;
- source-in/fade round-trip;
- move/resize preserve source-in/fades, and resize is floored at the fades;
- fade validation, capping and clearing, plus volume preservation;
- envelope math;
- one end authority (fixed ↔ anchored), follow recomputation after a Scene retime, nothing else rewritten;
- proportional fade clamp in the derived segment only;
- bed/voice creation defaults;
- row-agnostic snap;
- preview ≡ render manifest with both sources resolved;
- claim-time presign of both;
- adapter-only engine names.

**Updated:** one Gate B assertion (a second audio is now placed where asked, since audio mixes).

**Results:**

- `pnpm test`: 93 files / 1203 tests passed.
- Typecheck: clean.
- ESLint on changed files: clean.
- `pnpm build`: success.

## 12. Remaining audio limitations and deferred decisions

- No loop or time-stretch: an anchored bed longer than its file ends in silence.
- No source-out, waveform, ducking, mixer, buses, per-track mute/solo, EQ/compression/normalization/LUFS, or keyframed or curved envelopes.
- No audio role (music/voice/sfx). It is deferred until a behaviour such as ducking needs it; ducking is the most likely next audio pressure.
- Row assignment is projection only. If users ever need to *place* audio on a chosen row (routing/grouping), that would be the first real evidence for a persisted lane.
- B-roll source trim and multi-layer visual stacking remain out of scope.
- The Live Player keeps HTML audio elements in sync with the timeline within the player's drift tolerance. Paused and seeked positions are exact; during playback element clocks can briefly lead or lag. The final render is frame-exact.

## 13. Final checkpoint

- **Feature:** `f2fe38ca5dbb54310f85ec4f81ee8e09c09a2ba5` (Vercel Production success).
- **Final SHA:** the docs commit recording this validation, verified on local, `origin/main` and remote `main`, with its Vercel Production deployment.
- **Migration:** none. **Timeline version:** still `1`.
- **Worker:** updated by the operator to sha256 `483ccd32…ad79` before the push.
- **Test data left in place:**
  - the draft `7b12b65d…` with the bed (anchored) and the voice;
  - LibraryFiles `664a9e53…` / `03e92637…` / `e7d9d8e5…` (generated test media);
  - executions `4abb682a…` (video) and `691e0612…` (static).
- **Not committed:** `.env.local`, `.next/`, `tsbuildinfo`, the incidental `next-env.d.ts` change, `infra/render-worker-runtime/dist/` (including the tarball), `.tmp/` renders, browser data, scratch scripts, and the generated media sources.
