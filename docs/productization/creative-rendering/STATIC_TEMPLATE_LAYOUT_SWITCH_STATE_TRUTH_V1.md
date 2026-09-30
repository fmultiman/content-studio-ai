# STATIC_TEMPLATE_LAYOUT_SWITCH_STATE_TRUTH_V1

Bounded corrective implementation (Static Template only). Switching Template Layout A → B is now one explicit, deterministic replacement:
Layout-owned authored state resets to the target Layout's own baseline, the Custom Element overlay survives, and a destructive switch asks for confirmation.
Also corrects two audit defects: the Info `tape3` section and the stale Style copy.

## Provenance

| Item | Value |
| :--- | :--- |
| Starting main SHA | `8ccfe2678ec97c4e1386ba445aaa512ab4997780` (merge of audit PR #59) |
| Audit | `STATIC_TEMPLATE_VISUAL_UNIT_AND_ELEMENT_COVERAGE_AUDIT_V1` — commit `b396adaa2c3ec1bd0709706172decab77c178b7a`, PR #59, merged as `8ccfe26` before implementation began (docs-only, verified from the PR file list) |
| Branch | `feat/static-template-layout-switch-state-truth-v1` (same worktree as the Static work) |

## The defect (CURRENT FACT before this change)

`authoringReducer` `SET_VARIANT` reset `contentOverride`, `heroRef` and `elementOrder` only. It kept `primitiveTransforms`, `tuning`, `hiddenElements`,
`assetOverrides`, `primitiveSelection` and the Custom `elements`. Transform channels and element ids (`tape1`, `note`, `paper`, `callout`, `card1`, …) are reused across layouts with *different* meanings, so a moved `note` or a hidden `tape1` of the Cover
silently applied to a different visual unit of the next Layout, and a Cover hero override could re-appear as another Layout's image.

## State ownership classification (final)

Classified from how each field is consumed by the reducer, persistence schema and renderer, not from its name.

| Field | Class | On Layout switch |
| :--- | :--- | :--- |
| `variant` | LAYOUT-OWNED (the switch target) | set to target |
| `contentOverride` | LAYOUT-OWNED (per-layout schema) | target's baseline content |
| `heroRef` | LAYOUT-OWNED (content image of that layout) | cleared |
| `primitiveTransforms` | LAYOUT-OWNED (channel-keyed, meaning differs per layout) | all channels default |
| `tuning` (`hero`, `title`, `source`) | LAYOUT-OWNED | defaults |
| `hiddenElements` | LAYOUT-OWNED (Element ids of the old Layout) | cleared |
| `elementOrder` | LAYOUT-OWNED | cleared (target's default stack) |
| `assetOverrides` | per-instance overrides (see asset decision) | cleared |
| `primitiveSelection` (Project paper/tape) | per-instance selection | target's normal baseline |
| `appearance` | Layout-**scoped** choice within the Template | kept when supported, else target default |
| `elements` (Custom Text/Image) | COMPOSITION-INSTANCE overlay | **preserved unchanged** |
| `canvas`, `identity`, `productContext` | COMPOSITION-INSTANCE / context | preserved |
| `debugPanelOpen`, Elementos open row, Layout confirmation | UI-ONLY | preserved / not authored |

## Exact Layout-switch semantics

`replaceTemplateLayout(state, layoutId, templateId)` in `lib/creative/authoring/layout-switch.ts` (pure):

1. Same Layout, or a Layout the Template does not define → returns the **same state reference** (no partial switch).
2. Otherwise the target baseline is exactly what "Adicionar slide" builds: `createTemplateSlide` → `persistedSlideToAuthoringState` (so the result equals a fresh slide of that Layout and what a save + reload yields; the `brand_label` derived from the live Project name is applied like on load).
3. The Layout-owned fields above are taken from that baseline; `heroRef`, `elementOrder`, `hiddenElements`, `assetOverrides` are dropped; everything else (Custom `elements`, canvas, identity, productContext, UI state) is carried through unchanged.

The reducer's `SET_VARIANT` now delegates to it (optional `templateId` on the action). No generic state-transition framework was added.

## Decisions

- **Custom Elements: preserved.** Code evidence agrees with the working expectation: Custom Elements live in `elements`, a separate persisted key validated independently (`validateFreeCompositionShape`), rendered as an overlay *above* the Template, never referenced by Layout Element ids, transform channels or `elementOrder`. Text content, semantic roles, LibraryFile binding, geometry and overlay order survive byte-for-byte. They are not merged into Template state.
- **Appearance: preserved when supported.** Appearance is a Layout-scoped choice from `supportedAppearances`. It is kept if the target supports it, else the target's `defaultAppearance` (the existing `createTemplateSlide` rule). Today all 8 Documentary layouts support both, so the fallback is currently unreachable but implemented and tested; no cross-layout mapping is invented.
- **Content: no migration.** The target starts from its own default content. No field is mapped by name (`Cover.title` does **not** become `Lista.title`). No shared-field contract exists for Static. *Reported for completeness:* Video's `setSceneLayout` carries the Scene title over — that is a Video-specific contract and was not reused or changed.
- **Assets: per-instance overrides reset.** `assetOverrides` (including `hero`) and `primitiveSelection` do not survive. Slot ids are Template-scoped and there is no explicit cross-layout override contract for per-instance choices (and `heroRef` was already reset while `assetOverrides.hero` leaked). Using the same *Template default* resource in the target Layout is unaffected. No Asset Slot was redesigned. (Product note: a user who wanted one paper/tape across the carousel would need a carousel-level choice, which does not exist today.)
- **Transforms / visibility / order: target baseline.** New Layout gets neutral transform channels, no hidden ids and its own default stack; no id from the previous Layout remains.
- **Confirmation.** `hasLayoutOwnedAuthoredWork(state)` compares Layout-owned state with the Layout's own baseline (content, tuning, any non-neutral transform channel, hidden ids, non-default paint order, hero/asset overrides, Project paper/tape choice). Only then does the Layout radio open `LayoutSwitchDialog` (existing `AlertDialog` pattern): *"Trocar o layout substituirá o conteúdo e os ajustes específicos do layout atual."* plus *"Os elementos adicionados (texto e imagem) são mantidos."*, actions **Cancelar** / **Trocar layout**. A pristine slide switches immediately. Custom Elements alone never trigger it. Cancel dispatches nothing; confirm dispatches exactly one `SET_VARIANT`. The selected Template row of the old Layout is closed on switch; a selected Custom Element stays selected. Dialog state is UI-only.
- **Free ↔ Template untouched.** The Template selection/mode panel, `enterFree`, `enterTemplate`, Static Free, Video Free and Video Template were not modified (a test asserts the switch module has no Free/Video references).

## Audit defect #1 — Info `tape3`

Confirmed against code before changing: `tape3` "Fita inferior" is drawn at (48, 1012) rotated 16°, while Cartão 2 spans x 588–992, y 820–1172; the Pack B reference shows the bottom-left tape holding an illustration the code does not draw. `template-anatomy.ts` now lists it under **Decoração** (`botanicalLeaf, botanical, tape1, tape2, tape3, archival`); Cartão 2 is `paper, pin2`. Registry metadata only; no authored-state semantics changed.

## Audit defect #2 — stale Style copy

`StyleSourcePanel` no longer says the Project Identity "ainda não define tipografia nem cores visuais". Verified in `project-identity-adapter.ts` that `identity.visuals` typography and colours are adopted token by token, else the Studio defaults. New copy: *"Identidade do Projeto. A tipografia e as cores abaixo vêm da Identidade do Projeto quando ela as define; o que ela não define usa o padrão do Studio."* followed by the real precedence (Free: roles use these values directly; Template: fonts follow these values, background/text colours follow the Template Appearance). Read-only, no new controls. The two tests that asserted the false sentence were rewritten to assert the true one; an added test proves explicit visual tokens change the adapter output while free-text identity does not. The stale `@doc` comment was corrected too.

## Impact

| Area | Impact |
| :--- | :--- |
| Persistence / migration | **NONE.** No schema, key or SQL change; same ChannelPiece-owned Static authoring state. The change is transition semantics only. |
| Renderer | **NONE.** No file under `components/creative/documentary-card/` changed. |
| Worker | **NONE.** No worker-exported file changed (`layout-switch.ts` and `template-anatomy.ts` are not in `export.mjs`; a test asserts it). No VPS action. |
| Render request / contracts | Unchanged. |
| Video | Unchanged. |

## Files

`lib/creative/authoring/layout-switch.ts` (new) · `lib/creative/authoring/reducer.ts` · `lib/creative/authoring/index.ts` · `components/creative/authoring/layout-switch-dialog.tsx` (new) ·
Static editor page (Layout radio → `requestLayoutSwitch`, dialog) · `components/creative/authoring/inspector-panels.tsx` (Style copy) · `lib/creative/templates/template-anatomy.ts` ·
tests: `layout-switch.test.ts` (new, 31), `layout-switch-dialog.test.tsx` (new, 4), `template-anatomy.test.ts`, `authoring-usability.test.ts`, `truthful-constraints-cleanup.test.ts`.

## Tests and validation

- Domain tests around the transition function: transforms/tuning, hidden ids, paint order, asset overrides + hero ref + Project paper choice reset; target baseline equals a freshly added slide; no content mapping; Custom Text/Image (content, LibraryFile id, geometry) survive; canvas/identity/context preserved; Appearance kept/fallback; A → B → A determinism; no-ops keep the same reference; all 56 ordered Layout pairs; persistence round-trip of the switched slide carries no Layout-owned residue; a legacy 10-slide Documentary carousel (no `tuning.source`, no optional keys) still parses and every slide can switch; `hasLayoutOwnedAuthoredWork` false for pristine/Custom-only and true for each kind of Layout-owned work; Free/worker/render-contract guards.
- Dialog tests: hidden until pending; names target and states what is replaced/kept; Cancel performs nothing; confirm fires once.
- Registry test: Info `tape3` resolves under Decoração. Style tests: new true copy, false sentence gone.
- Focused suites (authoring, components/creative, templates, video-editor): 41 files / 713 tests green. **Full Vitest: 161 files / 2616 tests passed.** `pnpm tsc --noEmit`: clean. `pnpm lint`: 0 errors (43 pre-existing warnings, none in changed files). `pnpm build`: succeeded.

## Bounded local UI validation

No Auth shortcut and no data mutated. A temporary, uncommitted `/dev/*` harness (deleted afterwards) rendered the real reducer, `hasLayoutOwnedAuthoredWork`, `LayoutSwitchDialog`, the real `DocumentaryCard` preview, `TemplateElementsTab` and `StyleSourcePanel` in `next dev`, driven in the in-app browser.

- Pristine Cover → Info → Cover: switched with **no dialog**.
- Authored Cover (Element offset, rotated tape, hidden `tape1`/`note`, reversed order, tape asset override, one Custom Text) → Info: dialog appeared with the specified copy; state still Cover while open.
- **Cancelar**: state byte-identical to before; dialog `data-state="closed"`.
- **Trocar layout**: Info with `noteOffsetX 0`, no hidden ids, no order, no asset overrides; every rendered Info element carries only its own base rotation (no leaked Cover transform); Info's own default content; the Custom Text still present under *Elementos adicionados*.
- Second cycle (author → confirm → back → author → confirm → back): identical Cover state and identical rendered transforms (deterministic).
- Info anatomy showed `tape3` under `decoration`; the Style panel showed the corrected copy.

Limitation: the browser screenshot call was not used (it hung in earlier missions); verification was DOM/state/accessibility-tree based, and not inside the full authenticated editor.

## Known limitations

- The confirmation compares against the Layout's own baseline; a slide whose Project paper/tape selection differs from that baseline (e.g. created without a primitive catalog) is treated as having work and asks once. This is a truthful over-ask, not a data risk.
- Free composition mode copy in `composition-mode-panel.tsx` still says roles follow the project style "(hoje, o padrão do Studio)". It has the same staleness as the Style copy but belongs to Free mode; left untouched by scope (`truthful-constraints-cleanup.test.ts` still asserts it) and flagged for the next copy pass.
- The dev-only preview page `app/dev/creative-preview` keeps its own reducer and was not changed.
- Per-instance asset overrides cannot be carried across Layouts; a carousel-level material choice is a future decision.
- Cover Element completeness, new Elements, Content field additions, Selection Parity, contextual Styles and font size were not started.

## Next

`COVER_ELEMENT_COMPLETENESS_V1` Part 1 (Cover content coverage, UI-only) per the audit.
