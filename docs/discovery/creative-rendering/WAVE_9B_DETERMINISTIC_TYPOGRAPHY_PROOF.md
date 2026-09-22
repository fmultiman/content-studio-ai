# Wave 9B — Deterministic Typography Proof

**Commits:** `fafeb22` (housekeeping architecture review), followed by the Wave 9B commit below
**Scope:** runtime typography resolution, local font readiness, and render parity only. No Font Catalog UI, upload, LibraryFile/S3, Pack B, production infrastructure, Wave 9C, or Wave 10.

## Gate 9B verdict

**PASS_WITH_CONSTRAINTS**

Both proven templates now enter the same runtime typography boundary. Resolution is pure and renderer-independent; preparation verifies a project-local font file before a render starts; the Remotion boundary waits for `document.fonts` and fails with a structured `typography_error` instead of silently falling back. Static, timeline, and official MP4 composition paths reuse the same resolved typography. The constraint is deliberate: this spike freezes one redistributable Inter Tight Latin fixture for all currently declared fixture families. A faithful per-family catalog and provider model remain future work.

## 1. Entry state and factual audit

Pre-flight confirmed branch `traycer/content-studio-ai-soft-yak`, HEAD `a8af64f` (Wave 9A), then the existing architecture review was committed separately as `fafeb22`. Protected paths `/videos`, `/imagens`, `/api/video-drafts`, and `/api/image-drafts` were unchanged. The Wave 9A baseline was 445/445 tests, typecheck PASS, lint 0 errors / 45 warnings, and build PASS.

The risk was confirmed factually, with these distinctions:

| Question | Evidence | Classification |
| --- | --- | --- |
| Which families were requested? | Identity fixtures declare Fraunces/Source Sans 3 for A and Space Grotesk/Inter for B. Components consume `tokens.typography.*.family`. | FACT |
| Where were they loaded? | No creative-rendering font resolver, local font fixture, or `document.fonts` readiness gate existed. | FACT |
| Were matching project font files/packages present? | No matching local files or font packages were present in the repository/runtime. | FACT |
| Did the browser depend on installed/system fonts? | CSS family strings were passed to Chromium; without a project-local source this permits OS/headless fallback. | INFERENCE from the code path |
| Did preview and final render share a formal font boundary? | No; `next/font` in the app shell was unrelated to Remotion composition inputs. | FACT |
| Was fallback explicit? | No runtime diagnostic existed for missing family, weight, or failed font readiness. | FACT |

## 2. Runtime resolver and source

`lib/creative/typography/resolve-typography.ts` is the small runtime boundary:

```text
VisualTokensSnapshot
  → resolveTypography()
  → ResolvedTypography
  → prepareTypography()
  → TypographyReadyBoundary
  → template tree
```

It validates family aliases, weight, and style without network access and returns role-level metadata (`display`, `body`, optional `label`), the local source, URL, and CSS. `tokensWithResolvedTypography()` produces the render snapshot consumed by both templates; no template imports a provider or fetches a font.

This spike uses `public/creative-fonts/inter-tight-latin.woff2`, a frozen Latin subset emitted by the repository’s existing Inter Tight build. The upstream family is Inter Tight by The Inter Project Authors. It is distributed under the [SIL Open Font License 1.1](https://scripts.sil.org/OFL); the repository source metadata is [Google Fonts Inter Tight metadata](https://raw.githubusercontent.com/google/fonts/main/ofl/intertight/METADATA.pb), and the local copy includes `public/creative-fonts/OFL.txt` and `README.md`. The renderer never fetches a font over the network.

Because the pre-existing fixtures only carried family strings, the resolver currently maps the controlled fixture aliases (Fraunces, Source Sans 3, Space Grotesk, Inter, and Inter Tight) to this one local proof asset while preserving the requested family in diagnostics/metadata. This is a deterministic proof asset, not a claim that the final catalog has been implemented.

## 3. Readiness barrier and failure behavior

`prepareTypography()` verifies the local file synchronously from the render process and records `preparation_ms`. `TypographyReadyBoundary` injects the resolved `@font-face`, calls `document.fonts.load()` for every role, awaits `document.fonts.ready`, and checks `document.fonts.check()` before allowing Remotion to continue. There is no timer-based wait.

Resolution and loading failures use `kind: "typography_error"` with explicit codes: `font_not_found`, `font_load_failed`, `weight_not_available`, and `style_not_available`. Static and timeline scripts abort on preparation failure; Remotion throws after releasing its delayed render handle. No silent fallback is accepted.

## 4. Template integration

Documentary Card and Quote Card receive the same `ResolvedTypography` through the generic static and timeline resolution outputs. `DocumentaryCardComposition` and `TimelineComposition` wrap their existing component trees in `TypographyReadyBoundary`; the components themselves remain unaware of providers and do not import font files.

Neutral manifest and identity schemas were not changed and remain free of React, Remotion, Supabase, S3, and database concepts.

## 5. Static proof

The official static command was reused for both fixtures:

```text
pnpm creative:render-static scripts/creative/fixtures/static-render-manifests/quote-card-1080x1350-a.json
pnpm creative:render-static scripts/creative/fixtures/static-render-manifests/documentary-card-cover-1080x1350-a.json
```

Both succeeded with local typography preparation (`preparation_ms` recorded in execution output). Ignored evidence is in `.tmp/creative/wave-9b/`:

- `quote-card-static.png`
- `documentary-card-static.png`

No Quote-specific render script was added.

## 6. Timeline and MP4 composition proof

The existing timeline preview runner was reused with Quote and Documentary fixtures. It resolved the same typography and rendered real start/middle frames; evidence is:

- `quote-card-timeline-start.png`
- `quote-card-timeline-middle.png`
- `documentary-card-timeline-start.png`
- `documentary-card-timeline-middle.png`

The official MP4 path also passes through `render-timeline-manifest.ts` and the same `TimelineComposition` boundary; a new long Documentary MP4 was intentionally not rendered because the frame proof covers the requested gate without a costly duplicate run.

## 7. Parity and metrics

The focused Wave 9B tests assert that static and timeline resolution produce the same resolved family (`Inter Tight`), source URL, CSS, and token family for a wrapping-sensitive Quote string. The rendered Quote static and timeline-middle evidence preserves the same three-line quote wrap while motion changes opacity/position only. Binding-level assertions confirm both Documentary Card and Quote Card receive the resolved family. This is a runtime/visual smoke proof, not OCR or a pixel-baseline suite.

Identity A and B continue through the same resolver branch. Their declared fixture families are accepted by the controlled alias set and resolve to the same local proof asset; no project-specific branch was introduced.

## 8. Tests and checks

New focused coverage includes:

- display/body/label resolution and local source metadata;
- unknown family, unavailable weight, and local preparation diagnostics;
- Node readiness behavior without a browser;
- static Quote resolution and Documentary/Quote timeline resolution;
- shared CSS/family parity and both component bindings.

The final validation run must remain the Wave 9B gate: focused typography tests, full suite, typecheck, lint, and build. Existing warnings remain the known 45 lint warnings with zero errors.

## 9. Remaining constraints and deferred work

- Inter Tight is the only committed proof font; per-family files, versioned FontRef/provider metadata, and a Font Catalog are deferred.
- `/dev/creative-preview` was not used as a gate where proxy/env setup blocks isolated access; static and timeline paths provide the deterministic parity proof.
- Existing `#0b1020` palette fallback is outside typography scope and remains deferred to a later palette wave.
- No LibraryFile/S3, real asset provenance, production queues/workers, or schema redesign was introduced.

## 10. Gate 9B classification

**PASS_WITH_CONSTRAINTS.** A runtime font boundary exists; the local source is verified and licensed; rendering waits for readiness; failures are explicit; Documentary Card and Quote Card share the mechanism; static and timeline paths use it; neutral contracts remain renderer-independent; and the baseline has no relevant regression.

### Recommendation for Wave 9C

Evaluate faithful per-family font sources and versioned `FontRef`/catalog behavior as a separate, explicitly scoped wave. Do not combine that work with LibraryFile/S3 or production execution changes.
