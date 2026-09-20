# Wave 4 — Editorial Documentary Card

## Verdict

**Gate 4: PASS_WITH_CONSTRAINTS**

The first renderer-neutral resolved inputs now feed one reusable React template family for `editorial.documentary-card@0.1.0`. Cover and info render in both supported canvases, with still and video-compatible modes. The constraints are intentional: the hero and primitives are local visual fixtures, and the final production evidence-asset pipeline, font catalog, editor and Wave 5 render pipeline remain deferred.

## Implementation

The visual tree lives under `components/creative/documentary-card/`:

```text
DocumentaryCard
├── CoverVariant
│   ├── SequenceMarker / BrandMark
│   ├── headline paper plane
│   ├── hero evidence surface
│   └── source/detail + botanical/network decoration
└── InfoVariant
    ├── SequenceMarker / BrandMark
    ├── title paper plane
    ├── intro/body column
    ├── 1–2 fact cards
    └── annotation + botanical decoration
```

`DocumentaryCard` accepts only resolved content, resolved assets, visual tokens, canvas, mode, motion and optional sequence context. It does not receive a Project, Production, client, database handle or raw manifest. The Wave 3 component resolver maps `component_key=editorial.documentary-card` to this implementation; the neutral registry and schemas remain Remotion-free.

Fixtures in `lib/creative/fixtures/documentary-card-fixtures.ts` resolve through the existing Wave 3 pipeline. They cover identity A, identity B, cover/info, 1080×1350 and 1080×1920. Identity selection changes tokens and palette through the same component branch; there is no Portal-specific branch or literal Portal brand.

## Visual language and artifact plans

The implementation combines Pack A's editorial hierarchy, legibility and density with Pack B's paper, tape/pin, botanical linework, controlled overlap and asymmetry. The result is deterministic: `cover-collage-01` and `info-collage-01` use fixed rotations and fixed layer order. Main reading blocks are not rotated. The collage grammar stays within 2–4 paper planes, 1–3 tape/pin accents and a small number of annotations, with a dominant focus and protected negative space.

Cover uses a dark token surface, dominant hero/evidence fixture, strong title paper, sequence marker, integrated identity mark and legible source/detail. Info uses a light token surface, title paper, intro/body hierarchy, one or two fact cards, identity mark and subordinate annotation. Hero is not required by the info visual contract.

The local primitive starter set is inline SVG/CSS (paper plane, tape, botanical, network lines, grain-like surfaces and sequence marker). It is an implementation fixture, not the promised Visual Primitive Library or Creative Primitive Harness.

## Typography and identity

The fixture `VisualTokensSnapshot` supplies the display/body families and colors. The template owns scale, hierarchy, measure and spacing; it does not load a provider or create a font catalog. Identity A and B therefore change the visual token result while resolving through the same template family.

## Canvas and motion

4:5 uses the editorial card safe area with hero/title as the cover focus and body/facts as the info focus. 9:16 adapts the composition rather than stretching the 4:5 layout. The same template tree is used for both canvases.

`mode=still` renders the canonical final state and ignores frame. `mode=video` accepts frame/duration and supports `none`, `fade` and deterministic `slow_push`; the latter applies a subtle focal-point-preserving hero scale. Remotion appears only in `remotion/DocumentaryCardComposition.tsx` and `remotion/Root.tsx`, at the adapter/composition boundary.

## Preview and visual evidence

`/dev/creative-preview` is an isolated client preview with technical controls for variant, canvas and fixture identity. It resolves local fixtures only and has no persistence or Supabase dependency.

Generated, ignored evidence (not committed as product assets):

```text
.tmp/creative/documentary-card-cover-1080x1350-a.png  1080×1350
.tmp/creative/documentary-card-info-1080x1350-a.png   1080×1350
.tmp/creative/documentary-card-cover-1080x1920-a.png  1080×1920
.tmp/creative/documentary-card-cover-1080x1350-b.png  1080×1350
```

The outputs were reviewed against Pack A + Pack B for hierarchy, materiality, controlled irregularity, hero weight, source legibility, fact-card separation, identity treatment and 4:5/9:16 family consistency. The hero fixture is a synthetic local visual fixture for this spike; it carries no production provenance claim and must be replaced by a resolved documentary evidence asset in a later integration.

## Tests and baseline

- focused creative/schema tests: PASS (97 tests)
- full suite: **383/383 PASS** (Wave 3 baseline: 378/378; Wave 4 adds 5 tests)
- typecheck: PASS
- lint: PASS, 0 errors / 45 pre-existing warnings
- Next build: PASS (38 routes generated)
- Remotion evidence script: PASS; four PNGs generated with exact dimensions

The existing Wave 1 spike compositions and scripts remain intact; the only script adjustment is the existing webpack alias needed because the Root now imports the shared component tree. No database, storage, upload, API, `/videos`, `/imagens` or draft-domain integration was added.

## Deferred items

- production LibraryFile/S3/HTTP evidence resolution and provenance;
- real font resolver/catalog and provider loading;
- full Visual Primitive Library and Harness;
- final static/timeline render pipeline and render API;
- editor, timeline authoring, additional slide types and Wave 5 work.

## Gate 4 assessment

The required Gate 4 conditions are met: cover and info render, both canvases work, one template family supports still/video-compatible modes, resolved input is the component boundary, identity A/B changes visual tokens without a project branch, Portal literals are absent from component core, and the preview/render tree is reusable. The constrained verdict records only the explicitly fixture-based spike boundaries above.
