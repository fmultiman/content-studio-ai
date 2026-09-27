# PROJECT_IDENTITY_VISUAL_TOKENS_DISCOVERY_V1

## 1. Starting Checkpoint
- **Codebase Checkpoint:** `81be8a739db0c96d76b1c4aed1b7be0efca03a17`
- **Goal:** Audit and plan the mapping between persisted Project Identity and visual resolution for Creative Renderings without disrupting Free Elements, Templates, or Snapshot Reproducibility. No production code was modified during this discovery.

## 2. Factual Current-State Map
- **Project Identity Database Shape:** The `projects.identity` JSONB column stores data parsed by `ProjectIdentitySchema`. This schema strictly maintains fields like `foundation.purpose`, `relationship.audience`, `expression.visual_identity` (which is remarkably just free text), and `practice.generation_preferences`. **It currently holds absolutely no structured visual fields** (no hex lists, no typographic scales).
- **The Adapter:** `adaptProjectIdentityToVisualTokens(projectId, _identity)` compiles an operational `VisualTokensSnapshot`. The `_identity` argument is entirely ignored. The adapter unconditionally returns `CREATIVE_IDENTITY_DEFAULTS`, dictating `'Fraunces'` and `'Source Sans 3'` for fonts and fixed hexes (`#F6F0E4`/`#16352F`) for colors.
- **Consumers:** Both `FreeStage` (Static & Video) and Template rendering components receive `VisualTokensSnapshot` and rely entirely on it. Neither accesses the Supabase Identity document directly.

## 3. Real Persisted Data Validation
Reviewing active production projects (`Alquimia Cibernética`, `Novo Identity`, `Portal Comunidades Alternativas`), not a single identity document manages layout, colors, or fonts. They operate exclusively as AI generative-prompt contexts (`audience`, `voice`, `generation_preferences`).

## 4. Current Visual-Resolution Paths (Template vs Free)
### Free Elements (Static & Video)
Free text elements enforce bounded semantic styles in the `FreeTextElementPayloadSchema`. Elements are authored with `typography: "display" | "body"` and `color: "background" | "foreground" | "accent" | "muted"`.
At runtime, `FreeStage` maps these strings to the values found in `tokens` (`VisualTokensSnapshot`), resolving precise hexes and fonts safely. This approach avoids hardcoding literal hex colors or font strings per-element inside the authored `TimelineManifest`.

### Template (Static & Video)
`DocumentaryCard` (the primary template) accepts the same `VisualTokensSnapshot`. However, it incorporates its own `appearance` override.
- **Light:** Uses the `tokens.colors.background` and `tokens.colors.foreground`.
- **Dark:** Completely ignores the `tokens` for background and foreground, arbitrarily forcing `#0b1020` and `#f3ead8` respectively. It also invents literal hexes for semantic surfaces like `paper`, `paperAlt`, and `ink` based on Appearance, ignoring project tokens entirely for these slots.

## 5. Fonts and Runtime Capabilities
Fonts are NOT arbitrary. An explicitly restricted map `RUNTIME_FONT_REGISTRY` supports exactly four web fonts: `Fraunces`, `Source Sans 3`, `Space Grotesk`, and `Inter`. 
- **Parity mechanism:** WOFF2 files are served locally from within the repository.
- **Fail safety:** In the browser, Remotion `TypographyReadyBoundary` utilizes `document.fonts.load()` to strictly hold rendering until the specific font face is successfully downloaded and evaluated. If an unsupported font is resolved, the system rejects it safely with a metric `typography_error` rather than silently cascading to system defaults.
Therefore, Project Identity **cannot** fetch Google Fonts arbitrarily. It must adhere strictly to keys registered within `RUNTIME_FONT_REGISTRY`.

## 6. Token Taxonomy (Minimum Required)
Based on genuine operational consumption, the baseline visual vocabulary is extraordinarily constrained.
**Typography (roles):**
- `display`
- `body`
(`label` is an optional structural mapping the adapter currently derives from body if absent).
**Colors:**
- `background`
- `foreground`
- `accent`
- `muted`

*There is no requirement to expose or configure `paper` or `ink` surfaces at the Identity level since templates govern their own idiosyncratic materials.* 

## 7. Resolution & Precedence Model
The proper precedence for any future design:
1. **Explicit Identity Fields:** If the persisted `ProjectIdentity` owns structured tokens (e.g., `expression.colors.background`), they formulate the `VisualTokensSnapshot`.
2. **Identity Default Fallback:** If absent, the adapter retains `CREATIVE_IDENTITY_DEFAULTS` to ensure the system is functionally continuous.
3. **Template Appearance Override:** As observed with `DocumentaryCard`, the Template handles contextual variants (e.g., "dark mode"). If a Template forcefully overrides Identity styles in specific variants, that belongs functionally to the layout component, not to the Identity.

## 8. Snapshot / Reproducibility Semantics
Snapshots already guarantee historical reproducibility. 
When a render execution is triggered (Static or Video), the `adaptProjectIdentityToVisualTokens` evaluates the project and creates the `identitySnapshot` (`VisualTokensSnapshot`). This strictly resolved node is then surgically nested *inside* the frozen table payload (e.g., `RenderExecutionInputSnapshot.identitySnapshot`).
- **Meaning:** If a Project Identity changes tomorrow (different fonts/colors), **it will absolutely not rupture old executed snapshots**. Historical renders preserve their embedded `identitySnapshot` variables and reproduce exactly as intended.
- **Authoring Reactivity:** For an open draft, changes to `ProjectIdentity` will instantly reflect across the canvas during active editing.

## 9. Backward Compatibility
Since past compositions were rendered without `ProjectIdentity` delivering literal definitions—having continually defaulted to `CREATIVE_IDENTITY_DEFAULTS`—existing projects continue effortlessly under this status quo. We establish additive fields without corrupting historical or active defaults. 

## 10. Schema and Migration Decision
No relational database migration is required. 
The system simply requires an **additive evolution of the Zod schemas**:
1. Expanding `ProjectIdentityExpressionSchema` to permit optional `colors` and `typography` payload objects.
2. The Database requires NO SQL migration (it is all localized to one `jsonb` column wrapper).

## 11. Smallest Future Implementation Slice
The smallest path forward involves:
1. Augment `ProjectIdentitySchema` logically.
2. Equip `adaptProjectIdentityToVisualTokens` to sniff the parameters explicitly and overwrite the standard payload.
3. Construct the corresponding `brand/visual` UI block in `components/projects/project-form.tsx` (the form that allows users to edit `project.context`).

## 12. Rejected Abstractions
- **Universal Remote Font Fetcher:** Rejected. Deterministic control forces dependency on the explicit `RUNTIME_FONT_REGISTRY` local font repository. 
- **Template Identity Merge Table:** Rejected. Templates provide structural semantic choices while Identity provides specific vocabulary—we do not collapse them into a universal branding engine.
- **Relational Asset Configuration:** Rejected. JSONB is provably sufficient for these structured style values, requiring no migrations.

## 13. Unresolved Questions
- `DocumentaryCard` dark mode completely disregards identity tokens and arbitrarily maps hexes. Should "dark mode" mapping eventually adapt algorithmically from identity tokens or remain a hardcoded template override? (Out of scope for Identity).

PROJECT_IDENTITY_VISUAL_TOKENS_DISCOVERY_V1_COMPLETE