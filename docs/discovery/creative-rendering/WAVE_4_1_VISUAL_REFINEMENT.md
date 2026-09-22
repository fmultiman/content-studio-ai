# Wave 4.1 — Visual material refinement

## Verdict

**Gate 4.1: PASS_WITH_CONSTRAINTS**

The refinement is visibly stronger than Wave 4 while preserving the validated
runtime architecture. Cover 4:5, info 4:5 and cover 9:16 now use a controlled
hybrid material language: real local raster skins for paper/tape/hero, with DOM
text and token-driven SVG ornaments retained where they are more reliable.

The constraint is explicit: the hero raster is a synthetic local visual fixture,
not documentary evidence with provenance. The official Primitive Library,
Harness, production LibraryFile resolution and Wave 5 remain deferred.

## What changed

### Material system

New local implementation fixtures:

```text
public/creative-fixtures/torn-paper-cream-01.png
public/creative-fixtures/tape-kraft-01.png
public/creative-fixtures/documentary-card-hero-01.webp
```

The first two provide alpha-backed fibre, torn edges and woven tape texture.
The hero WebP is a neutral archival-book visual fixture with no readable text or
brand. It is deliberately registered as a fixture asset and must not be
interpreted as historical evidence.

The component now layers these assets through deterministic material URLs and
the existing local asset resolver. Remotion gets the same URLs through its
adapter boundary; the renderer-neutral schemas do not know about the files.

### Vector, raster and hybrid decisions

The full classification is in
`WAVE_4_1_MATERIAL_STRATEGY.md`.

- Vector/SVG/CSS retained: semantic text, sequence marker, badges, orbital and
  network lines, small botanical linework, pins and fine rules.
- Rasterized: torn paper, paper skins, tape and the hero/document visual.
- Hybrid: headline paper stack, hero frame, fact cards, brand plate, grain and
  collage field. CSS still owns layout, color, z-order and deterministic motion.

The rule remains: organic surface treatment is allowed to be irregular, but
placement, hierarchy and content are fixed by the template artifact plan.

### Cover

The title is now a layered paper stack with a torn fibre surface instead of a
single flat polygon. The hero is larger and receives a material backing, local
archival visual, pin and tape treatment. The 1080×1920 plan is independently
staged: title, subtitle, hero, source/detail and brand occupy distinct vertical
bands instead of a stretched 4:5 grid.

### Info

The title and fact cards use the same paper material. Cards gain fixed pin/tape
accents and retain the Pack A reading order: body left, fact pair right,
annotation and source secondary. The composition still works without a hero.

### Brand and density

The temporary technical label was replaced with the neutral editorial lockup
`Field notes`, while the mark remains resolved from the Identity asset. No
Portal text, logo or palette branch was introduced. Grain is a low-opacity CSS
overlay; botanical and network accents remain SVG and subordinate. The collage
stays within the V0/V1 budget of paper planes, small support artifacts and
secondary annotations.

## Files changed

```text
components/creative/documentary-card/
├── CoverVariant.tsx
├── DocumentaryCard.tsx
├── InfoVariant.tsx
├── primitives.tsx
└── types.ts

lib/creative/assets/resolve-asset.ts
lib/creative/fixtures/documentary-card-fixtures.ts
lib/creative/__tests__/documentary-card.test.ts
remotion/DocumentaryCardComposition.tsx
scripts/creative/render-documentary-card.mjs
docs/discovery/creative-rendering/
├── WAVE_4_1_MATERIAL_STRATEGY.md
└── WAVE_4_1_VISUAL_REFINEMENT.md
```

No schema, registry, resolution, Project Identity or protected product area
was changed. The added `materialAssets`/`materialUrls` fields are optional
visual implementation props and are not manifest contracts.

## Evidence and QA

Regenerated ignored evidence:

```text
.tmp/creative/documentary-card-cover-1080x1350-a.png  1080×1350
.tmp/creative/documentary-card-info-1080x1350-a.png   1080×1350
.tmp/creative/documentary-card-cover-1080x1920-a.png  1080×1920
.tmp/creative/documentary-card-cover-1080x1350-b.png  1080×1350
```

Visual review against Pack A + Pack B confirms:

- hero is now the dominant cover artifact rather than a flat geometric block;
- headline has visible torn-paper fibre and stronger editorial presence;
- info cards carry material depth while remaining readable;
- 9:16 has a plausible vertical rhythm and does not stretch the portrait card;
- identity B still follows the same component branch and token boundary;
- negative space, safe areas and source/detail legibility remain intact.

Remaining limitation: the hero fixture is still synthetic and cannot satisfy a
real evidence/provenance gate. It is a visual material proof only.

## Validation and baseline

- focused Documentary Card tests: **5/5 PASS**;
- full suite: **383/383 PASS**;
- typecheck: PASS;
- lint: **0 errors / 45 warnings**, unchanged from baseline;
- Next build: PASS, 38 routes;
- Remotion evidence script: PASS, four exact-size PNGs and no asset-load errors.

Wave 4.1 adds no test-count change. The technical baseline remains the Wave 4
baseline of `383/383`.

## Deferred

- real evidence assets with provenance and LibraryFile/S3 resolution;
- official Visual Primitive Library and Creative Primitive Harness;
- full font resolver/catalog and font loading gate;
- final product render pipeline, editor and additional templates;
- Wave 5.

## Gate 4.1 assessment

The implementation meets the visual refinement gate with constraints: the
improvement is perceptible in all required evidence outputs, cover/info/9:16
remain functional, identity B and neutrality are preserved, and the Wave 4
architecture is unchanged. A further round is not required to validate the
architecture; a future visual round would only be justified after real
provenance-backed evidence assets are available.
