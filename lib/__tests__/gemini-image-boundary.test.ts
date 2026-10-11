import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// FUTURE-064 Slice A — static boundary of the official Gemini image-generation server path. Source-text assertions
// guard what mocked behavior tests cannot: who may import what, and that Slice A stays server-only and UI-free.

const ROOT = process.cwd()
const posix = (path: string) => path.split(String.fromCharCode(92)).join('/')
const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    if (['node_modules', '.next', '.git', 'docs', 'coverage'].includes(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}
const all = [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'lib')), ...walk(join(ROOT, 'components'))].map((file) => ({
  path: posix(file.slice(ROOT.length + 1)),
  text: readFileSync(file, 'utf8'),
}))
const production = all.filter((file) => !/\.test\.tsx?$/.test(file.path) && !file.path.includes('/__tests__/'))
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((line) => line.replace(/(^|\s)\/\/.*$/, '')).join('\n')
const read = (path: string) => production.find((file) => file.path === path)!
const importers = (needle: RegExp, except: string[]) => production.filter((file) => !except.includes(file.path) && needle.test(code(file.text))).map((file) => file.path)

const ROUTE = 'app/api/gemini/generate-image/route.ts'
const CLIENT = 'lib/providers/gemini/image-client.ts'
const MODELS = 'lib/providers/gemini/image-models.ts'
const FEATURE = 'lib/providers/gemini/image-feature.ts'

describe('Gemini image generation — server-only, UI-free, closed', () => {
  it('the new files exist', () => {
    for (const path of [ROUTE, CLIENT, MODELS, FEATURE]) expect(read(path), path).toBeDefined()
  })

  it('only the new route imports the image client; only the route and the client import the registry', () => {
    expect(importers(/providers\/gemini\/image-client/, [ROUTE])).toEqual([])
    expect(importers(/providers\/gemini\/image-models/, [ROUTE, CLIENT])).toEqual([])
    expect(importers(/providers\/gemini\/image-feature/, [ROUTE])).toEqual([])
  })

  it('Slice A has no UI: nothing under components/ or a page references the route, the registry or the aliases', () => {
    const ui = production.filter((file) => file.path.startsWith('components/') || /\/page\.tsx$/.test(file.path) || /\/layout\.tsx$/.test(file.path))
    expect(ui.filter((file) => /api\/gemini\/generate-image|gemini-nb-|image-models|image-client|GEMINI_IMAGE/.test(code(file.text))).map((file) => file.path)).toEqual([])
    // user-selectable defaults / selector types are untouched
    expect(code(read('lib/types.ts').text)).not.toMatch(/gemini-nb-/)
    expect(code(read('components/images/prompt-section.tsx').text)).not.toMatch(/gemini-nb-/)
  })

  it('the route is guarded in the required order: auth, release switch, execution policy, validation, Attempt, credential, provider', () => {
    const route = code(read(ROUTE).text)
    const post = route.slice(route.indexOf('export async function POST'))
    const run = route.slice(route.indexOf('async function runCanonicalGemini'), route.indexOf('export async function POST'))
    const inOrder = (text: string, markers: string[]) => {
      const indexes = markers.map((marker) => text.indexOf(marker))
      expect(indexes.every((index) => index >= 0), markers.join(' | ')).toBe(true)
      expect([...indexes].sort((x, y) => x - y)).toEqual(indexes)
    }
    inOrder(post, ['auth.getUser()', 'isGeminiImageGenerationEnabled()', 'providerExecutionBlockedResponse(', 'await parseRequest(request)', 'await runCanonicalGemini('])
    inOrder(run, ['freezeAndClaimImageAttempt({', 'resolveProviderExecution(input.supabase', 'generateGeminiImage({', 'uploadImageToS3(', 'linkImageOutput('])
  })

  it('resolves credentials only through the existing resolver, for the gemini provider only', () => {
    const route = code(read(ROUTE).text)
    expect(route).toContain('resolveProviderExecution(')
    expect(route).toMatch(/provider: GEMINI_IMAGE_PROVIDER/)
    expect(route).toMatch(/providerCredentialUnavailableResponse|isProviderCredentialUnavailableError/)
    for (const forbidden of [/createServiceRoleSupabase/, /user_settings/, /gemini_api_key|openai_api_key|nanobanana_api_key/, /process\.env\.(?!NODE_ENV)/, /resolveProviderCredential/]) {
      expect(route).not.toMatch(forbidden)
      expect(code(read(CLIENT).text)).not.toMatch(forbidden)
    }
  })

  it('performs exactly one provider call site and no retry loop', () => {
    const client = code(read(CLIENT).text)
    expect(client.match(/fetchImpl\(/g)).toHaveLength(1)
    expect(client).not.toMatch(/\b(retry|retries|backoff|attempts?\s*<|while\s*\(true\)|setInterval)\b/i)
    const route = code(read(ROUTE).text)
    expect(route.match(/generateGeminiImage\(/g)).toHaveLength(1)
    // the only loop in the route is the request-field validation (`for (const key of Object.keys(...))`)
    expect(route).not.toMatch(/\bfor\s*\(\s*(let|var)\b|\bwhile\s*\(|setTimeout|setInterval/)
    expect(route.match(/\bfor\s*\(/g) ?? []).toHaveLength(1)
  })

  it('the client is text-to-image only: no input image part can be built', () => {
    const client = code(read(CLIENT).text)
    expect(client).not.toMatch(/fileData|file_data|Files API|uploadFile/i)
    // the only `inlineData` mention is when READING the response
    const requestBuilder = client.slice(client.indexOf('export function buildGeminiImageRequestBody'), client.indexOf('export async function generateGeminiImage'))
    expect(requestBuilder).not.toMatch(/inlineData|inline_data/)
  })

  it('keeps the key out of URLs, logs and messages, and never logs bodies or prompts', () => {
    const client = code(read(CLIENT).text)
    expect(client).toContain("'x-goog-api-key': input.apiKey")
    expect(client).not.toMatch(/\?key=|[&?]key=/)
    expect(client).not.toMatch(/console\./)
    const route = code(read(ROUTE).text)
    const logs = route.split('\n').filter((line) => /console\./.test(line))
    expect(logs).toHaveLength(1)
    expect(logs[0]).not.toMatch(/prompt|secret|apiKey|body|response|execution/i)
  })

  it('does not touch OpenAI, the third-party NanoBanana provider, pricing, usage tables or migrations', () => {
    for (const path of [ROUTE, CLIENT, MODELS, FEATURE]) {
      const text = code(read(path).text)
      expect(text, path).not.toMatch(/api\.openai\.com|nanobananaapi|nano_banana|generation_tasks|syncNanoImageAttempt/)
      expect(text, path).not.toMatch(/provider_pricing_versions|provider_usage_events|recordProviderUsageEvent|\.rpc\(|\.sql/)
    }
  })

  it('the registry is closed: exactly the two approved aliases, no default, no price', () => {
    const models = code(read(MODELS).text)
    expect([...models.matchAll(/alias: '([^']+)'/g)].map((match) => match[1])).toEqual(['gemini-nb-2.1', 'gemini-nb-lite'])
    expect([...models.matchAll(/providerModel: '([^']+)'/g)].map((match) => match[1])).toEqual(['gemini-nano-banana-2.1', 'gemini-3.1-flash-lite-image'])
    expect(models).not.toMatch(/\bdefault(Model|Alias)\b|\?\? REGISTRY\[|price|usd|\$\d/i)
    expect(read(MODELS).text).toContain('Object.freeze')
  })

  it('the release switch is not enabled by any checked-in deployment or environment file', () => {
    for (const name of ['vercel.json', 'vercel.ts', 'next.config.mjs', 'next.config.js', '.env.example', '.env.production', '.env', '.env.local']) {
      let content = ''
      try { content = readFileSync(join(ROOT, name), 'utf8') } catch { /* absent */ }
      expect(content, name).not.toMatch(/CONTENT_STUDIO_GEMINI_IMAGE_GENERATION/)
    }
    expect(production.filter((file) => file.path !== FEATURE && /CONTENT_STUDIO_GEMINI_IMAGE_GENERATION/.test(code(file.text))).map((file) => file.path)).toEqual([])
    expect(readFileSync(join(ROOT, 'package.json'), 'utf8')).not.toMatch(/CONTENT_STUDIO_GEMINI_IMAGE_GENERATION/)
  })

  it('leaves the legacy NanoBanana and OpenAI image routes free of Gemini image code', () => {
    for (const path of ['app/api/nanobanana/generate/route.ts', 'app/api/nanobanana/callback/route.ts', 'app/api/nanobanana/status/[taskId]/route.ts', 'app/api/openai/generate-image/route.ts', 'lib/image-generation/execution.ts']) {
      expect(code(read(path).text), path).not.toMatch(/providers\/gemini\/image|gemini-nb-|generateGeminiImage/)
    }
  })

  it('does not change credential storage, grants or schema: no scripts/ or credential file is touched by the slice', () => {
    expect(importers(/providers\/gemini\/image/, [ROUTE, CLIENT, MODELS, FEATURE])).toEqual([])
    expect(readdirSync(join(ROOT, 'scripts')).filter((name) => /gemini.*image|image.*gemini/i.test(name))).toEqual([])
  })
})
