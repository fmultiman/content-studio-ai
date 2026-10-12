import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// AI_PROVIDER_CREDENTIALS_EXECUTION_MODES_V1
// Static guards for the credential/execution boundary. These scan real source
// files so that a future edit cannot quietly reintroduce a silent platform
// fallback, expose a secret column to client code, or move the webhook secret.

const ROOT = process.cwd()
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'docs', 'public'])
const SOURCE_EXT = /\.(ts|tsx|mjs|js)$/

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    const info = statSync(full)
    if (info.isDirectory()) walk(full, out)
    else if (SOURCE_EXT.test(entry)) out.push(full)
  }
  return out
}

const rel = (file: string) => relative(ROOT, file).split('\\').join('/')

const isTestFile = (path: string) =>
  path.includes('/__tests__/') || /\.test\.(ts|tsx)$/.test(path)

const sourceFiles = walk(ROOT)
  .map((file) => ({ path: rel(file), text: readFileSync(file, 'utf8') }))
  .filter((file) => !isTestFile(file.path) && !file.path.endsWith('.d.ts'))

const filesContaining = (needle: string | RegExp) =>
  sourceFiles
    .filter((file) => (typeof needle === 'string' ? file.text.includes(needle) : needle.test(file.text)))
    .map((file) => file.path)
    .sort()

/** Source with comments removed, so guards reason about executable code only. */
const codeOnly = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const codeFilesContaining = (needle: string | RegExp) =>
  sourceFiles
    .filter((file) => (typeof needle === 'string' ? codeOnly(file.text).includes(needle) : needle.test(codeOnly(file.text))))
    .map((file) => file.path)
    .sort()

const isClientFile = (text: string) => /^\s*['"]use client['"]/m.test(text)

describe('platform credential boundary', () => {
  it('OPENAI_API_KEY is read only inside lib/credentials/platform-credentials.ts', () => {
    expect(filesContaining('OPENAI_API_KEY')).toEqual(['lib/credentials/platform-credentials.ts'])
  })

  it('KLING_API_KEY is read only inside lib/credentials/platform-credentials.ts', () => {
    expect(filesContaining(/\bKLING_API_KEY\b/)).toEqual(['lib/credentials/platform-credentials.ts'])
  })

  it('only provider-execution.ts imports the platform credential module', () => {
    expect(filesContaining('/platform-credentials')).toEqual(['lib/credentials/provider-execution.ts'])
  })

  it('no route or client code branches on NODE_ENV to pick a provider credential', () => {
    const offenders = sourceFiles
      .filter((file) => file.path.startsWith('app/') || file.path.startsWith('components/'))
      .filter((file) => /NODE_ENV[\s\S]{0,200}(API_KEY|api_key)/.test(file.text))
      .map((file) => file.path)
    expect(offenders).toEqual([])
  })
})

describe('KLING_WEBHOOK_SECRET isolation', () => {
  it('is referenced only by the Kling webhook verification route', () => {
    // Code references only: explanatory comments elsewhere may name it to document the separation.
    expect(codeFilesContaining('KLING_WEBHOOK_SECRET')).toEqual(['app/api/kling/callback/route.ts'])
  })

  it('is never part of provider credential resolution or Settings', () => {
    const credentialAndSettings = sourceFiles.filter(
      (file) =>
        file.path.startsWith('lib/credentials/') ||
        file.path.startsWith('app/api/settings/') ||
        file.path.startsWith('components/settings/') ||
        file.path === 'app/(dashboard)/configuracoes/page.tsx',
    )
    expect(credentialAndSettings.length).toBeGreaterThan(0)
    for (const file of credentialAndSettings) {
      expect(file.text).not.toMatch(/webhook_secret|WEBHOOK_SECRET/i)
    }
  })
})

describe('no provider secret reaches client code', () => {
  const SECRET_COLUMNS = /(openai_api_key|gemini_api_key|nanobanana_api_key|kling_api_key|replicate_api_key)/

  // FUTURE_059_BYOK_CREDENTIAL_HARDENING_SLICE_1: narrowed from "lib/credentials/ and app/api/" to the one store module.
  it('secret columns are referenced only by the server-only credential store and types', () => {
    const allowed = (path: string) => path === 'lib/credentials/api-credential-store.ts' || path === 'lib/types.ts'
    const offenders = sourceFiles
      .filter((file) => SECRET_COLUMNS.test(codeOnly(file.text)) && !allowed(file.path))
      .map((file) => file.path)
    expect(offenders).toEqual([])
  })

  it('client components never select user_settings with a wildcard', () => {
    const offenders = sourceFiles
      .filter((file) => isClientFile(file.text))
      .filter((file) => /from\(\s*['"]user_settings['"]\s*\)\s*\.select\(\s*['"]\*['"]/.test(file.text))
      .map((file) => file.path)
    expect(offenders).toEqual([])
  })

  it('no client file calls a provider API directly (no browser → api.openai.com / Kling / NanoBanana)', () => {
    const providerHosts = /api\.openai\.com|klingai\.com|nanobananaapi\.ai|kling\.ai\/(mcp|auth)/
    // A URL shown only as an <Input placeholder="..."> hint is not a call.
    const withoutPlaceholders = (text: string) => text.replace(/placeholder=("[^"]*"|\{[^}]*\})/gi, '')
    const offenders = sourceFiles
      .filter((file) => isClientFile(file.text) && providerHosts.test(withoutPlaceholders(file.text)))
      .map((file) => file.path)
    expect(offenders).toEqual([])
  })

  it('/imagens does not import or call the direct-provider prompt generator or read a raw key', () => {
    const page = readFileSync(join(ROOT, 'app/(dashboard)/imagens/page.tsx'), 'utf8')
    expect(page).not.toMatch(/generateImagePrompt\s*\(/)
    expect(page).not.toMatch(/import\s*\{[^}]*\bgenerateImagePrompt\b/)
    expect(page).toContain("/api/prompt-assistance")
    expect(page).not.toMatch(/openaiApiKey|nanobananaApiKey/)
  })

  it('files that call api.openai.com are server routes or the server-only prompt module', () => {
    const callers = filesContaining('api.openai.com')
    for (const path of callers) {
      // GEMINI_REVIEW_PROVIDER_FOUNDATION_V1: the OpenAI Review execution provider is a server-only module.
      // FUTURE_053_PROMPT_ASSISTANCE_IMAGE_V1: the Prompt Assistance OpenAI adapter is server-only and receives the
      // credential from the authenticated route (resolveProviderExecution).
      expect(path.startsWith('app/api/') || path === 'lib/ai-simulator.ts' || path === 'lib/reviews/providers/openai.ts' || path === 'lib/prompt-assistance/providers.ts').toBe(true)
    }
  })
})

describe('user_byok is the only execution mode wired into routes', () => {
  it('no route reads an execution mode or credential source from the request', () => {
    const routes = sourceFiles.filter((file) => file.path.startsWith('app/api/'))
    const offenders = routes
      .filter((file) => /mode:\s*(body|params|searchParams|payload)|executionMode\s*[:=]\s*(body|await request|await req)|body\??\.(executionMode|execution_mode|credentialSource)/.test(file.text))
      .map((file) => file.path)
    expect(offenders).toEqual([])
  })

  it('no route passes content_studio_credits to the resolver', () => {
    const offenders = sourceFiles
      .filter((file) => file.path.startsWith('app/') || file.path.startsWith('components/'))
      .filter((file) => file.text.includes('content_studio_credits'))
      .map((file) => file.path)
    expect(offenders).toEqual([])
  })

  it('every route that resolves a provider credential goes through resolveProviderExecution', () => {
    const routes = sourceFiles.filter(
      (file) => file.path.startsWith('app/api/') && !file.path.startsWith('app/api/settings/'),
    )
    const direct = routes.filter((file) => file.text.includes('resolveProviderCredential')).map((file) => file.path)
    expect(direct).toEqual([])
    const viaExecution = routes
      .filter((file) => file.text.includes('resolveProviderExecution'))
      .map((file) => file.path)
      .sort()
    expect(viaExecution).toEqual(
      [
        'app/api/channel-pieces/generate-body/route.ts',
        'app/api/evaluate-image/route.ts',
        // FUTURE_064 Slice A: official Gemini image generation (user_byok Gemini key, disabled by default).
        'app/api/gemini/generate-image/route.ts',
        // NANOBANANA_CALLBACK_AUTHENTICATION_V1: reads the task OWNER's own credential to query the provider.
        'app/api/nanobanana/callback/route.ts',
        'app/api/nanobanana/generate/route.ts',
        'app/api/openai/generate-image/route.ts',
        'app/api/posts/generate-feed-text/route.ts',
        // FUTURE_053_PROMPT_ASSISTANCE_IMAGE_V1: explicit text-model assistance for /imagens.
        'app/api/prompt-assistance/route.ts',
        'app/api/prompts/generate-image-prompt/route.ts',
        'app/api/prompts/translate/route.ts',
        'app/api/video-generations/[id]/sync/route.ts',
        'app/api/video-generations/route.ts',
        'app/api/videos/generate-scene-prompt/route.ts',
      ].sort(),
    )
  })
})

describe('provider connection (OAuth) boundary — KLING_MCP_OAUTH_CONNECTION_SPIKE_V1', () => {
  it('the connection-secret encryption key is read only inside crypto.ts', () => {
    expect(codeFilesContaining('PROVIDER_CONNECTION_ENCRYPTION_KEY')).toEqual(['lib/provider-connections/crypto.ts'])
  })

  it('each server-only table is touched by exactly one module', () => {
    expect(codeFilesContaining('provider_connection_secrets')).toEqual(['lib/provider-connections/token-store.ts'])
    expect(codeFilesContaining('provider_oauth_authorizations')).toEqual(['lib/provider-connections/oauth-state.ts'])
    expect(codeFilesContaining('provider_oauth_clients')).toEqual(['lib/provider-connections/oauth-client-registry.ts'])
  })

  it('the MCP SDK and transport are used only inside lib/provider-connections/', () => {
    for (const path of filesContaining('@modelcontextprotocol/client')) {
      expect(path.startsWith('lib/provider-connections/')).toBe(true)
    }
    expect(filesContaining('StreamableHTTPClientTransport')).toEqual(['lib/provider-connections/kling-mcp-client.ts'])
  })

  it('a tool is invoked from exactly three places: the read-only gate, the video-tool gate and the single-purpose source-upload gate', () => {
    expect(codeFilesContaining(/\.callTool\(/)).toEqual([
      'lib/provider-connections/kling-mcp-client.ts',
      'lib/provider-connections/kling-mcp-generation.ts',
      'lib/provider-connections/kling-mcp-upload.ts',
    ])
  })

  it('VIDEO_MCP_I2V_SOURCE_TRANSPORT_V1: file_upload is internal plumbing — not a read-only tool, not a generation tool, never user-selectable', () => {
    const mcp = codeOnly(sourceFiles.find((f) => f.path === 'lib/provider-connections/kling-mcp.ts')!.text)
    expect(mcp).toMatch(/KLING_MCP_SOURCE_UPLOAD_TOOL = 'file_upload'/)
    const videoTools = /KLING_MCP_VIDEO_TOOLS = \[([^\]]*)\]/.exec(mcp)![1]
    const readOnlyTools = /KLING_MCP_READ_ONLY_TOOLS = \[([^\]]*)\]/.exec(mcp)![1]
    expect(videoTools).not.toContain('file_upload')
    expect(readOnlyTools).not.toContain('file_upload')
    // the raw tool name is written only by the allow-list module and read by the single upload adapter through that constant
    expect(codeFilesContaining(/['"]file_upload['"]/)).toEqual(['lib/provider-connections/kling-mcp.ts'])
    // the UI and the client never learn of it: no capability flag, no toggle
    expect(codeFilesContaining(/KLING_MCP_SOURCE_UPLOAD_TOOL/).filter((path) => path.startsWith('components/') || path.startsWith('app/(dashboard)'))).toEqual([])
  })

  it('generation tools are named only by the allow-lists and the single video client', () => {
    const generationTools = /['"](text_to_video|image_to_video)['"]/
    // The product operation names also appear in the video-generation domain
    // (they ARE the Content Studio operation vocabulary); a raw provider tool
    // call is only ever built inside kling-mcp-generation.ts.
    expect(codeFilesContaining(/callTool\(\{\s*name:\s*['"](text_to_video|image_to_video)['"]/)).toEqual([])
    expect(generationTools.test(codeOnly(sourceFiles.find((f) => f.path === 'lib/provider-connections/kling-mcp-client.ts')!.text))).toBe(false)
  })

  it('the service-role client is created only by the factory, provider-connections routes and the server-side video routes', () => {
    const allowed = (path: string) =>
      path === 'lib/supabase/service-role.ts' ||
      path.startsWith('app/api/provider-connections/') ||
      path.startsWith('app/api/internal/video-generations/') ||
      path === 'app/api/video-generations/route.ts' ||
      path === 'app/api/video-generations/[id]/sync/route.ts' ||
      // VIDEO_GENERATION_SESSION_PERSISTENCE_AND_API_V1: Session writes are server-owned (the user session only has
      // SELECT, scripts/049); the route proves ownership and validates the document, then writes as the verified user.
      path === 'app/api/video-generation-sessions/[id]/route.ts' ||
      // IMAGE_GENERATION_SESSION_AND_ATTEMPT_FOUNDATION_V1: Image session and attempt writes are server-owned;
      // the authenticated route scopes every service-role operation to the verified user/session lineage.
      path.startsWith('app/api/image-generation-sessions/') ||
      path.startsWith('app/api/image-generation-attempts/') ||
      // IMAGE_GENERATION_ROUTE_CONVERGENCE_V1: provider adapters delegate
      // Attempt/output lifecycle writes to this server-only execution helper.
      path === 'lib/image-generation/execution.ts' ||
      // SHARED_REVIEW_CORE_AND_IMAGE_ADAPTER_V1: the server-only Review service writes immutable Review rows after
      // the authenticated route has verified the user; every operation is scoped to that user id.
      path === 'lib/reviews/service.ts' ||
      // FUTURE_053_PROMPT_ASSISTANCE_IMAGE_V1: the server-only usage recorder writes factual provider_usage_events rows
      // (no user INSERT policy) for the verified user id handed over by the authenticated Prompt Assistance route.
      path === 'lib/prompt-assistance/usage.ts' ||
      // FUTURE_064_SLICE_C: the server-only Gemini image usage recorder writes factual provider_usage_events rows (no user INSERT
      // policy) and the Attempt's accounting mark for the verified user id handed over by the authenticated image route.
      path === 'lib/usage/gemini-image-usage.ts' ||
      // GEMINI_VIDEO_REVIEW_ADAPTER_V1: the server-only Video Review service is the Video counterpart of the Image
      // Review service. It writes media artifacts and immutable Review rows (RLS gives users SELECT only) after the
      // authenticated route has verified the user; every query is filtered by that user id and the browser sends
      // only a typed source id (never a URL, key, credential or media fact).
      path === 'lib/reviews/video-service.ts' ||
      // VIDEO_GENERATION_LIBRARY_PROMOTION_V1: writes only the server-owned promotion pointer (library_file_id).
      path === 'app/api/video-generations/[id]/save-to-library/route.ts' ||
      // NANOBANANA_CALLBACK_AUTHENTICATION_V1: the unauthenticated provider callback has no session, so it reads
      // the OWNER's own credential and updates only that owner's still-`processing` task, from the provider's
      // authenticated answer (never from the request body).
      path === 'app/api/nanobanana/callback/route.ts' ||
      // PRODUCTION_SERVICE_ROLE_KEY_REPLACEMENT_V1: the render-execution surface (server-owned inserts/reads, RLS gives
      // users no INSERT) and the Kling REST webhook used to build their own inline clients from the raw env var. They
      // now share this factory, so the admin credential is resolved (and the local-runtime guard applied) in one place.
      path === 'lib/render-execution/worker-db-client.ts' ||
      path.startsWith('app/api/render-executions/') ||
      path === 'app/api/video-drafts/[id]/render/route.ts' ||
      path === 'app/api/creative/static-authoring/render/route.ts' ||
      path === 'app/api/gallery/video-outputs/route.ts' ||
      path === 'app/api/channel-piece-media/upload/route.ts' ||
      path === 'app/api/kling/callback/route.ts' ||
      // FUTURE_059_BYOK_CREDENTIAL_HARDENING_SLICE_1: the server-only BYOK credential store reads/writes the provider
      // key columns with the privileged client AFTER an ownership proof through the caller's own client.
      path === 'lib/credentials/api-credential-store.ts'
    for (const path of filesContaining('createServiceRoleSupabase')) expect(allowed(path)).toBe(true)
  })

  it('client components import nothing from provider-connections except TYPES', () => {
    const offenders: string[] = []
    for (const file of sourceFiles.filter((f) => isClientFile(f.text))) {
      const imports = file.text.match(/import[^;\n]*from\s+['"]@\/lib\/provider-connections\/[^'"]+['"]/g) ?? []
      for (const statement of imports) {
        if (!/^import\s+type\s/.test(statement) || !statement.includes('/types')) offenders.push(`${file.path}: ${statement}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('client code never mentions token material', () => {
    const offenders = sourceFiles
      .filter((file) => isClientFile(file.text))
      .filter((file) => /access_token|refresh_token|code_verifier|ciphertext|client_secret/.test(file.text))
      .map((file) => file.path)
    expect(offenders).toEqual([])
  })

  it('the generation scope literal is defined in exactly one place and never appears in client code', () => {
    expect(codeFilesContaining(/['"]generation\.create['"]/)).toEqual(['lib/provider-connections/kling-mcp.ts'])
  })

  it('the REST adapter and the REST webhook stay independent of provider connections (REST unchanged)', () => {
    const restFiles = sourceFiles.filter(
      (file) => file.path.startsWith('app/api/kling/') || file.path.startsWith('lib/providers/kling/'),
    )
    expect(restFiles.length).toBeGreaterThan(0)
    for (const file of restFiles) expect(file.text).not.toContain('provider-connections')
  })

  it('no API route response includes token fields', () => {
    const routes = sourceFiles.filter((file) => file.path.startsWith('app/api/provider-connections/'))
    expect(routes.length).toBeGreaterThan(0)
    for (const route of routes) expect(route.text).not.toMatch(/NextResponse\.json\([^)]*(access_token|refresh_token|ciphertext)/)
  })
})

describe('video generation connection routing boundary — VIDEO_GENERATION_CONNECTION_CAPABILITY_ROUTING_V1', () => {
  const videoServerFiles = sourceFiles.filter(
    (file) =>
      file.path.startsWith('lib/video-generation/') ||
      file.path.startsWith('app/api/video-generations/') ||
      file.path.startsWith('app/api/internal/video-generations/') ||
      file.path.startsWith('lib/provider-connections/kling-mcp-generation') ||
      file.path.startsWith('lib/provider-connections/kling-mcp-task'),
  )

  it('Content Studio Credits cannot be reached from the video routing code (no fallback, no platform credential)', () => {
    expect(videoServerFiles.length).toBeGreaterThan(5)
    for (const file of videoServerFiles) {
      const code = codeOnly(file.text)
      expect(code).not.toContain('content_studio_credits')
      expect(code).not.toContain('resolvePlatformCredential')
      expect(code).not.toContain('platform-credentials')
      expect(code).not.toContain('KLING_API_KEY')
    }
  })

  it('the client only imports the pure, client-safe video-generation modules (never connections/polling/transport/completion)', () => {
    const allowed = new Set([
      'capabilities',
      'connection-ref',
      'form-selection',
      'status-refresh',
      'connection-presentation',
      'i2v-source',
      'i2v-source-browse',
      'working-state',
      'session',
    ])
    const offenders: string[] = []
    for (const file of sourceFiles.filter((f) => isClientFile(f.text))) {
      for (const match of file.text.matchAll(/from\s+['"]@\/lib\/video-generation\/([^'"]+)['"]/g)) {
        if (!allowed.has(match[1])) offenders.push(`${file.path}: ${match[1]}`)
      }
    }
    expect(offenders).toEqual([])
    for (const name of allowed) {
      const source = sourceFiles.find((f) => f.path === `lib/video-generation/${name}.ts`)!
      expect(source.text).not.toMatch(/from\s+['"]@\/lib\/(supabase|provider-connections|credentials|storage)/)
    }
  })

  it('the OAuth flow can only be started by the connect route (a user action), never as a side effect elsewhere', () => {
    expect(codeFilesContaining('startKlingMcpAuthorization(')).toEqual([
      'app/api/provider-connections/kling/mcp/connect/route.ts',
      'lib/provider-connections/kling-mcp-oauth.ts',
    ])
  })

  it('the poller has exactly one entry point: the authenticated internal route', () => {
    expect(codeFilesContaining('pollDueMcpGenerations(')).toEqual([
      'app/api/internal/video-generations/poll/route.ts',
      'lib/video-generation/polling.ts',
    ])
    const route = sourceFiles.find((f) => f.path === 'app/api/internal/video-generations/poll/route.ts')!
    expect(route.text).toContain('VIDEO_POLL_WORKER_SECRET')
    expect(route.text).not.toMatch(/export (async function|const) (GET|PUT|PATCH|DELETE)/)
    expect(route.text).toContain('timingSafeEqual')
  })

  it('every writer of a terminal generation state goes through the shared completion module', () => {
    const writers = sourceFiles
      .filter((file) => codeOnly(file.text).includes('video_generations') && /status:\s*['"]succeeded['"]/.test(codeOnly(file.text)))
      .map((file) => file.path)
    expect(writers).toEqual(['lib/video-generation/completion.ts'])
  })

  it('the REST webhook secret guards only the REST callback (completion is shared, security is not)', () => {
    expect(codeFilesContaining('KLING_WEBHOOK_SECRET')).toEqual(['app/api/kling/callback/route.ts'])
    const callback = sourceFiles.find((f) => f.path === 'app/api/kling/callback/route.ts')!.text
    expect(callback.indexOf('timingSafeEqual')).toBeGreaterThan(-1)
    expect(callback.indexOf('timingSafeEqual')).toBeLessThan(callback.indexOf('completeVideoGeneration('))
  })

  it('the video tools are named in exactly one allow-list and invoked from one gate', () => {
    expect(codeFilesContaining('KLING_MCP_VIDEO_TOOLS')).toEqual(['lib/provider-connections/kling-mcp.ts'])
    expect(codeFilesContaining('isKlingMcpVideoTool(')).toEqual([
      'lib/provider-connections/kling-mcp-generation.ts',
      'lib/provider-connections/kling-mcp.ts',
    ])
  })

  it('output count is pinned to 1 in the only place that builds tool arguments', () => {
    const source = sourceFiles.find((f) => f.path === 'lib/provider-connections/kling-mcp-generation.ts')!.text
    expect(source).toMatch(/name:\s*'imageCount',\s*value:\s*'1'/)
    expect(source).not.toMatch(/imageCount.*(request|selection|body)/)
  })
})


describe('Gemini Review provider boundary — GEMINI_REVIEW_PROVIDER_FOUNDATION_V1', () => {
  it('only the server-side Gemini client talks to the Gemini API host', () => {
    expect(filesContaining('generativelanguage.googleapis.com')).toEqual(['lib/providers/gemini/client.ts'])
  })

  it('no client component or hook imports the Gemini provider or reads gemini_api_key', () => {
    const clientFiles = sourceFiles.filter((file) => /^['"]use client['"]/m.test(file.text.slice(0, 200)))
    for (const file of clientFiles) {
      expect(file.text).not.toMatch(/providers\/gemini|reviews\/media|gemini_api_key/)
    }
  })

  it('Gemini credentials resolve only through the shared user_byok boundary and never from the platform env', () => {
    const geminiSources = sourceFiles.filter((file) => file.path.startsWith('lib/providers/gemini/') || file.path === 'lib/reviews/provider-registry.ts')
    for (const file of geminiSources) {
      expect(file.text).not.toMatch(/process\.env\.GEMINI_API_KEY|GOOGLE_API_KEY/)
      expect(file.text).not.toMatch(/from\s+['"]@\/lib\/supabase/)
    }
  })

  it('the browser-facing Review route never accepts a provider, model or media URL from the request body', () => {
    const route = readFileSync(join(ROOT, 'app/api/reviews/image/route.ts'), 'utf8')
    const contracts = readFileSync(join(ROOT, 'lib/reviews/contracts.ts'), 'utf8')
    expect(route).not.toMatch(/providerId|provider:|\.model\b/)
    expect(contracts).toMatch(/ReviewRequestSchema = z\.object\(\{\s*attemptId: z\.string\(\)\.uuid\(\),\s*clientRequestId: z\.string\(\)\.uuid\(\),\s*\}\)\.strict\(\)/)
  })
})

describe('BYOK credential store boundary — FUTURE_059_BYOK_CREDENTIAL_HARDENING_SLICE_1', () => {
  const STORE = 'lib/credentials/api-credential-store.ts'
  const store = sourceFiles.find((file) => file.path === STORE)

  it('the store exists and is the only module that creates a client for the secret columns', () => {
    expect(store).toBeDefined()
    expect(codeFilesContaining(/createServiceRoleSupabase\(\)/).filter((p) => p === STORE)).toEqual([STORE])
  })

  it('the secret-bearing store functions are imported only by the resolver and the Settings write route', () => {
    const secretFunctions = /\b(readStoredApiCredential|readStoredApiCredentialStatuses|writeStoredApiCredential|removeStoredApiCredential)\b/
    const users = sourceFiles
      .filter((file) => file.path !== STORE && secretFunctions.test(codeOnly(file.text)))
      .map((file) => file.path)
      .sort()
    expect(users).toEqual(['app/api/settings/providers/[provider]/route.ts', 'lib/credentials/provider-credentials.ts'])
  })

  it('no server or client source selects user_settings with a wildcard', () => {
    const offenders = sourceFiles
      .filter((file) => /from\(\s*['"]user_settings['"]\s*\)\s*\.select\(\s*(['"]\*['"])?\s*\)/.test(codeOnly(file.text)))
      .map((file) => file.path)
    expect(offenders).toEqual([])
  })

  it('Kling MCP stays on its own encrypted path: the store knows nothing about provider connections', () => {
    expect(codeOnly(store!.text)).not.toMatch(/provider_connection|provider-connections|oauth|access_token|refresh_token/i)
    expect(codeFilesContaining('api-credential-store').filter((p) => p.startsWith('lib/provider-connections/'))).toEqual([])
  })

  it('every select inside the store is an explicit column list', () => {
    const selects = [...codeOnly(store!.text).matchAll(/\.select\(([^)]*)\)/g)].map((match) => match[1].trim())
    expect(selects.length).toBeGreaterThan(0)
    for (const argument of selects) {
      expect(argument).not.toMatch(/^['"]\*['"]$/)
      expect(argument).not.toBe('')
      expect(argument).toMatch(/^(column|columns|'user_id')$/)
    }
  })

  it('the store never writes a secret, row or database message to a log or into an error', () => {
    const lines = codeOnly(store!.text).split('\n')
    for (const line of lines.filter((l) => /console\./.test(l))) {
      expect(line).toMatch(/\[credential-store\]/)
      expect(line).not.toMatch(/secret|\bdata\b|\brow\b|value|\.message|ciphertext/i)
    }
    expect(codeOnly(store!.text)).not.toMatch(/super\([^)]*(secret|\$\{)/)
  })

  it('the store and the resolver are unreachable from any client component (transitive import graph)', () => {
    const byPath = new Map(sourceFiles.map((file) => [file.path, file]))
    const resolveImport = (from: string, spec: string): string | null => {
      const base = spec.startsWith('@/')
        ? spec.slice(2)
        : spec.startsWith('.')
          ? join(from, '..', spec).replaceAll(String.fromCharCode(92), '/')
          : null
      if (!base) return null
      for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`, base]) {
        if (byPath.has(candidate)) return candidate
      }
      return null
    }
    const FORBIDDEN = new Set([
      STORE,
      'lib/credentials/provider-credentials.ts',
      'lib/credentials/provider-execution.ts',
      'lib/credentials/provider-credential-http.ts',
      'lib/supabase/service-role.ts',
      // FUTURE_059 Slice 3A
      'lib/credentials/byok-crypto.ts',
      'lib/credentials/credential-storage-mode.ts',
      'lib/credentials/credential-errors.ts',
      'lib/credentials/encrypted-credential-table.ts',
      'lib/security/aes-gcm-envelope.ts',
      'lib/provider-connections/crypto.ts',
      // FUTURE_059 Slice 3B
      'lib/credentials/credential-backfill.ts',
      'lib/credentials/credential-backfill-sweep.ts',
    ])
    const offenders: string[] = []
    for (const client of sourceFiles.filter((file) => isClientFile(file.text))) {
      const seen = new Set<string>([client.path])
      const queue = [client.path]
      while (queue.length) {
        const current = byPath.get(queue.pop()!)
        if (!current) continue
        for (const match of current.text.matchAll(/(?:import|export)[^'"`;]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
          const target = resolveImport(current.path, match[1] ?? match[2])
          if (!target || seen.has(target)) continue
          seen.add(target)
          if (FORBIDDEN.has(target)) offenders.push(`${client.path} -> ${target}`)
          queue.push(target)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('Encrypted BYOK storage boundary — FUTURE_059_BYOK_CREDENTIAL_HARDENING_SLICE_3A', () => {
  const STORE = 'lib/credentials/api-credential-store.ts'
  const TABLE = 'lib/credentials/encrypted-credential-table.ts'
  const BYOK = 'lib/credentials/byok-crypto.ts'
  const MODE = 'lib/credentials/credential-storage-mode.ts'
  const ENVELOPE = 'lib/security/aes-gcm-envelope.ts'
  const text = (path: string) => codeOnly(sourceFiles.find((file) => file.path === path)!.text)

  it('the BYOK master-key variables are read in exactly one module, and are a different identity from the Kling key', () => {
    expect(codeFilesContaining('BYOK_CREDENTIAL_ENCRYPTION_KEY')).toEqual([BYOK])
    expect(codeFilesContaining('PROVIDER_CONNECTION_ENCRYPTION_KEY')).toEqual(['lib/provider-connections/crypto.ts'])
    expect(text(BYOK)).not.toContain('PROVIDER_CONNECTION_ENCRYPTION_KEY')
  })

  it('the mode variable is read in exactly one module and is not set by any source or deployment file', () => {
    expect(codeFilesContaining('PROVIDER_API_CREDENTIAL_MODE')).toEqual([MODE])
    expect(codeFilesContaining('CREDENTIAL_STORAGE_MODE_ENV').filter((p) => p !== MODE)).toEqual([])
    expect(text(MODE)).toContain("DEFAULT_CREDENTIAL_STORAGE_MODE: CredentialStorageMode = 'legacy'")
    const deploymentFiles = ['vercel.json', 'vercel.ts', 'next.config.mjs', '.env.example', '.env.production', '.env']
    for (const file of deploymentFiles) {
      let content = ''
      try { content = readFileSync(join(ROOT, file), 'utf8') } catch { /* absent */ }
      expect(content, file).not.toMatch(/PROVIDER_API_CREDENTIAL_MODE|BYOK_CREDENTIAL_ENCRYPTION_KEY/)
    }
  })

  it('the encrypted table and its ciphertext column are named in exactly one module, imported only by the store', () => {
    expect(codeFilesContaining('provider_api_credentials')).toEqual([TABLE])
    // Slice 3B: the dormant backfill core and the operator sweep also use it (select/rpc helpers), nothing else does
    expect(sourceFiles.filter((file) => file.path !== TABLE && /encrypted-credential-table/.test(codeOnly(file.text))).map((file) => file.path).sort()).toEqual([STORE, 'lib/credentials/credential-backfill-sweep.ts', 'lib/credentials/credential-backfill.ts'].sort())
  })

  it('decryption and the BYOK crypto module are reachable only from the store (and the mode diagnostic, which never decrypts)', () => {
    const importers = sourceFiles.filter((file) => file.path !== BYOK && /byok-crypto/.test(codeOnly(file.text))).map((file) => file.path).sort()
    expect(importers).toEqual([MODE, STORE, 'lib/credentials/credential-backfill-sweep.ts', 'lib/credentials/credential-backfill.ts'].sort())
    const decrypters = sourceFiles.filter((file) => file.path !== BYOK && /\bdecryptCredential\b/.test(codeOnly(file.text))).map((file) => file.path)
    expect(decrypters).toEqual([STORE, 'lib/credentials/credential-backfill-sweep.ts'].sort())
    expect(sourceFiles.filter((file) => file.path !== ENVELOPE && /aes-gcm-envelope/.test(codeOnly(file.text))).map((file) => file.path).sort()).toEqual([BYOK, 'lib/provider-connections/crypto.ts'].sort())
  })

  it('every select in the table module is an explicit column list (never a wildcard)', () => {
    const selects = [...text(TABLE).matchAll(/\.select\(([^)]*)\)/g)].map((match) => match[1].trim())
    expect(selects.length).toBeGreaterThan(0)
    for (const argument of selects) expect(argument).toMatch(/^(COLUMNS|OWNED_COLUMNS)$/)
    expect(text(TABLE)).not.toMatch(/select\(\s*['"]\*/)
  })

  it('no module in the encrypted path logs a secret, a token or a database message', () => {
    for (const path of [TABLE, BYOK, MODE, ENVELOPE, 'lib/credentials/credential-errors.ts']) {
      expect(text(path), path).not.toMatch(/console\./)
    }
    const lines = text(STORE).split('\n').filter((line) => /console\./.test(line))
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      expect(line).toMatch(/\[credential-store\]/)
      expect(line).not.toMatch(/secret|\bdata\b|\brow\b|value|\.message|ciphertext|token/i)
    }
  })

  it('the Settings routes expose no ciphertext, token or key field', () => {
    for (const path of ['app/api/settings/providers/route.ts', 'app/api/settings/providers/[provider]/route.ts']) {
      expect(text(path), path).not.toMatch(/ciphertext|key_id|secret_version|decrypt|encrypt/i)
    }
  })

  it('the migration SQL is a reviewed artifact under docs/, never under scripts/ or a deploy hook', () => {
    expect(() => readFileSync(join(ROOT, 'docs/productization/sql/FUTURE_059_SLICE_3_provider_api_credentials.up.sql'), 'utf8')).not.toThrow()
    const scripts = readdirSync(join(ROOT, 'scripts')).filter((name) => /provider_api_credentials|slice_3/i.test(name))
    expect(scripts).toEqual([])
    const pkg = readFileSync(join(ROOT, 'package.json'), 'utf8')
    expect(pkg).not.toMatch(/provider_api_credentials/)
  })
})

describe('Lazy backfill and operator sweep boundary — FUTURE_059_BYOK_CREDENTIAL_HARDENING_SLICE_3B', () => {
  const STORE = 'lib/credentials/api-credential-store.ts'
  const TABLE = 'lib/credentials/encrypted-credential-table.ts'
  const BACKFILL = 'lib/credentials/credential-backfill.ts'
  const SWEEP = 'lib/credentials/credential-backfill-sweep.ts'
  const ROUTE = 'app/api/internal/credential-backfill/route.ts'
  const file = (path: string) => sourceFiles.find((f) => f.path === path)!
  const code = (path: string) => codeOnly(file(path).text)

  it('lazy migration is reachable from exactly one place: the dual-mode fallback in the store', () => {
    expect(sourceFiles.filter((f) => f.path !== BACKFILL && /lazyBackfillLegacyCredential/.test(codeOnly(f.text))).map((f) => f.path)).toEqual([STORE])
    // it is called only after the legacy read of the dual-mode fallback, never from the legacy or encrypted branches
    const store = code(STORE)
    const index = store.indexOf('await lazyBackfillLegacyCredential(')
    expect(index).toBeGreaterThan(store.indexOf("logFallback(provider)"))
    expect(store.slice(store.indexOf("logFallback(provider)") - 200, index)).toMatch(/dual/)
  })

  it('the database function name is known to exactly one module', () => {
    expect(codeFilesContaining('backfill_provider_api_credential')).toEqual([TABLE])
  })

  it('the sweep and the operator client are used only by the internal operator route', () => {
    expect(sourceFiles.filter((f) => f.path !== SWEEP && /credential-backfill-sweep/.test(codeOnly(f.text))).map((f) => f.path)).toEqual([ROUTE])
    expect(sourceFiles.filter((f) => f.path !== STORE && f.path !== SWEEP && /\b(createOperatorPrivilegedClient|readLegacyCredentialPage)\b/.test(codeOnly(f.text))).map((f) => f.path).sort()).toEqual([ROUTE].sort())
    expect(sourceFiles.filter((f) => f.path !== SWEEP && /\brunCredentialSweep\b/.test(codeOnly(f.text))).map((f) => f.path)).toEqual([ROUTE])
  })

  it('the operator route is POST-only, secret-guarded, fail-closed, and never takes an owner from the request', () => {
    const route = code(ROUTE)
    expect(route).toMatch(/export async function POST/)
    expect(route).not.toMatch(/export (async )?function (GET|PUT|PATCH|DELETE|HEAD)/)
    expect(route).toContain('CREDENTIAL_BACKFILL_OPERATOR_SECRET')
    expect(route).toContain('timingSafeEqual')
    expect(route).toContain('MIN_SECRET_LENGTH')
    expect(route).toContain('fail(503,')
    expect(route).toMatch(/status: 401/)
    expect(route).toContain('classifyExecutionEnvironment')
    expect(route).not.toContain('createServiceRoleSupabase')
    expect(route).not.toMatch(/searchParams|nextUrl/)
    expect(route).not.toMatch(/\.(userId|user_id|ownerId|provider)\b/) // no owner/provider is read from the request
    expect(route).toContain("ALLOWED_FIELDS = new Set(['dryRun', 'batchSize', 'maxBatches', 'cursor', 'confirm'])")
    expect(route).toContain('migrate-legacy-credentials')
    expect(file(ROUTE).text).toMatch(/export const dynamic = 'force-dynamic'/)
  })

  it('the operator secret is read only by the route and is set in no source or deployment file', () => {
    expect(codeFilesContaining('CREDENTIAL_BACKFILL_OPERATOR_SECRET')).toEqual([ROUTE])
    for (const name of ['vercel.json', 'vercel.ts', 'next.config.mjs', '.env.example', '.env.production', '.env']) {
      let content = ''
      try { content = readFileSync(join(ROOT, name), 'utf8') } catch { /* absent */ }
      expect(content, name).not.toMatch(/CREDENTIAL_BACKFILL_OPERATOR_SECRET|credential-backfill/)
    }
  })

  it('nothing schedules or auto-starts the sweep: no cron, no package script, no startup hook, no deployment step', () => {
    const pkg = readFileSync(join(ROOT, 'package.json'), 'utf8')
    expect(pkg).not.toMatch(/credential-backfill|backfill_provider|runCredentialSweep/)
    for (const name of ['vercel.json', 'vercel.ts']) {
      let content = ''
      try { content = readFileSync(join(ROOT, name), 'utf8') } catch { /* absent */ }
      expect(content, name).not.toMatch(/crons?/)
    }
    for (const startup of ['instrumentation.ts', 'instrumentation.js', 'proxy.ts']) {
      let content = ''
      try { content = readFileSync(join(ROOT, startup), 'utf8') } catch { /* absent */ }
      expect(content, startup).not.toMatch(/backfill|runCredentialSweep/i)
    }
    expect(sourceFiles.filter((f) => f.path.startsWith('app/') && f.path !== ROUTE && /credential-backfill|runCredentialSweep/.test(codeOnly(f.text))).map((f) => f.path)).toEqual([])
    expect(readdirSync(join(ROOT, 'scripts')).filter((name) => /backfill|slice_3b/i.test(name) && /credential/i.test(name))).toEqual([])
  })

  it('the sweep logs nothing, and the backfill core logs only code-only lines', () => {
    expect(code(SWEEP)).not.toMatch(/console\./)
    const lines = code(BACKFILL).split('\n').filter((line) => /console\./.test(line))
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      expect(line).toMatch(/\[credential-backfill\]/)
      expect(line).not.toMatch(/secret|\bdata\b|\brow\b|value|\.message|ciphertext|token|digest|sha/i)
    }
  })

  it('the sweep contains no column name, request, or client creation of its own', () => {
    const sweep = code(SWEEP)
    expect(sweep).not.toMatch(/_api_key|user_settings|provider_api_credentials/)
    expect(sweep).not.toMatch(/createServiceRoleSupabase|NextRequest|fetch\(/)
  })

  it('the Slice 3B SQL is a reviewed artifact under docs/, never under scripts/', () => {
    for (const name of ['FUTURE_059_SLICE_3B_backfill_function.up.sql', 'FUTURE_059_SLICE_3B_backfill_function.down.sql']) {
      expect(() => readFileSync(join(ROOT, 'docs/productization/sql', name), 'utf8'), name).not.toThrow()
    }
  })
})
