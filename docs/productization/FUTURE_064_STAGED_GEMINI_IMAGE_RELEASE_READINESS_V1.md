# FUTURE-064 — Staged Gemini image release readiness

Audit base: fetched `origin/main` **7eaf8010241e5b88a155403a490316e690b8d7c6**, 2026-10-12. This is preparation only: no activation, paid image, provider request, migration, Production credential/variable change or general release.

## Decision

**GO conditional for Nano Banana 2.1 only**, after this focused PR is reviewed, merged and deployed READY with the switch still OFF. Activation requires a separate operator decision. **NO-GO for Nano Banana 2 Lite**: no live canary, and the shared release allowlist deliberately excludes it. No quota/billing platform is needed for this V1.

The existing global flag would enable both catalog models. The minimal change is a shared, code-reviewed allowlist containing only `gemini-nb-2.1`. The API rejects Lite with HTTP 403 / `GEMINI_IMAGE_MODEL_NOT_RELEASED` before Attempt claim/replay, credential lookup, ledger writes or provider execution. Workspace readiness, Manual/Assisted/Automatic generation and Settings use the same rule. Saved Lite values remain readable and unchanged; they never become 2.1 or another provider. A saved choice can remain displayed in the selector, but cannot execute.

The switch remains exact-match `CONTENT_STUDIO_GEMINI_IMAGE_GENERATION=enabled`, absent/OFF by default. Authentication, Session ownership, execution-environment isolation and idempotent Attempt contracts remain intact. Preview/unknown runtimes stay blocked. The revoked exact-request canary stays inert. OpenAI and legacy **NanoBananaAPI.ai** keep their own routes, keys and behavior.

This is **model staging, not a user allowlist**. Once the global flag is enabled, every authenticated user with a usable Gemini BYOK credential can use 2.1. If an owner-only or named-user cohort is required, do not activate this global flag; that is a separate access decision. Do not describe credential possession as enforced cohort isolation.

## Automatic audit and essential safeguards

One explicit **Gerar automaticamente** click freezes the selected text/image models, requests one prompt and then one 2.1 image at the UI's fixed **1K / 1:1**. Changing mode or reopening a saved Automatic session starts nothing. An existing authored prompt requires explicit overwrite confirmation. Synchronous locks reject double starts; no image retry loop, provider fallback or background generation exists. The summary states `1 chamada de texto + 1 geração de imagem` and shows the paid-Google-BYOK notice before submission. The text provider is configured independently and can also incur cost.

The audit found an existing recovery defect: Automatic replaced Gemini's preserved request id after network loss or an in-progress replay. The focused fix keeps that id for **Tentar só a imagem** and Manual recovery; a definitive failed response rotates it, so a later explicitly authorized attempt can be new. **Gerar tudo de novo** is deliberately a new paid workflow. Unknown outcomes must be checked in history before starting a new workflow. Image submission cannot be cancelled once sent. Legacy provider recovery behavior is preserved.

V1 safeguards: retain BYOK/paid notice, one in-flight browser run, server Attempt uniqueness, no hidden retries, closed model gate, honest partial cost, and an OFF rollback deployment. Monitor quota/429, timeouts, rejected responses and storage failures; configure spending alerts/limits in the operator's Google account as appropriate. These browser locks are not account-wide concurrency limits or budget enforcement. No automatic evaluator/refinement chain is added to image generation.

## Reconciled canary verified read-only

Production Usage API and the actual **Configurações → Uso e custos** page now include all four rows at `2026-10-12T07:55:50.234847Z` for Attempt `56ba444f-0280-4675-aa2a-ec90267e8eb8`:

| Component | Tokens | Known USD estimate |
|---|---:|---:|
| input | 29 | 0.0000435 |
| image_output | 1120 | 0.0336 |
| thoughts | 868 | 0.00651 |
| output_unattributed | 315 | unavailable; no amount/rate |
| Known subtotal | | **0.0401535** |

The reconciled row reports `output_modality_unattributed`, original timestamp and user BYOK funding. Cost coverage is partial. The page displays **Custo estimado parcial (preço de tabela)** and **315 tokens de saída (modalidade não informada)** / **Preço indisponível**. Its all-provider summary also includes other executions; it is not a dedicated canary subtotal. The canary-only subtotal above is verified from the four API components, before display rounding. No reconciliation SQL was executed in this audit.

## Exact future activation — not executed

1. Review and merge the focused gate/recovery PR after green checks. Deploy its exact merged `main` SHA with the switch **absent**. Inspect `content.multihuman.com.br`: target Production, READY, correct Git SHA. Record that OFF deployment id for rollback; confirm the canary variable is absent. Do not enable the pre-gate `7eaf801` deployment.
2. Separately authorize activation of **2.1 for authenticated BYOK users**, with the scope limitation above. In Vercel team **fmultimans-projects**, project **content-studio-ai** (`prj_jzyOMApIukhDc25xF2BpmHyjvZR4`), add only the Production variable **CONTENT_STUDIO_GEMINI_IMAGE_GENERATION**, value **enabled**. Do not add Preview/local variables, a Lite override or `CONTENT_STUDIO_GEMINI_IMAGE_CANARY`. Do not change keys or prices.
3. Create a fresh Production Git deployment of the reviewed merged SHA; changing a variable alone does not update the running deployment. With the authenticated CLI, write this non-secret request to `gemini-release-deploy.json`, substituting **REVIEWED_MERGE_SHA** in `sha`:

```json
{
  "name": "content-studio-ai",
  "project": "prj_jzyOMApIukhDc25xF2BpmHyjvZR4",
  "target": "production",
  "gitSource": {
    "type": "github",
    "repoId": 1221838288,
    "ref": "main",
    "sha": "REVIEWED_MERGE_SHA"
  }
}
```

```sh
vercel api '/v13/deployments?forceNew=1' --method POST --input gemini-release-deploy.json --scope fmultimans-projects
vercel inspect DEPLOYMENT_ID --wait --timeout 10m --scope fmultimans-projects
vercel inspect content.multihuman.com.br --scope fmultimans-projects
```

4. Verify READY, matching `gitSource.sha`, assigned Production domain and no alias error. Read authenticated `/api/settings/providers`: Gemini image availability must be `available`. In the canonical image workspace, 2.1 is eligible with the user's key and Lite is disabled with its release explanation; saved Lite cannot start Automatic or Manual. Verify the paid notice and existing historical image/Usage. Use mocked regression results for negative API gates; **do not perform a paid smoke or generate an image as part of activation verification** without fresh authorization.

## Passive monitoring

Record activation time and deployment SHA. During the initial supervised window, inspect naturally submitted 2.1 Attempts, provider/route logs and Usage: one claimed Attempt per client request, at most one linked image, response usage captured before storage, no duplicate idempotency keys, and partial estimates whenever any output is unpriced. Never infer zero cost from missing usage or a failed image. Expect no new `gemini-nb-lite` Attempt. Watch 429, timeouts/outcome_unknown, storage/link/ledger failures and wrong model/size. Stop expansion and rollback on any Lite execution, duplicate paid execution from recovery, credential leak, lost paid usage, or repeated storage/provider failures. No scheduled provider probes or automatic retries.

## Immediate rollback

Reassign the last **known OFF Production deployment**, without waiting for a rebuild. Current audited fallback is `dpl_2B7bov85Zwg2as9LhoDm5Du7RMxT` (`7eaf801`, accounting fixed, release/canary OFF); prefer the later gate PR's verified OFF deployment if available:

```sh
vercel rollback dpl_2B7bov85Zwg2as9LhoDm5Du7RMxT --scope fmultimans-projects --yes
vercel inspect content.multihuman.com.br --scope fmultimans-projects
```

Read `/api/settings/providers`: `available=false`, `reason=release_switch_off`. Saved Google history remains readable, and generation is disabled. Rollback cannot recall an already submitted provider request; let its Attempt/accounting settle without resubmission. Remove the release flag from the **Production project configuration** so future builds also stay OFF. With the same reviewed-SHA JSON, force a fresh OFF build so it reads the updated environment:

```sh
vercel api '/v13/deployments?forceNew=1' --method POST --input gemini-release-deploy.json --scope fmultimans-projects
vercel inspect NEW_OFF_DEPLOYMENT_ID --wait --timeout 10m --scope fmultimans-projects
```

Verify READY, the exact SHA and `release_switch_off` on this new deployment. Vercel rollback disables automatic domain assignment; restore it only by promoting this verified OFF Production deployment:

```sh
vercel promote NEW_OFF_DEPLOYMENT_ID --scope fmultimans-projects --yes
vercel inspect content.multihuman.com.br --scope fmultimans-projects
```

Recheck OFF on the active domain. Leave the canary absent. Preserve Attempts, images, reconciliation, usage and pricing; no SQL rollback or credential change.

## Validation

Mocked route/canary/environment boundaries, shared readiness, Settings, Manual/Assisted/Automatic workflows, network/in-progress recovery and legacy NanoBanana regression passed: **385 tests across 9 files**, run in bounded groups (269 gate/workflow + 47 real workspace + 69 client/legacy). Typecheck passed; changed-file lint passed with 0 errors and 15 existing workspace warnings. The first combined run hit a forks worker startup timeout; the threads rerun had one cold-import NanoBanana timeout, which passed isolated with a larger command timeout and no product/test changes. Independent review resolved the Automatic recovery finding and passed 5 real UI cases plus 9 actual helper/provider-outcome probes. Full-suite/build limits from the accounting task are not reclassified as green; this bounded audit uses focused tests, typecheck, lint and the PR's Vercel build. PR/build disposition is recorded in the epic readiness report.

## Code deployment closure — activation remains OFF

On 2026-10-12 the operator authorized closing [PR #188](https://github.com/fmultiman/content-studio-ai/pull/188) with a merge commit, without activation. The audited implementation HEAD is `b64c7766c512f429660da192fb09e79423712d52`, based on `7eaf801`. Its Vercel and Vercel Preview Comments checks passed and the PR was CLEAN; GitHub listed no additional required checks. The Preview deployment `dpl_3N4v6kKMF8vWhehDZcccq6CAVQPo` was READY at that exact implementation SHA. This documentation update must also pass the published checks before merging.

The final closure evidence in the linked PR records the final checked HEAD, merge SHA, exact-SHA Production READY deployment and read-only confirmation of `release_switch_off` and absent canary/release variables. Do not treat the earlier Preview or an older Production deployment as proof of the merged code deployment. No activation, variable/database/credential change or paid request is part of this closure. Lite remains blocked; future activation still requires separate authorization.

FUTURE_064_STAGED_RELEASE_READY
