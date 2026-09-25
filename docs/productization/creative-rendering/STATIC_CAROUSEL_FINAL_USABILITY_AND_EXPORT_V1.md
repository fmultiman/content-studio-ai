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

Run against the real Portal ChannelPiece (`1247e54b-8f55-492e-825d-ed9b927f2e63`, 10 slides) once `f8c0263` was READY in production.

- **Toolbar/pagination** — 1440, 1366, 1280, 1200, 1100, 1024: single row confirmed with Inspector open and with Inspector closed at every width (button tops all on one DOM row; at 1024 the row stays single but the toolbar's own `overflow-x-auto` picks up a ~12px horizontal scroll, which is expected fallback behavior, not a wrap). Pagination window verified at slide 1 (`1 2 3 4 5`), slide 5 (`3 4 5 6 7`, current centered), and slide 10 via 5× "Próximo slide" clicks (`6 7 8 9 10`, Next disabled at the end). Visible labels are bare numbers; `aria-label` carries "Slide n de 10".
- **Viewport menu** — "Ações de viewport" opens exactly `Ajustar à tela` / `Centralizar` / `100% centralizado`. All three were clicked in sequence; `Salvar` stayed disabled (no dirty state) throughout, and after `100% centralizado` the zoom selector's underlying `<select>` reported `value="1"` / selected option `"100%"`.
- **Inspector launcher** — closing the Inspector produced the icon-only `aria-label="Abrir Inspector"` launcher with the toolbar still one row; clicking it reopened the Inspector (close button and tab content returned, launcher removed).
- **Template anatomy** — Template tab shows `ESTRUTURA DO TEMPLATE` (Conteúdo editorial, Imagem de conteúdo, Materiais de colagem, Fonte e crédito — registry-driven, Project-neutral) directly above `ESTRUTURA DO LAYOUT` (the selected layout's 10 concrete elements and 8 asset slots). The two lists are distinct with no duplication.
- **ZIP export** — `GET /api/creative/static-authoring/export?channelPieceId=...` returned `200`, `content-type: application/zip`, `content-disposition: attachment; filename="carousel.zip"`, `cache-control: no-store`, 18,423,447 bytes. Unzipped in-page (JSZip) to exactly 10 entries: `01-slide-1.png` … `10-slide-10.png`. First (`01-slide-1.png`), middle (`06-slide-6.png`), and last (`10-slide-10.png`) all start with a valid PNG signature (`89 50 4e 47 0d 0a 1a 0a`).
- **Database/output integrity** — `channel_piece_media` count (10), `render_executions` count (22), `library_files` count (23), and `channel_piece_static_authoring_states.updated_at` were read before and after the ZIP request: all four were byte-for-byte identical, and the ordered `(position, library_file_id)` pairs were unchanged. Confirms the export created no render execution, LibraryFile, ChannelPieceMedia, or authoring save.
- **Responsive** — 768×1024 and 390×844 showed no horizontal page overflow; Add Slide, Baixar ZIP, and slide navigation stayed reachable, with the pagination window narrowing to 3 buttons at 390px per the "narrow supported desktop" allowance.

No production data was mutated by this smoke: the browser session only read state and issued the ZIP GET request; no Save, Add Slide, or Remove Slide action was performed.

## 14. Delivery

- Final SHA: `f8c0263efdc6b4e8c3d51f8873a56c4a434cf0dd` (unchanged since implementation — this closure session made no code changes).
- Remote `main` / `origin/main`: `f8c0263efdc6b4e8c3d51f8873a56c4a434cf0dd` (confirmed identical to local HEAD).
- Vercel: the first build for `f8c0263` (`dpl_DMsrwd1yjP942KkAQZNTHNA8nX53`) failed before application compilation inside `next/font/google` / Turbopack (`@vercel/turbopack-next/internal/font/google/font`), with no reference to files touched by this mission. A same-commit rebuild (`dpl_BaXuRe2xbQiNr4QpJ4YkyLYQBnEw`) succeeded and reached `READY` on the exact same `githubCommitSha`, confirming the first failure was transient Vercel/Turbopack infrastructure rather than an application defect. That deployment is aliased to `content.multihuman.com.br` and is the one the production smoke above ran against.
- Worker: unchanged in this closure session; no VPS action was taken or required.

