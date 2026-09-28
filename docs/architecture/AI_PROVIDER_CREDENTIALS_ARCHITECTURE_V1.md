# AI Provider Credentials — BYOK + Execution Modes Architecture V1

`AI_PROVIDER_CREDENTIALS_BYOK_V1` and `AI_PROVIDER_CREDENTIALS_EXECUTION_MODES_V1`

## Status at a glance

| Concern | State |
|---|---|
| `user_byok` (user's own provider account pays) | **Implemented — ACTIVE — DEFAULT — the only user-facing mode** |
| `content_studio_credits` (Content Studio's provider account pays) | **Credential/execution boundary prepared — NOT user-enabled — fails closed** |
| Billing / wallet / ledger / plans / pricing | **Not implemented** (deliberately) |
| Silent user → platform credential fallback | **Does not exist, for any provider** |
| Application-level encryption at rest | **Not implemented** (future hardening) |
| MCP / OAuth / Browser Bridge connections | **Not implemented** (separate future work) |

## Product decision

Content Studio's current model is **Bring Your Own Key (BYOK)**:

```
user → Content Studio → user's provider credential → provider
                                       └─ the user's provider/API account pays
```

A user with no saved credential for a provider gets a typed
`PROVIDER_NOT_CONFIGURED` result, never a platform-paid generation.

A second, **explicit** mode is prepared for the future:

```
user → Content Studio Credits → platform-owned credential → provider
            └─ Content Studio's provider account pays; the user's Content Studio balance is charged
```

These are **two execution modes, not fallbacks.** The following must never exist:

```
user credential missing → silently use platform credential      ✗ FORBIDDEN
```

## Domain vocabulary (kept deliberately separate)

Do not collapse these into a single "provider settings" object.

| Concept | Meaning | Values today | Where it lives |
|---|---|---|---|
| **Provider** | The external service | `openai`, `nano_banana`, `kling`, `replicate` | `AiProvider` in `lib/credentials/provider-credentials.ts` |
| **Model** | The concrete generation model | e.g. Kling 3.0, `gpt-image-2` | Route/adapter level (e.g. `video_generations.model`) |
| **Connection** | The configured way of reaching a provider (a user's, or later a platform-managed one) | one user API-key connection per provider, stored on `user_settings` | `user_settings` columns; `connectionMethod` in the status API |
| **Connection method** | How the credential is obtained/held | `api_key` | `ProviderConnectionMethod` in `lib/credentials/provider-metadata.ts` |
| **Transport** | How Content Studio reaches the provider | `rest` | `ProviderTransport` in `provider-metadata.ts` |
| **Execution mode** | **Who pays** | `user_byok` (active), `content_studio_credits` (gated) | `ProviderExecutionMode` in `lib/credentials/provider-execution.ts` |
| **Credential source** | **Whose credential** is used | `user`, `platform` | `CredentialSource` in `provider-execution.ts` |

Worked examples:

| | Provider | Model | Connection | Transport | Execution mode | Credential source |
|---|---|---|---|---|---|---|
| Today | Kling | Kling 3.0 | user's Kling API connection | REST | `user_byok` | `user` |
| Future | Kling | Kling 3.0 | Content Studio managed Kling connection | REST | `content_studio_credits` | `platform` |
| Possible future | Higgsfield | — | user's Higgsfield MCP connection | MCP | `user_byok` | `user` |

"Who pays" (execution mode) is independent of "how we reach the provider"
(transport). Neither is implied by the other. **Browser Bridge is only a
*possible* integration mechanism for platforms with no usable official API;
it is not a transport every provider has**, and nothing in this codebase
implements it. Likewise, not every provider supports every connection
method. Connection methods and transports beyond `api_key` / `rest` are
intentionally **not** in the unions yet — they are added only when a real
implementation lands.

## Resolver shape

### Before (PR #39)

```ts
resolveProviderCredential(supabase, { userId, provider })
  → { status: 'configured', secret } | { status: 'missing' }

resolveOpenAiCredentialWithLegacyPlatformFallback(supabase, userId)
  → user key, else process.env.OPENAI_API_KEY   // silent platform fallback
```

Mode, credential source and transport were implicit; OpenAI silently
substituted the platform credential.

### After (this closure)

```ts
resolveProviderExecution(supabase, { userId, provider, mode? = 'user_byok' }, deps?)
  → { status: 'ready', provider, executionMode, credentialSource, secret }
  | { status: 'provider_not_configured', code: 'PROVIDER_NOT_CONFIGURED', executionMode: 'user_byok' }
  | { status: 'not_enabled',             code: 'CONTENT_STUDIO_CREDITS_NOT_ENABLED', executionMode: 'content_studio_credits' }
  | { status: 'platform_credential_unavailable', code: 'PLATFORM_CREDENTIAL_UNAVAILABLE', executionMode: 'content_studio_credits' }
```

Four small modules, one responsibility each:

| Module | Responsibility |
|---|---|
| `lib/credentials/provider-credentials.ts` | **User** credential store only. `resolveProviderCredential`, `getProviderConfigurationStatuses`. Never reads env. |
| `lib/credentials/platform-credentials.ts` | **Platform** credential boundary — the *only* file that may read `OPENAI_API_KEY` / `KLING_API_KEY`. |
| `lib/credentials/provider-execution.ts` | Execution modes, credential-source typing, the fail-closed credits gate, `resolveProviderExecution`. |
| `lib/credentials/provider-metadata.ts` | Static, non-secret provider metadata (connection methods, transports). |

A source-scan test (`lib/__tests__/credential-boundary.test.ts`) enforces the
boundary: platform env names appear only in `platform-credentials.ts`, only
`provider-execution.ts` imports it, and every provider route resolves through
`resolveProviderExecution`.

## `user_byok` (current)

```
configured user credential → ready { credentialSource: 'user', secret }
missing user credential    → provider_not_configured (PROVIDER_NOT_CONFIGURED)
                             → zero provider calls
                             → never becomes a platform credential
```

Every route hard-codes `provider` and leaves `mode` at its default. **No route
reads an execution mode or credential source from the request**; a client
sending `executionMode: 'content_studio_credits'` or `credentialSource:
'platform'` is ignored (or rejected as an unknown field) and still resolves as
`user_byok`. A client-supplied string can never authorize platform spend.

## `content_studio_credits` (prepared, disabled, fails closed)

```
mode = content_studio_credits
  → checkContentStudioCreditsEntitlement()   // denies everyone today
  → not_enabled (CONTENT_STUDIO_CREDITS_NOT_ENABLED)
  → the platform credential is NOT EVEN READ
  → zero provider calls, zero platform spend
```

- The mode is a recognised, typed value, so a future implementation does not
  have to reinterpret `user_byok` or rewire credential resolution.
- The entitlement check is the seam where a future billing/entitlement system
  plugs in. It **must not** be widened to "allow" as a shortcut.
- `resolveProviderExecution` accepts an optional `checkEntitlement` dependency
  **solely so tests can prove the platform path is distinct** once entitlement
  allows. No route passes it, and no route passes `mode: 'content_studio_credits'`
  at all (guarded by a test).
- No user-facing selector ("Use Content Studio Credits") exists, because there
  is no balance system to support it truthfully.
- Billing/entitlement belongs **above** credential/provider execution; a
  provider adapter never needs to know a user's plan.

## Platform credentials in Production

Platform-owned provider credentials **may** exist in Production configuration
(`OPENAI_API_KEY`, `KLING_API_KEY`, future ones). Their existence:

- **does not** authorize any user-funded execution;
- **is not** a fallback for a missing user credential;
- belongs exclusively to the future explicit `content_studio_credits` path.

They are intentionally **left in place** in the deployment environment — the
work here corrects credential *routing*, not infrastructure configuration.
Today they are effectively dormant: nothing in the running application reads
them, because the only reader (`platform-credentials.ts`) is reachable solely
through the credits gate, which denies everyone.

## OpenAI: platform fallback removed from `user_byok`

PR #39 kept one documented exception: OpenAI routes fell back to
`process.env.OPENAI_API_KEY` in every environment. That contradicted the
product model and is **removed**. Every OpenAI route now behaves as:

```
configured user OpenAI key → use it
missing user OpenAI key    → 400 { code: 'PROVIDER_NOT_CONFIGURED', provider: 'openai' }, zero OpenAI calls
```

Routes covered: `/api/openai/generate-image`, `/api/prompts/translate`,
`/api/prompts/generate-image-prompt`, `/api/evaluate-image`,
`/api/channel-pieces/generate-body`, `/api/posts/generate-feed-text`,
`/api/videos/generate-scene-prompt`. The two prompt routes keep their
UI-facing `code: 'PROMPT_PROVIDER_NOT_CONFIGURED'` and add
`providerCode: 'PROVIDER_NOT_CONFIGURED'`.

`/imagens` now tells the user that image generation with OpenAI models — not
only prompt generation — needs their own OpenAI key in Settings.

### Audit: system-owned (non-user) OpenAI execution

Before removing the fallback, every OpenAI execution path was audited:

- All eight `api.openai.com` call sites are in seven authenticated user
  request routes plus `lib/ai-simulator.ts` (reachable only through
  `/api/prompts/generate-image-prompt`). Each route returns 401 when there is
  no authenticated user *before* resolving any credential.
- No `vercel.json` / `vercel.ts`, no cron, no scheduled task, no GitHub
  workflow, and no background service exists in the repository.
- The render-worker infrastructure (`infra/render-worker-runtime`) and
  `scripts/` do not call OpenAI.

**Result: no system-owned OpenAI workflow exists.** The fallback was therefore
not preserved for hypothetical compatibility. If a genuine platform-owned
workflow is ever introduced, it must be documented and use an explicit
platform-owned path, not a user request's BYOK resolution.

Real-world impact: `user_settings` holds 3 rows (2 with a personal OpenAI
key, 1 with a personal Nano Banana key). A user without a personal OpenAI key
now sees the "not configured" guidance instead of silently using the platform
key — the intended BYOK behavior.

## Kling

- Settings → API → "Kling": Configure / Substituir / Remover; status-only.
- `/api/video-generations` and `/api/video-generations/[id]/sync` resolve the
  authenticated user's own credential via `resolveProviderExecution`
  (`user_byok`) **before** touching source files or creating any DB row. Missing:
  typed `422 { code: 'PROVIDER_NOT_CONFIGURED', provider: 'kling' }`, zero
  `video_generations` rows, zero Kling calls.
- **The non-production `KLING_API_KEY` stand-in from PR #39 is removed.**
  `process.env.KLING_API_KEY` is not consulted in any `NODE_ENV`. Developers
  save their own key through Settings like any user. (This also removes a
  source of test/production divergence.)
- `/videos` disables generation and shows "Kling não configurado" with a link
  to Settings; a key removed in another tab is still caught server-side.
- The platform `KLING_API_KEY` may remain in the environment for the future
  `content_studio_credits` path only.

### `KLING_WEBHOOK_SECRET`

Verifies inbound Kling webhook signatures in `app/api/kling/callback/route.ts`
only. It is environment-only, server-only, webhook-verification-only, never
part of provider execution credential resolution, never selectable through
Settings, never in `user_settings`, never in a response body. A test asserts
it is referenced by no file other than the callback route.

## Nano Banana and Replicate

- **Nano Banana**: user-owned credential, server-side execution, no platform
  credential exists for it. Now resolved through `resolveProviderExecution`
  for a single shared contract (a small change; `/imagens` was not rewritten).
- **Replicate**: credential storage and Settings card only. There is **no**
  generation path (`PROVIDER_METADATA.replicate.executionImplemented === false`);
  none was invented for symmetry. Its status participates in the shared
  Settings model and is otherwise unaffected.

## Execution provenance (persistence decision)

A future execution needs to know historically: provider, model, execution
mode, and credential-source category — **never** the credential itself.

**Decision: nothing new is persisted now, and no migration is added.**

- There is exactly one active mode, `user_byok`, so recording it would be a
  constant column carrying no information.
- `video_generations` already persists `provider` and `model`; it does not and
  must not persist any secret (`request_config` and `provider_metadata` hold
  only generation parameters and the provider's own response — asserted by a
  test).
- When `content_studio_credits` is enabled, provenance becomes load-bearing
  (billing reconciliation, support, audit). At that point add
  `execution_mode` (and a credential-source category) to the execution record
  in the **same** change that enables the mode, together with the ledger/
  reservation design — not before. Historical rows with no value are
  unambiguously `user_byok`.

## Multi-user isolation

Two layers, unchanged:

1. **Database (primary)**: `user_settings` RLS restricts every operation to
   `auth.uid() = user_id` (`scripts/003_create_user_settings_v2.sql`).
2. **Application (defense in depth)**: every resolver call filters
   `.eq('user_id', userId)` using the authenticated user's own id from
   `supabase.auth.getUser()` — never a request-body value.

Under `user_byok`, platform credentials cannot become a way around ownership:
the user path never touches them, and the platform path is unreachable.
Ownership is strictly per user; there is no workspace/project credential
sharing.

## Secret handling (hard boundaries)

- No provider credential in client-visible JSON, query strings, URLs, logs,
  analytics, toasts, browser storage, React props after save, or
  `VideoGeneration.request_config` / provider metadata.
- The browser never selects a secret column (source-scan tested); the Settings
  card is status-only and starts every edit from an empty input
  (component-tested).
- No client code calls a provider API directly; the former browser →
  `api.openai.com` path was removed in PR #39 and is guarded against
  regression.
- Save/replace/remove routes return only `{ provider, status }`.

## Storage at rest

Provider keys remain plaintext `TEXT` columns on `user_settings`, protected by
Supabase/Postgres infrastructure encryption, RLS, and server-only resolution.
**Application-level encryption at rest is not implemented** and is not claimed.
It remains a legitimate future hardening step (new master-key secret, rotation,
and migration of real credentials need their own design); it was not
introduced here because no new critical vulnerability was found.

## Settings UX

### Current (unchanged visually)

Settings → API lists one card per provider — OpenAI, Nano Banana, Kling,
Replicate — each "Configurado ✓ / Não configurado" with Configure/Substituir/
Remover. No saved secret is prefilled or returned. No Content Studio Credits
control is exposed.

### Intended next evolution: "AI Connections"

Provider cards are fine for four providers but are **not** the long-term
information architecture. Content Studio is expected to support more creative
platforms and more than one connection mechanism per provider (API key/REST,
OAuth, MCP, Browser Bridge where justified, other provider-supported methods).
The credential architecture therefore does not depend on one permanent
hardcoded card per provider. The target UX:

```
Settings → AI Connections

  Configured connections
    OpenAI        API Key   Configured
    Nano Banana   API Key   Configured
    Kling         API Key   Configured
  [ + Add connection ]

  Add connection
    1. choose platform / provider
    2. choose an available connection method (only ones that provider supports)
    3. configure only the fields/actions that method requires
```

Illustrative, not a commitment: Kling → API Key/REST (later MCP);
Higgsfield → API and/or MCP if supported; Google Flow → whichever official
integration surface exists (Browser Bridge only if nothing better);
OpenAI → API Key. Do not assume every provider supports every method.

What this closure did to keep that path open (without redesigning Settings or
adding a connection table): provider metadata is isolated in
`provider-metadata.ts`; the status API returns `{ status, connectionMethod }`
per provider; and Provider / Connection / Connection method / Transport /
Execution mode / Credential source are separate types. A connection database
is not introduced until an implementation genuinely needs one.

## Future work (documented only — none of this is implemented)

### Content Studio Credits flow

```
content_studio_credits request
  → entitlement check
  → available balance
  → reserve estimated credits
  → platform credential
  → provider execution
  → actual provider usage
  → settlement / debit
  → release / refund the difference
```

Asynchronous providers such as Kling likely need **reservation** semantics
rather than a naive immediate debit (the final cost is known only after the
webhook/poll). This is a separate project.

### Pricing / provider-unit normalization

Providers bill in different units (tokens, seconds, generations, API units,
model-specific prices, resolution- and audio-dependent prices). Content Studio
Credits will need a **pricing layer separate from credential resolution**.
Provider API units must not be assumed equal to Content Studio Credits 1:1.
No universal pricing model is created here.

### Trial / plan compatibility

The boundary already allows, without changing what BYOK means:

```
Free-trial user ── has own provider key ─────────► user_byok
                └─ has Content Studio trial credits ─► content_studio_credits

Paid plan ──────── own API key ──────────────────► user_byok
                └─ plan-included credits ────────► content_studio_credits
```

The provider adapter never needs to know the subscription plan.

## Phase A audit findings (PR #39, historical)

Audited at `main@064c48d`, before any hardening:

| Provider | Storage | Returned to browser? | Env fallback | Resolution |
|---|---|---|---|---|
| OpenAI | `user_settings.openai_api_key` plaintext | Yes (client `select('*')`) | `OPENAI_API_KEY`, all environments, 7 routes | ad hoc per route |
| Nano Banana | `user_settings.nanobanana_api_key` plaintext | Yes | None | ad hoc |
| Replicate | `user_settings.replicate_api_key` plaintext | Yes | N/A (no execution path) | none |
| Kling | `process.env.KLING_API_KEY` only | N/A | Always | none |

Most severe: `/imagens` called `generateImagePrompt()` in the browser, which
fetched `api.openai.com` from client JS with the plaintext key. Multi-user
isolation was already sound via RLS. Verdict then: **UNSAFE — corrected with
bounded hardening**, no redesign. The browser-exposure defects are fixed; the
OpenAI silent platform fallback that PR #39 preserved is removed by this
closure.

## Migrations

- `scripts/040_add_kling_credential.sql` (PR #39) — additive
  `ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS kling_api_key TEXT DEFAULT NULL;`,
  applied to Production. `ADD COLUMN ... DEFAULT NULL` neither rewrites nor
  locks existing rows; no existing row was read or written. Rollback:
  `ALTER TABLE user_settings DROP COLUMN IF EXISTS kling_api_key;`.
- **This closure requires no migration.** Migration 039 and all previously
  applied migrations are untouched.

## Out of scope (unchanged)

MCP, Kling MCP, Browser Bridge, OAuth connections, credit wallet/balance,
ledger, reservations, settlement, refunds, quotas, subscriptions/plans, Stripe/
checkout/top-ups, pricing engine, provider/model cost mapping, platform-paid
fallback, a second video provider, LibraryFile promotion, video evaluator,
Creative Editor changes, application-level encryption at rest.
