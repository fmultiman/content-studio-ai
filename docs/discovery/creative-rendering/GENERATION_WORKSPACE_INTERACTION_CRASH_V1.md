# GENERATION_WORKSPACE_INTERACTION_CRASH_V1

P0 hotfix, FUTURE-049. Starting point: `origin/main` `08af8c431ff9f2dd867ddca84ebf2eb88da359f6`
(Production deployment `dpl_J5zzNBMe5ewVv9zjVziupNExegqJ`). Branch `fix/generation-workspace-interaction-crash-v1`.
Migration: **none**. Paid provider calls: **0**.

## Symptom (Production, directly observed)

| Surface | Gesture | Result |
|---|---|---|
| `/videos/geracoes/[sessionId]` | open Model dropdown → select **Kling 2.6** | Next.js error boundary "This page couldn’t load" |
| `/imagens/geracoes/[sessionId]` | type one character into the prompt | same error boundary |

Both pages **load** correctly. No server-side error exists: the failure is entirely in the browser.

## Reproduction (Phase 0, real Production app, authenticated)

Run in the authenticated Production tab against two noncritical sessions, no Generate clicked.

| | Video | Image |
|---|---|---|
| Route | `/videos/geracoes/11912666-…` | `/imagens/geracoes/f89db0b4-…` |
| Initial state | `Salvo`, Kling API (REST), Kling 3.0, text/i2v empty prompt | `Salvo`, prompt empty |
| Gesture | open model Select, choose *Kling 2.6* | `fill` textarea with `x` |
| Console error | `Uncaught TypeError: Illegal invocation` | `Uncaught TypeError: Illegal invocation` |
| First useful frame | `Object.setLocal` (autosave controller) ← React effect (commit phase) | identical |
| Network requests triggered | **0** (no PATCH/PUT began) | **0** |
| Autosave | never began, therefore nothing to complete | never began |
| DOM transition | page body replaced by "This page couldn’t load / Reload / Back" | identical |
| First invalid state | none — the exception is thrown before any state is left invalid; Production data unchanged | identical |

Classification: the same exception, the same frame, from two unrelated gestures → **one shared root cause**.

## Root cause

`lib/generation-session/autosave.ts`, `createGenerationSessionAutosave`:

```ts
const clock: Clock = options.clock || {
  setTimeout: globalThis.setTimeout,        // native function stored as a bare property
  clearTimeout: globalThis.clearTimeout,
}
…
timer = clock.setTimeout(() => { … }, debounceMs)   // called with `this === clock`
```

Browsers (WebIDL) brand-check the receiver of `setTimeout`/`clearTimeout`. Calling them as a method of an
arbitrary object throws `TypeError: Illegal invocation`. Node and jsdom do not check the receiver, so every unit
and component test passed. No caller passes `options.clock`, so production always used the broken default.

Why both workspaces broke on *different* gestures: `setLocal` only schedules a debounce timer when the new
snapshot differs from the acknowledged one. Hydration leaves them equal, so loading works. The first real
difference — a typed character (Image) or a model change (Video) — reaches `schedule()` → `clock.setTimeout` and
throws inside the React effect that mirrors form state into the controller. An exception in an effect has no
local handler, so React unmounts to the route error boundary.

No other call site stores a native timer as a property (audited `globalThis|window|self .setTimeout/clearTimeout/
setInterval/requestAnimationFrame` across `lib`, `hooks`, `components`, `app`; all other uses are direct calls).

## Introduction

* Introducing commit: `c082728` — `feat: standardize generation session autosave` (2026-10-05, squashed into main
  between `b52a8f6` and `068814a`, i.e. before PR #132). It created `autosave.ts` with the unbound default clock.
* First known-good: `b52a8f6` (before the shared controller existed; Image/Video used page-local timers).
* First known-bad: `c082728`. Every later main — including #144, #145, #146 and #147 — carries the bug, so none of
  them introduced it. Production smoke after the Image recovery (#137) was load-only and could not see it.
* Production load smokes were green throughout because they never mutated state (see the release gate).

## Fix

`createDefaultClock()` (exported) wraps the global timers in arrow functions that look `globalThis.setTimeout` up at
call time:

* a receiver-checked call is impossible (the wrapper's own `this` is never forwarded);
* late binding keeps `vi.useFakeTimers()` effective even if installed after the controller module loaded;
* the injectable `options.clock` contract is unchanged.

The controller logic (debounce, single-flight coalescing, epoch guard, CAS tokens, conflict handling, flush
barriers) is untouched. Autosave is not bypassed, nothing is caught or swallowed, inputs stay controlled.

## Kling 2.6 support status

Kling 2.6 (`kling-v2-6`) is a first-class REST model: `lib/video-generation/rest-capabilities.ts`
(`REST_KLING_V2_6_ID`, label *Kling 2.6*, `multiShot: false`) is the registry that feeds the dropdown, and
`capabilities.ts` maps the MCP aliases `kling-v2-6` / `kling-video-v2_6`. The option is intentionally offered and
valid; the crash was never about the model. Gemini/Veo's absence from the generation dropdown is by design
(Gemini is a Review provider only) and is not part of this regression.

## Autosave behaviour

| | Before | After |
|---|---|---|
| First edit after hydration | `setLocal` throws → error boundary | `clean → dirty` |
| Debounce (800 ms) | never reached | `dirty → saving → clean`, PATCH carries edit |
| Rapid edits | n/a | coalesced; newest wins |
| Restore to saved value | n/a | cancels pending save when equal; otherwise saves |
| Conflict | n/a | `conflict` surfaced, local edit kept |

## Tests (all fail on the unfixed code with the exact Production error, pass after)

Harness: `lib/generation-session/__tests__/browser-timers.ts` makes `setTimeout`/`clearTimeout` throw
`Illegal invocation` for a non-global receiver — the browser contract Node/jsdom skip.

* `lib/generation-session/__tests__/autosave-browser-timers.test.ts` — harness self-test; first edit
  dirty→saving→clean; rapid edits; delete; restore-cancels; CAS conflict; dispose; flush; late-bound fake timers;
  static guard against any production source storing a native timer as a bare property.
* `components/images/image-generation-workspace-interaction.test.tsx` — real `ImagesPageShell`: first character,
  several characters, rapid edits, delete + exact restore, revision conflict; PATCH carries `expectedRevision`
  and the prompt; no provider/Review/POST request; no navigation; error boundary never entered.
* `components/videos/video-generation-workspace-interaction.test.tsx` — real Video route page: dropdown opens,
  Kling 3.0 → 2.6 → 3.0, selection reaches form state and the PATCH (`kling-v2-6`, then `kling-v3`) with
  `expectedUpdatedAt`, connection stays Kling API, prompt edits afterwards, exact restore, no generation POST,
  unsupported saved model degrades safely.
* Existing suites re-run unchanged: video workspace autosave, shared autosave, Image/Video Review, Gemini usage,
  stale Review recovery, route-param convergence.

## Release gate

`docs/CRITICAL_UX_FLOW_RELEASE_GATE.md` now requires **mutation canaries** (edit → save → restore → save, no
Generate) for Image and Video Generation after any change touching the workspaces, shared autosave, session
schemas, provider/model registry, route state or shared form components.

## Evidence preserved / out of scope

Production usage rows were not touched (5 Kling and 6 Gemini `provider_usage_events`, 17 completed Image Reviews,
2 completed Video Reviews). FUTURE-048 is separate. No migration.

## Interactive validation

Recorded in the PR and appended here after the Preview and Production mutation canaries run.
