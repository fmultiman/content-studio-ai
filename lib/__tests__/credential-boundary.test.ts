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
    expect(filesContaining('KLING_WEBHOOK_SECRET')).toEqual(['app/api/kling/callback/route.ts'])
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
    const offenders = sourceFiles.filter((file) => SECRET_COLUMNS.test(file.text) && !allowed(file.path)).map((file) => file.path)
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
    const providerHosts = /api\.openai\.com|klingai\.com|nanobananaapi\.ai/
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
