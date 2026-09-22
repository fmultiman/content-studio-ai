# Wave 6 — Authoring Preview Proof

## Verdict

**Gate 6: PASS_WITH_CONSTRAINTS**

The Wave proves that a user can see and adjust a Documentary Card in a live preview
using the same DocumentaryCard component tree that produces the final PNG. The authoring
state is properly separated from the manifest contract: visal tuning never enters a
`StaticRenderManifest` and all content overrides can derive a valid manifest through the
Wave 5 path.

---

## Objective

Prove:

```
AuthoringState → live preview → same DocumentaryCard tree
                              → same resolution boundary
                              → final render compatibility
```

The authoring lab is intentionally narrow: it is not a generic canvas editor or
Figma-like tool. It demonstrates that the architecture can support live authoring
before a more complete authoring UI is built in a later phase.

---

## Route

Evolved from the Wave 4 spike: `/dev/creative-preview`

- **Outside** the `(dashboard)` layout tree — no Supabase shell, no authentication
- Static segment — renders as a client component without any server-side dependencies
- Not integrated into the main navigation; this is a technical dev surface

### Environment / Supabase status

There is no `middleware.ts` at the repository root in this worktree. The route is
not blocked by authentication. No `.env.local` is required to load this page.

---

## Authoring State

Defined in `lib/creative/authoring/types.ts`:

```typescript
interface AuthoringState {
  variant: 'cover' | 'info'
  identity: 'a' | 'b'
  canvas: 'portrait' | 'reel'   // 1080×1350 | 1080×1920
  heroRef?: AuthoringHeroRef     // override; undefined = fixture default

  contentOverride: AuthoringCoverContent | AuthoringInfoContent

  // Preview-only — NEVER serialised into a StaticRenderManifest
  tuning: DocumentaryCardPreviewTuning

  // UI-only ephemeral state
  debugPanelOpen: boolean
}
```

The state is managed by a `useReducer` in the page component. It is never
persisted, saved, or sent to any API.

---

## Preview Tuning Shape

```typescript
interface DocumentaryCardPreviewTuning {
  hero: {
    offsetX: number   // px, clamped ±120
    offsetY: number   // px, clamped ±120
    rotation: number  // degrees, clamped ±4
    scale: number     // dimensionless, clamped 0.9–1.15
  }
  title: {
    offsetX: number   // px, clamped ±60
    offsetY: number   // px, clamped ±60
    rotation: number  // degrees, clamped ±2
  }
}
```

`DEFAULT_TUNING` is all-zero / scale=1. When `previewTuning` is absent or equal to
`DEFAULT_TUNING`, the component renders exactly as the Wave 5 still would.

The tuning is passed to `DocumentaryCard` via an optional `previewTuning` prop added
in Wave 6. `CoverVariant` applies it as a CSS `transform` on the outer `PaperPlane`
containers for hero and title, keeping the existing motion/scale pipeline untouched.

---

## UI Structure

```
┌── Header (component resolver status, debug toggle) ─────────────────────────┐
│ Left panel (260px)          │ Center (flex 1)  │  Right: debug (300px, opt.) │
│                             │                  │                              │
│  Source / Fixture           │  Live preview    │  Current tuning (JSON)      │
│   variant                   │                  │  Derived manifest (JSON)    │
│   identity                  │   same DC tree   │  Resolution diagnostics     │
│   canvas                    │                  │  Transparency proof         │
│                             │                  │                              │
│  Content editing            │  preview label   │                              │
│   (textareas per field)     │  + scale info    │                              │
│                             │                  │                              │
│  Hero Asset (cover only)    │                  │                              │
│   checkerboard = alpha      │                  │                              │
│                             │                  │                              │
│  Visual Tuning              │                  │                              │
│   sliders (bounded)         │                  │                              │
│   Reset tuning              │                  │                              │
└─────────────────────────────┴──────────────────┴──────────────────────────────┘
```

---

## Preview / Render Component Parity

**Critical:** the preview does NOT use `@remotion/player` / `<Thumbnail>`. It renders
`DocumentaryCard` directly with a CSS `transform: scale(...)` wrapper to fit in the UI.

This is stronger proof of parity than the Wave 4 approach: the exact same React component
tree is rendered in the browser preview and in the Remotion still adapter. There is no
intermediate representation or approximation.

```
Browser preview: <DocumentaryCard {...cardProps} />
Wave 5 render:   <StaticRenderManifestStillComposition> → documentaryCardPropsFromResolvedInput → <DocumentaryCard ...>
```

Both go through `resolvePreviewInput` → `documentaryCardPropsFromResolvedInput` → `DocumentaryCard`.

---

## Controls Available

| Control | Type | Notes |
|---------|------|-------|
| Variant | select | cover / info |
| Identity | select | A (Comunidades Alternativas) / B (Acme Labs, neutral) |
| Canvas | select | 1080×1350 / 1080×1920 |
| Content fields | textarea | variant-specific fields |
| Hero asset | clickable card | cover only; 2 fixtures |
| Hero offsetX/offsetY | slider | ±120 px |
| Hero rotation | slider | ±4° |
| Hero scale | slider | 0.9–1.15 |
| Title offsetX/offsetY | slider | ±60 px |
| Title rotation | slider | ±2° |
| Reset content | button | returns to fixture default |
| Reset tuning | button | returns all sliders to zero/1 |
| Show/hide debug | button | toggles right panel |

---

## Manifest Boundary

`deriveManifestFromState(state: AuthoringState): StaticRenderManifest`

Produces a `StaticRenderManifest` from the persistable authoring fields only.

**Excluded from the manifest:**
- `tuning` (all tuning fields)
- `debugPanelOpen`
- Preview scale/zoom

The derived manifest can be fed directly into the Wave 5 render path
(`resolveStaticRenderManifest` → `renderStill`).

The debug panel shows the derived manifest JSON and confirms visually that no
tuning values appear in it.

---

## Asset Switching and Transparency Proof

Two hero fixtures are available:

| Asset | Type | Alpha | UI indicator |
|-------|------|-------|-------------|
| `documentary-card-hero-01.webp` | WebP | **opaque** (by design) | solid grey square |
| `acme-labs-hero-01.svg` | SVG | **transparent** | checkerboard square |

The UI uses a repeating checkerboard background pattern to represent transparent
assets. A solid grey square represents opaque assets. This provides visual proof
that the authoring layer correctly distinguishes alpha-backed from opaque material,
consistent with the programmatic verification from Wave 5 (sharp metadata check).

The debug panel lists `torn-paper-cream-01.png` and `tape-kraft-01.png` as
alpha-verified with real alpha, and `documentary-card-hero-01.webp` as opaque
by design — matching the Wave 5 execution record.

---

## Identity Switching

Identity A and B resolve through exactly the same `resolvePreviewInput` function
with no branch by project name. The `VisualTokensSnapshot` differs (different
colors, typography) but `component_key` = `'editorial.documentary-card'` in both.
This is verified by two independent tests (`identity switch changes tokens, not
the component_key` and `authoring module neutrality`).

---

## Browser Verification

The route is accessible at `/dev/creative-preview` without authentication. Since
there is no root middleware in this worktree and the route is outside the dashboard
segment, it loads without any Supabase dependency.

Manual verification in the in-app browser confirmed:
- Page renders without error
- Variant/identity/canvas selects update the preview
- Content textareas update immediately without reload
- Hero asset selection switches the displayed asset
- Tuning sliders move the paper planes in real time
- Reset buttons restore defaults
- Debug panel shows the manifest JSON without tuning fields
- Checkerboard indicates transparent hero (Acme Labs SVG)
- Solid grey indicates opaque hero (WebP archival)

---

## Tests

```
lib/creative/__tests__/authoring-state.test.ts  — 31 tests
```

Coverage:
- `createInitialAuthoringState` defaults
- `DEFAULT_TUNING` is neutral (all zeros, scale=1)
- `defaultContentForVariant` per variant and identity
- `resolvePreviewInput` resolves cover/info, identity A/B, canvas 4:5/9:16
- Content overrides appear in resolved input; no hero for info
- `deriveManifestFromState` produces valid manifest without tuning fields
- Ephemeral UI state (`debugPanelOpen`) excluded from manifest
- `clampTuningValue` bounds for offsetX/Y, rotation, scale
- Component resolver returns the same function for the authoring lab as for the Wave 5 render
- `AUTHORING_HERO_ASSETS` entries resolve through fixture resolver
- Neutrality: no Portal literals in tuning defaults; both identity A/B use same component key

The Wave 1 isolation test (`renderer-isolation.test.ts`) was updated: its sanity check
previously required `@remotion/player` to be imported in the preview page. The Wave 6
approach (direct DocumentaryCard rendering) no longer needs the Remotion player, so
the check was updated to confirm `DocumentaryCard` is used and `@remotion/player`
is not imported — demonstrating stronger isolation than before.

---

## Validation

| Check | Result |
|-------|--------|
| Focused Wave 6 tests | 31/31 PASS |
| Suite complete | **419/419 PASS** (baseline 388 + 31 new) |
| Typecheck | PASS |
| Lint | 0 errors / 45 warnings (unchanged) |
| Build | PASS |
| Protected areas | unchanged |
| `.tmp/` | gitignored |
| No credentials | confirmed |

---

## Files Created / Modified

**New:**
- `lib/creative/authoring/types.ts` — `AuthoringState`, `DocumentaryCardPreviewTuning`, `HeroTuning`, `TitleTuning`, `AuthoringHeroAsset`, content types
- `lib/creative/authoring/authoring-state.ts` — state factory, `resolvePreviewInput`, `deriveManifestFromState`, bounds, clamp
- `lib/creative/authoring/index.ts` — barrel export
- `lib/creative/__tests__/authoring-state.test.ts` — 31 focused tests

**Modified:**
- `components/creative/documentary-card/types.ts` — added `previewTuning?: DocumentaryCardPreviewTuning` to `DocumentaryCardProps`
- `components/creative/documentary-card/DocumentaryCard.tsx` — pass `previewTuning` through context
- `components/creative/documentary-card/CoverVariant.tsx` — apply hero/title tuning as CSS transform
- `app/dev/creative-preview/page.tsx` — replaced Wave 4 Thumbnail with full 3-panel Authoring Lab
- `lib/creative/__tests__/renderer-isolation.test.ts` — updated Wave 1 sanity check for Wave 6 design

---

## Constraints and Deferred Work

- No persistence, undo/redo, or autosave
- Fact card editing exposed only through content initialisation (the `fact_cards` array is not
  individually editable in the UI; it resets with `Reset content`)
- Drag interaction for hero not implemented (sliders sufficient for Gate 6)
- No LibraryFile / S3 integration
- No Project Identity persistence
- No Font Catalog / resolver
- No timeline editor

---

## Gate 6 — Checklist

| Criterion | Status |
|-----------|--------|
| Preview technical funcional | ✓ |
| Same DocumentaryCard tree as render | ✓ |
| cover/info selecionáveis | ✓ |
| Identity A/B selecionável | ✓ |
| Canvas 4:5/9:16 selecionável | ✓ |
| Content mínimo editável | ✓ |
| Hero move/rotate/scale via tuning limitado | ✓ |
| Reset funciona | ✓ |
| Tuning NÃO contamina manifest neutro | ✓ (tested) |
| Transparent assets inspecionáveis visualmente | ✓ (checkerboard + debug panel) |
| Nenhum banco/persistência | ✓ |
| Baseline sem regressão relevante | ✓ (419/419, 0 errors lint, build PASS) |

---

## Recommendation for Wave 7

Wave 7 has two natural candidates:

1. **Timeline Preview Proof** (parallel to this Wave but for video): prove that a
   `TimelineManifest` can feed a live preview of a `ResolvedTimelineInput` through
   the same DocumentaryCard tree with motion, using the same authoring pattern.

2. **Authoring State Persistence / Export**: prove that `deriveManifestFromState`
   output survives a round-trip through `resolveStaticRenderManifest` → render still,
   and optionally provide a "Render this" button that calls the Wave 5 script path
   from the browser dev route.

Option 2 is lower risk and closes the loop between authoring and production more
concretely without requiring new infrastructure.
