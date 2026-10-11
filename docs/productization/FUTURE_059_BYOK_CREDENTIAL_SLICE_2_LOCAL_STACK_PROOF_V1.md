# FUTURE-059 Slice 2 — Local PostgREST/JWT staging proof

Status: **LOCAL PROOF COMPLETE; PRODUCTION UNTOUCHED.** The containment migration of `FUTURE_059_BYOK_CREDENTIAL_SLICE_2_DESIGN_V1.md` was executed **only** against a throwaway local PostgreSQL 17.6 cluster behind real PostgREST processes. No SQL ran against the Production (or any hosted) database; the only Production queries were read-only metadata and aggregate counts. No credential was read, rotated or created; no provider was called; every user and key is a dummy that exists only in the throwaway cluster. Baseline `origin/main` `f1e3432403bd89c97ea23ec118b0147f1b3a7909` (verified).

## Three levels of proof — keep them apart

| Level | What it is | Status |
| --- | --- | --- |
| **PGlite** | SQL semantics in an in-process PostgreSQL 18.3 (WASM), roles via `SET ROLE`, PostgREST statements reproduced by shape | **PASSED** — 28 tests, merged in PR #172 |
| **Local PostgreSQL + PostgREST + JWT** *(this document)* | PostgreSQL **17.6** (the production minor), the real **PostgREST 13.0.8 and 14.18** binaries, real HS256 JWTs, `authenticator` role switching, real `supabase-js 2.104.1` clients, and the real Slice 1 `api-credential-store` | **PASSED** — 32 tests on each PostgREST version |
| **Hosted Supabase** | a Supabase project (gateway, GoTrue, event triggers, hosted PostgREST config) | **NOT PERFORMED** |

**This is not Supabase's local stack.** The requested Supabase CLI stack could not run here: Docker is not installed, no WSL distribution exists, and the CPU hypervisor is not enabled (Windows 10 Pro 22H2; installing any of these needs admin rights and a reboot, which is outside this mission and would affect the whole machine). Rather than stop with nothing, an isolated native stack was assembled from official binaries in a scratch directory on loopback ports 54329–54331 (nothing in the repository's dev environment, no other project, no shared service was touched, and everything is removed afterwards). Treat the result as a **PostgREST/JWT/PostgreSQL** proof, and the differences below as the remaining gap.

## 1. Stack actually used

| Component | Version / source | Notes |
| --- | --- | --- |
| PostgreSQL | **17.6** (`x86_64-windows`, npm `@embedded-postgres/windows-x64@17.6.0-beta.15`) | production is 17.6.1.105 (Supabase build) — same minor, so the `arwdDxtm` ACL set, `MAINTAIN` privilege and `has_column_privilege` behave identically |
| PostgREST | **13.0.8** and **14.18** (official GitHub release binaries) | the hosted PostgREST version is not observable here; both a 13.x and a 14.x were run to bracket it |
| Auth | HS256 JWTs signed with the PostgREST `jwt-secret`; claims `role`, `sub`, `aud`, `exp` | stands in for GoTrue; PostgREST switches `authenticator` → `anon`/`authenticated`/`service_role` exactly as in Supabase |
| Client | `@supabase/supabase-js` 2.104.1 (the application's library), URL-rewritten to PostgREST's root | same query builder, same `Prefer` headers, same `onConflict` upsert |
| App code under test | the real `lib/credentials/api-credential-store.ts` (Slice 1) | privileged client = a real service-role-JWT client; harness flag off |
| Resources | ~240 MB RAM (PostgreSQL + two PostgREST processes), ports 54329/54330/54331, ~360 MB of scratch files (binaries + cluster); machine has 32 GB RAM (5.6 GB free at start) and 778 GB free disk | no interference with other processes |

### Fixture (`docs/productization/sql/FUTURE_059_SLICE_2_local_stack_fixture.sql`)
Roles with production's inherit flags and statement timeouts (`anon`, `authenticated`, `service_role BYPASSRLS`, `authenticator NOINHERIT`); `auth.uid()`/`auth.role()` reading `request.jwt.claims` as Supabase's do; Supabase's default privileges for `public`; and `public.user_settings` with production's 21 columns, defaults, constraints and 4 RLS policies. **The table ACL is produced by the default-privilege mechanism and equals production's exactly** — `{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}` — asserted by the first test. No production row, user or key is involved.

### How to reproduce
1. Initialise a throwaway cluster (`initdb -A trust`) and start it on a free loopback port with `listen_addresses=127.0.0.1`.
2. Start PostgREST with `PGRST_DB_URI=postgres://authenticator@127.0.0.1:<pg>/postgres`, `PGRST_DB_SCHEMAS=public`, `PGRST_DB_ANON_ROLE=anon`, a random `PGRST_JWT_SECRET`, `PGRST_DB_CHANNEL_ENABLED=true` (the PostgreSQL `bin` directory must be on `PATH` for `libpq`).
3. `SLICE2_LOCAL_STACK=1 SLICE2_PG_PORT=<pg> SLICE2_PGREST_URL=http://127.0.0.1:<rest> SLICE2_JWT_SECRET=<secret> vitest run lib/credentials/__tests__/slice-2-local-postgrest.integration.test.ts`

The test file refuses to run unless the REST URL is loopback and the PostgreSQL port is not 5432/6543, and it is **skipped** unless `SLICE2_LOCAL_STACK=1`, so the normal suite and CI never touch a database. It `DROP`s and recreates `public.user_settings` in the throwaway cluster — never point it at a real database.

## 2. Results (identical on PostgREST 13.0.8 and 14.18: 32 passed, 1 placeholder skipped)

Mission item → evidence (all through real PostgREST + JWT unless noted):

| # | Item | Result |
| --- | --- | --- |
| 1 | Pre-migration permissions | owner JWT **reads** its own key columns (`select=openai_api_key` → 200 with the dummy value) and **overwrites** them (`PATCH` → 204); another user's row is invisible; anon gets 200 with no rows (privilege present, RLS hides rows) — the production exposure is real and reproduced |
| 2 | Apply migration locally | `up.sql` ran as `postgres` in one transaction on PG 17.6; its in-transaction verification passed; the `NOTIFY pgrst, 'reload schema'` made PostgREST reload (polled until the table answered) |
| 3 | Owner cannot read key columns | 403 / SQLSTATE `42501` for: `select=openai_api_key`, `select=user_id,gemini_api_key`, `select=*`, no `select`, filter on a key (`?openai_api_key=not.is.null`), `order=` a key, `like` filter on a key, `or=(replicate_api_key…)`, object-accept header. No response contained a dummy value |
| 4 | Owner cannot update key columns | `PATCH` (alone and smuggled with `theme`), `POST` insert, and `POST ?on_conflict=user_id` with `Prefer: resolution=merge-duplicates` carrying a key → all 403/`42501`; stored keys unchanged (checked as superuser) |
| 5 | Anonymous | `GET` (keys, `theme`, `user_id`), `POST`, `PATCH`, `DELETE` → **401 / `42501`** (table-level denial, not just empty rows); OpenAPI for anon does not list the table |
| 6 | Non-secret reads | all 16 non-secret columns readable for the owner's own row only; supabase-js `.select(10 preferences).eq().single()` works |
| 7 | Settings upsert preserves data | the exact Settings payload through `supabase-js` `.upsert(…, {onConflict:'user_id'})` succeeds on both the conflict-update and the new-user insert path; the five keys are unchanged afterwards (verified as superuser) |
| 8 | Reload shows saved values, not defaults | a **fresh client** re-reads after the save and gets the saved values — every one deliberately different from its column default, so a silent fallback to defaults would fail the assertion |
| 9 | `service_role` | reads and `PATCH`es key columns, `select=*` returns every row (RLS bypass, by design). The **real Slice 1 store** over real clients: owner read via the privileged client with the session client only doing the `user_id` proof (session client's responses contain no dummy value); cross-user request returns `missing` with **zero** privileged calls; statuses, base-URL write, replace and remove work; a privileged client with a bad signature yields `unavailable` (never `missing`) and never falls back to the session client |
| 10 | Ownership / RLS across users | no read, upsert, `PATCH`, `DELETE` of another user's row; `user_id` cannot be re-pointed (≥ 400) |
| 11 | `*`, RETURNING, column queries | covered in 3 and 4. **RETURNING:** `Prefer: return=representation` with no `select` makes PostgREST return every column, so it is rejected 403/`42501` (no partial leak); with `?select=theme,max_refinement_iterations` it works. An alias of a granted column (`select=openai_api_key:theme`) returns the *theme* values, not the key |
| 12–13 | Rollback and post-rollback | `down.sql` restores exactly the original ACL (sorted) with no column ACLs; the owner reads the key through PostgREST again (the documented tradeoff); Settings upserts still work; `up → down → up` re-protects |
| 14 | Guards | second run rejected; column drift aborts; ACL drift aborts; a poisoned grant makes the in-transaction verification fail and the **entire** migration rolls back (PostgREST still shows the unchanged pre-migration state) |
| 15 | No browser-facing secret | every response body received by the "browser" roles in the protected-column group was scanned: no dummy value |
| — | JWT edge cases | wrong signature → 401; expired → 401; `role: postgres` → ≥ 400; role-less `authenticated` token with no `sub` → empty set (`auth.uid()` null) |
| — | Concurrency | a loop of Settings upserts ran while `up.sql` committed: no 5xx and no 4xx at any point (the upsert's columns are granted before and after) |

Observed denial shapes (both versions): owner `select=openai_api_key` → **403 `42501`**; owner `select=*` → **403 `42501`**; anon `select=theme` → **401 `42501`**; owner `select=theme` → **200**.

## 3. Findings that refine the design

1. **OpenAPI still names the key columns.** PostgREST filters the *tables* a role may touch but not individual columns, so `GET /` as `authenticated` lists `openai_api_key` etc. (names only; no value, no access). `anon` no longer sees the table. Cosmetic; the design doc's step 2 of the staging plan ("OpenAPI no longer lists key columns") was wrong and is corrected here.
2. **Bare `return=representation` is rejected**, as a consequence of column grants (PostgREST returns all columns). No current code path uses it (`credential-boundary` and the Slice 2 consistency test enforce explicit columns and no RETURNING on the Settings upsert), but a future `supabase.from('user_settings').upsert(...).select()` without a column list would fail.
3. **Cascade on account deletion does not need `DELETE`:** with `DELETE` revoked from `authenticated`, deleting the `auth.users` row as a role that has no privilege on `user_settings` still removes the settings row (the referential action runs as the table owner).
4. Confirmed again: dropping the table-level privileges is what protects; the PGlite finding that `UPDATE (user_id)` is required also holds under real PostgREST (the Settings upsert passes with the proposed grants).

### Own-row `DELETE`: is it strictly necessary? (reported separately — migration scope unchanged)
**No.** Evidence: no browser or server code deletes `user_settings` (enforced by the Slice 2 consistency test); revoking `DELETE` from `authenticated` makes only a direct `DELETE /user_settings` return 401/403 and leaves Settings upserts working; account deletion still cascades (finding 3). Keeping it only lets an owner delete its own row — and with it its stored keys — from the browser, which is a confidentiality non-issue. Recommendation: **keep the approved scope (`DELETE` retained)** for the first apply to minimise behavioural change, and track "server-only deletion" as a follow-up hardening item (one extra `REVOKE`, trivially reversible). If you prefer to revoke it now, it is a one-line change to `up.sql` plus its verification block and the tests already cover the effect.

## 4. Differences from hosted Supabase (what this does **not** prove)

| Area | Local | Hosted | Risk |
| --- | --- | --- | --- |
| Gateway | direct PostgREST | Kong with `apikey` handling and role mapping | low — grants are evaluated by PostgreSQL after role switch |
| Auth | HS256 test JWTs | GoTrue sessions (project may use asymmetric signing keys) | low — only the `role`/`sub` claims matter to RLS and grants |
| PostgREST | 13.0.8 / 14.18, defaults | hosted version and settings (e.g. `db-extra-search-path`, pre-request hook, `safeupdate` via `session_preload_libraries`) unknown | low–medium — `safeupdate` only blocks unfiltered writes; unknown configuration cannot be inspected from here |
| Schema reload | explicit `NOTIFY` only | Supabase also has a DDL event trigger | low — hosted does strictly more |
| Role bootstrap | recreated by `fixture.sql` from the catalog | managed by Supabase | low — flags and ACL were checked against the live catalog |
| Other objects | only `user_settings` and `auth.*` stubs | Realtime, Storage, GraphQL (not installed), extensions | low — the live catalog showed no dependency on the table |
| PostgreSQL | 17.6 stock build | 17.6.1.105 Supabase build | low |
| Platform-managed privileges | none | dashboard/pg-meta actions could re-grant | unknown — recheck the ACL after apply (runbook step 7) |

## 5. Production safety review

- **Minimum deploy SHA stays mandatory.** Production currently runs `f1e3432` (docs/test-only on top of `94ecd05`); `747d5eb` (Slice 1) is an ancestor of `main` (verified). Builds older than `747d5eb` read key columns with the browser-session client; after the migration they would silently report every provider as not configured. **Never roll the app back below `747d5eb` while Slice 2 is applied.**
- **Grants still match the design.** Live metadata re-read today (15:38 UTC): `relacl` unchanged (`{postgres,anon,authenticated,service_role}` = `arwdDxtm/postgres`), 21 columns, 0 column ACLs, RLS on, 4 policies — the migration's precondition would pass.
- **External consumers remain an open risk.** The `pg_stat_statements` aggregate (browser-role statements naming key columns: 504 select-shaped, 10 insert-shaped calls) was **identical at 15:06, 15:10 and 15:38 UTC**. That is a *gate*, not proof: the view is cumulative per statement text, resets on restart/eviction, says nothing about consumers that never touched those columns, and cannot see Preview/forgotten deployments or tools that connect differently. **No claim is made that external consumers do not exist.**
- **Default privileges are a separate issue.** `anon`/`authenticated` receive `arwdDxtm` on every new `public` table (both from `postgres` and `supabase_admin`). Every other table relies on RLS alone. Tracked separately: it deserves its own audit and a decision on `ALTER DEFAULT PRIVILEGES … REVOKE`; it is out of scope and untouched here.
- **Any SQL against Production requires separate, explicit user authorization.** None was executed; the runbook in the design document still requires an operator, the gates, the smoke and a named rollback approver.

## 6. Is a hosted staging project still required?

Local results are strong for the privilege semantics, PostgREST behaviour and the Slice 1 store. A hosted run would only add the platform gaps in §4. Assessment: **recommended but proportionate — a short, single-purpose run, not a long-lived environment.** If you accept the residual platform risk, the alternative is to apply to Production directly under the runbook (single transaction, self-verifying, exact rollback, targeted-grant escape hatch), which is acceptable only with your explicit authorization.

Facts gathered (read-only, Supabase MCP):

| Item | Finding |
| --- | --- |
| Organization | one org (`fmultiman's projects`, Vercel-integration managed), **plan: Free** |
| Existing projects | 2: *Content Agent Studio* (`ACTIVE_HEALTHY`, Production) and *Mapa do Evento* (`INACTIVE`/paused) |
| Quota | the Free plan allows 2 **active** projects; with one paused there is room for one more active project. Exact quota and billing for a Vercel-managed org could **not** be confirmed through the available tools (no cost endpoint) — confirm in the dashboard before creating anything |
| Branching | not usable: paid-plan feature, and a branch replays the migration history, which starts at `033…` (after `user_settings` was created), so it would not contain the table |
| Potential cost | Free plan project: **$0**, within free limits (500 MB DB, pauses after inactivity). If the org must be on a paid plan, a small compute add-on is billed per hour (public pricing for the smallest instance is on the order of cents per day) plus the plan fee. These are **unverified estimates**, to be confirmed by you before authorization |
| Proposed lifespan | ≤ 2 hours of work, same day |
| Resources | one new project (smallest compute), a **schema-only** dump of `user_settings` + roles/`auth` stubs produced from the committed fixture (no production data, no keys), 2–3 dummy users, one dummy-key app deployment with mocked provider transport |
| Cleanup | after the run: record results, pause then **delete** the project in the dashboard (the MCP exposes pause/restore but no delete), remove its env vars/keys from any deployment, confirm project count is back to 2 |
| Authorization needed | explicit approval before any `create_project` call; none was made |

## 7. Verdict

**Local PostgREST/JWT proof: PASSED on two PostgREST majors.** The migration is validated against real PostgREST semantics, the exact production ACL mechanism, and the real Slice 1 credential store. Status of the overall gate: **still not authorized to apply to Production.** Remaining prerequisites: your decision on the hosted run (§6) or an explicit acceptance of the platform residual risk, the §5 gates at apply time, and separate authorization for Production SQL.

Nothing in this change touches runtime behaviour: new files are documentation, SQL fixtures and an opt-in test.
