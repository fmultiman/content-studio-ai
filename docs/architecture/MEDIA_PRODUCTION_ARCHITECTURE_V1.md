# Media Production Architecture V1

**Status:** canonical architecture freeze for the next implementation phase.

This document consolidates the factual reconnaissance, media-production reconciliation, and adversarial critical review. It records the current model, its intentional boundaries, its known incompleteness, and the work sequence. It does not introduce schema changes or implementation commitments beyond those explicitly marked as open or future.

## 1. Purpose

Content Agent Studio has separate concerns that must remain separate:

- editorial intent and publication targeting;
- source-media generation;
- media authoring and composition;
- deterministic rendering;
- durable media storage;
- discoverability, attachment, approval, and publication.

The architecture is intentionally minimal. Existing entities are reused where they fit. New entities are not introduced merely to make unlike lifecycles look symmetrical.

## 2. Architectural principles

1. Project provides product scope and identity context.
2. Production provides organizational, project-scoped context. It is not a render job, output container, workspace, campaign executor, approval entity, or template selector.
3. EditorialContent represents channel-independent editorial intent/content.
4. ChannelPiece adapts that content to a specific publication channel and format.
5. Generation, authoring, rendering, storage, attachment, approval, and publication are different steps.
6. Static and video use separate workspace shells and separate execution models.
7. Shared code is limited to neutral contracts and interfaces whose semantics actually match.
8. A constrained template-first workflow is the current learning strategy; a universal editor is not the goal.
9. Current gaps are documented as gaps. They are not filled with speculative entities.

## 3. Canonical domain model

~~~mermaid
flowchart TD
  Project --> ProjectIdentity[Project Identity]
  Project -->|1:N context| Production
  Project -->|1:N| EditorialContent
  Production -.->|0:N, nullable link| EditorialContent
  Production -.->|0:N, nullable link| ImageDraft
  Production -.->|0:N, nullable link| VideoDraft
  EditorialContent -->|1:N| ChannelPiece

  ChannelPiece --> TextPath[Text/publication content]
  ChannelPiece --> ExistingMedia[Existing media attachment]
  ChannelPiece --> Target[Derived channel/media target]
  Target --> StaticWorkspace[Static Workspace]
  Target --> VideoWorkspace[Video Workspace]

  SourceMedia[Source media / generation] --> Authoring[Authoring / composition]
  ExistingMedia --> Authoring
  Authoring --> Render[Rendering]
  Render --> GeneratedArtifact[Generated artifact]
  GeneratedArtifact -->|optional explicit save/import| LibraryFile
  LibraryFile -->|optional association| ChannelPieceMedia
  ChannelPieceMedia -->|explicit editorial decision| Approval[Approval / publication readiness]
~~~

The ChannelPiece to VideoDraft relationship is intentionally not shown as a decided foreign key. The contextual video-entry gap is real; its cardinality and reuse semantics remain open.

### Current entity roles

| Concept | Current role | Current state |
|---|---|---|
| Project | Top-level scope and owner of identity/context | Real, persistent |
| Project Identity | Reusable editorial/visual identity input | JSONB on projects; shape validated in application code; visual-token adapter currently uses defaults |
| Production | Project-scoped organizational context (title, intention, type) | Real; links are potentially one-to-many and nullable in schema |
| EditorialContent | Channel-independent editorial source | Real; not versioned |
| ChannelPiece | Channel/format-specific editorial/publication specification | Real; adapted text and editorial status |
| ImageDraft | Image-generation workspace/draft | Real; used by /imagens |
| VideoDraft | Persisted video authoring state (scenes JSONB) | Real; used by /videos |
| VideoScene | Ordered scene data inside VideoDraft | Real; library_file_id is the explicit asset binding seam |
| StaticRenderManifest | Ephemeral static render contract | Real contract; not persisted as an entity |
| TimelineManifest | Derived video render contract | Real contract; derived from VideoDraft |
| RenderExecution | Asynchronous video render state and worker coordination | Real; separate from durable Library storage |
| LibraryFile | Durable reusable media/asset record | Real; images and videos are supported by kind |
| ChannelPieceMedia | Association of media with a publication target | Real; exactly one of image_id or library_file_id |
| Gallery | Read/discoverability projection of generated results | Not a source of truth |
| ContentVersion | Not present | Intentionally deferred |

Legacy posts and the old videos table remain in the database/codebase, but are not the canonical media-production model. The posts migration is partial; editorial_contents and channel_pieces are the active publication model.

## 4. ChannelPiece

ChannelPiece is the channel/format-specific editorial and publication specification of an EditorialContent.

It owns:

- publication channel and format;
- adapted title/body/CTA/hashtags;
- editorial lifecycle status;
- the publication target to which text or media may be associated.

It may be fulfilled through three paths:

1. text/publication content directly;
2. existing media attached through ChannelPieceMedia;
3. newly produced media from an appropriate workspace.

It does not own:

- rendering or worker execution;
- generic authoring state;
- template implementation;
- AI/provider generation state;
- approval of a render by implication.

Channel and format may derive a target such as canvas or duration constraints, but those derived values are not currently stored on the ChannelPiece row.

### ChannelPiece to workspace direction

Where media production applies, the validated direction is:

ChannelPiece → derive target → open appropriate workspace → author → render → generated artifact

The current static path demonstrates the contextual entry seam. It does not prove that every format has a mature authoring surface. carousel currently enters the same single-card/single-canvas flow as other static formats; ordered slides and a true multi-slide/multi-output contract are not yet established. Video contextual entry is not implemented.

## 5. Production

Production is currently an organizational, project-scoped context between Project and specialized work. Multiple editorial contents and multiple image/video drafts may be associated with one Production; the links are nullable in the database even though current draft APIs require a Production in relevant flows.

Production should provide:

- project scope;
- human intention and organizational grouping;
- descriptive classification.

Production should not become:

- a campaign execution engine;
- a media container;
- a workspace record;
- a render job or output group;
- an approval state machine;
- a template or preset selector.

Production.type (editorial, branding, campaign) is currently descriptive and behaviorally inert. It must not select templates or canvases. If no real consumer appears, it is a candidate for future deprecation; that decision is open rather than silently assumed.

## 6. Media-production lifecycle

The conceptual lifecycle is:

~~~text
source media / generation
        ↓
authoring / composition
        ↓
rendering
        ↓
generated artifact
        ↓
optional explicit save/import to durable LibraryFile
        ↓
optional ChannelPieceMedia attachment
        ↓
explicit editorial approval/publication decision
~~~

Generation creates source media/assets. It is not composition.

Authoring combines text, assets, layout, templates, transforms, slides, scenes, timing, audio, and motion.

Rendering materializes authored state. Static rendering is synchronous/process-local today. Video rendering is asynchronous through render_executions and an external worker.

## 7. Image and static architecture

### /imagens

/imagens is primarily:

- AI image generation;
- image draft and result discovery.

Current image generation uses OpenAI/NanoBanana paths, persists drafts, stores generated images, and can evaluate/approve images against Project Identity. It is not the static composition editor.

Static composition currently enters contextually through:

EditorialContent → ChannelPiece → Editar Visual

### Editar Visual

The static authoring path is real but narrow:

1. load Project, Production, EditorialContent, ChannelPiece, identity, and primitive context;
2. create transient AuthoringState;
3. edit text, primitive selection, and transforms;
4. derive a StaticRenderManifest;
5. render synchronously to PNG;
6. optionally upload the PNG to LibraryFile and attach it through ChannelPieceMedia.

The current static implementation is fundamentally a single-card/single-canvas template flow. carousel is currently a ChannelPiece format label, not a persisted ordered slide model.

Static authored state is not yet fully persisted as resumable/re-runnable domain state. The rendered PNG may exist while the exact primitive choices, transforms, authored values, and template inputs cannot be reconstructed from stored domain data.

## 8. Video architecture

/videos is currently:

- the VideoDraft hub;
- the current video workspace entry point;
- the render/productization surface.

The operational path is:

~~~text
VideoDraft.scenes
  → TimelineManifest adapter
  → queued render_execution
  → external worker / Remotion
  → scratch object
  → completed render_execution
  → output URL / Gallery visibility
~~~

The render pipeline is operational. Mature video authoring is not.

Only explicitly bound scene assets (VideoScene.library_file_id) become real render assets. Scene description, prompt, and image_url are not currently mapped into template content. This is an explicit limitation, not an accidental content contract.

Current video completion does not automatically create a LibraryFile or ChannelPieceMedia row. Durable save/import is a separate required lifecycle boundary:

render completed → output available → explicit durable LibraryFile save/import → optional ChannelPieceMedia attachment → explicit approval

Future contextual ChannelPiece entry should reuse this video workspace/system rather than create a parallel video editor. The ChannelPiece ↔ authored-video cardinality and reuse model are open.

## 9. Static versus video workspaces

Do not build one universal Creative Workspace. Prefer separate shells:

- Static Workspace: canvas, content slots, primitives, transforms, static output.
- Video Workspace: scenes, ordering, duration, movement, timeline content, video output.

Potentially shared seams:

- Project/Production context;
- Project Identity input shape;
- AssetRef and Library lookup;
- template registry interfaces;
- manifest validation;
- output-save helpers where lifecycle semantics match.

Do not assume shared:

- authored-state representation;
- channel/media target constraints;
- content-binding semantics;
- execution state;
- approval state.

Runtime symmetry is not a goal: static is synchronous/process-local; video is asynchronous/worker-based.

## 10. Templates, presets, identity, and constraints

These concepts remain distinct:

| Concept | Meaning |
|---|---|
| Project Identity | Reusable project editorial/visual context; not a template |
| Channel constraint | Publication/media requirement derived from channel and format |
| Preset | Convenient technical/default configuration; no persisted entity today |
| Template | Reusable authored composition structure and style |

ChannelPiece is not a template. Project Identity is not a template. Production.type is not a template selector.

The current channel target function validates/derives only coarse defaults. Full aspect-ratio, duration, safe-area, and export constraints are not yet modeled.

### DocumentaryCard

DocumentaryCard is the current constrained static template and a useful learning vehicle for Portal Comunidades Alternativas. It must not become the editor architecture and must not automatically become the video template.

The current video adapter hardcodes DocumentaryCard for real video segments. That is proof-era coupling: it is a known current limitation, not the desired product model.

### Authoring strategy

The decision is HYBRID / TEMPLATE-CONSTRAINED LEARNING:

~~~text
real use case
  → real constrained template
  → concrete authoring need
  → reusable primitive/control only when justified
~~~

This is not a Canva, Photoshop, After Effects, Premiere, or DaVinci clone. Free/custom authoring may emerge later from proven primitives; it is not the current architecture.

## 11. Gallery, Library, attachment, approval, publication

- Gallery: discoverability/read projection of generated results.
- Library: durable reusable media/assets.
- ChannelPieceMedia: association of media with a publication target.
- Approval: explicit editorial decision, not implied by rendering or Gallery visibility.
- Publication: broader distribution concept remains deferred; no unified publication/output entity is introduced here.

Preserve these distinctions:

~~~text
latest render ≠ approved output
generated ≠ approved
Gallery visibility ≠ Library durability
Gallery visibility ≠ ChannelPiece attachment
render completion ≠ editorial approval
~~~

Do not introduce a unified persisted Output entity. Render executions, scratch artifacts, LibraryFiles, ChannelPieceMedia associations, and approval state have different persistence lifecycles. A shared read-model/helper may eventually reduce projection duplication without normalizing these states into one table.

## 12. Automation and reproducibility

The target capability is an agent that can take:

- Project context;
- Project Identity;
- EditorialContent;
- ChannelPiece;
- source assets;
- template and authored state;

and reproducibly produce media.

This is not fully achieved today.

The primary current gap is static authored-state persistence. A manifest can be derived and a PNG can be saved, but the exact authored creative state is not yet a durable, resumable command. Project Identity is also not yet a fully deterministic visual-token source because the current adapter uses defaults.

Video has stronger render reproducibility because the server freezes a render snapshot, but its ChannelPiece relationship and durable Library save lifecycle remain incomplete.

## 13. Known current gaps and bounded bugs

1. Pack B asset-path/export drift. Runtime rendering resolves Pack B paths differently from worker export packaging. This is a bounded asset-infrastructure bug. Because DocumentaryCard is hardcoded into every current video render, it also exposes static-template leakage into video proof composition.
2. tiktok:reel classification. Static-authoring classification is hardcoded around Instagram exclusions and currently treats tiktok:reel as static. This is a bounded routing bug.
3. DocumentaryCard hardcoded in the video adapter. Proof-era coupling; not the desired video-template architecture.
4. Static authored-state persistence/reproducibility. Exact authoring choices are not fully durable or resumable.
5. Video render to durable Library save. Render completion currently yields a completed execution and output URL, not an automatic LibraryFile.
6. ChannelPiece ↔ authored video relationship. Contextual entry is missing and cardinality/reuse semantics are unresolved.

## 14. Open decisions

These are intentionally deferred decisions, not architectural failures:

- Can one ChannelPiece have multiple authored VideoDrafts for alternatives or revisions?
- Can one VideoDraft serve multiple ChannelPieces for cross-posting?
- What do cross-posting, alternate, and revision mean operationally?
- What is the exact durable video output-save/import lifecycle?
- What persisted static AuthoringState is the minimum contract for resume and deterministic reproduction?
- When should template/preset selection become stored rather than derived?
- Should Production.type eventually be deprecated if it remains behaviorally inert?
- When does a second real project justify primitive/catalog generalization?

No ChannelPiece ↔ VideoDraft schema decision is made in V1.

## 15. NOW / NEXT / LATER

### NOW

- Fix bounded Pack B and media-routing bugs where appropriate.
- Finish the Portal Comunidades Alternativas static path as a real carousel-capable workflow, including ordered slide state and the necessary multi-output contract.
- Determine and persist the minimum static authored state required for resume and deterministic reproduction.
- Complete the current template-driven static workflow end to end.
- Keep existing AI image generation functional.
- Keep the authoring kernel narrow and evidence-driven.

### NEXT

- Generalize only primitives proven reusable by a second real static use case.
- Test another real static ChannelPiece/use case.
- Formalize generated-output → durable Library save behavior where needed.
- Take the first real video ChannelPiece through the product.
- Define ChannelPiece → VideoDraft/workspace semantics from observed cardinality and reuse requirements.
- Implement only the minimal video authoring capability required by that real ChannelPiece.

### LATER

- Broader custom/free authoring.
- Richer video templates and timeline/motion editing.
- AI video/clip generation.
- Clip as a domain concept only if behavior requires it.
- Broader template/preset systems.
- Shared media read models where repeated use cases justify them.
- Any unified abstraction proven by multiple real use cases.

## 16. Explicit non-goals

- No ContentVersion entity now.
- No Clip table or current Clip abstraction.
- No unified persisted Output entity.
- No static RenderExecution merely for symmetry.
- No universal workspace/editor.
- No AI video generation implementation now.
- No generalized template system ahead of real use cases.
- No attempt to make static and video runtime execution identical.
- No coupling of Production.type to templates or rendering.

## 17. Architecture decision summary

| Decision | Status | Reason |
|---|---|---|
| ChannelPiece remains core | Confirmed | Correct home for channel/format publication intent and adapted editorial content |
| Production remains contextual | Confirmed | Project-scoped organizational context; not a renderer or output owner |
| Separate static/video workspace shells | Confirmed | Authored state, controls, constraints, and execution differ materially |
| Hybrid/template-constrained authoring | Confirmed | Learn reusable primitives from real constrained work |
| No universal editor | Confirmed | No evidence for freeform editor architecture |
| No ContentVersion | Confirmed | No current entity, workflow, or validated need |
| No Clip entity | Confirmed | LibraryFile(kind='video') and VideoScene.library_file_id are sufficient today |
| No unified Output table | Confirmed | Render, scratch, Library, attachment, and approval lifecycles differ |
| No ChannelPiece ↔ VideoDraft schema decision yet | Open | Cardinality, reuse, cross-posting, and revision semantics are not proven |
| Static authored-state persistence required | Gap / target | Strong automation and resume require reproducible authored inputs |
| Video durable-save lifecycle still required | Gap / target | Completed render currently remains an execution/scratch output until explicit save/import |
| AI video generation deferred | Confirmed | Future capability, not current product scope |

