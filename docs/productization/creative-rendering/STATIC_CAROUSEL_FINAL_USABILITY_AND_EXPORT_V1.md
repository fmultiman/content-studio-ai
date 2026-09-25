# Static Carousel — Final Usability and Export V1

## 1. Release identity

- Starting SHA: `6154ca9`
- Scope: bounded Static Carousel usability and durable ZIP export.
- Worker scope: unchanged; no Remotion, `renderStill`, VPS worker, or static renderer changes.

## 2. Toolbar objective

The lower editor toolbar remains a single horizontal row on ordinary desktop widths. It keeps navigation, Add/Remove, the normal zoom cluster, restore actions, autosave, and the Inspector launcher available without moving those actions into a secondary menu.

## 3. Pagination window contract

The slide navigation renders a bounded sliding window through `visibleSlideIndexes`. It shows at most five page numbers in ordinary desktop space and three when the measured preview is narrow. Previous and Next remain outside the window. Visible labels are simple `1..N`; stable slide IDs remain React keys and persisted identifiers.

## 4. Add and Remove

Add Slide and Remove Slide remain adjacent to the navigation cluster. Existing minimum-one-slide, reserved-ID, save, revert, and durable-output semantics remain in force.

## 5. Zoom and viewport contract

The permanent zoom cluster remains `[−] [selector] [+]`, including 100%. Fit, Center, and 100% centered are menu items under one compact viewport-actions button. They only update viewport state, reset pan as specified, and never mark authoring dirty or alter render input.

## 6. Inspector launcher

When the floating Inspector is closed, its launcher is an icon-only button with `aria-label="Abrir Inspector"` and a tooltip. When open, the launcher is omitted from the lower toolbar.

## 7. Template anatomy contract

`TemplateDefinition.anatomy` is the code-backed registry contract for reusable Template-family semantic regions. The Template tab displays it read-only under `Estrutura do Template`, above the selected layout's concrete `Estrutura do layout`. The two lists are intentionally distinct: family grammar is registry metadata; layout anatomy is the selected layout's elements and asset slots.

## 8. ZIP placement and interaction

`Baixar ZIP` is in the top output/action area beside Save and `Gerar PNG`. The browser requests one same-origin endpoint and downloads the returned ephemeral archive. It does not assemble signed URLs or contact storage directly.

## 9. ZIP authority

The server authenticates the user and verifies ChannelPiece ownership and Project consistency. `channel_piece_static_authoring_states.slides.length` defines the expected authored collection count. `channel_piece_media.position` defines export order, and each row must reference a non-deleted, same-Project `LibraryFile` with a supported static image MIME and a readable storage object.

## 10. ZIP filenames and completeness

Names are deterministic and contain no IDs, storage paths, or signed URLs: `01-slide-1.png`, `02-slide-2.png`, and so on. Missing, duplicate, deleted, unsupported, empty, or unreadable media returns a clear error; the route never returns a partial carousel. The count is derived from authored state and is not hardcoded to ten.

## 11. Storage and mutation boundary

The archive is generated on demand with `fflate` and returned as `application/zip`. It creates no LibraryFile, ChannelPieceMedia, render execution, Output entity, history row, authoring save, approval change, or render job. The route reads private S3 objects through the existing server-side storage helper and exposes no credentials.

## 12. Focused validation

- Pagination helper: first, middle, last, narrow window, active-slide containment, and future counts.
- ZIP helper: ordering, deterministic names, future counts, incomplete collections, empty files, and unsupported MIME.
- Route contract: auth/media/library authority and no render or persistence calls.
- Registry anatomy: metadata drives the Template section and stays separate from layout elements.
- Full suite: 85 files, 1,086 tests passed.
- Typecheck, changed-file ESLint, and production build passed.

## 13. Production smoke

Pending the deployment for this release. The smoke checklist is: 1440, 1366, 1280, 1200, 1100, and 1024 desktop widths with Inspector open and closed; pagination at first, middle, and last slide; safe temporary Add/Remove; viewport menu Fit, Center, and 100%; registry-driven Template anatomy; one ZIP with ordered files and unchanged media/database state.

## 14. Delivery

- Final SHA: to be filled after the intentional release commit.
- Remote `main`: to be confirmed after push.
- Vercel deployment: exact GitHub commit SHA must be READY before the authenticated smoke.

