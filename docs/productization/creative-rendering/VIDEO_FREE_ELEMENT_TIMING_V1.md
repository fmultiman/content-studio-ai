# VIDEO_FREE_ELEMENT_TIMING_V1

Scene-local timing for free-Scene Elements (text and Library image). A free Element can start after its Scene starts and end before it does. This reuses the existing `VideoScene.element_timing` map, keyed by the free Elements' stable ids.

It adds no new timing model, migration, Track per Element, second ruler/playhead/clock, or timeline version bump.

## 1. Checkpoints

- Start: `ea805c8913225adb402c85551ed2728a1b431b7c` (local = `origin/main` = remote, clean tree): the closure of VIDEO_FREE_SCENE_DIRECT_MANIPULATION_V1.
- Feature: `e777d7787907b74fc2a1abbc9c68159447329050` → Vercel Production `6684969817` success.
  - Pushed only after the operator updated the VPS with the tarball below.
- Fix: `1bb8d1d8b060d8e27b9a11c87e964d7725650873` → Vercel Production `6685185539` success (UI wording only, found during the production proof; §9; no worker file, so no tarball).
- **Worker changed** (`remotion/timeline/FreeSegment.tsx`), so the full worker order was followed: local gates → export → local exported-worker proof → local commit → tarball → operator VPS update → push.
- **No migration.**
- Final-SHA protocol: this doc is committed in the docs commit that closes the mission. Its SHA is printed by the next mission's housekeeping, the same way this mission printed `ea805c8…` into `VIDEO_FREE_SCENE_DIRECT_MANIPULATION_V1.md`.

## 2. Phase 0 findings (executing code)

| Question | Answer |
|---|---|
| Persisted timing contract | `VideoScene.element_timing: Record<elementId, { start_frame, duration_frames? }>`, Scene-local frames; no entry = the whole Scene. The API only checked its structure. |
| Renderer timing contract | Template segments carry `payload.element_timing: [{ element_id, start_frame, duration_frames }]` (Scene-local, already clipped). The renderer evaluates it with `inactiveElementIds(timing, localFrame)` from `frame-model.ts` (end exclusive). |
| Generic enough in the manifest? | The entry shape is. The `free` payload (`{ elements }`, strict) had no field for it. |
| Must `FreeSegment` change? | Yes. It drew every payload element for the whole segment. |
| Must the worker change? | Yes. `FreeSegment.tsx` and `frame-model.ts` are in the exported bundle, and the old worker would ignore the new field and draw elements for the whole Scene. The worker had to go first. |
| Timeline schema/version | Additive optional field only. It stays `timeline.v0` (no evidence for a bump). |
| Orphan timing ids today | Template reads ignore ids that aren't temporal elements of the layout (they fall back to whole Scene), and the API accepts them. Free Scenes refused any `element_timing`. |
| Template vs Free validation | Template ids come from Template-declared temporal capability (plus companions), with tolerant reads. Free ids come from the composition itself: every free element is temporal. Removal drops the entry atomically, so a free orphan is a malformed write and is **rejected**. Template validation is unchanged. |

A conversion from a timed Template Scene into a free Scene would leave orphans, but no such path exists: the editor creates a free Scene as a new Scene.

## 3. Persisted contract

It is the same field and the same shape as Template timing:

```json
"element_timing": {
  "<free element uuid>": { "start_frame": 30, "duration_frames": 30 },
  "<free element uuid>": { "start_frame": 0, "duration_frames": 75 }
}
```

- Keys are free element ids; the default (start 0, until the Scene ends) is stored as **no entry**, and an empty map is dropped.
- Timing is **not** inside `composition` or a box. Composition, boxes and paint order are untouched by timing edits.
- `setSceneElementTiming` gains a free branch that accepts any existing free id. It uses the same bounds as Template: whole frames, start ≤ the last Scene frame, and a fixed duration clamped to the current Scene end. `resetSceneElementTiming` is unchanged (it is generic).

## 4. Edit semantics

| Edit | Effect on timing |
|---|---|
| Hide / show (Elementos) | Preserved. **Hidden beats timing**: a hidden element is never drawn or targeted, whatever its range. |
| Remove element | Its entry is dropped **in the same edit** (`removeFreeElement`); the last entry drops the map. |
| Reorder elements (paint order) | Unchanged |
| Replace the LibraryFile | Unchanged (stable id) |
| Move / resize (Inspector or preview) | Unchanged |
| Reorder Scenes | Unchanged; only the global projection moves |
| Retime the Scene | Authored values kept. Effective ranges are clipped at the Scene end; a start at/after the end is "outside" (not drawn). Growing the Scene restores them. |
| Expand a Scene in the Timeline | View state only; never dirty |

## 5. Write boundary (API)

`app/api/video-drafts/route.ts` (`sceneCompositionErrorResponse`), used by POST and PATCH:
- The V1 refusal ("composição livre não tem timing de elementos nesta versão") is removed.
- Every Scene still passes the structural `validateSceneElementTimingShape`.
- A free Scene additionally must have no `orphanFreeTimingIds`. Otherwise it returns `400 SCENE_ELEMENT_TIMING_INVALID` ("timing para um elemento que não existe nesta cena.").
- Template Scenes are unchanged (tolerant).

## 6. Timeline projection (one ruler)

- `sceneHasTemporalElements(freeScene)` = the Scene has elements. `sceneTimingRows` returns free rows in **authored order**. It is derived and never stored.
- Rows use the same `SceneTimingRow` shape, the same child lanes and the same global ruler: `globalFrame = sceneStartFrame + localFrame`. There is no second playhead.
- Labels: the page passes `freeElementLabel`, the same names as the Elementos list: "Texto · <first line>" and "Imagem · <Library file name>". The pure default is "Texto · …" / "Imagem".
- Selecting a child row (or the new **"Timing na cena"** button in Elementos, or clicking an element in the preview) selects the element. The shared violet timing section follows that selection, and the playhead seeks to the element's start. "Oculto em Elementos" is shown for a hidden free element.

## 7. Neutral render payload and renderer

- `FreeSegmentPayloadSchema` gains `element_timing?: TemplateSegmentElementTimingSchema[]` (max 24), the **same entry schema** as Template segments. It is additive and optional.
- The adapter (`freeSceneToSegment`) adds it only when something is timed. It carries only **drawn** elements (hidden or empty-text elements are not in the payload, so neither is their timing), clipped to the segment. `0` duration = does not participate.
  - An untimed free payload is byte-identical to the previous shape.
- Diagnostics: `element_timing_clipped` / `element_timing_outside_scene` are reported for free Scenes the same way as for Template Scenes.
- Semantic validation (`invalid_element_timing`): no duplicate ids, every id names a drawn payload element, and `start + duration ≤ segment duration`.
- `FreeSegment.tsx`: `FreeSegmentFrame` is rendered inside the Sequence, so `useCurrentFrame()` is Scene-local. It skips `inactiveElementIds(payload.element_timing, localFrame)`. A skipped element keeps its paint slot, so stacking never shifts. `isolation: 'isolate'` is unchanged.
- There is no TemplateRef in the free payload and no persisted Remotion state. The Live Player and the frozen render snapshot receive the same entries.

Shape (production snapshot of render `b43ff0ad…`, free segment at 90+90):

```json
"element_timing": [
  { "element_id": "f20d2e3a-6844-4e55-8f78-7a7439a71f27", "start_frame": 0,  "duration_frames": 75 },
  { "element_id": "79e83fb6-88da-438b-8d25-5abf883f3df8", "start_frame": 30, "duration_frames": 30 }
]
```

## 8. Editor overlay (direct manipulation)

`FreeSceneOverlay` now takes its targets from `freeElementsActiveAt(scene, localFrame, sceneDuration)`, which applies the same rule the renderer applies (visible and inside the effective range, end exclusive). A target never points at something the Player isn't drawing. Inactive elements stay addressable through the Inspector and the Timeline row. The direct-manipulation geometry code is unchanged.

## 9. Proofs

**Local exported worker** (`export.mjs` bundle, `server.mjs` on :3467, local media): mixed 4:5 body. The free Scene is at 90–180 with image local 0–75 and text local 20–60, plus root B-roll, lower third and audio.
- Frames 100 (image only), 130 (both, root lower third above), 155 (text ended), 170 and 179 (neither), 180 (next Template, no leakage).
- Edges: text absent at 109 and present at 110; present at 149 and absent at 150; image present at 164 and absent at 165.
- Evidence: `evidence/video-free-element-timing-v1/local-exported-worker-frames-100-130-155-170-179-180.jpg` and `local-exported-worker-edges-109-110-149-150-164-165.jpg`.

**Tarball:** `content-studio-video-free-element-timing-v1.tar.gz`, SHA-256 `83e955200ae7b6e7cd305bdf6eb9b0c7067403700a369f33fc3cba2452cbe474` (75 entries, same file list as the previous `fix1`). The operator updated the VPS and reported the worker healthy; then `e777d77` was pushed.

**Production** (dedicated draft `55d449e0-b5c9-42c6-88e9-b95b1650688d`, "Teste · timing de elementos livres V1", 4:5). Scenes: Template Cover (0–90), free Scene with Library image + text (90–180), Template Citação with its own element timing (180–300). Root items: B-roll, lower third and 2 audio.
- **Write boundary:** a PATCH with a foreign free timing id returned 400 `SCENE_ELEMENT_TIMING_INVALID`, and nothing was written (`updated_at` unchanged).
- **Timeline:**
  - Scene 2 gained an expand chevron (the Cover has none, as before);
  - its rows were "Imagem · pack-a-005-illustration.jpg" and "Texto · Cena livre", in authored order, both full Scene;
  - expanding left "Salvo".
- **Authoring:**
  - text through its Timeline row: start 1.0 s, fixed 1.0 s → 04.00 → 05.00;
  - image through **"Timing na cena"** in Elementos: fixed 2.5 s → 03.00 → 05.50;
  - each edit dirtied the draft and moved the bars.
- **Save → database:** image `{0, 75}` and text `{30, 30}` under the free ids. The Citação `element_timing`, the 4 root items and the canvas were unchanged.
- **Hard reload:** identical rows and bars; "Salvo".
- **Preview targets (Selecionar):**
  - 89: none (Template hint);
  - 90–119: image only;
  - 120–149: image + text;
  - 150–164: image only;
  - 165–179: none;
  - 180: none (Template hint).
- **Live Player** (DOM inside the Remotion Player; the test tab does not paint pixels): exactly the same sets at 89/90/105/119/120/135/149/150/164/165/179/180. The root lower third is present from 120.
- **Scene reorder** (Timeline drag, free Scene → first):
  - bars shifted by exactly 90 frames with the same widths;
  - the Player drew text at 30–59, image through 74, and nothing at 75–89.
- **Scene retime:**
  - 3 s → 1.5 s: both rows "cortado no fim da cena"; the warning says the saved 1 s is kept; text drawn through 44 and nothing at 45;
  - back to 3 s: the original bars returned exactly.
- **Hide/show:**
  - hidden text: not drawn, no target, the row is dashed, "Oculto em Elementos…" is shown, and the range 01.00 → 02.00 is kept;
  - shown again: drawn and targeted again with the same range.
- **Remove** (after "Voltar ao salvo"):
  - the text row disappeared; after save, the database had only the image element and only the image's timing entry (no orphan);
  - the proof state was then restored through the API (text + `{30, 30}`).
- **VPS render** `b43ff0ad-9e57-4f35-8db5-100d0208f271` (tarball worker):
  - h264 1080×1350, 30 fps, 300 frames, AAC;
  - the frozen `input_snapshot` is `timeline.v0` with the free `element_timing` above, and the Citação's Template timing is unchanged;
  - frames:

    | Frame | Content |
    |---|---|
    | 89 | Cover |
    | 100, 119 | image only |
    | 120 | image + text |
    | 135, 149 | image + text under the root lower third |
    | 150, 164 | image only |
    | 165, 179 | free background + lower third only |
    | 180 | Citação |

  - Evidence: `evidence/video-free-element-timing-v1/vps-render-b43ff0ad-frames-89-100-119-120-135-149-150-164-165-179-180.jpg`.
- **Bug found and fixed** (`1bb8d1d`): the tooltip on a hidden free row said "oculto na cena (Camadas)". It now names Elementos for free Scenes (Camadas stays for Template).

## 10. Responsive

Fresh load per width; Timeline mode; free Scene expanded; text row selected.

| Width | Page overflow-x | Child rows | Timing section + inputs | Tool toggle | State |
|---|---|---|---|---|---|
| 1440 | none | 2 | reachable (04.00 → 05.00) | reachable | Salvo |
| 1024 | none | 2 | reachable | reachable | Salvo |
| 768 | none | 2 | reachable | reachable | Salvo |
| 390 | none | 2 | reachable | reachable | Salvo |

## 11. Static regression

The real 10-slide Carousel (`channel-pieces/1247e54b…/editar-visual`) opens with Canvas / Inspector and the TPL./CONT./ASSETS/ESTILO/ELEM. tabs. The canvas viewport is present, with no free overlay, tool toggle, timing section or Timeline, and no page overflow. No Static or shared-workbench file changed.

## 12. Tests and gates

- New `lib/creative/video-editor/__tests__/free-element-timing.test.ts` (50 tests):
  - persistence and authoring: default = no entry; foreign ids ignored on read and found for the write boundary; bounds; reset; hide/show; atomic removal; element reorder, LibraryFile replace and box edits keep timing; save-body round trip;
  - projection and participation: blank Scene has no rows; authored order; labels; global = start + local; hidden rows stay addressable; before/overlap/fixed end exclusive/Scene end; hidden beats range; Scene reorder; retime clip; outside and grow back;
  - neutral payload: untimed payload unchanged; clipped entries; hidden and empty text omitted with their timing; diagnostics; `timeline.v0` and no TemplateRef; schema; semantic rejection of foreign/duplicate/overlong entries; renderer arithmetic; Live Player = snapshot; root tracks independent; only drawn ids;
  - UI wording (Elementos for hidden free rows).
- `free-composition.test.ts`: the two legacy expectations ("free Scene has no timing rows", "API refuses free timing") now state the new contract.
- **Full suite:** 98 files / 1345 tests. `tsc --noEmit` clean. ESLint 0 errors (42 pre-existing warnings, none in changed files). `pnpm build` success.

## 13. Limitations

- Timing is edited in seconds (0.1 s steps) through the timing section; there is no drag/trim on the child bars yet (same as Template rows).
- There are no per-element enter/exit transitions; an element appears and disappears on its frame. Motion is still Scene-level.
- Hidden or empty-text elements keep their authored timing but carry none in the payload (they aren't drawn).
- A free timing id that names no element is rejected at the write boundary. Template ids stay tolerant, as before.

## 14. Final checkpoint

- Feature `e777d77…` → Vercel `6684969817` success; fix `1bb8d1d…` → Vercel `6685185539` success (production then showed "oculto na cena (Elementos)" on a hidden free row; the edit was discarded with "Voltar ao salvo").
- Final SHA: the docs commit recording this validation (printed by the next mission's housekeeping).
- Housekeeping done here: `VIDEO_FREE_SCENE_DIRECT_MANIPULATION_V1.md` now prints its final SHA `ea805c8913225adb402c85551ed2728a1b431b7c`.
- Production test data left: draft `55d449e0…` (timed proof state saved) and execution `b43ff0ad…`.
- Not committed: `.env.local`, `.next/`, `tsbuildinfo`, `next-env.d.ts`, `infra/render-worker-runtime/dist/` (including the tarball), `.tmp/`, scratch scripts and downloaded MP4s.
