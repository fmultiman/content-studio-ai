# Generation Session Autosave Reliability V1

## Scope and authority

- Starting `origin/main`: `b52a8f6d6f9d1db34bcdd5e53044587a8270bf55`.
- Authority: `GENERATION_SESSION_AUTOSAVE_RELIABILITY_PREFLIGHT_V1.md`.
- Scope: the canonical Image and Video Generation Session workspaces only.
- No schema migration, provider call, Review change, Library change, approval change, or legacy Draft autosave change was made.

## Shared controller

`lib/generation-session/autosave.ts` provides the media-neutral controller. Its public API is:

```ts
createGenerationSessionAutosave({ sessionKey, initial, adapter, debounceMs, canPersist })
// resetAcknowledged, observeServer, setLocal, flush, flushSnapshot,
// retry, resolveConflict, flushLifecycle, dispose
```

The controller owns `clean`, `dirty`, `pending`, `saving`, `error`, and `conflict` state. `clean` means the server has acknowledged the exact current local fingerprint. It uses a trailing 800 ms debounce, one in-flight request, and a latest-snapshot pending slot.

For edits A → B → C while A is saving, A completes against its original token. B is discarded as superseded, C saves once using A's returned token. An acknowledgement for A cannot mark C clean. A controller is bound to its `sessionKey`; disposal invalidates its epoch so late responses cannot affect a new workspace.

`hooks/use-generation-session-autosave.ts` binds the controller lifetime to the active Session. `components/generation-session/session-save-status.tsx` exposes the shared Portuguese status vocabulary: **Salvo**, **Alterações pendentes**, **Salvando…**, **Erro ao salvar**, and **Conflito de alterações**.

## Concurrency, retry, and unload

Adapters retain their native tokens:

| Workspace | CAS token |
| --- | --- |
| Image | integer `revision` |
| Video | opaque `updatedAt` |

409 produces `conflict`; local state remains in memory. Users may reload/discard server state or explicitly keep local state and retry from a freshly reconciled token. Network and server errors retain local state. The controller never blindly retries an ambiguous request: `retry()` first fetches current server state, recognizes an already-applied snapshot, or turns a divergent server snapshot into a conflict.

Both workspaces call `flushLifecycle()` on `visibilitychange` to hidden and `pagehide`. It uses `fetch(..., { keepalive: true })` through the relevant adapter when there is no request already in flight. Browser termination cannot guarantee acknowledgement; a missing acknowledgement is treated as ambiguous, never as proof that the server did not persist.

## Image adapter

`app/(dashboard)/imagens/page.tsx` now projects editable Image Session state into the shared controller and uses revision CAS through `PATCH /api/image-generation-sessions/[id]`.

The dirty fingerprint covers editable prompt, model, prompt details, Auto Mode, source references, and generation configuration. Current output, attempt count/status, image status, and persisted display URL are server/lifecycle data and do not create a phantom dirty state. The API preserves those lifecycle fields while applying a working-state PATCH, so an autosave cannot erase an output linked by provider execution.

Before OpenAI or Nano Banana dispatch, the workspace captures the exact request snapshot, flushes it, requires acknowledgement, and then sends the stable `clientRequestId`. The identifier changes only after confirmed provider completion. A save error or conflict prevents dispatch. Output/history refresh reads normalized Attempts and does not feed polling data back into the editable baseline.

## Video adapter

`app/(dashboard)/videos/geracoes/[sessionId]/page.tsx` now uses the same controller without changing `VideoGenerationWorkingStateV1`.

- A new meaningful workspace mutation still performs the initial `PUT`.
- Later saves remain `PATCH` with `expectedUpdatedAt`.
- The first successful PUT immediately updates the adapter context, so a pending coalesced save correctly becomes PATCH.
- Attempt polling, recovery sync, and Library-save refresh only update attempt UI. They do not overwrite the form or trigger autosave.
- Generate captures one working-state snapshot, flushes it, and uses that snapshot in the immutable generation request.

## Navigation and generation barriers

`components/generation-session/session-navigation-guard.tsx` is mounted by the dashboard layout. Known workspace navigation calls use it. A clean Session navigates immediately; dirty/pending/saving state flushes and awaits acknowledgement. Error or conflict leaves the user in the workspace with the retained local state and a status action.

For both media, Generate follows this exact sequence:

1. Capture the current form snapshot.
2. Flush that exact snapshot.
3. Require server acknowledgement and its returned token.
4. Create/claim the immutable Attempt from the submitted request snapshot.
5. Dispatch the provider.

The Session revision/token is an optimistic precondition, not a lock spanning Attempt creation and provider dispatch. The persisted immutable Attempt request remains the historical authority. This implementation did not require a transaction, RPC, lock, or schema change.

## Validation

- Shared controller tests: 8 passing scenarios covering debounce, A/B/C coalescing, exact flush barriers, CAS conflict, disposal, conservative retry, lifecycle flush, and empty lazy Session behavior.
- Image route/foundation tests: 9 passing tests, including provider attempt-before-dispatch and idempotency contract coverage.
- `pnpm typecheck`: passed.
- `pnpm build`: passed.
- `pnpm lint`: exited successfully with repository-wide pre-existing warnings; the workspace contains existing React Hooks warnings and legacy UI warnings outside this mission.
- The full suite still reports the known Creative Editor `Estilo`/`Estilos` expectation drift and the known Windows Vitest `/@fs/D:/Traycer/...` collection issue affecting the Video workspace test file. Focused controller and Image contract suites pass.
- Paid generation calls: **0**.
- Production and responsive authenticated smoke: not run in this closure; no authenticated browser session was available. No provider generation was attempted.

## Residual debt and next mission

ImageDraft and VideoDraft autosave are intentionally unchanged. Hard unload remains best effort by browser design. The next mission is **SHARED_REVIEW_CORE_AND_IMAGE_ADAPTER_V1**; it must not alter the established Session/Attempt reliability boundaries.
