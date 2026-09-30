# CREATIVE_EDITOR_INSPECTOR_AND_TEMPLATE_ANATOMY_MODEL_V1

## Audit Context
- **Starting SHA:** a5870ff795552544b8e4d05bc400619da6a59974
- **Upstream used (origin/main):** a5870ff795552544b8e4d05bc400619da6a59974
- **Goal:** Define the factual product model for the Creative Editor Inspector, Template Anatomy, Content, Assets, Elements, and Style tabs. This addresses the product pressure after `STATIC_TEMPLATE_CUSTOM_ELEMENTS_V1` to tell a coherent story across composition modes (Free vs Template).
- **Code Surfaces Inspected:**
  - `lib/creative/templates/template-definitions.ts`
  - `lib/creative/authoring/layout-content-fields.ts`
  - `lib/creative/authoring/render-request.ts`
  - `lib/creative/authoring/types.ts`
  - `lib/creative/templates/element-stack.ts`
  - `components/creative/authoring/element-layers.tsx`
  - `components/creative/authoring/inspector-panels.tsx`
  - `components/creative/authoring/primitive-controls.tsx`
  - `components/creative/authoring/layout-content-form.tsx`
  - `components/creative/authoring/composition-mode-panel.tsx`
  - Various documentation files in `docs/productization/creative-rendering/`

## 1. CURRENT FACT vs EXPERIMENTAL MODEL

### 1.1 The Working Hierarchy Hypothesis: Template → Layout → Section → Element
The mission queried this hierarchy: `Template → Layout → Section → Element`.

**Current Fact:**
- `Template` exists as a structural registry concept (`Editorial Documentary Collage`).
- `Layout` exists (`Cover`, `Info`, `List`, `Grid`, `Map`, `Network`, `Quote`, `Closing`).
- `Element` exists (Authored instances stored in `elementOrder`, controlled by `TemplateElementControl` like `tuning` or `transform`).
- **`Section` does NOT exist in code.** Anatomy is flattened into `anatomy: TemplateAnatomyRegion[]` at the *Template* level (e.g., 'Conteúdo editorial', 'Imagem de conteúdo', 'Materiais de colagem'). Layouts have a flat array of `elements`. Compound elements (like `Cartão 1` in Info, or `Rede` node cards) group visuals internally but have no structural `Section` nodes above them in the registry exposed to the user.

**Conclusion on Section:**
A `Section` (e.g., "Hero", "Title Block", "Footer") is a **metadata concept / derived UI projection** that groups elements for human understanding. It does *not* exist as a persisted `Group` entity in the database or manifest. Introducing persisted `Sections` or `Scene Graph Groups` would violate the *No Universal Scene Graph* principle. `Section` should remain purely as UI metadata in the registry to organize anatomy conceptually.

### 1.2 Anatomy & Editability (Capabilities)
**Current Fact:**
- Editable capabilities are defined by `kind` (`text`, `image`, `material`), `assetSlot`, and `control` (`transform`, `tuning`).
- Some texts are hardcoded into the renderer (fixed text not exposed in `elements` like `note` text inside `paperScrap` in older layouts, though `STATIC_TEMPLATE_CUSTOM_ELEMENTS_V1` began decoupling some).
- The `elements` array in `TemplateLayoutDefinition` defines what the user sees in the Stack (Camadas/Elementos).
- If something is NOT in `elements`, it is internal chrome (e.g., the 1/N label, the gold rules, specific background textures).

### 1.3 Styles & Project Identity
**Current Fact:**
- Template sets its *Appearance* (`light`, `dark`) which forces background/foreground literals, overriding Project Identity.
- Free Elements use `tokens` (`ProjectIdentity`) directly.
- Overrides on Top of Identity? Currently, `ProjectIdentity` defines defaults. The user can't override the style of an *individual* Template text element in the UI (font size, color) unless it's a Custom Element or uses `tuning`.
- `ESTILOS` does not exist as a tab. Style controls (like Entrelinha / Line height) are mixed into tuning sliders inside `Elementos` or the main layout view.

## 2. FINAL FACTUAL TABLES (Based on code analysis)

### TABLE A — Layout → Section → Element Anatomy

*(This table synthesizes the current flat `elements` array into a logical `Section` hierarchy that should be added as *metadata* only, not persisted groups)*

| Layout | Semantic Section (Proposed UI Grouping) | Element (`id`) | Technical Source Code Definition | Current Ident? | Asset Slot | Content Field | Editable/Transformer |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Cover** | Hero | `hero` | `kind: 'image'` | `hero` | `hero` | Image | `tuning(hero)` |
| | Hero Decor | `botanicalLeaf` | `kind: 'material'` | `botanicalLeaf` | `botanicalLeaf` | N/A | `transform(botanicalLeaf)` |
| | Hero Decor | `botanical` | `kind: 'material'` | `botanical` | `botanical` | N/A | `transform(botanical)` |
| | Hero Decor | `tape1` | `kind: 'material'` | `tape1` | `tape` | N/A | `transform(tape1)` |
| | Hero Decor | `tape2` | `kind: 'material'` | `tape2` | `tape` | N/A | `transform(tape2)` |
| | Title Block | `title` | `kind: 'text'` | `title` | N/A | `title` | `tuning(title)` |
| | Title Block | `paper` | `kind: 'material'` | `paper` | `paper` | N/A | `transform(paper)` |
| | Note | `note` | `kind: 'material'` | `note` | `paperScrap` | `detail_note` | `transform(note)` |
| | Frame/Base | `archival` | `kind: 'material'` | `archival` | `archival` | N/A | `transform(archival)` |
| | Frame/Base | `ornament` | `kind: 'material'` | `ornament` | `ornament` | N/A | `transform(ornament)` |

*(Note for brevity: the same logical grouping applies to Info, Lista, Grade, Mapa, Rede, Citação, Encerramento based on their `elements` array in `template-definitions.ts`)*

### TABLE B — Anatomy Node Capability Matrix

| Capability | Meaning | Current Status | Recommended Model |
| :--- | :--- | :--- | :--- |
| `editable` | Can change textual/visual content | Yes (`tuning`, `assetSlot`) | Native to Content/Assets tabs |
| `selectable` | Can click in Canvas/List | Yes (in `element-layers`) | Yes |
| `hideable` | Eye icon in Layers | Yes (`hiddenElements`) | Yes |
| `reorderable` | Drag in Layers | Yes (`elementOrder`) | Yes |
| `transformable` | X, Y, Rot, Scale | Yes (`tuning` or `transform`) | Yes, keep bounded |
| `style-customizable`| Change font, color, weight | No (Template forced) / Yes (Custom Elements) | contextual `Estilos` (see Sec 4) |
| `protected/locked` | Cannot be moved/edited | Implicit (not in `elements` array = locked) | Explicit UI lock |
| `internal` | Drawn by renderer, hidden from UI | Yes (Chrome, rules, default backgrounds) | Keep internal |

### TABLE C — Inspector Tab Responsibility

| Tab | Current Focus | Recommended Focus |
| :--- | :--- | :--- |
| **Template** | (Used to show anatomy) | Renamed to **LAYOUT**: Select layout, see metadata/anatomy *of current layout*, choose appearance. |
| **Conteúdo** | Flat forms | Semantic narrative fields *grouped by logical Section* (e.g. Title Block, Hero). |
| **Assets** | Shows images in slots | Strictly "Which media/resources does this composition use?". Replacing an asset here updates all elements using that slot. |
| **Elementos** | Tree of instances | Add Custom Elements + Reorder/Hide Template instances in a logical tree (or flat list derived from tree). |
| **Estilos** | (Was a panel) | Contextual. If nothing selected: Composition/Template styles (Appearance). If element selected: Element specific overrides (Font, Color, Fit). |

### TABLE D — Style/Identity Inheritance Matrix

| Level | Inherits From | Can Override? | Applies To |
| :--- | :--- | :--- | :--- |
| **Project Identity** | Root (DB) | N/A | Whole project default |
| **Template Default** | Project Identity | Yes (e.g., Appearance forces Dark) | All layouts in Template |
| **Composition (Slide)**| Template Default | Proposed | The specific slide |
| **Element (Local)** | Composition | Proposed | Single element (Text/Image) |

*(Note: Currently, Template Appearance completely replaces Identity. The user request to personalize Template without breaking the system is valid).*

### TABLE E — Selection Synchronization Matrix

| Canvas Click | Elementos Tree | Conteúdo Field | Assets Slot | Estilos Target |
| :--- | :--- | :--- | :--- | :--- |
| Element X | Highlights X | Focuses X's text (if text) | Highlights X's asset (if image/material) | Shows Styles for X |

### TABLE F — Current UI vs Proposed Model

| Current Factual Behavior | Problem | Recommendation | Implementation Impact |
| :--- | :--- | :--- | :--- |
| `TemplateFamilyAnatomy` shows generic template concepts. | Too abstract. Doesn't explain the *Layout*. | Rename to `Layout`, show Section-based anatomy of the chosen layout. | Med (Metadata addition) |
| Conteúdo fields are flat. | Hard to map to visuals. | Group fields by logical Section (Hero, Intro). | Low (UI change) |
| Elementos conflates Custom and Template. | Confusing hierarchy. | Separate `Estrutura do Template` (derived tree) from `Elementos Adicionados` (custom). | Med (UI change) |
| Estilo is global/read-only. | Prison-like restrictions. | Contextual `Estilos`: Slide styles (lock/override) vs Local element styles. | High (Engine wiring) |

### TABLE G — Follow-up Microtasks (Sequenced)

1.  **Template Anatomy Metadata & Content Grouping (Low Risk)**: Add `Section` metadata to `template-definitions.ts` and UI groupings in Content/Elements tabs. No save/schema changes.
2.  **Selection Model Synchronization (Medium Risk)**: Wire Canvas/Elementos/Conteúdo/Assets selection state together in `AuthoringState`.
3.  **Contextual Estilos Shell & Identity Overrides (High Risk)**: Implement the local override capability. Allow a Template element to break out of the Appearance lock and use a specific font/color from `Project Identity` or custom, persisting in `tuning` or new field.
4.  **Bounded Compound-Element Decomposition (High Risk)**: Continue what `STATIC_TEMPLATE_CUSTOM_ELEMENTS_V1` started by liberating texts trapped inside `Cartão 1` (Info/Grid/Network) into explicit `elements`.

## 3. FINAL VERDICT

1.  **Is Template → Layout → Section → Element the recommended model?** Yes, but `Section` MUST remain purely registry metadata (UI projection) to organize the anatomy and content fields. It must NOT become a persisted `Group` entity.
2.  **What exactly is Section?** A human-readable grouping of elements (e.g., "Hero Block") defined in `template-definitions.ts` to make the Inspector understandable.
3.  **Which anatomy units should users see?** Only those registered in `elements` (which have a capability). Internal chrome should remain hidden.
4.  **Which should users be able to edit?** Those with `tuning` or `transform` controls, plus structural texts.
5.  **What does each Inspector tab own?** See Table C.
6.  **Is ESTILOS contextual/global the recommended model?** Yes. Global (Composition) when no element is selected; Contextual (Local Element) when selected.
7.  **What is the recommended Identity → Template → local override policy?** Bounded Override. Project Identity is the root. Template Appearance sets the base override. The user should be able to locally override a specific element's style back to Project Identity or a custom value (persisted locally), but they cannot change the Template's *definition*.
8.  **What selection model should connect Canvas and Inspector?** Bi-directional synchronization. Clicking an element in the canvas selects it in the Elementos tree, focuses its field in Conteúdo (if applicable), and opens its context in Estilos.
9.  **What is the smallest implementation sequence?** See Table G (Metadata -> Selection -> Contextual Estilos -> Compound Element Decomp).
10. **What should explicitly NOT be generalized?** Do NOT build a Universal Scene Graph. Do NOT build a Template Builder in the editor. Do NOT persist `Sections`. Do NOT generalize the renderer to handle arbitrary compound nesting.

CREATIVE_EDITOR_INSPECTOR_AND_TEMPLATE_ANATOMY_MODEL_V1_COMPLETE
