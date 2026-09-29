# Kling MCP — Connection and Transport Discovery V1

`KLING_MCP_CONNECTION_AND_TRANSPORT_DISCOVERY_V1`

Discovery date: **2026-09-28/29**. Baseline: `origin/main` = `bde1165e32d09b0ef013919947965d2a2e440ae1`.

**Status: research + audit + a free, unauthenticated spike. No product code was changed.
Kling MCP is NOT implemented in Content Studio.** No generation of any kind was
submitted; real provider calls that could cost money = **0**.

Evidence labels used throughout:

| Label | Meaning |
|---|---|
| **OFFICIAL** | Stated on an official Kling page (`kling.ai/app/mcp`, `kling.ai/app/mcp/guide`, Kling API docs) or the official MCP specification / SDK docs |
| **OBSERVED** | I saw it happen against the real server or SDK during this task |
| **INFERENCE** | Reasoned from the above; not directly stated or observed |
| **UNKNOWN** | Not determinable without something I was not authorized to do |

---

## 1. Executive summary

- Kling has an **official remote MCP server** at `https://kling.ai/mcp` (OFFICIAL, OBSERVED).
- It authenticates with **per-user OAuth** ("sign in with your Kling account"). **No API key is
  used or needed** (OFFICIAL). This is a *different account/billing universe* from the REST API.
- It bills the user's **Kling web-app credits** (Personal workspace), **not** REST API resource
  packages (OFFICIAL for "same credit system as the Kling web app"; INFERENCE for "therefore not
  resource-package units"; exact per-generation cost UNKNOWN — requires an account test).
- It exposes Text→Video and Image→Video, including **Kling 3.0** (`kling-video-v3_0`), plus image
  generation, elements, motion control and account tools (OBSERVED).
- It is **asynchronous and poll-only**: a generation tool returns a `generation_id`; you poll
  `query_tasks`. **There is no callback and no way to pass our own correlation id** (OFFICIAL,
  OBSERVED from the tool schema). Result URLs **expire after 24 hours** (OFFICIAL).
- **Content Studio cannot complete an MCP generation today**: nothing in the app polls, and there
  is no cron/queue. Completion is callback-only for REST. This, not the MCP protocol, is the
  largest gap.
- OAuth means MCP needs a **real connection + token-lifecycle model** that `user_settings` cannot
  safely represent. That is a prerequisite for implementation, not something to build now.
- Recommendation: **USEFUL AS OPTIONAL CONNECTION**; implement as an **experimental optional
  alternative**, keep **REST primary**, and run a **free OAuth spike (read-only scopes)** before
  any paid test. See §17.

---

## 2. Official Kling MCP facts

### 2.1 Endpoint, transport, protocol

| Question | Answer | Label |
|---|---|---|
| Official remote MCP server? | Yes. "Please help me setup a new custom MCP server via the following endpoint … `https://kling.ai/mcp`" | OFFICIAL |
| Endpoint | `https://kling.ai/mcp` | OFFICIAL, OBSERVED |
| Client setup | Cursor: `"klingai": {"url": "https://kling.ai/mcp"}`; Claude: Customize → Connectors → custom connector, same URL; "Sign in with your Kling account" | OFFICIAL |
| Transport | **Streamable HTTP** (single `/mcp` URL; `POST` is challenged with `401`; the SDK's Streamable HTTP client reaches and is challenged by it) | **INFERENCE (high)** — not confirmed by an authenticated response. The metadata `resource_name` is `"Spring MCP Resource Server"`, consistent with a Spring-based server whose default Streamable HTTP path is `/mcp` |
| Legacy HTTP+SSE? | Not indicated. `GET /mcp` with `Accept: text/event-stream` is also `401` | INFERENCE |
| Server implementation version | `mcpVersion: "1.3.3"` returned by `who_am_i` (this is Kling's server version, **not** an MCP spec revision) | OBSERVED |
| **MCP spec revision the server speaks** | Not determinable without an authenticated `initialize` / `server/discover` | **UNKNOWN** |
| Server-side CLI alternative | Kling also ships a CLI (`npm i -g @klingai/cli-global`, `npx skills add klingai-tech/skills`) that uses the same OAuth | OFFICIAL |

The official landing page says MCP and CLI both exist and that "we recommend installing the CLI for
the best experience" for compatibility/stability. Kling's guide also says: "For a given AI
assistant, install either MCP or CLI, but not both." Both are designed for **AI assistants**, not
for a SaaS backend — see the terms question in §9.

### 2.2 Authentication (OBSERVED via public discovery metadata + SDK)

Unauthenticated `POST https://kling.ai/mcp` returns:

```
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer resource_metadata=https://kling.ai/.well-known/oauth-protected-resource/mcp
```

This is the MCP OAuth discovery pattern. The protected-resource metadata:

```json
{ "resource": "https://kling.ai/mcp",
  "authorization_servers": ["https://kling.ai/auth"],
  "scopes_supported": ["generation.create", "generation.read", "account.credit.read"],
  "bearer_methods_supported": ["header"] }
```

The authorization-server metadata (`https://kling.ai/.well-known/oauth-authorization-server/auth`):

| Field | Value |
|---|---|
| authorize / token / register / revoke | `https://kling.ai/auth/{authorize,token,register,revoke}` |
| Grant types | `authorization_code`, `refresh_token` |
| PKCE | `S256` |
| Client authentication | `token_endpoint_auth_methods_supported: ["none"]` → **public clients** (no client secret) |
| Client registration | **Dynamic Client Registration (RFC 7591)** via `/auth/register`. `client_id_metadata_document_supported` is **absent** |
| Scopes | `generation.create`, `generation.read`, `account.credit.read` |
| ID token / JWKS | RS256, `https://kling.ai/auth/.well-known/jwks.json` |

Implications:

- **Auth = OAuth 2.x Authorization Code + PKCE, per user.** Not an API key, not a static bearer token,
  not access-key/secret JWT signing.
- **User-owned: yes.** Each Content Studio user would authorize their **own** Kling account; two
  users are independent. `who_am_i` returns the identity "from access token subject" (OBSERVED).
- The 2026-07-28 MCP spec **deprecates** DCR in favor of Client ID Metadata Documents, but keeps it
  "available for backwards compatibility with authorization servers that do not support" CIMD.
  Kling supports **only** DCR, so DCR is the path.
- Whether Kling's DCR accepts an arbitrary `https://content.multihuman.com.br/...` redirect URI is
  **UNKNOWN**. I deliberately did **not** call `/register` (it would create a client record on
  Kling's side) and did **not** start an authorization (it would grant a token on the user's
  personal Kling account).
- Refresh-token rotation, token lifetimes and revocation behavior are **UNKNOWN**.

### 2.3 Tools (OFFICIAL guide table + OBSERVED tool schemas)

Kling's guide lists 16 tools. The connector in this environment exposed **17** (it also has
`feedback`), and `who_am_i` mentions an `omni_ref_video` generation tool that was not in the
visible list, then returned "The MCP tool list has been updated. New tools are available." So the
tool list is **dynamic and drifts** relative to the documentation.

| Category | Tools |
|---|---|
| Capability discovery | `who_am_i` — identity **plus available models and per-model argument specs** |
| Video generation | `text_to_video`, `image_to_video`, `motion_control` (and `omni_ref_video`, per `who_am_i`) |
| Image generation | `text_to_image`, `image_to_image` |
| Assets / elements | `element_create/list/get/update/delete`, `motion_library_list` |
| Task retrieval | `query_tasks` (by `generation_id`) |
| Upload | `file_upload` (returns a one-time upload ticket; the client uploads the bytes) |
| Account / billing | `query_membership_and_credits`, `logout` |
| Other | `feedback` |

### 2.4 Models exposed (OBSERVED, `who_am_i`)

- `text_to_video` default `kling-video-v3_0_omni`; models: `kling-video-v2_5`, `kling-video-v2_6`,
  `kling-video-o1`, `kling-video-v3_0_omni`, **`kling-video-v3_0`**, `kling-video-v3_0_turbo`.
- `image_to_video` default `kling-video-v3_0`; same model set.
- **Kling 3.0 is exposed** (`kling-video-v3_0`).
- The tool descriptions state that allowed values and defaults **vary by membership tier** (e.g.
  "4k for members"). Capability is therefore **account-specific**, not static.

### 2.5 Settings parity with our REST integration (OBSERVED, `kling-video-v3_0`)

| Content Studio / REST concept | MCP argument | Notes |
|---|---|---|
| `duration` (we allow 5 or 10) | `duration` | MCP allows **3–15** for v3.0; our subset is valid |
| `resolution` (`720p`/`1080p`) | `resolution` | MCP also offers `4k` (members). **MCP default is `1080p`**; our REST default is `720p` |
| `aspect_ratio` (T2V only) | `aspect_ratio` (T2V only) | `16:9`, `9:16`, `1:1`. I2V has **no** aspect-ratio argument — matches our REST rule |
| `audio` (`off`/`on`) | `enable_audio` | **MCP default is `true`; ours is `off`** |
| `multi_shot` | `prefer_multi_shots` | **MCP default for v3.0 is `true`; ours is `false`** |
| source image | input `first_image` (URL) | Must be a `file_upload` URL or a **publicly accessible external URL**; PNG/JPG, <4K, ≤30 MB, aspect ratio no wider than 1:2. Optional `tail_image` |
| — | `imageCount` (1–4) | **One call can produce up to 4 videos.** Our `VideoGeneration` is 1:1 with a video, so this must be pinned to `1` |
| — | `elements` (max 3 for v3.0) | Not used by us today |
| `callback_url` | **none** | No callback argument exists |
| `external_task_id` (we pass our generation UUID) | **none** | No client correlation id exists |

Consequence: a naive mapping that omits arguments would silently spend more (1080p, audio on,
multi-shot on). A future mapper must send **every** relevant argument explicitly.

### 2.6 Async model (OFFICIAL + OBSERVED)

- Generation tools "Return a `generation_id` immediately; poll `query_tasks` for status and the final
  video URL." (tool descriptions and guide).
- **No callbacks, no notifications** are documented; polling is required.
- `query_tasks` returns status and final URLs (`works[].url`, per the CLI table). Result URLs are
  valid **24 hours** (OFFICIAL). Tasks **cannot be canceled** once submitted (OFFICIAL).
- The **raw state vocabulary** of `query_tasks` is **UNKNOWN** (I had no task to query). An unknown id
  returns the plain tool error `Invalid generationId.` (OBSERVED).
- The tool text documents these error classes for `query_tasks`: content-moderation block,
  **insufficient credits ("Account inspiration credits are insufficient")**, model does not support
  the parameter combination, task timeout, service error, parameter error.
- Provider task identity = `generation_id`. It is a different id space from REST `task_id`;
  whether the formats can collide is **UNKNOWN**.
- Other limits (OFFICIAL): **5 QPS**; non-subscribers: **one concurrent video task**; subscribers
  not limited.

---

## 3. Billing and account findings (the critical question)

**OFFICIAL statements** (Kling MCP page FAQ and guide FAQ):

> "Kling MCP and CLI share the same credit system as the Kling web app. Credits are consumed based
> on the model, generation duration, and output resolution. Your existing subscription benefits and
> credits are available across all supported clients."
>
> "MCP and CLI use the same credit pricing and consumption rules as Kling AI official platforms.
> However, off-peak free generation is not available through AI assistants."
>
> "MCP and CLI currently support only paid credits from your Personal workspace. Team workspace
> benefits are currently not available."
>
> "Bonus credits are valid on official Kling AI platforms only and cannot currently be used with MCP
> or CLI."
>
> "Do I need an API key? No. … sign in with your Kling account using OAuth. No API keys are required."

**OBSERVED**: `query_membership_and_credits` (scope `account.credit.read`) returned a membership
tier and an available-credit balance for the OAuth identity — i.e. consumer-account credits
(the account used in this environment is a paid "Pro"/SVIP consumer membership with a large
positive balance; the exact figures are intentionally omitted from this repo document).

**Classification**

| Question | Answer | Confidence |
|---|---|---|
| Does MCP consume consumer web-app credits? | **Yes** (Personal workspace, paid credits only) | **OFFICIAL — confirmed** |
| Does it consume REST API resource-package units? | Almost certainly **no**: MCP needs no API key, the API is a separate "Developer Platform" with prepaid resource packages, and the credit tools report web-app credits | **INFERENCE (high)** — never stated verbatim |
| Separate MCP-specific quota? | Not indicated (only rate limits) | INFERENCE |
| Exact credits charged per generation | Not published in the MCP docs | **UNKNOWN — REQUIRES ACCOUNT TEST** |
| Are failed/moderated generations refunded? | Not stated | **UNKNOWN — REQUIRES ACCOUNT TEST** |
| Is MCP credit deduction equal to web-app price? | Stated ("same credit pricing and consumption rules") but unverified | OFFICIAL, unverified |

**Consumer account vs API account.** They remain operationally separate for MCP:

- A Kling **consumer subscriber can use MCP without an API resource package and without an API key**
  (OFFICIAL).
- MCP does **not** appear to use the developer-platform resource package (INFERENCE).
- MCP does **not** require a developer account (OFFICIAL: no API key).
- Whether the same person's consumer account and developer-platform account are **linked** in any
  way: not stated anywhere → **UNKNOWN**. Nothing suggests explicit linkage.

For contrast, the REST API is billed through prepaid **resource packages** on the developer
platform (`kling.ai/dev/pricing`, OFFICIAL). Our current Production REST flow uses that.

**What this means for the vocabulary.** With MCP the user pays with their own Kling account, so
`user_byok` ("the user's own provider account pays") remains semantically correct as an
**execution mode**; only the literal word "key" is narrow. See §10.

### 3.1 Important product/legal unknowns

- **UNKNOWN — Kling's terms for automated third-party backends.** The guide frames MCP/CLI for
  "general-purpose AI assistants (such as Cursor, Claude)". Content Studio is a SaaS that would call
  the MCP server programmatically on users' behalf. Nothing found prohibits this, but nothing
  authorizes it either. **Resolve with Kling (terms review or written confirmation) before any
  production implementation.**
- **Data flow**: "Generated assets … are automatically synced to your asset library on the Kling web
  app." Every MCP generation would appear in the user's own Kling web library. This is a
  user-visible side effect and a privacy consideration to disclose in the connection UX.

---

## 4. Repository audit (origin/main `bde1165`)

### 4.1 The real REST call chain (verified in code)

```
/videos  (app/(dashboard)/videos/page.tsx → CreateVideoGenerationDialog)
 → POST /api/video-generations                    app/api/video-generations/route.ts
    → supabase.auth.getUser()
    → resolveProviderExecution(supabase,{userId,provider:'kling'})   mode fixed = user_byok
        → not ready → 422 PROVIDER_NOT_CONFIGURED (no DB row, no Kling call)
    → resolve source image / library file (presigned S3 URL)
    → INSERT video_generations (status 'queued', provider 'kling', model 'kling-v3', request_config)
    → new KlingAdapter(apiKey)                    lib/providers/kling/adapter.ts
        → POST https://api-singapore.klingai.com/{image|text}-to-video/kling-3.0
           body { contents|prompt, settings, options:{ external_task_id = generation.id,
                                                       callback_url = /api/kling/callback } }
    → UPDATE status 'submitted', task_id = <REST task id>, provider_metadata = {task_id}

Kling → POST /api/kling/callback                  app/api/kling/callback/route.ts
    → verify HMAC (KLING_WEBHOOK_SECRET, timing-safe, ±5 min)
    → service-role client; find row by task_id
    → succeeded: outputs[type=video].url → downloadAndStoreVideo → app-owned S3 → UPDATE
    → failed: UPDATE error_details

/videos → GET /api/video-generations (presigns storage_path) → in-app playback dialog
```

Also `POST /api/video-generations/[id]/sync` (polls `KlingAdapter.getTaskStatus`, same
download-and-store completion) — see the finding below: **it has no caller.**

### 4.2 Transport-coupling audit

| # | Finding | Class |
|---|---|---|
| 1 | **Completion is callback-only in practice.** Nothing in `app/`, `components/` or `lib/` calls `/sync` (only tests do); `/videos` does not poll; there is no `vercel.json`/cron/queue/workflow. A transport with no callback (MCP) has **no completion path** | **MUST BE ADDRESSED BEFORE MCP** |
| 2 | **24h result-URL expiry + no server-driven completion.** If a user does not return within 24h, an MCP result URL expires unclaimed. REST callbacks avoid this. A server-side poller is required for reliability | **MUST BE ADDRESSED BEFORE MCP** |
| 3 | **Credential result is a single string.** `resolveProviderExecution`/`resolveProviderCredential` read one column and return `secret: string`. OAuth needs access token + expiry + refresh + rotation + revoke | **MUST BE ADDRESSED BEFORE MCP** |
| 4 | **Secret storage shape.** One column per provider on `user_settings`; RLS lets the **user's own browser session `SELECT` any column** (the app just never selects secrets). Acceptable-ish for an API key the user typed; materially worse for OAuth refresh tokens | **MUST BE ADDRESSED BEFORE MCP** (choose a connection/secret store) |
| 5 | **Completion logic duplicated** in the callback route (service role) and the sync route (user client): `status`/`outputs[]`/`id` shapes, `downloadAndStoreVideo`, `UPDATE`. MCP would be a third copy | BOUNDED COUPLING (extract once when adding MCP) |
| 6 | **`KlingAdapter` mixes REST transport and Kling domain mapping** (base URL, headers, payload shaping, response shape in one class); `getTaskStatus` returns the raw REST `KlingTaskItem` | BOUNDED COUPLING |
| 7 | **`POST /api/video-generations` constructs `KlingAdapter` directly** and assumes REST semantics: `external_task_id = generation.id`, `callback_url`, `provider_metadata = {task_id}` | BOUNDED COUPLING |
| 8 | **Correlation by `external_task_id`** is REST-only. MCP has no such argument; correlation must use the returned `generation_id` stored in `task_id` | BOUNDED COUPLING |
| 9 | **`task_id TEXT UNIQUE`** is one namespace. REST and MCP ids are separate id spaces (collision unknowable) | BOUNDED COUPLING |
| 10 | **Sync/reconcile cannot know which transport/account submitted a generation.** Polling MCP must use the *same user's* connection | BOUNDED COUPLING (needs `transport`/`connection_id` at MCP time) |
| 11 | **`video_generations.status` CHECK** (`queued/submitted/processing/succeeded/failed`) is transport-neutral | NO ISSUE |
| 12 | **`mode` CHECK** (`image_to_video`, `text_to_video`) is transport-neutral and matches MCP's two tools | NO ISSUE |
| 13 | **`PROVIDER_METADATA`** says `kling.connectionMethods=['api_key']`, `transports=['rest']` at provider granularity, not per connection | BOUNDED COUPLING (fine until a second connection exists) |
| 14 | **`ProviderExecutionMode` vs transport** are independent types in `provider-execution.ts` | NO ISSUE |
| 15 | **Result persistence**: `downloadAndStoreVideo(url, prefix)` is URL-in / S3-out and transport-agnostic | NO ISSUE |
| 16 | **Playback** reads `storage_path` via presigned URL and never touches the provider | NO ISSUE |
| 17 | **Settings** is one API-key card per provider (`AiProviderCredentialCard`) | BOUNDED COUPLING (target is "AI Connections") |
| 18 | **`request_config` / metadata** hold no secrets (tested) | NO ISSUE |

Where transport is currently **implicit**: the route → adapter construction (#7), the adapter's
response shape leaking into the sync and callback routes (#5, #6), `task_id` semantics (#8, #9), and
per-provider (not per-connection) metadata (#13). Nothing is *wrong* today — there is one transport
— but #1–#4 must be resolved before MCP can work at all.

---

## 5. Connection model

### 5.1 Do we need a `ProviderConnection`?

| | Answer |
|---|---|
| Needed **now** (this task)? | **No.** No code change is required and none was made |
| Needed **before implementing Kling MCP**? | **Yes** |
| Can `user_settings` represent an MCP connection **safely**? | **No** (technically possible, not safely — see below) |

Why `user_settings` is not adequate for MCP OAuth:

1. It is a flat, one-column-per-provider secret bag. REST already occupies `kling_api_key`; an MCP
   connection needs a *different set* of fields (access token, refresh token, expiry, scopes,
   issuer, client id) — a second block of Kling-specific columns, repeated for every future OAuth
   provider.
2. **RLS allows the user's own browser session to `SELECT` every column.** The application never does,
   but any script running in the user's session could. A leaked API key is bad; a leaked OAuth
   refresh token for a **public client** (no client secret) grants ongoing `generation.create`
   against the user's paid credits.
3. Token refresh **writes** to the row concurrently from parallel serverless invocations; that needs
   row-level locking or optimistic versioning, which a preferences row is the wrong home for.
4. A user may hold **both** a REST and an MCP connection to the same provider (one provider +
   multiple transports + multiple auth types) — exactly the case a per-provider column cannot express.

### 5.2 Smallest justified shape (proposal — nothing implemented)

Do **not** build a universal integration platform. Add one small pair when MCP is implemented:

```
provider_connections                      -- non-secret, RLS: owner can read
  id, user_id, provider, connection_method ('api_key' | 'oauth_mcp'),
  status, external_account_ref (nullable, non-secret), scopes[],
  capabilities_snapshot (jsonb, non-secret, optional), last_checked_at, created_at, updated_at

provider_connection_secrets               -- secrets: NO client policies (deny by default);
  connection_id, ...tokens, expiry, issuer, client_id       reachable only with the service role
```

- The existing REST key **stays in `user_settings.kling_api_key`**. No migration of real credentials.
  `resolveProviderExecution` gains a transport/connection selector; the REST path is unchanged.
- Application-level encryption at rest (still deferred) becomes considerably more compelling for
  refresh tokens; decide it in that design, not here.
- The Kling OAuth **client registration** (DCR) is per-application, not per-user: store it once,
  keyed by issuer (MCP spec: clients MUST key persisted credentials by issuer and MUST NOT reuse
  them with another authorization server).

### 5.3 Connection states (only what actual requirements need)

`not_configured` · `connected` · `authorization_required` · `error`

- `connecting` is a transient UI state during the OAuth redirect (backed by a short-lived server-side
  `state`/PKCE record), not a persisted state.
- `expired` and `revoked` collapse into `authorization_required` (the only remedy is re-authorizing).
- `disabled` is a user "pause" with no requirement behind it yet — omitted deliberately.

### 5.4 Naming: `user_byok` vs `user_connection`

`user_byok` answers **who pays**. With MCP the user still pays with their own Kling account, so it
stays correct as an execution mode. Only the mnemonic "key" is narrow. **Do not rename in
production now.** If a second non-key connection type ships, consider `user_connection`, in the same
change and with a data-compatible alias, not casually.

### 5.5 Execution mode × transport

They stay independent. Valid today: `user_byok`+REST. Candidate: `user_byok`+MCP (needs the
connection model). `content_studio_credits`+MCP is **not** possible in any obvious way: MCP is
authorized per *user* Kling account and bills that user's Kling credits, so a Content Studio-funded
MCP path would need a platform-owned Kling consumer account acting for many users — a terms and
identity question, not a technical default. Capability/authorization must decide validity, never the
type system alone.

---

## 6. Proposed transport boundary

Recommendation: **keep the REST path exactly as is** and introduce the seam only when MCP is
implemented, in three small steps (none needed today):

1. **Extract one completion function** — `completeVideoGeneration(generationId, providerResultUrl,
   providerMetadata)` doing download → app-owned S3 → `UPDATE` — and call it from the callback route,
   the sync route and (later) the MCP poller. It removes the current duplication (#5).
2. **Normalize task status** — `NormalizedTaskStatus = { status: 'processing'|'succeeded'|'failed',
   resultUrl?, errorCode?, providerMessage? }`. Each transport maps its raw states into it. **No new
   user-facing statuses.**
3. **A narrow transport interface** behind `resolveProviderExecution`'s result:

```ts
interface KlingVideoTransport {
  submit(op: 'text_to_video' | 'image_to_video', req: NormalizedVideoRequest, ctx: { generationId: string }):
    Promise<{ providerTaskId: string }>
  getStatus(providerTaskId: string): Promise<NormalizedTaskStatus>
}
// implementations: KlingRestTransport (wraps today's KlingAdapter), KlingMcpTransport (official SDK)
```

Why this and not the alternatives: **per-transport argument mapping is unavoidable** (REST and MCP
argument names/defaults genuinely differ, §2.5), so it belongs inside each transport. What must be
shared is the *normalized request*, the *normalized status* and the *completion step* — and those
are exactly what §4 shows is duplicated or implicit today. A `KlingProvider` superclass or a
universal "creative operation" schema would add abstraction without removing a real duplicate.

**Capability discovery.** `who_am_i` is genuinely useful: it returns account-specific allowed values
(e.g. 4k only for members) and per-model argument specs. Use it to (a) validate a connection at
connect time, (b) gate UI options (e.g. hide 4k), and (c) snapshot capabilities for support. But
**do not** make MCP tool names or argument names the product domain: the tool list drifted during
this very session and the docs lag the server. Keep our vocabulary (`text_to_video`,
`image_to_video`) and map to tools inside the transport; treat `who_am_i` output as a
cache-with-TTL that is re-validated, not a schema.

---

## 7. Lifecycle mapping

Existing statuses are kept: `queued → submitted → processing → succeeded | failed`.

| Moment | REST today | MCP (proposed mapping) |
|---|---|---|
| Row created | `queued` | `queued` |
| Provider accepted | `submitted` (REST task id) | `submitted` (`generation_id` stored in `task_id`) |
| In progress | `processing` (callback/poll) | `processing` (poll `query_tasks`; raw states **UNKNOWN**) |
| Success | callback `outputs[type=video].url` | poll result `works[].url` present → `succeeded` |
| Failure | callback `failed` | tool/poll error → `failed` with a normalized `error_details.code` |

Correlation: REST correlates by `external_task_id`/callback; MCP has no such field, so correlate
only via the returned `generation_id` persisted **before** returning to the caller (atomically with
the `submitted` transition, exactly as REST does with `task_id`).

Result persistence rule (unchanged): the provider URL is **temporary metadata**, never durable
media. MCP's 24-hour URL makes prompt download **more** urgent than for REST. If MCP ever returned
bytes, they would go straight to app-owned S3; `file_upload` is the input direction only.

---

## 8. Vercel / serverless constraints

| Question | Finding | Label |
|---|---|---|
| Can the MCP connection be short-lived per request? | **Yes.** A generation tool returns a handle immediately, and status is a *separate* tool call by that handle | INFERENCE (from the tool design) |
| Durable session required? | The **2026-07-28 spec removes protocol sessions and the `initialize` handshake** (stateless MCP, `server/discover`). Older spec revisions make `Mcp-Session-Id` optional and server-chosen. Which the Kling server uses is **UNKNOWN**; an `initialize` round-trip per invocation is the worst case | OFFICIAL (spec) / UNKNOWN (server) |
| Resumable streams? | 2026-07-28 removes SSE resumability: a broken stream loses the in-flight request and must be re-issued. Irrelevant for immediate-return tools; do **not** rely on it | OFFICIAL |
| Must a connection stay open while a video renders? | **No** — only if a tool streamed progress, which Kling's do not document | INFERENCE |
| Does status retrieval need the same session? | Almost certainly not (server-minted handle); confirm in the spike | UNKNOWN |
| Callbacks independent of the client? | **Not available** for Kling MCP | OFFICIAL |
| Timeouts | Each call is short; the risk is not timeouts but the **absence of a server-driven completion loop** | INFERENCE |

**The architectural constraint is the poller, not the protocol.** Because MCP is poll-only and the
URL lives 24 hours, a reliable implementation needs a server-driven reconciliation loop (a
scheduled job/queue/workflow, e.g. Vercel Cron or Workflow — none exists in this repo; verify plan
limits before choosing) that can refresh an expired access token using a stored refresh token
without the user present. A user-driven poll from an open `/videos` tab is an acceptable *first*
step but loses videos if the user leaves. **No worker/service is introduced by this task.**

**SDK choice (OFFICIAL + OBSERVED).** The official TypeScript SDK now has two lines:
`@modelcontextprotocol/client` **2.2.0** ("v2 is the stable release line, released alongside the
2026-07-28 spec"; use v2 for new client code) and `@modelcontextprotocol/sdk` **1.31.0** (v1.x gets
bug/security fixes for at least six months after v2). The v2 client exports
`StreamableHTTPClientTransport` (and a legacy `SSEClientTransport`), `UnauthorizedError`, and a full
OAuth toolkit: `discoverOAuthServerInfo`, `registerClient`, `startAuthorization`,
`exchangeAuthorization`, `refreshAuthorization`, `extractWWWAuthenticateParams`,
`validateAuthorizationResponseIssuer`, `withOAuth`. Runtime notes: Node **≥ 20** (Vercel runs Node
24 — fine), installed footprint ≈ 17 MB, and it depends on **zod ^4.2** while this repo is on zod 3
(the package brings its own; do not pass its schemas into app-zod code). **Do not write a custom MCP
client.**

---

## 9. REST vs MCP for Content Studio

| Dimension | Kling REST (today) | Kling MCP | Edge |
|---|---|---|---|
| Setup friction | Buy developer resource package, create access/secret keys, paste key | Sign in with Kling account (OAuth) | **MCP** |
| Authentication | Static API key (`Bearer`) | Per-user OAuth + PKCE, DCR, refresh | REST simpler; MCP more "account-native" |
| Billing | Prepaid **API resource packages** | **Web-app credits** (Personal workspace); bonus credits and off-peak free excluded | Depends on the user; **MCP** lowers entry cost for existing subscribers |
| Billing clarity | Units in the developer console | Documented as web-app credits; per-call cost **UNKNOWN** | REST |
| Capability coverage | Our integration: T2V, I2V, a subset of options | T2V, I2V **plus** T2I, I2I, motion control, elements, `tail_image`, 4K, 3–15 s, more models | **MCP** |
| Model access | Kling 3.0 via `/kling-3.0` | v2.5, v2.6, o1, v3.0, v3.0 omni, v3.0 turbo | **MCP** |
| Capability discovery | Static docs | `who_am_i` per account/tier | **MCP** |
| Asynchronous execution | Task id + **callback** (+ poll) | Handle + **poll only** | **REST** |
| Result retrieval | URL in callback/poll | URL in poll, **24h** | REST (durable via callback) |
| Correlation with our id | `external_task_id` round-trips | **none** | **REST** |
| Cancellation | (not implemented by us) | Not possible | Tie |
| Concurrency/limits | Package/rate limits | 5 QPS; **1 concurrent video task** for non-subscribers | REST/neutral |
| Error visibility | HTTP errors with code/request_id | Tool error text; moderation/credits classes documented | Neutral |
| Serverless fit | Simple `fetch` | Stateless-friendly; needs OAuth lifecycle + poller | **REST** |
| Maintenance / contract stability | Versioned REST API | Server v1.3.3, **tool list drifts**, docs lag | **REST** |
| Multi-user isolation | Per-user key | Per-user OAuth identity | Tie |
| Terms fit for a SaaS backend | Designed for developers | Designed for AI assistants; **UNKNOWN** | **REST** |
| Data side effects | None on the user's Kling account | Assets sync into the user's Kling web library | REST |

**Classification: 2 — USEFUL AS OPTIONAL CONNECTION.** Not "strongly useful": the wins (lower entry
cost, broader models/options, capability discovery) are real but conditional, and it is currently
*worse* on the properties that make the REST pipeline reliable (server-driven completion,
correlation, durable results, terms clarity). It is not "unsuitable": nothing found is a hard
blocker.

---

## 10. Settings / AI Connections implications

The redesign is **not** implemented here. To support Kling MCP the future "AI Connections" UI must
collect/show (never secrets):

| Field | Notes |
|---|---|
| Platform / provider | Kling |
| Connection method | `API key (REST)` or `Kling account (MCP / OAuth)` |
| Connection status | `not_configured` · `connected` · `authorization_required` · `error` |
| Account identity | A non-secret display reference if the provider exposes one (the numeric user id is the only thing observed — treat as sensitive) |
| Authorization status | Scopes granted; when authorized |
| Capabilities | From `who_am_i`: models, max resolution, 4K availability |
| Actions | **Connect** (redirect), **Reconnect**, **Disconnect** (calls the revocation endpoint), **Check now** |
| Last checked | Timestamp of the last successful capability probe |
| Disclosures | Bills your Kling web credits (Personal workspace only; bonus credits excluded); one concurrent video for non-subscribers; results also appear in your Kling web library |

The connect flow is a redirect, not a text field. It needs a callback route, a short-lived
`state`/PKCE record, `iss` validation (the 2026-07-28 spec requires validating a present `iss`), and
`resource=https://kling.ai/mcp` on the authorization request.

---

## 11. Security, errors, logging

### 11.1 Secrets and OAuth

- **Never** place OAuth tokens in generic JSON, `user_settings`, `request_config`, logs, URLs or
  client-visible responses. The design in §5.2 keeps tokens in a server-only store.
- **Least privilege scopes**: request `generation.create generation.read account.credit.read` only
  when generating; a "check connection" flow could request only the read scopes.
- **Public client**: `token_endpoint_auth_method: none` means there is no client secret; the refresh
  token is the sole long-lived secret → protect it strongly (service-role-only table; encryption at
  rest recommended for this data class).
- Bind persisted client credentials to the issuer; re-register if it changes.
- Disconnect must call the **revocation endpoint** and delete the local secrets.
- Do **not** copy a browser-local session into server storage.

### 11.2 Error mapping (controlled, server-side)

| MCP / provider condition | Content Studio result |
|---|---|
| 401 / token invalid, refresh fails | connection → `authorization_required`; generation `failed` with `PROVIDER_AUTHORIZATION_REQUIRED` |
| Connection unavailable / network | `failed` with `PROVIDER_UNAVAILABLE` (retryable) |
| Tool missing / not in `who_am_i` | `PROVIDER_CAPABILITY_UNAVAILABLE` |
| Invalid tool arguments | `PROVIDER_REQUEST_INVALID` (our bug; log tool + arg *names* only) |
| Task rejected (moderation) | `failed` with `PROVIDER_CONTENT_REJECTED` |
| Insufficient credits | `failed` with `PROVIDER_QUOTA_EXHAUSTED` |
| Rate limited / concurrency cap | `PROVIDER_RATE_LIMITED` (retryable) |
| Unknown `generation_id` / stale | `PROVIDER_TASK_NOT_FOUND` |

Never forward raw headers, tokens, stack traces or unparsed provider payloads to the client.

### 11.3 Logging

Useful: `provider`, `transport`, `connection_id`, `tool_name`, `provider_task_id`, `generation_id`,
`duration_ms`, `normalized_status`, `safe_error_code`.
Forbidden: API keys, OAuth access/refresh tokens, `Authorization`/`Cookie` headers, authorization
codes, PKCE verifiers, request bodies containing signed URLs.

---

## 12. Provenance

`video_generations` already stores `provider` and `model`. **Recommendation: persist `transport`
(`'rest' | 'mcp'`) and a nullable `connection_id` — but only in the same change that adds MCP.**
Reason it becomes genuinely necessary (not merely nice): status reconciliation **must** poll the same
transport with the same user's connection that submitted the task, and neither can be inferred from
`task_id` (§4.2 #9–#10). It also serves debugging, support and billing attribution. Today there is
one transport, so a column would be a constant. `execution_mode` provenance rides along (decision
already recorded in the credentials architecture doc). Additive, nullable columns; historical rows
are unambiguously `rest`/`user_byok`.

---

## 13. Future tests (for an MCP implementation)

Transport selection · per-user connection isolation (A cannot use B's connection or tokens) ·
MCP tool/argument mapping incl. **explicit** `resolution`, `enable_audio`, `prefer_multi_shots`,
`imageCount=1` · missing connection · `authorization_required`/expired + refresh · `who_am_i`
capability discovery and gating · normalized request mapping · normalized lifecycle mapping
(raw state → 5 statuses) · `generation_id` ↔ `VideoGeneration` correlation · result download to
app-owned S3 · **no `VideoDraft`, `LibraryFile` or `ChannelPieceMedia` created** · zero secret
leakage (responses, logs, `request_config`, metadata) · poller idempotency (double completion) ·
DCR/OAuth callback validation (`state`, PKCE, `iss`) · **REST regression** (unchanged behavior,
historical generations still readable/playable). All with a mocked MCP client — no live calls.

---

## 14. Proposed future paid account test (NOT executed)

Purpose: determine, once, **which pool MCP debits and by how much**, plus the unknown raw states.

1. **Prerequisites.** Written approval from the account owner; the OAuth authorization done in a
   separate, explicitly approved free spike (below); a Kling consumer membership with a positive
   balance; access to the Kling **web app credit history** and the **developer-platform resource
   package balance** (`kling.ai/dev/usage-billing`).
2. **Before.** Record (a) `query_membership_and_credits` → `availableRemainCredits`; (b) web-app
   credit-history top entry; (c) developer-platform package remaining units. Call `who_am_i` for
   `text_to_video` and freeze the argument spec.
3. **The one generation.** `text_to_video`, model **`kling-video-v3_0`** (parity with our REST model),
   `duration=3`, `resolution=720p`, `aspect_ratio=16:9`, `imageCount=1`, `enable_audio=false`,
   `prefer_multi_shots=false`, a neutral prompt. **Exactly one submission. No retry.**
4. **After.** Poll `query_tasks` until terminal, logging every distinct raw state and timestamp;
   record the result URL host and expiry. Then re-record (a), (b), (c).
5. **Evidence to capture.** Credits delta; whether (c) changed at all (expected: **no**); web-library
   entry created; raw state vocabulary; time to completion; error shape if any; whether the
   `generation_id` format could collide with REST `task_id`s.
6. **Expected maximum cost.** **Not determinable** from official MCP documentation (no price table
   for MCP; it references the web app's pricing). Bound it operationally instead: propose a hard cap
   of **≈500 credits** (roughly 1% of the balance seen in this environment; the account has ample
   headroom) — an arbitrary safety bound, not a prediction.
7. **STOP conditions.** Credit delta > cap; any second submission needed; any moderation/insufficient-
   credit error (do not retry); any unexpected charge to (c); authorization requests broader scopes
   than approved.

**Free spike to run first (recommended next step, needs the owner's consent):** register a client
via DCR with our real callback URL, complete OAuth with **read-only scopes**
(`generation.read account.credit.read`), then via the official SDK: confirm Streamable HTTP, record
the negotiated MCP spec version (`initialize` / `server/discover`), `tools/list`, `who_am_i`,
`query_membership_and_credits`, token TTL, refresh rotation and revocation. Zero generation spend.

---

## 15. Spike record (Phase D)

Performed **without credentials and without spend**, in a scratch directory outside the repo (no
repo code, dependencies or lockfile changed):

1. `curl` unauthenticated `POST`/`GET https://kling.ai/mcp` → `401` +
   `WWW-Authenticate: Bearer resource_metadata=…`.
2. `curl` the public protected-resource and authorization-server metadata (§2.2).
3. Installed the official **`@modelcontextprotocol/client@2.2.0`** and ran a ~40-line script that:
   connects with `StreamableHTTPClientTransport` and **no** credentials (result: the SDK reaches the
   endpoint and reports the HTTP 401 as an `SdkHttpError`), runs `discoverOAuthServerInfo` (returns
   the metadata above), and parses the challenge with `extractWWWAuthenticateParams`.
4. Through the connector already authorized in this environment (the user's own OAuth grant): the
   read-only tools `who_am_i`, `query_membership_and_credits` and `query_tasks` (unknown id, to see
   the error shape). **No generation, upload, element, asset or account mutation tool was called.**

Not done, deliberately: `POST /auth/register` (creates a provider-side client), any authorization
request (grants a token on a personal account), any generation/upload tool. An **authenticated SDK
`tools/list`** was therefore not run: `CREDENTIAL_ACCESS_NOT_AVAILABLE_IN_SAFE_PATH` (the existing
connector's OAuth token belongs to claude.ai and is not, and must not be, extractable). The
connector's own tool listing provided the equivalent schema evidence.

Reproduction (public, no secrets):

```bash
curl -si -X POST https://kling.ai/mcp -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"ping"}'          # 401 + resource_metadata
curl -s https://kling.ai/.well-known/oauth-protected-resource/mcp
curl -s https://kling.ai/.well-known/oauth-authorization-server/auth
```

The scratch script is intentionally **not** committed: it is dead infrastructure once these facts
are recorded.

---

## 16. Reconciliation with earlier documents

`docs/productization/VIDEO_AI_GENERATION_PRODUCT_FLOW_DISCOVERY_V1.md` recorded that "whether MCP
generation uses consumer credits or API resource packages is unknown and requires an account test."
That is now **partly resolved**: Kling officially states MCP shares the **web-app credit system**.
What remains unknown is the exact per-generation cost, refund behavior, and terms fit — the account
test in §14 still applies. Its other conclusions (MCP is a transport, not a provider/model; tokens
need a server-side connection/secret boundary; user-owned first) are confirmed by this discovery.

---

## 17. Final decision

| # | Question | Answer |
|---|---|---|
| 1 | Is Kling MCP official and currently usable? | **Yes** — `https://kling.ai/mcp`, documented on kling.ai (OFFICIAL, OBSERVED) |
| 2 | Authentication | **Per-user OAuth 2.x Authorization Code + PKCE (S256), public client, DCR-only registration, refresh tokens**; no API key |
| 3 | T2V | **Yes** (`text_to_video`) |
| 4 | I2V | **Yes** (`image_to_video`; `first_image` URL, optional `tail_image`) |
| 5 | Models | `kling-video-v2_5`, `v2_6`, `o1`, **`v3_0`**, `v3_0_omni`, `v3_0_turbo` (+ image models) |
| 6 | Relevant settings | duration 3–15, resolution 720p/1080p/4k, aspect ratio (T2V), audio, multi-shot, `imageCount`, image inputs — all present, with **different defaults** than our REST usage |
| 7 | Async task ids? | **Yes** — `generation_id`, returned immediately |
| 8 | Status retrieval | Poll `query_tasks`; **no callbacks**; raw states UNKNOWN |
| 9 | Results | URL(s) in `query_tasks` (`works[].url`), **valid 24 h** |
| 10 | Fits the existing `VideoGeneration` lifecycle? | **Yes, cleanly, after** a poller, a normalized status, a shared completion function and a `generation_id`↔`task_id` correlation; no new statuses or entities |
| 11 | What does MCP bill? | **Kling web-app credits (Personal workspace, paid credits only)** |
| 12 | Confirmed or unknown? | **Confirmed by official documentation** for the pool; "not API resource packages" is a high-confidence **inference**; exact cost/refunds **unknown — needs an account test** |
| 13 | Need a `ProviderConnection` now? | **Not now; required before implementing MCP** |
| 14 | Can `user_settings` hold it safely? | **No** |
| 15 | OAuth/token lifecycle infrastructure? | **Yes** (authorize/callback, PKCE/state, refresh, revoke, issuer-keyed client registration) |
| 16 | Does Vercel/serverless block it? | **No blocker for the client**; the real constraint is the missing server-driven poller (24 h URLs) |
| 17 | Role | **Optional alternative, experimental first; REST stays primary; implementation deferred** until the prerequisites below are met |
| 18 | What MCP offers that REST doesn't | No API package or key (uses the user's existing subscription), more models/options incl. 4K and `tail_image`, per-account capability discovery, image tools |
| 19 | What REST still does better | Callbacks, correlation id, durable server-driven completion, contract stability, unambiguous terms for a backend, no side effects on the user's Kling library |
| 20 | Is a real paid MCP test justified? | **Not yet.** First: (a) terms/automation clarity with Kling, (b) the free read-only OAuth spike. Then one capped test per §14 |

**Prerequisites before implementation:** (1) confirm Kling permits backend/programmatic use of
consumer-credit MCP; (2) free OAuth spike (DCR redirect acceptance, spec version, token/refresh
behavior); (3) design the connection + secret store; (4) design the server-driven poller;
(5) extract the shared completion function; (6) the single capped account test.

## 18. Out of scope (unchanged)

Kling generation over MCP, a connection table/OAuth implementation, Settings redesign, Browser
Bridge, LibraryFile promotion, video evaluation, Content Studio Credits / billing / wallet, any
change to the REST pipeline. `content_studio_credits` remains disabled.
