# Creative Editor Static — Detail Polish V1

Status: implementation validated locally. Production deployment and smoke require the operator handoff gate.

## 1. Scope

This change closes the Static editor detail pass: viewport camera, element visibility, title line spacing, Inspector controls, tab sizing, slide removal and number-only page labels.

## 2. Evidence and baseline

The implementation starts from `40c081f` and preserves the ten-slide Portal carousel. Existing authored outputs and media remain durable records.

## 3. Viewport camera

Pan is UI-only state. `clampPan`, `canvasOrigin` and `applyViewportAction` keep the canvas recoverable and provide Ajustar, Centralizar and 100% actions.

## 4. Pointer discipline

Canvas pan uses pointer capture and grab cursors. Floating-mode wheel handling is non-passive and skips Ctrl zoom. Layer grips, eyes, controls and Inspector titlebar buttons stop propagation at their own target.

## 5. Element visibility

Camadas keeps every element in the stack. Eye/EyeOff toggles a sparse `hiddenElements` list; hidden rows remain selectable and editable. Ordem padrão and Restaurar elemento do not change visibility.

## 6. Line spacing

Title elements that declare Template typography expose the bounded Entrelinha control. Defaults are Template-driven; authored overrides persist per slide and are frozen into render snapshots.

## 7. Preview and worker parity

The request, route, snapshot, runtime resolver, worker entrypoint, Remotion composition, resolver and DocumentaryCard all carry the effective hidden elements and title line height.

## 8. Inspector workspace

The Inspector has independent minimize and close actions. Closing removes only the floating panel; reopening uses the last in-session bounds or the constrained default. Authoring state and dirty state are unaffected.

## 9. Tabs

Full labels retain their accessible names and tooltips. Tracking and the container-query threshold prevent clipping at the measured compact widths; tabs do not wrap or gain horizontal scrolling.

## 10. Slide removal

Remove Slide mutates only the authored collection, guards the last slide, keeps stable IDs, renumbers order, selects the next available position and warns when a saved PNG is attached. LibraryFile, ChannelPieceMedia, executions, Gallery media, MinIO objects and history are untouched.

## 11. Page numbering

Visible badges and navigation buttons show only the page number. Accessible labels retain “Slide n de N” / “Página n de N”; render metadata continues to carry totals.

## 12. Shell scrollbar repair

The short-height expanded rail uses fixed group label height and thin vertical scrolling. Compact mode receives a bounded rail height. The fix is local to the shell and does not hide scrollbars globally.

## 13. Validation

- 82 test files, 1,077 tests passed.
- Typecheck passed.
- ESLint passed for changed TypeScript/TSX files; CSS was ignored by the configured ESLint matcher.
- Next production build passed.
- Exported worker completed its dependency-load smoke test.
- Exported worker rendered Slides 1–10 successfully at 1080×1350.

## 14. Delivery and operator gate

The exported runtime is in `infra/render-worker-runtime/dist/content-studio`. Before deployment, create the named tarball with SHA256, commit only intentional files, push, verify Vercel READY, and hand the tarball to the VPS operator. After the operator confirms the worker update, run production smoke A–H plus N/O at the canonical viewports, then restore the intended ten-slide state.
