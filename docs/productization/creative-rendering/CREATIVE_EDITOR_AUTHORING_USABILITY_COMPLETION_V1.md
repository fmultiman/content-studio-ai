---
title: Creative Editor — Authoring Usability Completion V1
---

# Creative Editor — Authoring Usability Completion V1

## 1. Starting point

`6e475620457d17130b83bf795fa574c4da5c9443`: local HEAD, origin/main, remote main and Vercel production (`dpl_ngun1j1fAEPn7iuLJNZHDWbuS3uR`, READY) all matched. The worktree contained only the known scratch files (`patch_*.js`, `check-pack.js`, visual-reference-pack folders); none were touched.

This is the last usability pass before Carousel Growth. It is not a redesign: the shell, Template Foundation V1, the Static Render Worker, Gallery classification and the stack model are unchanged in kind.

## 2. Human walkthrough findings (inputs)

- Elementos had an Element dropdown, a separate transformation block and Camadas. Two of them selected the same element, and editing meant scrolling back and forth.
- The Inspector minimum width (320 px) was slightly too wide.
- The Template tab did not show what a layout is made of.
- The Assets tab treated Project resources (paper/tape) and Template resources inconsistently, and the hero could not be replaced.
- The Style tab claimed its tokens came from Project Identity.
- "Reverter" read as Undo. "Salvar nesta peça" could be clicked again on an already-saved render, which **was observed in production**: `slide-2-de-2-31c07938.png` was saved three times, two copies were attached to the piece, and one LibraryFile was left unattached.
- Nothing showed when the visible PNG no longer matched the draft.

## 3. Elementos — the accordion decision

The Element dropdown and the standalone transformation block are **removed**. Camadas (`components/creative/authoring/element-layers.tsx`) is now the **single element navigator and stack-order editor**:

- Each row is an inline disclosure with single-open behavior. A collapsed row click opens it (and closes the previous one); clicking the open row closes it.
- The expanded panel sits under its row and shows only that element's controls, plus **Restaurar elemento**, which resets that element's tuning/transform only.
- The open row is **editor UI state** (`openElementId` in the page). It is never persisted. If a layout switch leaves the open element absent from the new layout, it is simply closed (derived, no effect).
- Reordering keeps the open element open, because identity is by id.

**Event model**:

| Target | Does | Never does |
|---|---|---|
| Grip ≡ | Pointer-capture drag or ArrowUp/Down reorder. The drop target is the row under the pointer, so it stays correct if the list scrolls mid-drag (Template Foundation V1 fix, regression test kept). | Toggle the disclosure. |
| Row body (native `<button aria-expanded>`) | Open/close; Enter/Space work natively. | Reorder. |
| Controls in the panel | Edit values; pointer propagation is stopped. | Reorder, or reach the Inspector drag. |

**Capabilities come from the Template contract** (`TemplateElementDefinition.control`), not from a second list:
- `tuning:title` and `tuning:source` → Posição X/Y + Rotação.
- `tuning:hero` → Posição X/Y + Rotação + Escala.
- `transform:*` (materials) → Posição X/Y + Rotação + Escala + Opacidade.

**Ordem padrão** (tooltip "Restaurar ordem de camadas do Template") restores only the stack order.

## 4. Inspector

- **Minimum width 320 → 272 px** (`INSPECTOR_PALETTE_MIN`, and the `.dv-resize-container` CSS `min-width`).
  - At 272 the body content box is about 246 px.
  - Labels switch to compact (`Tpl.`, `Cont.`, `Assets`, `Estilo`, `Elem.`) under a 310 px container, and there is never horizontal tab scroll.
  - Slider rows use a `4.25rem | minmax(0,1fr) | 2.5rem` grid, and Camadas rows truncate their labels.
- **Tabs:** Template, Conteúdo, Assets, Estilo, Elementos.
- **Titlebar double-click** (`bindTitlebarDoubleClick` in `creative-workbench.tsx`):
  - It only reacts on the palette drag handle (`.dv-void-container`). Header buttons and panel content are excluded.
  - It toggles minimize/restore through the same `toggleMinimized`, which uses Dockview's floating-window `position()`.
  - A click that moved more than 4 px (the end of a drag) disqualifies the double-click, using the browser's own `dblclick` detection with no timers. A single click does nothing.

## 5. Template anatomy (read-only)

The Template tab gains **Estrutura do layout** (`TemplateAnatomy`). It lists the active layout's elements (front-to-back, `layoutElementsFrontFirst`) and its asset slots with the elements that use each (`layoutAssetSlots`), both read from the Template registry. It is read-only: there is no add, delete, rename or slot editing. The same structure is the natural seed for a future **Master / Template Development** surface; nothing of that was built.

## 6. Assets — model, origin, replacement

- **Slots vs elements unchanged.** Assets choose the resource that fills a semantic slot; Elementos place and stack instances.
- **Content-image slot.** The registry now declares a content-image slot `hero` (Imagem principal, `contentImageSlots`) next to the material slots. The Cover's `hero` element references it, so the content image is a first-class, template-declared, replaceable resource. Info has no content image, so it has no hero slot.
- **One consistent card** per slot (`AssetSlotCard`): thumbnail, semantic label, current resource name, origin badge (**Template** / **Projeto** / **Imagem gerada**), "Usado por", **Trocar**, and **Usar padrão** (shown only when the slot is not on the Template default).
- **Precedence** (`lib/creative/authoring/asset-slots.ts`, one resolver for card and preview):
  1. authored override — a Project LibraryFile chosen with Trocar;
  2. Project primitive catalog (paper/tape, legacy);
  3. Template default.
- **Usar padrão** removes 1 and 2, returning the slot to the Template default. It is distinct from Restaurar elemento, Ordem padrão and Restaurar padrão do Template.
- **Template assets stay Template assets.** Nothing was uploaded to the Project Library to make the UI consistent.
- **Trocar reuses the existing `ProjectLibraryAssetPicker`**, extended opt-in with `groupByOrigin` ("Arquivos do projeto" vs "Imagens geradas") and a PNG/JPEG/WebP/GIF MIME filter. Only image LibraryFiles of the current Project can be chosen; AI `images` rows are not LibraryFiles and are not offered.
- **Persistence:** optional per-slide JSONB `assetOverrides: { [slot]: { libraryFileId } }`, validated by slot enum + UUID. No migration.

## 7. Hero / content-image picker and reproducibility

- The Cover hero is replaceable with any Project image LibraryFile, and the Canvas updates immediately (preview uses the file's signed display URL).
- The render request sends identities only (`assetOverrides`). The enqueue route then:
  - checks each file is the user's, in this Project, not trashed, `kind='image'`, and an allowed MIME type (otherwise 403 `ASSET_OVERRIDE_FORBIDDEN`);
  - **freezes** `{libraryFileId, mimeType, name}` into the snapshot;
  - rebinds the Cover manifest `assets.hero` to `{type:'library_file', ref: id}`.
- **At claim time** only the frozen ids are looked up (project/user scoped) and presigned.
  - The hero URL is patched into `resolvedAssets.hero`.
  - Material slots become `primitiveMaterials[slot]` with `fit:'contain'`.
  - A missing or foreign file fails the claim (`ASSET_LIBRARY_FILE_UNAVAILABLE`) rather than substituting a file.
  - URL refresh never changes identity.
- **Renderer (worker-shared).** A Project image replacing a template material has unknown alpha bounds, so `AssetLayer` fits it whole (`contain`) inside the element's visible box. `DocumentaryCard` derives `materialUrls`/`materialContain` for every slot. Template defaults keep their measured visible-bounds placement.

## 8. Estilo — factual audit

`adaptProjectIdentityToVisualTokens()` ignores its `identity` argument and always returns `CREATIVE_IDENTITY_DEFAULTS` (Fraunces / Source Sans 3 / fixed colors). Each layout's Appearance then sets its own palette. The panel now says: **"Padrão do Studio. A Identidade do Projeto ainda não define tipografia nem cores visuais; estes valores não vêm dela."** It remains read-only; no override system was added.

## 9. State semantics

| Action | Meaning |
|---|---|
| **Salvar** | Persist the authored state (content, assets, transforms, stack, layout, appearance). No PNG, no media. Enabled only when the draft differs from the last saved state. |
| **Voltar ao salvo** (was "Reverter") | Discard unsaved changes and restore the last saved state. Not Undo; there is no history. |
| **Restaurar padrão do Template** | Draft-only: apply the Template defaults to the current slide. The confirmation says "Os valores padrão do Template serão aplicados ao slide atual. Clique em Salvar para persistir." Salvar becomes active whenever this differs from what is saved. |
| **Restaurar elemento** | One element's tuning/transform only. |
| **Ordem padrão** | Stack order only. |
| **Gerar PNG** | Scratch render of the current effective state (unsaved edits included). Never saves authoring. |
| **Salvar nesta peça** | Scratch → durable `studio_render` LibraryFile → ChannelPieceMedia, which is then discoverable in Galeria / Imagens geradas. |

## 10. Render attachment and duplicate prevention

- `GET /api/render-executions?channelPieceId=` now returns `attached_to_piece` per execution. It is true when a live LibraryFile with that `source_render_execution_id` is linked to **this** piece by ChannelPieceMedia. Hydration sets **✓ Salvo nesta peça** from it, so it survives reload.
- The upload route is **idempotent per render execution**, checked before any S3 upload:
  - if the execution already has a live LibraryFile attached to the piece, it returns 200 `alreadyAttached`;
  - if the LibraryFile exists but was removed from the piece, it re-attaches it (no second upload).
- Identity is the execution, so a new render of identical pixels can still be saved.
- A new render starts unsaved, so Salvar nesta peça reopens for it.
- A check-then-insert race window remains without a unique index. The UI prevents double clicks. A partial unique index on `library_files(source_render_execution_id)` would close it, but it needs a migration and was deliberately not applied.

## 11. Stale-render state

Each render job records the slide's authored-state signature: at Gerar PNG for renders started in the session, or at load for hydrated renders (any later edit is provably absent from them). When the current state differs from it on a finished render, the header shows **"Alterações ainda não renderizadas"**. Nothing re-renders automatically and nothing is invalidated in storage. The hint clears once a new render of the current state finishes.

## 12. Database / worker impact

- **Database:** no migration. The work uses existing JSONB authoring state, `library_files.origin` / `source_render_execution_id`, `render_executions` and ChannelPieceMedia.
- **Worker-shared code changed** (renderer contain fit, slot material URLs, registry content slot). The runtime was re-exported (47 files) and proven locally with real `renderStill`, using real Portal LibraryFiles and no uploads: `evidence/authoring-usability-v1/local-renderstill-hero-and-slot-override.jpg` shows the default vs hero replaced by an existing Portal image, plus the ornament slot filled by the uploaded tape.
- **Operator tarball:** `content-studio-authoring-usability-v1.tar.gz`, sha256 `5ec7f78c43a419f24a573c694ab960fdf5e093841572a461639c835560488315`.

## 13. Autosave — verified behavior (and one fix)

Production smoke on `c38c38d`:
- **OFF:** an edit only marks the draft dirty ("Alterações não salvas"). After 2.5 s the database still held the saved values; nothing is persisted.
- **ON:** an edit persists after the 600 ms debounce ("Salvo"), and it is the same PUT as Salvar.
- **Bug found and fixed:** turning autosave ON with a pending edit did **not** persist it; only the next edit did.
  - Cause: the load-time "skip the first autosave" flag was only consumed on the first *dirty run with autosave ON*, so it swallowed the author's first real edit. The same happened to the first edit after a load with autosave already on.
  - Fix: consume the flag on the first run after load, before the autosave/dirty gate. It still never autosaves the load/hydration itself.
  - A regression test asserts the ordering.
- Autosave was left **OFF** after the smoke.

## 14. Production interaction evidence

Authenticated production Creative Editor (Portal carousel `1247e54b…`), VPS worker updated by the operator to `content-studio-authoring-usability-v1` (reported healthy; the agent did not observe the VPS directly).

**Environment note.** A browser tab that is not rendering frames (no `requestAnimationFrame`, no ResizeObserver) leaves Dockview's floating Inspector at its 100 px fallback and Fit at 33 %. That is an environment artifact, not the product. All evidence below comes from a visible, rendering tab (rAF firing, body 358 px, Fit 43 %).

- **Elementos (Cover):**
  - Título opens inline with Posição X / Posição Y / Rotação; X = 24 moved the Canvas title (`translate(24px, 0px)`).
  - Opening Fita da imagem closed Título and showed X / Y / Rotação / Escala / Opacidade.
  - A grip drag put Imagem principal above Fita da imagem (z 16 / 20 → 20 / 18) while the open panel stayed open and the Inspector stayed put (969,111). Ordem padrão restored only the stack.
- **Elementos (Info):**
  - Fonte offers X / Y / Rotação; Cartão 1 offers the full material set.
  - Dragging the Escala slider across the list changed the value and never reordered.
- **Inspector:**
  - Resize clamps at **272 px** with compact tabs (Tpl. / Cont. / Assets / Estilo / Elem.) and zero overflow. An open panel is 229 px wide (slider 89 px).
  - A real double-click on the titlebar minimized it (38 px); a second restored it (525 px).
  - After restore, drag (1069→807), horizontal resize (272→377) and vertical resize (525→420) all worked.
- **Template anatomy:** the Cover lists its 10 elements and 8 slots (including Imagem principal); Info lists its 14 elements and 8 slots.
- **Assets:**
  - Every slot has a thumbnail, an origin, "Usado por" and Trocar; paper and tape show Projeto + Usar padrão.
  - The picker groups "Arquivos do projeto" (paper, tape) and "Imagens geradas".
  - Nothing was uploaded.
- **Hero picker:**
  - Choosing `slide-2-de-2-54d56b3c.png` updated the Canvas at once, and survived Salvar and a reload.
  - Gerar PNG ran on the VPS (execution `c0f0f743…`, queue 8 s / render 23 s). The snapshot froze `assetOverrides.hero = b1560c65…` and `manifest.assets.hero = library_file:b1560c65…`, with no signed URL. The PNG shows the chosen image as the hero.
- **Slot replacement:** the ornament slot was set to the tape LibraryFile; the preview used `contain`; the VPS render `d9ece1f0…` shows it the same way (`evidence/authoring-usability-v1/vps-production-hero-and-slot-override.jpg`). Usar padrão returned both slots to Template.
- **Render state:**
  - The new render was unsaved and offered Salvar nesta peça. Saving it showed **✓ Salvo nesta peça**.
  - A forced second save of the same render returned **200 `alreadyAttached`**, and the database kept exactly one LibraryFile and one media row.
  - Reload kept ✓. An authored edit showed **Alterações ainda não renderizadas**; a new render cleared it and was unsaved again.
  - Gerar PNG never saved the authoring state.
- **Save semantics:**
  - Voltar ao salvo restored the saved values and disabled Salvar.
  - Restaurar padrão do Template showed the required copy and left Salvar active, because Slide 2's saved state differs from the defaults.
- **Viewports:** at 1366×768, 1440×900, 768×1024 and 390×844 there is zero page overflow, the accordion panel, asset cards and anatomy fit, and the Inspector floats on desktop and stacks on tablet/mobile.
- **Cleanup:** the smoke's own attachment (media `beb251d0…` / LibraryFile `148d1bcc…`) was unlinked and trashed. The reference state was restored and saved: Template hero, no overrides, title offset 0.
- **Pre-existing data left untouched:** a duplicate `slide-2-de-2-31c07938.png` attached at position 2, and an unattached LibraryFile `60e6bfe3…`. Both were created before this mission and are left for the owner to decide on.

**Known limit:** for a render *hydrated* after reload, the stale hint compares against the state at load. It is never wrongly shown, but it cannot flag a render made *before* a saved change.
