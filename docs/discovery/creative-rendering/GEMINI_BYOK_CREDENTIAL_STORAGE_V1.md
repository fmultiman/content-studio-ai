# GEMINI_BYOK_CREDENTIAL_STORAGE_V1

## Closure

- Starting `origin/main`: `f872a661b403ecba335b646e3dade3995ff0ca35`
- Branch: `feat/gemini-byok-credential-storage-v1`
- Worktree: `C:/Users/flavi/.traycer/worktrees/fmultiman__content-studio-ai/feat-image-generation-session-attempt-foundation-v1`
- Active Supabase project: `nuhdhnasuohizxtmyiju`
- Paid/external provider calls: **0**

This prerequisite adds only storage and settings support for an official Google Gemini API BYOK key. It does not add a Gemini client, model registry, Review execution, image/video generation, Veo, Video Review, Antigravity, or Flow.

## Existing credential authority

The application already stores user-owned API keys in `public.user_settings`, protected by the existing owner-scoped RLS policies. Server code resolves credentials through `lib/credentials/provider-credentials.ts`; `lib/credentials/provider-execution.ts` applies the existing `user_byok` fail-closed policy. `app/api/settings/providers/[provider]/route.ts` is the generic authenticated PUT/DELETE endpoint and returns only provider/status. `app/api/settings/providers/route.ts` returns presence status only. The Settings API card never fetches or pre-fills a saved secret.

## Gemini addition

Migration `scripts/059_add_gemini_api_key.sql` adds nullable `public.user_settings.gemini_api_key` with no default secret. The canonical provider ID is `gemini`, distinct from `nano_banana`, Antigravity, Flow, and Kling MCP.

The provider map now includes `gemini`, and status/resolution use the same generic functions as existing providers. Provider metadata identifies it as `Google Gemini API`, API-key authenticated over REST, with execution disabled until `GEMINI_REVIEW_PROVIDER_FOUNDATION_V1`. No platform fallback is introduced.

The Settings API tab uses the existing `AiProviderCredentialCard` for Google Gemini API. Save, replace, remove, and status behavior are identical to the established provider cards. The browser receives only `configured` or `missing`; the raw key is never returned in a response, URL, client state payload, analytics value, or log.

## Supabase verification

Migration applied to project `nuhdhnasuohizxtmyiju` using the established migration tool. Read-only verification confirmed:

| Check | Result |
| --- | ---: |
| `gemini_api_key` type | nullable `text` |
| default | `NULL` |
| existing rows with Gemini key | 0 |
| existing settings rows | 4 |
| existing OpenAI/Nano Banana/Kling/Replicate rows | 2 / 1 / 1 / 0 |
| existing provider secrets modified | 0 |

The column inherits the existing `user_settings` owner/RLS boundary. The generic route scopes writes by the authenticated user ID, and server resolution scopes reads by the requested user ID. Gemini and Nano Banana use distinct columns and cannot overwrite one another.

## Tests and validation

Focused credential, execution, and Settings API tests passed: **38 tests** across 3 files. They cover Gemini resolution, missing-key fail-closed behavior, user isolation, distinct Nano Banana/Gemini keys, generic save/remove, status-only responses, and existing-provider compatibility.

TypeScript typecheck and `git diff --check` passed. No live Gemini or other paid call was made. Full lint/build/suite checks remain subject to the repository's known Windows runner limitations and are reported separately at closure if encountered.

## Unblock condition

`GEMINI_REVIEW_PROVIDER_FOUNDATION_V1` is now unblocked: it may add the official server-side Gemini execution provider using `resolveProviderExecution(... provider: 'gemini')` and the existing `user_byok` path. That future mission must still keep OpenAI as the current Image Review default, use mocks in tests, and avoid Gemini generation, Video Review, Antigravity, and Flow.
