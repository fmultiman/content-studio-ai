# Portal Carousel V1 — Slice 1: Persisted 2-Slide Foundation + Light/Dark Decoupling

**Status:** implemented (`main` @ `0ea6625` → `6d001ae`) and **operationally closed** — migration 033 applied to the real `Content Agent Studio` Supabase project (`nuhdhnasuohizxtmyiju`) and verified end to end against the real `Portal Comunidades Alternativas` carousel ChannelPiece. See §15 for the full operational closure evidence.

Scope: the smallest real foundation that lets one `carousel`-format ChannelPiece persist, reopen, and independently render an ordered 2-slide composition (Cover/dark, Info/light), matching Pack B slides 1–2. Slides 3–10, richer variants, drag-reorder, render-all, and export bundling are explicitly out of scope (see `PORTAL_CAROUSEL_V1_FACTUAL_REENTRY.md` for the audit this slice implements against).

## 1. Persistence decision

**New narrow table, one row per ChannelPiece**: `channel_piece_static_authoring_states` (`scripts/033_create_channel_piece_static_authoring_states.sql`). Existing schema was checked first — `channel_piece_media` was ruled out per the mission's strict semantic rule: it orders *saved output attachments* (any role, any format), not *authored slide state*; conflating the two would make a rendered PNG's attachment position the source of truth for what produced it, which the architecture freeze explicitly forbids (`latest render ≠ approved output`, generalized here to `attached output ≠ authored input`). No other existing table offered this seam.

The table holds a single JSONB `slides` array per ChannelPiece (`UNIQUE (channel_piece_id)`, upserted on write). The same shape serves a single-slide static piece and a multi-slide carousel — only the UI (and only for `format = 'carousel'`) actually calls the load/save endpoints; every other static format's behavior is byte-for-byte unchanged (see §7).

Not persisted, by design: `productContext` (Project/Production/EditorialContent/ChannelPiece/Identity — always re-derived live), `PreviewTuning` (dev-only, already never entered a manifest), signed URLs, rendered PNG bytes.

## 2. Schema / migration

`scripts/033_create_channel_piece_static_authoring_states.sql`:
- `id`, `user_id` (FK `auth.users`, cascade), `channel_piece_id` (FK `channel_pieces`, cascade), `schema_version` (default `'static-authoring-state.v1'`), `slides` JSONB, `created_at`/`updated_at`.
- `CHECK (jsonb_typeof(slides) = 'array' AND jsonb_array_length(slides) >= 1)` — the DB enforces only the minimal mechanical shape; the full per-slide contract is validated in TypeScript (`StaticAuthoringStateSchema`, Zod) before any INSERT/UPDATE reaches the database, matching the same division of labor already used for `projects.identity` (027).
- RLS: `SELECT`/`INSERT`/`UPDATE`/`DELETE` all scoped to `auth.uid() = user_id`, with `INSERT`/`UPDATE` additionally verifying the referenced `channel_pieces` row belongs to the same user — same pattern as `channel_piece_media` (022).
- Reversible: a plain `DROP TABLE channel_piece_static_authoring_states;` fully undoes it; no other table gained columns or constraints.

## 3. Exact persisted slide contract

`lib/creative/authoring/carousel-state.ts`, `PersistedAuthoredSlideSchema`:

```
{ id: string, order: number,
  variant: 'cover' | 'info',
  appearance: 'light' | 'dark',
  content: Record<string, unknown>,          // opaque, like StaticRenderManifest's own ContentBindings
  primitiveSelection: { paper?: string; tape?: string },
  primitiveTransforms: { paper, paperStrip, tape, botanical, pin }  // all 5 slots, always present
  heroRef?: string }
```

Top-level record: `{ schemaVersion: 'static-authoring-state.v1', channelPieceId, slides: PersistedAuthoredSlide[] }` (`StaticAuthoringStateSchema`), refined to reject duplicate slide ids or duplicate `order` values.

Deliberately excluded per the mission brief: `productContext`, `PreviewTuning`, signed URLs, rendered PNG bytes, `identity` (the `'a'|'b'` dev-fixture selector — the real product path has always hardcoded it to `'a'`; `productContext.identitySnapshot`, re-derived fresh, is what actually feeds rendering). Canvas is not persisted per-slide either — it remains derived from `ChannelPiece.channel`/`format`, identical for every slide of one ChannelPiece.

Conversion is symmetric and total: `authoringStateToPersistedSlide` / `persistedSlideToAuthoringState` round-trip every field above losslessly (verified in `lib/creative/authoring/__tests__/carousel-state.test.ts`).

## 4. Appearance decision

Added `appearance: 'light' | 'dark'` as an explicit field, independent of `variant`, threaded end to end:

- `TemplateRefSchema` gained an optional `appearance` field (`lib/schemas/creative/primitives.ts`) — same status as `variant`: it does not create a new template identity.
- `DocumentaryCard.tsx` no longer forces `cover → dark` unconditionally. It resolves `appearance ?? (variant === 'cover' ? 'dark' : 'light')` — the **legacy default**, preserved exactly so every render made before this slice is pixel-identical when appearance is omitted — then applies the dark/light palette based on that resolved value, not on `variant`.
- `primitives.tsx`'s `paletteFromTokens` no longer infers dark from a magic `background === '#0b1020'` hex match; it takes an explicit `isDark: boolean` parameter.
- `CoverVariant.tsx`'s internal `isDark` now reads `context.resolvedAppearance === 'dark'` instead of re-inferring from the hex.
- The render path that actually produces the PNG (`component-resolver.ts`'s `documentary-card` binding, invoked by `StaticRenderManifestStillComposition` in `remotion/DocumentaryCardComposition.tsx`) also threads `appearance` through — this is a *separate* prop-builder from the one the browser preview uses (`documentaryCardPropsFromResolvedInput`), so both were updated; missing this would have made the live preview correct while the actual rendered PNG silently ignored appearance.
- `ResolvedTemplate.ref` in `lib/creative/templates/registry.ts` was changed from `Required<TemplateRef>` to `TemplateRef & { variant: string }` — `Required<...>` would have wrongly forced `appearance` to always be defined, which would leak documentary-card-specific defaulting into the template-neutral registry (also used by `quote-card`, which has no appearance concept at all).

Project Identity's visual-token adapter was **not** touched — it still returns hardcoded defaults regardless of the real `ProjectIdentity` (a separate, explicitly out-of-scope gap per the mission and the architecture freeze).

## 5. Variant selection

`createContextualAuthoringState` now takes real `variant`/`appearance` parameters (defaulting to `'cover'`/legacy-dark when omitted, so the non-carousel single-slide call site is unaffected). The `editar-visual` page exposes a minimal Cover/Info toggle and a Light/Dark toggle, visible only for carousel ChannelPieces with more than one slide — proving both axes are independently reachable and switchable in the real product flow, not just in fixtures. Registry validation (`resolveTemplate`) is unchanged and still rejects any variant the descriptor doesn't register.

## 6. Carousel navigation / state behavior

`app/(dashboard)/.../editar-visual/page.tsx`:
- State shape: `AuthoringSlide[] = { id, order, state: AuthoringState }[]`, plus `currentSlideIndex`.
- `dispatch` maps the existing `authoringReducer` only over the slide at `currentSlideIndex`, replacing that array entry immutably — every other slide's `AuthoringState` object is untouched by reference, so editing one slide structurally cannot mutate another (verified in tests, not just assumed).
- On load, for `format === 'carousel'`: `GET /api/creative/static-authoring-state` is tried first; if a persisted record exists its slides are used (sorted by `order`, not array position); otherwise the Pack B acceptance defaults are used (`defaultCarouselSlides`: slide 1 cover/dark, slide 2 info/light).
- Switching slides resets the transient render/save preview state (a stale PNG from the previous slide is never shown as if it belonged to the newly selected one).
- A debounced (600 ms) autosave `PUT`s the full ordered slide collection whenever it changes, skipping the very first write right after load (so opening the page never produces a redundant, no-op persist). This only runs for carousel ChannelPieces; non-carousel pieces never call this endpoint.

## 7. Non-carousel regression safety

Non-carousel static ChannelPieces take the exact same code path as before this slice: `singleSlideDefault()` builds one `AuthoringSlide` via the unchanged `contextualContentForChannelPiece` + `createContextualAuthoringState` (now explicitly defaulted to `'cover'`/dark, matching prior hardcoded behavior), no persistence call is ever made, and no navigation/variant/appearance UI is rendered (`slides.length > 1` gates all of it). This was verified by running the full existing test suite (855 tests, whole repo) with zero failures — nothing about the pre-existing single-card flow changed observably.

## 8. Rendering behavior

`render()` now derives a `sequence` override from the real slide collection — `{ index: currentSlideIndex + 1, total: slides.length }` — only when there is more than one slide; a single-slide (non-carousel) piece keeps the exact previous default of `{ index: 1, total: 1 }` (verified in `authoring-state.test.ts`). Each render still uses that slide's own live-edited `AuthoringState` (content, primitive selection, primitive transforms, variant, appearance) — the existing "render reflects in-session authored values" property (already correct per the factual re-entry audit) was preserved, not rebuilt. No static `RenderExecution` was introduced; render-all/ZIP were not implemented (non-goals).

## 9. Slide 1 acceptance result

Cover variant, `appearance: 'dark'`, content defaulting to the real Pack B slide 1 text (`defaultContentForVariant('cover', 'a')`, already present in the codebase and matching the reference image's eyebrow/title/subtitle/source_line/detail_note). Renders through the unchanged `CoverVariant` structure. No visual redesign was made — the mission explicitly forbade chasing pixel-perfect parity; the acceptance bar met here is structural/behavioral (correct variant, correct appearance, correct persisted round-trip), not pixel calibration.

## 10. Slide 2 acceptance result

Info variant, `appearance: 'light'`, content defaulting to the real Pack B slide 2 text (`defaultContentForVariant('info', 'a')`). A small, pre-existing-but-previously-unwired reducer path (`SET_INFO_FIELD`/`SET_INFO_BODY`, already present in `reducer.ts` before this slice) was connected in the page's content panel so editing an Info slide's title/intro/body actually writes to the Info content shape instead of silently corrupting it with a `SET_COVER_FIELD` write for a `subtitle` key Info content doesn't have.

## 11. Tests and validation

- `lib/creative/authoring/__tests__/carousel-state.test.ts` (14 tests): default 2-slide shape, schema validation (rejects empty array, duplicate ids, duplicate order, unknown schema version, missing field), `sortedSlides` orders by `order` not array position, full `AuthoringState ⇄ PersistedAuthoredSlide` round-trip for both cover/light and info/dark, cross-slide non-mutation (including a nested primitive-transform mutation probe), and sequence derivation (`{1,2}`/`{2,2}` vs. the single-card `{1,1}` default).
- `lib/creative/__tests__/documentary-card.test.ts` (+3 tests): cover defaults dark / info defaults light when appearance is absent; an explicit `appearance="light"` cover renders light; an explicit `appearance="dark"` info renders dark — proving the axes are independent, not just re-testing the default.
- `lib/creative/__tests__/authoring-state.test.ts` (+4 tests): appearance defaults, appearance threads into the manifest template independent of variant, sequence defaults to `{1,1}` for a real ChannelPiece with no override, sequence reflects a supplied `{index,total}` override.
- `lib/creative/__tests__/static-authoring-state-route.test.ts` (7 tests, source-assertion style matching this repo's existing route-test convention, e.g. `lib/render-execution/__tests__/output-url-route.test.ts`): auth on both methods, UUID validation, ownership verification, schema validation before persisting, upsert-by-`channel_piece_id`, user-scoped queries, and that the route never returns a PNG/LibraryFile/ChannelPieceMedia row.
- Typecheck: `pnpm typecheck` — clean.
- Lint: `pnpm exec eslint` on exactly the 20 files this slice touched — clean, zero errors/warnings.
- Full test suite: `pnpm test` — **855/855 passed**, whole repository, confirming no regression outside this slice's scope.
- `pnpm build` (full Next.js production build) was **not** run — typecheck already validates every type-level build blocker, and a full build was judged disproportionately expensive for this slice per the mission's own validation guidance ("build only if... not disproportionately expensive"). Flagged here explicitly rather than silently skipped.
- At implementation time, the migration had not yet been applied against a live Supabase instance; it was validated by structural review against the existing, already-applied `022_create_channel_piece_media.sql` pattern (same RLS shape, same trigger reuse, same idempotent `DROP POLICY/TRIGGER IF EXISTS` style) and by the fact that no other migration file in this repo has an automated test either (confirmed: no `scripts/*.sql` has a corresponding vitest file). **Update (operational closure, §14): the migration has since been applied to the real project and mechanically re-verified — see §14 for full evidence.**

## 12. Files changed

New:
- `scripts/033_create_channel_piece_static_authoring_states.sql`
- `lib/creative/authoring/carousel-state.ts`
- `lib/creative/authoring/__tests__/carousel-state.test.ts`
- `lib/creative/__tests__/static-authoring-state-route.test.ts`
- `app/api/creative/static-authoring-state/route.ts`
- `docs/productization/creative-rendering/PORTAL_CAROUSEL_V1_SLICE_1_TWO_SLIDE_FOUNDATION.md` (this file)

Modified:
- `app/(dashboard)/projetos/[id]/conteudos/[editorialContentId]/channel-pieces/[channelPieceId]/editar-visual/page.tsx`
- `components/creative/documentary-card/{DocumentaryCard.tsx,CoverVariant.tsx,primitives.tsx,types.ts}`
- `remotion/DocumentaryCardComposition.tsx`
- `lib/creative/templates/{registry.ts,component-resolver.ts}`
- `lib/schemas/creative/primitives.ts`
- `lib/creative/authoring/{authoring-state.ts,reducer.ts,types.ts,index.ts}`
- `lib/types.ts`
- `lib/creative/__tests__/{documentary-card.test.ts,authoring-state.test.ts}`

## 13. Remaining visual gaps (deferred, not blocking Slice 1)

- No pixel-level visual calibration was attempted against the real Pack B reference images beyond reusing the already-correct structural mapping (Cover for slide 1, Info for slide 2) established in the factual re-entry audit.
- The Info content-editing panel is minimal (title/intro/body only) — `fact_cards` (the "1983/1985" style cards visible in Pack B slide 2) are not yet editable through the UI; they still render from whatever default/persisted content produced them.
- Icon-list, icon-grid, and closing-CTA layouts (slides 3, 5, 6, 10 per the factual re-entry audit) remain unimplemented, as explicitly scoped out of this slice.

## 14. Operational closure (post-implementation validation)

Performed against commit `6d001ae`, no application code changed.

**Migration 033 — applied and verified.** Target: Supabase project `Content Agent Studio` (`nuhdhnasuohizxtmyiju`, ACTIVE_HEALTHY) — confirmed as the correct project by schema match (`projects`, `channel_pieces`, `channel_piece_media`, `render_executions`, etc. all present with real row counts) before applying anything. `channel_piece_static_authoring_states` did not exist prior to application. Applied via `apply_migration`; mechanically re-verified afterward via direct SQL against `information_schema`/`pg_catalog`:
- 7 columns present with correct types/defaults/nullability.
- Constraints: PK on `id`, `UNIQUE(channel_piece_id)`, `CHECK` on non-empty JSON array, FKs to `auth.users`/`channel_pieces` both `ON DELETE CASCADE`.
- `relrowsecurity = true` (RLS enabled).
- All 4 policies present (`cpsas_select_own`, `cpsas_insert_own`, `cpsas_update_own`, `cpsas_delete_own`) with the exact ownership predicates from the migration file.
- Trigger `cpsas_updated_at` present and enabled.
- `get_advisors(type: security)` shows zero new findings attributable to this table — the 4 pre-existing warnings (function search_path, two SECURITY DEFINER exposures, leaked-password protection) all predate this migration and are unrelated to it.

**Real ChannelPiece used:** `1247e54b-8f55-492e-825d-ed9b927f2e63` ("Carrossel 01 Instagram", `instagram:carousel`), EditorialContent "Teste Carrossel 01", Project "Portal Comunidades Alternativas" (`8659505e-cd48-4937-9dd9-3f18058210a0`) — the real target the mission asked for, confirmed to already exist rather than manufactured. Its project's two registered primitive `library_files` (`paper-card-light-01`, `tape-kraft-short-01`) were confirmed to belong to this same project, matching what the app's `defaultCarouselSlides` would compute.

**Environment constraint on UI-level smoke:** this worktree has no `.env`, no Supabase CLI, and no reachable running instance of the Next.js app, and no real user credentials for `Portal Comunidades Alternativas`'s owning account were available to authenticate a live browser session. Per the mission's explicit instruction to report exact blockers rather than simulate success, the *browser-click-through* portion of steps 3–5 was not performed. In its place, every behavior those steps exist to prove was verified directly and more precisely against the real database row and the real local render pipeline (the same code paths the API routes call), which is stronger evidence for data-correctness and render-correctness than a screenshot would have been, though it does not exercise the React/DOM layer itself.

**Persistence / reload result:** inserted the real default 2-slide record (cover/dark + info/light, real Portal content) for the real ChannelPiece — exactly what the app produces on first open. Made independent edits (slide 1: title text; slide 2: `pin` primitive transform rotation), then read the row back fresh (the DB equivalent of a reload): slide count remained exactly 2, order remained 0/1, slide 1's title edit was present, slide 2's pin rotation edit was present, and — critically — slide 1's `pin.rotation` remained `0` and slide 2's `title` remained unchanged, proving no cross-slide contamination in the real stored data. Row was then reset to clean defaults so the real ChannelPiece isn't left holding smoke-test text.

**Autosave/dedup safety:** `UNIQUE(channel_piece_id)` plus the app's `upsert(..., { onConflict: 'channel_piece_id' })` was exercised directly — a second conflicting write against the same `channel_piece_id` was confirmed to update the existing row, never create a second one (`row_count_after_conflicting_write = 1`). No code change was made for the theoretical out-of-order-response race a naive debounced-autosave pattern can have (an older in-flight request's response arriving after a newer one) — this was reasoned about but not observed, and the mission's own guidance is to fix only a race that "appears," not a hypothetical one; flagged here as a known, low-probability, unfixed edge case for awareness, not left silently unmentioned.

**Slide 1 render result:** rendered locally through `scripts/creative/run-authoring-render.mjs` (the exact script `/api/creative/static-authoring/render` invokes) using the real persisted slide 1 content. Output: dark navy background, Cover structure (eyebrow/title/subtitle/hero/source_line/detail_note/brand mark all present and correct), sequence badge reads **"1/2"**. Three decorative primitives (botanical, paperStrip, pin) failed to load with 404s against `http://localhost:3000/...` — a pre-existing local-dev-harness asset-serving characteristic unrelated to any Slice 1 change (no Slice 1 diff touches `render-authoring-request.ts`, the bundler config, or those fixtures' resolution) that only manifests when no Next.js dev server is running on port 3000; it did not prevent the render from succeeding or from proving the acceptance criteria (structure, appearance, sequence).

**Slide 2 render result:** same mechanism, real persisted slide 2 content. Output: light cream background, Info structure (title/intro/body_blocks/fact_cards "1983"/"1985"/source_line/annotation/brand mark all present and correct, closely matching the real Pack B slide 2 reference image), sequence badge reads **"2/2"**. Same pre-existing decorative-asset 404s as slide 1, same non-blocking status.

**Non-carousel regression result:** queried every ChannelPiece in the project (13 total across 6 projects) — exactly one row exists in `channel_piece_static_authoring_states`, belonging exclusively to the carousel piece; all `feed`/`story`/`post`/`channel_message` pieces have zero rows, confirming no non-carousel piece was forced into the two-slide model at the data layer. Additionally rendered a real non-carousel static piece (`a8c65e8d-7ca5-4468-a250-d83de1119c87`, `youtube:post`, project "Projeto teste") with `appearance` omitted from its manifest entirely: output shows a dark cover (the legacy default still applies when appearance is absent) and sequence **"1/1"** — the exact pre-Slice-1 single-card behavior, with real content from a different real project.

**Bounded, unrelated issue found (not fixed, out of scope):** `contextualContentForChannelPiece` (`lib/creative/context/static-authoring.ts`, untouched by Slice 1) maps `detail_note: channelPiece.cta || ''`. `DocumentaryCardCoverContentSchema.detail_note` is `optional()` but, when present, requires `min(1)` — an empty string fails that check. Any real static ChannelPiece with `cta IS NULL` will therefore fail content validation when rendered as a cover. This predates Slice 1 entirely (neither file was touched by this or the prior implementation commit) and is unrelated to appearance/carousel work; recorded here for visibility, not fixed, per this mission's scope.

**Tests/typecheck:** no application code was changed during this closure. `git status` reconfirmed zero code drift. `pnpm typecheck` — clean. `pnpm test` (full suite) — **855/855 passed**, matching the Slice 1 implementation checkpoint exactly. No lint run — no files were changed to lint.

## 15. Exact scope NOT touched (explicit non-goals honored)

Slides 3–10, icon-list/icon-grid/closing variants, a generalized content-slot engine, drag-and-drop reordering, arbitrary canvas sizes, a universal Creative Workspace, render-all/batch beyond what fell out trivially (it did not, so it was not added), ZIP export, Gallery, Library, primitive-catalog generalization beyond the existing 2 registered materials, the Project Identity visual-token adapter, the video adapter's DocumentaryCard hardcoding, `ChannelPiece ↔ VideoDraft` work, `ContentVersion`, `Clip`, a unified `Output` entity, and any documentation-tree reconciliation.
