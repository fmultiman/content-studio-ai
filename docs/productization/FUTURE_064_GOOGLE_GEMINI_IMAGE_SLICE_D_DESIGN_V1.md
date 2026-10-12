# FUTURE-064 Slice D — Image-output pricing registry: audit, reviewed SQL and local proof (DESIGN)

Status: **design + proof only at the time of writing. Later: the cost-derivation code merged (`7e36cf5`) and the reviewed up SQL was applied to Production on 2026-10-12 06:50:09 UTC (migration `20261012065009`); execution evidence is in `FUTURE_064_GOOGLE_GEMINI_IMAGE_SLICE_D_V1.md`. The Gemini image switch is OFF.**
Baseline: `origin/main` `3a702a1` (Slices A–C merged). Reads: Slice A/B/C docs, `scripts/061`/`062`, `lib/usage/pricing/*`, the Usage UI, the live registry (read-only).

## 1. Actual pricing schema findings (live, read-only, 2026-10-12)

`public.provider_pricing_versions` (scripts/061 + seed 062), owner `postgres`, RLS on:

| Item | Finding |
|---|---|
| Rows | 22: Gemini 3.5 Flash ×9, Gemini 3.5 Flash-Lite ×9 (input/cached_input/output × standard/flex/priority), Kling `kling-v3` ×1 (unit), OpenAI `gpt-4o-mini` ×3. **No row for any image model.** No closed windows yet. Digest of all rows `md5(string_agg(t::text,'|' ORDER BY id))` = `6b65ae838be0bfd1046bfcd7f064b1f1` (operator cross-check). |
| The one blocker | `provider_pricing_versions_usage_category_check`: `CHECK (usage_category = ANY (ARRAY['input','cached_input','output','unit']))`. `image_output` is rejected by the database. |
| Everything else is category-agnostic | UNIQUE `(provider, model, usage_category, service_tier, effective_from)` and the overlap trigger function treat `usage_category` as opaque text; the lookup index is `(provider, model, usage_category, service_tier, effective_from DESC)`. No view, function (other than the trigger function) or policy references the list. |
| Access | One policy `provider_pricing_versions_select_authenticated` (SELECT, `authenticated`); grants: `authenticated` SELECT, `service_role` SELECT, `postgres` all; nobody can write at runtime. Unchanged by the proposal. |
| Code | `registry.ts` `PRICING_CATEGORIES = [input, cached_input, output, unit]`; `toPricingVersion()` **drops** a row whose category is unknown (so a new category is invisible to old code, never mis-loaded). `derive.ts` `planGemini` prices `input_tokens` (+cached split), `output_tokens` and `tokens`+`thoughts` (as `output`); every other `tokens` row is `unit_not_priceable` — today's Slice C `image_output` / `output_unattributed` rows land there on purpose. |
| Ledger side (Slice C) | IMAGE output = unit `tokens` + `usage_category: image_output`; TEXT output = `output_tokens`; thinking = `tokens`+`thoughts`; unattributed = `tokens`+`output_unattributed`; model = official id; `occurred_at` decides the price version. No ledger change is needed for pricing. |

## 2. Current official Google prices (verified against the live page, 2026-10-12 ~04:03–04:07 UTC)

Source: <https://ai.google.dev/gemini-api/docs/pricing> — page states "Last updated 2026-10-09 UTC" and publishes no price history. Verified twice with two independent extraction prompts; **Standard paid tier, USD per 1M tokens**:

| Model | Input (text / image / video) | Output — text and thinking | Output — images | Per-image figure on the page |
|---|---|---|---|---|
| `gemini-nano-banana-2.1` (Nano Banana 2.1) | **1.50** | **7.50** | **30.00** | 1K = 1,120 tokens = $0.0336 (2K = 1,680 = $0.0504; 4K = 3,780 = $0.113) |
| `gemini-3.1-flash-lite-image` (Nano Banana 2 Lite) | **0.25** | **1.50** | **30.00** | 1K = 1,120 tokens = $0.0336 (1K only) |

These match the figures in the approved product decision. 30 × 1,120 / 1,000,000 = **USD 0.0336** (asserted in the proof). Also verified: **no free tier**; **Flex and Priority prices are not shown** for either model; **context caching is not available**; no prompt-size threshold is shown; **Batch exists** (Nano Banana 2.1 / Lite: input 0.75 / 0.125, text and thinking 3.75 / 0.75, image 15.00 / 15.00) but is a separate API surface that never reports a service tier and Content Studio never uses it — **not seeded, never mixed with Standard**. The extraction tool summarizes the page; the operator should eyeball the page against the SQL header immediately before applying (checklist in §9).

## 3. Reviewed SQL (proposed, NOT applied)

- `docs/productization/sql/FUTURE_064_SLICE_D_image_output_pricing.up.sql`
- `docs/productization/sql/FUTURE_064_SLICE_D_image_output_pricing.down.sql`

Forward (one transaction, `lock_timeout 5s`, table owner):
1. **Fingerprint** of every price row that is not a V1-model row (count + md5), in a transaction-scoped temp table.
2. **Guard** (aborts before changing anything): table exists; RLS on; exactly the one reviewed policy; privileges read-only (`has_table_privilege`, semantic, not an ACL string — portable between PGlite and Supabase); overlap trigger and version key present; the category constraint is **exactly** the pre- or post-migration definition; the V1 models carry **only** the reviewed seed (any other history, a cached/flex/priority price, a different date → abort); no `image_output` row exists for an unapproved model.
3. **Widen the CHECK** in one atomic `ALTER TABLE … DROP CONSTRAINT …, ADD CONSTRAINT …` to `{input, cached_input, output, image_output, unit}` (skipped when already widened). Every existing category stays valid.
4. **Insert six versions** with `ON CONFLICT ON CONSTRAINT provider_pricing_versions_version_key DO NOTHING`: for each V1 model `input`, `output` (text & thinking) and `image_output`; tier `standard`, USD, `tokens` per 1,000,000, `effective_from = 2026-10-12T00:00:00Z`, basis `observed_at_source` (the day the price was observed; **nothing back-dated**, executions before it stay unpriced, exactly the 061/062 convention), source URL/label and `retrieved_at = 2026-10-12T04:05:00Z`, notes with the informational per-image figures.
5. **Verify** (any failure rolls back everything): constraint equals the post definition; every non-V1 row is byte-identical (count + digest); the V1 models have **exactly** the six reviewed rows with exactly the reviewed values; privileges unchanged.
6. `NOTIFY pgrst, 'reload schema'`.

Safe to re-run (recognizes the exact post-state; drift of any kind aborts). Not touched: `provider_usage_events`, any credential or grant, any other model — **no price for `gemini-3-pro-image`, `gemini-3.1-flash-image`, `gemini-2.5-flash-image`, cached input, Batch, Flex, Priority, 2K/4K**. Historical prices cannot be overwritten (the guard refuses unexpected history, the unique key and overlap trigger still apply, a future change is "close the old row + insert a new one").

Rollback (§10) deletes exactly those six rows, only if they are still byte-for-byte what was seeded, then narrows the CHECK.

## 4. Cost-derivation plan (design only — `derive.ts`, `registry.ts`, `aggregate.ts` are NOT modified here)

Smallest change set for the later implementation PR (a working, tested prototype lives in `lib/usage/pricing/__tests__/image-pricing-prototype.ts`; production code does not import it):

| File | Change |
|---|---|
| `registry.ts` | `PRICING_CATEGORIES += 'image_output'` (the loader then keeps those rows). |
| `derive.ts` | `planGemini`: `unit === 'tokens' && usageCategory === 'image_output'` → one line, category `image_output`. `tokens` + `output_unattributed` → `unavailable('output_modality_unattributed')` (new reason; same "unpriced" outcome as today, clearer wording). Tier selection for `operation === 'image_generation'`: reported tier wins; when **nothing** was reported use the model's **sole registry tier**, flagged by the new assumption `service_tier_sole_registry_tier`. Everything else untouched. |
| `presentation.ts` | pt-BR texts for the new reason and assumption. |
| `aggregate.ts` | `EstimatedCostSummary.complete` = every row priced (see §6). |
| `components/settings/usage-history.tsx` | "parcial" label when `!complete` (see §6). |
| tests | `pricing.test.ts` category list pins; usage-history tests for the label. |

Dimension mapping (each ledger row is priced independently; `totalTokenCount` is never a row, so it is never priced twice):

| Ledger row | Billable line | Rate (Nano Banana 2.1 / Lite) |
|---|---|---|
| `input_tokens` (prompt, incl. any cached subset) | `input` (+`cached_input` split if cached tokens reported — no cached price exists for these models, so that row becomes `unavailable`, never guessed) | 1.50 / 0.25 |
| `output_tokens` (TEXT modality) | `output` | 7.50 / 1.50 |
| `tokens` + `thoughts` | `output` (Google's "text and thinking" rate, priced once) | 7.50 / 1.50 |
| `tokens` + `image_output` | **`image_output`** — never `output` | 30.00 / 30.00 |
| `tokens` + `output_unattributed` | **none — unpriced (approved decision)** | — |
| tool-use prompt tokens | existing rule: `ambiguous` | — |

**Service tier.** The pricing page offers only Standard (and Batch) for these models, our route is real-time `generateContent` and never requests another tier, and the response may or may not echo `usageMetadata.serviceTier` for image models (unverified until the authorized smoke). Therefore: a **reported** tier is always honored — a reported `flex`/`priority` gets *no* price (`no_pricing_for_category`), never Standard; when the response reports **nothing**, Standard is selected **only** if the registry prices exactly one tier for that model (the same evidence the Kling rule uses), only for image-generation rows, and the estimate carries an explicit assumption; the moment a second tier is ever added to the registry for the model the fallback switches itself off and the row becomes `ambiguous`. Other operations on the same model keep the strict rule. **Decision D1** below.

## 5. `output_unattributed` (approved decision, enforced)

Left permanently **unpriced**: no inference that unattributed tokens are image tokens, even for an image-only request, and no `$0`. The row shows "Preço indisponível" with the reason "A saída não informou a modalidade, então não é convertida em valor." Cost of a known component (e.g. input) is still shown on its own row.

## 6. Partial vs complete cost — UI audit and design

Audit of `usage-history.tsx` / `aggregate.ts` / `presentation.ts`:
- Cost is derived **per ledger row** (per billable dimension), never per Attempt. Per row the UI is honest: an estimated row shows the amount, an unpriced row shows "Preço indisponível" with a reason tooltip, nothing is shown as `0`.
- The aggregate block shows "Custo estimado (preço de tabela): US$ X (N registros com preço)" and, underneath, "M registros sem preço disponível — não entram no total e não valem zero". The **headline is not labelled partial** and the caveat is a separate small line, so an image execution with priced input but unpriced output could be read as a final total. This is a pre-existing property for every provider, but image generation makes partial executions likely (unattributed output), so it must be fixed with this slice.
- The API deliberately exposes no resource ids, so the UI cannot group rows by execution today.

Design: (1) `summarizeEstimatedCost` gains `complete = totalEvents > 0 && unpricedEvents === 0` (prototype: `summarizeEstimatedCostProposed`); (2) when `!complete` the UI header reads **"Custo estimado parcial (preço de tabela)"** and the caveat line is promoted ("inclui apenas os registros com preço; o restante não tem preço disponível"); the unchanged header is used when complete; (3) optional, later: an opaque server-computed execution key so the UI can mark a single execution `parcial`/`completo` (prototype `executionCostVerdict`). Amounts of a partial set are always a **lower bound of the priced rows, never "the cost of the execution"**; unknown usage and unattributed output never contribute `0`.

## 7. Local proof (PGlite, in-process; no key, no provider, no Supabase)

`lib/usage/pricing/__tests__/image-output-pricing-design.test.ts` — **52 tests, all passing** (a mutation of one seeded price fails 13):
- **SQL shape (static):** single transaction + lock timeout + guard + verify; forward alters only the pricing CHECK and inserts only six rows (no UPDATE/DELETE/TRUNCATE/DROP TABLE/policy/grant/trigger/function DDL, no `provider_usage_events`); the six rows are exactly the two V1 models × three dimensions at the approved prices, no other model, tier, cache or batch price; rollback deletes by exact key only.
- **Forward on a Production-shaped DB (061 + 062 applied):** starts at 22 rows with the 4-category constraint; `image_output` rejected before; applies cleanly; 28 rows after; the 22 old rows are byte-identical (digest) and the old categories intact; `image_output` accepted, any other value (`bogus`, `image`, `IMAGE_OUTPUT`, `output_image`, `thoughts`, `output_unattributed`, `''`, trailing space) still rejected; exact seeded prices/tier/unit/dates/source; no rows for unapproved models/tiers/cache; RLS, single policy and grants unchanged (authenticated/service_role cannot write, anon cannot read); overlap and duplicate-key protection still work for `image_output`; **re-running is a no-op**.
- **Rollback:** restores the exact previous state (digest of all 22 rows equal to the original) and the category is rejected again; re-running the rollback is a no-op; forward → rollback → forward works.
- **Guards:** nine drift scenarios (drifted constraint, RLS off, extra policy, write grant, anon grant, missing trigger, unexpected V1 history, V1 cached price, `image_output` for an unapproved model) abort and change nothing; a drifted seed value is detected on re-run; **a failure after the constraint was widened rolls the constraint back too**; the rollback refuses to delete edited/closed/extended price history or while another model has `image_output`.
- **Cost derivation over the migrated registry (real Slice C events → ledger rows → cost input):** Nano Banana 2.1 and Lite: 1,120 IMAGE tokens = **USD 0.0336** exactly (not the 0.0084 / 0.00168 a text rate would give), input 14 tokens = 0.000021 / 0.0000035; TEXT output and thinking use the text/thinking rate (0.0003, 0.0016125 / 0.00006, 0.0003225); IMAGE is unavailable (never text-priced) when the `image_output` rows are absent; `output_unattributed` and unknown usage are unavailable with **no amount**; partial usage → `partial` verdict, `complete = false`, amounts only for priced rows; a fully classified execution sums to 0.033621 and is `complete`; reported `flex`/`priority` never get Standard; an unreported tier uses the sole registry tier **with the assumption**, and the fallback disappears when a second tier exists, for non-image operations and for unrecognized tiers; version selection (before the first effective date → unpriced; a later price applies only to later executions; overlap → ambiguous; unknown/unapproved model → unavailable); cached and tool-use tokens never guessed; `totalTokenCount` changes no amount.
- **Regression:** **1,800+ representative OpenAI / Gemini text / Kling / unknown rows** (all units × tiers × categories × operations, with cached/tool-use variations) produce results **identical** to the current deriver, including > 50 priced ones. The *current* deriver, given the *new* registry, still prices input/text/thinking correctly and leaves IMAGE unpriced, and the *current* loader silently drops the new category — i.e. **applying the SQL before the code change is safe**.

## 8. Regression risks

| Risk | Mitigation / status |
|---|---|
| Old code meets new rows | Safe (tested): unknown category dropped by `toPricingVersion`; input/text/thinking correctly priced, IMAGE unpriced. |
| New code meets old registry (code deployed first) | Safe (tested): `no_pricing_for_category` → unavailable. |
| Existing OpenAI / Gemini text / Kling costs | Byte-identical on the 1,800-row matrix; the SQL leaves their rows byte-identical (digest). |
| Constraint swap takes an ACCESS EXCLUSIVE lock on a 22-row table | `lock_timeout 5s`; sub-millisecond work; readers (Settings → Usage) wait at most that long. |
| Tier fallback assumes Google keeps Flex/Priority off these models | Reported tier always wins; registry-driven kill switch; assumption surfaced; decision D1. |
| Google never reports a TEXT/IMAGE modality breakdown | Then every output row is `output_unattributed` → permanently partial (input priced only). Detected at the authorized smoke; revisit only by a new explicit decision. |
| Price drift between this review and application | Operator re-verifies the live page (checklist); `effective_from` is the observation day; a later change is a new version. |
| Usage UI wording/tests | Header changes only for partial sets; update `usage-history` tests in the implementation PR. |
| FUTURE-059 / credentials | Untouched (no `user_settings`, key or grant reference in the SQL — asserted). |

## 9. Required Production execution order (nothing below has been done)

1. Merge this design PR (docs, tests, SQL artifacts only).
2. **Owner decision** on D1–D3 (below).
3. Operator pre-check: open <https://ai.google.dev/gemini-api/docs/pricing> and confirm the six Standard figures in the SQL header (1.50 / 7.50 / 30.00 and 0.25 / 1.50 / 30.00 per 1M; no Flex/Priority/cache for these models). If anything differs: **stop**, revise the SQL, repeat the proof. Record `SELECT count(*), md5(string_agg(t::text,'|' ORDER BY id)) FROM provider_pricing_versions t;` (expected `22`, `6b65ae83…f1`).
4. Apply `…image_output_pricing.up.sql` as the table owner in one run (SQL editor / CLI). It aborts by itself on any drift.
5. Verify: 28 rows; constraint shows `image_output`; the six rows; the 22 old rows' digest unchanged (the migration already proves it); Settings → Usage still renders existing events identically.
6. Merge + deploy the cost-derivation implementation PR (§4). (Either order of 4/6 is safe; SQL first means the new code finds its rows immediately.)
7. Record the application as evidence (docs PR), like FUTURE-059 Slice 2.
8. **Only then** the authorized single-image smoke and, with explicit approval, enabling `CONTENT_STUDIO_GEMINI_IMAGE_GENERATION` — never before 4 and 6.

## 10. Rollback procedure

- **SQL:** run `…image_output_pricing.down.sql` as the table owner. It refuses (changing nothing) if the six rows were edited, closed, extended or if another model has `image_output`; otherwise it deletes exactly the six rows and narrows the CHECK, then verifies the 22 original rows by digest. Effect: derived Gemini image costs become "unavailable"; usage history is untouched.
- **Code:** revert the implementation PR; independent of the SQL (both orders safe).
- **Feature:** unset `CONTENT_STUDIO_GEMINI_IMAGE_GENERATION` (instant); not required for a pricing rollback because pricing never calls a provider.

## 11. Decisions requested (before the implementation PR)

- **D1 — tier fallback:** adopt the sole-registry-tier fallback for image-generation rows (recommended; evidence: Standard is the only tier priced for these models, real-time `generateContent` never requests another, reported tier always wins, self-disabling) **or** stay strict (a missing tier ⇒ `ambiguous` until the smoke proves Google reports it).
- **D2 — effective date:** `effective_from = 2026-10-12T00:00:00Z` (observation day, basis `observed_at_source`) — confirm, or re-date to the application day (no image executions exist, so there is no financial difference).
- **D3 — partial-cost UI:** aggregate "parcial" label only (recommended, small), or also the per-execution grouping via an opaque server key.

## 12. Exact next implementation step

After D1–D3 and a green design PR: open **"FUTURE-064 Slice D implementation"** containing exactly the §4 change set (registry category, `planGemini` image branch, unattributed reason, tier fallback per D1, aggregate `complete`, UI label, presentation texts, updated pins), reusing the prototype tests as the acceptance suite; it must not apply SQL. The owner applies the SQL (§9, step 4) after reviewing; the switch stays OFF until the authorized smoke.
