# Creative Editor — Premium Workspace Repair V2

Dockview integration recovery + compact laptop UX. Corrective mission; no new product scope.

## 1. Starting SHA

`66354e6be91759238eb4dbc8be3ada471cd66956`. Local HEAD, `origin/main` and remote `refs/heads/main` all matched before work began.

## 2. Human-smoke failures (66354e6)

1. Zoom, Slide 1/2, previous/next, Inspector tabs and element controls did nothing.
2. The Inspector could only move horizontally ("horizontal rail").
3. The Inspector was bounded to a Preview-sized host.
4. Docking/drop-target affordances were visible.
5. Inspector tabs did not change content.
6. Tab labels were crushed at small palette widths.
7. There was no real minimize.
8. "Inspector" appeared twice.
9. The header was too tall.
10. Zoom, Slides and State each had their own row.
11. Context was a footer block in normal page flow.
12. Header said "Slide 2 de 2" while the Canvas and strip said 1/2.

## 3. Pointer/input root cause

This was **not** pointer interception. The probes were run live on production (66354e6) at 1366×768.

- `document.elementFromPoint` over zoom −/+, the zoom Select, the Inspector tabs and Gerar PNG hit the control itself.
- Dockview's `.dv-floating-overlay-host` has `pointer-events: none`. Only `.dv-resize-container` receives input.
- The slide buttons were hit by the palette only because the palette had been dragged over them.
- Real clicks were dispatched to the controls, and nothing re-rendered:

| Action | Header | Canvas / Inspector |
|---|---|---|
| Click tab "Conteúdo" | — | active tab stayed "Template" |
| Click "Diminuir zoom" | — | `transform: scale(0.33)` unchanged |
| Click "2/2" | became "Slide 2 de 2" | badge/strip unchanged (1/2) |

**Cause.** dockview-react renders each panel through a portal whose component is captured **once**, at panel creation: `ReactPart.createPortal` → `React.createElement(ReactComponentBridge, { component })` in `dockview-react/dist/package/main.esm.mjs:143`.

The page passed inline closures, `components={{ canvas: () => renderCanvas(), inspector: () => renderInspector() }}`. Each panel therefore ran the closure from the render where `onReady` fired. The bridge only re-renders on dockview parameter updates, and even then it calls the same stale closure.

Page state did change (`setState` is stable). The header lives outside Dockview, so it updated while the Canvas and Inspector stayed frozen. That single cause explains the failures of zoom, slides, tabs, the Element Select, sliders, minimize and the slide-state mismatch (§16).

**Secondary layering defect.** Dockview floating overlays use `z-index: calc(var(--dv-overlay-z-index, 999) + n)` in the root stacking context. Radix Select, DropdownMenu and AlertDialog portals are `z-50`, so the Element Select list could open underneath the palette.

## 4. Dockview host-boundary root cause

The Dockview root was a `h-[calc(100vh-13rem)]` box whose base panel held the Canvas. Floating bounds (`boundedWithinViewport`) are the Dockview root.

- The Inspector was created at `height: 620`. The live host measured 558px.
- `Overlay.setupDrag` clamps `top` to `[0, max(0, hostHeight − paletteHeight)]` = `[0, 0]`. Vertical travel was zero until the user shrank the palette.

## 5. Decision: KEEP Dockview

Dockview 8.3.1 meets every V1 requirement through supported options and APIs:

| Requirement | How |
|---|---|
| one floating palette | single floating group, `addPanel({ floating })` |
| true X/Y movement | `floatingGroupBounds="boundedWithinViewport"` over the full workbench, default height ≤ 80% of it |
| resize | overlay resize handles; CSS min 320×220 |
| minimize/restore | `DockviewFloatingGroupPanel.position()` (see §10) |
| no Canvas reflow | palette lives in `.dv-floating-overlay-host`, outside the grid |
| no docking UI | `disableDnd` (+ `dndEdges={false}`) |
| internal controls clickable | overlay drags only from the handle; content drags only with Shift |
| bounded to workbench | Dockview root = entire workbench |
| no global blocking overlay | overlay host is `pointer-events: none` (library default) |

No blocker justified react-rnd, so react-rnd was not introduced.

## 6. Workbench architecture

```
DashboardPage
└─ editor column  h = 100dvh − studio top bar   (desktop ≥ 1024px)
   ├─ compact header (one row)
   └─ CreativeWorkbench  (.creative-editor-workbench, isolation: isolate)  ← palette bounds
      └─ DockviewReact
         ├─ base panel "canvas": Canvas viewport (flex-1) + unified lower toolbar
         └─ floating panel "inspector": ONE palette
```

- `components/creative/editor/creative-workbench.tsx` owns Dockview.
- Panel components (`CanvasPanel`, `InspectorPanel`, `InspectorHeaderActions`) are module-level and stable. They read live `canvas` / `inspector` nodes from `WorkbenchSlotsContext`. Context propagates through portals, so every page render reaches the panels.
- Dockview layout state is UI-only. It never enters `PersistedAuthoredSlide`, ChannelPiece JSON, `StaticRenderManifest`, template props or overrides.

## 7. Palette bounds

The bounds are the whole workbench under the compact header: the Canvas area plus the lower toolbar. They are not the Canvas rectangle.

`initialInspectorPaletteBox()` (`lib/creative/authoring/editor-workspace.ts`) places the palette top-right and sizes it at min(540px, 80% of the workbench height). This leaves vertical travel room.

A `ResizeObserver` on the workbench runs `constrainPaletteBox()` so the palette is never stranded after a window resize. Palette movement cannot resize the Canvas: the palette is an absolutely positioned overlay, outside the grid.

## 8. Docking disabled

- `disableDnd` resolves dockview's DnD capabilities to `{ html5: false, pointer: false }`. Tabs and void containers are not `draggable`.
- `onWillShowOverlay` is default-prevented, so no drop targets render.
- Shift/long-press redock is disabled (`GroupDragSource` respects the capabilities).
- `dndEdges={false}` removes edge docking.
- Floating-window movement is a separate pointer path (`Overlay.setupDrag`), so movement still works.

## 9. Drag / input handling

`floatingGroupDragHandle="tabbar"`: the drag handle is the group's `.dv-void-container`, the empty area of the single header row.

- Tabs (hidden), right-side actions (the minimize button) and all content never start a drag.
- Dockview's content listener drags only when Shift is held.
- Tool tabs, the Select, sliders, buttons, textareas and internal scroll all belong to the application.
- `isolation: isolate` on the workbench contains Dockview's 999+ z-index. Radix portals and the Studio top bar always paint above the palette.

## 10. Minimize

The minimize button is `InspectorHeaderActions`, dockview's supported `rightHeaderActionsComponent`.

- **Minimize** records the expanded height, adds `.creative-inspector-minimized` (drops min-height, disables resize handles) and calls the floating window's `position({ top, left, width, height: headerHeight })`. Body content unmounts.
- **Restore** calls `position()` with the saved height at the same top/left, constrained to the workbench.
- `position()` pins top/left alignment, so X/Y is preserved even when dockview had bottom-anchored the palette.
- The floating window is reached through `api.component.getFloatingWindowForGroup()` (public on `DockviewComponent`). There is a public `group.api.setSize()` fallback.

## 11. Inspector tabs

Template / Conteúdo / Assets / Style / Element live in one Radix `Tabs` inside the single palette. The active section is page state, so it survives minimize.

Tabs use `flex-auto` content sizing, never horizontal scroll. Below a 330px container width (container query `inspector`), deterministic compact labels appear: `Tpl. | Conteúdo | Assets | Style | Elem.`.

## 12. Element Select

There is one Design System `Select` ("Elemento") with semantic labels. It lists **only elements the active variant renders**, and no raw IDs are shown.

- **Cover:** Título, Hero, Paper, Faixa do título, Fita da imagem, Pin, Botânica.
- **Info:** Título, Paper, Faixa do título, Fita da imagem 1, Fita da imagem 2, Fita inferior, Pin, Botânica.

**Label correction (smoke finding).** The previous list showed all three tapes on every variant and labelled `tape1` "Fita do título". In `DocumentaryCard`:

- Cover renders only `tape1`, on the hero image (`CoverVariant.tsx:72`).
- Info renders `tape1`/`tape2` on image cards 1 and 2 (`InfoVariant.tsx:47`) and `tape3` at the bottom (`InfoVariant.tsx:54`).
- No variant tapes the title.

On production, editing "Fita da imagem" (`tape2`) on the Cover slide stored a value but changed nothing on the Canvas. Labels now describe what the template actually renders; the persisted keys `tape1`/`tape2`/`tape3` are unchanged. A selection the variant does not render (for example after a slide switch) falls back to Título.

Only the selected element's controls render: `TitleTuningControls`, `HeroTuningControls` or `PrimitiveTransformControls` for that slot. These are the existing reducers and contracts.

## 13. Compact header

One row:

```
[←] Creative Editor  Static · Instagram Carousel · 2/2  Contexto ▾     status [Salvar] [Gerar PNG]
```

The back action is an icon button labelled "Voltar ao conteúdo". Render progress, errors and the "Salvar nesta peça" action are inline in the header. This replaces the old back row, 2xl title and metadata line.

## 14. Context disclosure

The footer `<details>` was removed. "Contexto ▾" in the header opens the existing `DropdownMenu` containing the existing `ContextMetadata` list: Project, Production, EditorialContent, ChannelPiece, Identity.

## 15. Unified lower toolbar

One row directly under the Canvas, inside the workbench:

```
[←][1/2][2/2][→]   [−][Fit · 33% ▼][+]   Reverter  Restaurar padrão  □ Auto-save
```

`flex-wrap` allows a second row only on narrow widths. The zoom presets (25–150%) and the true 2D Fit (`min(w/1080, h/1350, 1)`) are unchanged. The scaled box is floored so Fit never produces sub-pixel scrollbars.

## 16. Slide state root cause

There was already a single source of truth, `currentSlideIndex`. The mismatch was the frozen Canvas/Inspector portal from §3: the header re-rendered, the Dockview panels did not.

With live panels, the header indicator, Canvas sequence badge, selected strip button (`aria-pressed`), active `AuthoringState` and Inspector content all derive from that one index in the same render.

## 17. Interaction smoke evidence

The smoke ran on authenticated production (`content.multihuman.com.br`) in the Traycer in-app browser, against the "Carrossel 01 Instagram" 2-slide piece. Every row was clicked or driven and verified through DOM state.

| Area | Result |
|---|---|
| Header: Salvar | "Alterações não salvas" → "Salvando…" → "Salvo" |
| Header: Gerar PNG | clickable → "Renderizando…" → existing failure feedback "Render contextual falhou." (known serverless limit) |
| Header: Contexto | opens Project / Production / EditorialContent / ChannelPiece / Identity (UTF-8 correct); closes on outside click |
| Slides 1/2, 2/2, ←, → | header indicator, Canvas badge and pressed strip button always agree (1/2 ↔ 2/2) |
| Zoom −, +, preset 25%, Fit | `scale()` 0.4 → 0.5 → 0.4 → 0.25 → Fit |
| Tool tabs | Template, Conteúdo, Assets, Style and Element each switch content |
| Inspector drag X | 969 → 436, and 177 (far-left workbench edge) at 1440 |
| Inspector drag Y | 111 → 186 → 136; bottom edge reaches the workbench bottom at 1440 |
| Resize | width 360 → 410, height 525 → 458; narrowing clamps at 320 and compact labels appear, with no horizontal overflow |
| Minimize / restore | 540 → 38 → 540 over 3 cycles at a constant (1043,111); body unmounts and restores; active tab kept |
| Docking UI | 0 drop-target elements after drags |
| Canvas reflow | card rect identical before and after every palette move, resize and minimize |
| Element Select | opens above the palette (`elementFromPoint` hits the list); Título, Faixa do título and tapes selected |
| Title vs Strip | moving Título changed only Canvas node #10; Faixa stayed 0. Moving Faixa changed only #9; Título stayed 30 |
| Tape A vs B | moving Fita (`tape1`) changed only #16; the other tape's values stayed 0 |
| Slider after palette drag | yes (all element edits ran after the drags) |
| Content edit | Título textarea → Canvas updates, "Alterações não salvas" |
| Restore | branded dialog (UTF-8 copy); Cancel keeps edits; Confirm → template defaults, still dirty |
| Revert | back to the persisted state, "Salvo" |
| Auto-save | ON → debounced "Salvo" with no click; preference stored; OFF restores the default |

**Smoke-driven fixes.** Production smoke caught three defects the unit/jsdom gates could not see; each was fixed and re-verified:

1. Dockview mounts `.dv-floating-overlay-host` as a **sibling** of the `DockviewReact` `className` root, inside `.dv-shell`, so the palette CSS never matched (Dockview tab visible, no single header). Rules and theme variables are now scoped to `.creative-editor-workbench` / `.dv-shell`. This also explains why the 66354e6 palette skin (hidden close X, duplicate "Inspector") only partly applied.
2. Minimize drifted 1px per cycle (box read from `getBoundingClientRect` deltas). It now uses `offsetTop/offsetLeft`, the space dockview's `position()` writes.
3. The tape list was not variant-accurate (§12).

**Environment note.** The in-app browser tab stops producing frames (`requestAnimationFrame` never fires) whenever its tile is off screen. In that state, ResizeObserver, media-query `change` events and input dispatch all stall. Checks were run with the tile visible; readings taken while frames were stalled were discarded.

## 18. Viewport / responsive evidence

| Viewport | Result |
|---|---|
| 1366×768 | page scroll 768/768 (none), no horizontal overflow; header one 40px row; Fit 43% (card 469×587 fully visible); toolbar one 45px row; palette 360×525 in a 658px workbench |
| 1440×900 | page scroll 900/900 (none); Fit 53% (card 575×719); toolbar one row; palette 360×540; full tab labels; X/Y travel across the whole workbench |
| 768×1024 | stacked fallback (no Dockview); no horizontal overflow; back / Salvar / Gerar PNG / zoom / slides / all tabs reachable; Inspector body no horizontal overflow |
| 390×844 | stacked fallback; no horizontal overflow; all essentials reachable; header and toolbar wrap; Inspector stacked below the Canvas |

- ≥ 1024px: floating workbench.
- < 1024px (`useFloatingWorkbench`, `matchMedia`): `StackedWorkbench`. No Dockview is mounted, the Canvas has a bounded height, the toolbar wraps and the Inspector is stacked below. Inspector UI state is page state, so switching modes keeps the tab and element.

## 19. Tests / build

- `components/creative/editor/creative-workbench.test.tsx` is a jsdom integration test over real dockview-react and Radix Tabs. It covers:
  - live panel re-render;
  - tab click → content change;
  - internal controls/tabs never start a drag, while the header handle does;
  - no draggable tabs/handles;
  - minimize/restore.
- **Mutation check:** reintroducing inline panel closures fails 3/5 tests (live state, tabs, minimize), reproducing the production failure exactly.
- `lib/creative/authoring/__tests__/editor-workspace.test.ts` covers palette geometry (vertical travel room, bounds, minimum size) and UTF-8 labels.
- Full suite: 73 files, 877 tests passing (was 72 files / 865 tests). Typecheck, lint on every changed source file and `pnpm build` pass.
- New dev dependencies: `jsdom`, `@testing-library/react`, `@testing-library/dom`. `vitest.config.ts` now also includes `components/**/*.test.tsx`.

## 20. Deployment

| Commit | Purpose | Vercel |
|---|---|---|
| `07c46fe` | root-cause repair, workbench, header/toolbar/context, tests | `dpl_BSunSZVjkZGq5hhWKL1n8gWSQTCB` READY |
| `96ca595` | scope palette skin to the workbench (smoke finding 1) | `dpl_wmZNnu3R4MKXiM4mztdB8kmDfLYT` READY |
| `f384aa2` | minimize drift + variant-accurate tapes (smoke findings 2–3) | `dpl_GS2Pn8rseFgGvT4ALMkYPThGNc3g` READY |

This record is committed on top. Its commit and deployment SHA are reported in the mission's final report.

## 21. Deferred

Static Render Worker (StaticRenderManifest → async render execution → VPS worker → renderStill → polling → PNG) remains the next infrastructure mission. Gerar PNG keeps its existing failure feedback.
