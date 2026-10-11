# FUTURE-059 Slice 2 — Column-privilege containment: audit and migration design

Status: **DESIGN ONLY.** No SQL was applied, no source runtime behaviour changed, no credential was read or rotated, no provider was called. Baseline `origin/main` `94ecd051944f4baa80704adbd8c15760f3b9c1d0` (verified, clean worktree). Builds on `FUTURE_059_BYOK_CREDENTIAL_HARDENING_DESIGN_V1.md` (§6) and `…_SLICE_1_V1.md`.

**Secret handling.** Discovery used catalog metadata (`pg_class`, `pg_attribute`, `pg_policy`, `pg_roles`, `pg_default_acl`, `has_column_privilege`), source code, `pg_stat_statements` **counts** (no query text printed) and aggregate counts. No `SELECT *`, no key column read, no value printed. Every test uses dummy values.

## Verdict

> **NEEDS ADDITIONAL STAGING PROOF.** The migration is small, reversible, passes 28 PGlite proofs and every application consumer was audited — but it is **not** declared safe to apply on static inspection and PGlite alone. There is no staging environment, a Supabase branch cannot replicate production (the migration history starts after `user_settings` was created), and PGlite is not Supabase's PostgREST/JWT stack. See §8 and §13.

## 1. Sources and preflight

`origin/main` = `94ecd05` (Slice 1 merged, Production deployment `success`, authenticated Settings smoke verified). Worktree clean. Read: the FUTURE-059 design (§6), the Slice 1 document, `lib/credentials/api-credential-store.ts`, the Settings/provider routes, every `user_settings` consumer, `scripts/003*`, `004`, `006`, `009`, `030`, `040`, `059`, and the production catalog. The catalog and the code are the authority; where this contradicts earlier notes it says so.

**Correction to earlier notes.** Earlier documents described "column privileges on the key columns" for the browser roles. The catalog shows **no column-level ACL at all** (`attacl IS NULL` for all 21 columns). The exposure comes entirely from the **table-level** grant, which covers every column — including any column added later.

## 2. Effective privilege audit (production, metadata only)

PostgreSQL 17.6. `public.user_settings`: ordinary table, owner `postgres`, RLS **enabled, not forced**.

| Grantee | Table ACL | Column ACLs | Effective access to the 5 key columns | Rows visible |
| --- | --- | --- | --- | --- |
| `anon` | `arwdDxtm` (INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN) | none | `has_column_privilege` = true for SELECT, INSERT, UPDATE, REFERENCES | none (`auth.uid()` is null) |
| `authenticated` | `arwdDxtm` | none | true for SELECT, INSERT, UPDATE, REFERENCES | **own row** — the owner's JWT can read and overwrite its own keys through PostgREST |
| `service_role` | `arwdDxtm` | none | true | all rows (`BYPASSRLS`) |
| `postgres` (owner) | `arwdDxtm` | — | true | bypasses RLS |
| `PUBLIC` | no entry | — | none | — |

Full ACL: `{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`. All entries were granted by `postgres`, so the migration (run as `postgres`) can revoke them.

**RLS policies** (4, all `PERMISSIVE`, role `PUBLIC`): select/update/delete `USING (auth.uid() = user_id)`, insert `WITH CHECK (auth.uid() = user_id)`. The update policy has no separate `WITH CHECK`, so its `USING` also constrains the new row (a user cannot re-point `user_id`; proven in §7).

**Role plumbing.** `authenticator` (`NOINHERIT`, `LOGIN`) is a member of `anon`, `authenticated`, `service_role` and PostgREST `SET ROLE`s into them; `authenticated` and `anon` are members of nothing, so there is **no inherited path** to the table. `postgres` is a member of all three (irrelevant to PostgREST). `anon`/`authenticated` have no `CREATE` on `public`.

**Other objects.** Triggers on the table: none (only internal FK triggers; the v1 `updated_at` trigger from `scripts/003_create_user_settings.sql` does not exist in production — `updated_at` is not auto-maintained today, unrelated to this slice). Publications: not in `supabase_realtime` or any publication. Rules, views depending on the table, foreign keys *to* it, policies on other tables referencing it, functions mentioning it: **none**. `pg_graphql` is **not installed**. The only `SECURITY DEFINER` functions in `public` (`claim_next_render_execution`, `images_enforce_project_owner`, `library_files_enforce_ownership`) are not executable by `anon`/`authenticated` and do not reference `user_settings`. Default ACLs: new `public` tables get `arwdDxtm` for `anon`/`authenticated`/`service_role` (from both `postgres` and `supabase_admin`) — future tables repeat this pattern (see §12).

**The Postgres rule that drives the design** (reproduced in the test suite): `REVOKE SELECT (openai_api_key) …` while the table-wide `SELECT` grant exists changes nothing — the owner still reads the key. The table-level privilege must be revoked first, then only allowed columns granted back.

## 3. Column inventory and allowlists

21 columns, from the catalog:

| Class | Columns |
| --- | --- |
| **Secret (5)** — never granted to a browser role | `openai_api_key`, `gemini_api_key`, `nanobanana_api_key`, `kling_api_key`, `replicate_api_key` |
| **Preferences (10)** — browser reads and writes today | `theme`, `studio_intensity`, `auto_mode_default`, `save_prompt_history`, `notifications_email`, `notifications_browser`, `automation_enabled`, `default_image_model`, `image_evaluator_enabled`, `max_refinement_iterations` |
| **Identity (1)** | `user_id` |
| **Server-managed non-secret (5)** | `id`, `nanobanana_base_url`, `nanobanana_model`, `created_at`, `updated_at` |

Proposed grants for `authenticated`:

| Privilege | Columns | Why |
| --- | --- | --- |
| `SELECT` | all 16 non-secret columns | harmless to read; the server `GET /api/settings/providers` reads `nanobanana_base_url` through the session client; the Slice 1 ownership proof reads `user_id`; tolerates an `id`/`updated_at` read without a new migration |
| `INSERT` and `UPDATE` | `user_id` + the 10 preferences | exactly what the Settings page upserts. PostgREST's `INSERT … ON CONFLICT (user_id) DO UPDATE SET <every supplied column>` needs both privileges on every supplied column, **including `user_id`** (the test that omits `UPDATE (user_id)` fails with *permission denied*) |
| `DELETE` | table-level, unchanged | own-row deletion still RLS-bound; not used by the app; kept to avoid an unreviewed behaviour change |
| anything else | — | `TRUNCATE`, `REFERENCES`, `TRIGGER`, `MAINTAIN` are dropped for `authenticated` as a side effect of `REVOKE ALL`; `anon` loses everything |

Deliberately **not** browser-writable: `nanobanana_base_url`, `nanobanana_model`, `created_at`, `updated_at`, `id` and all keys. The base URL is written only by the Settings provider route through the service-role store.

## 4. Application dependency audit

`user_settings` is referenced by exactly these code paths (source scan + `pg_stat_statements` role counts; the repository test fails if a new consumer appears):

| Consumer | Client / role | Operation | Columns | Effect of the migration |
| --- | --- | --- | --- | --- |
| `configuracoes/page.tsx` load | browser, `authenticated` | `select().eq().single()` | 10 preferences | none — all granted |
| `configuracoes/page.tsx` save | browser, `authenticated` | `upsert({…}, {onConflict:'user_id'})`, no `.select()` (no RETURNING) | `user_id` + 10 preferences | none — INSERT/UPDATE granted on exactly these |
| `imagens/page.tsx` | browser | `select` | `automation_enabled, default_image_model, image_evaluator_enabled, max_refinement_iterations` | none |
| `theme-preference-bootstrap.tsx` | browser | `select` | `theme, studio_intensity` | none |
| `GET /api/settings/providers` | server, session client | `select('nanobanana_base_url')` | `nanobanana_base_url` | none — SELECT granted |
| `api-credential-store.ts` proof read | server, **caller's** client | `select('user_id')` | `user_id` | none — SELECT granted |
| `api-credential-store.ts` secret read/write/remove | server, `service_role` | single-column select; `upsert`; `update … = null` | key columns (+ base URL) | none — `service_role` untouched |
| NanoBanana callback, Review services | `service_role` (caller passes service client) | via the store | — | none |
| Supabase SQL editor / migrations | `postgres` | — | — | none (owner) |

Statements seen in `pg_stat_statements` that touch `user_settings`, by executing role (counts only): `authenticated` 17 distinct statements / 1080 calls, `service_role` 3 / 7, **`anon` none**, `postgres` (this audit). No `authenticated` statement text matched a `SELECT *`, an UPDATE or a DELETE (text heuristics); its inserts are PostgREST upserts.

**Historic traffic that references key columns (baseline for the preflight gate in §11).** `authenticated` has statement shapes that name key columns: 6 select-shaped (504 calls) and 3 insert-shaped (10 calls) at `2026-10-11 15:06:49 UTC`. Every such entry was **first seen before Slice 1 was deployed** (latest first-seen 2026-10-10 02:25 UTC; Slice 1 went live 07:56 UTC), i.e. it is the pre-Slice-1 resolver/Settings write path. A second sample four minutes later (15:10:42 UTC, during this audit, with the app in normal use) was identical (504 / 10) — weak evidence only, since one sample window proves little. The migration gate requires these two call totals to be **unchanged** at apply time: any growth means something still reads or writes keys with a browser-role client (an old deployment, a Preview, an external tool) and must be found first.

### Breaking-change classification

| Class | Item | Verdict |
| --- | --- | --- |
| **Confirmed, intended** | Browser/PostgREST `select` of any key column, `select=*` / `user_settings.*`, whole-row reads, predicates/ordering on key columns, direct key `INSERT`/`UPDATE`, `RETURNING` of a key | become *permission denied* — that is the goal |
| **Confirmed, intended** | `anon` loses all access | no consumer (zero `anon` statements, no code path) |
| **Confirmed, intended** | Browser can no longer write `nanobanana_base_url`, `nanobanana_model`, `updated_at`, `id` | nothing writes them from the browser |
| **Confirmed dependency** | App versions older than Slice 1 (`747d5eb`) read key columns with the session client; against the migrated table they would report every provider as "not configured" (the old resolver ignored read errors) | **Production runs `94ecd05`; do not roll the app back below `747d5eb` while Slice 2 is applied** |
| **Confirmed dependency** | A future `select()` without columns or with a non-granted column from the browser fails | already forbidden by `credential-boundary.test.ts`; new non-secret columns need an explicit `GRANT` (secure by default) |
| **Silent-failure risk** | `configuracoes/page.tsx` ignores the read error and falls back to defaults if its `select` ever includes a non-granted column | the smoke must verify that **saved values** (not defaults) render (§11) |
| **Potential risk** | Local `next dev` without `CONTENT_STUDIO_LOCAL_SERVICE_ROLE_PROJECT_REF`, Preview deployments built from commits older than `747d5eb` | local/Preview are not production-executing; Preview of current `main` is unaffected for preferences |
| **Unknown** | External consumers that read `user_settings` with an `authenticated`/`anon` JWT (BI tools, scripts, other apps, forgotten Preview deployments) | not visible in the repository; mitigated only by the §11 call-count gate and the one-step rollback |

## 5. Proposed forward migration

File: `docs/productization/sql/FUTURE_059_SLICE_2_containment.up.sql` (**proposed, not applied**; it is intentionally outside `scripts/`). One transaction, run as `postgres`:

1. `SET LOCAL lock_timeout = '5s'` — never queue behind a long lock.
2. **Precondition (aborts with no change):** table exists; RLS enabled; the column set is exactly the 21 reviewed columns; no column-level ACLs; the table ACL equals the reviewed production ACL (compared as a sorted list — `aclitem` order depends on grant history). A second run or a drifted table is rejected.
3. `REVOKE ALL … FROM anon`; `REVOKE ALL … FROM authenticated`.
4. `GRANT SELECT (16 columns)`, `GRANT INSERT (11)`, `GRANT UPDATE (11)` to `authenticated`; `GRANT DELETE` (table-level).
5. **In-transaction verification:** for `anon` and `authenticated`, no `SELECT/INSERT/UPDATE/REFERENCES` on any key column and no table-wide privilege; `anon` no column privilege; `service_role` keeps `SELECT/INSERT/UPDATE` on every key column; `authenticated` keeps the required non-secret privileges and cannot write `nanobanana_base_url`/`updated_at`. Any surprise raises and rolls everything back.
6. `NOTIFY pgrst, 'reload schema'` (delivered at commit; Supabase also reloads on DDL).

It creates **no** view, function, trigger, policy, table or column, moves no data and touches no credential. `service_role` and the owner are not modified.

## 6. Exact rollback

File: `docs/productization/sql/FUTURE_059_SLICE_2_containment.down.sql` (**proposed, not applied**). One transaction, run as `postgres`: `REVOKE ALL … FROM anon, authenticated` (this clears the column-level grants too), `GRANT ALL … TO anon, authenticated` (on PostgreSQL 17 `ALL` = `arwdDxtm`, identical to the original), then a verification block that the ACL equals the original and no column ACL remains. Measured in PGlite: privileges are identical after `up → down`; the only difference is `aclitem` **order** (anon/authenticated are re-appended), which is why both files compare sorted ACLs.

**Security tradeoff — operator approval required.** Rolling back **re-exposes the five key columns** to the owner's own JWT (and re-grants `anon` the privilege, with no rows visible). It is the only way to restore the *exact* previous state. Run it only on a written decision, treat the exposure as live until Slice 2 is re-applied, and prefer the **targeted alternative** (documented at the bottom of the file) when the failure is a missing *non-secret* column: grant just that column, which re-exposes nothing.

## 7. PGlite proof (run — 28 tests, all passing)

`lib/credentials/__tests__/slice-2-containment-pglite.test.ts` rebuilds `user_settings` from the production catalog (columns, defaults, constraints, the 4 policies, the exact pre-migration ACL, roles `anon`/`authenticated`/`service_role BYPASSRLS`, `auth.uid()` from a JWT claim) in an in-process PostgreSQL (PGlite 0.5.8 = PostgreSQL 18.3; production is 17.6), runs the SQL files above and switches roles with `SET ROLE`. PostgREST statements are reproduced **by shape**, including the `json_populate_recordset` upsert.

| Group | Proved |
| --- | --- |
| Baseline | the production exposure is real (owner reads own keys; RLS hides others; `anon` holds the privilege but sees no row); revoking one column while the table grant exists changes nothing |
| After `up` | privilege matrix (no browser role holds any privilege on any key column; `service_role` keeps all; ACL shape); owner reads all 16 non-secret columns of its own row only; **denied**: key select, `*`, `user_settings.*`, `to_jsonb(row)`, `row::text`, `row_to_json`, `WHERE`/`ORDER BY`/`count` on a key column, `length(key)`, `RETURNING key`; direct key `UPDATE`/`INSERT`/upsert (alone and smuggled with preferences); server-managed columns not browser-writable; `anon` denied everything; **the Settings PostgREST upsert works on both the insert and the conflict-update path and leaves the keys untouched**; RLS still blocks cross-user upsert/update and `user_id` re-pointing; own-row `DELETE` works, cross-user does not; the Slice 1 server path through `service_role` (proof read, single-column read, 5-column status read, key write with base URL, removal, RLS bypass) works; a **column added later is invisible to the browser** until granted |
| Guards | re-run rejected without change; column drift aborts; ACL drift aborts; a poisoned grant makes the in-transaction verification fail and the **whole transaction rolls back** |
| Rollback | exact ACL restored (and the tradeoff demonstrated); `up → down → up`; the targeted alternative re-exposes nothing |
| Minimality | the upsert fails without `UPDATE (user_id)` |
| Code ↔ SQL | the allowlists + secret list = exactly the 21 columns, no overlap; the SQL file grants exactly the allowlists; the set of files touching `user_settings` is the known 5; every browser `select` is a subset of the SELECT list and never `*`; the browser upsert keys equal the INSERT/UPDATE list exactly and no other browser write exists |

**What PGlite does not prove:** Supabase's PostgREST (its real SQL, schema cache, `Prefer` handling, error mapping), GoTrue JWT claims and role switching, the Supabase role bootstrap and event triggers, Postgres 17 specifics, other Supabase services reading the table. It checks the SQL semantics, not the platform.

## 8. Staging validation plan (**proposed — not run**)

There is **no staging environment**, and `list_branches` is empty. A Supabase branch is built by replaying the migration history, and that history (`list_migrations`: first entry `033…`) does not contain the creation of `user_settings` (`scripts/003`), so a branch would not contain the table. A faithful staging therefore needs one of:

1. A throwaway Supabase **project** restored from a **schema-only** dump of production (no data, no keys), then dummy users — recommended. Cost and project creation need approval.
2. A branch/project seeded with the reconstructed `user_settings` DDL + policies + ACL from §2 (what the PGlite fixture already contains) plus Supabase's normal role bootstrap.

Steps (dummy users `A`, `B`; dummy values `sk-DUMMY-…`; no real credential anywhere):

1. Record `relacl`, `attacl`, `has_column_privilege` matrix. Create users A and B, then **before** applying, with A's JWT: `GET /rest/v1/user_settings?select=openai_api_key` returns the dummy key (baseline proof of the exposure) — only ever against staging.
2. Apply `up.sql` (transaction + in-transaction verification). Confirm `NOTIFY` took effect (`GET /rest/v1/` OpenAPI no longer lists key columns for A).
3. With A's JWT through real PostgREST: `select=theme,…` (all 16) → 200 own row only; `select=openai_api_key` → denied (HTTP 401/403, code `42501`); `select=*` → denied; `?select=user_id&openai_api_key=like.sk-*` → denied; `PATCH {openai_api_key:…}` → denied; `POST` upsert with a key column → denied; `PATCH {theme:…}` → 200; supabase-js `upsert({user_id,…10 prefs}, {onConflict:'user_id'})` → ok and keys unchanged; `PATCH {nanobanana_base_url}` → denied. With B's JWT: cannot see/alter A's row. With `anon` key: 401/403 on everything.
4. Deploy the current app (`94ecd05`) against staging (service role + dummy provider keys, **mock provider transport** — no paid call): Settings load/save of preferences; `PUT/DELETE /api/settings/providers/openai` create/replace/remove; `GET /api/settings/providers` → statuses only; a resolver call (`getProviderConfigurationStatuses`) via the app; NanoBanana base URL saved; confirm no key in any browser-visible response.
5. Apply `down.sql`; confirm ACL restored and key readable again (documents the tradeoff); re-apply `up.sql`.
6. Concurrency: run a Settings upsert loop while applying `up.sql`; expect no 5xx beyond the brief window and no partial state.

Pass criteria = every expectation above; any deviation → fix the SQL in the repo, re-run PGlite, repeat staging.

## 9. Provider and Settings compatibility verdict

| Area | Verdict (static + PGlite; staging pending) |
| --- | --- |
| Settings → API configure/replace/remove, statuses | unaffected — routes use the Slice 1 service-role store; the ownership proof reads `user_id` (granted) |
| Settings preferences load/save, theme bootstrap, `/imagens` preferences | unaffected — selects ⊆ SELECT list, upsert = INSERT/UPDATE list exactly (test-enforced) |
| NanoBanana base URL | read via session client (granted); written by the server route only |
| OpenAI, Gemini, NanoBanana, Kling REST execution | unaffected — resolver reads via the store (`service_role`) |
| Kling MCP | unaffected — encrypted tables, no relation to `user_settings` |
| Replicate | no consumer; column stays (retired later) |
| Reviews, usage, FUTURE-057 automation | unaffected — preferences are read with granted columns |
| Anything running an app build older than `747d5eb` | **breaks credential reads silently** (see §4) |

## 10. Security review

- **`service_role` bypasses RLS.** By design it is the only role that can read keys after this slice. Authorization stays in the Slice 1 store: server-verified owner id, ownership proof through the caller's client (works after the migration because `user_id` remains granted), single-row single-column queries, no request-derived owner. Residual: a route passing a service-role client with a request-derived id would be authorized — a caller invariant, unchanged from Slice 1.
- **Unexpected service-role inputs.** The store rejects blank/padded/over-long owner ids and prototype-style provider names before any query; the service-role key is never exposed to the browser.
- **PostgREST schema cache.** Privilege changes are picked up on DDL (Supabase event trigger) and by the explicit `NOTIFY`; a stale cache could only show OpenAPI metadata, not widen access — authorization is evaluated by Postgres at execution.
- **Permission inheritance.** `authenticator` is `NOINHERIT`; `anon`/`authenticated` inherit from no role; no other role holds an ACL entry. No inherited path.
- **Views / functions / triggers.** None depend on the table; no `SECURITY DEFINER` function executable by browser roles touches it; the migration adds none.
- **Partial revocation.** Impossible by construction: one transaction with in-transaction verification; precondition makes re-runs and drift abort.
- **Concurrent Settings writes.** Privileges are checked per statement; a statement that starts before commit uses the old ACL, one after uses the new. The `lock_timeout` prevents queueing; an upsert that races the commit can fail once with *permission denied* only if it includes a non-granted column (none do).
- **Dormant accounts.** Privileges are role-level, not per-user: dormant users are covered identically; no data is touched.
- **Credential-status read failures.** Slice 1 already reports `unavailable`, never "missing"; after the migration a failure of the *proof read* would surface the same way.
- **Realtime / GraphQL.** Table is not published; `pg_graphql` is not installed.
- **External integrations.** Unknown (§4); controlled by the call-count gate and rollback.
- **Remaining exposure after Slice 2.** Plaintext at rest (Slice 3), `service_role` and DB-admin access, backups, and the keys printed in an earlier tool transcript (owner rotation pending). Slice 2 closes the *browser/PostgREST* channel only.

## 11. Operator execution runbook (**not executed**)

Roles: **operator** applies SQL (`postgres`); **engineer** runs verification; a **second person** approves rollback.

1. **Gate 0 — approvals recorded:** this document accepted; staging proof (§8) completed and attached; rollback decision-maker named.
2. **Gate 1 — deployment state:** Production is on `main` ≥ `747d5eb` (`gh api …/deployments`), and no older production alias or Preview is used by real users. Do not use "instant rollback" to a deployment older than `747d5eb` while the migration is applied.
3. **Gate 2 — metadata still as reviewed:** `relacl` and `attacl` equal §2; the 21-column list is unchanged; policy list unchanged (the precondition also enforces this).
4. **Gate 3 — no browser-role key traffic:** re-run the aggregate query of §4 (`pg_stat_statements`, counts only). The `authenticated` key-referencing select-shaped total must still be **504** and insert-shaped **10** (or higher only with an explained, non-user source). Growth ⇒ **STOP** and find the caller.
5. **Gate 4 — window:** low-traffic period; engineer on call; Vercel and Supabase dashboards open.
6. **Apply:** run `up.sql` as `postgres` in one transaction. The script verifies itself and aborts on any anomaly.
7. **Immediate catalog check** (metadata only): `relacl`; `has_column_privilege` matrix for `anon`/`authenticated`/`service_role` × key columns × SELECT/INSERT/UPDATE.
8. **Smoke (existing authenticated browser session, no key values):** Settings loads and shows **saved** preference values (not defaults — the page hides read errors); change a harmless preference and save, reload, value persists; `GET /api/settings/providers` returns the same statuses as before (OpenAI, Gemini, NanoBanana, Kling configured; Replicate missing; none `unavailable`); `/imagens` loads with the saved defaults; theme persists after reload. For a PostgREST probe use **only** a separately approved disposable dummy user and non-secret assertions (expected: key-column select → permission denied; preferences → 200) — never the owner's real key, and never before the migration is applied.
9. **Monitor for 30 minutes and 24 hours, no secrets:** Vercel runtime logs for `[credential-store]` lines and 5xx on `/api/settings/*`; Supabase Postgres logs for `permission denied for table user_settings` / `column … of relation "user_settings"` (counts and the *statement role*, never parameters); the §4 aggregate query again.
10. **Failure detection:** Settings shows defaults instead of saved values; save toast "Não foi possível salvar as configurações"; any provider `unavailable`; any new `permission denied … user_settings`.
11. **Stop / rollback conditions:** a non-secret feature broken → apply the **targeted GRANT** for the missing column (no re-exposure) and re-verify; if that is insufficient or the cause is unclear → second-person approval → `down.sql`, record that the key exposure is live, re-plan. Do not edit environment variables or application code under pressure.
12. **After:** record outcome in this document; keep `down.sql` available for the soak period; Slice 3 may then proceed.

**Stop conditions (any ⇒ do not apply / halt):** staging proof missing or failed; Gate 1–3 not met; precondition raises; verification raises; a smoke step fails; the second-person rollback approver is unavailable.

## 12. Residual risks and open decisions

1. **Staging.** Needed before Production (recommend a throwaway project from a schema-only dump, with approval for cost).
2. **Unknown external consumers** of `user_settings` with a browser-role JWT; mitigated by the Gate 3 count.
3. **`DELETE` left as is.** An owner can still delete its own row (and thereby its stored keys) from the browser; harmless to confidentiality, a possible follow-up to make deletion server-only.
4. **Same hygiene exists project-wide.** Default ACLs grant `arwdDxtm` to `anon`/`authenticated` on every new `public` table; other tables rely on RLS alone. Out of scope here; recommend a separate audit and a default-privilege tightening decision.
5. **`updated_at` is not maintained** in production (v1 trigger absent) — unrelated, noted.
6. **Plaintext at rest and the unrotated exposed keys** remain until Slice 3 and owner action.
7. **App-version coupling:** Slice 2 permanently requires `main` ≥ `747d5eb`; the runbook forbids older rollbacks.
8. **Scripts numbering.** On approval the SQL is added as the next numbered script (after `062`) and recorded through the normal migration channel; this slice deliberately did not add it to `scripts/`.

## 13. Final status

**NEEDS ADDITIONAL STAGING PROOF** — not SAFE TO APPLY (static analysis and PGlite are insufficient by the mission's own rule) and not BLOCKED (no secret or assumption about credential values was needed). Recommended next step: approve a throwaway staging project (§8), run it with dummy users, then re-issue the verdict.

FUTURE_059_BYOK_CREDENTIAL_SLICE_2_DESIGN_READY
