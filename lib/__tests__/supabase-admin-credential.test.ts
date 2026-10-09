import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AdminCredentialMalformedError,
  ADMIN_SECRET_KEY_ENV,
  classifyAdminCredential,
  describeAdminCredential,
  resolveAdminCredential,
} from '@/lib/supabase/admin-credential'
import {
  LOCAL_SERVICE_ROLE_PROJECT_REF_ENV,
  ServiceRoleNotConfiguredError,
  ServiceRoleNotPermittedError,
  createServiceRoleSupabase,
  createServiceRoleSupabaseOrNull,
} from '@/lib/supabase/service-role'
import { createWorkerApiDbClient } from '@/lib/render-execution/worker-db-client'
import { decideProviderExecution } from '@/lib/providers/execution-policy'

// FUTURE-052C — LEGACY_CREDENTIAL_FALLBACK_CLEANUP_V1.
// No real credential appears here: every key is assembled at runtime from a prefix and filler, so no literal of
// either shape exists in the source (the repo-wide scan below would reject one).

const URL_ = 'https://abcdefghijklmnopqrst.supabase.co'
const REF = 'abcdefghijklmnopqrst'
const b64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
const fakeSecretKey = (fill = 'S') => `sb_secret_${fill.repeat(31)}`
const fakeLegacyJwt = (fill = 'L') => [b64url({ alg: 'HS256', typ: 'JWT' }), b64url({ role: 'service_role' }), fill.repeat(43)].join('.')

const SECRET = fakeSecretKey()
const LEGACY = fakeLegacyJwt()

describe('classifyAdminCredential', () => {
  it('accepts the sb_secret shape', () => expect(classifyAdminCredential(SECRET)).toBe('secret-key'))
  it('identifies the legacy JWT shape so it can be refused', () => expect(classifyAdminCredential(LEGACY)).toBe('legacy-jwt'))
  it('rejects a publishable key with a distinct reason', () => expect(classifyAdminCredential(`sb_publishable_${'P'.repeat(30)}`)).toBe('publishable-key'))
  it.each(['', 'service-role-test-key', 'sb_secret_short', 'eyJ.only.two', 'Bearer abc', 'a.b.c'])('rejects %j', (value) => {
    expect(classifyAdminCredential(value)).toBe('unrecognised-format')
  })
  it('identifies any structurally valid JWT as legacy-jwt', () => {
    const jwt = [b64url({ alg: 'HS256' }), b64url({ whatever: 1 }), 'x'.repeat(20)].join('.')
    expect(classifyAdminCredential(jwt)).toBe('legacy-jwt')
  })
})

describe('resolveAdminCredential — variable contract', () => {
  it('returns null when the variable is not set (or is blank)', () => {
    expect(resolveAdminCredential({})).toBeNull()
    expect(resolveAdminCredential({ [ADMIN_SECRET_KEY_ENV]: '  ' })).toBeNull()
  })

  it('sb_secret credential is accepted from the canonical variable', () => {
    expect(resolveAdminCredential({ [ADMIN_SECRET_KEY_ENV]: SECRET })).toEqual({ key: SECRET, variable: ADMIN_SECRET_KEY_ENV, shape: 'secret-key' })
  })

  it('legacy JWT is rejected with AdminCredentialMalformedError', () => {
    expect(() => resolveAdminCredential({ [ADMIN_SECRET_KEY_ENV]: LEGACY })).toThrow(AdminCredentialMalformedError)
  })

  it('trims surrounding whitespace (a pasted Vercel value with a newline must not break the key)', () => {
    expect(resolveAdminCredential({ [ADMIN_SECRET_KEY_ENV]: `  ${SECRET}\n` })?.key).toBe(SECRET)
  })

  it('a malformed credential fails clearly and names the variable, never the value', () => {
    const canary = 'definitely-not-a-key-CANARY-123'
    let error: unknown
    try {
      resolveAdminCredential({ [ADMIN_SECRET_KEY_ENV]: canary })
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(AdminCredentialMalformedError)
    const typed = error as AdminCredentialMalformedError
    expect(typed.code).toBe('ADMIN_CREDENTIAL_MALFORMED')
    expect(typed.message).toContain(ADMIN_SECRET_KEY_ENV)
    expect(typed.message).not.toContain(canary)
    expect(JSON.stringify({ message: typed.message, variable: typed.variable, reason: typed.reason })).not.toContain(canary)
  })

  it('a publishable key in an admin variable is refused with a specific reason', () => {
    const publishable = `sb_publishable_${'P'.repeat(30)}`
    expect(() => resolveAdminCredential({ [ADMIN_SECRET_KEY_ENV]: publishable })).toThrow(/publishable key/)
  })
})

describe('describeAdminCredential — browser-safe diagnostic', () => {
  it('reports variable and shape class only', () => {
    expect(describeAdminCredential({ [ADMIN_SECRET_KEY_ENV]: SECRET })).toEqual({ configured: true, variable: ADMIN_SECRET_KEY_ENV, shape: 'secret-key', legacyVariableInUse: false })
    expect(describeAdminCredential({})).toEqual({ configured: false, variable: null, shape: null, legacyVariableInUse: false })
  })

  it('reports malformed and legacy values as invalid without throwing', () => {
    const canary = 'malformed-CANARY-value'
    const out = describeAdminCredential({ [ADMIN_SECRET_KEY_ENV]: canary })
    expect(out).toEqual({ configured: true, variable: ADMIN_SECRET_KEY_ENV, shape: 'invalid', legacyVariableInUse: false })
    expect(JSON.stringify(out)).not.toContain(canary)

    const legacyOut = describeAdminCredential({ [ADMIN_SECRET_KEY_ENV]: LEGACY })
    expect(legacyOut).toEqual({ configured: true, variable: ADMIN_SECRET_KEY_ENV, shape: 'invalid', legacyVariableInUse: false })
  })
})

// ── supabase-js contract: client code path works for sb_secret ─────────────────────────────────────────────
describe('supabase-js server contract (stubbed fetch, no network)', () => {
  type Seen = { url: string; apikey: string | null; authorization: string | null; method: string }
  let seen: Seen[]

  beforeEach(() => {
    seen = []
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', URL_)
    vi.stubEnv(ADMIN_SECRET_KEY_ENV, SECRET)
    vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
      const request = input instanceof Request ? input : null
      const headers = new Headers(init?.headers ?? request?.headers)
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (request?.url ?? '')
      seen.push({ url, apikey: headers.get('apikey'), authorization: headers.get('authorization'), method: init?.method ?? request?.method ?? 'GET' })
      const body = url.includes('/storage/v1/object/sign') ? { signedURL: '/object/sign/b/p?token=t' } : url.includes('/auth/v1/admin/users') ? { users: [], aud: 'authenticated' } : []
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('PostgREST select / insert target /rest/v1 with the key in the apikey header', async () => {
    const db = createServiceRoleSupabase()
    await db.from('video_generations').select('id').limit(1)
    await db.from('video_generations').insert({ id: 'x' })
    const rest = seen.filter((call) => call.url.includes('/rest/v1/video_generations'))
    expect(rest).toHaveLength(2)
    expect(rest.every((call) => call.apikey === SECRET)).toBe(true)
  })

  it('RPC targets /rest/v1/rpc/<name>', async () => {
    await createServiceRoleSupabase().rpc('claim_next_render_execution', { p_worker_id: 'w' })
    expect(seen.some((call) => call.url.includes('/rest/v1/rpc/claim_next_render_execution') && call.apikey === SECRET)).toBe(true)
  })

  it('Auth admin targets /auth/v1/admin', async () => {
    const { error } = await createServiceRoleSupabase().auth.admin.listUsers({ page: 1, perPage: 1 })
    expect(error).toBeNull()
    expect(seen.some((call) => call.url.includes('/auth/v1/admin/users') && call.apikey === SECRET)).toBe(true)
  })

  it('Storage server operations and signed URLs target /storage/v1', async () => {
    const { data } = await createServiceRoleSupabase().storage.from('b').createSignedUrl('p', 60)
    expect(data?.signedUrl).toContain('/storage/v1/')
    expect(seen.some((call) => call.url.includes('/storage/v1/object/sign/b/p') && call.apikey === SECRET)).toBe(true)
  })

  it('the nullable and worker factories build the same working client', async () => {
    for (const db of [createServiceRoleSupabaseOrNull(), createWorkerApiDbClient()]) {
      expect(db).not.toBeNull()
      await db!.from('render_executions').select('id').limit(1)
    }
    expect(seen.filter((call) => call.url.includes('/rest/v1/render_executions') && call.apikey === SECRET)).toHaveLength(2)
  })

  it('the key is never sent to a different host', async () => {
    await createServiceRoleSupabase().from('t').select('id')
    expect(seen.every((call) => new URL(call.url).host === new URL(URL_).host)).toBe(true)
  })

  it('malformed credential: the factory throws a clear error and sends nothing', () => {
    vi.stubEnv(ADMIN_SECRET_KEY_ENV, 'not-a-supabase-key')
    expect(() => createServiceRoleSupabase()).toThrow(AdminCredentialMalformedError)
    expect(() => createServiceRoleSupabaseOrNull()).toThrow(AdminCredentialMalformedError)
    expect(() => createWorkerApiDbClient()).toThrow(AdminCredentialMalformedError)
    expect(seen).toHaveLength(0)
  })

  it('not configured: createServiceRoleSupabase throws, the nullable factories return null', () => {
    vi.stubEnv(ADMIN_SECRET_KEY_ENV, '')
    expect(() => createServiceRoleSupabase()).toThrow(ServiceRoleNotConfiguredError)
    expect(createServiceRoleSupabaseOrNull()).toBeNull()
    expect(createWorkerApiDbClient()).toBeNull()
  })
})

// ── FUTURE-050 stays authoritative ───────────────────────────────────────────────────────────────────────────────
describe('FUTURE-050 policy is unchanged by the credential change', () => {
  afterEach(() => vi.unstubAllEnvs())

  const vercelEnv = (env: 'production' | 'preview') => ({
    VERCEL_URL: 'x.vercel.app',
    VERCEL_ENV: env,
    NODE_ENV: 'production',
    [ADMIN_SECRET_KEY_ENV]: SECRET,
  })

  it('8. Preview paid execution stays blocked even though Preview holds an admin credential', () => {
    const decision = decideProviderExecution({ provider: 'gemini', operation: 'image_review' }, vercelEnv('preview'))
    expect(decision).toMatchObject({ allowed: false, environment: 'preview', reason: 'preview' })
  })

  it('9. Production policy stays allowed (mocked env, no provider call)', () => {
    const decision = decideProviderExecution({ provider: 'gemini', operation: 'image_review' }, vercelEnv('production'))
    expect(decision).toMatchObject({ allowed: true, environment: 'production' })
  })

  it('10. a local runtime still cannot use the admin credential without naming the project ref', () => {
    vi.stubEnv('VITEST', '')
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('VERCEL_URL', '')
    vi.stubEnv('VERCEL_DEPLOYMENT_ID', '')
    vi.stubEnv('VERCEL_REGION', '')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', URL_)
    vi.stubEnv(LOCAL_SERVICE_ROLE_PROJECT_REF_ENV, '')
    vi.stubEnv(ADMIN_SECRET_KEY_ENV, SECRET)
    expect(() => createServiceRoleSupabase()).toThrow(ServiceRoleNotPermittedError)
    expect(() => createServiceRoleSupabaseOrNull()).toThrow(ServiceRoleNotPermittedError)
    expect(() => createWorkerApiDbClient()).toThrow(ServiceRoleNotPermittedError)

    vi.stubEnv(LOCAL_SERVICE_ROLE_PROJECT_REF_ENV, REF)
    expect(createServiceRoleSupabaseOrNull()).not.toBeNull()
    vi.stubEnv(LOCAL_SERVICE_ROLE_PROJECT_REF_ENV, 'wrongprojectrefaaaaaa')
    expect(() => createServiceRoleSupabase()).toThrow(ServiceRoleNotPermittedError)
  })
})

// ── Exposure ─────────────────────────────────────────────────────────────────────────────────────────────────────
describe('the credential is never logged or returned', () => {
  const CANARY_SECRET = fakeSecretKey('C')
  const spies: Array<ReturnType<typeof vi.spyOn>> = []

  beforeEach(() => {
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) spies.push(vi.spyOn(console, method).mockImplementation(() => undefined))
  })
  afterEach(() => {
    for (const spy of spies) spy.mockRestore()
    spies.length = 0
  })

  it('error messages, diagnostic outputs and JSON conversions never contain the key', () => {
    const out = describeAdminCredential({ [ADMIN_SECRET_KEY_ENV]: CANARY_SECRET })
    expect(JSON.stringify(out)).not.toContain(CANARY_SECRET)
    try {
      resolveAdminCredential({ [ADMIN_SECRET_KEY_ENV]: `sb_secret_${'Z'.repeat(10)}` })
    } catch (e) {
      expect((e as Error).message).not.toContain('Z'.repeat(10))
    }
  })
})

// ── Source scans ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('source safety', () => {
  const ROOT = process.cwd()
  const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'docs', 'coverage', 'out', 'dist', '.vercel'])
  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue
      const full = join(dir, entry)
      const stats = statSync(full)
      if (stats.isDirectory()) walk(full, out)
      else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry)) out.push(full)
    }
    return out
  }
  const isTest = (file: string) => /\.test\.[jt]sx?$/.test(file) || file.includes(`${join('lib', '__tests__')}`) || file.includes('__tests__')
  const sources = walk(ROOT).filter((file) => !isTest(file) && !file.endsWith('.d.ts'))
  const rel = (file: string) => relative(ROOT, file).replace(/\\/g, '/')

  it('no application source reads the legacy SUPABASE_SERVICE_ROLE_KEY name', () => {
    const readers = sources.filter((file) => /SUPABASE_SERVICE_ROLE_KEY/.test(readFileSync(file, 'utf8'))).map(rel).sort()
    expect(readers).toEqual([])
  })

  it('no NEXT_PUBLIC_ variable name carries a secret / service-role / admin meaning', () => {
    const offenders = sources.filter((file) => /NEXT_PUBLIC_[A-Z0-9_]*(SECRET|SERVICE|ADMIN)/.test(readFileSync(file, 'utf8'))).map(rel)
    expect(offenders).toEqual([])
  })

  it('JWT-shape assumptions stay out of runtime code: no JWT decoding library or SUPABASE_JWT_SECRET use', () => {
    const offenders = sources
      .filter((file) => /from ['"](jsonwebtoken|jose|jwt-decode)['"]|SUPABASE_JWT_SECRET/.test(readFileSync(file, 'utf8')))
      .map(rel)
    expect(offenders).toEqual([])
  })

  it('a built client bundle (when .next/static exists) holds neither the variable names nor an sb_secret_ key', () => {
    const staticDir = join(ROOT, '.next', 'static')
    if (!existsSync(staticDir)) return
    const hits: string[] = []
    const walkStatic = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        if (statSync(full).isDirectory()) walkStatic(full)
        else if (/\.js$/.test(name) && /SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY|sb_secret_[A-Za-z0-9_-]{16,}/.test(readFileSync(full, 'utf8'))) hits.push(relative(ROOT, full))
      }
    }
    walkStatic(staticDir)
    expect(hits).toEqual([])
  }, 120_000)
})

describe('10. current source and history', () => {
  const ROOT = process.cwd()
  const ROOTS = ['scripts', 'lib', 'app', 'components', 'hooks', 'infra', 'remotion', 'docs']
  const SKIP = new Set(['node_modules', '.next', '.git'])
  const SECRET_LITERAL = /sb_secret_[A-Za-z0-9_-]{16,}/

  function* files(dir: string): Generator<string> {
    for (const name of readdirSync(dir)) {
      if (SKIP.has(name)) continue
      const full = join(dir, name)
      if (statSync(full).isDirectory()) yield* files(full)
      else if (/\.(ts|tsx|js|mjs|cjs|json|md|sql|yml|yaml|env)$/.test(name)) yield full
    }
  }

  it('no sb_secret_ literal exists anywhere in tracked source or docs', () => {
    const offenders: string[] = []
    const targets = [...ROOTS.filter((root) => existsSync(join(ROOT, root))).flatMap((root) => [...files(join(ROOT, root))]), ...readdirSync(ROOT).filter((n) => /\.(mjs|cjs|js|ts)$/.test(n)).map((n) => join(ROOT, n))]
    for (const file of targets) if (SECRET_LITERAL.test(readFileSync(file, 'utf8'))) offenders.push(relative(ROOT, file))
    expect(offenders).toEqual([])
  })

  it('the historical exposure stays documented in the canonical security doc', () => {
    const doc = readFileSync(join(ROOT, 'docs/discovery/security/PRODUCTION_SERVICE_ROLE_KEY_REPLACEMENT_V1.md'), 'utf8')
    expect(doc).toContain('9c55b83')
    expect(doc).toContain('scripts/m10c_api_test.mjs')
    expect(doc).toMatch(/compromised/i)
    expect(doc).not.toMatch(SECRET_LITERAL)
  })
})
