# VIDEO_GENERATION_PRODUCTIZATION_CLOSURE_V1

Release-closure record of the `/videos` Video Generation V1 vertical. Audited against `origin/main`
`9be3f604030ac53d76954d084a9e145fc81cd8de` (== Production at the start of the audit). The closure SHA is the
merge commit of the PR that carries this document; the Production smoke that follows it is recorded in the task
report, not here (a document cannot cite its own deploy).

## Product, as one architecture

```
Project / Production
  -> /videos  (generation history + "Criar vídeo")
  -> connection: Kling API (REST, user BYOK)  |  Minha conta Kling (MCP, OAuth)
  -> operation (text_to_video | image_to_video) -> model -> model-specific controls
  -> optional source image (I2V)
  -> POST /api/video-generations  (server re-resolves everything; browser flags are not authority)
  -> async provider task (REST callback | MCP poller)  -> shared completion
  -> app-owned storage ({user_id}/videos/ai/{project_id}/{generation_id}.mp4)
  -> generation history card (playable)  + provider_usage_events (observability, not a wallet)
  -> explicit "Salvar em Arquivos"  -> LibraryFile (durable, reusable I2V source)
  -> explicit "Abrir no editor" -> existing compatible target + ?media=<LibraryFile.id> -> "Mídia recebida"
```

Invariants (all verified in code): Generation != Composition; VideoGeneration != VideoDraft; LibraryFile !=
ChannelPieceMedia; Render != Save. Nothing in generation submit, completion, polling, callback, Library promotion
or handoff writes `video_drafts`, `video_scenes`, `channel_pieces` or `channel_piece_media` (the only code in the
vertical that even *reads* those tables is the read-only handoff target chooser). Creating a VideoDraft from
`/videos` is a separate, explicit "Novo vídeo" action unrelated to a generation.

## Connections and capability authority

| | Kling API (REST) | Minha conta Kling (MCP) |
|---|---|---|
| Credential | user BYOK (`user_byok`); no platform fallback; missing key = 422 `PROVIDER_NOT_CONFIGURED`, zero records, zero calls | OAuth + PKCE grant, encrypted tokens server-side |
| Scopes | n/a | server-derived from connect intent: read-only `generation.read account.credit.read`; generation-ready adds `generation.create`. A browser cannot inject scopes |
| Capability authority | **code-backed registry** `lib/video-generation/rest-capabilities.ts` | **dynamic snapshot** from `who_am_i`, normalized by `kling-mcp-video-capabilities.ts` and stored in `provider_connections.capabilities.video` (fresh <=24h, stale <=7d, expired >7d blocked) |
| Completion | Kling webhook (HMAC) -> shared completion; manual `/sync` recovery | VPS scheduler -> `POST /api/internal/video-generations/poll` (Bearer `VIDEO_POLL_WORKER_SECRET`) -> leased rows -> shared completion |
| Funding / usage | Kling API package; `provider_reported` units | Kling web credits; `balance_delta` observed when measurable, otherwise `unknown` |

REST registry (not discovered; changing it without the adapter is a bug):

| Model | Ops | Duration | Resolution | Aspect (T2V only) | Audio | Multi-shot | Constraint |
|---|---|---|---|---|---|---|---|
| `kling-v3` (Kling 3.0) | T2V, I2V | 5, 10 | 720p, 1080p | 16:9, 9:16, 1:1 | yes | yes | — |
| `kling-v2-6` (Kling 2.6) | T2V, I2V | 5, 10 | 720p, 1080p | 16:9, 9:16, 1:1 | yes | no | I2V audio only at 1080p |

REST has no ASMR / audio prompt / music prompt. MCP models are whatever `who_am_i` declares *and* Content Studio
can fill from the controls it offers (required args subset of `{prompt}`; I2V needs exactly one `first_image`;
omni / reference-image / elements / tail-image models are not exposed). MCP-only advanced Product controls:
`asmr` -> `enable_asmr`, `audio_prompt` -> `audio_prompt`, `music_prompt` -> `music_prompt`, each shown only when
the selected model declares the argument. Raw provider schema never reaches React; the form works on the
normalized `VideoModelCapability`.

## Request lifecycle and server authority

`validateControlVocabulary` (pre-DB shape check) -> `resolveGenerationConnection` (ownership-scoped; transport
comes from the resolved connection, `transport`/`connection_id`/`provider`/`executionMode` from a client are
rejected) -> `validateVideoRequest` against the server's capabilities (typed `UNSUPPORTED_*`,
`AUDIO_RESOLUTION_CONFLICT`) -> Production/Project ownership -> I2V source trust chain -> insert `queued` row
(service role; the user session cannot write `video_generations`) -> provider submit -> `submitted` + task id.
Defaults are always explicit: the value the user sees is the value sent. One action = one generation = one video
(`outputCount` is pinned to 1).

Status lifecycle (DB check constraint): `queued -> submitted -> processing -> succeeded | failed`. A row only
becomes `succeeded` after its bytes are in app-owned storage; the provider URL is never persisted. Recovery:
`SUBMISSION_INTERRUPTED` (queued orphan), `POLL_MAX_AGE`/hard-expiry failure, `SUBMIT_OUTCOME_UNKNOWN` /
`SUBMISSION_UNRECORDED` (accepted-but-unrecorded jobs are flagged so the UI never invites a second charge).

## Source authority (I2V)

Strict XOR, also enforced by the DB check `check_mode_source_image`: Geradas por IA -> `source_image_id`;
Galeria / Arquivos / Enviar -> `source_library_file_id` (Gallery is a LibraryFile with origin `studio_render`).
The server re-resolves owner, Project, kind=image, not trashed, and a trusted storage key; a signed URL,
`storage_path` or browser MIME is never authority. MCP I2V: server reads bytes from the proven key, validates by
file signature (PNG/JPEG, <=30 MB, <4096 px, aspect <=2:1; SVG/WebP rejected), uploads through `file_upload`, and
sends only the provider's file URL to `image_to_video`. No Content Studio presigned URL is ever given to Kling.

## Library and handoff

`POST /api/video-generations/:id/save-to-library`: explicit, owner/Project/storage-trust validated, canonical
copy into the user's Library namespace, atomic promotion pointer (`video_generations.library_file_id`) =>
idempotent (`created` / `already_saved`), optional `production_id` scoping, no authoring entity. Generated image ->
Library follows the same explicit rule. Handoff (see `GENERATED_MEDIA_TO_CREATIVE_EDITOR_HANDOFF_V1`): saved
LibraryFile only; image -> Static + Video targets, video -> Video targets only; Static targets are listed only when
the Project's identity satisfies the Static Editor's readiness gate; navigation carries only `?media=<id>`; the
receiving editor shows "Mídia recebida" and mutates nothing until an explicit use.

## Provider-call proofs relied upon (historical, not repeated)

REST T2V, REST I2V, MCP T2V and MCP I2V each had a real provider proof in earlier slices. This closure made no
provider call (REST generation 0, MCP generation 0, `file_upload` 0, paid 0) and changed no adapter/transport
code, so those proofs remain valid for the unchanged paths. The one path this closure changes (MCP advanced
controls reaching the provider through the route) is covered by route-level tests with a recording fake MCP client;
it has **not** had a paid real-provider proof.

## Findings and classification

| # | Finding | Class |
|---|---|---|
| 1 | `POST /api/video-generations` never read `asmr` / `audio_prompt` / `music_prompt` from the body (PR #88 wired UI, form, validator and adapter but not the route): a user's ASMR/audio/music choice was silently replaced by defaults, and forged values on unsupported models were not rejected. Route now validates and forwards them; `request_config` records them. | BOUNDED_FIX_IN_CLOSURE |
| 2 | A failed generation's card said "Aguardando — O vídeo ainda não está pronto". Now "A geração falhou" with the recorded reason. | BOUNDED_FIX_IN_CLOSURE |
| 3 | Stale comments ("five controls"; "/videos AI generation does not exist yet"). | BOUNDED_FIX_IN_CLOSURE (comments) |
| 4 | Stored MCP capability snapshots taken before PR #88 lack the advanced flags (`KLING_MCP_VIDEO_SNAPSHOT_VERSION` was not bumped), so the advanced section stays hidden until the user presses "Atualizar conexão". Truthful, never wrong. | KNOWN_V1_LIMITATION |
| 5 | Generation status/button labels show the raw English status (`queued`, `submitted`, `failed`). | KNOWN_V1_LIMITATION |
| 6 | `POST /api/video-generations` has no server-side idempotency key (a double POST makes two generations; the dialog locks to prevent it). | REGISTERED_FOLLOWUP (already registered) |

## Known V1 limits and deferred (not release blockers)

One source image, one output per generation, no motion control / elements / reference video / multi-source;
no REST usage-billing extraction; MCP usage is balance-delta or unknown (never inferred); no Library thumbnail
pipeline; no "create a new Creative Editor document from this media"; no Browser Bridge. Registered follow-ups:
`MCP_MULTI_SOURCE_MEDIA_V1`, `MCP_MULTI_OUTPUT_GENERATION_V1`, `MCP_MOTION_CONTROL_V1`, `MCP_ELEMENTS_V1`,
`MCP_REFERENCE_VIDEO_V1`, `REST_USAGE_BILLING_EXTRACTION_FOLLOWUP`, MCP usage observability improvements,
`POST /api/video-generations` idempotency, `LIBRARY_THUMBNAIL_PIPELINE_V1`.

## Schema

No migration. Relevant existing schema: `039` video_generations, `041` provider_connections, `042` transport
provenance, `043` server-owned writes, `044` provider_usage_events, `045`-`048` Library provenance / trust /
production scope. Constraints verified live: status in the five values, mode in the two operations, transport
in (`rest`, `mcp`, null legacy), `check_mode_source_image` XOR.
