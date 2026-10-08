# Critical UX flow release gate

Green typecheck, lint, unit tests, `next build` and a READY Vercel deployment prove that the code
compiles and deploys. They do **not** prove that a user can complete the flow. Production broke on
2026-10-05 with all of those green (see `IMAGE_GENERATION_WORKSPACE_REGRESSION_RECOVERY_V1` below).

## Rule

**CRITICAL UX FLOW CHANGED → authenticated smoke required before mission closure.**

A mission that edits any surface below is not complete, and its PR is not merged, until someone has run the
smoke for that surface in an authenticated Preview (or Production after merge) and recorded the
result (URLs, session ids, pass/fail) in the PR or the closure doc. An agent without authenticated browser
access must stop at `AWAITING_AUTHENTICATED_HUMAN_SMOKE`, leave the PR open and hand over the Preview URL and
the checklist; it must not merge on green checks alone.

## Surfaces and minimum smoke

| Surface | Minimum smoke |
|---|---|
| `/imagens` | Create from a Project/Production → lands on `/imagens/geracoes/[sessionId]` and **stays** there with prompt/model controls. Continuar on an existing Session hydrates prompt/config and output. Recent card shows the thumbnail. Refresh keeps the workspace. Back to hub and reopen keeps state. |
| `/videos` | Open an existing `/videos/geracoes/[sessionId]`; it hydrates. Start a new one; the Session is created and the workspace stays open. Refresh keeps it. |
| Creative Editor Static | Open a Static piece in the editor; canvas loads with its saved state; edit, save, refresh; state persists. |
| Creative Editor Video | Open a Video draft; timeline/preview load; edit, save, refresh; state persists. |

## Mutation canaries (LOAD is not enough)

`GENERATION_WORKSPACE_INTERACTION_CRASH_V1` (2026-10-08): both generation workspaces **loaded** fine on
Production and passed every load-only smoke, yet the first harmless edit (one character in the Image prompt,
or changing the Video model) fell into the Next.js error boundary. A smoke that only opens the page cannot see
that. For the surfaces below the smoke MUST mutate state, wait for autosave, restore the original state exactly,
and wait for the restoring save. No Generate click, no provider call, ever.

| Canary | Steps (use a known test/noncritical session; record original values first) | Pass |
|---|---|---|
| Image Generation | Route `/imagens/geracoes/[sessionId]` loads → type a unique temporary suffix in the prompt → page stays alive → save indicator goes dirty/saving → **Salvo** → persisted prompt contains the suffix (reload or GET) → restore the ORIGINAL prompt exactly → **Salvo** again | No error boundary; no provider/Review request; original prompt restored and persisted |
| Video Generation | Route `/videos/geracoes/[sessionId]` loads → change the model (Kling 3.0 → Kling 2.6) → page stays alive → autosave succeeds → change back to the ORIGINAL model → **Salvo** → edit the prompt with a temporary suffix → **Salvo** → restore the exact original prompt → **Salvo** | No error boundary; no `POST` to generation endpoints; original model, connection and prompt restored |

Run these canaries after any change touching: the generation workspaces, the shared autosave controller
(`lib/generation-session/autosave.ts`, `hooks/use-generation-session-autosave.ts`), session schemas, the
provider/model registry, route state, or shared form components. Evidence (URL, session id, original values,
restored values, pass/fail) goes in the PR or the closure doc.

Unit tests that exercise timers must run under browser timer semantics: Node and jsdom do **not** throw
`Illegal invocation` for a detached `setTimeout`, browsers do. Use
`lib/generation-session/__tests__/browser-timers.ts` (`installBrowserFaithfulTimers`) in component tests that
render a workspace.

## What to look at, not just "page loads"

- The final URL after each navigation (a redirect back to a hub is a failure even if nothing errors).
- The workspace content (controls and hydrated values), not only the absence of an error toast.
- The browser console and the failing network request, if any.

## Environment Requirements

Preview media smoke requires media-environment parity.
If the Preview cannot produce working signed URLs or media fails to render in the browser, verify that the media storage environment variables (`S3_ENDPOINT`, `S3_BUCKET_NAME`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, etc.) are configured to target the `Preview` environment in Vercel, not just `Production`. A missing environment variable will fail signed media URLs.

## Test conventions that protect these flows

- Route components are tested by rendering the **real** route page and shell with only network, auth and
  router faked. Source-text assertions (`toContain('canonicalSessionId')`) do not exercise behaviour and
  cannot replace this.
- Next.js 16 passes `params` and `searchParams` to pages as **Promises**. Client pages must read route
  params with `useParams()` (or `use(params)`), never `params.x`. `lib/__tests__/image-route-convergence.test.ts`
  scans the App Router tree for a synchronously typed `params` prop.
- A "not yet loaded" state must be a distinct loading state, never treated as missing or invalid.

## Incident reference — IMAGE_GENERATION_WORKSPACE_REGRESSION_RECOVERY_V1

Introduced by `IMAGE_GENERATION_ROUTE_CONVERGENCE_V1` (PR #128, `f19e87b`): the new
`/imagens/geracoes/[sessionId]` page read `params.sessionId` from the prop. Under Next.js 16 `params` is a
Promise, so the id was `undefined`, the shared shell treated the page as the hub, and after
"Carregando editor de imagem..." it rendered the Project/Production chooser although the Session had just
been created. Build, types, lint, unit tests and Vercel could not see it because no test rendered the route and
the only route test asserted source text. The same PR also dropped the thumbnail the old drafts list showed and
never added one to the new Session cards.

## Incident reference — GENERATION_WORKSPACE_INTERACTION_CRASH_V1

Introduced by `c082728` (`feat: standardize generation session autosave`, 2026-10-05). The shared autosave
controller built its default clock as `{ setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout }`
and called `clock.setTimeout(...)`; browsers brand-check the receiver, so the first `setLocal` after hydration threw
`TypeError: Illegal invocation`. Image (typing) and Video (model selection) crashed through the same line. See
`docs/discovery/creative-rendering/GENERATION_WORKSPACE_INTERACTION_CRASH_V1.md`.
