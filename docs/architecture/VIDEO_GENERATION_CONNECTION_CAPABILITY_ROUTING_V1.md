# Video Generation — Connection + Capability Routing V1

`VIDEO_GENERATION_CONNECTION_CAPABILITY_ROUTING_V1`

Builds on [KLING_MCP_CONNECTION_AND_TRANSPORT_DISCOVERY_V1](KLING_MCP_CONNECTION_AND_TRANSPORT_DISCOVERY_V1.md)
(PR #42) and [KLING_MCP_OAUTH_CONNECTION_SPIKE_V1](KLING_MCP_OAUTH_CONNECTION_SPIKE_V1.md) (PR #43).

**Scope: /videos generation infrastructure + UX only.** Nothing here generated a video through Kling
MCP. **Real MCP generation calls: 0. Kling web credits spent on MCP: 0.** The MCP transport,
polling and completion are implemented and tested against mocks; the first paid MCP generation is a
separate, explicitly authorized task ([§16](#16-next-task-the-first-controlled-mcp-generation-proof)).

## 1. Product correction

The generation form used to be a Kling-REST-hardcoded form (fixed models, fixed 5/10 s, fixed
720p/1080p). Real evidence showed that is wrong as a concept:

- A Kling **web account** (MCP) exposes a different model list, different durations (3–15 s),
  different resolutions (up to 4K), model-dependent aspect ratios, audio and multi-shot — and those
  vary **per account tier**.
- Kling **API** (REST) supports a narrower, code-defined subset.

So the target model is:

```
Provider → Connection → Operation → Model → Capabilities → explicit generation request
```

A **connection determines** which operations, models, controls, defaults and limits exist. The user
chooses *where their account is connected* ("Kling API" / "Minha conta Kling"); the protocol
(REST/MCP) is secondary detail. Funding is disclosed truthfully and is unrelated to Content Studio
Credits, which do not exist.

Domain boundaries are unchanged: Generation ≠ Composition; `VideoGeneration` ≠ `VideoDraft`;
`LibraryFile` ≠ `ChannelPieceMedia`; Render ≠ Save. Completion creates **no** VideoDraft, scene,
LibraryFile or ChannelPieceMedia (asserted by tests that record every write).

## 2. Bounded, normalized capability contract

`lib/video-generation/capabilities.ts` — the smallest VIDEO-specific contract justified by the two
real connections. **Not** a universal framework: two operations, five controls, discrete values.

```ts
VideoGenerationConnectionDescriptor {
  ref                      // opaque server-resolvable pointer (see §4)
  provider: 'kling'
  connectionMethod: 'api_key' | 'mcp_oauth'
  transport: 'rest' | 'mcp'
  label                    // "Kling API" | "Minha conta Kling"
  detail                   // secondary: "REST · usa o pacote de recursos da sua API Kling"
  funding: 'kling_api_package' | 'kling_web_credits'
  status: 'connected' | 'not_configured' | 'authorization_required' | 'error'
  canGenerate: boolean
  blockedReason?           // not_configured | authorization_required | connection_error |
                           // generation_authorization_required | capabilities_missing |
                           // capabilities_expired | no_supported_models
  needsGenerationAuthorization: boolean
  accountLabel: string | null        // membership label ("Pro"); never an id
  capabilitiesFreshness: 'static' | 'fresh' | 'stale' | 'missing'
  capabilitiesCheckedAt: string | null
  operations: { operation: 'text_to_video' | 'image_to_video'
                models: VideoModelCapability[] }[]
}

VideoModelCapability {
  id, label
  durations: number[]                // discrete, ascending
  resolutions: ('720p'|'1080p'|'4k')[]
  aspectRatios: ('16:9'|'9:16'|'1:1')[]   // empty = control not offered (always for I2V)
  audio: boolean                     // control offered?
  multiShot: boolean                 // control offered?
  audioRequiresResolution?           // provider-documented model constraint
  outputCountArg?: boolean           // SERVER-ONLY mapping hint, stripped for the browser
}
```

**Range vs enum.** Both real connections express *every* control as a discrete set (MCP durations
are the enumerated strings `"3"…"15"`), so only the discrete representation exists. A range type is
added only when a real connection needs one — forcing an artificial shape was explicitly avoided.

**Raw provider schemas never reach the UI.** `who_am_i` / `tools/list` are read by exactly one
adapter (`lib/provider-connections/kling-mcp-video-capabilities.ts`), which emits this contract; the
form renders only the contract. Provider tool names, argument names and ids are integration details.
Control order in the UI is fixed by Content Studio (duration, resolution, aspect ratio, audio,
multi-shot), never by provider property order.

## 3. Capability sources

### REST — code-backed
`lib/video-generation/rest-capabilities.ts`. Describes what the executing adapter
(`lib/providers/kling/adapter.ts`) does today and nothing more: model `kling-v3` ("Kling 3.0" — the
id already stored on every REST row), durations 5/10, resolutions 720p/1080p, audio, multi-shot,
aspect ratios `16:9/9:16/1:1` for text-to-video only. It does **not** advertise 4K, other models or
other durations even if Kling REST docs support them. No remote discovery "for symmetry".

### MCP — persisted, normalized snapshot
Source: `who_am_i` (identity + per-model argument specs), read during the **deliberate** connection
check. Normalization rules (all unit-tested against a fixture with the real observed argument
specs):

- A model is **exposed** for an operation only if Content Studio can fill every required argument
  and input: required args ⊆ `{prompt}`; text-to-video needs no input; image-to-video needs exactly
  one required input, `first_image`. Multi-reference "omni"/o1 image models (`image_1…image_7`),
  tail images, subjects/elements are **not** exposed.
- Durations 1–120 s, and the known resolution / aspect-ratio vocabularies; unknown values never
  become controls. Aspect ratio exists for text-to-video only (framing comes from the source image,
  same as REST). Audio = `enable_audio` present with `true/false`; multi-shot = `prefer_multi_shots`.
- Ignored on purpose: ASMR, audio/music prompts, `elements`, tail image, and every tool other than
  `text_to_video`/`image_to_video` (motion control, images, omni, effects, upload…).
- Provider-documented constraint the schema cannot express: Kling 2.6 image-to-video audio "only at
  1080p" → `audioRequiresResolution`.
- Model ids are validated (`^[a-z0-9][a-z0-9._-]{0,63}$`), de-duplicated and capped (20/operation).

Nothing is hardcoded from the number of models; another account/tier yields another list.

## 4. Connection reference and server authority

`lib/video-generation/connection-ref.ts` (client-safe, pure):

| Reference | Resolves to |
|---|---|
| `kling:api` | the user's Kling **API key** (`user_settings`) — REST. **Not** a `ProviderConnection` row; no migration for symmetry |
| `kling:account:<uuid>` | a `provider_connections` row (Kling MCP OAuth) |

A reference carries **no authority**. Every use is resolved server-side against the authenticated
user's own rows (`getOwnedConnection(id, userId)` + RLS); a foreign, unknown or malformed reference
is indistinguishable from "not found". There are no synthetic ids that work without server
resolution.

`resolveGenerationConnection` (one function used by both the capability endpoint and the submit
route, so the form and the server agree) verifies: authenticated user, ownership, provider, method,
status, required scope (`generation.create` for MCP), a usable capability snapshot, and then
`validateVideoRequest` verifies operation, model, duration, resolution, aspect ratio, audio and
multi-shot against **server-held** capabilities. Nothing echoed by the browser is trusted.

Server rejections (all return **before** any provider call or generation record): foreign/unknown
connection (404), `authorization_required` (409), errored connection (409), read-only MCP (403
`GENERATION_AUTHORIZATION_REQUIRED`), missing/expired capabilities (409), unsupported
operation/model/duration/resolution/aspect ratio/audio/multi-shot (400 with a specific code), output
count ≠ 1 (400), and any client-supplied `transport`, `executionMode`, `execution_mode`,
`credentialSource`, `connection_id`, `provider` (400 `UNSUPPORTED_FIELD` — the server decides these;
a client can never request Content Studio Credits or platform credentials).

## 5. Capability API

`GET /api/video-generations/connections` → `{ connections: VideoGenerationConnectionDescriptor[] }`.

- Reads only the user's own data (session client, RLS). **No provider request is made**; MCP
  capabilities come from the persisted snapshot, so rendering the form cannot fan out into provider
  calls.
- Lists **Kling API first** (even when unconfigured, so the UI can explain how to configure it), then
  the user's own account connection(s). Never hypothetical providers.
- Browser-safe by construction: no tokens, no raw schema, no mapping hints, no account id, no
  foreign rows.
- A store failure is a `503 CONNECTIONS_UNAVAILABLE` — never an empty list that would read as "no
  connections" or "no models".

## 6. Snapshot lifecycle and freshness policy

`provider_connections.capabilities.video` (`schemaVersion: 1`) is written by the existing deliberate
**check** action (`POST /api/provider-connections/[id]/check`) — the same read-only sequence
(initialize → tools/list → `who_am_i` → `query_membership_and_credits`). No migration was needed (the
column is JSONB). A snapshot is **capability truth, not a billing ledger**: the live credit balance
is returned for display and **never persisted** (asserted).

| Age of last successful check | State | Behavior |
|---|---|---|
| no `video` section / older schema / never checked | `missing` | blocked (`capabilities_missing`); form offers **Atualizar conexão** |
| ≤ 24 h | `fresh` | usable |
| ≤ 7 d | `stale` | still usable; form shows "verificados há N h — Atualizar" |
| > 7 d | `stale` + expired | blocked (`capabilities_expired`); refresh required |

Refresh is **one deliberate server action** (button), never on render or per interaction. A failed
refresh leaves the previous snapshot in place (a provider outage does not erase capabilities). After
the OAuth callback returns, Settings runs one check automatically (already present since the spike).

## 7. Explicit defaults (what you see = what is sent)

Content Studio never relies on a silent provider default for a control it exposes. Discovery found
MCP defaults differ from REST (`resolution` 1080p vs 720p, `enable_audio` true vs off,
`prefer_multi_shots` true vs false) — a naive mapper would silently spend more. Therefore:

- The form always submits **visible** controls with explicit values; **hidden** controls (the model
  does not offer them) are `null`, never submitted, and a value for one is **rejected** by the server.
- If a caller omits a supported control the server fills a deterministic explicit default:
  duration 5 (else the smallest), resolution 720p (else the first), aspect ratio 16:9 (else the
  first), audio off, multi-shot off.
- Default **model**: `kling-v3` (REST) / `kling-video-v3_0` (MCP) when present — continuity with the
  REST integration's historical Kling 3.0, deliberately **not** a "best/most expensive" ranking —
  otherwise the first listed.
- The exact submitted values are stored in `request_config` (plus `output_count: 1`) — reproducible,
  no secrets.

## 8. Form reconciliation

`lib/video-generation/form-selection.ts` — pure, deterministic, unit-tested; the UI and tests use the
same function. A previous value survives **only if the new context still allows it**; otherwise it
resets to an explicit default (no invisible invalid state).

- **Connection switch** recomputes operation, model, duration, resolution, aspect ratio, audio and
  multi-shot; compatible values are preserved (e.g. 10 s / 1080p survive REST→MCP).
- **Model switch**: 4K → a model without 4K resets to 720p; multi-shot → a model without it becomes
  hidden (`null`); audio-only-at-1080p turns audio off if resolution leaves 1080p.
- **T2V ↔ I2V**: aspect ratio disappears/reappears with an explicit default.
- **Kling REST stays the default connection** whenever it can generate; MCP is never selected
  automatically because it offers more models or credits. If REST is unusable the first usable
  connection is chosen; a read-only account may still be selected for **exploration** only.

## 9. /videos UX

`components/videos/create-video-generation-dialog.tsx`:

1. **Conexão** selector (Kling API / Minha conta Kling — Pro), technical detail + funding line beneath.
2. Truthful state banner for the selected connection (never "no models"/"not connected" when
   something else is true): *Kling API não configurada*, *Reautorização necessária*, *Erro na
   conexão*, **Conectada — somente leitura** (+ **Autorizar geração**), *Capacidades ainda não
   carregadas / desatualizadas* (+ **Atualizar conexão**), *Nenhum modelo compatível*. A load failure
   is its own state with **Tentar novamente** (explicitly "not a disconnection").
3. Operation tabs (only supported ones), **Modelo** selector, prompt/source, then only the controls
   the model offers.
4. **Gerar vídeo** is enabled only when the selected connection `canGenerate`. A submission the
   provider may have accepted but we could not confirm/record **locks the form** ("Envio não
   confirmado — não tente de novo") so it cannot be resubmitted by mistake (double charge).

The page no longer disables the button on REST status alone (a user with only a Kling account can
generate once authorized). While /videos is open, in-flight **MCP** generations are also synced every
30 s as a convenience; REST behavior is unchanged.

## 10. Scope upgrade ("Autorizar geração")

The spike's connection is read-only (`generation.read account.credit.read`). Generation needs
`generation.create`, requested **only** by an explicit user action:

- `POST /api/provider-connections/kling/mcp/connect` accepts `{ intent: 'read_only' | 'generation' }`
  (default `read_only`; unknown → 400). Selecting the connection on /videos or opening Settings never
  starts it (tests: no `connect` call until the click). Buttons: /videos banner and the Settings card.
- Re-authorization **reuses the user's single connection row** (unique per user/provider/method — no
  duplicate). It replaces the grant through the secure token authority: `secret_version` is strictly
  monotonic (CAS protection preserved), the new grant records its own `client_id`/issuer, derived
  metadata is cleared until the next check, tokens never leave the server.
- OAuth **client registration vs scope**: a client registered read-only is replaced by a broader
  registration for the explicit generation request (existing grants keep refreshing with the client
  they were issued to). Whether Kling enforces registered scope is **UNVERIFIED** (see §17).
- **Reconnect keeps the permission level** already granted (a generation-authorized connection that
  needs re-authorization re-requests `generation.create`; it is never silently downgraded).
- If Kling grants fewer scopes than requested the connection truthfully stays read-only
  (`generationAuthorized` is computed from granted scopes).
- A failed/declined upgrade leaves the existing connection and tokens exactly as they were.
- The superseded read-only tokens are **not** revoked at Kling: Kling may treat the new authorization
  as the same grant, and revoking the old refresh token could kill the new one. They expire naturally.

**Current Production state: `generation.create` NOT granted. No scope elevation was performed.**

## 11. Transport abstraction

`lib/video-generation/transport.ts` — a narrow Kling boundary, only what two real connections need:

```ts
interface KlingVideoTransport { transport: 'rest'|'mcp'; submit(input): {taskId, providerMetadata}; getStatus(taskId): processing|succeeded|failed }
```

- **`KlingRestTransport`** wraps the proven `KlingAdapter` **unchanged** (submit behavior,
  `external_task_id` = generation id, callback, source image, controls, error handling preserved).
  REST still completes primarily through the callback.
- **`KlingMcpTransport`** uses the official `@modelcontextprotocol/client` SDK
  (`kling-mcp-generation.ts`): resolves the user's connection, obtains/refreshes the access token
  server-side (a token rejected before use is refreshed **once** and retried — safe because a
  rejected token never reached a generation tool), maps the normalized request explicitly, submits
  **exactly one** generation, returns the `generation_id`.
- **Transport is chosen by the server** from the resolved connection; never from a client value.

**MCP argument mapping** (`buildKlingMcpVideoCall`): `prompt`, `duration`, `resolution`,
`aspect_ratio` (T2V only), `enable_audio`, `prefer_multi_shots` — each sent explicitly and only when
the model offers it; source image → `inputs[{name:'first_image', inputType:'URL', url}]` reusing the
current owned-source + presigned-URL mechanism (1 h); **`imageCount` pinned to `1`**. No tail image,
no elements, no arbitrary UI JSON. Tool allow-list `text_to_video`, `image_to_video`, `query_tasks`
(a second, separate gate from the read-only `who_am_i`/`query_membership_and_credits` gate; every
other tool is refused locally).

**Accepted-but-unrecorded submissions**: once the provider has accepted a job, recording its task id
is handled separately from the submission (retried once with server authority). If it still cannot be
recorded the API answers `502 SUBMISSION_UNRECORDED` ("do NOT retry — check your Kling account"), the
row is *not* marked as a failed submission, and the provider id is logged for reconciliation — a
recording failure can never be mistaken for "the submission failed" (which would invite a second
charge). Applies to REST and MCP.

**Submit failure semantics**: one attempt, never retried (a retry is a second charge). A refusal the
server *answered* (JSON-RPC error, HTTP 4xx such as 403 for a missing permission) means the tool did not
run and is a **definitive rejection** (not "check for a charge"); timeouts, dropped connections and 5xx
after sending stay unknown-outcome. Provider rejections are classified (`PROVIDER_QUOTA_EXCEEDED` → 402 — Kling credits; `PROVIDER_CONTENT_REJECTED`;
`PROVIDER_REJECTED`). A failure **after** the request may have reached Kling, or a success whose
`generation_id` cannot be read, is failed with an explicit `outcome_unknown: true` ("verify your Kling
account before retrying") so a possibly-billed job is never silently retried. Only the error class
is logged; tokens and provider text never are.

## 12. Polling architecture

**Why**: MCP has no callback and no client correlation id; the only way to learn a result is
`query_tasks(generation_id)`. Result URLs live 24 h.

**Audit result**: no cron routes, queue, worker or scheduler existed; nothing called `/sync`. The
smallest mechanism compatible with the deployment (Vercel + Supabase) is a **scheduled server route**
plus DB-persisted schedule state — no Redis/BullMQ/Temporal/worker.

- `app/api/internal/video-generations/poll` (GET for Vercel Cron, POST for other schedulers):
  authenticated with a **shared secret** (`CRON_SECRET`, `Authorization: Bearer …`, constant-time
  digest compare). **Fails closed**: no/short secret → 503, wrong header → 401, both before any DB
  access. Returns **counts only**. Runs with server credentials, **no user session**.
- `pollDueMcpGenerations` (`lib/video-generation/polling.ts`): selects `transport='mcp'` rows in
  `submitted|processing` with `next_poll_at <= now` (batch ≤ 10, concurrency 2 — each completion can
  buffer a whole video — and a 240 s budget inside the route's 300 s `maxDuration`, after which no new
  row is started), **leases** each row
  with a compare-and-swap on the exact `next_poll_at` it read (also increments `poll_attempts`), so
  concurrent runs never poll the same row twice; obtains the **generation owner's** connection
  (`getOwnedConnection(connection_id, generation.user_id)` — a planted `connection_id` can never
  borrow another user's grant); queries the exact `generation_id`; normalizes; on success calls the
  shared completion; on failure records a safe error; terminal rows are never selected.
- Schedule state is only `next_poll_at` + `poll_attempts` (migration 042).

**Backoff / limits (evidence-based)**: first check 45 s after submit; then 60 s, 60 s, 90 s, and 120 s
thereafter (cap) — far under Kling's documented 5 QPS and inside the 24 h URL lifetime. Authorization
lost → 5 min backoff and the paid job is **not** failed (recoverable on reconnect). Provider /
store / encryption / download hiccups → backoff, row untouched. A generation unresolved after **6 h**
is failed with an explicit "check your Kling account" message — **but only when the provider itself
answers "still running"** at a final check (a job that finished at Kling while nobody was polling, e.g.
between daily sweeps, is completed, never timed out unseen). Errors while checking (outage, refresh
hiccup, revoked authorization, storage failure) are **not a verdict** and keep being retried until a
**22 h hard cap**, inside the 24 h result-URL lifetime. A `queued` MCP row with no provider
task older than 15 min (interrupted submit) is failed `SUBMISSION_INTERRUPTED`.

**Task-error classification**: an `isError` `query_tasks` result fails the generation only for
*unambiguous* documented task failures (moderation, insufficient credits, unsupported parameter
combination, "generation timed out", invalid parameter). Generic outage text ("temporarily
unavailable", request timeouts, unknown errors, "Invalid generationId.") is **transient** — wrongly
failing a paid job loses its result, while waiting only delays the failure until the max age.

**Status vocabulary caveat**: the raw `query_tasks` states and the exact submit/query response
shapes are **UNVERIFIED** (discovery could not observe a real task). `kling-mcp-task.ts` is
deliberately tolerant and conservative: unknown state ⇒ still processing, success requires a result
URL, the raw state string is surfaced (bounded) as evidence, and a submit response without a readable
id is treated as possibly-billed. The first paid proof must capture the real payloads and tighten
this parser and its tests.

**Manual/recovery**: `POST /api/video-generations/[id]/sync` is now transport-aware (and returns the
same *presigned* URL contract as the history list for finished videos) and calls the
**same** `syncGenerationWithProvider` — no second completion implementation. Legacy/REST rows
(`transport` NULL/`rest`) sync via the user's Kling API key exactly as before.

### Scheduler activation (owner action — recorded, not silently assumed)

The route is deployed and tested, but a scheduler must call it, and this environment could not set
Production environment variables (403 on `create_project_env`, as in the spike). `vercel.json` ships a
**daily** Vercel Cron as a last-resort recovery sweep only (valid on every plan; inside the 24 h URL
window). For minute-level polling the owner must choose:

1. **Vercel Pro**: change the schedule to `* * * * *` and set a Sensitive Production `CRON_SECRET`
   (≥ 16 chars, high entropy); Vercel then sends it as the Bearer header.
2. **Any plan**: set `CRON_SECRET` and have any scheduler (e.g. Supabase `pg_cron` + `pg_net`, or an
   external cron) call `GET /api/internal/video-generations/poll` every minute with
   `Authorization: Bearer <CRON_SECRET>`.

Until a scheduler with the secret is active, MCP generations are still completed by (a) the /videos
page's 30 s sync while it is open and (b) the manual sync endpoint. **The Vercel plan could not be
verified** (dashboard not accessible to the agent), which is why the per-minute cron was *not* added
to `vercel.json`: on a Hobby plan a sub-daily cron **fails the deployment**.

## 13. Shared, idempotent completion

`lib/video-generation/completion.ts` — one function converging the **REST callback**, the manual
**/sync** and the **MCP poller**:

- verifies identity (row `task_id` **and** transport must match the caller — a REST callback can
  never complete an MCP row and vice versa; legacy `transport NULL` rows are REST);
- a terminal row is untouched (no download, no write);
- **copies the provider result to app-owned storage first** under a **deterministic key**
  (`<user>/videos/ai/<project>/<generationId>.mp4`), so a retried/duplicated/concurrent completion
  overwrites the same object instead of creating another (historical rows keep their old random
  names); success is recorded only after the bytes are stored;
- the terminal write is a **database compare-and-swap** (`WHERE status IN (queued, submitted,
  processing)`) — not an in-memory lock: exactly one caller wins, the rest see `already_terminal`;
- a failed download/storage step leaves the row non-terminal (retryable while the URL is valid);
- the provider result is fetched **defensively** (`lib/storage/video-downloader.ts`,
  `safe-result-url.ts`): https only; every hop — redirects are followed **manually** (max 3) and
  re-validated — must be a public host **and resolve to public addresses only** (DNS check blocks
  private/loopback/link-local/CGNAT/unique-local); 50 s timeout; 300 MB cap enforced while streaming
  (also when `content-length` lies or is absent); only `video/*` or `octet-stream` content types;
  stored size is the actual byte count; special-use ranges blocked include RFC 1918, loopback,
  link-local, CGNAT, 192.0.0.0/24, 198.18/15, multicast, IPv6 ULA/link-local and the hex/NAT64/6to4
  encodings of IPv4. **Residual (accepted):** DNS is resolved before `fetch` opens its own connection,
  so a DNS-rebinding race between the check and the connect is theoretically possible; the URL comes
  from an authenticated provider response or an HMAC-verified webhook (a trusted party), so this is
  defense in depth rather than the primary control. **Residual:** the video is buffered in memory
  (≤ 300 MB) before upload — mitigated by concurrency 2, not eliminated;
- the temporary provider URL is **never persisted**; only `{mime, size, transport, provider_task_id,
  provider_state, completed_at}`; result URLs must be plain `https` to a public host (no
  localhost/IP literals/`.internal`/`.local`/credentials) or the generation is failed
  `PROVIDER_RESULT_URL_UNSAFE`;
- a late "failed" can never overwrite a succeeded row; creates no VideoDraft/LibraryFile/
  ChannelPieceMedia.

**Callback security stays separate**: the REST callback still verifies the Kling webhook HMAC
(timestamp window + `timingSafeEqual`) *before* calling completion; a valid signature naming an MCP
row is ignored; MCP never uses the webhook secret (source-scan tests pin the ordering and that
`KLING_WEBHOOK_SECRET` appears only in the callback route).

## 14. Provenance and history

Migration **`scripts/042_video_generation_transport_provenance.sql`** (new, additive; 039/041
untouched; **applied to Production**, verified — the 3 historical rows are unchanged, all NULL):

| Column | Meaning |
|---|---|
| `transport` (`rest`\|`mcp`, nullable) | how THIS generation reached the provider; NULL = created before this migration = legacy REST. Never inferred from the task id's shape |
| `connection_id` (nullable FK → `provider_connections`, **ON DELETE SET NULL**) | the exact MCP connection used; NULL for REST |
| `next_poll_at`, `poll_attempts` | the only poller scheduling state (also the lease) |

- **Deleting/disconnecting a connection never cascades into or invalidates history**: the FK nulls
  `connection_id`, and `provider`/`model`/`transport`/`request_config` remain as provenance.
- No backfill: historical rows load, display and play unchanged (tests).
- `task_id` keeps its `UNIQUE` constraint; a collision between a REST task id and an MCP
  `generation_id` is considered practically impossible (UUID-like vs numeric) but is **UNVERIFIED**.
- `request_config` now stores the exact explicit values sent (plus `output_count: 1`); no tokens, API
  keys or headers in `request_config`, `provider_metadata`, `result_metadata` or `error_details`
  (asserted). `error_details` carries `{code, message, outcome_unknown?, provider_text?}`; the bounded
  `provider_text` (≤ 300 chars, provider-authored, never a token) exists only for reconciliation of
  ambiguous submissions.
- The user-facing lifecycle is unchanged: `queued → submitted → processing → succeeded|failed`; no
  MCP-specific statuses.

## 15. Disconnect while a generation is active

MCP has no callback, so the grant is the only way to retrieve a paid result. Policy (implemented):
**`DELETE /api/provider-connections/[id]` is refused (409 `CONNECTION_HAS_ACTIVE_GENERATIONS`) while a
job that can actually need the grant references the connection:** anything the provider has accepted
(`submitted|processing`), or a `queued` row that is still plausibly mid-submit (< 15 min old). An
*interrupted* `queued` row (no provider task, past the orphan cutoff) can never be retrieved and does not
block. The Settings toast and the
disconnect dialog say so. It fails **closed** (503 if the check cannot run; nothing is revoked or
deleted). Finished generations never block it, and history is untouched (FK `SET NULL`). The residual
window (a generation created in the instant between the check and the delete — the two are not one
transaction) is handled by the poller,
which fails such a row with an explicit `CONNECTION_UNAVAILABLE` message instead of retrying forever.

## 16. Next task: the first controlled MCP generation proof

`KLING_MCP_REAL_GENERATION_PROOF_V1` (**not run here**). Exact requirements:

1. Owner presses **Autorizar geração** (Settings or /videos) and approves the Kling consent screen →
   `generation.create` granted; then **Verificar conexão** so the snapshot is fresh.
2. Owner sets Production `CRON_SECRET` and activates a scheduler (§12) — or accepts manual/open-page
   sync for the proof.
3. Owner explicitly authorizes **one** paid generation and its parameters (suggested minimum:
   text-to-video, `kling-video-v3_0`, 3 s, 720p, 16:9, audio off, multi-shot off).
4. Record **before** balances: Kling web credits and the Kling API package remaining units.
5. Submit **exactly one** generation through `/videos` with the account connection; no retry.
6. Capture the raw lifecycle: the real submit response shape (where the id is), every distinct raw
   `query_tasks` state with timestamps, the result payload (`works[].url` vs `urlWithoutWatermark`), and
   update `kling-mcp-task.ts` + its contract tests with them.
7. Confirm app-owned S3 persistence (deterministic key), the `VideoGeneration` row (`transport=mcp`,
   `connection_id`, no secrets), playback in /videos.
8. Record **after** balances; verify the API resource package did not change; prove exactly one paid
   submission. Then **STOP**.

## 17. Unknowns and risks (honest list)

| Item | Status |
|---|---|
| Exact `text_to_video`/`image_to_video`/`query_tasks` response shapes and raw state vocabulary | **UNVERIFIED** — tolerant parser; first proof records them |
| Whether Kling enforces the registered scope of a DCR client (read-only client requesting `generation.create`) | **UNVERIFIED** — a broader client is registered for the explicit upgrade; failure surfaces as a `provider_error` redirect result |
| Whether the presigned S3 source URL (1 h) is fetchable by Kling and how early Kling fetches it | **UNVERIFIED** — proof covers text-to-video first |
| Watermark: prefer `urlWithoutWatermark` when offered, else `url` | **UNVERIFIED** policy choice; confirm in the proof |
| Non-subscribers: one concurrent video task; 5 QPS; tasks cannot be canceled | OFFICIAL (discovery) |
| Terms (§18) | AMBIGUOUS |
| Vercel plan / cron cadence | **UNVERIFIED** (see §12) |
| **The only scheduler shipped is a DAILY recovery cron** — the 45–120 s backoff, leases and "works while /videos is closed" all assume a minute-level scheduler that the owner must activate (§12). Until then an away user's job is only retrieved by the daily sweep (or when they reopen /videos) | **Prerequisite for the paid proof** |
| Pre-existing: RLS lets a user `UPDATE` their own `video_generations` rows (table policy from 039) — the poller therefore re-derives ownership of `connection_id` from the generation's `user_id` and never trusts the row alone | noted; column-level lockdown is a possible follow-up |

## 18. Terms / policy

Unchanged from the spike: using a **consumer Kling account's MCP** from a SaaS backend is
**AMBIGUOUS / PRODUCT-LAUNCH REVIEW REQUIRED** (ToS §3.1(h) automation, §2.5(c) account sharing;
third-party/OAuth/MCP use not addressed). This does **not** block the transport/capability
infrastructure or a future owner-only controlled proof, and **no commercial/public launch clearance
is claimed**.

## 19. Execution mode and Content Studio Credits

`user_byok` remains the active execution-mode vocabulary; **no global rename**. MCP shows the
semantic concept is broader — *user-owned execution* (an external account the user controls pays) —
than literally "bring your own key". The rename is deferred to the Browser Bridge research /
architecture review. `content_studio_credits` is untouched and **not selectable, not implemented, not
a fallback**: no wallet, balance, plans, pricing, ledger, Stripe; the video routing code contains no
reference to it or to platform credentials (source-scan guard), and clients that send an execution
mode/credential source are rejected. No exact price estimates are shown.

## 20. Security review checklist (independent diff review)

Connection ownership (server-resolved, ownership-scoped) · capability trust boundary (server-held
snapshot; browser echo never trusted; mapping hints stripped) · scope authorization
(`generation.create` required server-side) · transport selection (from the resolved connection) · OAuth
token secrecy (encrypted at rest, never in responses/logs/`request_config`) · polling without a user
session (secret-authenticated, fail-closed; owner-scoped grant lookup) · service-role usage (allow-list
scan test) · internal cron authentication · completion idempotency (DB CAS + deterministic key) · S3 /
result-URL safety (https + public host; URL never persisted) · Content Studio Credits fallback
impossibility (scan test).

## 21. No-spend implementation boundary

During implementation and smoke: **0** real MCP generation calls, **0** real REST generation calls,
**0** Kling credits spent. The MCP generation client is only ever exercised with an injected fake in
tests; the only live provider interaction was the same read-only `who_am_i` used by the connection
check (capability evidence, no generation tool).

## 22. Files

`lib/video-generation/{capabilities,rest-capabilities,connection-ref,connections,request,form-selection,transport,completion,polling}.ts` ·
`lib/provider-connections/{kling-mcp-video-capabilities,kling-mcp-task,kling-mcp-generation}.ts` (+ edits) ·
`app/api/video-generations/{route,connections/route,[id]/sync/route}.ts` ·
`app/api/internal/video-generations/poll/route.ts` · `app/api/kling/callback/route.ts` ·
`app/api/provider-connections/{kling/mcp/connect,[id]}/route.ts` ·
`components/videos/create-video-generation-dialog.tsx` · `components/settings/kling-mcp-connection-card.tsx` ·
`scripts/042_video_generation_transport_provenance.sql` · `vercel.json`.
