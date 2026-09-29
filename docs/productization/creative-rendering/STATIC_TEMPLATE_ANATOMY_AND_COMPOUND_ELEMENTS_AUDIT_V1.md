# STATIC_TEMPLATE_ANATOMY_AND_COMPOUND_ELEMENTS_AUDIT_V1

## Audit Context
- **Starting SHA:** 77320afc31c787ae3d7c6930ea35049b6038d430
- **Upstream used (origin/main):** 47037affc4089fffd54d5c80abab484d42de59a0
- **Worktree-sync procedure:** Safe fast-forward to `origin/main` as the local branch had no unpushed commits and no tracked files modified. Foreign untracked files (such as `.js` test scripts and a previously documented `.md` file issue) were kept isolated and safe.
- **Other Worktrees:** Evaluated and confirmed completely untouched (e.g., `discovery-video-ai-generation-product-flow-v1`).

## Required Verdict
**1. O Template atual está excessivamente fechado por qual razão factual?**
Porque grande parte da composição não mapeia 1:1 com controles de UI editáveis independentes. Muitos textos e ícones são renderizados rigidamente como sub-filhos fixos dentro de um componente aglutinador (`AssetLayer` ou `ElementGroup`) de onde herdam transformações, e diversos outros textos importantes da narrativa (ex: `intro`, `body`, `eyebrow`, `source`) são tratados estritamente como `fixedText` sem chave no `stack.zIndex`, impedindo qualquer reordenamento, rotação, ou escala independente.

**2. Quais visual units estão escondidas dentro de compound layers?**
Múltiplos campos de texto. Por exemplo:
- Conteúdo de texto e linhas divisórias dentro dos fact cards ("Cartão 1" e "Cartão 2" do *InfoVariant*).
- Textos de notas dentro de "Nota da edição" (*CoverVariant*), "Nota do mapa" (*MapVariant*) e "Papel da legenda" (*ListVariant*).
- Frases de citação e aspas decorativas ("Papel da citação" do *QuoteVariant*).
- Títulos, textos e ícones em callouts ("Caixa de destaque" de vários _Variants_).
- SVG estruturado combinado com Nodes de texto ("Cartões da rede" do *NetworkVariant*, "Grade de temas" do *GridVariant*, e "Mapa do Brasil" do *MapVariant*).

**3. Quais realmente precisam ganhar identidade separada?**
Os conteúdos de Texto (Quotes, Legendas, Textos descritivos nos callouts ou fact cards) e Ícones. A identidade separada permitiria manipulação espacial (escala, posição), tipografia específica independente ou simplesmente exclusão flexível. 

**4. A UI deveria mostrar Template Anatomy hierarquicamente?**
Sim. Hoje o conceito de uma "Entidade Pai" (como um Hero ou Layer de Destaque) perde aderência porque a imagem, fita e legenda estão planificadas. Apresentar a anatomia como subárvores de gramática do template educará o usuário sobre o que cada grupo constrói logicamente.

**5. A aba Elementos deveria usar sections/folders derivados?**
Sim, para o Template, *folders* devem ser apenas projeções derivadas (UI-only boundaries) que contêm de grupos naturais em vez de entidades genéricas explícitas salvas num banco como `Group`. Para Free mode, os novos `Custom Elements` podem habitar um *folder* separado de "Elementos adicionados" na V1.

**6. Template-backed composition pode receber Custom Text/Image sem abandonar a gramática do Template?**
Sem dúvida. Projetando a anatomia rigorosa do Template em seu z-index base e adicionando os Custom Elements flutuando organicamente acima ou aninhados sem destruir a camada rígida inferior.

**7. Qual é o menor persistence evolution necessário?**
Acrescentar uma coleção isolada (ex: `elements: ElementInstance[]`) na entidade de `Slide` baseada em Template (o que hoje só persite `template: TemplateState`), ou simplesmente expandir o payload para o mesmo padrão do `Free`.

**8. Podemos começar Custom Elements numa overlay layer acima do Template?**
Sim. Renderizar os Elementos Customizados no topo da pilha do canvas (overlay) é a estratégia *additive* mais segura para um MVP (V1) em intersecção com a rígida *paint order* dos `AssetLayers` do Template. 

**9. Free e Template podem compartilhar quais primitives/capabilities sem criar Universal Element?**
- Capacidade de renderização: Texto nativo e Imagem nativa.
- Interação: Lógicas de seleção (bounding boxes), manipulação de âncoras (drag), resize.
- Lógicas adjacentes de Design: Style roles, seletores de fonte, visibilidade e opacidade de componentes.
A assimetria persiste na autoria geométrica e definição da gramática.

**10. Qual microtarefa deve vir imediatamente depois?**
`STATIC_TEMPLATE_CUSTOM_ELEMENTS_V1`.

---

## Findings Tables

### TABLE A — Layout Anatomy

| Layout | Section | Visual unit | Current technical source | Current stable identity | UI representation today | Recommended future identity | Reason |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Cover** | Hero | `AssetSurface` (Imagem principal) | `AssetLayer` + `context.assets.hero` | `hero` | 1:1 image slot | Maintain current | Conceptually clean, but isolated scaling. |
| **Cover** | Hero | "Fita da imagem" (Tape) | `AssetLayer` + `materialUrl('tape')` | `tape1` (or tape) | 1:1 element | Maintain current | Decorative primitive. |
| **Cover** | Title | "Papel do título" | `AssetLayer` + `materialUrl('tornPaper')` | `paper` | 1:1 decoration | Maintain current | Serves as background. |
| **Cover** | Title | "Título" | React `div` (absolute layout) | `title` | Text field | Decouple to manipulable node | Currently positioned independently of the paper. |
| **Info** | Content | Texts `intro`, `body_blocks` | `div` maps inside layout | `none` (`fixedText`) | Form inputs | Promote to independent node | Trapped as fixed coordinates. |
| **List** | Callout | "Caixa de destaque" | `AssetLayer` | `callout` | Forms (icon, text) | Break into Backing + Text/Icon elements | The text cannot be moved independently of the backing dark paper. |
| **Map** | Diagram | "Mapa do Brasil" | `svg` nested inside `ElementGroup` | `card1` / `map` group | Single UI handle | Expose parts if needed | Granular pin manipulation could be desired. |
| **Quote** | Focal | "Papel da citação" | `AssetLayer` | `quote` | Singular entry | Break into Backing + Text Element | It locks the quote text spacing exactly inside the torn paper. |

### TABLE B — Compound Layers

| Current layer | Contained visual units | Should split? | Why? | Persistence impact | Renderer impact |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Cartões (Info)** | Paper background, Primary text, Separator, Secondary text | **Yes** | User needs to resize/move text inside paper and not treat it as a frozen JPG. | Move text data from `templateState` parameters to floating text objects. | Significant: The background remains `AssetLayer`, texts render outside via Shared Text Capability. |
| **Nota da edição (Cover), Legenda (List)** | Paper scrap, Note Text | **Yes** | Rigid font-size formatting. Doesn't allow adjusting line-height natively vs the background. | Need to decouple field `detail_note` or `image_caption` to elements. | Text becomes distinct text primitive overlaying `note` layer. |
| **Caixa de destaque (List, Network, Quote)** | PaperDark, Icon, Bold text, Bullets | **Yes** | Tightly couples icon graphic to text and forces a single horizontal geometry. | Converts object `callout: { icon, text, bullets }` to distinct instances. | High: needs grouping rendering logic if they remain tied, or pure uncoupled free text. |
| **Cartões da Rede (Network)** | SVG Links, Text blocks, Scrap Papers | **No (for V1)** | The visual grammar defines the layout logic natively; tearing it apart breaks the template's graph value. | Zero. | Zero. Should REMAIN internal implementation detail. |

### TABLE C — Capability Ownership

| Capability | Free | Template | Shared candidate | Persistence owner | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Text Rendering / Font Picker** | Full | Hardcoded tokens | **Yes** | *Hybrid* | `Custom Elements` on Template uses Free rules; strict schema text uses Template rules. |
| **Image Rendering (`AssetSurface`)**| Full capability | `assets.hero` tied | **Yes** | Owner | Can reuse identical core to fetch LibFile. |
| **Drag / Resize Limits** | Intrinsic Boxes | Strict `transformKey` | **Yes** | Hybrid | Free elements can use the exact same interactor bounding box system. |
| **Z-Order/Paint Order** | Full sorting | `element-stack.ts` map | **No** | Separated | Template defines anatomical base order, Custom floats around it. |

### TABLE D — Next Microtasks

| Task | Problem solved | Expected files/surfaces | Architecture risk | Recommended model | Order |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`STATIC_TEMPLATE_CUSTOM_ELEMENTS_V1`** | Template limitation/closedness. Brings Custom Text/Image to Template mode. | `DocCard` schemas, `composition-mode-panel` | Low (additive) | Overlay pure Free `ElementInstance`s on top of Template renderer. | 1 |
| **`FONT_PICKER_VISUAL_PREVIEW_V1`** | Improves UX for font selection observed during smoke tests. | `font-picker.tsx` or similar typography components | Low | Registry mapped preview fonts. | 2 |
| **`FREE_IMAGE_RESIZE_AND_CROP_INTERACTION_V1`** | Separates Element Resize from internal crop/pan manipulation. | Image element editor logic | Medium | Dedicated "Crop mode" boundary handle. | 3 |

---

## Other Considerations

**Static-first / Video-aware implications:**
The evolution to decoupled custom elements currently serves Static layout needs. For Video, any Custom elements would need a default `Element Timing` policy (likely 100% visibility over the `Slide` duration) so the temporal renderer does not drop them. The `Scene` representation remains structurally protected.

**Template ownership note:** 
Currently, layout code (e.g., `components/creative/documentary-card/`) couples layout rendering highly to the "Portal Comunidades Alternativas" visual reference pack (`EditorialDocumentaryCollage`). Making this a dynamic project-scoped element is viable, but decoupling should only occur post additional layout carousels are tested.

**Foreign code preservation:**
No modification attempted on `docs/productization/creative-rendering/VIDEO_AUDIO_AUTHORING_V1.md` as instructed. It's safe across worktrees.