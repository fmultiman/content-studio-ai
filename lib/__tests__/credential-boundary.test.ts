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
  const SECRET_COLUMNS = /(openai_api_key|nanobanana_api_key|kling_api_key|replicate_api_key)/

  it('secret columns are referenced only by server-side credential code, API routes and types', () => {
    const allowed = (path: string) =>
      path.startsWith('app/api/') || path.startsWith('lib/credentials/') || path === 'lib/types.ts'
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
    expect(page).toContain("/api/prompts/generate-image-prompt")
    expect(page).not.toMatch(/openaiApiKey|nanobananaApiKey/)
  })

  it('files that call api.openai.com are server routes or the server-only prompt module', () => {
    const callers = filesContaining('api.openai.com')
    for (const path of callers) {
      expect(path.startsWith('app/api/') || path === 'lib/ai-simulator.ts').toBe(true)
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
        'app/api/nanobanana/generate/route.ts',
        'app/api/openai/generate-image/route.ts',
        'app/api/posts/generate-feed-text/route.ts',
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

  it('a tool is invoked from exactly two places: the read-only gate and the video-tool gate', () => {
    expect(codeFilesContaining(/\.callTool\(/)).toEqual([
      'lib/provider-connections/kling-mcp-client.ts',
      'lib/provider-connections/kling-mcp-generation.ts',
    ])
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
      path === 'app/api/video-generations/[id]/sync/route.ts'
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
    const allowed = new Set(['capabilities', 'connection-ref', 'form-selection', 'status-refresh'])
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

