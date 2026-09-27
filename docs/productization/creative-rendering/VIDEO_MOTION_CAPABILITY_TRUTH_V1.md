# VIDEO_MOTION_CAPABILITY_TRUTH_V1

Makes the current Video Scene Motion authoring surface truthful to renderer capability. The user is never offered a Motion choice that the current composition cannot visibly render as authored.

This is **Scene Motion only** — the behavior of the whole Template-backed composition, interpreted by the active Layout. It is not Element Motion (a future, Element-scoped preset system — `VIDEO_ELEMENT_MOTION_PRESETS_V1`), not a Transition, and it does not touch Timing (`element_timing`), the root timeline, or audio.

- **Migration: NONE.**
- **Worker: UNCHANGED.**
- **Render contracts: UNCHANGED** (one additive `case 'fade'` in an app-only adapter function; every existing case, and every schema, is untouched).

## 1. Checkpoint

- **Start:** `0228908fdf96e3955a1f1458e0c157e86e95d5eb`, equal on local, `origin/main` and remote `main`. Closure of CREATIVE_EDITOR_TRUTHFUL_CONSTRAINTS_CLEANUP_V1.
- **Foreign file:** `docs/productization/creative-rendering/VIDEO_AUDIO_AUTHORING_V1.md` carries a pre-existing foreign one-line edit, left untouched and never staged.
- **Implementation:** `15a6df74613cb402bc3c7cf0580ca915291c7fef` → Vercel Production `dpl_EB4Vq8wRYGXD3q2s5k324oV958MB`, READY, aliased to `content.multihuman.com.br`.
- **Final SHA:** `e822c0bc38ce96d4792b9dbe7d4e9a162ec6388c`

## 2. Factual movement matrix (executing code at `0228908`, before any change)

Traced end to end: Inspector (`motionOptions`) → authored `VideoScene.movement` → `movementToMotion` (adapter) → `TemplateSegmentPayload.motion` (neutral manifest) → `TemplateSegment.tsx` → `DocumentaryCard`/`CoverVariant` (the SAME component Live Player and the final render both consume — confirmed shared via `adaptVideoDraftToTimelineManifest`, used by both `live-preview-input.ts` and `build-snapshot.ts`).

| Value | In `MOVEMENT_LABELS` (old) | `movementToMotion` preset | Diagnostic | Renderer draws it | Which Layout | What moves | Legacy prod data |
|---|---|---|---|---|---|---|---|
| `static` | yes | `none` | none | nowhere (no-op by design) | — | nothing | 28 Scenes |
| `zoom_in` | yes | `slow_push` | none | **Cover only** | Cover | Hero image `AssetSurface`, `scale(1 → 1.06)` over the Scene | 8 Scenes (all Cover/Quote — 2 were on Quote, `not-drawn` there) |
| `pan_left/right`, `tilt_up/down` | yes | `slow_pan` (+direction) | none | **nowhere** — no Layout variant file implements `slow_pan` | — | nothing | 1 Scene (`pan_left`, real draft `7b12b65d…`, Lista layout) |
| `zoom_out`, `dolly` | yes | `none` (unmapped) | `movement_no_preset_equivalent` | nowhere | — | nothing | 0 |
| `fade` | **no — not in the old vocabulary at all** | **no case; fell to default → `none` + diagnostic** | (before this mission) | **every Layout, unconditionally** (`DocumentaryCard.tsx` root `opacity` fade-in + every variant's `fixedText` opacity/translateY) | all 8 | Whole card opacity `0→1` over the first ⅙ of the Scene, plus each variant's own text elements | 0 (unreachable) |
| `rise`, `reveal` | not offered | not mapped | n/a | not implemented anywhere | — | — | Dormant entries in `MotionPresetSchema` only; never reachable through any movement value. Left untouched. |

**Renderer-effective capability, factually derived:**

| Layout | Real, visible Scene Motion options |
|---|---|
| **Cover** | Estático, Fade, Zoom In |
| Info, List, Grid, Map, Network, Quote, Closing | Estático, Fade |

This matches the mission's expected shape exactly (`§17`).

**Other facts established in Phase 0:**
- `editorial.quote-card` (a separate renderer registry entry declaring `motion_presets: ['none','fade']`) is **not reachable from Video Scene authoring** — used only by fixtures/tests, never by the one registered authoring Template family. Not part of this mission's surface.
- `movement: string | null` is completely unvalidated at persistence (`lib/types.ts`, the write route). Any string can already be stored; `movementToMotion`'s `default` branch has always handled an unknown value safely (→ `none` + diagnostic). No new validation was needed for legacy safety.
- Adapter diagnostics (`movement_no_preset_equivalent`, etc.) are not surfaced anywhere in the editor UI today, and this mission does not add that — a bounded, dedicated legacy notice was added instead (§4).
- `validateTemplateMotion` (template registry) already rejects any preset not in the Template's declared `capabilities.motion_presets`; `fade` was already declared there, so making it authorable needed no descriptor change.
- `git log -S "motion?.preset === 'fade'"` on `DocumentaryCard.tsx` finds exactly one commit, `74e5687` (2026-09-22, part of `HEAD`'s ancestry, long predating every worker tarball since). The fade-drawing code has been live on the VPS worker continuously; no worker file needed to change for fade to become drawable.

## 3. Core rule implemented

The Motion tab now derives its options from **real current capability**, not a global list with a warning:

- Cover → `Estático`, `Fade`, `Zoom In` — three buttons, no annotation.
- Every other Layout → `Estático`, `Fade` — two buttons.
- No "sem efeito visível" badge exists anymore. An unsupported value is **absent**, not advertised.

## 4. Capability metadata

**Location:** `lib/creative/video-editor/video-authoring.ts` (app-only — confirmed **not** in `infra/render-worker-runtime/export.mjs`'s `REQUIRED_WORKER_SOURCE`, unlike `lib/creative/templates/template-definitions.ts`, which **is** worker-bundled). Placing the capability table here, rather than as a new field on the registry's `TemplateLayoutDefinition`, means zero worker-bundled files changed.

```ts
const UNIVERSAL_SCENE_MOTION: readonly string[] = ['static', 'fade']

const LAYOUT_SCENE_MOTION: Readonly<Record<string, readonly string[]>> = {
  cover: ['zoom_in'],
}

export function motionOptions(layoutId: string = 'cover'): MotionOption[] {
  const values = [...UNIVERSAL_SCENE_MOTION, ...(LAYOUT_SCENE_MOTION[layoutId] ?? [])]
  return values
    .filter((value) => movementToMotion(value).diagnostic === null)
    .map((value) => ({ value, label: movementLabel(value) }))
}
```

- **Narrow:** one table, one entry (`cover`). Not a generic capability engine.
- **Code-backed:** no database persistence.
- **Cross-checked:** every offered value is filtered through the real `movementToMotion` mapping, so the list can never silently drift from what the adapter actually produces — even a mistakenly declared capability would be dropped rather than offered.
- **Scene/Layout-scoped, not Element-scoped:** the table is keyed by Layout id and describes the composition's own behavior. Naming (`LAYOUT_SCENE_MOTION`, not just `MOTION`) keeps this distinct from the future, separately-scoped Element Motion concept.

**Legacy display stays separate.** `MOVEMENT_LABELS` (all 9 historical values, now including `fade`) and `movementLabel(value)` are the truthful label lookup for *any* value ever authored — used by the Scene Strip card summary (`motionLabel` prop) and by the Motion tab's legacy notice. `motionOptions` (the *offered*, capability-derived list) and `movementLabel` (the *display*, legacy-safe lookup) are deliberately two different functions.

## 5. Fade

**Decision: make it authorable.** Phase 0 proved the renderer already draws it correctly, deterministically, on every Layout (§2). No second implementation was built.

**The only adapter change** (`lib/creative/timeline-adapter/video-draft-to-timeline.ts`):

```ts
case 'fade':
  return { motion: { preset: 'fade' }, diagnostic: null }
```

Added as one new `case` in `movementToMotion`. `pan_left`/`pan_right`/`tilt_up`/`tilt_down`/`zoom_out`/`dolly` cases are **byte-for-byte unchanged** — they are no longer *offered*, but their mapping is untouched, so an already-authored legacy Scene produces the exact same frozen manifest content it always has.

**Proven end to end** (`lib/creative/video-editor/__tests__/motion-capability-truth.test.ts`, and production, §8):
- Save → reload: `movement: 'fade'` round-trips through the save body unchanged (a plain string field).
- The frozen manifest segment (the one both Live Player and the final render consume) carries `motion: { preset: 'fade' }`.
- Resolves validly through `validateTemplateMotion` (fade is a declared, not invented, capability).
- `TemplateSegment → DocumentaryCard`, rendered via `renderToStaticMarkup` at Scene-local frame 0 vs frame 45 of a 90-frame Scene, produces root `<main>` opacity `0` then `1` — on **both** Cover and List, proving the universal claim, not just asserting it.

## 6. Legacy behavior

- **Never destructively migrated.** No SQL, no bulk rewrite, no backfill.
- **Safe to load.** `buildRenderExecutionSnapshot`/`resolveTimelineManifest` on a Scene with `movement: 'pan_left'` does not throw and resolves validly (the historical `slow_pan` mapping, unchanged).
- **Truthfully displayed, never silently rewritten.** When the authored value is not in `motionOptions(layoutId)`, the Motion tab shows a bounded amber notice naming the real value (via `movementLabel`) and explaining it has no effect and is no longer offered — **without** pretending it is one of the checked radio options (none is checked, since none of the offered values match).
- **Replacement works normally.** Clicking a real option is the same `patchSelectedScene({ movement: option.value })` as before; no special-casing.
- **An unknown/garbage value** still resolves safely through the existing `default` branch (`none` + diagnostic) — unchanged, still never a crash.

## 7. Scene Motion vs future Element Motion vs Transitions

- **Scene Motion** (this mission): the whole Template-backed composition's behavior, chosen per Scene, interpreted by the active Layout. Unchanged conceptually — only its *offered vocabulary* and *fade's reachability* changed.
- **Element Motion** (future, out of scope): a bounded preset system for one selected addressable Element (entrance/exit/continuous categories). `LAYOUT_SCENE_MOTION` is deliberately named and scoped so it cannot be mistaken for, or grown into, an Element-scoped table. No Element selection was added to the Motion tab.
- **Transitions** (out of scope, not implemented, not faked): a fade *inside* one Scene is not a Scene-to-Scene transition. No crossfade, wipe, or transition object was introduced anywhere.

## 8. Production proof (`15a6df7`, READY)

**Template Cover Scene** (draft `7fe4cf8e…`, Scene 2, Cover):
- Motion tab showed exactly `Estático` / `Fade (entrada suave)` / `Zoom In (aproximação lenta)`, no annotation, no legacy notice, `Estático` checked.
- Selected `Fade`; the draft went dirty; "Salvar" (save-only, no render) → clean.
- Hard reload: `Fade` still checked, still clean.
- **Live Player:** clicking the Scene 2 strip card (its exact start) showed the card's computed `opacity: 0`. Scrubbing the Timeline ruler to mid-Scene showed `opacity: 1`. The fade is genuinely live in the DOM, not just in the frozen manifest.
- **Final render** (`db4f91e4-03e5-4fec-a0f7-44a858a0bbb6`, completed, 1080×1920, 180 frames): the frozen snapshot's segment 1 (Scene 2) carries `payload.motion = {"preset":"fade"}`. Frames 90/95/100/105/150 extracted from the real MP4 show the card visibly fading in from black to fully visible — `evidence/video-motion-capability-truth-v1/vps-fade-db4f91e4-frames-90-95-100-105-150.jpg`.

**Different Layout (List), same draft:**
- Switching Scene 2 to `Lista` and reopening Motion showed exactly `Estático` / `Fade` — no `Zoom In`. `Fade` stayed checked (still authored, still universally supported).
- Reverted with "Voltar ao salvo"; back to Cover, clean.

**Legacy — real production draft `7b12b65d-4d8a-4f33-9f65-0aedf961c6e9`, read-only:**
- Scene 2 (Layout **Lista**, authored `movement: 'pan_left'`) showed the legacy notice: *"Esta cena tem **Pan Esquerda** autorado, mas essa opção não tem efeito visível em Lista e não é mais oferecida para novas cenas. Escolha uma das opções abaixo para substituí-la."*
- The radiogroup showed `Estático` / `Fade`, **neither checked**.
- The draft stayed clean throughout (never saved). Confirmed via `video_drafts.updated_at` (unchanged, predates this session) and `scenes[1].movement` (still `pan_left`) — no mutation.

**Free Scene — draft `7fe4cf8e…`, Scene 1:**
- Motion tab: no radiogroup, unchanged copy ("Cenas livres são estáticas nesta versão: o movimento de cena só existe nas cenas com template. Para quando cada elemento aparece, use Timing na cena (Elementos)."). Clean.

## 9. Responsive (production, fresh load per width, Motion tab)

| Width | Page overflow-x | Options shown | All reachable |
|---|---|---|---|
| 1440 | none | 3 (Estático, Fade, Zoom In) | yes |
| 1024 | none | 3 | yes |
| 768 | none | 3 | yes |
| 390 | none | 3 | yes |

## 10. Tests and gates

**New:** `lib/creative/video-editor/__tests__/motion-capability-truth.test.ts` (25 tests): capability map per Layout, static determinism, real-movement renderer proof (rendering `TemplateSegment→DocumentaryCard` via `renderToStaticMarkup` at two frames, plus a source-scan confirming only `CoverVariant.tsx` references `slow_push` and `DocumentaryCard.tsx`'s fade check is unconditional on `variant`), fade persistence/reload/manifest, legacy safety (the same `pan_left`/List case as production), mode (Template vs Free), and regression (Timing/root timeline/Static untouched; no worker/migration/schema file touched).

**Updated:** `scene-composition.test.ts`, `live-preview-and-authoring.test.ts`, `video-draft-to-timeline.test.ts` (added a `fade` mapping test and extended the "every mapped movement resolves" regression list), and the M2 guard test in `truthful-constraints-cleanup.test.ts` (which asserted Motion was untouched by M2 — now updated to assert M3 delivered it, per that test's own stated purpose).

| Gate | Result |
|---|---|
| Focused Motion tests | 25/25 |
| Full suite | 103 files / 1434 tests |
| `tsc --noEmit` | clean |
| ESLint | 0 errors, 42 warnings (unchanged baseline) |
| `pnpm build` | success |

## 11. Files changed

- `lib/creative/timeline-adapter/video-draft-to-timeline.ts` — one added `case 'fade'`.
- `lib/creative/video-editor/video-authoring.ts` — capability table, `motionOptions` rewritten to the truthful/filtered contract, `movementLabel` added, dead `motionEffect`/`MotionEffect`/`PRESET_LABELS` removed.
- `app/(dashboard)/creative-editor/video/[draftId]/page.tsx` — Motion tab simplified (no effect badges), legacy notice added, `motionLabel` prop now uses the exported `movementLabel` directly.
- Tests listed in §10.

No file under `infra/`, `scripts/`, `lib/schemas/`, or `lib/render-execution/` changed.

## 12. Limitations

- Only Cover has a declared layout-specific capability today (`zoom_in`). Adding a second Layout-specific effect (e.g. drawing `slow_pan` on some Layout) is future renderer work, not blocked by this metadata shape.
- `rise`/`reveal` remain dormant, unreachable schema entries — left untouched, as no evidence justifies removing or implementing them.
- Element Motion, keyframes, easing, transitions and a Motion timeline remain explicitly out of scope, per mission boundary.

## 13. Production data left intentionally

- Draft `7fe4cf8e-4d98-4824-98d4-2fff5958bfed`: Scene 2 (Cover) now authored with `movement: 'fade'` (saved); render execution `db4f91e4-03e5-4fec-a0f7-44a858a0bbb6`.
- The real legacy draft `7b12b65d-4d8a-4f33-9f65-0aedf961c6e9` was **not modified** (read-only proof, confirmed via `updated_at`).

VIDEO_MOTION_CAPABILITY_TRUTH_V1_COMPLETE
