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

## What to look at, not just "page loads"

- The final URL after each navigation (a redirect back to a hub is a failure even if nothing errors).
- The workspace content (controls and hydrated values), not only the absence of an error toast.
- The browser console and the failing network request, if any.

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
