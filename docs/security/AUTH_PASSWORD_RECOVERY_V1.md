# AUTH_PASSWORD_RECOVERY_V1

Self-service password recovery ("Esqueci minha senha?") and authenticated password change ("Configurações > Perfil > Alterar senha"). Uses **only** the end-user Supabase Auth surface.

- **Starting SHA:** `d24c2f27945faa7422dfd3a446d830143da88904` (`origin/main`, branch `feat/auth-password-recovery-v1`)
- **Why:** production had email/password login and sign-up but no way to recover or change a password; two real accounts needed a legitimate self-service path after an unrelated authorization incident (see `STATIC_TEMPLATE_CUSTOM_ELEMENTS_V1.md`).

## Current auth architecture (audited before editing)

| Concern | Reality |
|---|---|
| Library / flow | `@supabase/ssr` 0.10 + `@supabase/supabase-js` 2.10x, **PKCE** (SSR clients use PKCE; `resetPasswordForEmail` supports it) |
| Browser client | `lib/supabase/client.ts` (`createBrowserClient`); used by login, sign-up, settings |
| Server client | `lib/supabase/server.ts` (`createServerClient`, cookie store) |
| Session refresh / guards | `proxy.ts` -> `lib/supabase/middleware.ts` (`getUser()`); guards a fixed list of dashboard paths, bounces authenticated users away from `/login` and `/signup` |
| Callback | `app/auth/callback/route.ts`: `exchangeCodeForSession(code)` then redirect (used by sign-up confirmation) |
| Login | `signInWithPassword` -> `/dashboard` |
| Logout | `studio-shell.tsx` `signOut()` |
| App origin pattern | `NEXT_PUBLIC_APP_URL`, https-only, never from the request (`kling-mcp.ts`) |
| Localhost in Auth | none in product code; only a legacy admin script at the repo root (`cpm_m5_tests.mjs`, not part of the app) |

## What was added

| Route / file | Behaviour |
|---|---|
| `/login` | new "Esqueci minha senha?" link; success notice for `?password_reset=1` |
| `/auth/forgot-password` | email form -> `supabase.auth.resetPasswordForEmail(email, { redirectTo })`; neutral confirmation |
| `/auth/callback` | now validates `next` (see hardening); a failed/expired recovery link returns to forgot-password with a truthful message |
| `/auth/update-password` | shown only for a server-confirmed authenticated user; "Nova senha" / "Confirmar nova senha" -> `supabase.auth.updateUser({ password })` |
| Configurações > Perfil | "Alterar senha" section (same `updateUser`, signed-in user only) |
| `lib/auth/recovery.ts`, `lib/auth/callback.ts` | pure helpers (origin, redirect, safe `next`, error mapping, validation) |

## Recovery flow (exact)

1. `/login` -> "Esqueci minha senha?" -> `/auth/forgot-password`.
2. The **browser** client calls `resetPasswordForEmail(email, { redirectTo })` with the explicit canonical target
   `https://content.multihuman.com.br/auth/callback?next=%2Fauth%2Fupdate-password` (built from `NEXT_PUBLIC_APP_URL`, https-only, never from a Host header, never localhost). PKCE stores the code verifier in the browser that made the request.
3. The UI always shows: "Se houver uma conta com este email, enviaremos as instruções para redefinir a senha." A real rate limit (429 / `over_email_send_rate_limit`) is reported as such; any other failure is a generic "could not send" - neither reveals whether the address has an account.
4. The email link goes through Supabase and returns to `/auth/callback?code=...&next=...`; the server exchanges the code (`exchangeCodeForSession`) and redirects to `/auth/update-password`. The code is never logged or echoed.
5. `/auth/update-password` calls `getUser()` (server-validated). No user -> "Link inválido ou expirado" with a link to request a new one; **the form is not rendered**.
6. Submit: mismatch / < 6 characters (same client policy as sign-up) are rejected locally; otherwise `updateUser({ password })`. Server refusals (`same_password`, `weak_password`, re-authentication needed, expired session, rate limit) are mapped to Portuguese copy without Supabase internals.
7. On success: `signOut({ scope: 'global' })` ends **every** session of the account, the form is replaced by a success state (no resubmission) and the user is sent to `/login?password_reset=1` to sign in with the new password. Choice: a reset may follow a suspected compromise, so no lingering session survives it.

## Authenticated change (Configurações)

`updateUser({ password })` for the current user, with the same validation and error mapping; the fields clear on success and a status message is shown. No session is revoked by this action (see Session behaviour).

## Hardening included

`/auth/callback` used to redirect to `${origin}${next}` with an unvalidated `next`; `next=@evil.example` would have produced `https://<host>@evil.example`. `next` is now restricted to a same-origin path (`safeNextPath`), which the recovery redirect relies on.

## Session behaviour (factual)

- Supabase's session documentation only says sessions terminate on password change "depending on configuration"; **this project's behaviour was not assumed.** The recovery path is therefore deterministic (explicit global sign-out). Access tokens of revoked sessions stay valid until their expiry (documented Supabase caveat).
- The authenticated Settings change does **not** add a deliberate "sign out other devices" step. That policy is a separate follow-up.

## Not changed / boundaries

No admin Auth API, no service-role key, no direct password writes, no magic-link helpers, no Supabase dashboard change, no migration, no data mutation. Static authoring, Creative Editor, render worker and video code untouched.

## Tests

- `lib/auth/__tests__/recovery.test.ts` - redirect target (production, https-only, no localhost), `safeNextPath`, neutral outcome, rate-limit vs failure, validation, error copy.
- `lib/auth/__tests__/callback.test.ts` - callback decision + route wiring: valid code, open-redirect attempts, expired/invalid link, code never echoed.
- `lib/auth/__tests__/auth-boundary.test.ts` - source guard over every feature file: no service-role/admin Auth, no `password123`, no localhost, no console logging, no raw tokens.
- `components/auth/forgot-password-form.test.tsx`, `update-password-form.test.tsx`, `components/settings/change-password-form.test.tsx`, `components/auth/login-signup-regression.test.tsx` - forgot entry on login, recovery request + redirect, neutral/rate-limit/error states, no double submit, mismatch rejected, valid vs invalid/expired state, authenticated change, and login/sign-up regressions.

## Validation (PROVED)

| Check | Result |
|---|---|
| `pnpm vitest run` (full suite) | 148 files / **2276 tests passed**, 0 failed (53 new) |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 - 0 errors, 43 warnings (same count as `main`; none in files of this feature) |
| `pnpm build` (`next build`) | exit 0; `/auth/forgot-password`, `/auth/update-password`, `/auth/callback` present |
| Source security scan of the feature diff | no service-role / `auth.admin` / `updateUserById` / `generateLink` / `password123` / localhost / token logging in product code |

## Production deployment (PROVED)

- PR #46 merged as `5800b387f73f164772d63d4fe997a3c684156d4e` (`origin/main`); the GitHub/Vercel deployment for that SHA is `Production` / `success`.
- Live domain (anonymous GETs): `/login`, `/auth/forgot-password`, `/auth/update-password` respond 200; the deployed login chunk contains the link to `/auth/forgot-password`; the deployed forgot-password chunk embeds `https://content.multihuman.com.br` and no localhost; `/auth/callback?code=<invalid>&next=@evil.example` redirects to `https://content.multihuman.com.br/login?error=auth_failed`, and with `next=/auth/update-password` to `.../auth/forgot-password?error=invalid_link`.

## Real production recovery (operator-run; no password or token recorded)

Evidence below is read-only from `auth.users` / `auth.sessions` (no hashes, no tokens selected).

| Account | Operator report | Database evidence |
|---|---|---|
| `flavio.multiman@gmail.com` | recovery completed, new password set manually, login with the new password confirmed, Configurações > Perfil > Alterar senha present | **Consistent:** `recovery_sent_at` cleared (was set before, i.e. the recovery link was consumed); exactly one session, created at the same instant as `last_sign_in_at` (2026-09-29 19:34:15 UTC); all earlier sessions of the account are gone |
| `marceloshama@gmail.com` | recovery completed, new password set manually, login confirmed | **NOT evidenced:** the row is unchanged since 2026-09-29 06:38:43 UTC - `last_sign_in_at` still 05:40:36, `recovery_sent_at` still 06:05:54, zero sessions, and the stored recovery token from the earlier incident is still present (long expired). No other account was touched either. |

**Status:** Flavio's recovery is proven end to end by the evidence above (the new password itself is, by design, not verified by the agent). Marcelo's is **unproven**: either the recovery did not reach this production project, or it has not actually completed. It needs to be re-run/re-checked by the operator; until then that account should be assumed to still carry the incident-set password.

## Session behaviour (observed)

After Flavio's recovery (which ends every session with an explicit global sign-out) his previously existing sessions, including one not created by the recovery, no longer exist, and only the new sign-in remains. This confirms the recovery path ends sessions; it does **not** tell whether the Supabase project revokes other sessions on a password change by itself, and the Settings "Alterar senha" action still does not add a "sign out other devices" step (follow-up).

## Still open

- Marcelo's production recovery (above).
- Cross-browser recovery links (see limitation below) and a custom SMTP sender remain follow-ups.

## Known limitations

- **PKCE default email template:** the link must be opened in the **same browser** that requested it (the code verifier lives there). Opening it elsewhere fails and the user is returned to "Esqueci minha senha?" with an explanation. A cross-device-proof variant (custom email template with `token_hash` + `verifyOtp`) requires a Supabase dashboard change and is a follow-up.
- **Email rate limits:** Supabase's built-in mailer is heavily rate limited; the UI reports it truthfully. A custom SMTP provider is the durable fix (operator/dashboard concern).
- Local development cannot exercise the email round trip: the redirect origin is https-only and the project's redirect allow-list is production-only.
- Password policy is the existing client rule (>= 6) plus whatever Supabase enforces server-side.

## Impact

- **MIGRATION:** none.
- **WORKER IMPACT:** none - only Next.js UI/route code changed (no `remotion/`, `components/creative/`, `lib/render-execution/` or `infra/` files).
