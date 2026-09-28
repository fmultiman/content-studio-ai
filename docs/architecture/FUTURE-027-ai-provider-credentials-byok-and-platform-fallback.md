# FUTURE-027 — AI_PROVIDER_CREDENTIALS_BYOK_AND_PLATFORM_FALLBACK_V1

This identifier did not exist anywhere in the repository before this change;
it is created here as the canonical status record for BYOK vs. platform-paid
credential work, per the `AI_PROVIDER_CREDENTIALS_BYOK_V1` mission.

## Status

**Split.**

### CURRENT — BYOK (this mission): CLOSED

Implemented and Production-deployed:

- One shared credential-resolution contract
  (`lib/credentials/provider-credentials.ts`) used by OpenAI, Nano Banana,
  Kling, and Replicate.
- Settings → API → "AI Providers": Configure / Substituir / Remover per
  provider, status-only (`configured`/`missing`), never a prefilled or
  returned secret.
- Kling added to the same BYOK pattern: `kling_api_key` on `user_settings`
  (additive migration), resolved per authenticated user, zero database rows
  or provider calls when missing, typed `PROVIDER_NOT_CONFIGURED` (HTTP 422)
  response, `/videos` UI surfaces the missing state and blocks the action
  instead of a generic failure.
- `KLING_WEBHOOK_SECRET` confirmed and kept structurally separate from any
  user-owned execution credential — infrastructure/env-only, never
  selectable through Settings, never in a response body.
- OpenAI/Nano Banana aligned to the same resolver module. Nano Banana has no
  platform fallback (unchanged). OpenAI keeps its existing platform-env
  fallback in all environments — see "documented exception" in
  `AI_PROVIDER_CREDENTIALS_ARCHITECTURE_V1.md` — because personal-key
  adoption is only partial today (a `COUNT(*)` found 3 `user_settings` rows,
  2 with a personal OpenAI key) and removing the fallback now would risk
  breaking image generation for whichever users/requests still depend on
  it, with no mitigation in place.
- Full detail: [AI_PROVIDER_CREDENTIALS_ARCHITECTURE_V1](AI_PROVIDER_CREDENTIALS_ARCHITECTURE_V1.md).

### FUTURE — Content Studio Credits / platform-funded execution: NOT IMPLEMENTED

Explicitly **not** built by this mission, and nothing here should be read as
implementing or scheduling it:

- No platform-owned provider credentials for user-triggered generation.
- No billing, quotas, internal credits, or margin logic.
- No automatic fallback from a missing user credential to a platform-paid
  path, for any provider, in Production.
- No usage metering or pricing engine.

When this future mode is designed, it needs (at minimum):

1. An explicit, user-visible "Use Content Studio Credits" opt-in — never an
   implicit fallback from a missing BYOK credential.
2. A platform-owned credential store, separate from the per-user
   `user_settings` columns this V1 uses, with its own access boundary (it
   must not be reachable through `resolveProviderCredential`, which is
   deliberately user-scoped only).
3. A billing/quota/credit ledger, which does not exist anywhere in this
   codebase today.
4. A decision on whether the OpenAI legacy platform-env fallback documented
   above should be retired in favor of this new, explicit, billed mode
   (likely yes) once it ships.

Until that design exists, "missing user credential" must keep resulting in
an unavailable provider and a clear configuration prompt, not a silent
platform-paid generation, for every provider added after this V1 as well.
