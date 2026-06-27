# UX-H2 Implementation - Inherited Project Identity Communication

**Date:** 2026-06-26
**Scope:** Implementation of the UX-H2 communication layer for inherited Project Identity in Production.
**Restriction:** No schema, database, migration, normalizer, context compiler, Prompt Generator, Image Evaluator, Video Generator, Feed Generator, dashboard, sidebar, Gallery, Files or Distribution changes were implemented.

---

## Contract Applied

The UI now communicates the real inheritance contract:

```text
Project
-> current Project Identity by reference
-> Production with local intention
-> Image, Video and Editorial workspaces
```

Production does not copy, freeze, snapshot or override Project Identity. It reads the current Project. Later changes to the Project can affect what the Production shows later.

## Module Differences

### Production

Production now shows a compact inherited identity indicator near the main context and a summary card in the Overview tab.

The summary distinguishes:

- Project Identity: persistent Project direction.
- Production intention: local objective for the current initiative.

### Image

Image workspace shows:

```text
Identidade: Aplicada à geração e avaliação
```

This is true because image prompt generation and image evaluation consume structured Project Identity.

### Video

Video workspace shows:

```text
Identidade: Disponível como referência
```

It does not claim automatic application because the current video flow does not consume structured Project Identity.

### Editorial

Editorial content linked to a Production shows:

```text
Identidade: Disponível como referência editorial
```

It does not claim automatic application to ChannelPiece generation. Editorial content without `production_id` remains functional and does not render invented Production context.

## Components and Helpers

- `lib/inherited-project-identity.ts`
  - Resolves complete, partial, empty, legacy, invalid and loading states.
  - Derives summary fields and counts without mutating input objects.
  - Provides module-specific copy for Image, Video and Editorial.

- `components/projects/inherited-project-identity.tsx`
  - `InheritedIdentityIndicator`
  - `InheritedIdentitySummaryCard`
  - `WorkspaceIdentityContext`

The full Project Identity form remains only on the Project page.

## States

| State | Behavior |
|---|---|
| Complete identity | Shows inherited identity, purpose, audience, visual direction and counts. |
| Partial identity | Shows populated dimensions and `n/5` zones. |
| Empty identity | Shows `Identidade ainda não estruturada` and action to structure it in the Project. |
| Invalid identity | Shows safe error copy and does not render partial raw data as valid. |
| Legacy context | Shows `Usando contexto legado do Project` when `context` exists without structured identity. |
| Project loading | Keeps loading separate from an empty identity state. |
| Content without Production | Editorial context strip is not rendered. |

`style_profile` is not shown as an active fallback because Project Identity V1 removed it from the current runtime and type surface. The only active legacy fallback communicated here is free Project `context`.

## Microcopy

Implemented PT-BR terms:

- `Identidade herdada`
- `Identidade herdada do Project`
- `Identidade parcial`
- `Identidade ainda não estruturada`
- `Não foi possível carregar a identidade do Project`
- `Aplicada à geração e avaliação`
- `Identidade parcial aplicada`
- `Disponível como referência`
- `Disponível como referência editorial`
- `Usando contexto legado do Project`
- `Ver identidade completa`
- `Estruturar identidade`

Avoided terms:

- snapshot
- schema
- JSON
- normalizer
- compiler
- override
- identity copy/freeze language

## Accessibility and Responsiveness

- Indicators and strips include explicit text, not color-only meaning.
- Links and actions use accessible button/link labels.
- Workspace strips use wrapping layout for narrow screens.
- Summary fields are compact and single-column friendly on mobile.
- Invalid identity state does not expose raw data.

## Tests

Added focused tests for:

- complete identity summary;
- partial identity summary;
- empty identity state;
- invalid identity state;
- legacy `context` fallback;
- loading state;
- no mutation of input objects;
- Image applied copy;
- Video reference-only copy;
- Editorial reference-only copy;
- Editorial content without Production;
- absence of forbidden snapshot/copy language;
- long text truncation.

Validation result in this implementation round:

- `pnpm.cmd test -- lib/__tests__/inherited-project-identity.test.ts`: 217 tests passed.
- `pnpm.cmd test`: first run hit the pre-existing flaky simulated prompt test documented in Project Identity V1; rerun passed with 217/217 tests.
- `pnpm.cmd typecheck`: passed.
- `pnpm.cmd lint`: 0 errors, 50 pre-existing warnings.
- `pnpm.cmd build`: blocked only by sandbox network access to Google Fonts (`Geist` / `Geist Mono`).
- `pnpm.cmd validate`: typecheck and lint passed, then blocked by the same Google Fonts network failure during build.

## Smoke

Required smoke flow for human/browser validation:

```text
Project with complete identity
-> Production
-> Overview
-> Image
-> Video
-> Editorial Content
```

Additional states to verify:

- Project with partial identity.
- Project without structured identity.
- Project with legacy `context`.
- Editorial content without Production.

Automated smoke performed in this implementation round:

- `GET /projetos`: 200.
- `GET /projetos?new=true`: 200.
- `GET /imagens`: 200.
- `GET /videos`: 200.
- Chrome headless route check for the same routes: 200, visible login screen, no console errors.

Limitation: the headless browser did not have the user's authenticated session, so data-specific visual smoke inside a real Project/Production was not completed in the sandbox.

## Limitations

- No technical Project Identity consumption was added to Video.
- No technical Project Identity consumption was added to Editorial/ChannelPiece generation.
- No per-Production snapshot/versioning was added.
- No Production identity override was added.
- No dashboard/sidebar/global navigation reconciliation was implemented.

## Deferred Items

- UX-H3 dashboard and sidebar reconciliation.
- Global Images/Videos role clarification.
- Gallery and Files relationship to Production.
- Editorial naming consolidation.
- Distribution.
- Video identity compiler.
- Editorial identity compiler.
- Per-Production Project Identity snapshot/versioning.

## Acceptance Criteria

- Production communicates inherited identity without implying copy/snapshot.
- Production distinguishes Project Identity from Production intention.
- Overview shows a concise identity summary and link to the full Project Identity.
- Image workspace truthfully says identity is applied to generation and evaluation.
- Video workspace does not claim structured identity is applied.
- Editorial workspace does not claim structured identity is applied.
- Empty, partial, invalid and legacy-only states are visible and understandable.
- Existing Project Identity form remains the only full editor.
