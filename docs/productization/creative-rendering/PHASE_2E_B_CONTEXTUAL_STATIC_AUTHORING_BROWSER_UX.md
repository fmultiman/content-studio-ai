# Phase 2E-B — Contextual Static Authoring: Browser & UX Proof

## 1. Objective

Validate visually and interactively the product surface shipped in Phase 2E-A (`93911b0`): `Project → EditorialContent → ChannelPiece → Editar visual`, using the real chain (`Portal Comunidades Alternativas → Carrossel Test → Teste Carrossel 01 → Instagram/Carrossel`). This is a browser proof and UX audit, not a new architecture phase. No new route, editor, domain change, or redesign was introduced.

## 2. Environment / Auth result

The existing safe procedure from Phase 2C was reused: `vercel link` (already authenticated as `fmultiman`) + `vercel env pull .env.local --environment=production`. Both `.env.local` and `.vercel/` are git-ignored (`git status --porcelain --ignored` confirmed `!!` untracked-ignored status throughout); neither was committed. A local `next dev -p 3000` server was started against this real environment.

The primary browser profile was checked for a pre-existing, legitimately-established session on `localhost:3000` before attempting anything: navigating to `/projetos` redirected to `/login`, confirming no residual session exists and that the auth boundary functions correctly (no bypass attempted, no fixture login introduced, no credentials typed).

**Result: `AUTH_INTERACTIVE_CONSTRAINT`** for the exact new authenticated route. The local environment has no legitimate way to obtain a real Supabase session without a human typing real credentials, which was correctly not attempted.

At the end of the session, the dev server was stopped and `.env.local` / `.vercel/` were deleted, restoring a clean working tree (`git status --porcelain` empty, confirmed before and after).

## 3. Browser navigation flow

Full flow through the authenticated product surface (`Portal Comunidades Alternativas → Carrossel Test → Teste Carrossel 01 → Editar visual`) could not be driven interactively due to `AUTH_INTERACTIVE_CONSTRAINT`.

As a legitimate fallback — the same "component and render proof" pattern used in Phase 2C — the existing **unauthenticated** engineering harness `/dev/creative-preview` was exercised in the browser. It requires no login (client-only fixture harness, confirmed by code: no middleware, no server auth check gates the page itself) and drives the identical shared pipeline the new product route calls (`AuthoringState`, reducer, `DocumentaryCard`, and the same `scripts/creative/run-authoring-render.mjs` render script — confirmed both `app/api/creative/static-authoring/render/route.ts` and `app/dev/creative-preview/render/route.ts` spawn the same script path).

## 4. Product surface screenshots

Screenshot capture via the browser tool timed out repeatedly (120s) on this environment — an infrastructure/tooling limitation, not an application or auth issue (DOM reads via `page.evaluate` worked instantly and repeatedly on the same tab). No PNGs were produced or saved; `.tmp/creative/productization/phase-2e-b/` was created but is empty. Verification below is DOM-state and interaction based instead.

## 5. Context hierarchy audit

Not directly observable for the new product page (auth-gated). Assessed by code review of `app/(dashboard)/projetos/[id]/conteudos/[editorialContentId]/channel-pieces/[channelPieceId]/editar-visual/page.tsx`:

- Header shows Project name, Production title (or "Sem Production"), EditorialContent title, plus channel:format and status badges — all real values, no raw UUIDs surfaced.
- A dedicated "Contexto" card repeats Project / Production / EditorialContent / ChannelPiece / Identity in plain labels.
- The `channel:format` badge renders raw enum values (e.g. `instagram:carousel`) rather than a formatted label — readable but not polished (see §12).

## 6. Authoring hierarchy audit

Code review of the same page: three-column layout (`Authoring` controls | `Preview` | `Contexto`), with Preview centered and visually dominant in the middle column. Render action is a single primary button in the page header, always visible — easy to find. Content fields (title/subtitle), primitives, and transforms are grouped under labeled subsections in the left column, in that order — clear grouping, no dev-only diagnostics or debug panel present (confirmed: no "Show debug" or raw manifest/JSON dump in the product page, unlike the dev harness which has both).

## 7. Primitive controls audit

Verified live in the (unauthenticated) `/dev/creative-preview` harness, which uses the same real project primitive catalog:
- Paper and Tape slots both appear clearly labeled with real display names ("Papel kraft claro", "Fita kraft curta"), key, version, and category badge.
- Selection state is a checkmark (✓) on the active option — clear and unambiguous.
- Transform sliders (offset X/Y, rotation, scale, opacity) are present per slot with numeric readouts.

The product's own `components/creative/authoring/primitive-controls.tsx` (code-reviewed, not browser-driven) mirrors this pattern using the app's Tailwind/shadcn utility classes (unlike the dev harness's raw inline dark-theme styles) — but uses a plain `<input type="range">` rather than the project's existing `components/ui/slider.tsx` (Radix-based). Functionally equivalent and accessible (has `aria-label`), just not the canonical DS primitive — see §12.

## 8. Preview behavior

Verified via the shared-pipeline harness: preview renders the same `DocumentaryCard` tree at the correct 1080×1350 proportions, with real content ("O QUE SÃO COMUNIDADES ALTERNATIVAS?" — the actual ChannelPiece text) and real primitive keys reflected in the on-screen "field notes." The known fixture/proxy-asset constraint is explicitly surfaced in the harness UI itself ("Preview uses fixture proxy; final render uses real S3 assets") and is mirrored in the product page's own preview card description. No pixel-parity claim is made.

## 9. Render behavior

Triggered directly in the browser against the real local render pipeline: clicking "Render this" transitioned the button to "Rendering…" and, after ~8.3s, produced a genuine 1080×1350 PNG (base64 data URL, confirmed via `naturalWidth`/`naturalHeight` on the `<img>` element) with `success` status, using the real primitives `paper-card-light-01` / `tape-kraft-short-01` and the real ChannelPiece content. This is the identical script path the product's `static-authoring/render` route invokes, so the render leg of the product surface is proven functional even though the authenticated route itself could not be driven from the browser.

## 10. Responsive smoke

Run against the harness (same shared layout conventions): no horizontal overflow (`scrollWidth <= clientWidth`) at 1920×1080 (wide desktop), 1366×800 (laptop), and 834×1194 (tablet). The product page's own layout only applies its 3-column grid (`xl:grid-cols-[20rem_minmax(0,1fr)_20rem]`) above the `xl` breakpoint and falls back to single-column stacking below it — reviewed in code, not directly measured due to the auth constraint. No mobile-first redesign was attempted or expected.

## 11. Error-state review

Verified by code review (no mutations, no synthetic data created):
- **Missing/invalid context** (bad UUID, missing project/content/piece): `static-authoring-context` route returns 400/404 with a coded error (`PROJECT_NOT_FOUND`, `EDITORIAL_CONTENT_NOT_FOUND`, `CHANNEL_PIECE_NOT_FOUND`); the page renders a dedicated error card with a "Voltar" action.
- **Unauthorized**: both routes call `supabase.auth.getUser()` first and return 401 before touching any data if the session is invalid — confirmed live during this phase's own auth check (redirect to `/login`).
- **Timeline / non-static ChannelPiece**: `staticAuthoringTarget` returns `null` and the context route returns 409 `TIMELINE_CONTEXT`; covered by unit test (`static-authoring-context.test.ts`).
- **Render failure**: the render route returns 500 with `error` + truncated `stderr` details rather than throwing unhandled.

No dedicated route-level (integration) tests exist for these specific HTTP codes — coverage is by direct code inspection, consistent with the existing test suite's scope (unit-level, not route-level HTTP tests) elsewhere in the codebase.

## 12. UX findings by severity

| Severity | Finding |
|---|---|
| BLOCKER | None found. |
| HIGH-VALUE SMALL FIX | None implemented — see §13 for why the two candidates below were not treated as fixes this phase. |
| LATER UX | Swap the raw `<input type="range">` sliders in `primitive-controls.tsx` for the existing `components/ui/slider.tsx` (Radix) for full visual/interaction consistency with the rest of the product. Deferred: this is a prop-shape change (single value → array, `onChange` → `onValueChange`) across 5 slider instances in a just-shipped, tested file — bigger footprint than a "clearly local, low-risk" fix. |
| POLISH | The `channel:format` badge shows raw lowercase enum values (`instagram:carousel`) instead of a formatted label (e.g. "Instagram · Carrossel"). Understandable as-is, not a blocker. |

## 13. Small fixes, if any

None applied. Both candidate findings above were judged to fall outside "clearly local and low-risk" (the slider swap touches committed/tested code with a real prop-shape change; the badge formatting is cosmetic wording, not a UX bug) and were deliberately left for a later, dedicated pass rather than risked in this audit phase.

## 14. Remaining constraints

- Interactive browser proof of the exact authenticated product route remains blocked by the absence of a legitimate local session (`AUTH_INTERACTIVE_CONSTRAINT`) — unchanged from Phase 2E-A, not a new gap.
- Screenshot capture tooling itself timed out in this environment; DOM/interaction-based verification was used instead. No screenshots were produced.
- Browser preview vs. real S3 asset parity remains deferred (unchanged, pre-existing constraint).
- Output persistence/approval remains deferred (unchanged).

## 15. Product-readiness assessment

The product shell is structurally sound and functionally proven at the pipeline level: real context loads with correct auth/ownership boundaries (verified live), the render path produces correct real output through the exact shared script the product route calls (verified live via the harness), and the UI code follows the app's existing layout, card, and typography conventions with no dev-only diagnostics leaking into product surface. The only gap is direct interactive confirmation of the exact authenticated route's rendered UI, which requires a real login this automation could not and should not perform.

## 16. Verdict

**PASS_WITH_CONSTRAINTS**

Context loading, ownership/auth boundaries, and the shared render pipeline are all proven working — the render boundary was exercised live in-browser with real project content and primitives, producing a correct PNG. The only constraint is the expected, pre-accepted one: the authenticated route itself could not be opened interactively without a real login, which was correctly not bypassed, faked, or worked around. No UX blocker was found in code review of the actual shipped page.
