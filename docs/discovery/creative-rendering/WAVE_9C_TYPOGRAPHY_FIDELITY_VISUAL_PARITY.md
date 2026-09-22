# Wave 9C — Typography Fidelity + Visual Parity

**Base:** `96c8583` — `feat: add deterministic typography resolution (Wave 9B)`
**Scope:** faithful local bindings for the families already used by fixtures and a controlled static/timeline parity matrix. No Font Catalog UI, upload, LibraryFile/S3, Pack B, production infrastructure, Wave 10, or schema redesign.

## Gate 9C verdict

**PASS_WITH_CONSTRAINTS**

The Wave 9B single-font alias was removed. The runtime capability now resolves each factual identity family to its own local family/weight binding, verifies the files before render, injects the exact `@font-face` rules, and keeps the existing readiness barrier. Documentary Card and Quote Card use the same capability. The 4:5/9:16 and static/timeline evidence matrix passed structural parity. The remaining constraint is that this is a deliberately small six-variant registry, not a general Font Catalog or provider system.

## 1. Pre-flight and inherited state

The checkout was clean on `traycer/content-studio-ai-soft-yak` at `96c8583`. Wave 9A (`a8af64f`), the architecture review (`fafeb22`), and Wave 8 (`09309b8`) are ancestors. The protected paths `/videos`, `/imagens`, `/api/video-drafts`, and `/api/image-drafts` were unchanged.

Inherited baseline: **450/450 tests**, typecheck PASS, lint 0 errors / 45 warnings, build PASS.

## 2. Factual family audit

The existing fixture identities declare:

| Identity | Role | Family | Weight | Style |
| --- | --- | --- | --- | --- |
| A (`comunidades-alternativas`) | display | Fraunces | 700 | normal |
| A | body | Source Sans 3 | 400 | normal |
| A | label | Source Sans 3 | 600 | normal |
| B (`acme-labs`) | display | Space Grotesk | 700 | normal |
| B | body | Inter | 400 | normal |
| B | label | Inter | 600 | normal |

Wave 9B factually mapped all of these to Inter Tight. That was deterministic but not faithful. Components already consumed `tokens.typography.*.family`; no component-level provider fetch was found.

## 3. Local source and license

The registry freezes only the six required variants under `public/creative-fonts/`:

- `fraunces-700.woff2`;
- `source-sans-3-400.woff2`, `source-sans-3-600.woff2`;
- `space-grotesk-700.woff2`;
- `inter-400.woff2`, `inter-600.woff2`.

They were fetched from the Google Fonts CSS endpoint and committed as local assets. The families are OFL-licensed; source metadata and provenance links are recorded in [FONT_SOURCES.md](../../../public/creative-fonts/FONT_SOURCES.md), with the local license text in `public/creative-fonts/OFL.txt`. No render path calls the Google Fonts or `fonts.gstatic.com` URLs.

## 4. Runtime registry and failure behavior

`RUNTIME_FONT_REGISTRY` in `lib/creative/typography/resolve-typography.ts` is a small runtime capability, not a catalog. It contains one explicit registration per supported family and maps each requested weight to one local file.

`resolveTypography(tokens)` now preserves `requested_family` and returns the same `resolved family` when supported. There is no silent aliasing. Unknown families return `font_not_found`; unsupported weights return `weight_not_available`; unsupported styles return `style_not_available`.

`prepareTypography()` verifies every unique local file before render. `TypographyReadyBoundary` injects exact family/weight CSS, calls `document.fonts.load()` with a representative string, awaits `document.fonts.ready`, and queries `document.fonts.check()` as a supplemental observation. Readiness requires the exact `FontFace` returned by `load()`; a system fallback can never satisfy the gate. A failure remains a structured `typography_error`; there is no timer or network fallback.

## 5. Template and identity proof

Documentary Card and Quote Card still receive resolved tokens from the same static/timeline resolution outputs. Neither component imports a font or chooses a provider.

Identity A resolves to Fraunces + Source Sans 3. Identity B resolves to Space Grotesk + Inter. The test suite asserts both through the same registry branch; no identity-specific branch was added.

## 6. Parity matrix

The ignored evidence directory `.tmp/creative/wave-9c/` contains:

| Evidence | Result |
| --- | --- |
| Documentary cover, 1080×1350, Identity A | PASS |
| Documentary info, 1080×1350, Identity A | PASS |
| Documentary cover, 1080×1920, Identity A | PASS |
| Documentary cover, 1080×1350, Identity B | PASS |
| Quote static, 1080×1350, Identity A | PASS |
| Quote static, 1080×1920, Identity A | PASS |
| Documentary timeline start/middle, 1080×1920, Identity A | PASS |
| Quote timeline start/middle, 1080×1920, Identity A | PASS |

The machine-readable matrix is `.tmp/creative/wave-9c/parity-summary.json`. It records family, weight, style, canvas, mode, evidence path, and line-count observations.

The wrapping-sensitive Quote string remained three lines in both 4:5 and 9:16 static outputs and in timeline start/middle frames. Documentary cover title/subtitle line observations remained stable between the 9:16 still and timeline frames. These are controlled runtime/visual checks rather than OCR or a pixel-baseline suite. Timeline motion changed opacity/position only; it did not alter typography or wrapping.

The official MP4 path remains wired to the same `TimelineComposition` and readiness boundary. A new long MP4 was not rendered because the requested frame matrix was sufficient and no renderer-performance change was in scope.

## 7. Visual review and differences

- **Expected mode difference:** timeline frames have motion opacity/position changes; static frames are fully settled.
- **Expected aspect adaptation:** 4:5 and 9:16 use the existing template sizing rules and different composition spacing.
- **Typography difference:** the intentional family change is visible: Identity A now has Fraunces display serifs and Source Sans 3 body text; Identity B has Space Grotesk display and Inter body text.
- **BUG:** none observed in the matrix.
- **Known constraint:** no OCR or automated bounding-box extraction was added; metrics are runtime family/weight/style plus controlled line-count evidence.

## 8. Palette hardcode audit

`components/creative/documentary-card/primitives.tsx` still checks `#0b1020` for its dark-paper treatment, and `DocumentaryCard.tsx` retains the related dark palette fallback. This is existing palette behavior, not typography. It was not changed because replacing it safely requires semantic contrast tokens; it remains deferred.

## 9. Tests and baseline

Focused Wave 9C coverage extends the Wave 9B typography tests to assert:

- exact family resolution for all four supported families;
- requested family equals resolved family;
- correct weights/styles and local CSS URLs;
- explicit missing-family and missing-weight diagnostics;
- Identity A/B through one registry branch;
- shared static/timeline resolved typography;
- both templates consuming runtime typography.

Final checks for the commit: focused tests, full suite, typecheck, lint, and build. The baseline remains without relevant regression; the suite count increases only for high-value fidelity assertions.

## 10. Gate 9C classification

**PASS_WITH_CONSTRAINTS.** Factual families are resolved faithfully from local OFL-compatible files; rendering remains offline and readiness-gated; no silent family aliasing remains; both templates and both identities use one capability; the 4:5/9:16 static/timeline matrix passes; neutral contracts remain intact.

### Recommendation for Wave 10 Final Spike Verdict

Use Wave 10 only for the final spike verdict: consolidate the evidence and decide whether the renderer layer is ready for a separately approved asset/provider and production-infrastructure program. Do not infer approval for LibraryFile/S3, queues, workers, or a full Font Catalog from this Wave.
