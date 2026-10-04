# VIDEO_GENERATION_MIGRATION_LEDGER_OPERATIONAL_RECONCILIATION_V1 (FUTURE-036, slice 036E-B)

Operational audit, status reconciliation, and future process governance for video generation database migrations.

## Status

- **036A — VIDEO_GENERATION_WORKING_STATE_CORE_V1:** CLOSED
- **036B — VIDEO_GENERATION_SESSION_PERSISTENCE_AND_API_V1:** CLOSED
- **036C — VIDEO_GENERATION_WORKSPACE_AUTOSAVE_V1:** CLOSED
- **036D — VIDEO_GENERATION_VISIBILITY_TERMINOLOGY_AND_LEGACY_REUSE_V1:** CLOSED
- **036E-A — VIDEO_GENERATION_CALLER_WIDE_IDEMPOTENCY_HARDENING_V1:** CLOSED
- **036E-B — MIGRATION LEDGER OPERATIONAL RECONCILIATION:** CLOSED (DOCUMENT-ONLY)
- **036E-C — FINAL FUTURE-036 CLOSURE GATES AND EVIDENCE:** NEXT

---

## 1. Factual Historical Migration Inventory

A comprehensive catalog audit verified the status of migrations associated with the video generation domain:

| Migration | Repository Script | Intended Schema Changes | Production Database Status | Migration Ledger Status (`schema_migrations`) | Classification |
|---|---|---|---|---|---|
| **039** | `scripts/039_create_video_generations.sql` | Creates `video_generations` table, indexes (`idx_video_generations_*`), RLS policies, and mode/source constraints. | **PRESENT** (Verified via catalog read) | **ABSENT** | HISTORICAL LEDGER-ONLY DRIFT |
| **045** | `scripts/045_library_files_source_image.sql` | Adds `source_image_id` column to `library_files`, unique index `uq_library_files_active_source_image`. | **PRESENT** (Verified via catalog read) | **ABSENT** | HISTORICAL LEDGER-ONLY DRIFT |
| **049** | `scripts/049_video_generation_sessions.sql` | Creates `video_generation_sessions`, indexes, RLS, triggers; adds `session_id`, `client_request_id`, `request_fingerprint`, FK constraints, immutable trigger to `video_generations`. | **PRESENT** (Verified via catalog read) | **ABSENT** | HISTORICAL LEDGER-ONLY DRIFT |

*Note: The physical Production database contains all intended tables, columns, indexes, foreign keys, triggers, and Row Level Security policies. There is zero physical schema drift.*

---

## 2. Canonical Decision: DOCUMENT-ONLY

**The historical migrations 039, 045, and 049 will NOT be retroactively inserted into `supabase_migrations.schema_migrations`.**

### Rationale:
1. **No Canonical Timestamp Authority:**
   The official Supabase CLI repair tooling (`supabase migration repair --status applied <version>`) modifies remote migration history metadata without executing DDL, but it requires a canonical migration version matching the official naming convention (e.g., `YYYYMMDDHHMMSS_<name>.sql`). The historical repository migrations exist as numbered files in `scripts/` (`scripts/039_...`, etc.) without canonical 14-digit timestamps.
2. **Synthetic History Avoidance:**
   Inventing retroactive timestamps today would create artificial migration history that does not reflect when or how these migrations were actually applied.
3. **Physical Schema Integrity:**
   The Production database already reflects the complete physical schema required by `036A`, `036B`, `036C`, `036D`, and `036E-A`.
4. **Prohibition of DDL Re-execution:**
   Re-running DDL against existing production tables is strictly prohibited.
5. **No Hand-Editing of Migration Metadata:**
   Manual `INSERT`, `UPDATE`, or `DELETE` statements against `supabase_migrations.schema_migrations` are explicitly rejected. All ledger entries must be managed exclusively through official migration tooling when supported.

---

## 3. Operational Impact & Risk Assessment

### Current Runtime Impact:
**No current automated deployment or runtime impact.**
- The production hosting environment (Vercel) runs standard Next.js application builds (`next build`).
- Build and deployment pipelines do not invoke automated database migration runners (such as `supabase db push` or CLI migration hooks).
- The repository does not currently use an automated `supabase/migrations/` deployment path.
- Therefore, the absence of versions 039, 045, and 049 from `schema_migrations` does not impact application availability, user operations, or automated builds.

### Residual Operational Risks:
1. **Future Tooling Adoption:**
   If the engineering team transitions to native Supabase CLI migration workflows in CI/CD, the historical numbering discrepancy must be accounted for during baseline initialization to prevent the migration engine from attempting to re-apply historical DDL.
2. **Disaster Recovery & Environment Bootstrapping:**
   Under the current historical state, reconstructing a database from zero still depends on legacy scripts and operational knowledge. Future adoption of the canonical migration workflow must also define a reproducible bootstrap/rebuild procedure so scripts/*.sql does not remain the long-term migration authority.
3. **Operator Understanding:**
   Operators inspecting the Supabase Dashboard "Migrations" tab must understand that historical migrations 039, 045, and 049 are present in the database schema despite being unlisted in the UI ledger.

---

## 4. Forward-Looking Migration Governance Process

To prevent recurrence of ledger drift in future database changes, the following operational rules are established:

1. **Future Migration Standardization:**
   Before the next schema-changing initiative, the repository should adopt a single canonical migration location and format matching official Supabase conventions:
   `supabase/migrations/<YYYYMMDDHHMMSS>_<name>.sql`
2. **Real SQL in Migration Files:**
   Every migration file must contain the real DDL/DML statements. Creating empty or dummy migration files to mask manual database alterations is strictly forbidden.
3. **Unified Application Mechanism:**
   Production schema migrations must be applied through a single documented, repeatable procedure rather than ad-hoc console pasting.
4. **Emergency SQL Editor Protocol:**
   Direct execution in the Supabase SQL Editor is restricted to critical emergency unblocking scenarios. If emergency execution is necessary:
   - The exact, real SQL must be committed to the repository in the canonical timestamped migration file.
   - Remote migration history must be reconciled using the official supported command:
     `supabase migration repair --status applied <version>`
     after verifying schema equivalence.
   - Under no circumstances should DDL be re-executed against active production tables.
   - Under no circumstances should `supabase_migrations.schema_migrations` be edited via raw manual `INSERT`/`UPDATE` queries.
5. **Audit Trail:**
   Every future migration must record: migration version, associated commit/PR, verification evidence, and application method.

---

## 5. Scope Safeguards

- Zero database migrations created or executed in this slice.
- Zero DDL executed in Production.
- Zero manual queries against `supabase_migrations.schema_migrations`.
- Zero changes to application runtime code or database credentials.
