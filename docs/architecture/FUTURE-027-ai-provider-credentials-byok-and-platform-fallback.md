# FUTURE-027 — AI_PROVIDER_CREDENTIALS_BYOK_AND_PLATFORM_FALLBACK_V1

Canonical status record for BYOK vs. Content Studio-funded provider
execution. Detail lives in
[AI_PROVIDER_CREDENTIALS_ARCHITECTURE_V1](AI_PROVIDER_CREDENTIALS_ARCHITECTURE_V1.md).

> Note on the name: "platform fallback" in this identifier is historical. The
> product decision is that platform-funded execution is **never a fallback**;
> it is a separate, explicit execution mode (`content_studio_credits`).

## Final state

| Item | State |
|---|---|
| **BYOK** (`user_byok`) | **IMPLEMENTED — ACTIVE — DEFAULT** |
| **Content Studio Credits** (`content_studio_credits`) | **EXECUTION / CREDENTIAL BOUNDARY PREPARED — NOT USER-ENABLED — BILLING SYSTEM NOT IMPLEMENTED** |
| Silent user → platform fallback | **Does not exist** (OpenAI's legacy fallback was removed) |
| Application-level encryption at rest | **FUTURE HARDENING for user API keys.** Already implemented for OAuth connection secrets (AES-256-GCM) |
| MCP | **Partially advanced, generation NOT implemented.** Discovery: [KLING_MCP_CONNECTION_AND_TRANSPORT_DISCOVERY_V1](KLING_MCP_CONNECTION_AND_TRANSPORT_DISCOVERY_V1.md). Read-only OAuth connection spike: [KLING_MCP_OAUTH_CONNECTION_SPIKE_V1](KLING_MCP_OAUTH_CONNECTION_SPIKE_V1.md). Next slice: `KLING_MCP_VIDEO_TRANSPORT_AND_POLLING_V1` (not started) |

## Implemented (BYOK) — CLOSED

- User-owned provider credentials on `user_settings` (OpenAI, Nano Banana,
  Kling, Replicate), resolved server-side only.
- One shared execution boundary:
  `resolveProviderExecution` with explicit `ProviderExecutionMode`
  (`user_byok` | `content_studio_credits`) and typed `CredentialSource`
  (`user` | `platform`), separate from transport.
- `user_byok`: configured user key → used; missing → `PROVIDER_NOT_CONFIGURED`,
  zero provider calls. This now holds for **OpenAI, Nano Banana and Kling
  alike** — no env fallback in any environment.
- Settings → API status-only cards (Configure / Substituir / Remover); no
  prefill; no secret returned to the browser; secrets never selected
  client-side; no browser → provider calls.
- `/videos` missing-Kling guidance with the action disabled; server-side
  validation remains authoritative.
- `KLING_WEBHOOK_SECRET` isolated (env-only, webhook-verification-only).
- RLS + explicit `user_id` scoping; multi-user isolation tested.
- Additive `kling_api_key` migration (PR #39). No migration in the closure.

## Prepared, NOT enabled (Content Studio Credits)

Built now (so a future implementation does not rewire credential resolution):

- The `content_studio_credits` mode as a recognised, typed value.
- A distinct platform credential boundary (`platform-credentials.ts`) — the
  only code allowed to read `OPENAI_API_KEY` / `KLING_API_KEY`.
- A fail-closed gate: with no entitlement system, the mode returns
  `CONTENT_STUDIO_CREDITS_NOT_ENABLED`, the platform credential is **not even
  read**, and no provider is called. No route passes this mode, and no route
  accepts a mode or credential source from the client.
- Platform credentials in the deployment environment are allowed and were
  deliberately **not** removed; they are dormant until this mode is enabled.

Not built (explicitly out of scope, per the closure brief): credit wallet,
balance table, payment system, Stripe, subscriptions, checkout, top-ups,
pricing engine, provider/model price normalization, credit ledger,
reservation, settlement, refunds, quota engine, monthly resets, plan
entitlement system, commercial margins, and any user-facing "Use Content
Studio Credits" selector.

## Deferred (all NOT implemented)

- Plans / entitlements
- Free-trial credit grants
- Recurring monthly credits
- Wallet / balance
- Ledger
- Reservations (likely required for async providers such as Kling)
- Settlement / debit / refund of differences
- Provider-unit → Content Studio Credit pricing normalization
- Provider/model cost mapping
- Top-ups / purchases
- Refunds
- Quotas
- Commercial policy
- Execution provenance persistence (`execution_mode`, credential-source
  category on the execution record) — add in the same change that enables
  `content_studio_credits`; historical rows are unambiguously `user_byok`
- Application-level encryption at rest for user provider **API keys** (OAuth connection secrets already have it)
- MCP and other non-REST transports / connection methods (OAuth, MCP,
  Browser Bridge where justified) — separate future task
- Settings evolution from per-provider cards to "AI Connections + Add
  connection" (documented target in the architecture doc)

## Requirements for enabling `content_studio_credits` later

1. An explicit, user-visible opt-in — never an implicit fallback from a missing
   BYOK credential.
2. A real entitlement + balance check replacing the deny-all
   `checkContentStudioCreditsEntitlement` — authorized server-side, never by a
   client-supplied string.
3. Reservation → execution → settlement semantics (documented flow in the
   architecture doc).
4. A pricing layer separate from credential resolution; provider API units are
   not Content Studio Credits 1:1.
5. Persisted execution provenance (mode + credential-source category, never a
   secret).
6. Tests proving `user_byok` with a missing credential can still never reach
   the platform path.

---

## Status update (video routing)

Kling MCP now participates in video generation routing (mock-tested transport, polling, shared
completion; no real MCP generation yet): see
[VIDEO_GENERATION_CONNECTION_CAPABILITY_ROUTING_V1](VIDEO_GENERATION_CONNECTION_CAPABILITY_ROUTING_V1.md).
Content Studio Credits, wallet, plans and billing are still not implemented.
