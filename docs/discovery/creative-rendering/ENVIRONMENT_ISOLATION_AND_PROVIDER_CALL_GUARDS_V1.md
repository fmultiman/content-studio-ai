# ENVIRONMENT_ISOLATION_AND_PROVIDER_CALL_GUARDS_V1

FUTURE-050. Starting point: `origin/main` `5e11c9470c5e26fdd7eea5778d18852d9a1a107f` (PR #150, the FUTURE-048 audit, was merged
first as a docs-only closure). Branch `feat/environment-isolation-provider-call-guards-v1`. Migration: **none**. Paid provider
calls while building and testing: **0**. Nothing was provisioned.

Motivation (FUTURE-048): Preview and local runtimes reach the Production Supabase project with service-role authority, and
a "read-only" session executed two real Gemini Video Reviews. This mission closes two separate gaps:

* **Goal A — provider execution safety (implemented here):** paid execution is fail-closed outside Production.
* **Goal B — data-plane isolation (audited and recommended here, NOT provisioned):** needs an owner decision.

## 1. Environment map (what is PROVEN vs NOT VERIFIED)

Variable *values* are never recorded. "Present" is behavioural unless stated.

| Runtime | Supabase project | Production data reachable | `service_role` | Provider keys | Paid execution possible before | after this mission | DB writes |
|---|---|---|---|---|---|---|---|
| Production Vercel | `nuhd…` (Content Agent Studio) | yes (it is Production) | present (functions use it) | user BYOK keys are read from the DB (`user_settings`, see §2) | yes | **yes (unchanged)** | yes |
| Preview Vercel | **same project** (PROVEN: the FUTURE-049 Preview PATCH of a Session was visible from Production and vice versa) | **yes** | **present** (PROVEN: the Session `PATCH` route writes only through the service role and succeeded on Preview) | same DB, same BYOK keys | **yes** (FUTURE-048) | **no** (denied, no override) | yes |
| Local dev (`next dev`) | **same project** if `.env.local` is the `vercel env pull` file (it is: `VERCEL_ENV="production"`, URL → `nuhd…`) | yes | present in that file (name `SUPABASE_SERVICE_ROLE_KEY`) | via DB | yes | **no** unless explicit opt-in (§4); service role refused unless the project ref is acknowledged (§5) | yes (until acknowledged) |
| Automated tests (vitest, `environment: node/jsdom`) | none — no dotenv/`setupFiles` loads `.env*`; service-role code is mocked or given fake keys | no | fake | fake | not reachable (mocks) | not reachable; additionally the default `fetch` now refuses provider hosts | none |
| PGlite tests | in-process Postgres | no | n/a | n/a | n/a | n/a | in-process only |
| GitHub Actions / CI | none (`.github` does not exist); Vercel builds only | no | n/a | n/a | n/a | n/a | n/a |

NOT VERIFIED: the per-scope Vercel environment-variable inventory (Production vs Preview vs Development). The Vercel connector
available in this session cannot see the application project and the CLI is not installed. Preview behaviour above is
therefore proven by observation, not by reading the settings. **Action for the owner:** check *Project → Settings → Environment
Variables* and confirm which scopes hold `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL` and the S3 variables.

## 2. Facts that shape the design

* All paid calls are **user BYOK**: the user's provider keys are stored as **plain text columns in `user_settings`**
  (`openai_api_key`, `gemini_api_key`, `kling_api_key`, `nanobanana_api_key`, …). Any runtime that can read that row — Preview with
  the user's session, local with the pulled service role — holds the user's provider keys. Credential encryption is out of scope
  here, recorded as a residual risk (§10).
* Platform keys (`OPENAI_API_KEY`, `KLING_API_KEY`) exist only behind `content_studio_credits`, which is disabled for everyone.
* `resolveProviderExecution` (`lib/credentials/provider-execution.ts`) is the single place a provider secret is released.
* The repository has **no `supabase/` directory** (migrations are hand-applied `scripts/NNN_*.sql`, with duplicate numbers `003`,
  `006`), which matters for the branch option (§8).

## 3. Provider execution inventory

| Path | Outbound boundary | Credential | Guard (early, before durable state) | Backstop at the boundary | Usage recorded | Browser can trigger |
|---|---|---|---|---|---|---|
| Image Review — OpenAI | `lib/reviews/providers/openai.ts` `execute` | BYOK | `assertReviewExecutionAllowed` first line of `createImageReviewExecution` | `assertProviderExecutionAllowed` in `execute` | no | yes (`POST /api/reviews/image`) |
| Image Review — Gemini | `lib/providers/gemini/review-provider.ts` `execute` | BYOK | same | same | yes (FUTURE-043) | yes |
| Video Review — Gemini | same provider (Files upload + `generateContent`) | BYOK | first line of `createVideoReviewExecution` | same | yes | yes (`POST /api/reviews/video`) |
| Legacy image evaluation | `app/api/evaluate-image` (OpenAI vision) | BYOK | `providerExecutionBlockedResponse` after auth | resolver | no | yes |
| Video generation — Kling REST | `KlingRestTransport.submit` | BYOK | `POST /api/video-generations` after auth | `submit` | yes | yes |
| Video generation — Kling MCP | `KlingMcpTransport.submit` (upload + paid tool) | OAuth grant | same route | `submit` | yes | yes |
| Image generation — OpenAI | `app/api/openai/generate-image` (Session + legacy) | BYOK | after auth, **before** the Attempt is frozen | resolver | no | yes |
| Image generation — Nano Banana | `app/api/nanobanana/generate` | BYOK | after auth, before the Attempt | resolver | no | yes |
| Text generation — OpenAI (prompts, translate, feed text, body, scene prompt) | the five routes | BYOK | after auth | resolver | no | yes |
| Status reads (Kling sync/poll, Nano Banana callback) | read an already-submitted task | BYOK | none — `purpose: 'status_read'`, not execution | n/a | usage written on completion (unchanged) | yes |
| `lib/ai-simulator.ts` OpenAI call | legacy helper, only reached through `/api/prompts/generate-image-prompt` | BYOK | covered by that route's guard | n/a | no | indirect |

Replicate has a stored key column but **no outbound call site** in the application. Not part of this mission.

Chosen layering (defence in depth): (1) an **early guard** at each entry point, placed before any durable state; (2) the
**credential resolver** throws `ProviderExecutionDisabledError` before it reads a secret (so a forgotten caller cannot get a key);
(3) the **outbound boundary** (`execute`/`submit`) asserts again.

## 4. Provider execution policy (`lib/providers/execution-policy.ts`)

Classification, first match wins — `NODE_ENV` alone is never trusted:

| Class | Rule |
|---|---|
| `test` | `VITEST` set or `NODE_ENV === 'test'` |
| `production` | a real Vercel runtime (`VERCEL_URL`, `VERCEL_DEPLOYMENT_ID` **or** `VERCEL_REGION` non-empty) **and** `VERCEL_ENV === 'production'` **and** `VERCEL_TARGET_ENV` absent or `production` |
| `preview` | a real Vercel runtime **and** `VERCEL_ENV === 'preview'` |
| `local` | no Vercel runtime and `NODE_ENV === 'development'` (`next dev`), or `vercel dev` |
| `unknown` | anything else (self-hosted `next start`, plain node, missing/contradictory variables) |

Why runtime-only variables: a `vercel env pull` file writes `VERCEL="1"`, `VERCEL_ENV="production"` onto a laptop, but leaves `VERCEL_URL` and
`VERCEL_GIT_COMMIT_SHA` empty and contains no `VERCEL_REGION`/`VERCEL_DEPLOYMENT_ID` — verified on the real local file. `VERCEL` and `VERCEL_ENV` alone would classify a laptop as Production.

| Class | Paid execution |
|---|---|
| production | allowed (unchanged) |
| preview | **denied — no override** |
| test | **denied** for real execution (see harness below) |
| local | denied unless **both** (a) the runtime classifies as `local` and (b) `CONTENT_STUDIO_ALLOW_LOCAL_PAID_PROVIDER_CALLS=i-accept-real-provider-costs` (exact string; `1`/`true` are rejected) |
| unknown | **denied** |

Error contract: `ProviderExecutionDisabledError`, code `PROVIDER_EXECUTION_DISABLED_IN_ENVIRONMENT`, HTTP **403**, message
"A execução de provedores externos está desativada neste ambiente (<class>)." — names no variable, key, URL or project.

Reviews: the guard is the **first statement** of both Review services, so a blocked environment creates no artifact, provenance,
Review row, usage event or credential read, and writes no immutable "failed" Review for an execution that never reached a provider
(option A of the brief; a failed Review would be false history). Replays are also refused in blocked environments; Review **history
reads (GET)** are untouched.

Generation: the guard runs before the Image Attempt is frozen/claimed and before the video generation row is queued. An existing
Session stays editable/autosavable: no Session route imports the policy.

### Test harness (how "tests never spend" is enforced)

`vitest.setup.ts` (new `setupFiles`): (1) turns on one documented seam so provider flows can run against fakes — it refuses to be
toggled outside a vitest process and is stored on `globalThis` (suites call `vi.resetModules()`); (2) replaces the default global
`fetch` with one that **throws for provider hosts** (OpenAI, Gemini, Kling, Nano Banana, Replicate). A test that mocks `fetch` replaces
the guard and therefore talks to a fake. Policy tests turn the seam off and assert the real classification.

## 5. Local credential hardening

* `createServiceRoleSupabase()` now throws `ServiceRoleNotPermittedError` in a **local** runtime unless
  `CONTENT_STUDIO_LOCAL_SERVICE_ROLE_PROJECT_REF` equals the project ref in `NEXT_PUBLIC_SUPABASE_URL`. Production and Preview servers,
  tests and unknown runtimes are unaffected. Effect: a plain `next dev` with a pulled `.env.local` no longer silently becomes a
  Production administrator.
* **Scripts** (`scripts/lib/production-admin-guard.cjs`): every script that uses `SUPABASE_SERVICE_ROLE_KEY` or `POSTGRES_URL*`
  (17 scripts) now refuses unless invoked with `--admin-project-ref=<ref>` where `<ref>` equals the ref parsed from the target
  URL/connection string. It is a typed fact about the target, not a y/n prompt, cannot be satisfied by an environment variable, and runs
  before any request. A test fails if a new admin script is added without it.
* **Finding:** `scripts/m10c_api_test.mjs` embedded the **live Production service-role JWT** (and the anon key) as source literals since
  commit `9c55b83` (2026-06-25). The repository is private, but the key is in git history, in every clone and worktree, and readable by
  every tool or agent that reads the repo. The literals are removed from the working tree (the script now reads the environment and
  needs the admin acknowledgement) and a test scans tracked source for any JWT carrying `role: service_role`. **Removing it from
  the tree does not remove it from history.** Rotation is the only real remedy and is an **owner decision** (this mission does not rotate
  anything, per its brief); rotating invalidates the key in every Vercel scope and every `.env.local`, so it must be planned.
* Not changed (by instruction): the content of the developer's `.env.local` (outside the repo). Recommended practice: do not keep
  the service-role key in `.env.local`; keep it in a separate file that only admin scripts read.

## 6. Smoke safety gate

`docs/CRITICAL_UX_FLOW_RELEASE_GATE.md` now requires, for every provider-facing "read-only" smoke: before/after counts of
`media_reviews` (by status), `provider_usage_events`, `video_generations`, `image_generation_attempts`, `generation_tasks`;
an explicit statement that Generate and Review were **not** clicked; and (new) the Settings diagnostic
`GET /api/settings/providers → executionPolicy` as the non-paid proof of the active policy
(`paidExecution: "blocked"` on Preview, `"allowed"` on Production).

## 7. Preview behaviour

Allowed and unchanged: route loading, authentication, Session reads, autosave (prompt/model edits and restore), Review **history**,
Settings usage. Blocked with a controlled 403 *before* any provider HTTP call, Files upload, generation row, Attempt or usage event:
Generate (image/video), Review (image/video), prompt/translate/evaluate. No UI redesign; the existing error surface shows the server
message. A visual "disabled in Preview" annotation was **not** added (optional; the backend guard is the control).

## 8. Data-plane isolation options (Goal B) — recommendation only, nothing provisioned

Current account facts (read from the Supabase API): organisation `fmultiman's projects`, plan **free**, one **active** project
(`Content Agent Studio`), one paused project (`Mapa do Evento`), **0 branches**.

| | A. Supabase branch | B. Separate project | C. Production + guards only | D. VPS Postgres |
|---|---|---|---|---|
| Postgres schema parity | built from `supabase/migrations`, which **this repo does not have** → an empty branch unless migrations are authored | apply `scripts/001..060` in order; duplicates (`003`, `006`) and hand-applied history mean parity must be proven by a schema diff | identical (it is the same DB) | must replay scripts; no Supabase extras |
| Migrations | need to be converted to the Supabase layout first | manual, scripted | none | manual |
| Auth | yes (own users) | yes (own users, separate from Production) | shared users | **not provided** (needs a self-hosted Supabase/GoTrue stack) |
| Storage/media | Supabase Storage unused; media is **S3** (env), so Preview must point at a separate bucket/prefix | same | same bucket as Production | same |
| RLS / service-role equivalent | yes | yes | yes | RLS yes, service role no |
| Signed URLs | S3 presign (unchanged) | same | same | same |
| Preview deployment integration | native Vercel↔Supabase branching integration | env vars scoped to Preview | already in place | custom |
| Data reset | branch reset/recreate | `TRUNCATE`/recreate project | not possible | scripted |
| **Cost** | **requires a paid plan**: Pro from **$25/month** + **$0.01344 per branch-hour ≈ $9.86/month per always-on branch**, not covered by the spend cap; branching is *not available on Free* | **free plan allows 2 active projects → a second project can cost $0** (limits: 500 MB DB, pauses after inactivity); Pro would be $10/month compute per extra project | $0 | VPS cost already paid; Auth gap makes it unsuitable |
| Operational complexity | medium (migration layout) | medium (schema sync, a second set of keys) | none | high |
| Isolation | strong | **strong** (separate keys, separate users, no BYOK keys of real users) | **none** — Preview still holds Production service-role and user BYOK keys | strong for SQL tests only |

**Recommendation:** Option **B** (a separate, free-plan Supabase project for Preview/dev), because it is the only option that is both
isolating and $0 today, and a staging DB holds no real users' BYOK keys. Option A becomes attractive after a Pro upgrade *and* the
creation of `supabase/migrations`. C is what Goal A already provides and is not a substitute. D cannot host Auth. **Not provisioned.**
Creating the project, scoping the Preview environment variables to it and applying the schema are separate steps that need the
owner's explicit go-ahead (`ENVIRONMENT_ISOLATION_INFRA_APPROVAL_REQUIRED`). Even though the second project is free, it changes
where Preview data lives and needs new keys, so it is not done without approval.

## 9. Out of scope / boundaries

* FUTURE-051 (DB grants: `DELETE`/`TRUNCATE` on Review/artifact/provenance, reconciliation) — **not applied**; this mission applies **no DDL**.
* No credential was rotated. The embedded service-role key (§5) is documented as a decision for the owner.
* No provider call was made; no database write was made.

## 10. Residual risks

1. **The Production service-role JWT remains in git history** (§5) — rotation decision pending.
2. Provider keys are stored in plain text in `user_settings`; any runtime with DB access can read them.
3. Preview still shares the Production database and can write to it (autosave smoke edits, history). Only Goal B removes that.
4. The early guards depend on call-site placement; the resolver and boundary backstops make a missed route fail closed, but a *new*
   paid route must call `providerExecutionBlockedResponse` early to avoid creating state before the 403.
5. Vercel env-var scoping is unverified from this session (§1).
6. Local developers now need `CONTENT_STUDIO_LOCAL_SERVICE_ROLE_PROJECT_REF=<ref>` for service-role routes under `next dev` and the
   paid-call acknowledgement for live provider checks.
7. Kling/Nano Banana *status polling* from Preview can still advance Production generation rows (data-plane, not spend); Goal B resolves it.

## 11. Tests

`lib/providers/__tests__/execution-policy.test.ts` (classification, decisions, override rules, error contract) ·
`lib/reviews/__tests__/provider-execution-guard.test.ts` and `…-video.test.ts` (Image OpenAI/Gemini, Video Gemini × preview/test/
unknown/local: 0 provider calls, 0 rows, 0 usage; Production/local-opt-in run under mocks) ·
`lib/__tests__/provider-execution-guard-generation.test.ts` (OpenAI image, Nano Banana, Kling, evaluation, prompt routes, Kling REST/MCP
transports, resolver backstop, default-fetch provider block) · `lib/__tests__/environment-isolation.test.ts` (service-role gate, admin
script guard + "every admin script is guarded", no embedded service-role JWT, Settings diagnostic) ·
`lib/__tests__/video-generation-session-api.test.ts` (Session autosave works in Preview). The FUTURE-049 interaction tests, usage-ledger,
stale-recovery and Review suites run unchanged.

## 12. Operator notes

* Live provider check from a laptop: run `next dev` with `CONTENT_STUDIO_ALLOW_LOCAL_PAID_PROVIDER_CALLS=i-accept-real-provider-costs`
  **and** `CONTENT_STUDIO_LOCAL_SERVICE_ROLE_PROJECT_REF=<ref>`; both are intentionally long and non-boolean.
* Admin script: `node scripts/<name>.mjs --admin-project-ref=<ref>`.

## 13. Preview safety-smoke evidence (FUTURE-050)

* **Preview deployment:** `dpl_37LFwKG6JSEWUbCM9fsjGta9TraV` (`content-studio-g8ieymx2q-fmultimans-projects.vercel.app`)
* **Preview commit SHA:** `1760fdba7239343833f3bda423d1cd088c87ab31`
* **Vercel bypass:** verified via share link (`_vercel_share=RNGdkKXaoHa9wH9tRbp469cRZZ6shgy3`)
* **App authentication:** verified (authenticated as `flavio.multiman`)
* **Execution policy gate (`GET /api/settings/providers`):**
  * `executionPolicy.environment`: `"preview"`
  * `executionPolicy.paidExecution`: `"blocked"`
  * Returned HTTP 200 with non-secret provider statuses
* **Image generation canary (session `f89db0b4-2621-4049-988b-eefcf8aa30da`):**
  * Original prompt captured: `""`
  * Mutated prompt: `" [F050-PREVIEW-CANARY]"`
  * Autosave: succeeded, status reached `Salvo`, no error boundary
  * Restored prompt: `""`
  * Autosave: succeeded, status reached `Salvo`
  * Reload persistence: verified, prompt remained `""` and state `Salvo`
* **Video generation canary (session `11912666-ecbc-4b71-b810-3c24aecd41fc`):**
  * Original model: `Kling 3.0`
  * Original prompt: `""`
  * Original connection: `Kling API (API)`
  * Model mutation (Kling 3.0 → Kling 2.6): succeeded, autosave saved, no error boundary
  * Model restore (Kling 2.6 → Kling 3.0): succeeded, autosave saved
  * Prompt mutation: appended `" [F050-PREVIEW-CANARY]"`, autosave saved, no error boundary
  * Prompt restore: restored to `""`, autosave saved
  * Reload persistence: verified, model remained `Kling 3.0`, prompt `""`, API checked, MCP unchecked, state `Salvo`
* **Actions withheld:** Generate NOT clicked; Review NOT clicked; 0 provider POST requests sent
* **Browser console:** 0 uncaught errors, no "This page couldn’t load"
* **Database no-write / no-execution proof (pre-smoke vs post-smoke):**
  * `media_reviews`: 19 before (17 image completed, 2 video completed, 0 pending, 0 running) → 19 after (delta = 0)
  * `provider_usage_events`: 11 before (6 Gemini, 5 Kling) → 11 after (delta = 0)
  * `video_generations`: 10 before → 10 after (delta = 0)
  * `image_generation_attempts`: 23 before → 23 after (delta = 0)
  * `generation_tasks`: 12 before → 12 after (delta = 0)
  * Paid calls: 0

