# CREATIVE_EDITOR_CONTEXTUAL_STYLES_AND_TYPOGRAPHY_V1

ESTILOS now follows the selection and lets the author override, per text Element, **how it looks**: font family (supported
runtime fonts only, previewed in their real face), a numeric font size in px, and — for the Title — Entrelinha. Everything is
an **optional local override over the existing effective default**; nothing resolved is ever stored.

## Provenance

| | |
|---|---|
| Baseline (previous mission) | `CREATIVE_EDITOR_COMPOSITION_AND_SELECTION_PARITY_V1` — impl `312cac2`, PR #81, merge `9732cda6d285e04b9df49335eec0c84992e27073` |
| Branch | `feat/creative-editor-contextual-styles-typography-v1` (continued from the previous agent; not recreated) |
| `origin/main` at takeover | `cd65f4a` (PR #82, Kling settings UX — unrelated; renderer identical to `9732cda`) |
| Worktree | the same Static worktree; neighbouring worktrees untouched; pre-existing untracked utility scripts untouched and never staged |
| Implementation / PR / merge SHA | recorded in the delivery section below |

## Recovered partial implementation (what the previous agent left)

The previous agent stopped after an architecture review. The uncommitted diff was **schema/reducer/UI scaffolding that never
reached the renderer**. Classification of every tracked change found:

| Change found | Verdict | What was done |
|---|---|---|
| `AuthoringState.typography` map + persisted `typography` field | KEEP (shape) / FIX | Kept the per-Element map; narrowed to `{ fontFamily?, fontSizePx? }`; load/save now sanitize against the Layout; lenient persisted schema |
| `TypographyOverride.lineHeight` (types, both schemas, panel) | **REMOVE** | Would have created a second canonical line-height source next to `tuning.title.lineHeight` |
| `fontFamily: z.string()` (any string) | **FIX** | Now `z.enum` of the runtime registry; the render-request schema rejects arbitrary fonts |
| `SET_TYPOGRAPHY_OVERRIDE { override }` / `RESET_…` actions | FIX | Patch semantics (`null` removes a field), empty override removed, unchanged patch keeps the state reference |
| `typography` survived a Layout switch (found by the review) | **FIX** | Now Layout-owned: dropped by `replaceTemplateLayout`, counted by `hasLayoutOwnedAuthoredWork` |
| `previewTuning` **deleted** from `DocumentaryCardProps` (accidental) | **FIX (critical)** | Restored; `typographyOverrides` added beside it |
| `documentaryCardPropsFromResolvedInput(…, typographyOverrides)` accepted the argument and dropped it | FIX | Threaded to the card context |
| `runtime.overrides.typography` never reached the renderer (`component-resolver` forwarded only `documentaryCard`) | **FIX (critical)** | Forwarded as `typographyOverrides`; the worker path now honours it |
| `deriveTuningOverrides` returning typography | KEEP / FIX | Typed with `AuthoringRenderOverrides`; honoured-per-Layout via `deriveTypographyOverrides` |
| `TypographyOverridePanel` (stand-alone panel in `inspector-panels.tsx`) | **REMOVE** | Replaced by `text-style-controls.tsx` + `styles-tab.tsx`; `inspector-panels.tsx` is back to its baseline plus a truthful default headline |
| `EditorElement.kind` (editor-workspace) | **REMOVE** | Unused: Styles reads the Layout definition (kind + capability) directly; file back to baseline |
| Styles copy "Estilos locais não estão habilitados" | REMOVE | No longer true |
| Preview never passed typography to the card | INCOMPLETE → done | Page passes `deriveTypographyOverrides` to the card |
| Font preview / editor `@font-face` | INCOMPLETE → done | `RuntimeFontFaces` (see Font registry) |
| Tests | none existed | New suites (see Tests) |
| Shared Video types | none changed by the partial diff | See Cross-medium impact for what this mission added |

## Final authored model

```
Template text Element  (Layout-owned)
  AuthoringState.typography?: { [elementId]: { fontFamily?: RuntimeFontFamily; fontSizePx?: number } }

Free / Custom Text     (shared FreeTextElement; additive, optional)
  font_family?: RuntimeFontFamily      font_size_px?: number
  (semantic fields `typography` role and `size` preset are unchanged)

Title Entrelinha       tuning.title.lineHeight      ← the ONE canonical line-height source
```

* **Persisted**: slide `typography` (Template, absent when empty) and the Custom/Free element fields (absent when unset).
* **Migration: NONE.** Every field is optional and additive; a legacy slide loads without them and renders byte-identically.
* **Never persisted**: the selection (`selectedTarget` stays UI-only), and any resolved default.

### Template typography override model

* A Template text Element takes a local override only if the **registry declares it**:
  `typography.local = { role: 'display' | 'body' | 'label', fontSizePx?: number }`. `role` names the Identity role whose
  family is the default; `fontSizePx` is the Template default size on the 1080px reference canvas.
* Declared (single-style text blocks): every layout's **Título**; Cover **Chamada / Introdução / Fonte editorial**; Info **Fonte**;
  Lista / Grade / Mapa / Rede / Citação **Introdução**; Rede **Chamada**.
  Info's Título is **family-only** (two lines of different sizes set by the Template).
* **Not** declared (composite blocks: several sizes in one Element — note/caption text, card text, items, bullets, legend, brand
  name, tagline…) and every non-text Element: Styles states this honestly and offers no control. This is a documented V1 limit,
  not a fake control.
* A registry test proves the declared default size equals the renderer's constant: an override equal to the default is
  **byte-identical** to no override for every declared Element of every layout.
* Resolution: `effective default (Identity role / Template size) → optional local override`. No composition-level layer,
  no style cascade, no CSS bag.

### Free / Custom model

* `typography` (Título/Texto role) and `size` (P/M/G/Título) are unchanged. `font_family` and `font_size_px` are optional extras.
* **Numeric size wins** over the preset; the presets are **shortcuts**: clicking one sets `size` and **removes** `font_size_px`
  (deterministic return to the preset). A preset is shown as active only while no numeric size overrides it.
* `font_size_px` is px on the 1080px reference of the stage's **shorter side**, exactly like the presets (38/54/81/119).
* **Usar padrão** removes `font_family` and `font_size_px`; the role and preset stay.

### Numeric size, presets, reset

| User action | Result |
|---|---|
| Existing preset-only element loads | Looks exactly as before; its preset is active; the field shows the preset px as the default |
| Types 53 | Explicit `fontSizePx` / `font_size_px = 53` wins; no preset is active |
| Clicks a preset afterwards (Free/Custom) | Numeric override removed; that preset applies |
| Empties the field / out-of-range value | Empty → default; 8–400 only is committed |
| **Usar padrão** | Local override removed (Template: also the Title's Entrelinha override); upstream default resolves again |

### Line-height

The Title already had an authored line-height (`tuning.title.lineHeight`). It **stays the single canonical source**: the Entrelinha
slider moved from Elementos to **Estilos · Título** and edits that same field (Elementos keeps only position). No other Template
text gets line-height (it would need a broad migration); Free/Custom text has hard-coded line-heights and is not changed.

## Contextual Styles (UI)

Selection is the existing UI-only `selectedTarget`; selecting never dirties state, only an edit does.

| Selection | ESTILOS shows |
|---|---|
| none | **ESTILOS DA COMPOSIÇÃO** — the inherited Identity facts (edited in the Project; not duplicated) |
| Template text Element (declared) | **ESTILOS · \<ELEMENTO\>** — Fonte, Tamanho (px), Entrelinha (Título), Usar padrão |
| Template composite text | truthful note (no controls) |
| Template non-text Element | truthful note (recurso em Assets, posição em Elementos) — no invented image styling |
| Custom / Free Text | **ESTILOS · \<TEXTO\>** — papel, fonte, atalhos P/M/G/Título, tamanho (px), Usar padrão |
| Custom / Free Image | truthful note |

Boundary: **Conteúdo** = what it says · **Estilos** = how it looks · **Elementos** = where it is / visibility / order. For Free/Custom
Text in the **Static** editor, role and size moved from Elementos to Estilos (`typographyInStyles`); colour and alignment stay.
**Video's Elementos panel is unchanged** (flag defaults to off).

## Font registry and real font preview

* One list of names (`RUNTIME_FONT_FAMILY_NAMES`: `Fraunces`, `Source Sans 3`, `Space Grotesk`, `Inter`) in the neutral schema layer
  (`lib/schemas/creative/runtime-font-families.ts`, so schemas can validate without importing the renderer registry).
  `RUNTIME_FONT_REGISTRY` is typed `Record<RuntimeFontFamily, …>` from it — the compiler rejects drift. Schemas, validators and the picker all use it. Arbitrary strings are rejected at the schema, the Free write boundary and the helpers.
* The picker shows each family **rendered in that family**. The editor previously declared **no** `@font-face` for the creative fonts
  (it relied on the browser having them installed), so the minimum factual support was added: `RuntimeFontFaces` declares every
  registry face once for the editor, from the same `/creative-fonts/*.woff2` files the worker uses. This also makes the existing
  Identity fonts render truthfully on the editor canvas.
* Worker: `withOverrideFonts` appends the `@font-face` rules of the families picked locally (Template overrides and Custom/Free
  text) to the Identity `cssText` and adds their faces to the readiness wait (`ResolvedTypography.extra`). With no override it
  returns the same object, so the legacy path is unchanged.

## Layout switch, save/reload

* Template typography is **Layout-owned**: Cover → Info drops the Cover overrides and a switch with overrides asks for confirmation
  (`hasLayoutOwnedAuthoredWork`). **Custom Elements keep their own style** (composition-instance overlay).
* Save → reload preserves the overrides; unknown/unsupported entries (or an unsupported font) are dropped on load.
* The render route freezes only the overrides the active Layout can honour.

## Cross-medium impact

| Shared change | Classification |
|---|---|
| `FreeTextElement.font_family?` / `font_size_px?` (`lib/types.ts`) | **SAFE ADDITIVE SHARED DOMAIN** — optional, absent for every existing composition |
| `FreeTextElementPayloadSchema` optional `font_family` / `font_size_px` (`timeline.ts`) | **SAFE ADDITIVE SHARED DOMAIN** — Video accepts both shapes; nothing in Video sets them |
| `FreeStage` reads them when present | SAFE ADDITIVE — absent = identical markup (tested) |
| `free-composition.ts` validate/patch/derive | SAFE ADDITIVE — `addFreeTextElement` stays preset-only |
| `FreeSceneElements` `typographyInStyles` prop | **STATIC-ONLY REQUIRED** — default off; Video panel verified unchanged |
| Template overrides, `typographyOverrides`, Styles UI, route freezing | **STATIC-ONLY** |
| Accidental Video expansion | **None found.** No Video UI, authoring behaviour or schema default changed |

## Renderer, worker, migration

* **Renderer impact: YES (narrow).** `localTypography()` applied at the declared text sites; no override spreads `{}`.
  Legacy parity is **0 differing pixels** against `origin/main` (see Render proof).
* **Worker impact: YES.** Worker-copied files changed: `resolve-typography.ts`, `DocumentaryCardComposition.tsx`,
  `TypographyReadyBoundary.tsx`, `component-resolver.ts`, `template-definitions.ts`, `free-stage.tsx`, `DocumentaryCard.tsx`,
  `types.ts`, `primitives.tsx`, `layout-kit.tsx`, and the Cover/Info/List/Grid/Map/Network/Quote/Closing variants.
  **One new worker-copied module**: `lib/schemas/creative/runtime-font-families.ts` (the supported font names; `resolve-typography.ts`
  derives its `RuntimeFontFamily` type from it, so the registry cannot drift) — added to `export.mjs` `REQUIRED_WORKER_SOURCE`.
  Authoring helpers (`typography-overrides.ts`) stay out of the worker; a test enforces it.
  Production closure requires the operator worker update + container hash check (see Delivery).
* **Migration impact: NONE.**

## Tests

* `lib/creative/authoring/__tests__/typography-overrides.test.ts` — registry capability; pure helpers; reducer (dirty vs reset, no-op identity);
  save/reload; legacy state; unsupported-entry drop; **single line-height source**; Layout switch + Custom Elements; request schema +
  frozen snapshot; per-layout renderer parity (default = no override, byte-identical) and override reaches the painted element;
  canvas scaling; font registry / editor faces / worker `withOverrideFonts`; Free/Custom model (preset ↔ numeric, null removal, bounds,
  write boundary, neutral segment + shared schema, stage painting, `addFreeTextElement` unchanged).
* `components/creative/authoring/styles-tab.test.tsx` — headline per selection (composition / Title / another text / composite / non-text /
  Custom Text / Custom Image / stale target); picker exposes only registry fonts, each in its own face; default is the checked option;
  choosing the default clears the override; numeric 53 and out-of-range handling; reset (size + Entrelinha); Info Title family-only;
  Free preset ↔ numeric; selection alone edits nothing; Elementos vs Estilos boundary; Video panel unchanged.
* `lib/creative/authoring/__tests__/typography-wiring.test.ts` — page → request → snapshot → resolver → worker composition wiring; route freezing; worker export unchanged.
* Updated: Entrelinha no longer in Elementos (`template-element-panel.test.tsx`); typography capability shape (`cover-element-completeness.test.ts`).

## Render proof (local, frozen snapshot, Remotion `renderStill` via the claim-time resolver)

Parity trees: this branch vs `git archive origin/main` (kept outside the repo, `node_modules` junction).

* **Legacy parity** — default and full-content state of **all 8 layouts**: **0 of 1,458,000 differing pixels** on each of the 16 renders.
* Cover title numeric **80px** — title enlarged, everything else identical.
* Cover title **Space Grotesk** — real face rendered by the worker path (declared by `withOverrideFonts`).
* Cover title **Inter 48px + Entrelinha 1.3** — family, size and the canonical line-height together.
* Cover **Introdução** (Space Grotesk 40px) and **Chamada** (Fraunces 28px) — other Template text Elements.
* Citação **Introdução** (Inter 36px).
* Custom Text preset-only (unchanged look) and Custom Text **96px Space Grotesk** (numeric size + family).

## Limitations

* Composite Template text blocks (note/caption/card/list items/bullets/legend/brand name/tagline) take no local typography; Styles says so.
  Opening them needs a per-part model (a different mission).
* Line-height is exposed only for the Title (existing canonical source).
* Font weight, alignment and colour role are not part of this mission for Template text.
* A px size is on the 1080px reference canvas and scales with the canvas, like every other Template measure.
* Only the four bundled runtime families are selectable; no remote/arbitrary fonts.
* Five pre-existing source-text assertions (4 in `truthful-constraints-cleanup`, 1 in `static-parity`) were **already failing on `9732cda`**
  (the strings they match are absent at `HEAD`: they pre-date the Composição tab / `selectedTarget` rewrite; CI only runs Vercel, so
  nothing caught it). They were updated to assert the current equivalents (same intent: single Template control, same viewport hook,
  free-mode orientation, selection cleared on slide switch / element removal). No product behaviour changed for them.
