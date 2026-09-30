# STATIC_TEMPLATE_ANATOMY_TREE_V1

Bounded implementation: the Template-mode **Elementos** tab of the Static Creative Editor now explains a Layout as
`Template → Layout → Section → Element`, with Template-owned anatomy and user-added Custom Elements kept distinct.

## Provenance

| Item | Value |
| :--- | :--- |
| Starting SHA (`origin/main` at branch creation) | `5e213b973cc02bbb8012926380510bd54cf1a33f` (merge of PR #55) |
| Modeling source | `CREATIVE_EDITOR_INSPECTOR_AND_TEMPLATE_ANATOMY_MODEL_V1.md` in commit `1a7ee0fbf8de7e614649e48682b88ee662f65107`, published to `main` via PR #55 (merge `5e213b9`) before this work started |
| Branch | `feat/static-template-anatomy-tree-v1` |

The modeling commit was **not** in `origin/main` at pre-flight (`a5870ff`), so implementation paused, the docs-only audit was
published and merged (PR #55), `origin/main` was refreshed, and only then was this branch cut.

## Registry representation

`lib/creative/templates/template-anatomy.ts` (new, pure, dependency-free):

```ts
type TemplateSectionDefinition = { id: string; label: string; elementIds: readonly string[] }
// templateId → layoutId → sections[] (display order)
resolveLayoutSections(template, layout): { id, label, elements: TemplateElementDefinition[] }[]
```

- Membership references the **existing** Template Element ids (`TemplateLayoutDefinition.elements`); no identity is invented.
- Resolution is deterministic and total: unknown ids are dropped, an Element claimed twice stays in its first section, and any
  Element no section claims falls into a trailing `Outros elementos` section, so the tree always lists every real Element exactly once.
- It sits **beside** `template-definitions.ts` rather than inside it because the render worker copies that file verbatim
  (`infra/render-worker-runtime/export.mjs`). Nothing the worker or renderer bundles was touched, and a test asserts no
  authoring/persistence/render/worker source imports the anatomy registry.

## Sections implemented (all 8 Layouts)

| Layout | Sections (Elements) |
| :--- | :--- |
| Cover | Bloco de título (title, paper) · Hero (hero, tape1) · Nota editorial (note, tape2) · Decoração (botanical, botanicalLeaf, archival, ornament) |
| Info | Bloco de título (title, paperStrip, paperDark) · Cartão 1 (card1, pin) · Cartão 2 (paper, pin2, tape3) · Fonte e crédito (source) · Decoração (botanicalLeaf, botanical, tape1, tape2, archival) |
| Lista | Bloco de título (title, paperStrip) · Hero · imagem do documento (hero, tape1) · Legenda (note, tape2) · Destaque (callout) · Decoração (botanicalLeaf, botanical, archival) |
| Grade | Bloco de título (title, paperStrip, tape1) · Grade de temas (tiles) · Ideias transversais (note) · Decoração (botanicalLeaf, archival) |
| Mapa | Bloco de título (title, paperStrip) · Mapa (map) · Nota do mapa (note, tape1) · Decoração (botanicalLeaf, botanical) |
| Rede | Bloco de título (title, paperStrip) · Rede (cards) · Destaque (callout) · Decoração (ornament) |
| Citação | Bloco de título (title, paperStrip) · Citação (quote, tape1) · Hero · imagem (hero) · Destaque (callout) · Decoração (botanicalLeaf) |
| Encerramento | Bloco de título (title) · Convite (note, tape1) · Decoração (ornament, botanicalLeaf, botanical) |

The illustrative tree in the mission (Kicker, Número/Sequência, Crédito, Marca) was **not** used: those units are internal chrome
in the current renderers, not registered Elements, so they are deliberately not exposed. Compound Elements (Info cards, Network cards,
Grade tiles, Map, Quote paper) remain single rows; decomposing them is a separate mission.

## Section non-persistence

Sections are derived registry/UI metadata only: no persisted authored state, no Group entity, no scene-graph node, no DB column,
no save/reload effect, no renderer/worker consumption. Section expand/collapse is component-local `useState`; it is never dispatched
and cannot dirty authoring (asserted by test: no callback fires). Switching Layout resets the tree to fully expanded.

## Template anatomy vs Custom Elements

The tab has three sections that are never merged into one collection:

1. **Anatomia do template** — Template-owned Elements grouped by Section. Rows reuse the existing controls only: eye (visibility),
   row toggle (opens the element's existing control panel via the page's `renderElementPanel`). No lock icon or invented control;
   "not independently editable" is simply "no control shown".
2. **Adicionar elementos** — the author actions `Texto` / `Imagem da Biblioteca` (`FreeElementAddActions`, Text and Image only).
3. **Elementos adicionados** — the actual Custom Element instances (`FreeSceneElements`), or the empty state
   *"Nenhum elemento adicionado a este slide…"*. The stale *"Slide em branco (composição livre)"* copy no longer appears in Template mode.

`FreeSceneElements` gained two optional props (`hideAddActions`, `emptyMessage`); with neither passed, Free and Video render exactly as before.

## Paint-order handling

The FRENTE/TRÁS truth is preserved, not replaced. Semantic anatomy is primary; real paint order lives in a collapsed
**Ordem das camadas (frente → trás)** block, which is the existing `ElementLayers` in a new `orderOnly` mode (grip drag /
ArrowUp/ArrowDown, "Ordem padrão", Frente/Trás markers; no eye and no disclosure, since the tree owns those). It dispatches the same
`SET_ELEMENT_ORDER` / `RESET_ELEMENT_ORDER`. No cross-section reorder was introduced (a Section is not a paint unit),
`element-stack.ts` is untouched, and Custom Elements stay the overlay plane above the Template with no interleaving.

## Files changed

- `lib/creative/templates/template-anatomy.ts` (new)
- `components/creative/authoring/template-elements-tab.tsx` (new: `TemplateElementsTab`, `TemplateAnatomyTree`)
- `components/creative/authoring/element-layers.tsx` (`orderOnly`, `title` props; defaults unchanged)
- `components/creative/video/free-scene-panels.tsx` (`FreeElementAddActions` extracted; `hideAddActions`, `emptyMessage`)
- Static editor page (`…/editar-visual/page.tsx`): Template Elementos tab now renders `TemplateElementsTab`
- Tests: `lib/creative/templates/__tests__/template-anatomy.test.ts`, `components/creative/authoring/template-elements-tab.test.tsx`

## Impact

- Persistence / migration: **NONE** (no schema, type or serialization change; no SQL).
- Renderer: **NONE**. Worker: **NONE** (no worker-bundled file changed; no restart).
- Video: unchanged behavior; the shared `FreeSceneElements` default path is covered by its existing tests plus a new default-path test.

## Tests and validation

- New registry tests: the factual Sections of all 8 Layouts; every Element listed exactly once and none invented; unique section ids;
  deterministic and non-mutating resolution (layout definition, including `defaultStackOrder`, unchanged); fallback for an unclaimed Element;
  no persistence/render/worker source imports the registry.
- New Inspector tests: per-Layout tree equals the layout's real Elements; Cover section labels; capabilities preserved (open panel, eye,
  hidden stays listed); no lock affordance; expand/collapse fires no authoring callback; Ordem das camadas is the true front-first stack and reorders through the same callback;
  add buttons under *Adicionar elementos*; Custom Elements only under *Elementos adicionados*; truthful empty state with no "em branco"; Free panel default unchanged.
- Full Vitest: 157 files / 2531 tests passed. `pnpm tsc --noEmit`: clean. `pnpm lint`: 0 errors (43 pre-existing warnings, none in changed files). `pnpm build`: succeeded.

## Bounded UI verification

Authenticated app access was not used (no auth shortcuts). Verification used a temporary, uncommitted local `/dev/*` harness rendering the real
`TemplateElementsTab` and real registry in `next dev`, driven in the in-app browser (harness removed afterwards). Confirmed: switching through all 8 Layouts
produced the factual trees above; a Custom Text added via *Adicionar elementos* appeared only under *Elementos adicionados* (not in the tree); no "em branco" copy; the Inspector scroll
region scrolled (835px content in 518px) with no horizontal overflow. Limitation: the browser screenshot call hung, so this was verified via DOM/accessibility-tree
assertions rather than pixels, and not inside the full Static editor with a saved project.

## Known limitations

- Section labels mix English product terms (Hero) and Portuguese; Layout labels are still the registry's English names.
- Compound Elements are not decomposed; Elements that have no control today show no controls (no lock/unlock model yet).
- No canvas ↔ inspector selection parity, contextual Estilos, or Content grouping (separate missions).
- Static only: Video keeps its own Elementos surface.

## Next recommended microtask

Selection model synchronization (Canvas ↔ Elementos ↔ Conteúdo ↔ Assets), which can target rows by the stable Element ids and
`data-layer-id` / `data-section-id` hooks introduced here.
