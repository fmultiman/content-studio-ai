# Phase 2E-A — Contextual Static Authoring Shell

## 1. Objective

Promote static authoring from the engineering surface `/dev/creative-preview` to the smallest authenticated product surface that opens a real `ChannelPiece` in context:

`Project → Production → EditorialContent → static ChannelPiece → static authoring`.

No new domain entity was introduced. Timeline product work, output approval, browser S3 parity, and navigation redesign remain out of scope.

## 2. Previous fixture-data block

**FACT:** the previous attempt stopped as `STATIC_AUTHORING_FIXTURE_DATA_REQUIRED`; no source or data changes remained. The required Portal context was subsequently created manually through the real Content Studio UI. No insert, fixture, migration, or storage mutation was used in this phase.

## 3. Newly available real context

**FACT:** authenticated product UI confirmed the following chain:

- Project: `Portal Comunidades Alternativas`;
- Production: `Carrossel Test`;
- EditorialContent: `Teste Carrossel 01`;
- ChannelPiece: Instagram / Carrossel, status Rascunho, title `Carrossel 01`, body `O que são Comunidades Alternativas?`;
- project identity: shown by the product as available as editorial reference;
- project-scoped primitives: `paper-card-light-01` and `tape-kraft-short-01`.

The loader resolves IDs from the authenticated route parameters and relational queries; it does not depend on manually supplied IDs or fixture mapping.

## 4. Domain revalidation

**FACT:** `Project` owns `Production`; `EditorialContent` carries `project_id` and optional `production_id`; `ChannelPiece` carries `editorial_content_id`, channel, format, publication fields, status, and textual content. The existing content detail page already renders ChannelPieces in this hierarchy. This confirms `ChannelPiece` as the static authoring context required by Phase 2D0.

## 5. Chosen product entry point

**RECOMMENDATION:** retain the existing EditorialContent detail route and add the smallest contextual action, `Editar visual`, on static ChannelPieces. The action opens:

`/projetos/:projectId/conteudos/:editorialContentId/channel-pieces/:channelPieceId/editar-visual`.

No top-level Creative Studio navigation or sidebar change was made.

## 6. Static authoring context

The new runtime context contains Project, Production, EditorialContent, ChannelPiece, normalized Project Identity, target configuration, and project primitive display metadata. It is a view/runtime boundary, not a persisted entity.

The server route validates UUIDs, authenticates with the existing Supabase server client, enforces user ownership, verifies all parent relationships, and rejects timeline formats. The render route repeats these checks instead of trusting the browser.

## 7. Auth / ownership

**FACT:** both context loading and rendering use `supabase.auth.getUser()` and owner-scoped queries. There is no service-role browser access, hardcoded user, RLS bypass, or fixture identity selector in the product surface. Missing project, content, piece, production, or identity produces an explicit error response.

## 8. Project Identity path

The context loader normalizes `project.identity` using the existing Project Identity normalizer. The existing adapter then derives the deterministic `VisualTokensSnapshot` used by preview and render. Structured visual tokens are **DEFAULTED** by the existing adapter when Identity V1 contains only textual fields; the source identity itself is **DIRECT** from Project. No Identity schema was changed.

## 9. ChannelPiece target mapping

The adapter reuses the domain's existing `PublicationChannel` and `PublicationFormat` values. It maps static formats to the shared static canvas (1080×1350), with Instagram Story mapped to 1080×1920. Reel, short, and video-description formats are rejected from this shell. No second Instagram/YouTube/Reel enum was created.

## 10. Promoted/reused authoring components

**PROMOTE / REUSE:** `AuthoringState`, primitive selection, primitive transforms, template resolution, `DocumentaryCard`, render request parsing, primitive discovery, and the existing render script. A small shared reducer and product-facing primitive picker/transform controls were added around those contracts.

**ADAPT:** `resolvePreviewInput` and manifest derivation now accept runtime product context while preserving the fixture lab path. Contextual content is derived from ChannelPiece with EditorialContent fallback.

## 11. Dev-only components retained

`/dev/creative-preview` remains intact as a regression harness. Its fixture identity/project selectors, debug panel, raw diagnostics, fixture labels, and development-only bridge remain dev-only. They are not rendered in the product shell.

## 12. Initial AuthoringState

The product page initializes shared `AuthoringState` from the real context: ChannelPiece text, target canvas, Project-derived identity snapshot, template defaults, and semantic primitive keys. Primitive IDs, storage paths, signed URLs, and S3 details never enter UI state.

The runtime-only `productContext` is carried beside the existing authoring fields. The neutral manifest remains a `channel_piece` manifest and does not gain `PrimitiveRef`.

## 13. Primitive discovery

The server confirms that the two registered LibraryFiles belong to the authenticated real Project before exposing the project-scoped catalog. The UI receives only key, display name, category, version, and project reference. Selection is semantic; resolution to LibraryFile/S3 remains server-side in the existing pipeline.

## 14. Product shell

The new page uses the existing dashboard layout, cards, buttons, labels, badges, spacing, and typography conventions. Its context header shows Project, Production, EditorialContent, ChannelPiece, channel/format, and status. The center authoring area contains the shared DocumentaryCard preview, content fields, primitive pickers, transform controls, reset, and render action.

## 15. Preview behavior

Preview uses the same `DocumentaryCard` React tree and the same content, template, selection, transform, and canvas semantics as final render. The known Phase 2C constraint remains: browser preview may use the fixture/proxy visual material while final render resolves the real S3 binary. Pixel parity is therefore not claimed.

## 16. Render path

`AuthoringState → render request → authenticated context validation → semantic primitive validation → Project identity adapter → existing render-authoring request → LibraryFile/S3 resolution → primitive transforms → DocumentaryCard → PNG`.

The render route does not create a second renderer. It overwrites the request identity snapshot with the server-derived Project value and keeps the neutral manifest free of storage references.

## 17. Live proof

**FACT:** the real authenticated Content Studio UI proof established the newly created Project/Production/EditorialContent/ChannelPiece chain and identity availability. The implementation includes the route and render path for that chain. The local environment did not contain auth/database credentials, so an interactive local route smoke could not be run without bypassing security; that constraint is recorded rather than worked around.

## 18. Output persistence status

The phase returns a generated PNG to the authoring surface. It does not associate the render with approved or published media and does not mutate ChannelPiece, Library, or approval state. `latest/generated render != approved output` remains an explicit future boundary.

## 19. Browser proof

The deployed authenticated browser session was used read-only to verify the real context. Local browser execution was not possible because this worktree has no local auth/database environment. No credentials were copied, no service role was used, and no security bypass was introduced.

## 20. Tests

Added high-value coverage for:

- static vs timeline ChannelPiece mapping;
- target canvas mapping and no parallel target enum;
- contextual content derivation;
- real-shaped `AuthoringProductContext` initialization;
- semantic primitive selection;
- channel-piece manifest source and absence of fixture metadata.

Focused authoring tests: 36 passed. Existing render, primitive, timeline, and identity tests remain green.

## 21. Baseline

- Full suite: 505/505 tests passed before and after the phase changes;
- typecheck: PASS;
- lint: PASS, baseline 0 errors / 45 warnings;
- production build: PASS (Next.js optimized build, including the new contextual page and API routes).

## 22. Remaining constraints

- Browser preview real-S3 binary parity remains deferred to Phase 2D-C infrastructure work;
- local authenticated browser smoke remains unavailable without a configured local auth/database environment;
- output persistence, approval, and publication references remain deferred;
- primitive catalog V0 remains project-scoped and only the existing Portal starter pack is exposed.

## 23. Productization status

The Authoring Lab remains a dev harness. The product shell now consumes the same shared creative core through a real, authenticated, relationship-checked static context. No domain model fork was introduced.

## 24. Verdict

**PASS_WITH_CONSTRAINTS**

The required real static context exists and is structurally confirmed. ChannelPiece is the correct contextual unit; Project Identity, project-scoped primitives, shared AuthoringState, DocumentaryCard, and the existing render pipeline are wired through a product shell. The remaining constraints are the explicitly accepted browser auth/S3-preview and output-persistence boundaries; no database, schema, storage, or approval mutation was performed.
