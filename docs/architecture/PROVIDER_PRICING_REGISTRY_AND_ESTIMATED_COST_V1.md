# PROVIDER_PRICING_REGISTRY_AND_ESTIMATED_COST_V1 (FUTURE-047)

A versioned, effective-dated pricing registry and a derived **estimated list-price cost** for provider usage — shown in Settings → Uso e custos without ever changing, or contradicting, the factual usage ledger.

## Status

- Baseline: `origin/main` `7a1bf88aaf315dac91c40d8d53cbc2bcc2eb34c1`. Branch: `feat/provider-pricing-registry-estimated-cost-v1`.
- Schema: **one additive migration** — `scripts/061_create_provider_pricing_versions.sql` (new table + one trigger function; nothing else touched).
- `provider_usage_events`: **not altered** (no column, no row). Provider calls made: **0**.
- Out of scope, untouched: Content Studio Credits, plans/billing, wallets, margins, FX, a pricing admin UI.

## The three concepts that are never merged

| Concept | Where it lives | Truth level |
|---|---|---|
| Provider-reported usage | `provider_usage_events` (quantity + unit + measurement source) | **Fact.** Immutable. |
| Estimated cost | Derived on read: usage × the pricing version effective at `occurred_at` | **Interpretation** with our pricing authority. Always labelled an estimate. |
| Actual provider bill | Nowhere | **Unknown.** The UI says "Valor cobrado não disponível". |

For BYOK the user may be on a free tier, a paid tier, batch/flex/priority, negotiated terms or a prepaid package. A list price is therefore always a *list-price equivalent*; BYOK is shown as funding context and is **never** treated as zero cost.

## Phase 0 — audit (as found, 2026-10-09)

### Producers of `provider_usage_events`

Exactly two writers exist (also pinned by `provider-usage-ledger.test.ts`): Kling video-generation completion (+ the admin-only historical importer) and the Gemini Review recorder. **OpenAI Review and Nano Banana / image generation write no usage rows.**

### Matrix (every operation/category/unit that exists today; Production rows read-only)

| provider | model | operation | usage category | usage unit | rows | service tier fact | funding fact | pricing derivable? | reason if not |
|---|---|---|---|---|---|---|---|---|---|
| gemini | gemini-3.5-flash | video_review (image_review same shape) | input | `input_tokens` | 2 | **yes** (`usageMetadata.serviceTier`, `standard`) | yes (`user_byok`) | **yes for executions on/after 2026-10-09** | the 2 existing rows are from 2026-10-08, before the first evidenced rate: `pricing_not_effective_at_execution` |
| gemini | gemini-3.5-flash | video_review / image_review | output | `output_tokens` | 2 | yes | yes | **yes for executions on/after 2026-10-09** | existing rows predate it → unavailable |
| gemini | gemini-3.5-flash | video_review / image_review | thoughts | `tokens` + `usage_category=thoughts` | 2 | yes | yes | **yes on/after 2026-10-09** (priced as output) | existing rows predate it → unavailable |
| gemini | gemini-3.5-flash-lite | image/video review | input / output / thoughts | same | 0 | yes when present | yes | **yes on/after 2026-10-09** | — |
| gemini | any | any | unknown usage | NULL | 0 | — | yes | no | `usage_unknown` |
| kling | kling-v3 | text_to_video, image_to_video (REST) | — | `units` (`provider_reported`) | 2 | none (Kling has one tier) | none recorded | **yes for executions on/after 2026-10-09** | the 2 existing rows are from 2026-09-28: no price version was effective → `pricing_not_effective_at_execution` |
| kling | kling-video-v3_0 | text_to_video (MCP) | — | `credits` (`balance_delta`) | 1 | none | none | **no** | MCP credits have no published USD mapping; and a balance delta is an inference, not a provider-reported charge |
| kling | kling-video-v3_0 | text/image_to_video (MCP) | — | NULL (`unknown`) | 2 | none | none | no | `usage_unknown` |
| openai | (gpt-4o-mini Review) | image_review | — | **no rows written** | 0 | — | — | no | `provider_not_supported`: no usage instrumentation exists (documented gap, below) |
| nano banana / other | — | — | — | **no rows written** | 0 | — | — | no | not a ledger producer |

Timestamp authority: `provider_usage_events.occurred_at` (Gemini: row creation at the provider response; Kling: completion time / the verified historical completion time for imported rows).

Existing cost semantics found: none in code; the UI funding line said "custo não calculado" (updated, see UI). The ledger header and migration 044 forbid price/currency columns — which is why the registry is a **separate** table.

## Pricing authority — Postgres, not code

**Decision: Postgres table `provider_pricing_versions`.** Reasons, factually:

1. *Non-overlap is a database invariant here.* A trigger (serialised per key with an advisory lock) rejects an overlapping window at write time. In code that guarantee would be a unit test over a constant — it can't stop a bad edit from shipping.
2. *History is queryable and durable.* "What rate applied on 2026-10-08?" is a SQL question and the answer is stable across deploys.
3. *Provenance travels with the number* (source url/label, retrieval time, basis of the effective date) and is protected: the app has **SELECT only** — not even the service role can write. The only writer is a reviewed migration.
4. *Future administration* (a pricing screen) needs a store anyway; no CMS is built now.

Cost of the choice: one additive migration and PGlite coverage — both done. A missing table or failed read degrades to "Preço indisponível" for every row, so deploy order is safe (code before DDL, or DDL before code).

### Schema (`scripts/061_create_provider_pricing_versions.sql`)

| Column | Meaning |
|---|---|
| `provider`, `model` | exact ids as stored in the ledger; no wildcards, no families |
| `usage_category` | **billable** category: `input`, `cached_input`, `output`, `unit` (the ledger row is mapped onto it in code) |
| `service_tier` | `standard` (provider default), `flex`, `priority`… only when the provider prices them apart |
| `currency` (`^[A-Z]{3}$`), `unit_name`, `unit_quantity`, `price_amount` | *price_amount of unit_quantity of unit_name* (e.g. 1.50 USD / 1,000,000 tokens); `NUMERIC(24,12)` |
| `effective_from`, `effective_to` | half-open window `[from, to)`; NULL `to` = current |
| `effective_from_basis` | `official_effective_date` (the provider explicitly published the date) / `observed_at_source` (the day the rate was observed at the official source) |
| `source_url` (https), `source_label`, `retrieved_at`, `notes` | provenance |

Rules: `UNIQUE (provider, model, usage_category, service_tier, effective_from)`; windows of the same key may **never overlap, in any currency** (trigger, SQLSTATE `23P01`); `effective_to > effective_from`; RLS on, a single `SELECT` policy for `authenticated`; `GRANT SELECT` only. A price change is a **new row**; the previous row is closed with `effective_to` (by a reviewed migration). Rollback: `DROP TABLE provider_pricing_versions; DROP FUNCTION provider_pricing_versions_reject_overlap();`.

## Pricing-source policy

- Only **official provider documentation**: Google AI pricing/changelog pages and Kling's own API pricing page. No blogs, aggregators, third-party calculators, forums or remembered prices.
- Every row records source url + label + retrieval time + the basis of `effective_from`.
- A provider with no real ledger semantics gets **no** rows (OpenAI, Nano Banana) — the registry is not padded to look complete.
- Prices are re-verified by a new retrieval + a new migration; nothing refreshes itself.

### Sources used (retrieved 2026-10-09 UTC)

| Provider | Official source | What was taken |
|---|---|---|
| Gemini | `https://ai.google.dev/gemini-api/docs/pricing` (page dated 2026-10-09) | Paid-tier prices per 1M tokens for `gemini-3.5-flash` (std in $1.50 / cache $0.15 / out $9.00; flex $0.75 / $0.08 / $4.50; priority $2.70 / $0.27 / $16.20) and `gemini-3.5-flash-lite` (std $0.30 / $0.03 / $2.50; flex $0.15 / $0.02 / $1.25; priority $0.54 / $0.05 / $4.50). "Output price **(including thinking tokens)**" is a single rate. Input is one rate for text/image/video/audio. No prompt-size threshold. |
| Gemini | `https://ai.google.dev/gemini-api/docs/changelog` | Model GA dates only (`gemini-3.5-flash` 2026-05-19, `gemini-3.5-flash-lite` 2026-07-21). These prove when a model shipped, **not what it cost then**, and are deliberately **not** used as pricing start dates. |
| Kling | `https://kling.ai/document-api/pricing/base/video` (JS-rendered; read in the in-app browser) | Prices are quoted in provider units with their USD equivalent at **1 unit = $0.14** (e.g. Kling 3.0 720P, no native audio: "0.6 Units ($0.084) /s"). The page is undated. |

Not represented (deliberately): Gemini free tier ($0, not distinguishable from usage metadata), Gemini **batch** (a separate API surface that never reports a `serviceTier`), context-cache **storage** (per token-hour; the ledger records no cache duration), grounding/search per-request fees, any negotiated or account-specific pricing, and anything about Kling beyond what the official pricing page itself prints (unit → USD list price).

## Effective-date contract

`price(event) = the single version with effective_from <= occurred_at < effective_to` for the event's (provider, model, billable category, service tier).

- A later version never reprices an earlier execution (tested).
- No version at that instant → `unavailable / pricing_not_effective_at_execution` (never the "nearest" version).
- Two versions at that instant → `ambiguous / overlapping_pricing_versions` (the database makes this unreachable; the deriver refuses to guess anyway).
- A "current equivalent" view (reprice history at today's rate) was **not** requested and is not offered.

**Pricing versions begin when a rate is factually observed or otherwise proven.** No provider page publishes a price history, so:

- *Absence of evidence of a price change is not evidence of price continuity.* A changelog that lists no pricing entry does not prove that today's rate applied last month, so no rate is back-dated, and a model's GA date is never used as a price start.
- Every seeded rate (Gemini and Kling) starts on **2026-10-09**, the day it was read at the official source, with basis `observed_at_source`.
- Earlier executions stay **unavailable** (`pricing_not_effective_at_execution`) until authoritative historical pricing is added later as a **new version** (e.g. `[2026-05-19, 2026-10-09)` with basis `official_effective_date` and its own source). That is a registry-only change: it never mutates `provider_usage_events`, and the overlap trigger guarantees it cannot collide with the observed window.
- If an official source explicitly states an earlier effective date for a specific rate, that exact date may be used with basis `official_effective_date`. None exists today.

| Basis | Used for | Meaning |
|---|---|---|
| `observed_at_source` | all 19 seeded rates (2026-10-09) | The rate was read at the official page that day; the page publishes no date or history. Surfaced to the user as an assumption (`price_observed_at_source`). |
| `official_effective_date` | (none yet) | The provider published the date. |


## Derivation architecture

```
provider_usage_events row ─┐
                           ├─ costInputFromRow() ─ deriveProviderUsageCost(input, versions) ─▶ ProviderUsageCost
provider_pricing_versions ─┘   (closed set of facts)        (pure, lib/usage/pricing/derive.ts)
```

- One shared pure function; no I/O. Modules: `decimal.ts` (money), `registry.ts` (validate + lookup), `derive.ts`, `aggregate.ts`, `presentation.ts`, `load.ts` (SELECT-only loader).
- Result: `estimated` (`amount`, `currency`, `basis: list_price_equivalent`, `serviceTier`, `pricing` provenance, `components`, `assumptions`) | `unavailable` (reason) | `ambiguous` (reason). **No amount field exists on the non-estimated results.**
- **Provider adapters** map a ledger row onto billable categories — only for providers with real usage semantics:
  - *Gemini:* `input_tokens`→`input` (minus `cachedContentTokenCount`, which is a *subset* of the prompt tokens, priced at `cached_input`); `output_tokens`→`output`; `tokens`+`thoughts`→`output` (Google's table is one "including thinking tokens" rate). `totalTokenCount` is never priced; thinking is priced once. A tool-use prompt-token count > 0 → `ambiguous/tool_use_tokens_not_priced` (billed as input but in no row; pricing would under-count).
  - *Kling:* `units` (provider-reported) → `unit`; `credits` → `unavailable/unit_not_priceable`.
  - *Everything else:* `provider_not_supported`.
- Only `measurement_source = provider_reported` is priced. `balance_delta`, `estimated`, `derived`, `manual_import`, `unknown` never become money.

## Service tier and funding semantics

- A tier is used **only** when proven: Gemini `usageMetadata.serviceTier` (`standard`/`flex`/`priority`, already stored by FUTURE-043) or a provider that has exactly one tier (Kling). Gemini row without a tier → `ambiguous/service_tier_not_proven` — we do not default to "standard", even though the API default is standard.
- Free vs paid plan is **not knowable** from usage metadata: Gemini estimates carry `paid_tier_list_price` ("considera a tabela do plano pago; no plano gratuito do provedor não há cobrança").
- Funding (`user_byok`) is passed through as context and adds `byok_invoice_may_differ`. It never changes the price and never yields zero.

## Persistence: calculated on read

Costs are **not** stored. Options weighed: (a) derive on read from the versioned registry; (b) materialise into a derived table. (a) wins: the registry is append-by-window and immutable per window, so recomputation is deterministic and fully explainable from the row's own provenance; (b) would add a second mutable-looking truth that must be invalidated whenever a window is corrected, for a table that holds ≤ 200 displayed rows per request. If an audited, frozen cost snapshot is ever needed (e.g. invoicing), a separate append-only derived table keyed by event id + pricing version id is the right shape — not columns on the factual ledger.

## Currency, precision and aggregation

- All seeded prices are USD. No FX anywhere; totals are **per currency**.
- Storage precision `NUMERIC(24,12)`; calculation precision 12 decimal places via BigInt fixed-point (no floats; the project target has no bigint literals, so `BigInt()` is used); rounding half-up once per component; wire format is a canonical decimal **string**; display rounds half-up to 4 digits from the exact value (`< US$ 0,0001` for a non-zero sub-cent amount).
- `summarizeEstimatedCost`: sums only `estimated` rows within one currency; unavailable and ambiguous rows are counted and excluded; nothing priced → no total (never "0").

## Historical behaviour

Existing rows are untouched and not backfilled with invented metadata. They are priced only if a version existed at their `occurred_at`:

- 6 Gemini rows (2026-10-08, standard tier, BYOK): **unavailable** — the first evidenced rate is 2026-10-09 (`pricing_not_effective_at_execution`). Their usage (tokens, tier, funding) is shown exactly as before; no total is invented. A future authoritative historical rate would price them without any change to these rows.
- 2 Kling REST unit rows (2026-09-28): unavailable — the first evidenced Kling rate is 2026-10-09.
- 1 Kling MCP credit row (`balance_delta`): unavailable — no authoritative credit→USD mapping.
- 2 Kling MCP rows with unknown usage: unavailable (`usage_unknown`).

## Provider notes

- **OpenAI gap (documented, not fixed):** `lib/reviews/service.ts` records usage only for `gemini`; the OpenAI Review adapter returns `usage` but nothing stores it. A usage-instrumentation mission must come first; the registry already supports OpenAI structurally (add rows + a billing adapter).
- **Kling:** the only mapping used is the one printed on the official pricing page (units quoted with a USD equivalent at 1 unit = $0.14), applied to API `units` reported by the provider. Nothing else about Kling pricing (packages, discounts, plans) is claimed or modelled. Credits (MCP) cannot be mapped — the API pricing page publishes no credit→currency conversion.
- No provider execution was modified.

## Settings → Uso e custos

- Each row keeps its quantity/unit/measurement line. Beneath it: **"Custo estimado: US$ 0,0277"** with a tooltip (list-price basis, BYOK caveat, tier, source, effective-since, retrieval date, "Valor cobrado não disponível"), or **"Preço indisponível"** (tooltip = the reason).
- The summary gains **"Custo estimado (preço de tabela)"**: one total per currency, "N registros com preço", "N registros sem preço disponível — não entram no total e não valem zero", plus the "não é o valor cobrado / BYOK" line. It follows the existing filters.
- Disclaimer rewritten; BYOK funding line no longer says "custo não calculado" (it now says the charged amount depends on the user's plan). A payload without `estimated_cost` renders exactly as before.
- API: `GET /api/settings/usage` adds `estimated_cost` per event (derived server-side with the user's session; registry read is SELECT-only; no write path; no provider metadata leaves the server).

## Out of scope / boundaries

Content Studio Credits, debits, margins, markup, plans, wallets, resale economics, invoices, FX, free-tier detection, batch pricing, cache storage fees, a pricing admin UI. This layer is **provider-cost observability only**.

## Residual risks

1. Rates are only known from 2026-10-09 onward. Executions before that date (including every Production Gemini Review row to date) have no estimate; this is intentional and stays so until authoritative historical pricing is added.
2. Kling's pricing page is JS-rendered and undated; figures were read from the rendered official page only once.
3. Free-tier BYOK users have a real cost of $0 that the estimate cannot see (labelled).
4. Gemini tool-use prompt tokens and cache storage are unmodelled (explicit ambiguity / out of scope).
5. Prices change: a stale registry silently stops matching only when a window is closed; otherwise it keeps estimating at the last known rate until someone re-verifies and adds a version.

## Operational closure (2026-10-09)

Migration `061_create_provider_pricing_versions` was applied to the Content
Agent Studio Supabase project `nuhdhnasuohizxtmyiju`. The registry is active
with 19 pricing versions: 18 Gemini versions and one Kling version. Every
seeded version starts at `2026-10-09T00:00:00Z` with
`effective_from_basis = observed_at_source`; provenance is stored with each
version and the database overlap check reports no conflicting windows.

The current Production corpus contains 11 usage events, all before the first
evidenced pricing window. They therefore remain correctly unpriced, with no
retroactive tariff inference and no mutation to `provider_usage_events`.
Future executions that occur inside a valid pricing window may receive a
derived estimate on read.

The derived amount is a public list-price equivalent, not an invoice or a
billing record. BYOK usage is shown as the user's provider usage context; the
provider invoice can differ because of free tiers, plan terms, discounts,
batch or priority settings, negotiated pricing, and other account-specific
conditions.
