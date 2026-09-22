# Wave 4.1 — Material strategy

## Objective

Refine the existing `editorial.documentary-card@0.1.0` without changing its
resolved-input boundary, registry metadata, schemas, identity resolver or
renderer-neutral flow. The visual target remains Pack A's editorial discipline
plus Pack B's deliberately imperfect material collage.

The current Wave 4 implementation is structurally sound but relies too heavily
on CSS polygons and flat inline SVG. The correction is selective, not a blanket
conversion to raster: material cues move to local alpha-backed raster fixtures;
semantic text and precise ornament remain vector or DOM.

## Classification

| Group | Elements | Decision and reason |
| --- | --- | --- |
| Vector / SVG / CSS | semantic text, sequence marker, badges, thin orbital/network marks, small scribbles, lightweight botanical linework, outer rules | They need crisp scaling, token recoloring, runtime text and predictable still/video parity. |
| Raster with alpha | torn-paper surfaces, paper scraps, tape, pin/shadow texture, hero backing fragments, photo/document treatment | Their value is irregular fibre, imperfect edges and optical depth; flat polygons made them read as placeholders. Assets remain tiny, local spike fixtures, not a Primitive Library. |
| Hybrid | headline paper stack, hero/evidence frame, detail note, fact cards, brand plate, grain/patina and collage field | Layout, text, color and shadows stay deterministic CSS/React; material skins come from local raster fixtures. Grain remains a restrained CSS overlay because it scales better and does not need a separately versioned bitmap. Botanical cutouts and background overlays stay optional. |

## Refinement plan

1. Add a compact, local material set under the Documentary Card implementation:
   transparent torn-paper, tape, archival grain and paper fibres. It is fixture
   material only: no registry, upload, database, provenance claim or product
   asset contract.
2. Replace the headline and fact-card polygons with material-backed planes,
   retaining real DOM text and fixed rotations.
3. Give the hero a larger, layered evidence frame: raster paper backing,
   shadow, tape and a deterministic document/photo treatment. The fixture stays
   clearly labelled as local visual fixture, never as sourced evidence.
4. Upgrade the brand from technical fallback copy to a compact editorial
   signature plate driven by resolved identity tokens/assets.
5. Give 9:16 its own plan: title and hero become a vertically staged focal
   pair, while source/detail and brand occupy a deliberate lower archive band.
6. Preserve balanced density: no random placement, no more than three visual
   levels competing, and protected text safe areas.

## What does not change

- `ResolvedStaticRenderInput` remains the component input adapter.
- identity A/B, `component_key`, registry and Wave 3 resolution stay intact.
- Cover still requires its resolved hero binding; info still works without one.
- Pack A/B remain references, not copied product runtime assets or contracts.
- The Visual Primitive Library and Harness remain deferred.
