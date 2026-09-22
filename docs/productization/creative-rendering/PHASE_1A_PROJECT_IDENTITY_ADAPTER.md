# Phase 1A - Real Project Identity Adapter

**Epic:** Shared Creative Rendering - Productization
**Date:** 2026-09-20
**Status:** COMPLETE

## 1. Objective

To replace the hardcoded spike `IDENTITY_FIXTURES` with a real interface boundary bridging `ProjectIdentity V1` (the actual Content Agent Studio database domain representation) into the `VisualTokensSnapshot` structure required by the Creative Rendering core, without introducing backend persistence layers, Supabase clients, or Next.js API boundaries into the pure creative domain.

## 2. Inherited Architecture

The Creative Rendering layer expects a `VisualTokensSnapshot`, exposing:
- `typography` (display, body, label - structured family, weight, style)
- `colors` (background, foreground, muted, accent - hex fields)
- `spacing` (unit, grid gaps, safe areas)
- `brand` (logo_asset_ref)

During the Spike (Waves 1-10), this contract was fulfilled entirely by `identity-fixtures.ts` pretending to resolve a string `fixture:identity:comunidades-alternativas:v1`. Real project records were entirely ignored.

## 3. Factual Project Identity V1 Shape

Investigation of `lib/schemas/project-identity.ts` confirms Project Identity V1 relies on natural language semantics and expression guidelines designed primarily for LLM interpretation.
It contains:
- `foundation.purpose` (string)
- `relationship.audience` (string)
- `expression.visual_identity` (string)
- `expression.voice` (string)
- `governance.principles/restrictions` (string[])

It does **not** possess structured visual tokens (colors, font-families, exact spacing variables, or image references).

## 4. Factual VisualTokensSnapshot Shape

Creative Rendering actively enforces `VisualTokensSnapshotSchema.parse` which hard-requires deterministic, structural properties ready for a CSS engine. The two models are conceptually misaligned for a pure passthrough map.

## 5. Mapping Table

Because Project Identity V1 lacks graphic metadata, we implemented an explicit `CREATIVE_IDENTITY_DEFAULTS` constant based heavily on the original *comunidades-alternativas* proof. The adapter behaves predictably rather than hallucinating colors.

| Project Identity field | VisualTokensSnapshot field | Mapping Class | Note |
| :--- | :--- | :--- | :--- |
| `expression.visual_identity` | (Text context) | `NOT AVAILABLE` | Currently LLM-only. Unusable for exact deterministic rendering generation. |
| (None) | `typography.display` | `DEFAULTED` | Defaulted to Fraunces 700. |
| (None) | `typography.body` | `DEFAULTED` | Defaulted to Source Sans 3 400. |
| (None) | `typography.label` | `DEFAULTED` | Defaulted format. |
| (None) | `colors.*` | `DEFAULTED` | Defaulted to warm earthly palette. |
| (None) | `spacing.*` | `DEFAULTED` | Unified box-model defaults. |

## 6. Adapter Architecture

The integration occurs inside a new `lib/creative/integration/` namespace to keep it physically distinct from `lib/schemas/creative/` (pure definitions) and `components/` (pure visuals).

```ts
// Canonical Domain Entity -> Pure Creative Structure
adaptProjectIdentityToVisualTokens(projectId, canonicalIdentity)
```

## 7. Layer Boundary

- `lib/creative/integration/project-identity-adapter.ts` holds the boundary mapping.
- It accesses the `ProjectIdentity` imported from `@/lib/schemas/project-identity`.
- Resolving the actual rows off disk (or via Supabase) will happen *above* this adapter level. The adapter accepts only the raw Zod parsing object, guaranteeing the Creative Rendering core stays completely pure from database execution.

## 8. Typography and Color Mapping

No LLM guessing or heuristic mapping occurs. Since V1 stores neither values, it safely falls back to a frozen visual representation preventing React crashes or offline browser behavior.

## 9. Defaults

Defaults map straight to:
```ts
{
  typography: {
    display: { family: 'Fraunces', weight: 700, style: 'normal' },
    body: { family: 'Source Sans 3', weight: 400, style: 'normal' },
    // ...
  },
  colors: {
    background: '#F6F0E4', 
    foreground: '#16352F' ...
  }
}
```

## 10. Static Proof & Timeline Regression

Through local proofs and automated structural tests, `DocumentaryCard` and `QuoteCard` successfully integrated with mapped tokens. 
The regression matrix proved that existing `StaticRenderManifest` generation does not degrade when `resolveTypography` is provided the adapter's snapshot payload payload rather than historical memory fixtures.

## 11. Tests

- `identity-render-proof.test.ts`: Added high-value integrations bridging a mocked genuine `ProjectIdentity` payload directly into Typography Resolvers and JSX `renderToString` verifications across both `QuoteCard` and `DocumentaryCard`.
- `project-identity-adapter.test.ts`: Verifies structural validity of the adapter transformations itself.

## 12. Baseline

- All tests remain valid (increasing by 2 new focused assertions). Base line was 451. It is now 453 tests PASS.
- Build compiles. Linter preserves the known 0 error / 45 warning state. Typecheck holds perfectly against strict boundaries.

## 13. Remaining Identity Debt

1. **Evolution of Project DB**: Project Identity must be expanded in the main Database schema to capture formal color/typography guidelines before user projects exhibit bespoke styling. 
2. **Palette Hack (`#0b1020`)**: Since the backend adapter uses static explicit variables while DB models catch up, fixing the hardcoded `#0b1020` contrast conditional inside the primitives is pushed backward.

## 14. Phase 1A Verdict

`PASS`
The integration demonstrates the correct placement and API boundary strategy to prevent the Renderer from tangling with backend dependencies. Defaulting explicitly is the correct architectural answer to Project Identity V1's visual-vacuum. 

Next action: Explore Asset/LibraryFile storage via S3.
