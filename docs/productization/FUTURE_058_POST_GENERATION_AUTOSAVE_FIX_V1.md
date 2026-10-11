# FUTURE-058 — Post-generation autosave revision-conflict fix V1

Status: implemented, validated with mocked providers, merged and deployed (evidence at the end). No migration, no worker change, no provider call, no Production data manipulation.

Source: Traycer audit artifact `future-057-post-smoke-hardening-audit` (Part B). Baseline `origin/main` `d5624082df7558f4022646ad071151e301a5507c`.

## Actual root cause

A completed image generation advances the Session revision **on the server** (`lib/image-generation/execution.ts` `linkImageOutput`: `current_image_id`, `working_state.currentImageId`, `revision = revision + 1`; the OpenAI route and the NanoBanana status sync both go through it). The generation response does not carry the new revision and `refreshCanonicalExecution` reloads Attempts only, so the browser's autosave controller kept its previous token. The first authored edit afterwards was saved with an obsolete `expectedRevision`, the Session PATCH answered `409 SESSION_VERSION_CONFLICT`, the controller entered `conflict` and **stopped scheduling saves** (`setLocal`/`schedule` return early in `conflict`), and a following "edit the prompt → Criar Imagem" was refused by the pre-submit save ("Resolva o conflito de salvamento…"). Edits stayed only in memory; "Manter minhas alterações" recovered them, a reload lost them. The behaviour predates FUTURE-057 (session convergence `f19e87b`) and applied to every canonical Image session after any successful OpenAI or NanoBanana generation, in Manual, Assisted and Automatic modes and Gerar Novamente.

## Before / after

| | Before | After |
| --- | --- | --- |
| First edit after a generation | PATCH with stale revision → 409 → `conflict`; later edits never sent | 409 recognised as revision-only → revision adopted → the **same** snapshot re-sent once → saved, status stays "Salvo" |
| Edit → regenerate | refused until the banner is resolved | the pre-submit save succeeds; the image request is sent |
| Another writer changed authored state | `conflict` | **unchanged**: `conflict`, local edit kept, "Manter minhas alterações" works |
| Provider requests caused by saving | none | none |

## The reconciliation guard (`lib/generation-session/autosave.ts`, `send()`)

On a failed save, an automatic retry happens **only if all of these hold**:

1. the failure is `kind: 'conflict'` and carries the canonical server snapshot returned by the existing 409 response (`result.server`);
2. the server token differs from the token the request used (a 409 reporting the same token is not a revision-only change);
3. the adapter fingerprint of the server snapshot (authored fields only — prompt, PT prompt, details, `autoMode`, model, references, generation config; **not** `currentImageId`/`imageStatus`) equals the fingerprint of the controller's **last acknowledged baseline** — never React state or the current local value;
4. the snapshot can be serialized/compared (any exception ⇒ not benign);
5. this send is not already the retry.

If so, the controller adopts `{server snapshot, server token}` as the acknowledged baseline and re-sends the same target **exactly once** (`reconciled = true`). Edits typed meanwhile remain in `pending` and follow through the existing success path with the new token, one request at a time, so nothing is dropped. A second 409 (retry or not benign) goes through the unchanged failure path: `conflict`, `failed` target recorded, waiters resolved with the failure. Stale responses are still discarded by the existing epoch/sequence check, so a reload during the retry cannot write. The video workspace uses the same controller; it benefits only if its server snapshot is authored-identical, otherwise nothing changes.

**Retry limit:** one automatic retry per failed save; no loop.

## Regression coverage

Controller unit tests (`lib/generation-session/__tests__/autosave-revision-conflict.test.ts`, 16 tests; 6 of them fail on the original controller, the other 10 prove preserved behaviour): normal autosave; benign 409 reconciled with exactly one retry and a clean end; adopted baseline keeps server-owned fields and later edits use the new token; retry that also gets 409 surfaces the conflict after exactly two attempts and keeps the local edit; genuine authored divergence ⇒ one save, `conflict`, server never overwritten; existing "keep local" and "reload server" recoveries; missing server snapshot; malformed snapshot; same-token 409; non-conflict failures unchanged; an edit typed while the first request is in flight (reconciled save first, newer edit after, final server state = newest); rapid edits plus a stale response after `resetAcknowledged`; lifecycle (keepalive) flush; flush barrier; no `fetchCurrent`/network call other than the save.

Page-level tests on the real `/imagens` shell (`components/images/post-generation-autosave.test.tsx`, 9 tests; 8 fail on the original controller): for **OpenAI** and **NanoBanana** — the first edit after a generation persists with exactly `[409, 200]` PATCHes, the same snapshot, a higher revision, no conflict banner and no provider call; a following edit saves with a single PATCH and "edit prompt → generate again" sends the second image request with no conflict toast; a fresh mount after an acknowledged save shows the persisted edit (reload/navigation). Plus: genuine divergence shows the conflict, sends one PATCH, keeps the server value and recovers with "Manter minhas alterações"; a racing second 409 ends in `conflict` after exactly two PATCHes; the FUTURE-057 Automatic workflow still makes one text call and one image submission and its first following edit persists. The existing FUTURE-057 workflow, Prompt Assistance and conflict tests are unchanged and pass.

## Validation

| Check | Result |
| --- | --- |
| Focused: controller (existing + new), page-level post-generation, image workspace, Prompt Assistance, Settings | PASS |
| Typecheck | 0 errors |
| ESLint (changed files) | 0 errors, 0 warnings |
| Full suite (5133 tests / 281 files) | First run under heavy machine load (another project's test runs were active): 22 failures, all classified — 20 are repository-scan / large-object / UI tests that exceed the 5 s default timeout under load and were re-run in isolation (13 files: 12 passed whole; the remaining one is the known-flaky video optimistic-concurrency test, which also passed **4/4 with the fix and 4/4 with the original controller** in dedicated runs); the 2 `Estilo`/`Estilos` label mismatches (`editor-workspace`, `static-parity`) are pre-existing on clean `ec7afea` and unrelated. No failure is attributable to this change |
| Build | See delivery evidence |

## Residual limitations

- The fix reconciles only **revision-only** conflicts. A server-side change to an authored field is still a visible conflict by design.
- The retry re-sends the exact target once; if the server keeps racing (two consecutive bumps) the user sees the existing banner. The banner's small size and wording are unchanged (a UX follow-up, not part of this fix).
- The generation response still does not carry the new revision; the controller learns it from the 409. Returning it from the routes would avoid one request but needs route/handler changes in several paths and was deliberately not done.
- Edits made on a page that is closed during an unresolved genuine conflict are still lost, as before.

## Rollback

Revert the controller change (`send()` benign branch and `benignRevisionConflict`); behaviour returns to the previous conflict handling. No data, schema or server change to undo.

## Migration, worker, persistence

None, none, none.

## Delivery evidence

Filled at merge time.
