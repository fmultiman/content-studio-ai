# Wave 9A — Polymorphic Template Proof

**Commit base:** `09309b8` — `feat: add timeline MP4 render path (Wave 8)`
**Scope:** second template proof only; no LibraryFile/S3, typography hardening, production queues/workers, Wave 9B, or Wave 10.

## Gate 9A verdict

**PASS_WITH_CONSTRAINTS**

Two real templates now resolve through the same registry and the same static/timeline adapter contracts. Quote Card renders a real PNG and timeline frames without a template-specific adapter. Documentary Card continues to resolve and render. The remaining constraints are intentionally outside this Wave: fixture-only assets/identity, the existing typography shortcut, and the small template-specific conversion functions inside the central binding table.

## 1. Pre-flight and baseline

The checkout was on `traycer/content-studio-ai-soft-yak` at `09309b8`. The working tree was not completely clean at entry: `POST_WAVE_8_ARCHITECTURE_REVIEW.md` was an existing untracked report from the preceding session and was preserved; no reset or stash was performed. The protected paths `/videos`, `/imagens`, `/api/video-drafts`, and `/api/image-drafts` were not modified. Commit `09309b8` is present in history.

The factual pre-Wave baseline was **439/439 tests**, typecheck PASS, lint 0 errors / 45 warnings, and build PASS (as recorded by the post-Wave 8 review). After this Wave, the focused/full suite is **445/445 tests**, with typecheck and lint checks repeated below.

## 2. Coupling audit before the change

| Location | Factual occurrence | Classification |
| --- | --- | --- |
| `lib/creative/templates/registry.ts` | Registry descriptor and schemas were already data-driven; only Documentary Card was registered. | EXPECTED TEMPLATE-SPECIFIC registration, but single-template proof gap |
| `lib/creative/templates/component-resolver.ts` | `ResolvedTemplateComponent` was `ComponentType<DocumentaryCardProps>` and returned Documentary Card from an id `if`. | GENERIC-LAYER COUPLING |
| `remotion/DocumentaryCardComposition.tsx` | Static manifest adapter checked `component_key === editorial.documentary-card` and called the Documentary-specific props builder. | GENERIC-LAYER COUPLING |
| `remotion/timeline/TemplateSegment.tsx` | Module-level Documentary component lookup, explicit component-key branch, and `cover/info` variant branch. | GENERIC-LAYER COUPLING |
| `lib/creative/resolution/**` | No Documentary id, React, or Remotion imports; template validation delegates to the registry. | EXPECTED GENERIC LAYER |
| `scripts/creative/render-static-manifest.ts` | Component existence check by opaque `component_key`; no template branch. | EXPECTED ADAPTER CHECK |
| `components/creative/documentary-card/**` | Documentary variants, props, and visual implementation. | EXPECTED TEMPLATE-SPECIFIC |

## 3. Architecture chosen

The existing static registry remains one registry. It now contains:

- `editorial.documentary-card@0.1.0` (`cover`, `info`);
- `editorial.quote-card@0.1.0` (`default`).

`lib/creative/templates/component-resolver.ts` now exposes a central binding map keyed by the descriptor's opaque `component_key`. Each binding owns its template-specific `createProps` conversion, while adapters only perform:

```text
component_key → registered binding → validated runtime props → component
```

The generic adapters no longer compare against either template id, and `TemplateSegment` no longer knows Documentary variants. The resolver's central table still imports the two template prop types by design; this is a single registration/binding seam, not a Documentary-only generic type. A future template adds one binding entry and its own component/schema, rather than branches in static, timeline, and preview adapters.

## 4. Quote Card contract and implementation

`lib/schemas/creative/quote-card.ts` defines only the template-specific contracts:

```ts
{
  eyebrow?: string
  quote: string
  attribution?: string
  source_line?: string
}
```

The `default` variant accepts no required assets (`QuoteCardAssetsSchema` is an empty strict object). The component in `components/creative/quote-card/` is a deliberately small, distinct tree: semantic identity colors/type, eyebrow, sequence marker, dominant quote, attribution, and source footer. It does not copy Documentary Card internals and supports `still` and `video` with `none`/`fade` motion.

Neutral `TemplateDescriptor`, `StaticRenderManifest`, `TimelineManifest`, and primitive schemas were not redesigned.

## 5. Static proof

Fixture: `scripts/creative/fixtures/static-render-manifests/quote-card-1080x1350-a.json`.

The existing official command was used:

```text
pnpm creative:render-static scripts/creative/fixtures/static-render-manifests/quote-card-1080x1350-a.json
```

Observed result: `succeeded`, `editorial.quote-card@0.1.0`, component key `editorial.quote-card`, 1080×1350. Evidence (ignored): `.tmp/creative/wave-9a/quote-card-static-1080x1350-a.png`.

No Quote Card-specific render script exists. The path is `StaticRenderManifest → schema/resolution → registry → binding → StaticRenderManifestStill → renderStill → PNG`.

## 6. Timeline proof

Fixture: `scripts/creative/fixtures/timeline-manifests/quote-card-1080x1920-a.json`, 1080×1920, 30 fps, 90 frames, one visual TemplateSegment, `fade` motion.

The existing `run-timeline-preview.mjs` path was reused (with a fixture selection environment switch, not a Quote Card script). It resolved `editorial.quote-card`, produced no adapter diagnostics, and rendered frames 0, 45, and 89. Evidence (ignored):

- `.tmp/creative/wave-9a/quote-card-timeline-frame-start.png`
- `.tmp/creative/wave-9a/quote-card-timeline-frame-middle.png`

MP4 was intentionally not rendered; Gate 9A requires real timeline frames, not a second long video run.

## 7. Identity A/B proof

`quoteCardManifest` and the focused tests resolve Quote Card against identity A (`comunidades-alternativas`) and identity B (`acme-labs`) through the same resolver and binding. The component receives `VisualTokensSnapshot`; it contains no Portal/project palette branch and no hardcoded project colors. The A/B test asserts distinct resolved snapshots while keeping `editorial.quote-card` unchanged.

## 8. Documentary Card regression

Existing Documentary Card static and timeline fixtures still resolve. The focused suite renders a Documentary timeline segment through the same `TemplateSegment` adapter. The official Documentary static fixture was also rendered after the refactor at 1080×1350 with `succeeded` execution metadata and no asset-load warnings after the generic Remotion URL normalization was added. No Documentary visual implementation was changed.

## 9. Tests and isolation

New focused coverage includes:

- one registry resolving both templates and rejecting an unknown template;
- distinct component keys and both bindings;
- valid/invalid Quote Card content;
- static Quote Card resolution and component binding;
- Quote Card and Documentary Card timeline segments through one adapter;
- Identity A/B and no Quote Card asset requirement;
- existing timeline and renderer-isolation suites.

Results: `pnpm test` **445/445 PASS**. Neutral schemas and resolution remain free of Remotion/React imports where required; Quote Card introduces no Supabase, S3, database, or production API dependency.

## 10. Remaining template-specific knowledge

The remaining template-specific knowledge is intentionally concentrated in:

1. `lib/schemas/creative/documentary-card.ts` and `quote-card.ts`;
2. `components/creative/documentary-card/**` and `quote-card/**`;
3. the two entries in `COMPONENT_BINDINGS`.

The binding table has explicit, typed conversion casts at the validated boundary. This is preferable to a global union of every template payload and does not use `any` or disable validation. A future template should add a schema and binding entry; no generic adapter branch is required.

The `#0b1020` palette-derived fallback remains in Documentary Card primitives. It is existing visual behavior and changing it would expand palette-system scope; it remains a documented Wave 9B/9C constraint. Typography still uses declared CSS families without a deterministic font resolver, intentionally deferred.

## 11. Checks

- Pre-Wave 8 review baseline: 439 tests, typecheck PASS, lint 0 errors / 45 warnings, build PASS.
- Wave 9A suite: 445/445 tests PASS.
- Typecheck: PASS.
- Lint: PASS, 0 errors / 45 warnings (the pre-existing warning baseline).
- Build: PASS (`next build`, 38 routes generated).
- `.tmp/creative/wave-9a/` remains ignored; no PNG/MP4 is intended for commit.
- Protected areas remain untouched.

## 12. Gate 9A classification

**PASS_WITH_CONSTRAINTS.** The polymorphic proof passes all nine requested architectural gates. Constraints are limited to already-known fixture-only assets/identity, deferred typography hardening, and the deliberate central binding table seam. Wave 9B and Wave 10 are not started.

## 13. Recommendation for Wave 9B

Keep the next wave separate: first harden deterministic typography/font loading and then, in an explicitly approved slice, evaluate real LibraryFile/S3 asset resolution. Do not combine that work with production queues/workers or a third template.
