# Creative Editor Dockview Workspace V1

## Delivery scope

- Starting SHA: `3c7650f0a447f7a316247c8ab2c86b2e4402eef6`
- Visual baseline SHA: `fa0a4236def9f46454db63df80804893d441734d`
- Package: `dockview-react@8.3.1`

This recovery keeps the authoring and render state fixes from the starting
commit and replaces only the visually incorrect permanent Inspector column.

## Phase 0 KEEP / REPLACE matrix

| Area | Decision | Evidence / implementation |
| --- | --- | --- |
| Two-dimensional Fit | KEEP | `calculatePreviewFitScale` measures both usable dimensions and caps at 1. |
| 25%–150% zoom presets | KEEP | `ZOOM_LEVELS` remains viewport-only and includes 25%, 33%, and 40%. |
| Compact zoom controls | KEEP | A compact select with minus, plus, and Fit sits below the Canvas. |
| Restore AlertDialog | KEEP | Branded `AlertDialog` remains the only restore confirmation path. |
| Title / title-strip independence | KEEP | Existing separate tuning slots and reducer/render contracts are preserved. |
| Independent tape instances | KEEP | `tape1`, `tape2`, and `tape3` state, rendering, and persistence remain intact. |
| Backward-compatible persisted rows | KEEP | Older rows still hydrate with safe defaults. |
| Dynamic carousel total | KEEP | Preview and render sequence now derive from the current slide collection. |
| Permanent Canvas + Inspector grid | REPLACE | Removed; Dockview owns one floating Inspector group. |
| Width-consuming Inspector | REPLACE | Inspector overlays the workspace and does not participate in Canvas layout. |
| Inline element chips | REPLACE | Element section now uses one compact product-facing Select. |
| Horizontal scrolling | REPLACE | Flexible tabs and clipped Inspector body have no horizontal overflow. |
| Mojibake | REPLACE | Changed source strings were restored to deliberate UTF-8 Portuguese labels. |

## Dockview boundary and workspace geometry

Dockview is used only as workspace/window infrastructure. It owns the floating
group's movement, resize, viewport bounds, and titlebar lifecycle. Content
Studio remains authoritative for the Canvas, DocumentaryCard renderer,
template model, authored state, persistence, and render manifest. Dockview
layout state is not stored in authored JSON or render payloads.

V1 creates exactly two Dockview panels: a fixed `canvas` base panel and one
floating `inspector` panel. Docking/drop edges are disabled; popouts and extra
groups are not exposed. The Inspector is configured with
`floatingGroupBounds="boundedWithinViewport"` and a titlebar drag handle. The
Canvas base panel has no visible IDE tab chrome. Because the Inspector is a
floating group, opening, moving, resizing, or minimizing it cannot change the
Canvas width, centering, zoom position, or slide-strip position.

The desktop grammar is fixed as:

```
Header → Canvas → compact Zoom → Slide strip
                      ╰─ one floating Inspector palette
```

The palette has a Studio surface, border, radius, typography, and shadow. Its
body scrolls vertically when needed and explicitly clips horizontal overflow.
The header contains `Inspector` and one minimize/restore control. Minimize
collapses the body while retaining a compact titlebar; restore returns the
same useful floating group without changing the Canvas.

At narrower widths, Dockview remains bounded and the fixed Canvas panel uses
the available workspace; the floating palette can be moved aside or minimized.
The page has a bounded `100vh`-derived workspace so normal control changes do
not require document scrolling.

## Tool sections and element identity

Template, Conteúdo, Assets, Style, and Element remain application-level tabs
inside the single palette. Element uses one Radix Design System Select with
labels such as `Título`, `Faixa do título`, `Fita do título`, `Fita da imagem`,
`Fita inferior`, `Pin`, and `Botânica`. Only controls relevant to the selected
element are rendered. Title and title strip retain independent authored
transforms; each tape instance retains its own transform slot and persistence.

## Fit, zoom, and slide semantics

Fit uses the measured usable Preview Surface dimensions:

`min(availableWidth / logicalWidth, availableHeight / logicalHeight, 1)`

It displays the complete 1080×1350 frame without internal scrollbars and does
not mutate authored transforms or PNG dimensions. Explicit viewport presets
are 25%, 33%, 40%, 50%, 75%, 100%, 125%, and 150%. The control is immediately
below the Canvas; the slide strip is immediately below the control. Preview
sequence metadata is set from the actual slide collection, so a two-slide
carousel presents `1/2` and `2/2` in the editor and composition.

## Encoding recovery

The prior shell rewrite had UTF-8 text decoded into visible mojibake. The
changed editor source now uses UTF-8 literals for `Conteúdo`, `Botânica`,
`Restaurar padrão`, `Alterações não salvas`, `Creative Editor`, and normal `·`
separators. No `Ã`, `Â`, or replacement-character sequences remain in the
changed editor source.

## Verification and deferred work

Visual verification target viewports are 1366×768 and 1440×900. The local
browser harness is available, but the authenticated production editor route
requires application credentials; visual claims are therefore limited to the
real component build and local harness where authentication permits. The
workspace implementation is covered by the existing authoring, Fit, zoom,
title/strip, tape-instance, persistence, slide-total, Save/Autosave, and
AlertDialog regression tests.

The Static Render Worker (VPS queue, polling, and PNG result delivery) remains
deferred to its separate mission.
