# VIDEO_AI_GENERATION_PRODUCT_FLOW_DISCOVERY_V1

**Status:** `VIDEO_AI_GENERATION_PRODUCT_FLOW_DISCOVERY_V1_COMPLETE`

This document is a discovery and architecture decision record. It does not implement video generation, change executable code, add a migration, call a paid provider, or deploy anything.

## Scope and evidence boundary

The current-state sections below are based on the repository at this branch. The provider section records the external facts supplied for this review; those facts were not re-researched in this pass. Proposed V1 behavior is marked as proposed.

## FACTUAL CURRENT STATE

### Worktree and Git

- Canonical source repository: `D:\Trabalhos\Content Agent Studio\content-studio-ai-git`.
- Branch: `discovery/video-ai-generation-product-flow-v1`.
- Discovery base: `77320afc31c787ae3d7c6930ea35049b6038d430`.
- Current review HEAD before this document update: `c67758f95f0875480e1b5e7992de0d90b56ec0bb`.
- The Creative Editor worktree remains separate and untouched.
- The foreign change in `docs/productization/creative-rendering/VIDEO_AUDIO_AUTHORING_V1.md` was preserved in its original history and was not restored, discarded, staged, committed, or copied into this branch.

### Product boundaries already present

The repository separates the following responsibilities:

| Responsibility | Current authority |
|---|---|
| Project and Production context | `projects`, `productions` |
| Image generation and review workspace | `/imagens`, `images`, image generation routes |
| Video draft authoring | `video_drafts`, `VideoScene`, `/creative-editor/video/[draftId]` |
| Durable reusable media | `library_files` and S3-compatible storage |
| Render output history | `render_executions` and Gallery-oriented surfaces |

The Creative Editor is the authoring/composition surface. A generated clip is source media first and must not become a `VideoDraft` implicitly.

### `/imagens` factual flow

There are two existing image provider paths:

1. OpenAI image generation is called by `/api/openai/generate-image`. The route authenticates the user, reads the user OpenAI key with an environment fallback, and returns image data to the client.
2. NanoBanana generation is called by `/api/nanobanana/generate`. The route authenticates the user, reads `user_settings.nanobanana_api_key`, submits a task, and inserts a `generation_tasks` row with `provider`, `task_id`, `project_id`, prompt, aspect ratio, status, and raw response.

For NanoBanana, `/api/nanobanana/callback` updates the task asynchronously. `/api/nanobanana/status/[taskId]` exposes an ownership-scoped status read. The `/imagens` client polls this endpoint; after completion it downloads the provider URL through `/api/storage/upload-image`, then writes an `images` row containing the application storage metadata and image status.

The resulting `images` row is the image workspace record. It can be draft, approved, or rejected. The current generation flow does not automatically create a `LibraryFile`.

### Image evaluation factual flow

`POST /api/evaluate-image` authenticates the user, reads the OpenAI key, validates a supplied Project Identity, compiles project context, prompt, identity, and image URL, and calls the OpenAI chat completion endpoint. It supports `default`, `conceptual`, `aesthetic`, `commercial`, and `experimental` modes and asks for `score`, `approved`, `feedback`, `improvements`, and `refinedPrompt`.

Evaluation is an action on a completed image. It is not a prerequisite for storing the generated image and is not a provider task state.

### `generation_tasks` factual audit

The table is defined in `scripts/005_create_generation_tasks.sql`:

- `id` UUID primary key.
- `user_id` FK to `auth.users`.
- nullable `project_id` FK to `projects`.
- unique external `task_id`.
- `provider` defaulting to `nanobanana`.
- `prompt`, `aspect_ratio`, and image-specific `image_url`.
- `status` defaulting to `processing`; comments mention `pending`, `processing`, `completed`, and `failed`, but executable call sites use `processing`, `completed`, and `failed`.
- `error_message`, `callback_received_at`, `raw_response`, `created_at`, and `updated_at`.
- indexes for task id, user id, and processing rows.
- RLS for SELECT, INSERT, and UPDATE by `user_id`; no DELETE policy.

There is no `production_id`, no TypeScript `GenerationTask` domain type, no FK to `images`, `image_drafts`, or `library_files`, no retry mechanism, no application idempotency key, and no callback signature verification in the current NanoBanana route. Its `image_url` and current call sites make it image-specific in practice.

**Verdict:** `generation_tasks` is not naturally reusable for video. It is an existing image task tracker that can remain in place for the image flow. Reusing it for video would require a semantic migration and would still leave video result ownership unclear.

### Storage and LibraryFile factual audit

The application uses one S3-compatible storage backend configured by `S3_ENDPOINT`, bucket, credentials, region, and `PUBLIC_STORAGE_BASE_URL`. The code does not show a Supabase Storage bucket for these assets.

Existing helpers in `lib/storage/s3.ts` include:

- `uploadImageToS3` for image/post objects;
- `createPresignedReadUrl` and `readS3Object`;
- `uploadLibraryFile` for binary files, including video MIME types;
- `copyS3ObjectToLibrary` for copying an existing object into the Library;
- deletion and object movement helpers.

The established object conventions are user-scoped `images`, `posts`, and `library` paths. There is no video-generation-specific namespace or retention worker. Scratch objects are not automatically garbage-collected by the inspected helpers.

`library_files.kind` already accepts `image`, `video`, `audio`, `document`, and `other`. A `LibraryFile` has project ownership, MIME type, byte size, storage path, public URL, optional thumbnail, and soft-delete state.

The existing render save route proves the explicit promotion pattern: a completed render output is copied to the Library and then registered as a `LibraryFile` with `kind='video'`. That render flow is a precedent for explicit promotion, not a reason to make generated media a render execution.

### Creative Editor asset intake factual audit

The Creative Editor already consumes project `LibraryFile` identities:

- scene hero overrides use `VideoScene.library_file_id`;
- free visual elements and root timeline B-roll use `library_file_id`;
- timeline validation accepts renderable image or video files for visual items and audio files for audio items;
- `ProjectLibraryAssetPicker` can filter video assets;
- `library-file-adapter.ts` resolves a `LibraryFile` to a presigned renderable asset;
- no generation route writes a `VideoDraft` as a side effect of generation.

This is sufficient as a future asset boundary. The discovery does not specify a new editor writer or automatic draft mutation.

### `/videos` and Production factual audit

`/videos` currently loads `video_drafts`, projects, and productions, renders a draft hub, keeps legacy draft redirects, and offers a create form that calls `createVideoDraftForCreativeEditor`. Production currently has the same authoring action: `Criar Vídeo` calls `POST /api/video-drafts` and redirects to `/creative-editor/video/[draftId]`.

Therefore the current state is still asymmetric:

```text
Production → Criar Imagem → /imagens?project=&production=
Production → Criar Vídeo  → create VideoDraft → Creative Editor
```

The asymmetry is a current-state finding. It is not the desired V1 flow.

### Provider and credential architecture factual audit

- OpenAI and NanoBanana are active integrations.
- `replicate_api_key` is stored and shown in settings but is not consumed by an active provider route.
- No Kling or Higgsfield credentials, environment variables, provider adapters, MCP client, OAuth flow, token refresh flow, or connection registry exist in the application.
- Provider calls are direct route-local `fetch` calls; there is no shared provider interface.
- User keys are stored in `user_settings` as plaintext despite an aspirational SQL comment about encryption. OpenAI also has a server environment fallback; NanoBanana has no equivalent fallback.
- `lib/ai-simulator.ts` contains placeholders mentioning n8n and external webhooks, not an operational integration.

## EXTERNAL PROVIDER FACTS SUPPLIED FOR THIS REVIEW

The following are review inputs, not repository facts:

- Kling has an international API and a Kling 3.0 Image-to-Video capability with an initial image, prompt, 3–15 second duration, 720p/1080p/4K, audio on/off, multi-shot, callback URL, external task ID, asynchronous task lifecycle, task query, callback verification, and a result video URL.
- Kling result URLs may expire after about 30 days. A provider URL is therefore not application-owned media.
- Kling API balance/resource packages are distinct from the consumer Kling Pro subscription; the subscription must not be assumed to fund API calls.
- Kling has an official remote MCP surface. Whether MCP generation uses consumer credits or API resource packages is unknown and requires an account test.
- Higgsfield exposes Kling models and is a future provider/transport candidate with separate API balance.
- Gemini can provide native video understanding and is a candidate for later video evaluation.

## PROPOSED FUTURE STATE AND ARCHITECTURE DECISIONS

### Domain boundary

The V1 domain entity is `VideoGeneration`. It represents one user-requested source-video generation and owns the complete video-generation lifecycle and its result metadata.

It is not a `VideoDraft`, `VideoScene`, render execution, or LibraryFile.

The minimum provider-neutral information the entity needs is:

| Concern | V1 shape |
|---|---|
| Ownership | `user_id`, required `project_id`, required `production_id` |
| Input | prompt, mode (`image_to_video`), source image identity, requested configuration |
| Execution | provider snapshot, model snapshot, external task ID, lifecycle status |
| Result | application storage path/URL, MIME, size, provider result metadata |
| Promotion | nullable `library_file_id` only after explicit save |

Provider-specific fields that are not needed for the product contract belong in a provider metadata JSON object, not in a universal set of columns.

### Provider vs model vs transport

The minimum correct boundary is:

- **Provider:** the commercial execution and billing system, such as Kling.
- **Model:** the concrete model requested from that provider, such as Kling 3.0.
- **Transport/connection:** how the application reaches the provider, such as REST API now or MCP later.

V1 stores provider and model snapshots on `VideoGeneration` because they are part of the historical request. Transport is runtime/configuration concern in V1 and should not become a database column yet. A future connection record may select a credential and transport without changing the generation domain.

This keeps the domain multiprovider-ready without implementing a universal provider framework. V1 implements one adapter: Kling over REST API.

### `generation_tasks` vs `video_generations` verdict

Four options were reviewed:

| Option | Verdict |
|---|---|
| Evolve `generation_tasks` and add a video result entity | Rejected for V1: two video lifecycle authorities would be easy to create, while the existing table is image-specific. |
| Make only `video_generations` own video task and result lifecycle | **Chosen.** One status machine and one authority for video generation. |
| Reuse `generation_tasks` with no video entity | Rejected: `image_url`, missing Production ownership, and missing result identity make the semantics wrong. |
| Create a generic media-generation engine | Rejected as premature abstraction. |

The future migration should add `video_generations` rather than mutate `generation_tasks` for this V1. It should include only the minimum fields described above, including provider/model snapshots, mode, source image reference, request/config JSON, provider metadata, result metadata, error data, timestamps, and a single lifecycle status. An optional `library_file_id` records promotion after the application-owned result exists.

This is a migration plan, not a migration. No schema change is made in this discovery.

### Status machine and async contract

`VideoGeneration` has one state machine:

```text
queued → submitted → running → completed
                         └────→ failed
```

Provider callback handling is the backend completion path. The callback must authenticate/verify the provider signature, resolve the generation by provider task identity, be idempotent, and persist provider state. The UI uses authenticated polling for status and reconciliation so completion survives a closed browser tab. A reconciliation poll is also needed for missed callbacks.

Retries are future implementation behavior and must create a deliberate retry/idempotency policy; they must not be inferred from the existing image table.

### Storage and durability lifecycle

The proposed V1 lifecycle is:

```text
Kling result URL
  → server-side download
  → application-owned S3 object
  → VideoGeneration completed result
  → visible in /videos
  → optional explicit promotion to LibraryFile
```

The result is application-owned once the server has downloaded and verified the MP4 into the configured S3-compatible bucket. The exact generated-video key prefix is future implementation detail; it must be user-scoped and separate from provider URLs. The existing S3 helpers are sufficient in principle, but a video-specific download/registration path still needs implementation.

Discarding a result means removing its generation result reference and, when policy permits, deleting its application-owned object. There is currently no automatic cleanup worker, so retention and cleanup are future work and must be explicit in the implementation ticket.

`LibraryFile` is not automatic in the first slice. Explicit Save copies/registers the application-owned object as a `LibraryFile(kind='video')`, scoped to the same user and Project. `library_file_id` is then the promotion link. Application-owned media and LibraryFile remain separate authorities.

### `/videos` and Production future behavior

The semantic change is:

```text
Production → Criar vídeo → /videos?project=X&production=Y
                         → generation workspace
```

The action must not call `POST /api/video-drafts`. `/videos` becomes the source-video generation workspace and history surface while retaining historical draft cards and links to the canonical Creative Editor. Existing `/videos?draft=<id>` redirects remain migration compatibility for authoring links.

The old create-draft control in `/videos` changes to the generation action. Historical drafts are not converted into generations and are not deleted.

### Creative Editor bridge

The smallest bridge is:

```text
completed VideoGeneration
  → explicit Save to LibraryFile
  → existing ProjectLibraryAssetPicker / LibraryFile boundary
  → user chooses the video as B-roll or another supported visual asset
```

Automatic insertion into a `VideoDraft`, automatic scene creation, and automatic timeline mutation are outside this discovery. The rule remains `VideoGeneration → VideoDraft` is prohibited as an implicit side effect.

### Evaluation decision

Video evaluation is excluded from the first generation V1. This is a scope decision, not a claim that native video understanding is necessarily too expensive.

The next candidate is V1.1 native video evaluation through Gemini because it preserves temporal information. Sampled-frame evaluation remains a fallback if native access, latency, or product value is not demonstrated. The existing image evaluator can supply prompt and Project Identity context, but its image-oriented endpoint and contract should not be stretched into a video evaluator.

Generation completion must never wait for evaluation.

### MCP and n8n decision

MCP is a valid future capability boundary, but it is not part of the first V1 vertical slice.

1. The current repository has no MCP client or connection persistence, so MCP does not fit the current implementation without new infrastructure.
2. Existing credential ownership is user-owned (`user_settings`), which is the closest current precedent. A future MCP connection should initially be user-owned unless a workspace-level sharing requirement is proven.
3. MCP is a transport/capability integration, not a provider or model. Kling REST and Kling MCP can target the same provider/model contract.
4. Tokens must be kept server-side in a future connection/secrets boundary; the current plaintext settings model is insufficient for a production MCP connection.
5. The Kling MCP credit/account behavior is unknown and requires an account test.

n8n may be an optional automation integration later. It must not become a required hop for generation: `Content Studio → direct provider transport` is the V1 path.

### First provider and model

**V1 provider:** Kling.

**V1 model:** Kling 3.0.

**V1 transport:** Kling REST API.

This recommendation follows the supplied provider contract, the need for an asynchronous task ID and callback, and the repository's existing server-side fetch plus S3 download patterns. It does not assume consumer subscription credits fund API requests. A future Higgsfield route can expose the same domain contract without changing the first slice.

### I2V vs T2V

The first slice is **Image-to-Video only**. The source image is selected from the Project's existing image/media boundary and the user adds a motion prompt. This builds on the current `/imagens` output and Project context while constraining the first provider contract. Text-to-video is a later capability after the I2V path proves storage, async completion, and result UX.

### Minimal provider preset

The first UI preset should be fixed to the smallest supported contract:

- 5 seconds;
- 720p;
- audio off;
- multi-shot false;
- one source image;
- one motion prompt.

The underlying domain must retain provider/model/config metadata so later supported options do not require rewriting the product boundary.

## FIRST REAL VERTICAL SLICE

The success condition is a real provider-produced, playable clip:

```text
Production
  → Criar vídeo
  → /videos?project=&production=
  → select an existing Project image
  → enter motion prompt
  → create VideoGeneration
  → submit to Kling 3.0 I2V over REST
  → persist provider task identity
  → verified webhook completion + UI polling/reconciliation
  → download MP4 to application-owned S3 storage
  → show playable completed result in /videos
```

Mocks are appropriate for tests only. Library promotion, MCP, Higgsfield, T2V, evaluation, and automatic Creative Editor insertion are not completion criteria for this slice.

## FUTURE IMPLEMENTATION SLICES

| Slice | Objective | Likely areas | Schema/provider/UI impact | Test and completion condition |
|---|---|---|---|---|
| 1. Real Kling I2V | Produce and display one real clip | `video_generations` migration, video generation routes, `/videos`, S3 helper | New generation entity; Kling REST adapter; generation workspace | Auth, ownership, callback verification, idempotency, failure, and one real playable MP4 |
| 2. Explicit Library save | Promote a completed result | video result API, LibraryFile registration/copy path | `library_file_id` promotion link; no automatic promotion | Repeated save is idempotent and Library picker can see the video |
| 3. Editor asset use | Let the user select the saved clip in authoring | existing Library picker/timeline boundary | No VideoDraft generation side effect | Clip can be selected as supported B-roll and existing validation remains intact |
| 4. MCP connection discovery | Decide whether a real connection surface is justified | settings/integration/secrets architecture | New connection model only after evidence | Account/auth/tool/billing behavior is verified; no n8n dependency |
| 5. Second provider | Prove multiprovider boundary | second adapter and provider configuration | No change to VideoGeneration authority | Same product flow completes with a second provider contract |
| 6. Video evaluation | Add optional temporal review | evaluation route/UI, native video model or sampled frames | Separate evaluation result from generation status | Evaluation is optional and never blocks completion |

## Explicit answers to the discovery questions

1. `/videos` should officially own AI video generation workspace/history while continuing to link historical authoring drafts.
2. Production should offer `Criar vídeo` with the same semantic entry behavior as image creation: contextual navigation, no premature asset/draft write.
3. The current VideoDraft create action should be removed from the generation entry path and retained only where authoring is explicitly intended.
4. A `VideoGeneration` represents one video generation; it is separate from `VideoDraft` and `LibraryFile`.
5. Existing `generation_tasks` does not serve video without semantic damage; leave it for the current image flow.
6. A V1 schema evolution is needed: add `video_generations`; do not mutate the old table in this discovery.
7. The future migration adds one video generation entity with one lifecycle, provider/model snapshots, request/result metadata, ownership, and optional LibraryFile promotion link.
8. A completed result is application-owned first and becomes a LibraryFile only through explicit Save.
9. The MP4 is downloaded into the existing S3-compatible application storage; the provider URL is temporary metadata.
10. `/videos` should show queued/submitted/running/completed/failed `VideoGeneration` records alongside historical draft history.
11. The result reaches Creative Editor through explicit LibraryFile promotion and the existing asset picker/timeline boundary.
12. Avoid `GenerationTask → VideoDraft` by making VideoGeneration source-media authority and requiring explicit user authoring action.
13. First provider/model: Kling / Kling 3.0.
14. First mode: image-to-video only.
15. First async contract: verified backend webhook plus authenticated UI polling and reconciliation.
16. Video evaluation is not in the first V1.
17. The V1.1 candidate is native video evaluation with Gemini; sampled frames remain a fallback.
18. Evaluation is optional and later; it cannot block generation completion.
19. The smallest real slice is the Kling I2V flow ending with an application-owned, playable MP4 in `/videos`.
20. Reuse from `/imagens`: Project context, source-image selection, user ownership, server-side provider calls, async task UX, S3 download, and explicit result history. Do not reuse its image-specific `generation_tasks.image_url`, image table status, or image evaluator as a video lifecycle.

## Residual risks and rejected abstractions

- Current provider keys are plaintext and there is no connection/secrets service; this must be addressed before a production-grade multi-connection surface.
- Existing callback code is unauthenticated; the video callback must verify provider signatures and be idempotent.
- There is no current video generation table, video-specific retention worker, or video result download route.
- Provider result URL expiry makes server-side copying mandatory.
- The current `/videos` and Production controls still create VideoDrafts; the future implementation must change those controls without breaking historical authoring links.
- Do not create `UniversalMediaGenerationEngine`, a giant provider superclass, a universal Output table, a generic `Clip` table, a VideoDraft auto-writer, or an MCP/n8n dependency before the first real slice proves the need.

## Review conclusion

The architecture is sufficiently unambiguous to close discovery when the distinctions above are preserved:

```text
VideoGeneration (one lifecycle and result authority)
  → provider/model snapshot
  → Kling REST transport in V1
  → application-owned S3 MP4
  → explicit LibraryFile promotion
  → optional existing Creative Editor asset use
```

The first implementation work is the real Kling I2V vertical slice. No implementation is included in this discovery.
