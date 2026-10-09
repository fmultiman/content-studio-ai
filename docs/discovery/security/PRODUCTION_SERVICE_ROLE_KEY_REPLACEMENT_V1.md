# PRODUCTION_SERVICE_ROLE_KEY_REPLACEMENT_V1 (FUTURE-052)

Status: **audit + compatibility code complete — `SERVICE_ROLE_REPLACEMENT_READY_FOR_USER_APPROVAL`.**
Nothing was created, rotated, revoked or changed in Supabase or Vercel by this mission. No credential value appears in this
document, in the PR, in test output or in logs; only variable names and shape classes are recorded.

Baseline: `origin/main` = `86fe6300b4590ef253bdc5a5fe37d1854e309e06` (FUTURE-050 closed; Production deployment `dpl_7Az5z4daAhTe5Vdc825DBKzeJdTt`).

## 1. The incident (historical exposure — confirmed)

A live legacy Supabase JWT-based `service_role` credential was committed in `scripts/m10c_api_test.mjs` in commit `9c55b83`
(2026-06-25). FUTURE-050 / PR #151 removed the literal from the current tree. It remains in git history, in every clone and
worktree, and in any tool that consumed that history. **It is treated as compromised.**

Proven in this mission (booleans only — no value printed):

* the `service_role` JWT in history is **byte-identical** to the value currently held in the Production environment variable
  `SUPABASE_SERVICE_ROLE_KEY` (compared in memory against a 2026-10-06 `vercel env pull`);
* it **still works today** against the Production database: two independent read-only probes (see §7) returned the RLS-protected
  `media_reviews` total (19 rows) with it.

History is **not** rewritten here (it cannot revoke the credential; it is defence in depth and a separate, destructive decision).

## 2. Direction

Do not rotate the project's legacy JWT secret first. Supabase's current guidance (docs: *API keys → "What to do if a secret key or
`service_role` has been leaked"*, *Migrating to publishable and secret API keys*) is to **replace `service_role` with a secret API
key (`sb_secret_...`)**: independently created, named and deleted, not a JWT, and it returns 401 when used from a browser.

Important consequence discovered by the audit (§6): replacing the key in the application **does not by itself remove the
compromised capability** — the leaked JWT stays valid until the legacy JWT-based keys are disabled and/or the legacy JWT secret is
revoked. The runbook (§9) therefore has two phases: *replace* (zero downtime, fully prepared here) and *invalidate* (needs one more
code change — the browser/SSR `anon` key — and explicit user approval).

## 3. Consumer inventory

Admin credential = a credential that maps to the Postgres `service_role` (BYPASSRLS). "JWT?" = does the consumer assume the
credential is a JWT. **None does.** (The right-hand column describes the code after this change.)

### 3.1 Application (Vercel Production and Preview; Node serverless functions)

All server-only. Every one now obtains its client from `lib/supabase/service-role.ts`, which resolves the credential in
`lib/supabase/admin-credential.ts` and applies the FUTURE-050 local-runtime guard. Before this change nine routes and
`worker-db-client.ts` built a client inline from `process.env.SUPABASE_SERVICE_ROLE_KEY`, **bypassing the local guard**.

| Consumer | Behaviour | Why admin (BYPASSRLS) is needed | User-scoped client would suffice? |
|---|---|---|---|
| `lib/supabase/service-role.ts` → `createServiceRoleSupabase()` (≈25 server modules: video-generations, video-generation-sessions, image-generation-sessions/attempts, reviews service, provider-connections, nanobanana callback, internal poll, …) | R/W | Server-owned writes: users hold SELECT only (`scripts/043`, `049`, `050`, `054`, `056`, `057`); `provider_connection_secrets` has RLS and no policy | No — by design (writes are server-owned) |
| `app/api/video-drafts/[id]/render`, `creative/static-authoring/render` | INSERT `render_executions` | `render_executions` INSERT/SELECT revoked from browser roles (`scripts/031`, `032`) | No |
| `app/api/render-executions` (`GET` list), `[id]`, `[id]/output`, `[id]/output-url`, `[id]/save-to-library`; `gallery/video-outputs`; `channel-piece-media/upload` | read (+ library promotion) | same revoke; user scoping is enforced in code (`.eq('user_id', user.id)`) | Possible only with a new SELECT policy (data-layer change, out of scope) |
| `lib/render-execution/worker-db-client.ts` → `render-executions/claim`, `[id]/fail`, `[id]/complete` | R/W | worker-authenticated (shared secret), no user session | No |
| `app/api/kling/callback` | R/W | unauthenticated provider webhook (HMAC-verified), no session | No |
| `app/api/internal/video-generations/poll` | R/W | worker-authenticated poll | No |

Runtimes that do **not** hold the credential: the VPS render worker and the VPS poll worker (`infra/render-worker-runtime/*`
use only `CONTENT_STUDIO_RENDER_WORKER_SECRET` / `VIDEO_POLL_WORKER_SECRET` over HTTP — no `SUPABASE_*` reference), the browser
(see §4), Supabase Edge Functions (**none deployed**: `list_edge_functions` → `[]`), Postgres itself (no `pg_net`, `pg_cron`,
`supabase_functions` schema or database webhook; no function body embeds a key — `supabase_vault` exists but is unused by key
material), GitHub Actions / CI (`.github` does not exist; Vercel builds only; the repository has no Actions secrets API access
and no workflow files).

### 3.2 Operator scripts (local machine, explicit Production acknowledgement)

All require `--admin-project-ref=<ref>` (`scripts/lib/production-admin-guard.cjs`, enforced by a test over every file in `scripts/`).
They read the credential from `.env.local`/the environment, call PostgREST over raw `fetch` with `apikey: <key>` **and**
`Authorization: Bearer <key>`, and never decode it.

`posts_migration_{dry_run,execute,rollback,post_audit}.mjs`, `posts_migration_m84_{execute,rollback}.mjs`,
`posts_migration_m85b_{mark,rollback}.mjs`, `posts_m85b_tests.mjs`, `cpm_m6_tests.mjs`, `cpm_m7_tests.mjs`, `cpm_m7_smoke_prod.mjs`,
`project_archive_production_m10a{,_rollback}.mjs`, `m10c_api_test.mjs`, `backfill-verified-provider-usage-proofs.mjs`
(+ new `verify-legacy-admin-key-rejected.mjs`). **Found and fixed:** root-level `cpm_m5_tests.mjs` used the service-role key against
Production with **no** acknowledgement guard (the FUTURE-050 guard test only scanned `scripts/`).

All are one-off Production tools. They need no BYPASSRLS replacement but they do need the key; none is run by automation.

### 3.3 Local development and tests

| Item | Finding |
|---|---|
| `.env.local` | Contains **no** `SUPABASE_*` variable (names verified) → ordinary `next dev` has no admin credential. FUTURE-050 guard preserved. |
| `.env.production.local` (pulled 2026-10-06, git-ignored) | Holds `SUPABASE_SERVICE_ROLE_KEY` (legacy JWT), `SUPABASE_SECRET_KEY` (`sb_secret_`), `SUPABASE_JWT_SECRET`, `POSTGRES_*`. Next loads it only for `next build`/`next start`, but it is a standing copy of Production admin authority on a laptop → **delete after the migration (runbook step 10).** |
| vitest | No `.env*` is loaded; every test uses fake keys. Updated to correctly-shaped fakes built at runtime. |

## 4. Compatibility audit

| Question (mission §4) | Result |
|---|---|
| Decodes the key as a JWT? | **No** (no `jose`/`jsonwebtoken`/`jwt-decode` anywhere; test-enforced). |
| Expects three dot-separated segments / reads `role=service_role`? | **No** in runtime code. (`environment-isolation.test.ts` decodes *literals it finds in source* to prove none is a `service_role` JWT — a scan, not an assumption about runtime values.) |
| Validates prefix/format? | Not before. **Now**: `admin-credential.ts` accepts `sb_secret_…` or a structurally valid legacy JWT and refuses everything else (including `sb_publishable_…`) with an error that names the variable and never the value. It never inspects the JWT payload. |
| Sends the key as `Authorization: Bearer` manually? | **Yes, in the 16 operator scripts** (`apikey === Authorization`), and supabase-js does the same by default. Supabase documents this as unsupported for `sb_` keys, but the hosted PostgREST path **accepts it today** (§7: `apikey`-only and `apikey`+same-`Bearer` both returned 206/19 with an `sb_secret_` key). Left unchanged (smallest safe change); recorded as a residual risk because the behaviour is undocumented. |
| Logs part of it? | **No.** Every log line names the variable only. Test-enforced. |
| Passes it to browser code? | **No.** No `NEXT_PUBLIC_*` name carries it; no `'use client'` file, `components/` or `hooks/` file imports the admin modules; a built `.next/static` scan finds neither the variable names nor an `sb_secret_` string. Test-enforced. |
| Returned in an API payload? | **No.** The one new field (`/api/settings/providers` → `adminCredential`) is `{configured, variable, shape, legacyVariableInUse}`; test-enforced. |

supabase-js 2.104.1 (`@supabase/ssr` 0.10.2) sends the key as `apikey` and as the default `Authorization` and does **not** parse it,
so an opaque key is accepted by the constructor. Constructors audited: `createClient` ×1 in `lib/supabase/service-role.ts` (now the only
admin constructor in the app); `createBrowserClient`/`createServerClient` use the `anon` key (see §6).

### 4.1 Service coverage (contracts with stubbed `fetch`; live where read-only)

| Surface | Used by the app? | Evidence |
|---|---|---|
| PostgREST (select/insert/update) | Yes (all consumers) | contract test + **live read-only probe** (`sb_secret_`: 200, count 19 = RLS bypassed) |
| RPC | Yes (`claim_next_render_execution`, channel-piece-media RPCs) | contract test (`/rest/v1/rpc/<name>`, key in `apikey`) |
| Auth admin | **No** | contract test + live `listUsers` (read) succeeded with `sb_secret_` |
| Storage / signed URLs | **No** — media is S3 (`lib/storage/s3.ts`, AWS SigV4 presigned URLs); no `.storage` call exists | contract test (`/storage/v1/object/sign`) |
| Realtime | **No** — no channel use | n/a |
| Browser use of the key | Must fail: live probe with a browser `User-Agent` → **401** (secret-key protection) | live |

## 5. Environment variable contract

Decision: **introduce `SUPABASE_SECRET_KEY` as the canonical name, with a controlled, test-covered fallback to
`SUPABASE_SERVICE_ROLE_KEY`**, resolved in exactly one module.

Why a rename (not "same name, new value"): the name `SUPABASE_SERVICE_ROLE_KEY` describes the thing being retired; the clean end
state is one variable whose name matches its shape. It is also the name Supabase itself uses for the new key (self-hosting
docs; the Vercel↔Supabase integration already injected a `SUPABASE_SECRET_KEY` into Production — see §8). Reusing the old name
would leave the compromised variable and the new credential indistinguishable in Vercel.

Rules (`lib/supabase/admin-credential.ts`):

1. `SUPABASE_SECRET_KEY` wins whenever non-empty; otherwise `SUPABASE_SERVICE_ROLE_KEY` is used.
2. Either shape is accepted in either variable (rename and key swap can happen independently, in any order).
3. A malformed `SUPABASE_SECRET_KEY` **never** falls back to the legacy variable (a typo must not silently re-arm the compromised key).
4. Surrounding whitespace is trimmed (pasted Vercel values).
5. Local runtimes still need `CONTENT_STUDIO_LOCAL_SERVICE_ROLE_PROJECT_REF=<ref>` — now enforced for **all** admin clients,
   including the render-execution routes that previously bypassed it.

**Fallback removal plan (FUTURE-052C):** after the legacy variable is deleted from every Vercel scope and the legacy JWT keys are
disabled, delete `LEGACY_ADMIN_KEY_ENV`, the `legacy-jwt` shape, the script fallbacks (`get('SUPABASE_SECRET_KEY') || get('SUPABASE_SERVICE_ROLE_KEY')`)
and the corresponding tests. `/api/settings/providers` → `adminCredential.legacyVariableInUse` tells you when it is safe.

> **Deploy-time behaviour to be aware of:** merging this change makes Production switch to `SUPABASE_SECRET_KEY` *automatically*,
> because that variable already exists in Production (§8). That is deliberate (it is the zero-downtime cut-over) and is verified
> in §9 step 3 with a non-secret diagnostic.

## 6. Preview, local, and the Auth boundary

**Preview needs the admin credential: YES.** Preview shares the Production database (intentional, FUTURE-050) and its Session/Attempt
autosave PATCH routes write only through the service role (PROVEN in FUTURE-049/050). It cannot be narrowed without moving those writes
to user-scoped clients plus new RLS policies — a data-layer redesign explicitly out of scope. Reduction that *is* possible and
recommended: give Preview **its own named secret key** (separate from Production's) so it can be revoked alone. Preview paid
execution stays **blocked** by FUTURE-050 independently of this credential (re-asserted by test).

**Local needs the Production admin credential: NO** for development. Admin scripts keep the typed `--admin-project-ref` guard.

### 6.1 What replacing `service_role` does and does not remove

* Replacing the key in the app/Vercel changes what the **app** uses. The leaked JWT is a *different* credential and is **not**
  invalidated by that.
* The leaked `service_role` is a JWT signed by the project's **legacy JWT secret**. Supabase docs: *"`anon` and `service_role` are
  not just API keys, but are also valid JSON Web Tokens, signed by the legacy JWT secret. Revoking the legacy JWT secret means that
  your application no longer trusts any JWT signed with it."*
* **Measured today** (read-only probes, §7): the leaked JWT is accepted **both** as `apikey`+`Bearer` (form A) **and** as a bare
  `Authorization: Bearer` behind the public publishable key (form B). Form B is the one that matters: it works even when the caller
  does not need the legacy key to be an accepted *API key*.
* The exact Supabase dashboard actions (Settings → **API Keys** and **JWT Signing Keys**):
  1. *API Keys → legacy tab → disable the JWT-based `anon` and `service_role` keys* (reversible; documented as an API-key control;
     use the "last used" indicators first). Documented as a **pair**.
  2. *JWT Signing Keys → legacy JWT secret → Revoke* (the only mechanism documented to make the platform stop trusting JWTs signed with
     the leaked secret; docs require step 1 first).
* **Whether step 1 alone neutralises form B is not documented, so it is not assumed.** `scripts/verify-legacy-admin-key-rejected.mjs`
  answers it empirically and safely after step 1: if probe B still prints `STILL_VALID`, step 2 is required.
* **The browser/SSR clients use the legacy `anon` JWT** (`lib/supabase/{client,server,middleware}.ts` →
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`), signed by the same legacy secret. Disabling the legacy pair or revoking the secret **breaks every
  authenticated request** until those clients use the publishable key (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` already exists in
  Production). That is a separate, user-facing code change — **FUTURE-052B (PUBLISHABLE_KEY_TRANSITION)** — deliberately *not* made
  here ("do not broaden"; it touches Auth on every request). **It is a hard prerequisite of runbook phase 2.**

### 6.2 JWT signing keys and sessions

| Question | Finding |
|---|---|
| Current signing mode | `https://<ref>.supabase.co/auth/v1/.well-known/jwks.json` publishes **one ES256 (P-256) key** → asymmetric signing is in use. The legacy HS256 secret never appears in a JWKS, so the dashboard must confirm that the ES256 key is *Current* and the legacy secret is *Previously used* (**NOT VERIFIED here — dashboard**). |
| Is JWT signing-key rotation required? | **No.** The project is already on asymmetric keys. *Revoking the legacy secret* (a different action) may be required (§6.1), but nothing needs to be migrated to. |
| User-session impact | None expected for the secret-key swap. For disabling legacy keys / revoking the legacy secret: user access tokens are ES256-signed and unaffected, provided the ES256 key has been Current for longer than the access-token lifetime + 15 min (Supabase's own guidance) — verify in the dashboard. Real risk is only the `anon` dependency in §6.1. |
| Edge Function verification impact | None — no Edge Functions exist. |
| Storage / signed-URL impact | None — Supabase Storage is not used; media URLs are S3 SigV4 presigned. |
| Realtime / DB webhooks / pg_net / pg_cron | Not used (verified). |

## 7. Evidence log (read-only; no writes, no paid calls)

Run against Production with the integration-provisioned `SUPABASE_SECRET_KEY` from the 2026-10-06 pull, through the repo's own
admin guard (`--admin-project-ref`). Outputs were limited to statuses and counts.

| Probe | Result |
|---|---|
| supabase-js `createClient(url, sb_secret)` → `media_reviews` head count | 200, **count 19** (RLS bypassed — equals the known total) |
| supabase-js `auth.admin.listUsers({perPage:1})` | ok |
| raw `apikey: sb_secret` only | 206, `0-0/19` |
| raw `apikey` + `Authorization: Bearer <same sb_secret>` (what the scripts do) | 206, `0-0/19` |
| control: publishable key | 401 (anon has no grant on the table) |
| `sb_secret` with a browser `User-Agent` | 401 |
| leaked legacy JWT: `apikey`+`Bearer` same (form A) | **206, total 19 — still valid** |
| leaked legacy JWT: publishable `apikey` + `Bearer` legacy (form B) | **206, total 19 — still valid** |
| leaked legacy JWT as bare `apikey` (no Authorization) | 401 (the hosted gateway does not promote a legacy `apikey` to a role) |
| Supabase DB: `pg_net`/`pg_cron`/`supabase_functions` | absent; no function body embeds a key |
| Edge Functions | none |
| Security advisor | 3× RLS-no-policy INFO (server-only tables, expected), 3× mutable `search_path` WARN, leaked-password-protection WARN — unrelated to this change |

## 8. Vercel inventory

The Vercel connector in this session cannot see the application project and the CLI is neither installed nor authenticated, so
**per-scope membership could not be read from Vercel.** What is proven is from the 2026-10-06 `vercel env pull` of the Production scope:

| Variable (names only) | Production | Preview | Development |
|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` (legacy JWT — **the compromised one**) | **present** (value == leaked value) | present *(inferred: Preview Session PATCH succeeded in FUTURE-049/050 — NOT read)* | UNVERIFIED |
| `SUPABASE_SECRET_KEY` (`sb_secret_`, 41 chars, works — §7) | **present** | UNVERIFIED | UNVERIFIED |
| `SUPABASE_JWT_SECRET` (legacy HS256 shared secret; **unused by the app**) | present | UNVERIFIED | UNVERIFIED |
| `SUPABASE_ANON_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` (legacy JWT, used by browser/SSR) | present | UNVERIFIED | UNVERIFIED |
| `SUPABASE_PUBLISHABLE_KEY` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_`) | present | UNVERIFIED | UNVERIFIED |
| `POSTGRES_*` (direct DB credentials) | present | UNVERIFIED | UNVERIFIED |

`SUPABASE_SECRET_KEY` and `SUPABASE_JWT_SECRET` look like Vercel↔Supabase **integration-managed** variables. **Owner action:** in
Project → Settings → Environment Variables, record for each row above which scopes hold it and whether it is tagged as managed by
the Supabase integration (managed variables may be locked or re-synced by the integration — if so, use the integration's own key
rotation or disconnect the integration, rather than editing the value by hand).

**Exact scope update order** (each arrow is a separate redeploy-and-verify gate; never edit two scopes between verifications):
`Preview` (add dedicated secret key) → **verify** → `Production` (add/replace secret key) → redeploy → **verify** →
`Development` (remove legacy var) → `Preview` (remove legacy var) → **verify** → `Production` (remove legacy var) → redeploy → **verify**.

## 9. Zero-downtime runbook (nothing below has been executed)

Legend: **[CODE]** done in the PR · **[USER]** needs the user / dashboard · **[VERIFY]** non-secret check · **[ROLLBACK]** how to undo.

### Phase 1 — replace (no user-visible change)

0. **[USER] Preflight, read-only.** Fill the §8 table. In Supabase → Settings → API Keys, note "last used" on `anon`, `service_role`,
   `default` secret and `default` publishable. In Settings → JWT Signing Keys, confirm ES256 = *Current* and record the legacy secret's state.
1. **[CODE]** Ship this PR's compatibility code (accepts both shapes, prefers `SUPABASE_SECRET_KEY`). Merge only after the PR's Preview
   deployment shows `adminCredential` ≠ `invalid`.
   *[ROLLBACK]* Vercel Instant Rollback to `dpl_7Az5z4daAhTe5Vdc825DBKzeJdTt`, or delete `SUPABASE_SECRET_KEY` from the scope and redeploy (falls back to the legacy var).
2. **[USER] Decide the key topology** (recommended: two **named** secret keys — `content-studio-production-server`, `content-studio-preview-server` —
   created in Dashboard → Settings → API Keys → *Create new secret key*; each independently deletable). Lower-effort alternative: keep the
   integration's `default` secret key that Production already holds (proven working in §7) and give Preview its own named key.
3. **[USER → VERIFY] Deploy and confirm cut-over.** After merge the Production deployment starts using `SUPABASE_SECRET_KEY`. Verify via
   `GET /api/settings/providers` (authenticated): `adminCredential = { configured: true, variable: "SUPABASE_SECRET_KEY", shape: "secret-key", legacyVariableInUse: false }`
   and `executionPolicy = { environment: "production", paidExecution: "allowed" }`; Image + Video autosave canary (mutate → *Salvo* → restore), 0 provider calls; Supabase "last used" indicator on the secret key moves.
   *[ROLLBACK]* as step 1.
4. **[USER] Preview scope:** set `SUPABASE_SECRET_KEY` (Preview-only named key). Redeploy a Preview. **[VERIFY]** `adminCredential.variable = SUPABASE_SECRET_KEY`;
   `executionPolicy = { environment: "preview", paidExecution: "blocked" }`; autosave canary passes; DB counts unchanged.
5. **[USER] Production scope (only if step 2 chose a dedicated key):** replace the value, redeploy, repeat the step-3 verification. Keep the legacy variable in place until step 7.
6. **[USER]** Remove `SUPABASE_SERVICE_ROLE_KEY` from **Development**, then **Preview**; redeploy Preview; verify as step 4 plus `legacyVariableInUse: false`.
7. **[USER]** Remove `SUPABASE_SERVICE_ROLE_KEY` from **Production**; redeploy; repeat step 3. *[ROLLBACK]* re-add the variable (the old key still works until phase 2); the fallback in code picks it up.
8. **[USER] Remove unused `SUPABASE_JWT_SECRET`** from every scope (no code reads it; it is the secret that can mint legacy-signed JWTs). Redeploy; verify. *[ROLLBACK]* re-add.
9. **[VERIFY] Operator scripts** still run with the new variable on a harmless one: `node scripts/verify-legacy-admin-key-rejected.mjs …` (needs only the publishable key + the legacy value under test).
10. **[USER] Local hygiene:** delete `.env.production.local` (and any other pulled env file); do **not** `vercel env pull` Production on a laptop; keep `CONTENT_STUDIO_LOCAL_SERVICE_ROLE_PROJECT_REF` unset in ordinary shells.

At the end of phase 1 the application no longer depends on the compromised credential, but **the credential is still valid**.

### Phase 2 — invalidate the compromised credential (requires explicit approval)

11. **[CODE — FUTURE-052B, done on branch `feat/supabase-publishable-key-migration-v1`; see §13]** Move `lib/supabase/{client,server,middleware}.ts` from `NEXT_PUBLIC_SUPABASE_ANON_KEY` to
    `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (with a build-time-safe fallback), verify login/logout/refresh/middleware on a Preview, ship to Production,
    and wait until the "last used" indicator for the legacy `anon` key stops moving (browser caches/old tabs).
    *[ROLLBACK]* revert the PR (the anon key is still enabled at this point).
12. **[USER] Disable the legacy JWT-based API keys** (Dashboard → Settings → API Keys → legacy tab). Reversible ("re-activate"). If anything breaks, re-activate immediately.
13. **[VERIFY] Prove the old credential is rejected, safely:**
    `LEGACY_KEY_UNDER_TEST=<legacy value from your secret store> NEXT_PUBLIC_SUPABASE_URL=… NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=… node scripts/verify-legacy-admin-key-rejected.mjs --admin-project-ref=nuhdhnasuohizxtmyiju`
    - `LEGACY_ADMIN_CREDENTIAL_REJECTED` (exit 0) → done; skip step 14.
    - `…STILL_VALID` (probe B) → the platform still trusts the legacy JWT secret → step 14 is required.
14. **[USER, only if step 13 fails] Revoke the legacy JWT secret** (Dashboard → Settings → JWT Signing Keys → legacy secret → *Revoke*; docs: step 12 first).
    Expected session impact: none if the ES256 key has been *Current* for > access-token lifetime + 15 min (verify in step 0). Revocation is reversible
    ("move to standby" then rotate) but not painless — keep step 13's script ready and re-run it.
15. **[VERIFY] Production again:** step-3 checks, an authenticated page load, Image/Video autosave canary, DB counts unchanged, 0 paid calls.
16. **[CODE — FUTURE-052C]** Remove the legacy fallback (§5), delete `LEGACY_KEY_UNDER_TEST` copies, close FUTURE-052. Optionally schedule history rewriting (defence in depth) and rotate `POSTGRES_*` if they were ever pulled alongside the leaked key.

### Rollback summary

| Failure | Undo | Cost |
|---|---|---|
| Production errors after merge | Vercel Instant Rollback, or remove `SUPABASE_SECRET_KEY` + redeploy | ~1 min, legacy fallback still present |
| New key rejected / typo | Code refuses a malformed value loudly (503/500 + named variable); fix the value | none |
| Legacy keys disabled and something breaks | Re-activate legacy keys in the dashboard | immediate |
| Legacy secret revoked and something breaks | Move the revoked key back to standby (dashboard) | minutes |
| Deleted a secret key still in use | **Not reversible** — never delete a secret key before its replacement is verified in every scope | — |

## 10. Residual risks

1. **Until phase 2, the leaked credential is fully valid** (measured). Phase 1 alone only removes the app's dependence on it.
2. Phase 2 was blocked on FUTURE-052B (browser/SSR `anon` → publishable); the code half is done (§13) but the live Preview + Production smoke gate is still open.
3. Whether disabling the legacy pair also blocks the bare-Bearer path is undocumented; step 13 settles it empirically.
4. The raw-REST operator scripts send `sb_` keys in `Authorization` — undocumented-but-working (§4); a future platform change would break
   the scripts (fail closed), not the app.
5. `SUPABASE_JWT_SECRET` and `POSTGRES_*` are separate admin-grade secrets in Vercel/pulled env files; not part of the git leak, but should be pruned (steps 8, 10).
6. The git history still contains the key (and a historical `anon` JWT, public by design). History rewriting is optional defence in depth.
7. Per-scope Vercel inventory is unverified (no tool access); step 0 must close it before any edit.
8. Unrelated observation: a previous report quoted a Vercel Preview share-link token in chat. Share links are time-limited, but treat it as expired/revoke it.

## 11. What changed in the repository

* `lib/supabase/admin-credential.ts` (new) — the single resolver/classifier/diagnostic.
* `lib/supabase/service-role.ts` — uses the resolver; new `createServiceRoleSupabaseOrNull()`; local guard now covers every admin client.
* 9 route files + `lib/render-execution/worker-db-client.ts` + `app/api/kling/callback/route.ts` — inline factories removed.
* `app/api/settings/providers/route.ts` — adds the non-secret `adminCredential` diagnostic.
* Operator scripts read `SUPABASE_SECRET_KEY` first; `cpm_m5_tests.mjs` gains the admin guard; new `scripts/verify-legacy-admin-key-rejected.mjs`.
* Tests: `lib/__tests__/supabase-admin-credential.test.ts` (new, 46 cases) and updates to tests that asserted the old inline pattern.

## 12. Preview compatibility smoke evidence (PR #152)

Smoke performed prior to PR #152 merge:

* **Preview deployment ID:** `dpl_75RkjHBg6fL11F9Rm1gtCr3xw2QW`
* **Preview URL:** `https://content-studio-4n71uun0o-fmultimans-projects.vercel.app`
* **Vercel bypass & app auth:** authenticated as `flavio.multiman`
* **FUTURE-050 policy gate:**
  * `executionPolicy.environment`: `"preview"`
  * `executionPolicy.paidExecution`: `"blocked"` (FAIL-CLOSED preserved)
* **Admin-credential source diagnostic:**
  * `adminCredential.configured`: `true`
  * `adminCredential.variable`: `"SUPABASE_SECRET_KEY"`
  * `adminCredential.shape`: `"secret-key"` (`sb_secret`)
  * `adminCredential.legacyVariableInUse`: `false`
* **Representative read-only admin paths verified:**
  * Authenticated dashboard & project/production summary loads
  * Review history loads (`/api/reviews/image?attemptId=ccba3d95-d354-43d0-8cb6-1a58f4f16624` returned historical review row)
  * Image generation session loads (`/api/image-generation-sessions/f89db0b4-2621-4049-988b-eefcf8aa30da`)
  * Video generation session loads (`/api/video-generation-sessions/11912666-ecbc-4b71-b810-3c24aecd41fc`)
  * Settings provider data loads (`/api/settings/providers`)
  * Library & gallery files load (`/api/gallery/video-outputs` returned 24 items; `/arquivos` UI rendered all folders and media files)
* **Reversible safe write canaries:**
  * **IMAGE** (`/imagens/geracoes/f89db0b4-2621-4049-988b-eefcf8aa30da`):
    * Original prompt recorded: `""`
    * Temporary prompt edit: `" [F052-PREVIEW-CANARY]"`
    * Autosave transition: `PENDING` → `SAVING` → `Salvo` (succeeded)
    * Restored exact original: `""`
    * Autosave transition: `Salvo` (succeeded)
    * Hard reload verification: persisted restored value `""`
  * **VIDEO** (`/videos/geracoes/11912666-ecbc-4b71-b810-3c24aecd41fc`):
    * Original model + prompt recorded: `Kling 3.0` and `""`
    * Model change: `Kling 3.0` → `Kling 2.6` → autosaved `Salvo`
    * Model restored: `Kling 2.6` → `Kling 3.0` → autosaved `Salvo`
    * Temporary prompt edit: `" [F052-PREVIEW-CANARY]"` → autosaved `Salvo`
    * Prompt restored: `""` → autosaved `Salvo`
    * Hard reload verification: persisted restored model `Kling 3.0` and prompt `""`
* **Database before/after safety proof (delta = 0):**
  * `media_reviews`: 17 image completed, 2 video completed, 0 pending, 0 running (19 total, delta = 0)
  * `provider_usage_events`: 6 Gemini, 5 Kling (11 total, delta = 0)
  * `video_generations`: 10 (delta = 0)
  * `image_generation_attempts`: 23 (delta = 0)
  * `generation_tasks`: 12 (delta = 0)
* **Secret safety:**
  * 0 credential values in browser responses
  * 0 credential values in browser JS bundles
  * 0 console errors or credential leakage
  * 0 hardcoded service-role literals in source
  * 0 paid provider calls


## 13. Phase B — FUTURE-052B `PUBLIC_SUPABASE_PUBLISHABLE_KEY_MIGRATION_V1`

Baseline: `origin/main` = `3a57143905d7040c332bdc3d4bdcf3dab4e966cd` (Phase A merged; Production `dpl_C1ntx8iUzYzkvkcprwkdyWK159Bt`).
Branch `feat/supabase-publishable-key-migration-v1`. **No migration, no Supabase/Vercel change, no key disabled, 0 paid calls, 0 DB writes.**
The legacy `anon` / `service_role` keys stay enabled; this change only makes the application *capable* of running without `anon`.

### 13.1 Legacy anon dependency inventory (non-test source, before)

| Consumer | Class | Read |
|---|---|---|
| `lib/supabase/client.ts` (`createBrowserClient`) — used by ~40 pages/components for Auth + RLS reads/writes | PUBLIC_BROWSER | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `lib/supabase/server.ts` (`createServerClient`, cookie store) — SSR pages and every authenticated route handler | USER_SSR | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `lib/supabase/middleware.ts` (`updateSession`, via `proxy.ts`) — session refresh + protected-route redirects | MIDDLEWARE | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `scripts/m10c_api_test.mjs` (operator contract test) | SCRIPT | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |

Nothing read the non-public `SUPABASE_ANON_KEY` / `SUPABASE_PUBLISHABLE_KEY` (they exist in pulled env files only). There is **no** other `createClient`
against the public key, no raw `fetch` to Supabase with a public key, and **no browser Supabase Storage usage**: the only `.storage` hits are a server
helper (`lib/image-generation/execution.ts`) and a test harness; media uses server-signed URLs (`/api/storage/sign-image-path`, S3). So there are
no browser Storage operations to re-prove; Storage access is unaffected by the public key and stays governed by the user JWT + Storage RLS.
SERVER_ADMIN consumers (Phase A) were not touched. A server-only `SUPABASE_URL` alias is **not** needed: nothing reads it and `NEXT_PUBLIC_SUPABASE_URL` serves every client.

### 13.2 Runtime-selection contract

One resolver, `lib/supabase/public-credential.ts` (browser-safe, no imports):

| Rule | Behaviour |
|---|---|
| Canonical variable | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — wins whenever non-empty |
| Transitional fallback | `NEXT_PUBLIC_SUPABASE_ANON_KEY` — only when the canonical variable is absent/blank (**YES**, kept for rollout safety: Preview/Production/local may still be anon-only) |
| Malformed canonical value | throws `PublicCredentialMalformedError` — **never** falls back (a fallback would hide the misconfiguration until the legacy keys are disabled) |
| Accepted shapes | `sb_publishable_…` and a legacy JWT whose `role` claim is `anon` |
| Rejected | `sb_secret_…`, a legacy JWT with `role: service_role`, anything unrecognised — the error names the variable and class, never the value |
| Missing | `PublicCredentialNotConfiguredError` naming the canonical variable |

`readPublicCredentialEnv()` spells both names as literal `process.env.NEXT_PUBLIC_…` accesses — Next.js only inlines literal member expressions into the
browser bundle (verified: both names are inlined in `.next/static`; a test pins the literal form). `client.ts`, `server.ts` and `middleware.ts` call
`getSupabasePublicKey()`; none of them can name an admin variable (source-scan test). `SUPABASE_SECRET_KEY` remains backend/admin only.

Diagnostic (existing authenticated `GET /api/settings/providers`, next to `adminCredential`; no new endpoint):
`publicCredential: { configured, variable, shape: "publishable-key" | "legacy-anon-jwt" | "invalid" | null, legacyVariableInUse }`.
`legacyVariableInUse` is true when the legacy variable **or** the legacy anon JWT shape is selected (a legacy JWT pasted into the new variable dies with the legacy keys too).

**Target state after merge (Preview and Production):** `publicCredential = { configured: true, variable: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", shape: "publishable-key", legacyVariableInUse: false }`.

### 13.3 Auth / RLS evidence

* The API key only identifies the project (`apikey` header). The signed-in user's JWT (cookie session, asymmetric ES256) is what `auth.getUser`, refresh and RLS use,
  so `anon` / `authenticated` role semantics are unchanged; the publishable key carries no `BYPASSRLS` and is not an admin credential. No Auth, session-lifetime or JWT-signing change.
* Cookie contracts (`getAll`/`setAll`) and middleware redirect lists are unchanged; tests pin them.
* Automated evidence: `lib/__tests__/supabase-public-credential.test.ts` (56 cases) — resolver, fallback precedence, admin-key rejection, browser/SSR/middleware key receipt,
  cookie wiring, refresh propagation, protected-route and login-bounce behaviour, diagnostic, source scans. These run against mocked `@supabase/ssr`; **live** RLS/Auth evidence is the operator smoke below.

### 13.4 Validation

Full suite 4834/4839 passed on the branch. Failures: the 2 known Inspector label failures (`Estilo` vs `Estilos`); the pre-existing timing flake
`video-generation-workspace … Optimistic concurrency conflict (409)` (reproduced 1 of 3 runs on a clean `origin/main` worktree); and load-induced timeouts of
`video-generation-session-generate` / worker start-ups because `tsc`/`eslint` ran concurrently (they pass in isolation). Typecheck clean, lint of the touched scope clean, `next build` passes.
Client-bundle scan (`.next/static`, 74 files): `SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_JWT_SECRET` values — 0 files; identifiers
`SUPABASE_SECRET_KEY` / `SERVICE_ROLE` / `JWT_SECRET` — 0 files; `sb_secret_` shape — 0; the publishable key is present (allowed, public by design). The legacy anon value is also inlined while the fallback exists.

### 13.5 Legacy invalidation readiness criteria (all must hold before the operational mission disables `anon`/`service_role`)

1. `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` present in **Preview and Production** (and Development if used) — checked by name only.
2. Preview deployment of this PR: authenticated `GET /api/settings/providers` returns the target `publicCredential` above; `adminCredential` still `SUPABASE_SECRET_KEY` / `secret-key` / `false`; `executionPolicy` preview/blocked.
3. Preview smoke: login → dashboard (SSR), protected-route redirect when logged out, logout, session survives a reload (refresh), Image + Video generation-session autosave canary (mutate → *Salvo* → restore → hard reload), a Review/history read, Library/gallery read; 0 console/auth errors; DB deltas 0; 0 paid calls.
4. Same on Production after merge (`publicCredential` target state).
5. Supabase dashboard "last used" for the legacy `anon` key stops advancing (old tabs/caches drained).
6. Only then: disable the legacy pair (reversible), run `scripts/verify-legacy-admin-key-rejected.mjs`, repeat 2–3 on Production, re-activate immediately on any failure.

### 13.6 Phase C (FUTURE-052C) fallback-removal boundary

After criterion 6 holds and `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_ANON_KEY` are removed from every Vercel scope: delete `LEGACY_PUBLIC_KEY_ENV`, its line in `readPublicCredentialEnv`, the
`legacy-anon-jwt` shape and the `scripts/m10c_api_test.mjs` fallback, and flip the "readers" source-scan test to expect only the resolver. The admin-side fallback removal (`LEGACY_ADMIN_KEY_ENV`, §5) belongs to the same mission.

### 13.7 Local environment

An ordinary local app needs only `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` for Auth/UI work; it does not need `SUPABASE_SECRET_KEY`. The FUTURE-050 local admin guard
(`CONTENT_STUDIO_LOCAL_SERVICE_ROLE_PROJECT_REF`) is untouched.
