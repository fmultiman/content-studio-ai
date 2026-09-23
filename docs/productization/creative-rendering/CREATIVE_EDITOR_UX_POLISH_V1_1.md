# Creative Editor UX Polish V1.1

**Starting SHA:** `fa0a4236def9f46454db63df80804893d441734d`

## Human smoke findings addressed

The editor needed a smaller useful viewport, fewer zoom controls, and contextual controls that remain beside the Canvas. Restore used a native confirmation dialog. Title and title strip shared one wrapper transform, and repeated tape visuals shared one slot. Sequence markers already receive the actual authored collection size from the render request; the UI now keeps that same count visible.

## Viewport and workspace

Fit now measures the Preview Surface and computes `min(availableWidth / canvasWidth, availableHeight / canvasHeight, 1)`. The logical target remains the context target (`1080?1350` for the carousel); CSS scaling affects only the preview. Explicit zoom levels are 25%, 33%, 40%, 50%, 75%, 100%, 125%, and 150%. The toolbar is `? / current zoom select / + / Fit`. Fit is the default and the Preview Surface owns bounded overflow.

On wide desktop, the workspace is a two-column Canvas plus Inspector grid. The Inspector is sticky, independently scrollable, remembers its selected tab for the session, and can be minimized. At narrower widths the grid collapses to Canvas, slide strip, and the tool panel below.

## Restore dialog

Restore Default uses the existing Radix AlertDialog primitive with the requested title, explanation, Cancel, and Restore actions. It only changes in-memory state; Save/Autosave semantics are unchanged.

## Element identity and primitive audit

| Visual instance | Previous slot | Independent now? | Action |
|---|---|---:|---|
| Title text | title strip `PaperPlane` wrapper | Yes | Title tuning now applies to the text node only. |
| Title strip | `paperStrip` | Yes | Existing paperStrip transform remains its own Inspector state. |
| Cover hero tape | `tape` | Yes | Uses `tape1` with legacy `tape` fallback. |
| Info card tape 1 | `tape` | Yes | Uses `tape1`. |
| Info card tape 2 | `tape` | Yes | Uses `tape2`. |
| Info lower tape | `tape` | Yes | Uses `tape3`. |
| Botanical pair / pins | `botanical` / `pin` | No | Kept as template adornments in V1.1; no misleading separate Inspector aliases were added. |

`tape1`, `tape2`, and `tape3` are template-defined optional fields in the existing JSONB slide object. Older rows load with defaults and continue to accept the legacy `tape` slot. Each new slot round-trips per slide without a migration table. Product labels are semantic (`Fita do t?tulo`, `Fita da imagem`, `Fita inferior`).

## Slide count and persistence

The sequence badge is derived from the current ordered authoring collection and passed as `{ index, total }` to the composition. No planned total is hardcoded. Explicit Save remains the persistence boundary; Autosave remains optional and off by default. Zoom is local viewport state and is never serialized.

## Verification

- Focused viewport tests: passed.
- Full suite: 865 tests passed.
- `pnpm exec tsc --noEmit`: passed.
- ESLint on changed files: passed.
- `pnpm build`: passed.
- Manual viewport target: desktop 1440?900, with Fit and the Inspector visible together; narrow fallback checked at 900px.

## Deferred

Static PNG queue/worker integration, slides 3?10, Add Slide, generic layers, render-all, ZIP export, and Video Editor remain out of scope.

