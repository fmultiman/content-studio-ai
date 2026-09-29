# Kling MCP — OAuth Connection Spike V1

`KLING_MCP_OAUTH_CONNECTION_SPIKE_V1`

Follows [KLING_MCP_CONNECTION_AND_TRANSPORT_DISCOVERY_V1](KLING_MCP_CONNECTION_AND_TRANSPORT_DISCOVERY_V1.md)
(merged in PR #42).

> **Follow-up (status update):** the live OAuth proof below was **completed by the owner in
> Production** (encryption key set, real Kling consent approved, read-only check run): Kling API →
> configured; Kling account → connected, Pro plan, 6 video models reported, scopes
> `generation.read` + `account.credit.read`, live credit read works, `generation.create` **not**
> granted. The spike is therefore complete. The next slices are documented in
> [VIDEO_GENERATION_CONNECTION_CAPABILITY_ROUTING_V1](VIDEO_GENERATION_CONNECTION_CAPABILITY_ROUTING_V1.md)
> (capability routing, MCP transport, polling, explicit scope upgrade — all still without a real MCP
> generation). The statements below describe the spike **as delivered** and are kept as history.

**Scope: an OAuth/connection proof only.** Content Studio can now authorize a user's own Kling
web account through Kling's official MCP OAuth flow, store the resulting tokens securely, refresh
them, and run **read-only** MCP checks. **Kling MCP video generation is NOT implemented.** No
generation tool can be called, no credits are spent, `POST /api/video-generations` and the Kling
REST pipeline are unchanged, and `content_studio_credits` is still gated.

## Status

| Item | State |
|---|---|
| `provider_connections` boundary (safe metadata, RLS) | Implemented; migration `041` applied to Production |
| Encrypted token storage (`provider_connection_secrets`, AES-256-GCM) | Implemented |
| OAuth authorization-code + PKCE **S256** with single-use state | Implemented, tested |
| Token refresh incl. rotation, race safety, revoked → `authorization_required` | Implemented, tested |
| Read-only MCP check (initialize → tools/list → `who_am_i` → `query_membership_and_credits`) | Implemented, tested with a fake MCP client |
| Disconnect + RFC 7009 revocation | Implemented, tested |
| Minimal Settings UI ("Conta Kling") | Implemented |
| **Live OAuth proof against Kling with the owner's account** | **Completed by the owner in Production** (see the follow-up note above; the "Live proof status" section is the original pre-proof record) |
| MCP video transport / polling / `VideoGeneration` changes | Implemented later in `VIDEO_GENERATION_CONNECTION_CAPABILITY_ROUTING_V1` (mock-tested; no real generation) |
| Full generic "AI Connections" redesign | **Not started** (evidence recorded below) |

## Connection model (concepts kept separate)

| Concept | For this connection |
|---|---|
| Provider | `kling` |
| Connection | the user's own Kling account grant |
| Connection method | `mcp_oauth` (OAuth authorization code + PKCE) |
| Transport | MCP over Streamable HTTP |
| Execution funding | the **user's own** Kling web account and credits |
| Execution mode | unchanged: `user_byok` remains the vocabulary; `content_studio_credits` remains gated and unrelated |
| Credential source | `user` — never `platform` |

The existing Kling **REST API key** stays in `user_settings.kling_api_key` and is untouched.
REST and MCP are **separate connections**: a user can hold both, disconnecting MCP does not affect
REST, and nothing forces mutual exclusivity.

### `user_byok` naming pressure (documented, not renamed)

`user_byok` was coined for user-owned API keys. An OAuth grant has no key, so "BYOK" is now
semantically narrow: what it really means is "the **user's own external account pays**". A broader
name (for example `user_connection`) may eventually cover user API keys, user OAuth connections and
user browser-local connections. **No production rename was done.** It should be decided together with
the Browser Bridge research, in one change with a data-compatible alias.

## Schema (migration `scripts/041_create_provider_connections.sql`)

Additive; no existing table touched; **no `video_generations` change** (transport / `connection_id`
belong to the MCP execution slice, where they become generation provenance).

| Table | Purpose | Browser (`authenticated`) access |
|---|---|---|
| `provider_connections` | Safe metadata: provider, method, status (`connected`/`authorization_required`/`error`), scopes, `external_account_id`, safe capability snapshot, `last_checked_at`, `last_error_code`. One row per (user, provider, method) | `SELECT` own rows only (RLS `auth.uid() = user_id`); **no** insert/update/delete |
| `provider_connection_secrets` | `ciphertext` (encrypted access/refresh token), clear `access_token_expires_at`, `secret_version` for optimistic concurrency | **None** — RLS on, zero policies, all privileges revoked |
| `provider_oauth_clients` | Content Studio's own OAuth client registration per (provider, issuer, redirect URI) | **None** |
| `provider_oauth_authorizations` | Short-lived PKCE/state attempts: `state_hash`, encrypted verifier, user, expiry | **None** |

`not_configured` is the absence of a row, not a stored state. `connection_method` is constrained to
the single factual value `mcp_oauth` (no hypothetical enum members). `provider_connections` has no
token column and no credit-balance column.

**RLS proof.** Static tests assert the SQL shape. The same model was also verified against the live
Production database by switching roles in a transaction that rolled back
(`set local role authenticated` with a real JWT subject, and `anon`):

- user A saw only their own connection (`own_visible=1`, `other_visible=0`);
- `authenticated` was denied `SELECT` on `provider_connection_secrets`,
  `provider_oauth_authorizations`, `provider_oauth_clients`;
- `authenticated` was denied `INSERT`/`UPDATE`/`DELETE` on `provider_connections`;
- `anon` was denied;
- deleting a connection cascaded to its secrets;
- afterwards all four tables were empty (nothing leaked from the test).

## Secret storage decision

Audit of available primitives:

| Option | Finding |
|---|---|
| Existing repo encryption primitive | **None** (confirmed) |
| Supabase Vault (`supabase_vault 0.3.1` is installed) | Available, but unused by the repo. Encryption is DB-side, so plaintext tokens would travel to Postgres as RPC parameters and could appear in statement/audit logs (`pgaudit`, `pg_stat_monitor` are installed), and anyone with dashboard/DB privileges can read `vault.decrypted_secrets` |
| **Application-level AES-256-GCM (`node:crypto`)** | **Chosen.** Only ciphertext ever reaches the database, its logs and backups; the key lives outside the database. This is the mission's preferred construction when no existing project primitive exists |

Design (`lib/provider-connections/crypto.ts`): AES-256-GCM, 96-bit random IV per encryption,
128-bit tag, **AAD binding** (a ciphertext copied to another row or purpose fails authentication),
and a **versioned, key-id-tagged** format `v1.<keyId>.<iv>.<tag>.<ciphertext>`. Errors never carry
plaintext, ciphertext or keys. No custom cryptography.

### Encryption key handling

- `PROVIDER_CONNECTION_ENCRYPTION_KEY` — base64, exactly 32 bytes, **server environment only**,
  never committed, never returned to a client, read in exactly one module (source-scan enforced).
- Optional `PROVIDER_CONNECTION_ENCRYPTION_KEY_ID` (default `k1`).
- **Rotation path**: set the new key as current with a new id, and move the old one to
  `PROVIDER_CONNECTION_ENCRYPTION_KEY_PREVIOUS` + `..._PREVIOUS_ID`. Old ciphertext still decrypts
  (selected by key id); new writes use the current key. Re-encrypting existing rows is a future job.
- **Fails closed**: with no valid key, `connect` returns `503 CONNECTION_ENCRYPTION_NOT_CONFIGURED`
  before creating any state, the UI says connections are not enabled in this environment, and no
  token is ever persisted.
- This is a **third, separate authority**, distinct from infrastructure secrets
  (`KLING_WEBHOOK_SECRET`) and platform provider credentials (`OPENAI_API_KEY`, `KLING_API_KEY`).

## OAuth model

| Item | Value | Label |
|---|---|---|
| MCP resource | `https://kling.ai/mcp` | OBSERVED |
| Authorization server (issuer) | `https://kling.ai/auth` | OBSERVED |
| Authorization / token / registration / revocation | `/auth/authorize`, `/auth/token`, `/auth/register`, `/auth/revoke` | OBSERVED |
| Flow | Authorization code + **PKCE S256** (`plain` never used) | OBSERVED (server) / IMPLEMENTED (client) |
| Client type | **Public** (`token_endpoint_auth_methods_supported: ["none"]`) | OBSERVED |
| Client registration | **Dynamic Client Registration** (RFC 7591); Client ID Metadata Documents not supported | OBSERVED |
| Scopes requested | `generation.read account.credit.read` | IMPLEMENTED |
| `generation.create` requested? | **No.** A read-only connection needs no generation scope | IMPLEMENTED, tested (also source-scan) |
| Refresh | `refresh_token` grant; rotation behavior | Whether Kling rotates refresh tokens is **UNKNOWN** until the live proof; both cases are handled and tested |

**Registration model.** One Content Studio client per (provider, issuer, redirect URI) — i.e. per
environment — registered lazily on the first connect and reused by every user, because Kling's model
is a public client with no per-user secret. Registration sends `application_type: web`,
`token_endpoint_auth_method: none`, the exact redirect URI, and read-only `scope`. The registration
is stored in `provider_oauth_clients` (a public `client_id` is not secret), **separately from any user
connection**. The MCP SDK's `registerClient` strips unknown response fields, so a wrapped `fetch`
records the **names** (never values) of the raw fields Kling returns in
`registration_response_fields`, and would encrypt any `client_secret` / `registration_access_token`.
So "does Kling return registration-management material" is answered by data, not assumed — it will be
known after the first registration. Whether Kling accepts our exact redirect URI, and enforces the
registered scope, is **UNKNOWN** until then.

**Redirect URI** (explicit environment configuration, never derived from a request, no wildcard):
`${NEXT_PUBLIC_APP_URL}/api/provider-connections/kling/mcp/callback` — Production:
`https://content.multihuman.com.br/api/provider-connections/kling/mcp/callback`. Only `https`, or
`http` on `localhost` for development. Preview-deployment hostnames are never registered.

## Flow

```
Settings → "Conectar conta"
 → POST /api/provider-connections/kling/mcp/connect      (authenticated; fails closed w/o key)
    → discover OAuth metadata (SDK) → get-or-register client (DCR, once)
    → SDK startAuthorization → PKCE pair (S256) + our CSPRNG state
    → store {state_hash, user_id, encrypted verifier, scope, expiry 10 min}
    → return { authorizationUrl }            (verifier never leaves the server)
 → browser → Kling consent screen (user sees the read-only scopes and approves)
 → GET /api/provider-connections/kling/mcp/callback?code&state[&iss]
    → authenticated user required
    → consume state atomically (single-use) → reject missing/unknown/expired/replayed/wrong-user
    → server-side code exchange with the stored verifier (+ RFC 9207 `iss` check by the SDK)
    → upsert connection (connected) + encrypted tokens
    → 303 → /configuracoes?connection=kling_mcp&result=<code>   (no code/state/token)
 → Settings strips the query string, shows the result, and runs a read-only check
```

Security properties (each has tests): state is 256-bit CSPRNG, stored only as a SHA-256 hash,
single-use via atomic delete-and-return, expires in 10 minutes, and is bound to the initiating user
— it is consumed even when a different user presents it, so a leaked state cannot be retried; the
issuer must match the one recorded at start (mix-up defense); the callback response and redirect
carry a short result code only, with `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.

## Token lifecycle

- `getValidAccessToken` is the only way server code obtains a token: returns the stored token while
  more than 60 s remain, otherwise refreshes.
- A **rotated** refresh token is persisted; a non-rotating provider keeps the existing one.
- Writes use **compare-and-swap on `secret_version`**: parallel serverless refreshes cannot overwrite
  a newer refresh token; the loser adopts the winner's token.
- `invalid_grant` / `invalid_client` / `unauthorized_client` (revoked/expired grant) → connection
  becomes `authorization_required`, dead secrets are deleted, and callers receive
  `PROVIDER_AUTHORIZATION_REQUIRED` (HTTP 409), never a generic 500. If another invocation already
  rotated the token, its newer token is used instead.
- Network/5xx during refresh → `PROVIDER_UNAVAILABLE` with **no** state change.
- A token rejected before its recorded expiry is force-refreshed once and the call retried once.

## Read-only MCP check

`POST /api/provider-connections/[id]/check` (owner only): token → MCP initialize → `tools/list` →
`who_am_i` → `query_membership_and_credits` → disconnect → record **safe** metadata (tool names, model
ids for text/image→video, server version, membership label, provider account id). The credit balance
is returned **live for display and never persisted**. The MCP SDK is `@modelcontextprotocol/client`
2.2.0 (official v2 line; Node ≥ 20; the SDK brings its own zod 4). A per-request, short-lived
connection suits serverless.

**Generation is unreachable.** There is exactly one place a tool is invoked
(`callReadOnlyTool`), gated by an allowlist of two tools; every generation, upload, element and
`logout` tool is refused *before any request is sent*, verified for every tool the server exposes.

Observed during implementation (real server + SDK, no credentials): a bearer token that Kling
rejects surfaces from the SDK as `UnauthorizedError`, and `SdkHttpError` carries the status in
`data.status` with a string `code` — the error mapper is built on that observed shape.

### Error mapping

| Condition | Result |
|---|---|
| Token rejected / grant revoked | `PROVIDER_AUTHORIZATION_REQUIRED` → connection `authorization_required` |
| HTTP 403 / insufficient scope | `PROVIDER_SCOPE_INSUFFICIENT` → connection `error` |
| Tool returned an error | `PROVIDER_TOOL_ERROR` → connection `error` |
| Network / server outage | `PROVIDER_UNAVAILABLE` (status unchanged) |
| Missing/rotated encryption key | `CONNECTION_ENCRYPTION_NOT_CONFIGURED` / `PROVIDER_CONNECTION_INVALID` (infra; status unchanged) |

Logs carry only error **class names** — never messages, URLs, codes, headers or tokens.

## Disconnect

`DELETE /api/provider-connections/[id]`: RFC 7009 revocation of the refresh and access tokens at
Kling (best effort, outcome reported: `succeeded`/`failed`/`skipped`), then explicit deletion of the
token material and the connection row (the FK also cascades). It does **not** touch
`user_settings.kling_api_key`, other providers' keys, or any `VideoGeneration` (tested).

## Connection states

`not_configured` (no row) · `connected` · `authorization_required` · `error`. Temporary OAuth
attempts are never permanent states.

## Terms / policy finding

Sources (official Kling): Terms of Service `kling.ai/docs/user-policy`, Terms of Paid Service
`kling.ai/docs/payment-policy`, Terms of API Paid Service, and the MCP guide.

| Topic | Finding |
|---|---|
| Automation | ToS §3.1(h) prohibits "use automated scripts to collect information from or otherwise interact with the Services"; Paid Service terms §7.3.1 prohibit exploitation "including … robot software, spider software, crawler software, screen-scraping software" |
| Account sharing | ToS §2.5(c): "Your Account can only be used by yourself and you may not lend, give away or rent the Account or transfer, sell or share the Account to others"; Paid Service §9.3 prohibits licensing the use of the account and Paid Services to others |
| Resale / commercial | ToS §3.1(c)/(d) forbid distributing/selling the Services or renting them "for a fee … without our written consent"; §4.1.4 forbids using Credits for "any non-personal use such as for profit"; outputs may be used commercially (§3.1.2, excluding competing products) |
| Third-party clients / OAuth / AI assistants / MCP | **NOT ADDRESSED** in the consumer terms. Kling operates a public OAuth server with open Dynamic Client Registration and documents MCP for "general-purpose AI assistants" |
| API terms | Explicitly contemplate a "Client Application" (a website/app/platform "legally operated by you") — the intended route for a SaaS backend; they do not mention MCP or OAuth |

**Classification: AMBIGUOUS.** Nothing found *permits or forbids* a third-party SaaS acting on a
user's consumer account through OAuth, while the automation, account-sharing and
non-personal-use clauses could be read against it, and the API terms are the documented path for
backends. This is **not** a blocker for the private, read-only spike (the user authorizes their
own account and nothing is generated). It **is a product-launch blocker for MCP generation**:
obtain written confirmation from Kling, or use the REST/API path, before shipping it. No legal
conclusion is drawn here.

## Live proof status

The implementation, migration, RLS proof and all automated tests are complete. The real OAuth
connection needs **two things only a human can do**, and it was not faked:

1. **Provide the encryption key.** The environment used to build this cannot create Production
   environment variables (the Vercel connector returned `403`), so Production has no
   `PROVIDER_CONNECTION_ENCRYPTION_KEY` yet. Until it exists, Settings truthfully shows that
   connections are not enabled and no token can be stored (fail-closed). Generate a key locally with
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`, add it as a
   **Sensitive** Production variable named `PROVIDER_CONNECTION_ENCRYPTION_KEY`, then redeploy
   (variables apply to new deployments).
2. **Consent.** Open Settings → API → "Conta Kling" → **Conectar conta**, sign in to Kling if asked,
   and approve the consent screen (it should list only the two read-only permissions). The callback
   then connects the account and runs the read-only check automatically.

Results of the live proof are recorded in the PR/mission report, not here, and no credit balance is
ever written to this repository.

## Requirements learned for the future "AI Connections" Settings

Evidence for `AI_CONNECTIONS_SETTINGS_V1`, from a real REST (API key) and a real OAuth/MCP
connection side by side:

| Need | Kling REST (API key) | Kling account (MCP / OAuth) |
|---|---|---|
| How the user connects | Paste a secret into a text field | **Redirect** to the provider and back |
| What it stores | One opaque secret | Tokens + expiry + rotation + scopes + a registered client |
| Status shown | configured / not configured | connected / authorization required / error (+ not connected) |
| Extra fields to display | none | account hint, plan label, granted scopes, capabilities, last checked |
| Lifecycle actions | Replace, Remove | Connect, **Reconnect**, **Check**, **Disconnect (revokes)** |
| Failure modes | invalid key at call time | expired/revoked grant, insufficient scope, provider outage |
| Disclosures needed | none | who pays (user's Kling web credits), account library side-effects, read-only vs generation scope |
| Multiple per provider | no | yes — REST **and** MCP at once for one provider |
| Persistence model | column on `user_settings` | separate metadata + secret authorities |

Implications for the redesign: rows are **connections** (provider + method), not providers; the
"Add connection" step must branch on **method** (field vs. redirect); status and actions are
method-specific; a scope-elevation ("Enable generation") action will need a re-authorization;
and account-level disclosures belong to the connection, not the provider.

## Scope elevation (future, not implemented)

> **Implemented later** as the explicit *Autorizar geração* action (connect intent `generation`) — see
> [VIDEO_GENERATION_CONNECTION_CAPABILITY_ROUTING_V1 §10](VIDEO_GENERATION_CONNECTION_CAPABILITY_ROUTING_V1.md#10-scope-upgrade-autorizar-geração).
> Whether Kling enforces the DCR-registered scope remains UNVERIFIED.

A future user choosing "Enable generation" would be sent through the same flow with
`generation.create` added, replacing the grant. Kling may enforce the scopes recorded at client
registration (**UNKNOWN**); if so the client registration would need updating or re-registering.
Not built here.

## Next slice (document only)

> The slice below was delivered as `VIDEO_GENERATION_CONNECTION_CAPABILITY_ROUTING_V1` (shared
> completion, transport boundary, MCP transport, provenance, polling), with the first *paid* proof
> deferred to `KLING_MCP_REAL_GENERATION_PROOF_V1`.

`KLING_MCP_VIDEO_TRANSPORT_AND_POLLING_V1`: shared `completeVideoGeneration` function;
`KlingVideoTransport` interface; REST transport wrapper; MCP transport; `connection_id` +
`transport` provenance on `video_generations`; `query_tasks` polling with a server-driven poller
(MCP has no callback and URLs expire in 24 h); temporary result download → app-owned S3; the same
`VideoGeneration` lifecycle; **no** automatic `VideoDraft`/`LibraryFile` creation. Prerequisites: the
live proof of this spike, Kling's written answer on terms, and a decision on the poller.

## Out of scope (unchanged)

Any generation over MCP, MCP T2V/I2V, `generation.create`, poller/cron/worker, `VideoGeneration`
transport execution, LibraryFile promotion, video evaluator, Browser Bridge, Content Studio
Credits / wallet / plans / billing, a generic integrations framework, arbitrary OAuth providers,
and the full Settings redesign.
