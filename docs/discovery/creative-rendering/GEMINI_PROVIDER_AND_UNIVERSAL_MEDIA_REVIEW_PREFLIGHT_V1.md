# GEMINI_PROVIDER_AND_UNIVERSAL_MEDIA_REVIEW_PREFLIGHT_V1

Status: architecture and implementation preflight only. No product code, schema migration, provider credential, or paid-provider call was performed for this document.

## Checkpoint and scope

This preflight was prepared on branch `discovery/gemini-provider-universal-media-review-preflight-v1` in the reused worktree `C:/Users/flavi/.traycer/worktrees/fmultiman__content-studio-ai/feat-image-generation-session-attempt-foundation-v1`.

Starting `origin/main`: `9cdeb6a03f3c91bc6e18a1018caf129cebbfa7a8`.

The current normalized Review implementation is Image-specific. The next work must extend it additively. It must preserve advisory Review semantics, Attempt immutability, explicit Approval, explicit Library promotion, server-authoritative Project/Production/Identity context, strict parser failure, and immutable historical Review executions.

This document does not implement Gemini, Veo, Google Flow, Antigravity, universal subjects, migrations, or UI changes.

## Current Review authority

The current Review request is `POST /api/reviews/image` in `app/api/reviews/image/route.ts`. The service and contracts are in `lib/reviews/service.ts`, `lib/reviews/contracts.ts`, and `lib/reviews/context.ts`. The Image workspace displays normalized Reviews with a legacy fallback in `components/images/generation-history.tsx` and related Image page/result components. The old `app/api/evaluate-image/route.ts` remains a compatibility endpoint; it is not the normalized Review authority.

The current evaluator is directly coupled to OpenAI Chat Completions. The model is `OPENAI_EVALUATION_MODEL`, falling back to `gpt-4o-mini`. The future provider boundary must move the outbound model call behind a Review execution-provider interface without changing the Image adapter's criteria contract.

The current `public.media_reviews` table is defined by `scripts/054_create_media_reviews.sql` and currently contains 17 normalized legacy-import Reviews in the active Content Studio Supabase project. It requires:

* `subject_media_type = 'image'`;
* `image_attempt_id` referencing `image_generation_attempts`;
* `image_output_id` referencing `images`;
* Project/Production scope matching the Attempt and output;
* immutable subject/context/evaluator metadata after creation;
* lifecycle `pending -> running -> completed|failed` or `pending -> failed`;
* per-user `client_request_id` idempotency;
* server/service-role writes and owner-only authenticated reads.

The table already has versioned adapter metadata, context and subject snapshots, common result fields, adapter payload, refined prompt, provider metadata, failure metadata, and immutable lifecycle triggers. These are the pieces to keep and generalize. Typed Image foreign keys, the Image-only media-type check, and Image-specific parser/adapter criteria are Image-specific and must become an additive bridge to a universal subject.

Current read-only counts: 17 normalized Reviews, 23 historical migrated Attempts, 18 historical Attempts with non-null legacy evaluation, five Attempts with null evaluation, 26 `images`, and 69 `library_files`. The 18 evaluated Attempts reconcile as 17 normalizable Reviews plus one outputless legacy-only evaluation. Current evaluation JSON overlaps historical entries; it must not create six duplicate Reviews.

## Current media authorities

| Origin | Authoring/generation authority | Concrete output authority | Review-relevant identifier |
|---|---|---|---|
| Generated Image | `image_generation_sessions` in `lib/image-generation/session.ts` | `images` row, linked from `image_generation_attempts.result_image_id` | Session, Attempt, Image id |
| Generated Video | `video_generation_sessions`, `video_generations` | `video_generations` row and its stored output; optional `library_file_id` after explicit promotion | Session, generation Attempt id |
| Creative Editor static | `channel_piece_static_authoring_states` / `channel_pieces` | completed `render_executions` row with `kind='static_still'`, plus its output URL/object | `render_executions.id` |
| Creative Editor video | `video_drafts` / `video_scenes` | completed `render_executions` row with `kind='video'`, plus output URL/object | `render_executions.id` |
| Library/upload | `library_files` | Library object/path and file metadata | `library_files.id`, but only with an immutable artifact revision/hash |

Relevant routes include `app/api/render-executions/[id]/output-url/route.ts`, `app/api/render-executions/[id]/save-to-library/route.ts`, `app/api/video-generations/[id]/playback-url/route.ts`, and `app/api/video-generations/[id]/save-to-library/route.ts`. A scratch render is not a Library asset until explicit promotion. A generated output is not a Library asset until explicit promotion.

`library_files.id` alone is not a sufficient historical Review subject: the row carries mutable metadata and its storage representation can be replaced. A Review must bind to an immutable artifact version.

## Universal subject decision

### Recommendation: an immutable Media Artifact Version

The canonical universal Review Subject is the exact immutable media artifact version being inspected. The artifact is application-owned and records the bytes/object identity and media facts captured at the time of Review. Generation Attempt is optional provenance and context, not a universal prerequisite.

This is Option B from the architecture alternatives: add a normalized immutable artifact subject model, rather than adding an ever-growing set of nullable typed Review foreign keys or using an unchecked `subject_type + subject_id` pair.

The future foundation should introduce:

1. `media_artifacts`, one row per immutable artifact version;
2. a bounded `media_artifact_provenance` relation with real typed foreign keys for known origins.

The Review record references `media_artifacts.id`. Provenance can point to an Image Attempt/output, Video Attempt/output, Creative Editor render, Library file, or upload metadata. Multiple provenance edges are allowed when one artifact was promoted or copied without changing its bytes. A new render or in-place Library replacement creates a new artifact version rather than changing the subject of an old Review.

The current Image fields remain during a compatibility bridge. Existing Review IDs and Image typed references remain valid. A later migration adds `media_artifact_id`, backfills the 17 normalized Image Reviews to artifacts, and requires the universal artifact for new Reviews. It must not destructively rewrite or delete current Image references.

### Subject versus provenance

* Subject: the exact bytes/version, hash, MIME, size, dimensions and duration that the evaluator received or was supposed to receive.
* Provenance: how that artifact came to exist, such as Image Attempt, Video Attempt, render execution, Library file, or upload.
* Context: Project, Production, Identity snapshot, submitted generation prompt/config, render metadata, and optional user review intent.

For a generated Image, the subject is the immutable artifact corresponding to the `images` output; the Image Attempt supplies prompt/config provenance. For a generated Video, the subject is the stored `video_generations` output; the generation row supplies prompt/config/provider lineage. For an Editor render, the subject is the render output and `render_executions.id` is provenance. For upload/Library media, the subject is the uploaded object version and there may be no Attempt.

### Immutable identity requirements

Each artifact must carry an application ID, SHA-256 content hash when bytes are available, storage provider/path or equivalent object identity, MIME, byte size, dimensions, and duration when relevant. The Review stores the artifact ID and a subject snapshot/fingerprint. If a legacy object lacks a hash, the migration may retain a weaker evidence marker consisting of stable storage identity plus capture timestamp; it must not claim hash-level certainty. New universal Reviews must require a stable content hash or provider-backed immutable version identity.

## Image compatibility

Existing Image Reviews remain readable and historically valid. `POST /api/reviews/image` remains a compatibility wrapper around the shared Review service after universal subject foundation work. It resolves an Image Attempt and its output, obtains or creates the corresponding artifact, then invokes the Image adapter. Existing 17 Reviews are not deleted or rewritten in place. The outputless legacy evaluation remains legacy-only and is not given a fabricated artifact.

The old ImageDraft evaluation JSON remains a bounded read fallback for that one unnormalizable record and any explicitly documented legacy surface. New Review execution never writes ImageDraft. The compatibility fallback is removable only after the old Image history UI no longer needs the outputless record and a user-visible export/retention decision is recorded.

## Review context levels

| Context layer | Generated Image/Video | Editor render | Library/upload |
|---|---|---|---|
| Artifact facts | Required | Required | Required |
| Owner and server authorization | Required | Required | Required |
| Project/Production | Required when the source has scope; nullable where the source permits it | From render/channel piece when available | Optional |
| Project Identity | Snapshot when available | Snapshot when available | Optional |
| Generation prompt/config | Available from Attempt | Unavailable unless an upstream generation provenance edge exists | Unavailable unless provenance points to a generation |
| Render composition metadata | Optional | Available when useful | Usually unavailable |
| User review intent | Optional | Optional | Optional |

When Project Identity is absent, a general media-quality Review remains valid. Identity alignment and audience-fit criteria become `not_applicable` or are omitted with an explicit reason. Prompt adherence is conditional on a real submitted prompt. The system must never manufacture prompt or Identity context for an upload.

The context snapshot stores the normalized server-resolved context actually used, plus a context schema/version and fingerprint. It is not a live pointer to current Project Identity. A later Identity edit cannot reinterpret a completed Review.

## Universal Review contract

The common envelope remains small and versioned:

```ts
type ReviewRecordV2 = {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  subject: { artifactId: string; mediaType: 'image' | 'video'; fingerprint: string }
  provenance: { kind: string; sourceId: string }[]
  projectId: string | null
  productionId: string | null
  adapterKey: string
  adapterVersion: string
  reviewSchemaVersion: 2
  evaluator: { provider: string; model: string; promptVersion: string | null }
  context: { snapshot: unknown; schemaVersion: string; fingerprint: string }
  result: {
    score: number | null
    assessment: 'strong' | 'mixed' | 'needs_revision' | 'insufficient_evidence' | null
    summary: string | null
    criteria: ReviewCriterion[]
    issues: ReviewFinding[]
    strengths: ReviewFinding[]
    refinedPrompt?: string
    adapterResult: unknown
  } | null
  failure: { code: string; details?: unknown } | null
  clientRequestId: string
  createdAt: string
  completedAt: string | null
}
```

This is a planning contract, not a direct instruction to add all fields in one migration. The implementation mission must keep only fields needed by the current repository and make the universal artifact reference authoritative.

`ReviewCriterion` has a stable key, assessment/score when applicable, label, evidence/comment, and `applicability` (`applicable`, `not_applicable`, `insufficient_evidence`). `ReviewFinding` may include optional `timeStart` and `timeEnd` seconds for video evidence; the fields are null/absent for Image. Timestamps are evidence references, never editor mutation commands.

There is no `approved` field and no score-to-Approval mapping. “Strong” means an advisory assessment only.

## Image adapter contract

Image V1 criteria remain:

| Key | Label | Applicability |
|---|---|---|
| `prompt_adherence` | Prompt adherence | Applicable only with a submitted prompt |
| `identity_alignment` | Project Identity alignment | Applicable only with server-resolved Identity |
| `composition_hierarchy` | Composition and hierarchy | Applicable when the image has sufficient evidence |
| `image_quality_artifacts` | Image quality and artifacts | Applicable when the image is readable |
| `source_fidelity` | Source/reference fidelity | Only when a source/reference is present |

The Image adapter receives the server-resolved artifact, Attempt prompt/config when present, Project/Production/Identity context snapshot, and evaluator request intent. It returns only the Image adapter payload plus the shared envelope fields. It must not add Video temporal criteria. Missing conditional evidence produces `not_applicable` or `insufficient_evidence`, never a guessed score.

## Video Review direction

Video Review is not implemented in this mission. Its universal subject is the immutable video artifact regardless of origin:

* Generated Video: `video_generations` result artifact, with Attempt prompt/config as provenance.
* Creative Editor Video: completed `render_executions(kind='video')` output artifact, with VideoDraft/render metadata as provenance.
* Uploaded/Library Video: Library artifact version, with no fabricated Attempt.

Native video is the preferred evidence strategy for a future Gemini adapter. Gemini’s official video understanding documentation states that the API accepts common video MIME types, processes audio and visual streams, supports timestamp questions, and can use File API uploads for larger/reusable files. See the [official Gemini video understanding guide](https://ai.google.dev/gemini-api/docs/video-understanding?hl=en).

V1 should send native video to the provider. `ffmpeg` or local frame extraction is **not required** for the first Gemini Video Review slice. Gemini’s own processing may sample frames internally; an implementation may later add a provider-independent sampling fallback only as a separately approved capability. The future adapter must not claim frame-accurate findings if the provider only supplies approximate evidence.

Future criteria classification:

* Supported V1: visual quality/artifacts, temporal coherence, continuity, morphing/deformation, subject consistency, motion quality, camera behavior, pacing, and source-media fidelity when a source exists.
* Conditional V1: prompt adherence when a generation prompt exists; Identity alignment when Identity exists; speech/dialogue when speech exists; text legibility when resolution supports it; audio presence/quality when an audio track exists; AV synchronization when the selected model and validation prove it can assess synchronization.
* Deferred: guaranteed lip-sync accuracy, frame-perfect micro-artifact detection, multi-hour editorial analysis, and conclusions that require unavailable prompt or timeline context.

For a render/upload with no generation prompt, prompt adherence is not applicable. A Review can still assess quality, continuity, pacing, artifacts, and Identity where context exists.

Future Video Review should be asynchronous: create `pending`, claim `running`, upload/process/evaluate, then persist `completed` or `failed`. The current Image Review can remain synchronous. The existing provider/job infrastructure must be reused or extended only after a bounded implementation design; no synchronous route should hold a long native-video upload open by default.

Initial guardrails for a future Gemini Video Review: one video per execution, maximum 500 MB and 10 minutes, explicit user action, and provider/model cost shown before execution where the product has that surface. These are product caps below the official provider limits to control latency and cost; they are not claims about Gemini hard limits. A later mission may revise them with measured evidence.

## Provider architecture

The Review adapter and execution provider are separate:

```ts
type ReviewExecutionRequest = {
  provider: 'openai' | 'gemini' | string
  model: string
  media: { kind: 'image' | 'video'; artifactId: string; mimeType: string }
  context: unknown
  prompt: string
  responseSchema: unknown
}

interface ReviewExecutionProvider {
  providerId: string
  capabilities: ReadonlySet<'image_review' | 'video_review'>
  execute(request: ReviewExecutionRequest): Promise<{
    rawText: string
    providerRequestId?: string
    usage?: unknown
    remoteFile?: { id: string; expiresAt?: string }
  }>
}
```

The adapter owns criteria, prompt construction, context compilation, and result validation. The provider owns authentication, media transport, model invocation, and raw response metadata. A provider is never selected merely because it is the Video adapter; another provider can implement the same capability later.

Provider policy for the first universal foundation: retain OpenAI for the existing Image Review default. Do not add a user-facing provider picker just to expose an unimplemented capability. A future Video Review chooses Gemini only when a server allowlist and valid user credential exist; otherwise it fails closed or offers a separately approved fallback. Every Review stores provider/model metadata.

## Official Gemini API

Official Gemini is a new provider ID, not Nano Banana. The current Nano Banana path is `app/api/nanobanana/generate/route.ts`, uses `api.nanobananaapi.ai`, and resolves `nano_banana` API-key credentials. It is a third-party Nano Banana service, not evidence that the application already uses the official Gemini API.

Official Gemini supports:

* image and native video inputs through its multimodal request model;
* inline bytes for small inputs and Files API uploads for larger/reusable inputs;
* common video MIME types including MP4, MOV, WebM and others;
* timestamp-oriented video questions and audio/visual understanding;
* JSON structured output requests with a supported schema subset;
* API-key authentication using the official API key mechanism.

The [Gemini Files API](https://ai.google.dev/gemini-api/docs/files?hl=en) documents a 20 GB project storage limit, 2 GB per file, and 48-hour file retention. The future server client should stream an authorized artifact from Content Studio storage to Gemini, never accept an arbitrary client URL, and delete the remote file after execution when possible. Provider file IDs are operational metadata, not the canonical artifact identity. A simple V1 may re-upload for each Review execution rather than persist a remote file cache; if a cache is introduced later it must be scoped to user credential, artifact hash, provider model, expiry, and privacy policy.

The official [structured output guide](https://ai.google.dev/gemini-api/docs/structured-output?authuser=683989221) supports JSON response configuration but still requires server-side schema validation. Invalid JSON, missing keys, invalid enums, impossible scores, truncated output, provider error, or timeout must produce a failed Review execution. No provider guarantee replaces Zod/runtime validation.

Credential strategy: extend the existing server-side user BYOK boundary. `lib/credentials/provider-credentials.ts` currently supports `openai`, `nano_banana`, `kling`, and `replicate`; a future mission may add `gemini` with an encrypted/server-side API-key field following the existing security review. The [official API-key documentation](https://ai.google.dev/gemini-api/docs/api-key?wvideo=ydmtek6kzh) describes API-key authentication. OAuth is a separate option described by Google’s [OAuth quickstart](https://ai.google.dev/gemini-api/docs/oauth); it must not be conflated with Antigravity connected-account behavior. Do not introduce a platform key or browser-held secret unless product policy explicitly authorizes it.

The provider registry should extend `lib/credentials/provider-metadata.ts` and `lib/credentials/provider-execution.ts` with capability metadata such as `image_review` and `video_review`. Model identifiers should be configuration/registry aliases verified at implementation time; this preflight intentionally does not freeze a future model ID.

## Antigravity classification

Antigravity is a separate experimental connected-account/bridge path:

**Google Antigravity — Experimental Connected Account / Bridge**

It is not the official Gemini API, not Kling MCP, and not Google Flow. It must never be represented in Review metadata as `gemini` unless the transport and product label explicitly identify the bridge.

The reviewed OmniRoute material indicates a Google OAuth 2.0 login, a loopback callback, and a bridge/gateway deployment. Remote/VPS use can require a local login helper, SSH forwarding, or an own OAuth web credential and public callback. See the [OmniRoute README](https://github.com/blessedalways/omniroute/blob/main/README.md), [Remote Mode guide](https://github.com/diegosouzapw/OmniRoute/blob/release/v3.8.51/docs/guides/REMOTE-MODE.md), and [Antigravity onboarding guide](https://github.com/JamshidSod/omniroute/blob/release/v3.8.50/docs/guides/ANTIGRAVITY-ONBOARDING.md). These are community sources, not official Google API contracts.

The connection mechanism is plausibly Google OAuth plus refresh-token/session state and a Cloud Code project onboarding step, but the exact token and media contract is not a stable Content Studio dependency. The reviewed sources do not prove that an OmniRoute Antigravity route accepts native video bytes and preserves the evidence needed for Video Review. Antigravity suitability for Video Review is therefore **unverified/deferred**.

If a future experiment proceeds, it needs explicit opt-in, per-user encrypted token isolation, refresh/expiry detection, disconnect/revoke, no shared credentials, no browser exposure, no automatic fallback to it, clear experimental labeling, transport/account audit metadata, and an isolated local/VPS bridge. If the bridge cannot be isolated per user or requires an unapproved server/process-spawning path, stop the mission. It must not become the canonical provider dependency.

Google Flow/gflow remains a hard boundary: Gemini Review is a model-provider integration; Antigravity is a connected-account bridge experiment; Google Flow automation is neither and is outside this track.

## API and history strategy

Keep `POST /api/reviews/image` as a compatibility endpoint. After the universal subject foundation exists, add a shared service and, if justified by the UI, `POST /api/reviews` accepting only a server-resolvable `artifactId` plus `clientRequestId` and optional review intent. The service resolves artifact, ownership, provenance, Project/Production, and Identity. It rejects arbitrary public URLs, client-supplied prompts as authority, and client-supplied Identity/context.

Universal GET history is by artifact ID. The Image endpoint can remain a wrapper until all Image callers use the shared service. History follows the immutable artifact version. Promotion from generated media to Library does not duplicate history for the same bytes; it adds provenance. A changed/replaced Library object receives a new artifact version and therefore a separate Review history.

Multiple immutable Reviews per artifact are allowed. The API must distinguish `latestExecution` from `latestCompleted`; a later failed Review does not hide an earlier completed Review. Re-review creates a new idempotent execution with a new client request ID. Replays with the same ID return/reuse the existing execution and never trigger a second paid call.

## Refined prompt and editor boundary

`refinedPrompt` remains a historical advisory suggestion attached to the Review that generated it. It can be shown for any media if the adapter has a meaningful textual recommendation, but “Use refined prompt” is available only when the subject has a compatible active Generation Session. Explicit acceptance copies the suggestion to that current Session, uses normal Session autosave, and never mutates the Review, Attempt, artifact, Approval, Library, or Creative Editor. No automatic Generate occurs.

For Editor renders and arbitrary uploads, a textual recommendation may remain visible, but no fake Generation Session is created. Timestamped findings are advisory comments only; they do not create layer edits, scene mutations, or automatic authoring operations.

## Database evolution decision

Migration required: **YES, in a future bounded mission; NO migration is created or applied by this preflight.**

Recommended future sequence:

1. Add `media_artifacts` with immutable owner, media type, storage identity, SHA-256/version facts, MIME/size/dimensions/duration, and optional Project/Production scope.
2. Add `media_artifact_provenance` with bounded typed FKs for Image Attempt/output, Video generation/output, render execution, and Library file. Use real FKs; do not use an unchecked polymorphic ID.
3. Add nullable `media_artifact_id` to `media_reviews`, with a transition constraint that either the existing typed Image subject or the universal artifact is present while the bridge runs.
4. Backfill the 17 normalized Image Reviews to artifacts without changing Review IDs or deleting Image FKs. Preserve the one outputless legacy evaluation as compatibility-only.
5. Make universal artifacts required for new Reviews after resolver/API cutover; retain old Image columns until a separately verified retirement migration.

RLS follows owner-based access through the artifact and Review owner. Server/service-role writes perform cross-table ownership checks. An immutable trigger protects artifact identity, hash, storage path, media facts, and provenance subject references. Indexes cover owner/media type, content hash, source provenance, Project, and Review history. Reconciliation must prove 17 current normalized Image Reviews have artifacts, no output or Library rows changed, and the legacy-only record remains readable.

Option A (nullable typed FKs directly on `media_reviews`) is simpler initially but grows columns, complicates exclusivity, and makes uploaded media awkward. Option B (artifact plus typed provenance) is recommended because it has a real Review FK, stable version identity, optional Attempt provenance, and an additive path for future media types. An unchecked `subject_type + subject_id` shortcut is rejected.

## Future implementation slices

| Mission | Bounded outcome | Recommended model |
|---|---|---|
| `UNIVERSAL_MEDIA_REVIEW_SUBJECT_FOUNDATION_V1` | Artifact/provenance schema, 17-row backfill, server resolver, Image wrapper; no new provider | GPT-5.6 TERRA or equivalent lighter coding model |
| `GEMINI_REVIEW_PROVIDER_FOUNDATION_V1` | Official Gemini BYOK credential, capability registry, server client, native media upload lifecycle, mocks; no Video UI | GPT-5.6 TERRA |
| `GEMINI_VIDEO_REVIEW_ADAPTER_V1` | Async native-video adapter, conditional criteria, timestamp findings, limits and API/UI | GPT-5.6 TERRA with this preflight as authority |
| `ANTIGRAVITY_CONNECTED_ACCOUNT_EXPERIMENT_V1` | Opt-in isolated bridge only if security and native-media evidence pass; no canonical dependency | GPT-6.1 SOL or equivalent high-reasoning model |
| `GEMINI_IMAGE_GENERATION_ADAPTER_V1` | Separate future generation provider adapter | Separate mission; outside Review |
| `GEMINI_VIDEO_GENERATION_VEO_ADAPTER_V1` | Separate future Veo generation adapter | Separate mission; outside Review |

## Exact implementation file plan

### Database

| Path | Current role | Future change | Test |
|---|---|---|---|
| `scripts/<next>_create_media_artifacts.sql` | No universal artifact table | Add immutable artifact identity/facts and owner RLS | columns, FKs, immutability, RLS |
| `scripts/<next>_create_media_artifact_provenance.sql` | No universal provenance relation | Add typed provenance edges with real FKs | source scope, duplicate edge, delete behavior |
| `scripts/<next>_extend_media_reviews.sql` | Image-only Review table | Add artifact bridge and transition checks | Image compatibility and artifact subject rules |
| `scripts/054_create_media_reviews.sql` | Existing Image Review schema | Keep unchanged until additive bridge | migration regression |

### Review subject core and service

| Path | Current role | Future change | Test |
|---|---|---|---|
| `lib/reviews/contracts.ts` | Image Review contracts | Add versioned artifact subject/provenance envelope and optional timed findings | schema parser |
| `lib/reviews/context.ts` | Image Attempt/Project context | Resolve artifact, source provenance, Project/Production/Identity snapshot | ownership and absent-context cases |
| `lib/reviews/service.ts` | Image Review lifecycle | Accept universal artifact subject; preserve Image wrapper | lifecycle, idempotency, history |
| `lib/reviews/repository.ts` (future) | No universal repository authority | Isolate reads/writes and latestCompleted/latestExecution queries | repository contract |
| `lib/reviews/errors.ts` (future) | Route-specific errors | Typed ownership, artifact, provider, parse and lifecycle errors | API mapping |

### Providers

| Path | Current role | Future change | Test |
|---|---|---|---|
| `lib/credentials/provider-credentials.ts` | OpenAI/Nano Banana/Kling/Replicate BYOK | Add official `gemini` only in provider mission | secret never returned to client |
| `lib/credentials/provider-metadata.ts` | API-key/REST provider metadata | Add Gemini capabilities; keep Antigravity separate transport class | registry tests |
| `lib/credentials/provider-execution.ts` | Server execution mode/credential source | Resolve Gemini BYOK without platform fallback | fail-closed tests |
| `lib/reviews/execution-provider.ts` (future) | No generic Review outbound boundary | Provider-neutral execution interface | OpenAI/Gemini mocks |
| `lib/providers/gemini/*` (future) | No official Gemini client | Native image/video request, Files API lifecycle, structured output metadata | upload/delete/error/timeout |

### Image compatibility and API

| Path | Current role | Future change | Test |
|---|---|---|---|
| `app/api/reviews/image/route.ts` | Image Review endpoint | Remain wrapper resolving Image artifact/provenance | existing callers and server authority |
| `app/api/evaluate-image/route.ts` | Legacy evaluator endpoint | Remain compatibility-only; no universal responsibilities | legacy behavior and no new writes |
| `components/images/generation-history.tsx` | Normalized/legacy Review display | Read universal envelope and retain one legacy-only fallback | latest/history and failure UI |
| Image result/page components | Review action/refined prompt | Use shared Review response; explicit Session acceptance only | Attempt/Session immutability |

### Future Video adapter

| Path | Current role | Future change | Test |
|---|---|---|---|
| `lib/reviews/adapters/video.ts` (future) | None | Native-video criteria, conditional prompt/Identity criteria, timestamp evidence | generated/render/upload matrix |
| `app/api/reviews/video/route.ts` or universal route (future) | None | Pending/running async execution | lifecycle and provider limits |
| Video Review UI (future) | None | Findings/history only; no authoring mutation | no auto-edit/approval |

### Antigravity experiment

| Path | Current role | Future change | Test |
|---|---|---|---|
| `lib/provider-connections/*` | Kling MCP connection boundary | Add only after explicit experimental design; never overload Kling | per-user token isolation |
| `lib/providers/antigravity/*` (future) | None | Isolated bridge client/transport and clear provider label | seam/config only; no live OAuth |
| Settings connection UI (future) | API-key status and Kling connection UI | Experimental opt-in, connect/disconnect/expiry state | no token exposure |

## Tests required by the future implementation

1. Subject: generated Image, generated Video, static render, video render, Library/upload; each resolves an immutable artifact and optional provenance.
2. Subject integrity: hash/version snapshot remains stable after Library metadata/object changes; replacement creates a new artifact.
3. Image compatibility: all 17 existing Reviews remain readable; Image endpoint remains functional; outputless legacy Review remains visible through fallback.
4. Context: server resolves owner, Project, Production and Identity; arbitrary URL, prompt, context, or Identity payload is ignored/rejected; absent Project Identity produces conditional criteria.
5. Shared parser: valid envelope, invalid JSON, missing key, invalid enum, impossible score, malformed criterion, provider failure, timeout all map correctly; malformed output never completes successfully.
6. Gemini provider mocks: image input, native video input, File API upload/status/delete, expiry, structured result, malformed result, cost/limit rejection, zero live calls.
7. Video adapter: with/without prompt, with/without Identity, with/without audio, timestamp findings, native media only, asynchronous lifecycle.
8. History/idempotency: repeated client request does not duplicate evaluator call; re-review creates a new immutable record; latestCompleted remains visible after latestExecution fails.
9. Refined prompt: explicit acceptance updates a compatible current Generation Session only; Review, Attempt, artifact, Approval, Library, and provider execution remain unchanged.
10. Security: cross-user/project/Production access denied; no arbitrary URL fetch; Antigravity seams cannot share or expose credentials.
11. Boundaries: Review never approves, rejects as product authority, publishes, promotes Library, invokes generation, or mutates Creative Editor.
12. Paid calls: all automated tests use mocks and record zero Gemini/OpenAI evaluator calls.

## Stop conditions

Stop `UNIVERSAL_MEDIA_REVIEW_SUBJECT_FOUNDATION_V1` if immutable bytes/hash/version cannot be established, Editor render authority is ambiguous, Library replacement cannot produce a new version, a typed-FK bridge would lose current Image Reviews, client URLs/context must be trusted, or migration would discard/fabricate legacy data.

Stop `GEMINI_REVIEW_PROVIDER_FOUNDATION_V1` if official API/auth/input capability cannot be used from the server, upload requires unsupported infrastructure, provider credentials bypass the existing BYOK boundary, or a paid live call is required for correctness proof.

Stop `GEMINI_VIDEO_REVIEW_ADAPTER_V1` if native video is unavailable, async execution cannot be represented truthfully, cost caps cannot be enforced, or criteria would rely on missing prompt/Identity/audio evidence.

Stop `ANTIGRAVITY_CONNECTED_ACCOUNT_EXPERIMENT_V1` if per-user token isolation, expiry/revocation, remote bridge operation, or native-media behavior cannot be proven; if it would be labeled as official Gemini; if it requires an unapproved server/process bridge; or if it would become a fallback that silently changes provider/account.

## Migration and release expectation

Migration required for universal Review: **YES, later and additive**. No migration is applied in this preflight. Existing Image Review migration impact is limited to backfilling 17 artifacts while retaining current Review IDs and typed Image references. The one outputless legacy evaluation remains compatibility-only. No Review data, Image output, Library file, Generation Attempt, or Project data is discarded.

Gemini Review provider calls in this preflight: **0**. Antigravity calls: **0**. Gemini generation, Veo, Flow, Nano Banana, Kling, Image generation and Video generation were not invoked or changed.

## Sources

* [Gemini video understanding](https://ai.google.dev/gemini-api/docs/video-understanding?hl=en)
* [Gemini Files API](https://ai.google.dev/gemini-api/docs/files?hl=en)
* [Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output?authuser=683989221)
* [Gemini API keys](https://ai.google.dev/gemini-api/docs/api-key?wvideo=ydmtek6kzh)
* [Gemini OAuth quickstart](https://ai.google.dev/gemini-api/docs/oauth)
* [OmniRoute README](https://github.com/blessedalways/omniroute/blob/main/README.md)
* [OmniRoute Remote Mode](https://github.com/diegosouzapw/OmniRoute/blob/release/v3.8.51/docs/guides/REMOTE-MODE.md)
* [OmniRoute Antigravity onboarding](https://github.com/JamshidSod/omniroute/blob/release/v3.8.50/docs/guides/ANTIGRAVITY-ONBOARDING.md)
