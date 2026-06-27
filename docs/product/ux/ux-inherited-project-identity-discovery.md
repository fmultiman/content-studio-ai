# UX-H2 Discovery - Inherited Project Identity in Production

**Date:** 2026-06-26
**Scope:** Discovery, UX contract and implementation plan for communicating inherited Project Identity in Production.
**Restriction:** No UI, API, database, schema, Prompt Generator, Image Evaluator or migration changes were implemented in this round.

---

## 1. Context

UX-H1 closed the immediate Production continuity hardening. The next gap is conceptual communication:

```text
Project
-> Project Identity inherited by reference
-> Production with local intention/context
-> Image, Video and Editorial Content
```

The system already has a structured Project Identity V1, image prompt generation consumes it, and the Image Evaluator consumes it. The Production workspace, however, still communicates mostly "Project context" and Production intention. It does not yet make the inherited identity visible enough for the user to understand what is active, where it comes from, or which modules actually use it.

The goal of UX-H2 is not to duplicate the Project Identity form inside Production. The goal is to make inheritance visible, understandable, honest, discreet and actionable.

---

## 2. Problem

Current user-facing ambiguity:

- The Project page displays and edits Project Identity, but the Production page does not explain that the identity comes from the Project.
- Production shows `Contexto do Projeto`, not "Identidade herdada" or an equivalent summary.
- Image generation and image evaluation consume structured identity, but the user does not see a clear "identity applied" message.
- Video currently loads Project and Production context but generation is simulated and does not consume Project Identity V1.
- Editorial content and ChannelPiece generation use Project name/description/context and Production title/intention, but not structured Project Identity.
- There is no visible distinction between persistent Project Identity and local Production intention.
- There is no honest UI language for partial, absent, invalid, or legacy-only identity.

---

## 3. Documentary Evidence

### UX audits

- `docs/product/ux/ux-baseline-audit-pre-reconciliation.md` preserved the pre-reconciliation blocker: Images and Videos required a Production while the visible Production path was not yet clear.
- `docs/product/ux/ux-reconciliation-audit-post-project-identity.md` confirmed Production became a multimodal workspace, but Project Identity inheritance remained insufficiently communicated.
- `docs/product/ux/ux-production-hardening-results.md` closed UX-H1 and explicitly deferred "Comunicacao visual da heranca de Project Identity" to UX-H2/UX-H3.

### Project Identity V1

Current normative source: `docs/PROJECT_IDENTITY_V1_IMPLEMENTATION_PLAN.md`.

Confirmed:

- Project Identity V1 is stored on `projects.identity` as JSONB and typed as `ProjectIdentity | null`.
- `normalizeProjectIdentity` is the validation boundary.
- The UI on the Project page has three states: empty, present, and read error.
- The five zones are `foundation`, `relationship`, `expression`, `governance`, and `practice`.
- Image prompt generation uses `buildImageGenerationContext`.
- Image evaluation uses `buildImageEvaluationContext`.
- `context` and `style_profile` remain legacy/transitional fields and were not removed.
- `context`, `style_profile`, `evaluation_mode` and Productions were intentionally kept intact during Project Identity V1.

### Project Identity foundation

`docs/PROJECT_IDENTITY_FOUNDATION.md` states the conceptual model:

- Project Identity is above Productions and artifacts.
- Production Context is temporary and specific.
- A Production should not automatically change canonical Project Identity.
- A Production may adapt dimensions that are adaptable, but this is not yet implemented as a persisted override.
- Versioning is a future need; V1 does not implement a per-Production identity snapshot.

### Production docs

`docs/PRODUCTION_DECISIONS.md` defines context as additive:

```text
system
+ Project context/style
+ Production intention
+ local artifact context
```

It also says more specific layers have higher semantic weight but should not silently erase the general Project layer.

### Divergences or stale documentation

- Some older docs discuss future Production Style Direction and Production evaluation overrides. Current code does not implement a persisted Production identity override, style direction field, or identity snapshot.
- Some older/publication docs use `/publicacoes` as the approved future route, while current UI still includes `/conteudos` flows. This is adjacent, not blocking UX-H2.
- `IMAGE_EVALUATOR_IDENTITY_AUDIT.md` predates M11-E. The current normative state is the later M11-E section in `PROJECT_IDENTITY_V1_IMPLEMENTATION_PLAN.md` plus current code.

---

## 4. Code Evidence

### Project

Files:

- `app/(dashboard)/projetos/[id]/page.tsx`
- `components/projects/project-identity-display.tsx`
- `components/projects/project-identity-form.tsx`
- `lib/project-identity-form-helpers.ts`
- `lib/project-identity-normalizer.ts`
- `lib/schemas/project-identity.ts`

Confirmed in code:

- The Project detail page loads `projects.select('*')`.
- It calls `normalizeProjectIdentity(project.identity)` during render.
- Invalid structured identity becomes `identityReadError` and the Project Identity card displays an error state.
- Empty identity displays "Identidade nao estruturada".
- Present identity displays purpose, audience, visual identity, voice, principles, restrictions and generation preferences.
- The form writes only `identity`; it does not write `context`, `style_profile` or `evaluation_mode`.
- `context` remains visible separately as "Contexto para IA".

### Production

File:

- `app/(dashboard)/projetos/[id]/producoes/[productionId]/page.tsx`

Confirmed in code:

- Production loads the Production through `/api/productions/[productionId]`.
- It separately loads the Project with `projects.select('*')`.
- Therefore `project.identity` is available in the page data, but not currently normalized or displayed.
- The current overview can show `Contexto do Projeto` from `project.context`.
- Production itself currently has `title`, `intention`, `type`, timestamps and Project linkage. No local identity override field is present in the `Production` type.
- The workspace has actions/tabs for overview, images, videos and editorial content.

### Images

File:

- `app/(dashboard)/imagens/page.tsx`

Confirmed in code:

- The page loads Projects with `select('*')`, so `identity` is available.
- Prompt generation normalizes `project.identity`.
- Invalid identity blocks prompt generation with a destructive toast.
- Generation passes `project.context`, `evaluation_mode`, and normalized `identity` to `generateImagePrompt`.
- Evaluation normalizes `project.identity`.
- Invalid identity blocks evaluation with a destructive toast.
- Evaluation sends `context`, `evaluation_mode`, and `identity` to `/api/evaluate-image`.

Supporting files:

- `lib/ai-simulator.ts`
- `app/api/evaluate-image/route.ts`
- `lib/context-compiler.ts`

Confirmed in code:

- `generateImagePrompt` accepts `identity`.
- `buildImageGenerationContext` includes context, purpose, audience, visual identity, voice, principles, restrictions and generation preferences.
- `/api/evaluate-image` validates identity server-side and uses `buildImageEvaluationContext`.
- `buildImageEvaluationContext` includes context, purpose, audience, visual identity, principles, restrictions and generation preferences. It intentionally omits voice.

### Videos

File:

- `app/(dashboard)/videos/page.tsx`

Confirmed in code:

- The page loads Projects and accepts `project` and `production` query params.
- VideoDrafts persist `projectId` and `productionId`.
- Scene prompt generation posts to `/api/videos/scene-prompt` with `description`, `sceneNumber` and `projectId`.
- Video generation is explicitly simulated in the UI.
- No call to `normalizeProjectIdentity`, `buildImageGenerationContext` or another Project Identity compiler was found in the video page.

UX conclusion:

- It is honest to say the Video workspace is connected to the Project and Production.
- It is not yet honest to say structured Project Identity is applied to video generation.

### Editorial Content

Files:

- `app/(dashboard)/projetos/[id]/conteudos/[editorialContentId]/page.tsx`
- `components/publication/quick-flow-dialog.tsx`
- `app/api/channel-pieces/generate-body/route.ts`
- `app/api/editorial-contents/route.ts`

Confirmed in code:

- EditorialContent stores `project_id`, nullable `production_id`, `title`, `body`, `ai_context`, and `status`.
- The detail page loads Projects and Productions and allows editing Project, Production and local AI context.
- Quick Flow can lock `projectId` and `productionId` when launched from Production.
- ChannelPiece generation loads Project `name`, `description`, and `context`.
- ChannelPiece generation loads Production `title`, `intention`, and `type` when linked.
- ChannelPiece generation includes EditorialContent `ai_context`.
- Structured Project Identity is not selected or normalized in `generate-body`.

UX conclusion:

- It is honest to say editorial generation uses Project/Production context and local editorial context.
- It is not yet honest to say structured Project Identity is applied to editorial generation.

---

## 5. Real Inheritance Contract

| Question | Answer | Status |
|---|---|---|
| 1. Is Project Identity always inherited by Production? | Conceptually yes when a Production belongs to a Project; technically Production references the Project, and the page can access `project.identity`. | Confirmed documentally + confirmed in code |
| 2. Does Production copy identity or reference Project? | It references the Project. No copied identity field exists on Production. | Confirmed in code |
| 3. Do later Project changes affect existing Productions? | Yes by current architecture, because Production reads the current Project. No snapshot layer exists. | Inference from code |
| 4. Is there per-Production identity snapshot/versioning? | No. Versioning is documented as future. | Confirmed documentally + confirmed in code |
| 5. Can Production complement identity? | Conceptually via Production intention/context; current persisted complement is `intention` only. | Confirmed documentally + confirmed in code |
| 6. Can Production overwrite any identity dimension? | Not in current code. Future docs discuss adaptable dimensions/Style Direction, but no persisted override exists. | Not implemented |
| 7. Which dimensions are used by Images? | Generation uses context, purpose, audience, visual identity, voice, principles, restrictions, preferences. | Confirmed in code |
| 8. Which dimensions are used by Image Evaluator? | Evaluation uses context, purpose, audience, visual identity, principles, restrictions, preferences; voice is omitted. | Confirmed in code |
| 9. Which dimensions are used by Videos? | None from structured identity were found. Videos use Project/Production ids, draft data and simulated generation. | Confirmed in code |
| 10. Which dimensions are used by Editorial Content? | Structured identity is not consumed in current ChannelPiece generation. Project description/context, Production title/intention and local `ai_context` are used. | Confirmed in code |
| 11. What still uses `context` and `style_profile` fallback? | Image generation/evaluation document fallback behavior; current compiler receives `context`. Current code path no longer passes a separate `style_profile` into the compiler, but legacy docs preserve it as transitional context. Editorial generation uses `project.context`. | Confirmed documentally + code nuance |
| 12. What happens when identity is absent? | Normalizer returns `null`; Project displays empty state; image generation/evaluation continue using available context/defaults. | Confirmed in code |
| 13. What happens when identity is partial? | Normalizer returns only populated zones; compilers omit empty blocks. | Confirmed in code |
| 14. What happens when identity is structurally invalid? | Project displays read error; Image generation/evaluation block with error; Evaluator route returns 400. | Confirmed in code |
| 15. Can UI say "Identidade aplicada" everywhere? | No. It can say this for Image generation/evaluation. For Video and Editorial, say "Disponivel como referencia" or "Contexto do Project disponivel" until those modules consume structured identity. | Confirmed in code + UX inference |

---

## 6. UX Principles

1. Do not duplicate the five-zone form in Production.
2. Use progressive disclosure: short signal first, details behind expansion or link.
3. Inheritance is not copy. Avoid "copiada", "congelada", "snapshot" or "versao usada" until versioning exists.
4. Do not promise non-existent consumption. "Aplicada" only where code consumes identity.
5. Separate identity from intention:

```text
Project Identity = persistent principles and recognizable direction of the Project.
Production = objective, intention and local context of this initiative.
```

6. Communicate honest states: complete, partial, empty, invalid, legacy-only and module-not-consuming.

---

## 7. Interface Alternatives

### Alternative A - Summary card in Overview

Pattern:

```text
Identidade herdada do Project
Resumo das dimensoes relevantes
[Ver identidade completa]
```

Evaluation:

| Criterion | Assessment |
|---|---|
| Clarity | High. Explains source and state. |
| Density | Moderate. Works best in Overview, not every tab. |
| Repetition | Low. One canonical place. |
| False promise risk | Low if module-specific labels are careful. |
| Scalability | Good. Can later show version/snapshot if implemented. |
| Effort | Moderate. Requires summarizer and states. |
| Compatibility | Good with existing card-based Production overview. |

### Alternative B - Compact header indicator

Pattern:

```text
Usando a identidade de Portal Norte
[Ver detalhes]
```

Evaluation:

| Criterion | Assessment |
|---|---|
| Clarity | Medium. Good orientation, weak detail. |
| Density | Low. Very discreet. |
| Repetition | Low. Always visible. |
| False promise risk | Medium if "usando" appears on modules that do not consume identity. |
| Scalability | Good as a status indicator. |
| Effort | Low. |
| Compatibility | Good with current header/breadcrumb structure. |

### Alternative C - Context strip in workspaces

Pattern:

```text
Project: Portal Norte
Production: Campanha multimodal
Identidade: herdada
```

Evaluation:

| Criterion | Assessment |
|---|---|
| Clarity | High for location and continuity. |
| Density | Low to moderate. |
| Repetition | Medium. Appears across Image, Video and Editorial. |
| False promise risk | High unless wording differs per module. |
| Scalability | Good if it becomes a reusable context strip. |
| Effort | Moderate. |
| Compatibility | Good with current return bars in Image/Video and editorial breadcrumb. |

### Alternative D - Progressive combination

Pattern:

- Compact header indicator in Production.
- Summary card in Overview.
- Discreet contextual strip in each workspace with module-specific truth.

Evaluation:

| Criterion | Assessment |
|---|---|
| Clarity | Highest. Separates global inheritance from module use. |
| Density | Controlled through progressive disclosure. |
| Repetition | Manageable if the strip is compact. |
| False promise risk | Low if labels distinguish "Aplicada a geracao" from "Disponivel como referencia". |
| Scalability | Highest. Can later absorb versioning/snapshots. |
| Effort | Moderate, but can be split. |
| Compatibility | Strong. Uses existing header, overview card and workspace bars. |

### Recommended alternative

Alternative D.

Reason: inheritance needs both a stable Production-level signal and contextual honesty inside each workspace. A single card explains the model, but it does not help when the user is inside Image, Video or Editorial. A header-only badge is too thin. A strip-only approach risks overclaiming. The combined approach lets each surface say exactly what is true.

---

## 8. Minimum Summary Content

### Production Overview

Show:

- Source Project name.
- Identity state: complete, partial, empty, invalid or legacy context only.
- Compact summary of populated dimensions:
  - Purpose.
  - Audience.
  - Visual identity.
  - Voice.
  - Count of principles, restrictions and preferences.
- Link to Project Identity.

Do not show the full form.

### Image workspace

Show:

- Project and Production.
- Identity status.
- "Aplicada a geracao" when prompt generation is available and identity is valid/present.
- "Aplicada a avaliacao" when evaluator is active and identity is valid/present.
- Relevant dimensions: visual identity, principles, restrictions, preferences; optionally purpose/audience.

### Video workspace

Show:

- Project and Production.
- "Identidade do Project disponivel como referencia".
- "Geracao de video ainda simulada".
- Do not list "aplicada" dimensions until a video context compiler exists.

### Editorial workspace

Show:

- Project and Production when linked.
- "Contexto do Project e da Production usados na adaptacao" for current ChannelPiece generation.
- "Identidade estruturada ainda nao aplicada automaticamente" unless editorial generation is updated later.
- Relevant future dimensions: voice, audience, principles, restrictions.

---

## 9. Microcopy

### General labels

- `Identidade herdada do Project`
- `Identidade do Project`
- `Direcao do Project`
- `Contexto e identidade`
- `Ver identidade completa`
- `Editar identidade no Project`

### Applied state

- `Aplicada a geracao de imagem`
- `Aplicada a avaliacao de imagem`
- `Usando a identidade de {ProjectName}`
- `Esta Production herda a identidade atual de {ProjectName}`

### Reference-only state

- `Disponivel como referencia`
- `Este modulo ainda nao aplica a identidade estruturada automaticamente`
- `Usa Project e Production, mas ainda nao usa a identidade estruturada`

### Legacy-only state

- `Usando contexto legado do Project`
- `Identidade estruturada ainda nao definida`
- `Contexto livre disponivel para os agentes`

### Partial state

- `Identidade parcial`
- `{n} de 5 zonas preenchidas`
- `Algumas dimensoes ainda nao foram definidas`

### Empty state

- `Identidade nao estruturada`
- `Este Project funciona normalmente. Estruture a identidade para aumentar consistencia entre Productions, imagens, videos e conteudos.`

### Invalid state

- `Identidade com problema`
- `A identidade salva nao pode ser lida. Corrija no Project antes de usar geracao ou avaliacao que dependem dela.`

Avoid:

- `Snapshot aplicado`.
- `Versao da identidade usada`.
- `Identidade congelada`.
- `Aplicada a video` before video consumes identity.
- `Aplicada a conteudo editorial` before editorial generation consumes identity.

---

## 10. States

| State | Production Overview | Image | Video | Editorial |
|---|---|---|---|---|
| Complete identity | Summary + "herdada do Project" | "Aplicada a geracao/avaliacao" | "Disponivel como referencia" | "Disponivel como referencia" unless generation is updated |
| Partial identity | Summary of populated zones + "parcial" | Applied only with populated compiler blocks | Reference only | Reference only |
| Empty identity | Empty state + CTA to structure | Legacy context/defaults only | Project/Production only | Project/Production/context only |
| Invalid identity | Error state + CTA to Project | Block generation/evaluation, as current code does | Reference unavailable | Reference unavailable |
| Legacy context/style only | "Contexto legado disponivel" | Context fallback applies | Context reference only | Project context applies |
| Module consumes identity | Use "Aplicada" | Yes | No | No |
| Module does not consume identity | Use "Disponivel como referencia" | N/A | Yes | Yes |

---

## 11. Recommended Solution

### 11.1 Production header

Add a compact line under or near the Production title:

```text
[Identidade herdada de Portal Norte] [Ver detalhes]
```

If identity is partial:

```text
[Identidade parcial de Portal Norte - 3/5 zonas] [Ver detalhes]
```

If empty:

```text
[Identidade nao estruturada] [Estruturar no Project]
```

If invalid:

```text
[Identidade com problema] [Corrigir no Project]
```

### 11.2 Production overview card

Wireframe:

```text
Identidade herdada do Project
Portal Norte

Esta Production usa a identidade atual do Project como direcao persistente.
A intencao abaixo continua sendo especifica desta Production.

Proposito
Criar uma presenca editorial reconhecivel...

Publico
Gestores, criadores e equipes...

Direcao visual
Editorial, sobria, alto contraste...

2 principios · 3 restricoes · 2 preferencias

[Ver identidade completa] [Editar no Project]
```

Partial:

```text
Identidade parcial do Project
3 de 5 zonas preenchidas

Disponivel: Proposito, Direcao visual, Restricoes
Ausente: Publico, Voz

[Completar identidade no Project]
```

Empty:

```text
Identidade nao estruturada

Esta Production ainda usa o contexto livre do Project e sua intencao local.
Estruture a identidade para melhorar consistencia entre entregaveis.

[Estruturar identidade no Project]
```

Invalid:

```text
Identidade com problema

A identidade salva nao pode ser lida. Os dados foram preservados.
Corrija no Project antes de usar geracao ou avaliacao baseada em identidade.

[Corrigir no Project]
```

### 11.3 Workspace context strip

Image:

```text
Project: Portal Norte · Production: Campanha multimodal
Identidade: aplicada a geracao e avaliacao de imagem
[Ver detalhes]
```

Video:

```text
Project: Portal Norte · Production: Campanha multimodal
Identidade: disponivel como referencia · Video simulado
[Ver detalhes]
```

Editorial:

```text
Project: Portal Norte · Production: Campanha multimodal
Contexto: Project + Production + contexto editorial local
Identidade estruturada: disponivel como referencia
[Ver detalhes]
```

### 11.4 Accessibility

- Badges must not be color-only; include visible text for state.
- The details trigger should be a button or link with accessible name:
  - `Ver detalhes da identidade herdada`.
  - `Editar identidade no Project`.
- Expanded details should have headings (`Proposito`, `Publico`, etc.) so screen readers can navigate.
- Error states should use `role="status"` or visible alert semantics consistent with existing design system.

### 11.5 Responsiveness

- Header indicator wraps below the title on mobile.
- Workspace strip becomes two lines on mobile:

```text
Project: Portal Norte
Production: Campanha multimodal
Identidade: aplicada a geracao de imagem
```

- Overview summary should use a single column on mobile.
- Counts (`2 principios · 3 restricoes`) can collapse into stacked chips.

### 11.6 Do not implement now

- Full five-zone editor inside Production.
- Per-Production identity snapshot/versioning.
- Production-level identity override.
- Production Style Direction persistence.
- Claims that Video or Editorial apply identity automatically.
- Dashboard/sidebar/Gallery reconciliation.

---

## 12. Implementation Plan for UX-H2

### Change 1 - Read-only identity summary helper

- Area: new helper under `lib/` or `components/projects/`.
- Behavior: derive state, populated zones, counts and summary fields from `ProjectIdentity | null`.
- Dependencies: existing `normalizeProjectIdentity`.
- Tests: complete, partial, empty, invalid, no mutation.
- Risk: Low.
- Effort: Small.
- Can implement now: Yes.

### Change 2 - Production header indicator

- Area: `app/(dashboard)/projetos/[id]/producoes/[productionId]/page.tsx`.
- Behavior: normalize Project Identity and render compact inherited identity status.
- Dependencies: Change 1.
- Tests: header copy for complete/partial/empty/invalid.
- Risk: Medium because invalid identity should not break Production.
- Effort: Small/medium.
- Can implement now: Yes.

### Change 3 - Production overview summary card

- Area: Production overview tab.
- Behavior: replace or complement current `Contexto do Projeto` with a broader `Contexto e identidade` card.
- Dependencies: Change 1.
- Tests: summary does not duplicate full form; legacy context appears honestly.
- Risk: Medium; avoid too much density.
- Effort: Medium.
- Can implement now: Yes.

### Change 4 - Image context strip

- Area: `app/(dashboard)/imagens/page.tsx`.
- Behavior: show Project/Production and identity state; say "aplicada" only when identity is valid/present; say fallback when empty.
- Dependencies: Change 1.
- Tests: applied vs empty vs invalid copy.
- Risk: Medium; must align with current blocking behavior for invalid identity.
- Effort: Medium.
- Can implement now: Yes.

### Change 5 - Video context strip

- Area: `app/(dashboard)/videos/page.tsx`.
- Behavior: show Project/Production and reference-only identity copy; mention simulated video honestly.
- Dependencies: Change 1 optional.
- Tests: does not say "aplicada"; keeps return to Production.
- Risk: Low.
- Effort: Small.
- Can implement now: Yes, as communication only.

### Change 6 - Editorial context strip

- Area: `app/(dashboard)/projetos/[id]/conteudos/[editorialContentId]/page.tsx`.
- Behavior: show linked Project/Production and reference-only identity copy; distinguish local `Contexto para IA`.
- Dependencies: Change 1 optional.
- Tests: content with and without `production_id`; no broken links.
- Risk: Medium because legacy content without Production remains valid.
- Effort: Medium.
- Can implement now: Yes, as communication only.

### Change 7 - Editorial identity consumption

- Area: `app/api/channel-pieces/generate-body/route.ts`, future context compiler for editorial.
- Behavior: consume voice, audience, principles and restrictions.
- Dependencies: product decision and tests.
- Tests: no raw JSON, voice included, restrictions included, absent identity fallback.
- Risk: Medium/high because it changes generated output.
- Effort: Medium.
- Can implement now: No. Future integration.

### Change 8 - Video identity consumption

- Area: future video context compiler and real video generation path.
- Behavior: consume only dimensions appropriate to video once generation is real.
- Dependencies: real video generation API/contract.
- Tests: honest prompt/context assembly.
- Risk: High until video stops being simulated.
- Effort: Medium/high.
- Can implement now: No. Future integration.

### Change 9 - Snapshot/versioning

- Area: domain/schema future.
- Behavior: record which Project Identity version a Production used.
- Dependencies: versioning model.
- Tests: migration and backward compatibility.
- Risk: High.
- Effort: Large.
- Can implement now: No.

---

## 13. Acceptance Criteria for UX-H2 Implementation

- Production communicates the Project Identity source without implying copy/snapshot.
- Production differentiates Project Identity from Production intention.
- Overview shows a concise summary and link/action to full identity.
- Image workspace truthfully says identity is applied to generation/evaluation when valid.
- Video workspace does not claim structured identity is applied.
- Editorial workspace does not claim structured identity is applied until integration exists.
- Empty, partial, invalid and legacy-only states are visible and understandable.
- Existing Project Identity form remains the only full editor.
- No schema, migration, Prompt Generator or Evaluator changes are required for the communication-only slice.

---

## 14. Deferred Items

- Inherited Project Identity visualization in dashboard/sidebar.
- Global Images/Videos role reconciliation.
- Gallery and Files relationship to Production.
- Editorial naming consolidation.
- Distribution.
- Production Style Direction.
- Per-Production identity snapshot/versioning.
- Real video identity consumption.
- Editorial identity compiler.

---

## 15. Discovery Conclusion

UX-H2 should implement a progressive communication layer, not a new identity model.

The recommended UX is:

```text
Production header indicator
+ Overview identity summary card
+ module-specific context strips
```

The most important constraint is language honesty:

- Image can say `aplicada`.
- Video and Editorial should say `disponivel como referencia` until their technical consumption exists.
- Production should say `herdada do Project atual`, not copied or snapshotted.

