# AI Provider Credentials — BYOK Architecture V1

`AI_PROVIDER_CREDENTIALS_BYOK_V1`

## Product decision

Content Studio uses **Bring Your Own Key (BYOK)** for AI provider execution:

```
user
  ↓
Settings → API (AI Providers)
  ↓
OpenAI credential / Nano Banana credential / Kling credential
  ↓
provider becomes available for that user
```

- A user with no personal credential for a provider gets a typed
  "not configured" result, never a platform-paid generation.
- There is **no automatic platform-paid fallback** in this V1. A future
  "Use Content Studio Credits" mode may introduce platform-owned
  credentials, billing, quotas and margins — that system does not exist
  yet (see FUTURE-027).
- `KLING_WEBHOOK_SECRET` is infrastructure-only: it verifies inbound Kling
  webhook signatures and is never a user-owned execution credential. It is
  never read by, or exposed to, any Settings/credential code path.

## Phase A audit findings (evidence, pre-hardening)

Audited at `main@064c48d`, before this work:

| Provider | Storage | Returned to browser? | Prefilled on load? | Env fallback | Resolution call site |
|---|---|---|---|---|---|
| OpenAI | `user_settings.openai_api_key` (plaintext) | **Yes** — client `select('*')` in Settings and `/imagens` | **Yes** | `process.env.OPENAI_API_KEY` in all environments, in 6 server routes + `/api/openai/generate-image` | Server routes query `user_settings` directly ad hoc |
| Nano Banana | `user_settings.nanobanana_api_key` (plaintext) | **Yes** — same client `select('*')` | **Yes** | None | `/api/nanobanana/generate` queries `user_settings` directly |
| Replicate | `user_settings.replicate_api_key` (plaintext) | **Yes** | **Yes** | N/A — no provider invocation reads this column; dead/unwired field | none |
| Kling | `process.env.KLING_API_KEY` only | N/A (not user-owned) | N/A | **Always** — no user ownership existed | `/api/video-generations`, `/api/video-generations/[id]/sync` |

Most severe finding: `app/(dashboard)/imagens/page.tsx` called
`generateImagePrompt()` from `lib/ai-simulator.ts` directly in the browser,
which issued `fetch('https://api.openai.com/...')` **from client JS** with
`Authorization: Bearer <plaintext key>` — the user's OpenAI key travelled
over the wire from the browser, fully visible in devtools/network, not just
"returned in an API response."

Multi-user isolation was already sound at the database layer: `user_settings`
has RLS policies scoping every operation to `auth.uid() = user_id`, and both
the server (`lib/supabase/server.ts`) and browser (`lib/supabase/client.ts`)
Supabase clients use the anon key plus the user's session — there is no
service-role/bypass-RLS client anywhere in this path. No cross-user leak was
found; the defect was full-secret exposure to a client that should only ever
see configuration status.

### Verdict

**UNSAFE — required correction before adding Kling**, but bounded hardening
was sufficient; no schema/architecture redesign was required (see
"Migration" below). The unsafe behaviors were:

1. Full secrets round-tripped to the browser on every Settings/`/imagens` load.
2. Saved secrets prefilled into `<input>` fields.
3. One feature (`/imagens` prompt generation) sent the raw key from the
   browser directly to the OpenAI API.
4. Kling had no user ownership model at all — a single platform env key.
5. No shared credential-resolution contract; every route queried
   `user_settings` ad hoc.

## Target architecture (implemented)

```
resolveProviderCredential({ userId, provider })
  → { status: 'configured', secret }   // server-side only, never logged/returned
  → { status: 'missing' }
```

`lib/credentials/provider-credentials.ts` is the single shared module:

- `AiProvider = 'openai' | 'nano_banana' | 'kling' | 'replicate'`
- `resolveProviderCredential(supabase, { userId, provider })` — reads exactly
  one secret column, scoped by `.eq('user_id', userId)` (defense in depth on
  top of RLS), returns `configured`/`missing`, never falls back to an env var.
- `getProviderConfigurationStatuses(supabase, userId)` — status-only view for
  UI/API responses; never includes a secret value.
- `resolveOpenAiCredentialWithLegacyPlatformFallback(supabase, userId)` — see
  "Documented exception" below.

Every provider invocation route now resolves its credential through this
module instead of querying `user_settings` ad hoc.

## Secret storage (Phase B decision)

Storage remains the existing plaintext `TEXT` columns on `user_settings`,
**not** re-encrypted at the application layer in this V1. This was a
deliberate, evidence-based call, not an oversight:

- Postgres/Supabase already encrypts data at rest at the infrastructure
  layer, and RLS scopes every row read/write to `auth.uid() = user_id`.
- Introducing an application-managed encryption key (a new master-key
  infrastructure secret) is exactly the kind of casual cryptography this
  mission's brief asked to avoid ("do not invent cryptography casually"),
  and it adds real operational risk (key rotation, misconfiguration locking
  out real users' real credentials) disproportionate to what's needed to
  close the actual exposure found in Phase A — which was resolution/exposure
  boundaries, not at-rest storage format.
- The concrete hardening that matters is: never return the secret to the
  browser, never prefill it, resolve it only server-side immediately before
  the provider call, and never let it enter logs, errors, or persisted
  generation/task records.

Application-layer encryption of these columns is documented here as a
legitimate **future** hardening step (see FUTURE-027), not implemented now.

### What changed to satisfy the contract

- `app/api/settings/providers/route.ts` (`GET`) returns `{ status }` per
  provider — never a secret.
- `app/api/settings/providers/[provider]/route.ts` (`PUT`/`DELETE`) saves,
  replaces, or clears a credential and returns only `{ provider, status }`.
- Settings → API tab (`app/(dashboard)/configuracoes/page.tsx`) no longer
  selects secret columns from the browser Supabase client at all. The input
  for each provider (`components/settings/ai-provider-credential-card.tsx`)
  never prefills a saved value — it always starts empty, uses
  `type="password"` by default, and only a fresh explicit "Save" round-trips
  a new value to the server.
- `/imagens` no longer selects secret columns client-side either; it fetches
  `/api/settings/providers` for booleans (`openaiConfigured`,
  `nanobananaConfigured`).
- The browser→OpenAI direct call was replaced with
  `app/api/prompts/generate-image-prompt/route.ts`, a server route that
  resolves the credential and calls OpenAI itself; `/imagens` now calls this
  route instead of `generateImagePrompt()` directly. `lib/ai-simulator.ts`
  itself was not modified — it is simply no longer invoked from client code.

## Documented exception: OpenAI's legacy platform fallback

An initial `list_tables` read of `user_settings` reported an estimated 0
rows (Postgres's cached `reltuples` statistic, stale for a table that had
not been analyzed recently — not a reliable signal). A direct `COUNT(*)`
taken later in this work found the real number: **3 rows**, of which 2 have
a personal `openai_api_key` and 1 has a personal `nanobanana_api_key`; none
had `kling_api_key` (expected — the column did not exist before this
change). Not every current OpenAI call in the live app is covered by a
personal key today, so `process.env.OPENAI_API_KEY` as a platform-level
fallback, in every environment including Production, is still load-bearing
for at least some users/routes.

Stripping that fallback in this change would risk breaking "Do not break
image generation" for whichever current users/requests still depend on it,
with no mitigation in place. This fallback is therefore **preserved**, but
centralized into one
explicitly-named function —
`resolveOpenAiCredentialWithLegacyPlatformFallback` — instead of being
duplicated ad hoc across seven routes as `settings?.openai_api_key ||
process.env.OPENAI_API_KEY`. Nano Banana never had this fallback and still
doesn't. **Kling gets no equivalent** — it is the one provider this mission
explicitly moves to strict BYOK with zero platform fallback for
user-triggered Production generation, since it has no legacy dependency to
protect.

This is scoped as a temporary, load-bearing exception until either (a)
personal-key adoption is verified, or (b) the future "Content Studio
Credits" platform-funded mode ships with an explicit, billed, opt-in
platform-fallback contract — see FUTURE-027.

## Kling BYOK

- Settings → API → "Kling" card: Configure / Substituir / Remover, same
  pattern as OpenAI/Nano Banana. Saving never prefills; the response never
  contains the secret.
- `app/api/video-generations/route.ts` resolves the authenticated user's own
  Kling credential **before** touching any source file and **before**
  creating the `video_generations` row. If missing:
  - Returns `{ error: 'PROVIDER_NOT_CONFIGURED', code: 'PROVIDER_NOT_CONFIGURED', provider: 'kling', message }` with HTTP 422.
  - **Zero** database rows are created and **zero** Kling API calls are made.
- `app/api/video-generations/[id]/sync/route.ts` re-resolves the credential
  the same way before polling Kling for status.
- `/videos` (`app/(dashboard)/videos/page.tsx` and
  `components/videos/create-video-generation-dialog.tsx`) fetches
  `/api/settings/providers` and only ever sees `kling.status`, never the
  credential. When missing, the "Gerar Vídeo IA (Kling)" action is disabled
  and a `StateMessage` points to Settings; a race (key removed in another
  tab) is still caught server-side and surfaces the same typed error via a
  toast, not a generic 500.
- Non-production convenience: `process.env.KLING_API_KEY` may still stand in
  for a developer with no personal key, but only when
  `process.env.NODE_ENV !== 'production'`. This path is unreachable in
  Production regardless of whether the env var is set — see
  `resolveKlingApiKey()` in `app/api/video-generations/route.ts`.

### `KLING_WEBHOOK_SECRET` boundary

`app/api/kling/callback/route.ts` reads `process.env.KLING_WEBHOOK_SECRET`
to verify the inbound webhook HMAC signature. This is untouched by this
change and remains structurally separate from `KLING_API_KEY` /
`kling_api_key`:

- It is never read by `lib/credentials/provider-credentials.ts`.
- It is never selectable from, or writable through, any Settings API route.
- It never appears in `user_settings` or any other user-scoped table.
- It is not returned in any API response.

## Multi-user isolation

Enforced at two layers:

1. **Database (primary)**: `user_settings` RLS policies restrict every
   `SELECT`/`INSERT`/`UPDATE`/`DELETE` to `auth.uid() = user_id`
   (`scripts/003_create_user_settings_v2.sql`).
2. **Application (defense in depth)**: every call into
   `resolveProviderCredential` / `getProviderConfigurationStatuses` passes
   an explicit `.eq('user_id', userId)` filter using the authenticated
   user's own id from `supabase.auth.getUser()` — never a value from the
   request body.

There is no workspace/project-level credential sharing in this V1;
ownership is strictly per-user, matching the current product decision.

## Migration

**Required**: yes — one additive column.

`scripts/040_add_kling_credential.sql`:

```sql
ALTER TABLE user_settings
ADD COLUMN IF NOT EXISTS kling_api_key TEXT DEFAULT NULL;
```

- Additive and backward-compatible: no existing column altered/dropped, no
  existing row mutated (defaults to `NULL`).
- Applied directly to the Production Supabase project
  (`nuhdhnasuohizxtmyiju` / "Content Agent Studio") via
  `mcp__claude_ai_Supabase__apply_migration`, verified by
  `information_schema.columns`.
- `ADD COLUMN ... DEFAULT NULL` does not rewrite or lock existing rows in
  Postgres — it is safe regardless of row count. A `COUNT(*)` taken after
  applying the migration found 3 existing `user_settings` rows (2 with a
  personal `openai_api_key`, 1 with a personal `nanobanana_api_key`); none
  were read, written, or otherwise touched by this migration.
- Rollback: `ALTER TABLE user_settings DROP COLUMN IF EXISTS kling_api_key;`
  is safe at any time (nullable, no dependents).
- No destructive migration of existing plaintext OpenAI/Nano Banana/Replicate
  values was performed or required — those columns are unchanged.

## Files changed (by area)

- **Credential resolution**: `lib/credentials/provider-credentials.ts` (new)
- **Settings API**: `app/api/settings/providers/route.ts` (new),
  `app/api/settings/providers/[provider]/route.ts` (new)
- **Settings UI**: `app/(dashboard)/configuracoes/page.tsx`,
  `components/settings/ai-provider-credential-card.tsx` (new)
- **Prompt generation (moved server-side)**:
  `app/api/prompts/generate-image-prompt/route.ts` (new)
- **`/imagens`**: `app/(dashboard)/imagens/page.tsx`
- **OpenAI-consuming routes** (resolver + documented legacy fallback):
  `app/api/openai/generate-image/route.ts`,
  `app/api/prompts/translate/route.ts`,
  `app/api/channel-pieces/generate-body/route.ts`,
  `app/api/evaluate-image/route.ts`,
  `app/api/posts/generate-feed-text/route.ts`,
  `app/api/videos/generate-scene-prompt/route.ts`
- **Nano Banana**: `app/api/nanobanana/generate/route.ts`
- **Kling BYOK**: `app/api/video-generations/route.ts`,
  `app/api/video-generations/[id]/sync/route.ts`
- **`/videos` UX**: `app/(dashboard)/videos/page.tsx`,
  `components/videos/create-video-generation-dialog.tsx`
- **Types**: `lib/types.ts` (`UserSettings.kling_api_key`)
- **Migration**: `scripts/040_add_kling_credential.sql`

## Out of scope (unchanged by this work)

MCP, Kling MCP, Browser Bridge, Content Studio wallet/credits, subscriptions,
provider billing, usage metering, pricing engine, platform-paid fallback, a
second video provider, LibraryFile promotion, video evaluator, Creative
Editor changes. See FUTURE-027 for what a platform-funded credits mode would
require.
