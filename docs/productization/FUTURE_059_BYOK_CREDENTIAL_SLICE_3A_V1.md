# FUTURE-059 Slice 3A — Encrypted BYOK storage foundation (code only, inactive)

Status: **CODE FOUNDATION IMPLEMENTED; INACTIVE IN PRODUCTION.** Baseline `origin/main` `f04d6f5783978c355a7412e45ff99bb873243f54` (verified; Production on the same SHA). This slice adds the encrypted-credential code, a reviewed-but-unapplied schema migration, and tests. It changes **no** Production behaviour: the deployed default mode is `legacy`, no environment variable is added or modified, no master key is created, no migration is applied, no existing credential is read, moved, re-encrypted or rotated, and no provider is called.

**What is NOT true after this slice.** Credentials in Production are **still plaintext** in `user_settings` (protected from the browser by Slice 2). Encryption is available only when an operator completes the steps in §9. Do not describe the BYOK keys as encrypted until then.

Design authority: `FUTURE_059_BYOK_CREDENTIAL_HARDENING_DESIGN_V1.md` (§2–§9), `…_SLICE_1_V1.md`, `…_SLICE_2_V1.md`.

## 1. What changed (files)

| File | Change |
| --- | --- |
| `lib/security/aes-gcm-envelope.ts` | **new** — the proven AES-256-GCM envelope, extracted verbatim from the Kling MCP crypto so a second key identity can reuse it |
| `lib/provider-connections/crypto.ts` | now delegates to the shared codec; same env names, errors and token format (golden-vector pinned); +`isConnectionKeyMaterial()` boolean helper |
| `lib/credentials/byok-crypto.ts` | **new** — BYOK credential encryption with a **separate** master-key identity and owner/provider/format binding |
| `lib/credentials/credential-errors.ts` | **new** — the typed errors moved out of the store (re-exported by it; reasons extended) |
| `lib/credentials/credential-storage-mode.ts` | **new** — `legacy | dual | encrypted`, default and fallback `legacy`; non-secret diagnostic |
| `lib/credentials/encrypted-credential-table.ts` | **new** — the only module naming `provider_api_credentials`; explicit-column data access over a privileged client |
| `lib/credentials/api-credential-store.ts` | the Slice 1 boundary is now mode-aware; the existing implementation is untouched and is what `legacy` runs |
| `app/api/settings/providers/route.ts` | `GET` adds one additive, browser-safe field `credentialStorage` |
| `docs/productization/sql/FUTURE_059_SLICE_3_provider_api_credentials.{up,down}.sql` | **new, NOT applied** — reviewed migration artifacts (kept out of `scripts/`) |
| tests | 7 new/extended suites (§7), including opt-in suites against a real local PostgreSQL + PostgREST |

## 2. Audit of the existing code (before implementing)

- **Kling MCP**: `lib/provider-connections/crypto.ts` is AES-256-GCM via `node:crypto`, token `v1.<keyId>.<iv>.<tag>.<ciphertext>`, key ring from `PROVIDER_CONNECTION_ENCRYPTION_KEY[_ID|_PREVIOUS|_PREVIOUS_ID]`, AAD per row; `token-store.ts` is service-role only with a monotonic `secret_version`. It protects 1 live connection and must stay untouched in behaviour.
- **Slice 1 boundary**: `api-credential-store.ts` is the single module naming the plaintext key columns; it proves ownership through the caller's client (RLS), then reads/writes with a service-role client; failures are `ProviderCredentialUnavailableError` (503-class), never "missing". `provider-credentials.ts` / `resolveProviderExecution` call only it.
- **Slice 2**: browser roles hold no privilege on the key columns; `user_id` and the preference columns remain granted, so the ownership proof still works.
- **Default privileges**: new `public` tables get `arwdDxtm` for `anon`/`authenticated`/`service_role` at CREATE time (verified in the catalog) — the reason the new table's migration locks itself down inside its own transaction (§4).

## 3. Encryption design

| Aspect | Decision |
| --- | --- |
| Primitive | AES-256-GCM (`node:crypto`), no custom cryptography; 12-byte random nonce per encryption (unique), 16-byte tag verified on every decrypt |
| Reuse | one shared codec (`lib/security/aes-gcm-envelope.ts`) used by **both** the Kling connection secrets and BYOK. The extraction is pinned by a **golden vector**: a token produced by the *pre-refactor* implementation still decrypts, and the new output has the identical shape |
| **Key separation** | BYOK reads its own variables, **read in exactly one module and only when an encrypt/decrypt/diagnostic call is made**: `BYOK_CREDENTIAL_ENCRYPTION_KEY` (base64, 32 bytes), `BYOK_CREDENTIAL_ENCRYPTION_KEY_ID` (default `byok1`), `_PREVIOUS`, `_PREVIOUS_ID`. The Kling variables are untouched. If the BYOK key equals the connection key (constant-time comparison, neither value revealed) the module reports `reuses_connection_key` and **refuses to encrypt or decrypt** — separation is enforced, not merely documented |
| Token / payload | `v1.<keyId>.<iv>.<tag>.<ciphertext>`; plaintext inside is `{"v":1,"secret":"<api key>"}`; the payload version and shape are validated after authentication |
| **Binding** | GCM AAD = `byok-credential:v1:<owner user id>:<provider>`: the credential **format/version**, the **owner** and the **provider**. A token copied to another user or provider, sealed under another format version, or sealed for the Kling purpose fails authentication (`decryption_failed`) — proven for each case |
| Rotation (prepared, not run) | tokens select their key by id; a `_PREVIOUS` key keeps old rows readable; `key_id` is stored non-secretly so a future job can find rows to re-wrap without decrypting |
| Server only | the module is unreachable from any client component (transitive import-graph test) and never logs, throws or returns key, plaintext, ciphertext or database text |

## 4. Schema (prepared, NOT applied): `provider_api_credentials`

`docs/productization/sql/FUTURE_059_SLICE_3_provider_api_credentials.up.sql` — one transaction, run as `postgres`:

| Column | Notes |
| --- | --- |
| `id uuid pk`, `user_id uuid → auth.users ON DELETE CASCADE` | `UNIQUE (user_id, provider)` |
| `provider text` | `CHECK IN ('openai','gemini','nano_banana','kling')` — **Replicate is excluded** (no consumer, no configured user; it stays on the legacy store) |
| `ciphertext text` | envelope token only — **no plaintext key column** |
| `key_id text`, `format_version smallint`, `secret_version int`, `source text` | non-secret metadata; `source IN ('user_entry','legacy_backfill')` for provenance |
| `created_at`, `updated_at` | timestamps |

**No committed browser-readable state.** Because this project's default privileges grant `arwdDxtm` to `anon`/`authenticated`/`service_role` on every new table, the same transaction that creates the table: enables RLS with **no policy** (defence in depth), `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role`, `GRANT SELECT, INSERT, UPDATE, DELETE … TO service_role`, then verifies (no table or column privilege for `anon`/`authenticated`; the exact ACL `postgres=arwdDxtm, service_role=arwd`; RLS on; zero policies) and `NOTIFY pgrst`. Any surprise aborts and rolls back the table itself.

`…down.sql` drops the table but **refuses while any row exists** (it would destroy the only copy of credentials entered or migrated in an active mode). Neither file is run by a deploy, a build step or `scripts/`; a test asserts that.

Proven on PGlite (18 tests: default-privilege exposure reproduced, lock-down, constraints, cascade, atomicity incl. injected failure after `CREATE TABLE`, guards, rollback) **and** through real PostgREST 13.0.8 and 14.18 (§7): owner JWT and `anon` get 401/403 `42501` for every verb and query form, the table is not advertised in their OpenAPI document, and `service_role` can use it.

## 5. Store API and modes

The Slice 1 boundary is extended, not duplicated: the same module, the same ownership proof, the same privileged-client selection, the same typed errors. Public signatures are unchanged.

| Operation | `legacy` (default) | `dual` | `encrypted` |
| --- | --- | --- | --- |
| `readStoredApiCredential` | plaintext column (exactly as before) | encrypted row → decrypt; **no row → bounded legacy fallback** (code-only log); row that fails verification → `unavailable`, **never a fallback** | encrypted row only; no row → `missing`; legacy column ignored |
| `readStoredApiCredentialStatuses` | as before | per provider: encrypted (decrypted in memory, so an unreadable credential shows `unavailable`, not "configured") else legacy | encrypted only (Replicate: legacy) |
| `writeStoredApiCredential` | plaintext column | ensure settings row → encrypted upsert (`secret_version`+1, fresh nonce) → legacy column also written | ensure settings row → encrypted upsert → legacy column **cleared**; NanoBanana base URL still saved |
| `removeStoredApiCredential` | null the column | null legacy **first**, delete encrypted **second** (a half-finished removal can never resurrect an old plaintext key through the fallback) | same |
| Replicate | legacy | legacy | legacy |

Failure taxonomy (all `ProviderCredentialUnavailableError`, HTTP 503-class, static message; `reason` is for logs/tests):

| Condition | Result |
| --- | --- |
| credential not configured | `{status:'missing'}` — only when nothing exists |
| database failure (incl. the migration not yet applied) | `store_failure` |
| privileged client cannot be created | `store_client_unavailable` |
| **configuration failure** (active mode, BYOK key missing/invalid/shared with Kling) | `encryption_not_configured` — raised for every operation, so a mis-activation is loud, never partial |
| **decryption failure** (tamper, wrong owner/provider/format, unknown key id) | `decryption_failed` |
| unsupported format version / malformed row or payload | `payload_invalid` |
| unacceptable owner id or provider | `CredentialAccessDeniedError` |

Ownership: unchanged from Slice 1 (validated owner id, ownership proof through the caller's client, privileged single-owner queries). In encrypted modes a write first guarantees the owner's `user_settings` row exists, so the proof keeps working for a user who never saved a preference.

## 6. Feature control

`PROVIDER_API_CREDENTIAL_MODE` = `legacy | dual | encrypted`. **Unset, empty or any unrecognised value (including typos such as `encrpyted`) resolves to `legacy`**; an unrecognised value is flagged by the diagnostic rather than silently ignored. The variable is read in one module, at call time, is set nowhere in the repository or deployment files (tested), and nothing activates automatically. In `legacy` the BYOK key is **never read or required** (tests run legacy with no key, with a garbage key, and with an invalid mode, and assert the encrypted table is never requested through real PostgREST).

`GET /api/settings/providers` gains `credentialStorage: { mode, invalidModeValue, encryptionKey }` where `encryptionKey ∈ not_required | configured | missing | reuses_connection_key` (state classes only; no key, id or value). It lets an operator confirm a staged key *before* flipping the mode, and confirm the mode afterwards, without reading a secret.

## 7. Legacy-compatibility evidence and test results

- The Slice 1 implementation is the `legacy` code path **verbatim** (renamed internally, same behaviour). All pre-existing credential, Settings, provider-route, resolver, Review and Kling MCP suites pass unchanged.
- New regression coverage: legacy default makes zero requests to the encrypted table (fake DB and real PostgREST); an invalid mode or a stray BYOK variable changes nothing; Settings `GET`/`PUT`/`DELETE` keep their shapes in legacy (only the additive `credentialStorage` field is new); `resolveProviderExecution` is unchanged in legacy and keeps its contract in the active modes (never substitutes a platform key; an unreadable credential throws the typed error instead of `provider_not_configured`).
- A mutation canary (silently falling back to the legacy value on decryption failure) is caught by 9 tests.

| Suite | Tests |
| --- | --- |
| `lib/security/__tests__/aes-gcm-envelope.test.ts` — codec, rotation, Kling golden vector | 9 |
| `lib/credentials/__tests__/byok-crypto.test.ts` — round trip, owner/provider/format binding, tamper, nonce/version/payload, key states, rotation, no-secret errors | 18 |
| `lib/credentials/__tests__/credential-storage-mode.test.ts` — default legacy, parsing, diagnostic | 21 |
| `lib/credentials/__tests__/api-credential-store-encrypted.test.ts` — three modes, replacement/removal, ordering, integrity, isolation, configuration/DB failure, no-secret logs | 41 |
| `lib/credentials/__tests__/settings-and-resolver-modes.test.ts` — Settings API + resolver in each mode | 16 |
| `lib/credentials/__tests__/slice-3-provider-api-credentials-pglite.test.ts` — the migration SQL | 18 |
| `lib/__tests__/credential-boundary.test.ts` — +8 source-scan guards (key variables, mode variable, table/decrypt reachability, no client import, no logging, SQL placement) | 53 (was 45) |
| `lib/credentials/__tests__/slice-3-local-postgrest.integration.test.ts` — **opt-in** (`SLICE3_LOCAL_STACK=1`), real PostgreSQL 17.6 + PostgREST + JWT + supabase-js + the real store | 24 on **PostgREST 13.0.8** and 24 on **14.18** (3 + 2 consecutive runs) |

| Validation | Result |
| --- | --- |
| Typecheck | 0 errors |
| ESLint (changed and new files) | 0 errors, 0 warnings |
| Full suite | **5384 passed, 56 skipped (the two opt-in local-stack suites), 2 failed** (`editor-workspace`, `static-parity`: `Estilo` vs `Estilos`, pre-existing on clean `main`, unrelated) |
| Production build (`next build --webpack`) | compiles (2.1 min); then trips the known `ImagesPageShell` page-export type check that also fails on clean `main` locally; Vercel is the authoritative build |

The local-stack run is **not hosted Supabase**: Kong, GoTrue, the hosted PostgREST configuration and event triggers are not exercised (see `…_SLICE_2_LOCAL_STACK_PROOF_V1.md` §4). One environment note from the run: PostgREST answers 503 while it reloads its schema cache; the store reports that as retryable `unavailable`, and the suite waits for reloads to settle.

## 8. Migration status

**Not applied, not automated.** `provider_api_credentials` does not exist in Production. The code tolerates that: in `legacy` it is never referenced; in an active mode a missing table surfaces as `store_failure` (tested), and flipping back to `legacy` restores operation.

## 9. Exact future operator requirements (nothing below has been done)

Each step needs its own explicit authorization; none is performed by merging this slice.

1. **Rotate the exposed provider keys first.** The keys printed in an earlier tool transcript must be replaced at the providers *before* any backfill, so compromised values are never copied into the encrypted store.
2. **Create the dedicated BYOK master key** (not the Kling key): 32 random bytes, base64 (e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`), stored only as the Vercel **Production** variable `BYOK_CREDENTIAL_ENCRYPTION_KEY` (optionally `BYOK_CREDENTIAL_ENCRYPTION_KEY_ID`), with a second escrow copy in an operator-controlled secret store. **Key loss makes every encrypted row unrecoverable** (users must re-enter keys). Preview/Local must not receive it unless they are meant to write credentials (a different key there would create rows Production cannot read).
3. **Review and apply the schema migration** (`FUTURE_059_SLICE_3_provider_api_credentials.up.sql`) as `postgres` through an authorized channel; confirm the resulting ACL is exactly `postgres=arwdDxtm, service_role=arwd`, RLS on, no policy. A hosted dry run on a disposable project is recommended first.
4. **Confirm readiness while still `legacy`**: `GET /api/settings/providers` must show `credentialStorage.encryptionKey: "configured"` (not `missing`/`reuses_connection_key`).
5. **Activate `dual`**: set `PROVIDER_API_CREDENTIAL_MODE=dual` and redeploy. Smoke (statuses, a controlled non-secret save, one provider status); new and replaced credentials are written encrypted **and** legacy.
6. **Backfill existing users (NOT implemented in 3A — Slice 3B).** Designed behaviour: *lazy migrate-on-read* on authorized server reads that took the legacy fallback (encrypt the value in-process, `INSERT … ON CONFLICT DO NOTHING` with `source='legacy_backfill'`, never overwriting a user entry, never blocking the request, never logging a value), plus a counts-only coverage report and a server-run sweep or re-entry request for inactive users; idempotent per `(user, provider)`; an interrupted run simply leaves some users on the fallback; after the insert it re-checks that the legacy value still exists so a key removed meanwhile is not resurrected. **No plaintext leaves the server process** — no workstation script, no value in logs, CI, migrations or docs.
7. **Verify**: counts-only query that every configured legacy key has an encrypted twin; free provider checks where available (OpenAI model list, Gemini models list), one minimal authorized smoke each for NanoBanana and Kling REST; zero `legacy_fallback` log events for the agreed soak (design proposal: 14 days).
8. **Retire the fallback**: set `PROVIDER_API_CREDENTIAL_MODE=encrypted` only when all of: no user with a non-empty legacy key lacks an encrypted row; zero fallback events for the soak; provider verification passed; containment (Slice 2) live ≥ 7 days; master key escrowed. Keep the legacy values (browser-inaccessible) for a rollback window, then null and drop them (Slice 5).
9. **Rollback at any stage**: set the variable back to `legacy` (or `dual`) and redeploy — no data change needed. In `dual` the legacy column is always current, so `legacy` is safe. After `encrypted` mode has been used for writes the legacy column is **not** current for those users: rolling back to `legacy` requires them to re-enter keys (or a reviewed re-population) — so go `encrypted → dual → legacy`, never straight back. Dropping the table is a last resort and is blocked while it holds rows.
10. **Never** roll the application back below `747d5eb` while Slice 2 containment is active.

## 10. Remaining risks and gates

- Keys stay plaintext at rest until steps 1–8 are completed; the unrotated, previously exposed keys remain a prerequisite risk.
- Hosted-Supabase behaviour of the new table (gateway, event triggers, schema-reload windows) is unproven; local-stack proof only.
- Two additional queries per resolution in active modes (ensure-row aside): the ownership proof and the encrypted-row read, plus an in-memory decrypt.
- Status checks decrypt in memory; a misconfigured key therefore shows every encrypted provider as `unavailable` (intended).
- `dual` has a bounded window in which the encrypted and legacy copies can differ after a partial write; the next user save reconciles them, and reads always prefer the encrypted copy.
- The refactor of the Kling connection crypto is behaviour-preserving and pinned by a golden vector, but it is a change to a live path; the Kling MCP suites pass unchanged.
- Slices 3B (lazy backfill), 4 (cut-over) and 5 (retirement) are not started.
