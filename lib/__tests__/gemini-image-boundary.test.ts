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
// CRLF-safe: a Windows checkout has CRLF line endings, which would stop the comment stripper at the `\r`.
const code = (text: string) => text.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((line) => line.replace(/(^|\s)\/\/.*$/, '')).join('\n')
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

  it('only the route imports the image client; the registry and the switch have a closed set of importers', () => {
    expect(importers(/providers\/gemini\/image-client/, [ROUTE, 'lib/image-generation/reference-media.ts'])).toEqual([])
    // Slice B: the browser-safe catalog/readiness modules read the alias registry; nothing else does.
    expect(importers(/providers\/gemini\/image-models/, [ROUTE, CLIENT, 'lib/images/image-models.ts', 'lib/images/image-readiness.ts', 'lib/images/image-reference.ts', 'lib/image-generation/execution.ts', 'lib/image-generation/reference-media.ts'])).toEqual([])
    // Slice B: the authenticated settings route derives the browser-safe availability class from the switch.
    expect(importers(/providers\/gemini\/image-feature/, [ROUTE, 'app/api/settings/providers/route.ts', 'lib/images/image-reference.ts', 'lib/image-generation/execution.ts', 'lib/image-generation/reference-media.ts'])).toEqual([])
  })

  it('UI wiring (Slice B) goes only through the browser-safe lib/images modules, never the server client or the switch', () => {
    const ui = production.filter((file) => file.path.startsWith('components/') || /\/page\.tsx$/.test(file.path) || /\/layout\.tsx$/.test(file.path))
    expect(ui.filter((file) => /providers\/gemini\//.test(code(file.text))).map((file) => file.path)).toEqual([])
    expect(ui.filter((file) => /CONTENT_STUDIO_GEMINI_IMAGE_GENERATION|image-feature|image-client/.test(code(file.text))).map((file) => file.path)).toEqual([])
    // exactly one place dispatches to the route: the /imagens workspace page
    expect(ui.filter((file) => /api\/gemini\/generate-image/.test(code(file.text))).map((file) => file.path)).toEqual(['app/(dashboard)/imagens/page.tsx'])
  })

  it('the shared selector types come from the catalog, not hand-copied unions', () => {
    expect(code(read('lib/types.ts').text)).toMatch(/default_image_model: ImageModel/)
    expect(code(read('lib/types.ts').text)).toMatch(/selected_model: ImageModel \| null/)
    expect(code(read('components/images/prompt-section.tsx').text)).not.toMatch(/\|\s*'nanobanana-v1'/)
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

  it('the client sends only inline reference bytes, never source URLs or Files API', () => {
    const client = code(read(CLIENT).text)
    expect(client).not.toMatch(/fileData|file_data|Files API|uploadFile/i)
    // References must be byte parts; their authorized durable IDs stay on the server.
    const requestBuilder = client.slice(client.indexOf('export function buildGeminiImageRequestBody'), client.indexOf('export async function generateGeminiImage'))
    expect(requestBuilder).toMatch(/inlineData/); expect(requestBuilder).not.toMatch(/url|fileData/i)
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
    for (const path of ['app/api/nanobanana/generate/route.ts', 'app/api/nanobanana/callback/route.ts', 'app/api/nanobanana/status/[taskId]/route.ts', 'app/api/openai/generate-image/route.ts']) {
      expect(code(read(path).text), path).not.toMatch(/providers\/gemini\/image|gemini-nb-|generateGeminiImage/)
    }
  })

  it('does not change credential storage, grants or schema: no scripts/ or credential file is touched by the slice', () => {
    expect(importers(/providers\/gemini\/image/, [ROUTE, CLIENT, MODELS, FEATURE, 'lib/images/image-models.ts', 'lib/images/image-readiness.ts', 'app/api/settings/providers/route.ts', 'lib/images/image-reference.ts', 'lib/image-generation/execution.ts', 'lib/image-generation/reference-media.ts'])).toEqual([])
    expect(readdirSync(join(ROOT, 'scripts')).filter((name) => /gemini.*image|image.*gemini/i.test(name))).toEqual([])
  })
})

describe('Slice C — usage accounting boundary', () => {
  const USAGE = 'lib/usage/gemini-image-usage.ts'

  it('only the image route imports the accounting module; the module is server-only and prices nothing', () => {
    expect(importers(/usage\/gemini-image-usage/, [ROUTE])).toEqual([])
    const usage = code(read(USAGE).text)
    expect(usage).not.toMatch(/provider_pricing_versions|loadPricingVersions|deriveProviderUsageCost|pricing\//)
    expect(usage).not.toMatch(/\$\s?\d|\bUSD\b|\bBRL\b|estimated_cost|price_amount/i)
    expect(usage).not.toMatch(/\.rpc\(|\.sql|CREATE TABLE|ALTER TABLE|migration/i)
    expect(usage).not.toMatch(/fetch\(|generativelanguage|x-goog-api-key|process\.env/)
    expect(usage).not.toMatch(/console\.[a-z]+\([^)]*(prompt|secret|apiKey|response\.|error\.message)/i)
  })

  it('the route accounts BEFORE it touches storage, and only after a provider response (never before the call)', () => {
    const route = code(read(ROUTE).text)
    const run = route.slice(route.indexOf('async function runCanonicalGemini'), route.indexOf('export async function POST'))
    const call = run.indexOf('await generateGeminiImage(')
    const rejected = run.indexOf("providerResponse: 'received_rejected'")
    const received = run.indexOf("providerResponse: 'received', responseId")
    const upload = run.indexOf('await uploadImageToS3(')
    expect(call).toBeGreaterThan(0)
    expect(rejected).toBeGreaterThan(call)
    expect(received).toBeGreaterThan(rejected)
    expect(upload).toBeGreaterThan(received)
    // exactly two accounting call sites: a received-but-unusable response, and a usable one
    expect(run.match(/accountGeminiImageUsage\(/g)).toHaveLength(2)
  })

  it('image usage is recorded for the Gemini image route only: legacy NanoBanana, OpenAI image and Gemini text paths do not touch it', () => {
    for (const path of ['app/api/nanobanana/generate/route.ts', 'app/api/nanobanana/callback/route.ts', 'app/api/openai/generate-image/route.ts', 'app/api/prompt-assistance/route.ts', 'lib/prompt-assistance/usage.ts', 'lib/usage/gemini-review-usage.ts', 'lib/reviews/service.ts', 'lib/image-generation/execution.ts']) {
      expect(code(read(path).text), path).not.toMatch(/gemini-image-usage|GEMINI_IMAGE_USAGE|'image_generation_attempt'/)
    }
  })

  it('adds no migration or pricing seed under scripts/, and the pricing CODE carries no model id, alias or price (rates live only in the registry)', () => {
    expect(readdirSync(join(ROOT, 'scripts')).filter((name) => /gemini.*(usage|image)|image.*usage|image_output/i.test(name))).toEqual([])
    // FUTURE-064 Slice D teaches the code the `image_output` DIMENSION, never a model or a rate.
    for (const path of ['lib/usage/pricing/registry.ts', 'lib/usage/pricing/derive.ts', 'lib/usage/pricing/aggregate.ts']) {
      expect(code(read(path).text), path).not.toMatch(/gemini-nano-banana|gemini-3\.1-flash-lite-image|gemini-nb-|nano.?banana/i)
      expect(code(read(path).text), path).not.toMatch(/\b(1\.50|7\.50|30\.00|0\.25)\b|0\.0336|1120/)
    }
  })
})
