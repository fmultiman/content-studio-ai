# Carousel Visual Reentry & Asset Integration

**Nature:** Factual documentation recording the state of the visual implementation and assets for Phase 4.1 resumption.

## 1. Pack A / Pack B Relationship
- Pack A provides composition boundaries, reading hierarchy, safe areas, structural vector rules, and sequencing components.
- Pack B provides the dominant aesthetic translation introducing the 'organic collage' stylistic direction. The product leverages Pack B as the **Primary V0 visual direction** layered structurally over the Pack A coordinates grids.
- Light/Dark schemes are driven predominantly by `Project Identity` Visual Token resolution. No specific templates structurally fork handling illumination changes; color and textures mutate through defined tokens internally (e.g. `isDark ? ... : ...`).
- Cover/Info variants designate structured slots respectively ('hero' evidence block logic + descriptive layout vs content grid). Cover vs Info is mutually exclusive from Light/Dark (which apply universally via Identity payloads).

## 2. Real Asset Pack Inventory & Discovery
Checking `lib/creative/assets/resolve-asset.ts` and `public/creative-fixtures`:
The system leverages 3 core material skins:
1. `torn-paper-cream-01.png` - 683×1024 / Alpha transparent / 988KB
2. `tape-kraft-01.png` - 341×1024 / Alpha transparent / 305KB
3. `documentary-card-hero-01.webp` - 1067×800 / Archival mockup piece / 214KB

The user remembers ~18 files. After inspecting the local disk `docs/discovery/creative-rendering/visual-reference-pack` only full UI screenshots exist there (`pack-a/001.png` to `010.png`, `pack-b/01.png` and `02.png`). 

**CRITICAL FINDING:** There is NO unbundled folder of 18 individual transparent visual assets residing in the repository. The only isolated structural geometries exist correctly mapped within `public/creative-fixtures`.

The 2 documented components integrated via `lib/creative/primitives/discovery.ts` `(afa6868e-a2d6-473d-9df7-bbf713ad8b02` & `3f593474-05c0-4de3-a537-de50a1abb906`) point to the literal `torn-paper-cream-01.png` and `tape-kraft-01.png` representations configured as dummy fixtures via `Phase 2B` S3 S3 proofs.

## 3. Transparency & Placeholder Audit
The active materials (`torn-paper-cream-01` and `tape-kraft-01`) successfully support alpha mapping natively out of current fixtures.

No substitution mapping is required immediately because the product currently drives identical logical primitives for "paper" and "tape" directly bound to `resolveFixtureAssetSync` fallback logic securely mapping Alpha channels natively via structural CSS combinations.

## 4. Current Authoring Controls
Editing fields inside `app/(dashboard)/projetos/[id]/conteudos/[editorialContentId]/channel-pieces/[channelPieceId]/editar-visual/page.tsx`:
Visual elements expose:
- `offsetX`
- `offsetY`
- `rotation`
- `scale`
- `opacity`
These fields align with the `PrimitiveTransforms` interface. They govern exclusively the `paper` and `tape` layers in real-time layout building.

## 5. Preview / PNG Parity
Since `WAVE_4_1_VISUAL_REFINEMENT.md`, Remotion handles adapter translations gracefully mapping React Node properties functionally. The components scale predictably preserving visual structure across Static and Timeline rendering paths explicitly utilizing bounded `documentaryCardPropsFromResolvedInput`.

## 6. Multi-Slide Status
The runtime parses discrete templates natively via `StaticRenderManifest` definitions representing discrete atomic visual states. Fully threaded Carousel sequences (Slide 1 -> Slide 10 logic output compilation) is intentionally deferred; currently individual components mock `SequenceMarker` structures strictly. 

## 7. Next Step Specification
**IMPLEMENTATION BLOCKER RECORDED:**
Since the 18 source material assets are physically absent from the repository workspace, the "Real Asset Calibration" is structurally blocked until explicit handoff via `REAL_ASSET_HANDOFF_REQUIRED`. No placeholder falsification applies. The template architecture proves theoretically capable using its foundational two proxy files effectively waiting for expanded ingestion.