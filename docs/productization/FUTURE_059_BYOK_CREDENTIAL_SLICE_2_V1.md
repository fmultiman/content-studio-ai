# FUTURE-059 Slice 2 — Production column-privilege containment: execution record

Status: **APPLIED AND VERIFIED IN PRODUCTION on 2026-10-11.** The approved containment migration from `FUTURE_059_BYOK_CREDENTIAL_SLICE_2_DESIGN_V1.md` (validated locally in `…_LOCAL_STACK_PROOF_V1.md`) was applied to the Content Agent Studio Supabase Production project on the user's explicit authorization. Hosted staging was waived by the user, who accepted the documented residual risk.

**What is and is not true now.**
- The browser roles (`authenticated`, `anon`) **no longer hold any privilege** on the five provider-key columns of `public.user_settings`; PostgREST can no longer return or overwrite them for a browser session.
- The keys are **still plaintext at rest** (Slice 3 is not started) and remain readable/writable by `service_role` (the server-only store from Slice 1) and by database administrators.
- No credential value was read, printed, copied, exported, rotated or changed during this operation.

## 1. Target, baseline and artifacts

| Item | Value |
| --- | --- |
| Supabase project | `nuhdhnasuohizxtmyiju` — *Content Agent Studio*, `ACTIVE_HEALTHY`, PostgreSQL 17.6.1.105, `us-east-1` |
| `origin/main` at start | `ec489ce0c67e9193a538111bcafb32d579b046d5` |
| Production deployment at start | GitHub deployment `6997892626`, environment Production, SHA `ec489ce`, state `success` (created 2026-10-11T15:46:40Z). Minimum compatible SHA `747d5eb` is an ancestor of `main` |
| Forward SQL | `docs/productization/sql/FUTURE_059_SLICE_2_containment.up.sql` — git blob `4b5b99d1050d52c889abe5b2802a70fd7fad44bc`, 8192 bytes, sha256 (LF) `1d08d40288103403682e32c6bbaf456adcca4d51258f408af6fb0863b058eb2b` |
| Rollback SQL (not run) | `docs/productization/sql/FUTURE_059_SLICE_2_containment.down.sql` — git blob `aa985aaf88399935b39163994bff52fc7d83b59b`, 2535 bytes, sha256 (LF) `cee2d0872db27311cbbef2b1e21790de5535f6f9dc00f9805f1299b38ea31ef4` |
| Mechanism | Supabase MCP `apply_migration` (the project's migration channel), executed as `postgres` (the table owner and grantor of every existing ACL entry). The SQL was taken verbatim from the blob on `main`; nothing was rewritten |
| **Migration identifier** | name `063_future_059_slice_2_user_settings_column_containment`, version **`20261011162816`** (recorded in `supabase_migrations`; the previous last entry was `061_create_provider_pricing_versions`) |
| Applied at | **2026-10-11 16:28:16 UTC** (version timestamp); first post-apply catalog read 16:28:21 UTC |

The header comment inside the SQL file still reads "PROPOSED, NOT APPLIED"; the file was applied byte-for-byte as reviewed and its comments were not edited, so this document is the record that it was applied.

## 2. Preflight (read-only) — all invariants matched the design

| Check | Result |
| --- | --- |
| Executing role | `postgres`; table owner `postgres` |
| Table ACL (sorted) | `anon=arwdDxtm/postgres, authenticated=arwdDxtm/postgres, postgres=arwdDxtm/postgres, service_role=arwdDxtm/postgres` — exactly the reviewed state the guard requires |
| Columns | exactly the 21 reviewed columns; **0** column-level ACLs |
| RLS | enabled, not forced; **4** policies (`select/insert/update/delete`, `auth.uid() = user_id`); **0** user triggers |
| Historic browser-role traffic naming key columns (`pg_stat_statements`, counts only) | `authenticated`: 504 select-shaped, 10 insert-shaped calls — **unchanged** from the 15:06, 15:10 and 15:38 UTC baselines; no entry first seen after Slice 1; `anon`: none. Total `authenticated` statements touching `user_settings` unchanged at 1080 calls. (A gate, not proof that no external consumer exists.) |
| Credential records (counts and total length only) | 4 users; OpenAI 2 (328 chars total), Gemini 1 (53), NanoBanana 1 (32), Kling 1 (57), Replicate 0 |
| Non-secret preferences | recorded for all 4 rows (used for the persistence check below) |
| Rollback | `down.sql` blob hash recorded; executable through the same channel; targeted-grant alternative documented |

## 3. Execution result

`apply_migration` returned `{"success":true}`. The script is one explicit transaction with its own precondition (`DO $guard$`) and in-transaction verification (`DO $verify$`); both passed, so the transaction committed. No partial state can exist: the post-apply catalog shows the complete intended ACL (below), and the migration is present in `list_migrations`.

## 4. Privilege matrix — before and after (metadata only)

Table ACL (`relacl`):

| | Before | After |
| --- | --- | --- |
| `postgres` (owner) | `arwdDxtm` | `arwdDxtm` |
| `service_role` | `arwdDxtm` | `arwdDxtm` |
| `authenticated` | `arwdDxtm` (table-wide) | **`d`** (DELETE only, table level) + column-level grants below |
| `anon` | `arwdDxtm` (table-wide) | **none** |

Final `relacl`: `{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,authenticated=d/postgres}`. Column ACLs: **16** (previously 0), all for `authenticated` only (`id`, `created_at`, `updated_at`, `nanobanana_base_url`, `nanobanana_model` = `r`; `user_id` and the 10 preferences = `arw`).

Effective privileges (`has_column_privilege`, all 21 columns × SELECT/INSERT/UPDATE × 3 roles):

| Column group | `anon` | `authenticated` | `service_role` |
| --- | --- | --- | --- |
| 5 provider-key columns (`openai_api_key`, `gemini_api_key`, `nanobanana_api_key`, `kling_api_key`, `replicate_api_key`) | no S/I/U (before: all true) | **no S/I/U (before: all true)** | S/I/U |
| `user_id` + 10 preferences | none | S/I/U | S/I/U |
| `id`, `created_at`, `updated_at`, `nanobanana_base_url`, `nanobanana_model` | none | S only (not writable) | S/I/U |

Unchanged: RLS enabled with the same 4 policies; owner and `service_role` ACL entries; default privileges for new tables (deliberately not touched).

## 5. Credential records are unchanged

Re-read after the migration and after all smoke steps: identical counts and identical total lengths (OpenAI 2/328, Gemini 1/53, NanoBanana 1/32, Kling 1/57, Replicate 0/0), 4 users, 4 policies, RLS on. No key value was selected at any point; no `SELECT *` was issued.

## 6. Verification in Production

Authenticated session of the account owner (existing browser session), no paid generation, no provider call, no key change.

| Check | Result |
| --- | --- |
| `GET /api/settings/providers` | 200; entries contain only `status` and `connectionMethod`; OpenAI, Gemini, NanoBanana, Kling REST **configured**; Replicate **missing**; none `unavailable` (this path now reads keys through the service-role store with the session client doing only the `user_id` proof) |
| `GET /api/provider-connections` | 200; Kling MCP `mcp_oauth` **connected** |
| Settings → API cards | OpenAI, NanoBanana, Kling API, Gemini "Configurado ✓"; Replicate "Não configurado"; Kling MCP section present; no "Indisponível no momento"; no stuck loading state |
| Saved non-default preferences reload | the page, freshly loaded after the migration, showed the evaluator enabled and the refinement slider at 3 (the column defaults are *off* and *2*), notifications e-mail on / browser off, automation off, default model GPT Image 2 — matching the database, so these are real reads, not fallback defaults. `/imagens` also loads (it reads four preference columns) |
| Settings write (controlled, reversible, non-secret) | toggled "Notificações do Navegador" off→on and saved: success banner, database value changed to `true`, **every other column of that row and of the three other rows unchanged**; a full page reload showed `true`; toggled back and saved: database value `false`. All four rows' preferences are **identical to the pre-migration snapshot** |
| Edge-log evidence after the migration (`query_logs`, aggregate fields only: method / path / status / role) | requests to `user_settings`: `authenticated` GET ×11 → 200, none naming a key column; `authenticated` POST ×2 → 200 (the upserts above); service-role (secret-key, no JWT role) GET ×4 naming key columns → 200 (the Slice 1 store); OPTIONS ×3 → 200. **No 4xx/5xx** and no PostgreSQL error rows in the window |
| Browser exposure | no response in the verified flows carried a credential field; provider entries expose status only. **Direct key-denial was deliberately not probed against Production** (any such request would have returned a real key had the containment failed); it is established by the effective-ACL matrix above, the PGlite suite and the 32-test local PostgREST/JWT suite (403 / SQLSTATE `42501` for every query form) |

## 7. Failure and rollback

No failure occurred; **no rollback was performed**. Readiness: `down.sql` (hash above) restores the exact original ACL but **re-exposes the five key columns** to the owner's own JWT and re-grants `anon` the privilege — it requires a written decision and a second approver. The targeted alternative (a one-column `GRANT … TO authenticated`, documented at the end of `down.sql`) restores a missing *non-secret* column without re-exposure and is the preferred recovery. **Do not roll the application back below `747d5eb` while containment is active** — older builds read the key columns with the browser session and would silently report every provider as not configured.

## 8. Compatibility issues

None observed. Noted for the record: (a) no migration script was added to `scripts/` (the SQL lives in `docs/productization/sql/` and the Supabase migration history); (b) the opt-in local-stack suite and PGlite suite both encode these exact grants, so a future `user_settings` column or browser query will be caught by tests before it breaks Settings (`select()` without columns and a bare `return=representation` are now denied for the browser role).

## 9. Remaining risks and monitoring

- **Plaintext at rest** until Slice 3; `service_role`, database administrators and backups can still read the keys.
- **External consumers**: unknown, never proven absent. The post-apply window is short; keep watching Supabase `postgrest_logs`/`edge_logs` (status, path, role — never bodies) and Postgres errors for `permission denied … user_settings` for 24 hours and after any new deployment; a new error implies a consumer using a browser role, to be fixed with a targeted grant or by moving it server-side.
- **`DELETE` retained** for the owner (own row only); server-only deletion is a documented follow-up.
- **OpenAPI** still lists the key column *names* to `authenticated` (no values, no access).
- **Default privileges** for newly created `public` tables still grant `arwdDxtm` to `anon`/`authenticated`; every other table relies on RLS alone — a separate security audit.
- **Local development** now needs `CONTENT_STUDIO_LOCAL_SERVICE_ROLE_PROJECT_REF` to manage credentials (unchanged since Slice 1).
- **Exposed keys**: the provider keys printed in an earlier tool transcript are still not rotated; owner action required before any backfill.

## 10. Remaining FUTURE-059 work

Slice 3 (encrypted `provider_api_credentials`, dual-read, lazy backfill, dual-write), Slice 4 (cut-over and soak), Slice 5 (retire plaintext columns and Replicate) — none started, each needs separate approval. Also open: key rotation by the owner, server-only deletion, and the project-wide default-privilege audit.
