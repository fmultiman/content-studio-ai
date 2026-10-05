---
title: "Generation Session Autosave Reliability Preflight V1"
status: preflight
---

# Generation Session Autosave Reliability Preflight V1

## Scope and execution contract

This document is the read-only implementation preflight for `GENERATION_SESSION_AUTOSAVE_RELIABILITY_V1`. It describes the implementation that a lighter coding agent may execute after this document is accepted. It does not change product code, database schema, routes, provider behavior, or data.

The reliability slice covers only the two canonical generation workspaces:

* `/imagens/geracoes/[sessionId]`, backed by `ImageGenerationSession`;
* `/videos/geracoes/[sessionId]`, backed by `VideoGenerationSession`.

It excludes ImageDraft and VideoDraft persistence, Creative Editor authoring, Review, Library, Approval, Undo/Redo, and provider implementation changes. Attempts remain immutable submission history. Provider polling remains an execution concern and must not become a second working-state writer.

The audit was performed against `origin/main` at `f19e87bb1b3c4f6196c179d61ca7a4ec551d3dfb` in the existing worktree. The implementation branch must start from verified current main. No paid provider was called and no database mutation was performed for this preflight.

Starting Git evidence: worktree `C:/Users/flavi/.traycer/worktrees/fmultiman__content-studio-ai/feat-image-generation-session-attempt-foundation-v1`, previous branch `feat/image-generation-route-convergence-v1`, previous HEAD `ffd5c1a3ad8ddbd183802c0353b7807fd8d914e6`, clean status, and no tree diff from verified `origin/main`. The same worktree was switched to the documentation-only branch `discovery/generation-session-autosave-reliability-preflight-v1` directly from verified main. No worktree was created/deleted/pruned.

Architectural inputs: `GENERATION_SESSION_AND_REVIEW_ARCHITECTURE_CONVERGENCE_V1.md`, `IMAGE_GENERATION_SESSION_AND_ATTEMPT_FOUNDATION_V1.md`, `IMAGE_GENERATION_ROUTE_CONVERGENCE_V1.md`, and `GENERATION_DRAFT_AUTOSAVE_AND_RESUME_REGRESSION_AUDIT_V1.md` in this directory. Current source wins over older closure wording: the canonical Image source, for example, does not currently restore `workingPrompt` into `userInput`.

## Decisions for the implementation agent

The implementation must use one shared, pure autosave controller with two adapters. The controller shares state-machine, queuing, CAS, stale-response, flush, retry, and navigation-barrier semantics. The adapters retain media-specific serialization and token handling.

The controller must not assume that Image and Video use the same revision type:

| Workspace | Server token | Server save operation |
| --- | --- | --- |
| Image | integer `revision` | `PATCH /api/image-generation-sessions/[id]` with `expectedRevision` |
| Video | opaque `updatedAt` string | `PUT` for first material save, `PATCH` with `expectedUpdatedAt` thereafter |

No migration is expected. Existing revision/CAS columns are sufficient. The implementation changes client orchestration and, if required to prevent lifecycle fields from being overwritten, the existing Image PATCH projection. It must not add a table, column, or migration.

## Current implementation map

### Image

The canonical route is a thin wrapper at `app/(dashboard)/imagens/geracoes/[sessionId]/page.tsx`. It renders `ImagesPageShell` from `app/(dashboard)/imagens/page.tsx` with `canonicalSessionId`. The large client page is therefore the current workspace, hydrate path, form state, autosave, generation actions, history, and route navigation boundary.

Relevant current functions and state in `app/(dashboard)/imagens/page.tsx`:

| Concern | Current location | Observed behavior | Reliability consequence |
| --- | --- | --- | --- |
| Local working state | top-level state in `ImagesPageContent` | `userInput`, generated prompts, details, `autoMode`, `selectedModel`, image status, attempt counter, current image and URL are independent React state values | There is no canonical working snapshot object owned by the save mechanism |
| Canonical snapshot | `buildCanonicalWorkingState`, effect immediately above `saveCanonicalSession` | Builds schema v1 state, but hard-codes `sourceReferences: []` and default generation config | A save can erase meaningful source/config state; serialization must be fixed in the adapter |
| Snapshot ref | `canonicalSnapshotRef` | Effect updates it whenever selected fields change | It is not an acknowledged baseline and has no edit epoch/fingerprint |
| Save | `saveCanonicalSession` | 800 ms effect calls it; a `sessionSaveInFlight` promise serializes calls and `sessionSaveQueued` coalesces them | Single-flight exists, but there is no trailing snapshot identity or stale-response protection |
| Debounce | canonical autosave effect around the `saveCanonicalSession` call | 800 ms; dependencies include `sessionRevision` | Every successful revision update can schedule another save; hydration may save without a user edit |
| CAS | `saveCanonicalSession` and `app/api/image-generation-sessions/[id]/route.ts` | Sends integer `expectedRevision`; server updates only matching revision and returns 409 with current session | A 409 sets the client revision to `null`, effectively freezing future saves with no conflict UX |
| Save status | `isSavingDraft` | Used as a legacy draft indicator; no canonical saved/error/conflict vocabulary is rendered | Users cannot tell whether the canonical Session is acknowledged |
| Hydrate | mount `fetchData` effect and `applyCanonicalSessionState` | GETs Session and attempts; loads output rows and signed URLs; restores project, production, prompts except `userInput`, model, status, output, and history | `userInput`, generation config, and source references are not restored; an autosave can overwrite the missing description |
| Reload | `reloadCanonicalSession` | GETs Session and Attempts and calls full `applyCanonicalSessionState` | Called after provider success and Nano polling, so async output completion can overwrite later local edits |
| Generate | `handleCreateImage`, `handleRegenerate`, `handleGenerateNanoBanana` | Generates a fresh random request ID and dispatches provider work directly; no flush barrier | Attempt/provider request can represent a closure/default rather than the latest acknowledged intent |
| Output update | provider success followed by `reloadCanonicalSession`; server `linkImageOutput` also updates Session output pointer | Lifecycle refresh is mixed with form hydration | Output completion must update history/output only and never reset working state |
| Navigation | `handleNewImage`, bar around lines 1909, image hub buttons, shell links | Uses `router.push`, `router.replace`, `router.back`, and some direct links | Navigation cannot wait for a pending Session save |
| Unload | the legacy ImageDraft effect has `beforeunload`; canonical Session has no unload handler | Legacy handler is out of scope and does not protect the canonical Session | Reliability work must add canonical handling without reactivating Draft authority |

The Image API is `app/api/image-generation-sessions/[id]/route.ts`. It authenticates, verifies the Session belongs to the current user, validates the strict working-state schema, and performs a revision compare-and-swap. `lib/image-generation/session.ts` defines the schema. The existing Image execution boundary in `lib/image-generation/execution.ts` freezes and claims an Attempt before provider dispatch, and `linkImageOutput` later updates output/lifecycle fields. The reliability work must preserve that boundary.

The canonical Image provider paths are the OpenAI path in `handleCreateImage`/`generateOpenAIImage` and the Nano path in `handleGenerateNanoBanana`. Regeneration uses the same provider helpers. They are first-party calls, and all must use the same save-before-submit barrier. This slice must not alter provider request semantics except for the sequencing and stable logical request identity required by the barrier.

### Video

The canonical route is `app/(dashboard)/videos/geracoes/[sessionId]/page.tsx`, whose `WorkspacePageContent` owns the form, Session hydrate, autosave, route exit behavior, Generate sequencing, conflict actions, and Attempt polling.

| Concern | Current location | Observed behavior | Reliability consequence |
| --- | --- | --- | --- |
| Local working state | `prompt`, `selection`, `sourceSelection` | Working state is assembled as `VideoGenerationWorkingStateV1` | Good adapter boundary; preserve media-specific controls |
| Hydrate | `useEffect` beginning at the `// HYDRATE` comment | GETs connections and Session; reconciles unavailable connection selection; sets `lastSavedStateRef` to the hydrated/reconciled snapshot without writing | This is the strongest current hydrate behavior and must remain clean |
| First save | `executeSaveLoop` | Uses `PUT` with project/production/config when there is no Session; response creates Session and route is replaced to canonical URL | A successful first save must use the server-returned state/token as baseline |
| Later save | `executeSaveLoop` | Uses `PATCH` with `expectedUpdatedAt` and serialized working state | Correct CAS shape; keep token opaque and exact |
| Single flight | `isSavingRef`, `pendingStateRef`, `waitersRef` | A save in flight stores the newest target; loop saves the queued target afterward | The intent is correct but a completion can briefly report `saved` while a newer target is pending |
| Debounce | effect around line 409 | 800 ms and compares JSON with `lastSavedStateRef` | Coalesces ordinary edits; implement in shared controller with no timer reset after acknowledgement unless a new dirty value exists |
| Flush | `flushSave` | Enqueues current state and waits for `executeSaveLoop`; Generate calls it before POST | Reuse the semantic barrier, but flush a captured Generate snapshot rather than a later closure value |
| Conflict | `performConflictResolution` | 409 exposes `reload_server` and `keep_local`; local state is retained until explicit choice | This is the target minimal UX. Move its semantics to shared controller/adapter without automatic overwrite |
| Error | `executeSaveLoop` | Sets `error`; no typed classification or explicit save retry; `forceRetry` reloads connections/page state | Replace implicit retry with explicit retry while preserving local state |
| Unload | effect around lines 440–453 | `visibilitychange` and `pagehide` call ordinary `flushSave`; hidden visibility gate may ignore some `pagehide` events | Use a one-shot keepalive-capable flush where safe; document best-effort limits |
| Attempt polling | effect around lines 253–293 | 10 second interval (`lib/video-generation/status-refresh.ts`), skips hidden document, single refresh in flight, reloads attempts and syncs recoverable items | Polling already avoids form hydration; preserve and test that isolation |
| Generate | `handleSubmit` | Captures validation and controls, awaits `flushSave`, then POSTs `/api/video-generations`; stable `currentClientRequestIdRef` survives ambiguous outcomes | Keep idempotency and add exact snapshot equivalence checks |
| Output/library refresh | `loadAttempts`, `markGenerationSaved` | Updates Attempt rows/library links only | Must never affect form baseline or mark local state saved |
| Navigation | back button around line 630, fatal `/videos`, preview callback, shell links | Programmatic and Link navigation can leave without flush except Generate | Add guarded navigation for controlled exits |

The Video API is `app/api/video-generation-sessions/[id]/route.ts`: `PUT` creates the first material Session, `PATCH` uses `expectedUpdatedAt`, and 409 returns the current Session. `lib/video-generation/session.ts` and `lib/video-generation/working-state.ts` define the working-state contract. `/api/video-generations` creates the immutable Attempt before provider dispatch and already has `clientRequestId`/fingerprint protection. No Video schema or provider changes are in scope.

## Reliability state machine

`HYDRATING` and `GENERATING` are orthogonal controller gates, not save states. The shared save controller exposes exactly these save states:

| State | Entry | Exit | Allowed events | UI label | Navigation |
| --- | --- | --- | --- | --- | --- |
| `CLEAN` | Hydration acknowledged; local fingerprint equals acknowledged fingerprint; no request/queue | Local serialized edit, explicit retry, or conflict resolution | edit, retry, navigate, generate | `Salvo` | navigate immediately |
| `DIRTY` | Local fingerprint differs from acknowledged fingerprint and no request is running | debounce expires, explicit flush, retry, or local edit | edit, debounce, flush, retry, navigate | `Alterações pendentes` | controlled navigation starts flush |
| `PENDING` | A dirty target is queued while a request is in flight, or a flush barrier is waiting | current request settles and queued target starts, or error/conflict | edit, request settled, cancel only on session teardown | `Alterações pendentes` | wait for queue; do not navigate yet |
| `SAVING` | A request is sent with a fixed target fingerprint and token | success, validation/auth/network error, or CAS conflict | edit (queues newest target), response | `Salvando…` | wait for the complete barrier |
| `ERROR` | A request failed without a proven server acknowledgement | manual retry, edit (remains dirty), discard explicitly | retry, edit, discard-and-leave confirmation | `Erro ao salvar` | stay; retry or explicit discard |
| `CONFLICT` | Server rejects the token and returns a current Session, or server state cannot be reconciled to a known target | explicit reload-server or keep-local choice | reload, keep local, discard local | `Conflito de alterações` | stay until resolved; no silent navigation |

`CLEAN` is only allowed after the server has acknowledged the exact current serialized snapshot. A request that returns after a newer edit can acknowledge only its own target. The controller must not display `Salvo` while a newer target is queued.

## Shared save controller contract

Add a pure module at `lib/generation-session/autosave.ts` and a thin client hook at `hooks/use-generation-session-autosave.ts`. The pure controller is the test authority; the hook only wires React state, lifecycle, and the adapter.

Proposed types:

```ts
type SaveToken = number | string | null
type SaveState = 'clean' | 'dirty' | 'pending' | 'saving' | 'error' | 'conflict'

type SaveSuccess<S, T extends SaveToken> = {
  ok: true
  snapshot: S
  token: T
}

type SaveFailure<S, T extends SaveToken> = {
  ok: false
  kind: 'network' | 'server' | 'auth' | 'validation' | 'conflict'
  snapshot: S
  token: T
  server?: { snapshot: S; token: T }
  retryable: boolean
}

type GenerationSessionAutosaveAdapter<S, T extends SaveToken> = {
  serialize(value: S): S
  fingerprint(snapshot: S): string
  save(input: { snapshot: S; expectedToken: T; keepalive: boolean }): Promise<SaveSuccess<S, T>>
  classify(error: unknown, snapshot: S, token: T): SaveFailure<S, T>
  fetchCurrent(): Promise<{ snapshot: S; token: T }>
}

type GenerationSessionAutosave<S, T extends SaveToken> = {
  state: SaveState
  acknowledged: { snapshot: S; token: T } | null
  local: S
  pending: S | null
  resetAcknowledged(snapshot: S, token: T): void
  observeServer(snapshot: S, token: T): void
  subscribe(listener: () => void): () => void
  setLocal(value: S): void
  flush(): Promise<SaveSuccess<S, T> | SaveFailure<S, T>>
  flushSnapshot(value: S): Promise<SaveSuccess<S, T> | SaveFailure<S, T>>
  retry(): Promise<SaveSuccess<S, T> | SaveFailure<S, T>>
  flushLifecycle(): void
  resolveConflict(mode: 'reload_server' | 'keep_local' | 'discard_local'): Promise<boolean>
  dispose(): void
}

declare function createGenerationSessionAutosave<S, T extends SaveToken>(options: {
  sessionKey: string // media type plus Session id, never just route query params
  initial: { snapshot: S; token: T }
  adapter: GenerationSessionAutosaveAdapter<S, T>
  debounceMs: 800
  canPersist(snapshot: S, token: T): boolean
  clock: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout }
}): GenerationSessionAutosave<S, T>
```

Export the factory and all types above. The React hook is `useGenerationSessionAutosave(options)` with the same options plus `enabled` (false during hydrate); it returns the controller snapshot and stable method callbacks. It uses `subscribe`/`useSyncExternalStore`, calls no API during render, and creates one controller per `sessionKey` after hydration. These semantics are mandatory:

1. `acknowledged` belongs to the controller, not a page effect. It is the last server-confirmed editable projection and token.
2. `local` is the latest user working snapshot. It is never replaced by an Attempt poll or output lifecycle refresh.
3. `setLocal` serializes and fingerprints synchronously, clears no local data, and coalesces only the latest target.
4. The controller owns the debounce timer, in-flight request, queued target, request sequence, and flush waiters.
5. `flushSnapshot` is used by Generate. It saves exactly the captured snapshot and returns only when that snapshot is acknowledged, or returns a typed error/conflict. It must not silently switch to a later snapshot as the Generate request.
6. The adapter owns media-specific API paths, body shapes, token parsing, and server response projection.
7. `fetchCurrent` is used only for explicit conflict handling and bounded recovery, never as a background rehydrate after every Attempt update.
8. `observeServer` accepts a lifecycle GET response without replacing local state. If a save is in flight it defers token reconciliation until that request settles. Otherwise it may adopt a token only when the server editable fingerprint matches the acknowledged editable fingerprint; a differing editable fingerprint while locally dirty enters conflict. An unchanged local form must not silently hydrate a concurrent editor's response.
9. `resetAcknowledged` is called only on initial hydrate or explicit reload/discard. It increments the epoch, clears timers, and resolves abandoned waiters with a typed failure. `dispose` does the same and prevents later UI notifications; it must not abort a dispatched write and then pretend it did not commit.
10. `fingerprint` is stable JSON of the editable projection, with recursively sorted object keys and preserved array order. Preserve whitespace/string content that the API preserves; no ad hoc prompt trimming or signed URL in a fingerprint. Clone snapshots at capture so later object mutation cannot rewrite A.
11. `canPersist` is always true for existing Sessions, including a user intentionally clearing fields. For new lazy Video state (null token), it requires a nonblank prompt or a selected source. Visiting or changing only model controls does not create a Session.
12. No retry is automatic. After `ERROR`, further edits update local/pending but retain the error until manual retry; after `CONFLICT`, edits do not send. A positive acknowledgement is the sole normal path back to `CLEAN`.

### Save algorithm

The implementation agent must implement this algorithm literally:

1. On hydration, call `resetAcknowledged(snapshot, token)`. Set `local` to the same snapshot, cancel timers, and enter `CLEAN`. Hydration never calls save.
2. On edit, serialize and fingerprint the latest value. If its fingerprint equals the acknowledged fingerprint and no request is active, enter `CLEAN`; otherwise store it as `local`, enter `DIRTY`, and arm one 800 ms trailing timer.
3. On timer expiry, or explicit `flush`, move the latest local snapshot into `pending`. If a request is active, enter `PENDING` and return the existing barrier. Otherwise send one request with the pending snapshot and the current acknowledged token; enter `SAVING`.
4. While request A is in flight, edits B and C replace `pending` with C. They never mutate A's request body. The UI remains locally C and the state is `PENDING`.
5. When A succeeds, adopt A's returned token and A snapshot as acknowledged. Do not change local form state. If local/pending fingerprint differs from A, immediately send the latest pending snapshot with A's returned token; do not wait another debounce and do not show `CLEAN`. Otherwise resolve the relevant waiters and enter `CLEAN`.
6. If A returns after a newer controller/session epoch, ignore its UI effects. The server may have committed A, but the old controller must not update the new route's state, token, or baseline.
7. If A is a conflict, preserve local/pending state and enter `CONFLICT`; do not retry against the returned token automatically. The server snapshot is shown only in conflict UI or after explicit reload.
8. If A fails with a known non-acknowledgement network/5xx response, preserve local/pending and enter `ERROR`. Do not automatically resubmit an ambiguous request. Manual retry first performs a GET classification described below.
9. Every request body uses the token captured when it started. Never read a mutable React token after awaiting the response to construct a prior request's meaning.
10. Success is validated before acknowledgement: response Session ID must match, token must be present/valid, and returned editable fingerprint must equal the submitted target. If a Video duplicate `PUT` returns another stored state, enter conflict rather than marking the target saved. A malformed 2xx is an ambiguous failure, not success.

`flush` resolves only when current local state is acknowledged and there is no in-flight/trailing target. `flushSnapshot` first sets that captured target synchronously and must run under the Generate/navigation edit lock. Its waiter resolves only for that exact fingerprint, not simply for any successful response. Failed/disposed barriers resolve once and never hang. Internal request sequence numbers plus `sessionKey`/epoch reject late responses. Aborting a GET is safe; aborting a PATCH is never proof the server did not commit.

This algorithm handles A/B/C without false saves: A acknowledges only A; B and C remain pending and are sent serially against A's returned token.

## Image adapter contract

Change the canonical branch of `app/(dashboard)/imagens/page.tsx` to use the shared controller. Keep the legacy ImageDraft effect untouched and unreachable for the canonical workspace.

The Image editable projection must contain exactly the fields needed to resume a generation:

* `workingPrompt` (`userInput`);
* generated prompt and Portuguese prompt;
* prompt details;
* `autoMode`;
* selected model/provider selection;
* source/reference identities;
* the complete editable `generationConfig` currently supported by the Session schema.

Exclude from the editable fingerprint and autosave body:

* `currentImageId` and `legacyImageUrl`;
* `imageStatus` while it reflects provider lifecycle;
* `currentAttempt` counters derived from execution;
* `legacyCurrentEvaluation`, evaluation/history JSON, and Review fields;
* signed display URLs;
* Project/Production/user IDs and revision tokens.

The adapter must stop hard-coding empty `sourceReferences` and default generation config. It must preserve hydrated values and serialize the current controls. If a field is not actually editable in the canonical UI, preserve the server value rather than replacing it with a fabricated default.

The Image adapter calls `PATCH /api/image-generation-sessions/[id]` with `expectedRevision` and the editable projection. The server route must protect server-owned lifecycle keys (`current_image_id`, output mirror, and lifecycle state) from a stale form PATCH. It may merge those keys from the current row while retaining the same CAS check. This is a bounded correctness change to the existing API, not a schema change.

Hydration must set `userInput` and all serialized config/source fields. It must establish one acknowledged baseline after all async output URL work is complete, guarded by a hydrate epoch/cancel flag. A late hydrate response must not overwrite a newer local edit.

Image output and Attempt refresh must use a separate `refreshImageExecutionState` path. It may update the history list, current output pointer, signed URL, status, and lifecycle token. It must not call `applyCanonicalSessionState`, replace `userInput`, replace prompt/config, reset the acknowledged editable baseline, or mark local edits clean.

### Image Generate sequencing

For OpenAI, Nano, and regenerate:

1. Lock editable controls for the submission and capture an immutable effective request object synchronously, including the exact prompt override, model, config, source identities, and a stable `clientRequestId`.
2. Feed the captured working snapshot to the controller with `setLocal`/`flushSnapshot`. Do not wait for a React render to make the captured prompt current.
3. Await the flush result. On error/conflict, do not dispatch a provider request; keep the form and show the save error/conflict action.
4. Build the provider request from the acknowledged captured snapshot, not from a later closure, output refresh, or fresh full Session hydrate.
5. Pass the captured submitted prompt, model/config, source snapshot, and working description through `generateOpenAIImage`/Nano POST into `freezeAndClaimImageAttempt`. The helper must write those request values to the Attempt and must not read mutable Session working fields to reconstruct them. It still validates Session ownership, Project/Production scope, and that the Session exists. Existing Attempt replays must be found and compared against their stored fingerprint before any new-request validation: editing the Session afterward must not invalidate a network retry. The flush revision proves that this client had an acknowledged Session snapshot immediately before submit; the immutable Attempt request body is the final authority if another tab edits after that acknowledgement. An `expectedSessionRevision` precondition may be added only as a bounded early conflict check before a new claim; it is not a transaction and cannot be described as eliminating the race window. If the product requires an atomic Session-revision-to-Attempt claim, stop and request a DB/RPC decision rather than inventing one in this mission.
6. Reuse the same `clientRequestId` for retries of the same logical Generate action. An ambiguous network result must not mint a new ID. The UI must offer status/replay using that ID or require explicit confirmation before a new logical submission.
7. Provider success updates output/history through the execution refresh path only. It does not rehydrate the form.

`handleGeneratePrompt` and `handleRegenerate` must pass the returned prompt into this capture path, avoiding the current stale-state branch where `handleCreateImageWithModel` can read the previous generated prompt.

## Video adapter contract

Change `app/(dashboard)/videos/geracoes/[sessionId]/page.tsx` to use the shared controller while preserving its stronger existing semantics:

* keep the 800 ms debounce;
* keep no empty Session creation on mere visit;
* keep first material save via `PUT` and later saves via `PATCH`;
* keep exact opaque `updatedAt` strings;
* keep explicit `reload_server` and `keep_local` conflict choices;
* keep connection reconciliation during hydrate;
* keep 10 second Attempt polling, hidden-tab pause, and single refresh in flight.

The Video editable projection is the existing `VideoGenerationWorkingStateV1`: `schemaVersion`, `prompt`, `source` (generated/library identity), and `selection`: `connectionRef`, `operation`, `modelId`, `duration`, `resolution`, `aspectRatio`, `audio`, `multiShot`, `asmr`, `audioPrompt`, and `musicPrompt`. Source summary labels/thumbnails, Attempt list, provider lifecycle, result preview, and Library-file association are excluded from its dirty fingerprint.

Hydrate acknowledgement uses the server projection. If `reconcileSelection` changes unavailable settings, keep the adjusted local projection and show the existing adjustment notice with `Alterações pendentes`; do not call it `Salvo` or write merely on hydrate. Arm autosave on the first subsequent user mutation, and allow explicit Generate/navigation flush to save the adjusted state. Stripping `?new=1` by same-Session `router.replace` must not start a second hydrate or reset pending state: key hydrate/controller lifetime by Session ID, not cleared query parameters. A reused Attempt is an explicit local input, not an acknowledged server state.

`executeSaveLoop` becomes the Video adapter's `save`. Its baseline must adopt the actual response working state and `updatedAt`, including the server's result on first `PUT`. A repeated `PUT` response that says `created: false` must not be treated as a new local acknowledgement if the server returned a different projection.

`handleSubmit` must capture one effective `prompt/source/selection` object, flush that exact object, verify its acknowledgement, and only then POST `/api/video-generations`. The existing stable `currentClientRequestIdRef` must remain stable from the first attempt through an ambiguous retry and must be cleared only after a confirmed outcome. Polling and `markGenerationSaved` may update Attempts, but never call `setPrompt`, `setSelection`, `setSourceSelection`, `resetAcknowledged`, or `setSaveState('saved')` for the working form.

## Route-exit flush

Introduce a client navigation guard in a persistent dashboard context, such as `components/generation-session/session-navigation-guard.tsx`, registered by each canonical workspace. The guard exposes `runBeforeNavigate(target, navigate)` and a `GuardedLink` wrapper.

Exact guard API: `register(sessionKey, { flush, getState, lockEditing, discardLocal }): () => void`; `runBeforeNavigate(target: string, navigate: () => void | Promise<void>): Promise<boolean>`; `GuardedLink` keeps Next Link props/refs and uses synchronous `onNavigate.preventDefault()` before awaiting the barrier. Mount the provider around `StudioShell` and children in `app/(dashboard)/layout.tsx`; its default behavior is immediate navigation when no canonical workspace is registered. Register a stable controller, not a stale render closure. On successful navigation close the mobile drawer; on failure keep it and the editable snapshot available. Avoid retaining snapshots after logout.

| Exact controlled exit | Current mechanism | Required integration |
| --- | --- | --- |
| Image `handleNewImage` | POST new Session then push | Flush current Session before creating another; failure creates no empty extra Session |
| Image workspace back bar | Production push or `router.back()` | Flush then deterministic Production/project/Image hub target |
| Image provider configuration actions | `router.push('/configuracoes?tab=api')` | Guard push |
| Video back/fatal-error buttons | `router.push(backTarget)` or `/videos` | Guard push when a hydrated controller exists |
| Video preview `onNavigate` | callback to router | Supply guarded callback; dialog has no save engine |
| `WorkspaceIdentityContext` / `ContextLink` | native same-tab `<a>` | Optional guarded navigation callback, prevent default for unmodified same-tab clicks; preserve other surfaces |
| `SaveImageToLibrary` / `SaveGenerationToLibrary` success links | Link to `/arquivos` | Guard only navigation, leave promotion POST semantics untouched |
| Shell `UtilityAction`, logos, `StudioShellNavLink`, settings menu | Link / imperative push | Shared guarded Link/callback; mobile drawer closes only after success |
| `GlobalUtilityBar.handleLogout` | signOut then navigation | Flush first; auth failure does not sign out/discard local state |
| Same-Session query cleanup | `router.replace` | Bypass exit guard only when Session ID is unchanged; no rehydrate |

Do not guard download anchors or external/new-tab links as workspace exits. Native browser Back/Forward is described separately below.

For controlled same-origin SPA exits:

1. If the workspace is `CLEAN`, call navigation immediately.
2. If `DIRTY`, `PENDING`, or `SAVING`, prevent the Link navigation, disable duplicate navigation intents, call `flush`, wait for the exact current local snapshot to be acknowledged, then navigate.
3. If flush returns `ERROR` or `CONFLICT`, remain on the workspace. Show `Erro ao salvar` or `Conflito de alterações`; offer `Tentar novamente`, conflict resolution, and an explicit `Descartar alterações e sair` action. Never navigate automatically after failure.
4. First navigation intent wins while a flush is in progress; subsequent clicks do not create parallel saves or navigations.
5. On direct buttons using `router.push`, replace the direct call with `runBeforeNavigate`. Replace `router.back()` in the Image bar with a deterministic target (`production`, project, or `/imagens`) so the guard can own it. Apply the same rule to Video back/fatal/preview destinations.
6. Wrap dashboard `Link` paths in `components/layout/studio-shell.tsx`, the Project/Production `ContextLink` in `components/projects/inherited-project-identity.tsx`, and generation-result Library/production navigation where an active workspace can be present. Preserve modifier-key/new-tab behavior.
7. Logout must flush before `signOut`, while authentication is still available. If flush fails, remain signed in and show the error.

Next.js `Link.onNavigate` is the intended same-origin SPA interception point and exposes `preventDefault`; it does not run for modifier-key new tabs, external URLs, or downloads. Use it for Links and an equivalent guarded function for programmatic `router.push`. Sources: [Next.js Link `onNavigate`](https://nextjs.org/docs/app/api-reference/components/link) and [Next.js `useRouter`](https://nextjs.org/docs/app/api-reference/functions/use-router).

Browser Back/Forward cannot be made into a fully awaitable, cancelable route transition using a supported App Router API. The implementation must not monkey-patch private history internals. The guard may keep a persistent controller alive and attempt a best-effort drain, but the guaranteed contract applies to controlled application navigation only. This limitation must be visible in the implementation notes and tests.

## Hard reload, tab close, and lifecycle flush

Use `visibilitychange` as the primary lifecycle signal and `pagehide` as the fallback, both deduplicated by a one-shot flush epoch. Do not use the legacy ImageDraft `beforeunload` handler for canonical state. A `beforeunload` listener may be added only to show the browser's generic unsaved-changes prompt while dirty, and must be dynamically attached/removed; it is not a save transport.

When the document becomes hidden or receives `pagehide` with dirty/pending state:

* cancel the debounce timer;
* take the latest serialized snapshot and token;
* send at most one `fetch(..., { keepalive: true })` request if the body is small enough for browser keepalive limits and the Session is authenticated;
* do not start a second request beside an existing save; let the existing request finish or mark the state as best-effort pending;
* do not use `sendBeacon` because the current authenticated PATCH/CAS response and conflict handling require a normal fetch contract;
* do not claim that tab termination is durable.

Freeze the lifecycle transport details: listen on `document` for `visibilitychange` and `window` for `pagehide`; do not gate `pagehide` on visibility. Register `beforeunload` only while unacknowledged state exists, call `preventDefault` and set `returnValue`, and do not launch parallel writes there. For lifecycle flush, UTF-8 body length plus known in-flight keepalive bodies must be at most 60 KiB; otherwise do not send a lifecycle request and retain the warning. Requests started normally may set keepalive when under this bound; an already-started ordinary fetch cannot be converted. The platform counts combined in-flight body bytes against 64 KiB, so even the 60 KiB cap is best effort in the presence of other requests. Do not use `sendBeacon`, `fetchLater`, synchronous XHR, unauthenticated endpoints, or new prompt storage in localStorage. Reset deduplication when visible again and use a new edit epoch for another lifecycle attempt. Sources: [Fetch Standard keepalive bound](https://fetch.spec.whatwg.org/) and [MDN keepalive](https://developer.mozilla.org/en-US/docs/Web/API/Request/keepalive).

`visibilitychange`/`pagehide` are more useful than `unload`/`beforeunload`, but mobile browsers can omit lifecycle events. MDN documents these limitations: [visibility/page lifecycle guidance](https://developer.mozilla.org/en-US/docs/Web/API/Window/pagehide_event), [beforeunload limitations](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event), and [deferred fetch reliability limits](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Deferred_Fetch). The authoritative guarantee remains acknowledged debounced/flush saves and controlled route exits; lifecycle events are best effort.

## Generate while dirty

Both workspaces use the same rule: a Generate action submits the exact snapshot captured at click time.

1. Validate the form locally.
2. Capture the effective request synchronously, including prompt override and all media controls.
3. Set the captured snapshot into the controller and call `flushSnapshot(captured)`.
4. If another request is in flight, wait for it and then save the captured target immediately against the returned token. Do not submit a stale closure.
5. If the controller returns conflict or error, do not call the provider or Attempt API.
6. After acknowledged save, construct the Attempt request from the captured snapshot and current returned token. The Attempt must contain the exact prompt/config/source identity the user saw at click time.
7. Provider dispatch occurs only after the server creates/claims the Attempt. A provider lifecycle completion may update history/output but cannot alter the captured working snapshot.

The input controls remain locked from capture through Attempt creation to prevent the user seeing a submission that differs from the frozen request. After Attempt creation, a new edit creates a new dirty working snapshot and cannot mutate the Attempt.

## Attempt polling isolation and current output ownership

Attempt polling is a server execution refresh, not a form save. For Image, the provider completion path and `linkImageOutput` may update Attempt status, output ID, current output pointer, display URL, and history. For Video, polling and `markGenerationSaved` may update Attempt status, preview/result, and Library linkage.

These updates must never:

* update the editable working snapshot;
* replace the acknowledged editable baseline;
* clear queued/pending edits;
* trigger autosave;
* call the full Session hydrate function;
* set a form save status to `CLEAN`.

Current output pointer semantics are different from editable state:

* Image output pointer is server lifecycle state maintained by execution. It is excluded from the editable fingerprint. A Session refresh may update it separately and update the token held by the adapter without replacing local prompt/config.
* Video has no Session `latest/current output` pointer in the working-state contract. Attempt/result rows own execution output. They are always excluded from working-state dirty comparison.

If an Image output-only server update advances `revision` while the editable projection still equals the controller's acknowledged projection, the adapter may adopt the new token without marking the form dirty. Never adopt the token from an out-of-order lifecycle GET ahead of an in-flight acknowledgement; defer, then GET fresh state. A 409 itself still enters conflict without retry. On explicit retry, an unchanged editable projection permits fresh-token saving; a changed projection requires the conflict actions. If editable projections differ, surface conflict rather than overwrite the form. The output completion CAS can fail to move the convenience pointer; show the output through its Attempt linkage and do not repair pointers with client autosave.

## Status UX

Use one Portuguese vocabulary in both workspaces:

| Controller state | Label | Meaning |
| --- | --- | --- |
| `CLEAN` | `Salvo` | The current editable snapshot was acknowledged by the server |
| `DIRTY`/`PENDING` | `Alterações pendentes` | Local edits exist and are waiting for a save or a prior request is still being completed |
| `SAVING` | `Salvando…` | A fixed snapshot is currently in a server request |
| `ERROR` | `Erro ao salvar` | The latest request did not receive a usable acknowledgement; local state is retained |
| `CONFLICT` | `Conflito de alterações` | CAS rejected the token; explicit choice is required |

Create `components/generation-session/session-save-status.tsx` as a small presentation component. It receives state, last acknowledgement time, and retry/conflict callbacks; it owns no persistence. Do not label an in-flight request `Salvo`, including when a newer edit is queued.

## Conflict UX

On 409, preserve the local snapshot in memory and enter `CONFLICT`. Show:

* `Recarregar versão salva`: GET current Session, replace the working form with the server editable projection, adopt its token as acknowledged, discard local edits only after this explicit action, and return to `CLEAN`.
* `Manter minhas alterações`: GET current Session, adopt only its current token, keep local snapshot, retry the local snapshot through CAS. If that retry conflicts again, return to `CONFLICT`.
* `Descartar alterações e sair`: explicit confirmation, then navigate without a save. It is the only path that leaves with local changes unacknowledged.

No automatic merge, no last-write-wins retry, and no silent `setRevision(null)`. The current Video actions are the product precedent and should be retained with the shared controller.

## Error and retry UX

| Error | Automatic retry | Manual behavior | Local state |
| --- | --- | --- | --- |
| Network failure / timeout | No; request outcome may be ambiguous | `Tentar novamente` first GETs current Session. If its editable fingerprint equals the last sent target, acknowledge that target, adopt token, then save any newer local snapshot; if it equals the previous acknowledgement, retain latest local state and retry with fresh token; otherwise show conflict | Retained |
| 5xx | No automatic retry | Same bounded manual classification as network; do not create duplicate Generate Attempt | Retained |
| 401/403 | No | Show authentication/permission error; do not sign out or discard; after auth is restored, explicit retry performs a fresh GET | Retained |
| 400/422 validation | No | Show field/server message; edit or correct, then normal debounce/manual retry | Retained |
| 409 CAS | No | Enter conflict actions above | Retained |

The Generate action treats any save error as a hard barrier: no provider call and no Attempt submission. The save retry itself must not use a new logical Generate `clientRequestId`.

Automatic retry count is zero; no automatic backoff timer. Coalesce repeated manual retry clicks into one GET/save chain. A missing Session (404) after an existing Session was hydrated is terminal for automatic save: preserve memory and show an unavailable-Session message; do not recreate it. A never-created Video Session may repeat its idempotent `PUT` only from the explicit retry path. A 2xx with malformed JSON/token is handled like an ambiguous network outcome. No refresh button may silently discard dirty state: use the explicit reload-server action.

## File-by-file implementation plan

### Shared core

| Path | Current role | Change | Test coverage |
| --- | --- | --- | --- |
| `lib/generation-session/autosave.ts` | Does not exist | Add pure generic controller, state machine, fingerprint, serial queue, CAS token, flush, retry, conflict and epoch behavior | deterministic fake-timer unit tests |
| `hooks/use-generation-session-autosave.ts` | No shared Session hook | Thin React adapter; exposes state/status and controller methods; no API assumptions | mount/edit/unmount and waiter tests |
| `components/generation-session/session-save-status.tsx` | No shared status | Render the five user labels and action callbacks | component state-to-label tests |
| `components/generation-session/session-navigation-guard.tsx` | No shared guard | Context/provider and `runBeforeNavigate`; guard canonical workspace only | controlled Link/programmatic navigation tests |
| `components/layout/studio-shell.tsx` | Global Links/logout/settings | Register guarded navigation and await flush before logout; preserve modifiers/external/downloads | shell navigation and logout tests |
| `components/projects/inherited-project-identity.tsx` | Project/Production links | Accept guard callback for same-tab navigation | context-link flush test |
| `app/(dashboard)/layout.tsx` | Persistent dashboard shell | Mount navigation provider around shell/children; inert outside canonical Generation Sessions | provider lifetime and no-impact tests |

### Image

| Path | Current role | Change | Test coverage |
| --- | --- | --- | --- |
| `app/(dashboard)/imagens/page.tsx` | Canonical image form, autosave, generate, history | Replace canonical autosave with adapter/controller; hydrate complete editable projection; separate lifecycle refresh; guard nav; flush-before-generate; stable request capture | image adapter, route, generate sequencing |
| `app/(dashboard)/imagens/geracoes/[sessionId]/page.tsx` | Canonical route wrapper | Verify `params` handling for the current Next version and pass the stable Session ID; do not duplicate state | route hydrate test |
| `lib/image-generation/session.ts` | Image working-state schema | Reuse; only add serialization helpers if required, no schema change | schema/fingerprint tests |
| `app/api/image-generation-sessions/[id]/route.ts` | Image GET/PATCH/CAS | Preserve server lifecycle fields when applying editable PATCH; return a complete editable projection/token | API CAS/lifecycle tests |
| `lib/image-generation/execution.ts` | Attempt claim/output link | Reuse; add only the minimum expected-revision/request guard needed before provider dispatch | Attempt-before-provider tests |
| `app/api/openai/generate-image/route.ts` and `app/api/nanobanana/generate/route.ts` | Canonical provider boundaries | Pass the frozen request snapshot/description into the claim helper; an optional early `expectedSessionRevision` check is allowed, but no false atomic guarantee; preserve legacy routes and stored-request replay | mocked no-paid boundary tests |
| `app/api/nanobanana/status/[taskId]/route.ts` | Polls/ingests output | Read-only regression coverage; no new working-state writes | completion isolation tests |
| `components/images/save-image-to-library.tsx` | Explicit promotion/Library link | Guard its existing Link; leave save/status HTTP behavior intact | existing promotion tests plus link guard |

### Video

| Path | Current role | Change | Test coverage |
| --- | --- | --- | --- |
| `app/(dashboard)/videos/geracoes/[sessionId]/page.tsx` | Video Session form/autosave/Generate/polling | Adapt to shared controller; preserve PUT/PATCH, conflict choices, 800 ms debounce, polling isolation and stable client request ID | existing Session API plus adapter parity tests |
| `lib/video-generation/session.ts` | Video Session response/types | Reuse exact `updatedAt` token; no timestamp normalization | token/CAS tests |
| `lib/video-generation/working-state.ts` | Video editable payload | Reuse serializer/fingerprint; exclude Attempt/output/library fields | working-state fingerprint tests |
| `lib/video-generation/status-refresh.ts` | 10 s polling interval | Reuse; no autosave coupling | polling isolation tests |
| `app/api/video-generation-sessions/[id]/route.ts` | Video PUT/PATCH/CAS | No schema change; confirm response returns authoritative state/token for adapter baseline | API CAS tests |
| `app/api/video-generations/route.ts` | Attempt creation/provider lifecycle | No provider redesign; confirm Generate receives the flushed exact request | mocked Attempt-before-provider/idempotency tests |
| `components/videos/save-generation-to-library.tsx` | Explicit promotion/Library link | Guard existing Link only | existing promotion tests plus link guard |

### Tests to add or change

Use existing colocated conventions under `lib/**/__tests__`, plus component/page tests where the current test setup supports them:

* `lib/generation-session/__tests__/autosave.test.ts` — pure controller matrix below;
* `lib/__tests__/image-generation-session-api.test.ts` — new executable mocked API tests for Image CAS/lifecycle projection; current foundation tests mostly inspect source/schema and are insufficient for this behavioral gate;
* `lib/__tests__/video-generation-session-api.test.ts` — preserve existing Video CAS cases and add actual response-baseline case;
* `lib/__tests__/image-generation-route-reliability.test.ts` — mocked fetch/provider boundary, no paid provider;
* `lib/__tests__/video-generation-route-reliability.test.ts` — mocked fetch/Attempt boundary and polling isolation;
* `components/generation-session/__tests__/navigation-guard.test.tsx` — controlled Link/router/logout behavior;
* `components/generation-session/__tests__/session-save-status.test.tsx` — labels/actions.
* `hooks/__tests__/use-generation-session-autosave.test.tsx` — disabled hydrate, Session epochs, unmount and waiter settlement;
* `components/videos/video-generation-workspace.test.tsx` — extend the existing mounted workspace tests;
* `lib/__tests__/image-route-convergence.test.ts` — update obsolete source assertions (including per-handler random UUID assertions) while retaining route/Attempt invariants;
* `lib/__tests__/openai-generate-image-route.test.ts` — extend request guard/replay behavior;
* `lib/__tests__/video-generation-session-generate.test.ts` — retain existing Attempt/idempotency/security coverage;
* `components/images/save-image-to-library.test.tsx` and `components/videos/save-generation-to-library.test.tsx` — retain explicit promotion tests and add guarded destination behavior.

## Exact future test matrix

Each test must use a fake adapter and fake clock for save-controller behavior, and mocked `fetch`/provider functions for route behavior. No real provider credential or paid API may be used.

1. **Debounce coalescing** — hydrate A/token1; edit B, then C before 800 ms; advance clock; assert one save with C and token1.
2. **Edit during in-flight save** — resolve request A only after edit B; assert A body is unchanged, B is queued, then B sends with A's returned token.
3. **Three edits during in-flight save** — A in flight, edit B/C; assert only C is sent after A and the controller never enters `CLEAN` between them.
4. **Stale response** — start request A, dispose/reinitialize epoch, hydrate X/token2, resolve A; assert A cannot change X, token2, or status.
5. **CAS conflict** — save with token1 and return 409/current token2; assert state `CONFLICT`, local snapshot retained, no automatic retry.
6. **Conflict reload** — choose reload-server; assert form/server snapshot replaces local only after action and state becomes `CLEAN`.
7. **Conflict keep-local** — choose keep-local; assert current token is adopted, local snapshot remains, and one CAS retry is sent.
8. **Retry after network/5xx** — fail request; assert state `ERROR`, no timer retry, local retained; manual retry performs bounded GET classification then sends at most one retry.
9. **Route-exit flush** — dirty state and guarded same-origin navigation; assert preventDefault, one flush, navigation only after acknowledgement.
10. **Route-exit failure** — flush returns error/conflict; assert navigation does not run and action UI remains.
11. **Reload after acknowledgement** — save B, mount/hydrate, assert B and returned token are loaded and no save occurs on hydrate.
12. **Generate while pending** — request A in flight, capture Generate B; assert B flushes before Attempt/provider, body equals B, and no provider call occurs on save error.
13. **Attempt polling isolation** — update Attempt/output while local prompt is dirty; assert prompt/config, acknowledged fingerprint, and pending queue are unchanged.
14. **Current output no phantom dirty** — lifecycle output pointer changes token; assert editable state remains `CLEAN` if projection is equal and does not trigger a form save.
15. **Image adapter parity** — assert Image integer revision is sent exactly and editable projection preserves source/config.
16. **Video adapter parity** — assert Video opaque timestamp is sent exactly and first PUT response baseline is authoritative.
17. **No paid provider** — mock provider boundary and assert zero real provider/network calls in all unit/route tests.
18. **Image Attempt ordering** — provider mock is not invoked until Attempt claim resolves; later Session edit cannot change the claimed request.
19. **Video idempotency** — retry the same ambiguous `clientRequestId`; assert one Attempt and no second provider submission.
20. **Navigation modifiers/downloads** — Ctrl/Cmd/new-tab and download links bypass the SPA guard as documented and retain browser behavior.
21. **Initial empty/later clearing** — new Video form empty/source-null does not PUT; existing Image/Video fields intentionally cleared do PATCH and reload as cleared.
22. **Uncertain acknowledgement** — simulate PATCH commit followed by lost response, then manual GET equal to target; acknowledge it without sending a duplicate PATCH. If local C is newer, send C once against recovered token.
23. **First PUT race** — response `created:false` contains state X different from target A; enter conflict, never claim A saved.
24. **Lifecycle token race** — lifecycle GET and PATCH resolve out of order; no token rollback, no overwrite of editable state; use fresh GET reconciliation.
25. **Keepalive events** — hidden then pagehide sends one request, uses same-origin auth/CAS and body cap; an in-flight request is not duplicated; oversized body sends no lifecycle request; visible resets the epoch.
26. **Generate paths/parity** — OpenAI, Nano, regeneration and prompt-auto mode all capture the returned override, flush, then freeze Attempt before provider mock; a failed flush produces zero dispatches.
27. **Image request snapshot/replay** — the Attempt stores the captured prompt/config/source/description even when Session is edited afterward; an optional mismatched expected revision returns 409/zero provider calls; same stored request replay after Session edits succeeds/reports status without a second paid dispatch.
28. **Shell/logout guard** — dirty workspace flushes before signOut; error blocks signOut; outside canonical workspace every shell link/logout retains original behavior.
29. **Responsive/status** — component tests plus authenticated intercepted browser checks at 1280x800, 820x1180, 390x844 show state labels, retry/conflict buttons and guarded hub return on both media. Use existing Sessions, mocked requests or non-paid Session edits only; no generation/provider synchronization call that can incur cost.
30. **Reconcile hydrate** — unavailable Video model changes local controls, retains raw server acknowledgement, shows pending adjustment, writes nothing until user edit/Generate/navigation flush.

New controller tests are behavioral assertions with fake timers/deferred promises, not source-string mirrors. Provider mock spies must verify order and payload, not merely function names in a file. Run `pnpm exec vitest run` for the named touched tests, `pnpm typecheck`, touched-scope ESLint, `pnpm test`, `pnpm build`, and `git diff --check`. Record a fresh main baseline before attributing Creative Editor `Estilo`/`Estilos` or Windows path collection failures to historical debt; do not change them here.

## Safe implementation order

Each step must leave the tree typecheckable and testable:

1. Add pure shared controller/types and its fake-clock tests. Do not connect UI yet.
2. Add status component and navigation guard with tests, using a fake registered controller.
3. Adapt Video first: preserve current behavior, move its save loop behind the controller, and pass existing Video Session tests.
4. Adapt Image serialization/hydration and server lifecycle projection. Add Image controller tests before touching Generate.
5. Add Image lifecycle-only output refresh and remove provider-success calls to full `reloadCanonicalSession`.
6. Add flush-before-Generate capture for Video, then Image OpenAI/Nano/regenerate, retaining stable logical request IDs.
7. Wire controlled route exits, shell links, Project/Production context links, and logout.
8. Add lifecycle best-effort flush (`visibilitychange`/`pagehide`) and generic beforeunload warning only if the test/browser behavior supports it.
9. Run focused tests, then typecheck, lint, build, full suite, and `git diff --check`. Compare any historical failures to a clean baseline; do not fix unrelated label drift.

## Implementer stop conditions

Stop and report instead of improvising if any of these occurs:

* the Session API token changes from integer revision/opaque `updatedAt` without a compatible adapter;
* a requirement emerges for atomic Session-revision-to-Attempt creation that cannot be met by the existing API without a transaction/RPC/schema decision;
* a schema migration appears necessary;
* a route requires provider submission before a flush can be acknowledged;
* Attempt creation cannot be proven to occur before provider dispatch;
* a provider route needs a new paid call to test correctness;
* a controlled Next navigation cannot be prevented/awaited through supported APIs;
* browser Back/Forward is being treated as fully cancelable;
* conflict resolution would require silent last-write-wins or an automatic merge;
* an output/polling update needs to replace local working state to appear correct;
* Image source/config fields cannot be serialized without inventing values;
* Video's existing single-flight/CAS behavior would be weakened;
* a new mutable ImageDraft or VideoDraft writer is proposed;
* a test requires real credentials, production data mutation, or a paid provider;
* a failure cannot distinguish acknowledged, unacknowledged, and ambiguous server outcomes.

## Expected schema and migration impact

`NO MIGRATION` is the expected outcome. Image already has integer `revision`; Video already has `updatedAt` compare-and-swap. The controller must treat both as opaque tokens. Permitted server changes are the existing Image PATCH field projection and the bounded new-Attempt expected-revision guard/replay ordering described above. No new column/table/index/RPC is needed. A request-body addition is an API contract change, not a DB migration. Video APIs require regression proof, not a redesign.

## Residual risks and bounded guarantees

* Browser lifecycle events are best effort. The product guarantee is for acknowledged debounce/flush saves and controlled SPA navigation; hard termination can still lose the final edit.
* Browser Back/Forward cannot be fully guarded through a supported App Router cancellation API. The implementation must document this and avoid private-history monkey patches.
* The current Image page is a large compatibility surface. The implementation must keep Review/evaluation rendering and explicit Library/Approval behavior unchanged while removing full-hydrate calls from output completion.
* Image output lifecycle updates can advance the Session revision independently. The adapter must adopt a token only when the editable projection is unchanged; otherwise it must surface conflict.
* Existing signed URLs and output hydration are asynchronous. Epoch guards are required to prevent late URL or Session responses from overwriting edits.
* The prior route-convergence closure recorded successful typecheck/build and a mostly passing suite, but this preflight does not reclassify unrelated historical failures. The implementation agent must run a fresh baseline and identify any failure before changing touched code.

## Exact next mission

`GENERATION_SESSION_AUTOSAVE_RELIABILITY_V1`

Its first commit should add the pure controller and tests. It must not begin Review convergence, ImageDraft removal, VideoDraft changes, route grammar changes, Library changes, Approval changes, or any follow-on mission after its completion marker.

Recommended lighter implementer: Codex `gpt-5.6-terra`, reasoning `high`, one writer, fast mode off. This model was present in the harness model inventory during preflight. The recommendation is a workload-fit judgment, not a benchmark claim. Escalate to SOL for the listed stop conditions; do not let the implementer reopen the frozen architecture or run multiple writers.
