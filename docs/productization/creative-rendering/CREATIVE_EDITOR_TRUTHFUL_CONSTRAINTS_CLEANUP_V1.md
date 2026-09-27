# CREATIVE_EDITOR_TRUTHFUL_CONSTRAINTS_CLEANUP_V1

A bounded UX, information-architecture and accessibility cleanup of the Creative Editor. It follows:

- CREATIVE_EDITOR_CONSISTENCY_AND_MODELING_AUDIT_V1 (the audit's "M2");
- CREATIVE_EDITOR_FREE_DEFAULT_AND_TEMPLATE_ENTRY_V1 (two composition modes, FREE and TEMPLATE; FREE by default).

The goal is not to make Static and Video identical. When two controls express the same user intent, they should be understandable, accessible and semantically consistent, and every constraint should be stated as a constraint.

- **Migration:** NONE.
- **Worker:** UNCHANGED.
- **Render contracts, persistence and domain model:** UNCHANGED.

## 1. Checkpoints

- **Start:** `3653a7220ed5b2d23bffb6f112f53ad7a7741746`, equal on local, `origin/main` and remote `main`. It is the closure of the Free-default mission.
- **Baseline:** 100 files / 1383 tests; `tsc` clean; ESLint 0 errors / 42 warnings; build passing.
- **Foreign file:** `docs/productization/creative-rendering/VIDEO_AUDIO_AUTHORING_V1.md` carries a pre-existing foreign one-line edit. It was left untouched and never staged.
- **Implementation:** `0f98e72e965da28d0dd5a8ceb9c587cc47160b18` → Vercel Production `dpl_BUadCb2nQunyyAnko97ccgb4R7bi`, READY, aliased to `content.multihuman.com.br`.
- **Final SHA:** the docs commit recording this validation. The next mission's housekeeping prints it.

## 2. Reconciliation of the earlier findings against `3653a72`

The old findings were re-checked against executing code, not replayed.

| # | Old observation | Fact at `3653a72` | Action | Final status |
|---|---|---|---|---|
| 5.1 | Static shows a Template combobox, Video shows the name as text | Both repeated the Template below the new "Composição atual" panel. Static's one-option `Select` also called `setTemplateId` directly, **bypassing the confirmed Template-entry path**. | Removed the Static `Select` and the duplicated Video name; the mode panel is the only place that names and changes the Template. | **Fixed** |
| 5.2 | Static Layout/Appearance lack group semantics | Still plain buttons (Video: `radiogroup` + `aria-checked`); the add-slide dialog used `aria-pressed` groups. | Static tab and add-slide dialog → `role="radiogroup"` with `role="radio"` + `aria-checked`; visuals unchanged. | **Fixed** |
| 5.3 | Compact Inspector tab labels / squeezed Inspector | Both editors already expose `aria-label={section.label}`, with compact text `aria-hidden`. The ~100 px squeeze reproduces only in the automation browser (§8) and not in the owner's normal browser. | None. | Resolved / environment artifact |
| 5.4 | Template anatomy vs layout anatomy vs Elementos | Model valid. Both anatomies were always expanded, and the layout list read "Elementos" / "Assets / slots" like the editable tabs. | New `TemplateReference`: one collapsed `<details>` "Estrutura do template e do layout (referência, somente leitura)" that points to Elementos and Assets for editing; labels "Elementos do layout" and "Slots de assets". Same component in both editors. | **Fixed** |
| 5.5 | Free selection synchronization | Video: an Elementos row set only `openElementId` (Player chrome) while the timing section follows `selectedElementId`; a Scene switch or Scene removal kept a stale `openElementId`; a removed element could stay selected. Static Free: a slide switch kept a slide-local open id. Mode switches already cleared both (previous mission). | Bounded helpers, detailed below this table. | **Fixed** |
| 5.6 | Free Assets × Elementos "Trocar" | One mutation path in both editors. Static copy was already truthful; Video still said "Troque ou ajuste cada uma em Elementos" beside its own Trocar. | Video copy: "Trocar aqui usa a mesma imagem do elemento; posição, encaixe e timing ficam em Elementos." Both entry points kept; no slots for Free. | **Fixed** (copy) |
| 5.7 | Estilo / Project Identity copy | Already truthful in both modes since the previous mission: "Padrão do Studio… estes valores não vêm dela", plus the Free branch. The Free role labels say "papel do estilo". The only other Identity text is the true "Identity is required to render" error. | None; locked by tests. | Resolved |
| 5.8 | Video Template geometry copy | "Posição, escala e rotação por elemento **ainda não existem** em vídeo" framed the constraint as a missing feature. | "Nas cenas com template, a posição, a escala e a rotação desta camada são definidas pelo layout. Aqui você controla a ordem e a visibilidade." | **Fixed** |
| 5.9 | "Cenas principais" | Accurate (the contiguous primary sequence versus independent B-roll/Texto/Áudio), with an existing help tooltip that explains exactly that. | None. | Keep |
| 5.10 | Galeria vs Arquivos | Refuted earlier (outputs vs LibraryFile media); no new evidence. | None. | Closed |
| 5.11 | Cover temporal chevron | Refuted earlier; Cover still declares no temporal elements. | None. | Closed |
| 5.12 | "Ver vídeo renderizado" | Resolved by code earlier (output dialog). | None. | Closed |
| 5.13 | Motion options "sem efeito visível", `zoom_out`/`dolly`, layout-dependent effects | Requires the capability decision. | None (tests assert that nothing changed). | **Deferred → VIDEO_MOTION_CAPABILITY_TRUTH_V1** |
| 5.13b | Free Scene Motion notice: "o Motion desta versão é desenhado pelo Template" | Confusing for a Template-less Scene; fixable without deciding M3. | "Cenas livres são estáticas nesta versão: o movimento de cena só existe nas cenas com template. Para quando cada elemento aparece, use Timing na cena (Elementos)." | **Fixed** (copy only) |
| 6 | Free/Template labels | Truthful ("Livre · nenhum template aplicado" / "Template · …"); no third state. | None. | Resolved |
| 7 | Empty Free | Hints mentioned adding elements but not the optional Template. | Empty states: "…em branco (composição livre). Adicione um texto ou uma imagem, ou escolha um template na aba Template." The Static canvas hint says the same. | **Fixed** |
| 8 | Static single-piece copy | ZIP, slide nav and add-slide were already carousel-only. The PNG dialog, its thumbnail name, "Gerar PNG" and Restaurar padrão still said "slide". | They now say "arte" outside a carousel ("PNG da arte", "Ver PNG da arte", "desta arte", "à arte"). | **Fixed** |
| 10 | Accessibility (bounded) | The "Usar template" buttons shared one accessible name. Camadas and Free rows already expose `aria-expanded`; the icon-only element actions are named. | `aria-label="Usar o template <nome>"`. | **Fixed** |
| — | Project Identity visual tokens | Adapter still returns Studio defaults. | Not implemented here. | **Deferred → PROJECT_IDENTITY_VISUAL_TOKENS_DISCOVERY_V1** |

**The bounded Free selection helpers (5.5):**
- Video `openFreeElement(id)`: in a free Scene, opening a row in Elementos *is* selecting it. `openElementId` and `selectedElementId` follow the same element; there is no seek (the Timeline row still seeks). Template Camadas keep disclosure-only semantics.
- Video `forgetFreeElement(id)`: removing an element drops both ids if they point at it. The panel now reports removals through `onRemoved`.
- Video: `selectScene`, `selectSceneById` and scene removal also clear `openElementId`.
- Static Free: `switchSlide` clears the open id in free mode only. Template Camadas keep their disclosure across slides, because element ids are shared by slides of the same layout.

## 3. What was deliberately kept (do-not-change)

- Static Canvas vs Video Player; the slide strip vs Cenas/Timeline.
- Template-owned geometry vs Free boxes (no geometry controls were added to Template elements).
- Template Asset Slots vs Free direct LibraryFile binding (no slots for Free).
- Fixed Template anatomy vs Free add/remove.
- No timing or Motion in Static; Scene vs root temporal item; Element vs Track.
- `openElementId` (disclosure) and `selectedElementId` (temporal/spatial context) stay distinct states. There is no universal SelectedObject; only the user actions that clearly imply both now set both.
- No Template Builder: the reference is read-only, collapsed and points to the editing tabs.

## 4. Files changed

- `app/(dashboard)/projetos/[id]/conteudos/[editorialContentId]/channel-pieces/[channelPieceId]/editar-visual/page.tsx`: removed the Template `Select`; Layout/Appearance and add-slide radiogroups; `TemplateReference`; single-piece copy; empty-Free hint; free slide-switch reset; `onRemoved`.
- `app/(dashboard)/creative-editor/video/[draftId]/page.tsx`: no duplicated Template name; `TemplateReference`; Template-geometry, Free-Assets and Free-Motion copy; `openFreeElement` / `forgetFreeElement`; Scene-switch and Scene-removal resets.
- `components/creative/authoring/inspector-panels.tsx`: `TemplateReference`; "Elementos do layout" and "Slots de assets" labels.
- `components/creative/authoring/composition-mode-panel.tsx`: accessible name per "Usar template".
- `components/creative/video/free-scene-panels.tsx`: `onRemoved`; empty-state orientation copy.
- **Tests:**
  - new `lib/creative/authoring/__tests__/truthful-constraints-cleanup.test.ts` (21 tests);
  - new `components/creative/video/free-scene-panels.test.tsx` (5 tests, jsdom);
  - extended `composition-mode-panel.test.tsx`;
  - `authoring-usability.test.ts` and `static-parity.test.ts` updated to the new contract.

No file under `remotion/`, `infra/`, `scripts/`, `lib/schemas/`, `lib/render-execution/` or `app/api/` changed, and neither did the persistence contract (`carousel-state.ts`).

## 5. Tests and gates

- **Focused tests:** 28 pass (the node suite, the free panel on jsdom, the composition panel on jsdom). They cover:
  - one Template control;
  - radiogroup semantics;
  - accessible names on tabs and Template buttons;
  - the reference collapsed and read-only with truthful labels;
  - constraint copy for Template geometry, Free Motion and Free Assets;
  - Estilo never claiming Identity resolution;
  - the empty Free state as orientation;
  - Motion untouched (M3);
  - single-piece copy;
  - bounded selection helpers (Video and Static);
  - panel disclosure and removal events.
- **Full suite:** 102 files / 1407 tests.
- `tsc --noEmit`: clean.
- **ESLint:** 0 errors, 42 warnings (unchanged baseline).
- `pnpm build`: success.

## 6. Production proof (`0f98e72`, READY)

**Static Template — real 10-slide carousel `1247e54b…`, read-only**
- The Template tab says "Template · Editorial Documentary Collage", with no combobox.
- Estrutura radiogroup: Cover `aria-checked=true`, the others false. Aparência radiogroup: Dark true.
- The reference is collapsed. Expanding it shows "Elementos do layout" / "Slots de assets" and leaves the piece "Salvo".
- Slide 3 shows Lista checked.
- Tabs: Template/Conteúdo/Assets/Estilo/Elementos by accessible name. Still "Salvo".

**Static Free — the free carousel `b2518238…` and the story `808dbc66…`**
- On empty slide 1, the canvas and Elementos read "Slide em branco (composição livre)… ou escolha um template na aba Template."
- Slide 2: opening the row selected the same element on the canvas (one id).
- Switching to slide 1 cleared both, and returning to slide 2 did not resurrect a stale selection.
- A canvas click on the element opened Elementos with that row disclosed and the element selected.
- Template, Assets and Estilo copy is truthful ("hoje, o padrão do Studio", "Trocar aqui usa a mesma imagem do elemento", "estes valores não vêm dela"). Never dirtied.

**Video Template — draft `7fe4cf8e…`, Scene 2**
- The mode panel names the Template once, with the per-Scene note "cada cena pode usar o template ou ser livre".
- Estrutura radiogroup: Cover checked. The reference is collapsed.
- Camadas panel: "Nas cenas com template, a posição, a escala e a rotação desta camada são definidas pelo layout…".
- The Template Motion copy is unchanged (M3). Clean.

**Video Free — same draft, Scene 1**
- Opening the row → Player chrome, open row and timing section all on `822b7f2a…` ("Elemento Texto · … da cena 1").
- Scene 2 → none. Back to Scene 1 → none (no stale state).
- Removing the element cleared all three. "Voltar ao salvo" restored the saved draft (clean).
- Free Assets and Free Motion copy as in §2.
- "Nova cena" showed "Cena em branco (composição livre)… ou escolha um template…" and "Livre · nenhum template aplicado"; reverted (2 Scenes, clean).

No production data was modified by this mission. Every exploratory edit was reverted with "Voltar ao salvo".

## 7. Responsive (production, fresh load per width)

Surfaces checked: Static Template (real carousel), Static Free single piece (story), Video (mixed draft).

| Width | Page overflow-x | Tabs by accessible name | Mode panel + Template/Free choice | Static radiogroups + reference | Elementos reachable |
|---|---|---|---|---|---|
| 1440 | none (all 3) | yes | yes | yes | yes |
| 1024 | none | yes | yes | yes | yes |
| 768 | none | yes | yes (stacked) | yes | yes |
| 390 | none | yes | yes (stacked) | yes | yes |

"Gerar PNG" reads "desta arte" on the story and "deste slide" on the carousel at every width.

## 8. Remaining limitations and observations

- **Automation-browser artifact (not a product change).** The floating Dockview Inspector's inner view intermittently mounts at 100 px inside a correct 358 px palette: three identical loads gave 358 / 100 / 100. It happens on every editor, and it happened before this mission. The product owner confirmed a healthy Inspector in a normal desktop browser. Not treated as a product bug.
- **Deferred to M3:** the Motion option vocabulary and its per-layout truth.
- **Deferred to Project Identity work:** Project Identity visual tokens.
- **Choice-group keyboard behaviour:** radios remain individually focusable buttons (Enter/Space), the same as Video's existing groups. Roving arrow-key focus was not introduced.

## 9. Next

VIDEO_MOTION_CAPABILITY_TRUTH_V1 remains the next mission. It was not started.

CREATIVE_EDITOR_TRUTHFUL_CONSTRAINTS_CLEANUP_V1_COMPLETE
