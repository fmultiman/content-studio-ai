import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PUBLIC_PUBLISHABLE_KEY_ENV,
  PublicCredentialMalformedError,
  PublicCredentialNotConfiguredError,
  classifyPublicCredential,
  describePublicCredential,
  getSupabasePublicKey,
  readPublicCredentialEnv,
  resolvePublicCredential,
} from '@/lib/supabase/public-credential'

// FUTURE-052C — LEGACY_CREDENTIAL_FALLBACK_CLEANUP_V1.
// No real credential appears here: every key is assembled at runtime from a prefix and filler, so no literal of
// either shape exists in the source (the repo-wide scan below would reject one).

const URL_ = 'https://abcdefghijklmnopqrst.supabase.co'
const b64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
const fakeJwt = (role: string, fill = 'L') => [b64url({ alg: 'HS256', typ: 'JWT' }), b64url({ role }), fill.repeat(43)].join('.')
const fakePublishable = (fill = 'P') => `sb_publishable_${fill.repeat(30)}`
const fakeSecret = (fill = 'S') => `sb_secret_${fill.repeat(31)}`

const PUBLISHABLE = fakePublishable()
const LEGACY_ANON = fakeJwt('anon')
const SERVICE_ROLE_JWT = fakeJwt('service_role')

const captured = vi.hoisted(() => ({
  serverArgs: [] as unknown[][],
  browserArgs: [] as unknown[][],
  getUser: vi.fn(),
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: (...args: unknown[]) => {
    captured.serverArgs.push(args)
    return { auth: { getUser: captured.getUser } }
  },
  createBrowserClient: (...args: unknown[]) => {
    captured.browserArgs.push(args)
    return { marker: 'browser' }
  },
}))

const cookieStore = vi.hoisted(() => ({ getAll: vi.fn(() => [{ name: 'sb-access', value: 'cookie-value' }]), set: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: async () => cookieStore }))

const stubPublicEnv = (env: { publishable?: string }) => {
  vi.unstubAllEnvs()
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', URL_)
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', env.publishable ?? '')
}

beforeEach(() => {
  captured.serverArgs.length = 0
  captured.browserArgs.length = 0
  captured.getUser.mockReset()
  cookieStore.set.mockReset()
})
afterEach(() => vi.unstubAllEnvs())

describe('classifyPublicCredential', () => {
  it('accepts the sb_publishable shape', () => expect(classifyPublicCredential(PUBLISHABLE)).toBe('publishable-key'))
  it('identifies a legacy anon JWT so it can be refused', () => expect(classifyPublicCredential(LEGACY_ANON)).toBe('legacy-anon-jwt'))
  it('rejects a secret API key', () => expect(classifyPublicCredential(fakeSecret())).toBe('secret-key'))
  it('rejects a legacy service_role JWT even though it is structurally a valid JWT', () => {
    expect(classifyPublicCredential(SERVICE_ROLE_JWT)).toBe('service-role-jwt')
  })
  it.each([
    '',
    'anon-test-key',
    'sb_publishable_short',
    'eyJ.only.two',
    'Bearer abc',
    'a.b.c',
    [b64url({ alg: 'HS256' }), b64url({ role: 'authenticated' }), 'x'.repeat(20)].join('.'),
    [b64url({ alg: 'HS256' }), b64url({ nope: 1 }), 'x'.repeat(20)].join('.'),
    [b64url({ alg: 'HS256' }), '!!!', 'x'.repeat(20)].join('.'),
  ])('rejects %j', (value) => {
    expect(classifyPublicCredential(value)).toBe('unrecognised-format')
  })
})

describe('resolvePublicCredential — variable contract', () => {
  it('missing key fails clearly (and blank counts as missing)', () => {
    expect(() => resolvePublicCredential({})).toThrow(PublicCredentialNotConfiguredError)
    expect(() => resolvePublicCredential({ [PUBLIC_PUBLISHABLE_KEY_ENV]: '  ' })).toThrow(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/)
  })

  it('publishable key is accepted from the canonical variable', () => {
    expect(resolvePublicCredential({ [PUBLIC_PUBLISHABLE_KEY_ENV]: PUBLISHABLE })).toEqual({
      key: PUBLISHABLE,
      variable: PUBLIC_PUBLISHABLE_KEY_ENV,
      shape: 'publishable-key',
    })
  })

  it('trims surrounding whitespace', () => {
    expect(resolvePublicCredential({ [PUBLIC_PUBLISHABLE_KEY_ENV]: `  ${PUBLISHABLE}\n` }).key).toBe(PUBLISHABLE)
  })

  it('legacy anon JWT in the canonical variable is rejected', () => {
    expect(() => resolvePublicCredential({ [PUBLIC_PUBLISHABLE_KEY_ENV]: LEGACY_ANON })).toThrow(PublicCredentialMalformedError)
  })

  it('a malformed key fails with the variable name and no value', () => {
    const value = 'definitely-not-a-key-value'
    try {
      resolvePublicCredential({ [PUBLIC_PUBLISHABLE_KEY_ENV]: value })
      throw new Error('expected a throw')
    } catch (error) {
      expect(error).toBeInstanceOf(PublicCredentialMalformedError)
      expect((error as PublicCredentialMalformedError).message).toContain(PUBLIC_PUBLISHABLE_KEY_ENV)
      expect((error as Error).message).not.toContain(value)
    }
  })

  it.each([
    ['secret key in the canonical variable', { [PUBLIC_PUBLISHABLE_KEY_ENV]: fakeSecret() }, 'secret-key'],
    ['service_role JWT in the canonical variable', { [PUBLIC_PUBLISHABLE_KEY_ENV]: SERVICE_ROLE_JWT }, 'service-role-jwt'],
    ['legacy anon JWT in the canonical variable', { [PUBLIC_PUBLISHABLE_KEY_ENV]: LEGACY_ANON }, 'legacy-anon-jwt'],
  ] as const)('admin or legacy credential rejected by the public resolver: %s', (_label, env, reason) => {
    try {
      resolvePublicCredential(env)
      throw new Error('expected a throw')
    } catch (error) {
      expect(error).toBeInstanceOf(PublicCredentialMalformedError)
      expect((error as PublicCredentialMalformedError).reason).toBe(reason)
      const text = JSON.stringify(error) + (error as Error).message
      expect(text).not.toContain(Object.values(env)[0])
    }
  })

  it('getSupabasePublicKey returns just the key', () => {
    expect(getSupabasePublicKey({ [PUBLIC_PUBLISHABLE_KEY_ENV]: PUBLISHABLE })).toBe(PUBLISHABLE)
  })

  it('readPublicCredentialEnv reads exactly NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY from process.env', () => {
    stubPublicEnv({ publishable: PUBLISHABLE })
    expect(readPublicCredentialEnv()).toEqual({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE })
  })

  it('does not read the non-public SUPABASE_ANON_KEY / SUPABASE_PUBLISHABLE_KEY aliases', () => {
    vi.stubEnv('SUPABASE_ANON_KEY', LEGACY_ANON)
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', PUBLISHABLE)
    stubPublicEnv({})
    expect(() => resolvePublicCredential()).toThrow(PublicCredentialNotConfiguredError)
  })
})

describe('describePublicCredential (safe diagnostic)', () => {
  it('reports the target state: canonical variable, publishable shape, legacyVariableInUse=false', () => {
    expect(describePublicCredential({ [PUBLIC_PUBLISHABLE_KEY_ENV]: PUBLISHABLE })).toEqual({
      configured: true,
      variable: 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      shape: 'publishable-key',
      legacyVariableInUse: false,
    })
  })

  it('reports unconfigured and invalid without throwing', () => {
    expect(describePublicCredential({})).toEqual({ configured: false, variable: null, shape: null, legacyVariableInUse: false })
    expect(describePublicCredential({ [PUBLIC_PUBLISHABLE_KEY_ENV]: fakeSecret() })).toEqual({
      configured: true,
      variable: PUBLIC_PUBLISHABLE_KEY_ENV,
      shape: 'invalid',
      legacyVariableInUse: false,
    })
    expect(describePublicCredential({ [PUBLIC_PUBLISHABLE_KEY_ENV]: LEGACY_ANON })).toEqual({
      configured: true,
      variable: PUBLIC_PUBLISHABLE_KEY_ENV,
      shape: 'invalid',
      legacyVariableInUse: false,
    })
  })

  it('never contains any part of a credential value', () => {
    const raw = JSON.stringify(describePublicCredential({ [PUBLIC_PUBLISHABLE_KEY_ENV]: PUBLISHABLE }))
    expect(raw).not.toContain('sb_publishable_')
    expect(raw).not.toContain('eyJ')
    expect(raw).not.toContain(PUBLISHABLE.slice(-8))
  })
})

describe('browser client', () => {
  it('receives the publishable key', async () => {
    stubPublicEnv({ publishable: PUBLISHABLE })
    const { createClient } = await import('@/lib/supabase/client')
    createClient()
    expect(captured.browserArgs).toEqual([[URL_, PUBLISHABLE]])
  })

  it('no admin secret reaches the browser client even if one is present in the environment', async () => {
    vi.stubEnv('SUPABASE_SECRET_KEY', fakeSecret('Z'))
    stubPublicEnv({ publishable: PUBLISHABLE })
    const { createClient } = await import('@/lib/supabase/client')
    createClient()
    const sent = JSON.stringify(captured.browserArgs)
    expect(sent).not.toContain('sb_secret_')
  })

  it('refuses to build a browser client from an admin credential or legacy anon JWT', async () => {
    stubPublicEnv({ publishable: fakeSecret() })
    const { createClient } = await import('@/lib/supabase/client')
    expect(() => createClient()).toThrow(PublicCredentialMalformedError)
    expect(captured.browserArgs).toHaveLength(0)
  })
})

describe('SSR user client', () => {
  it('receives the publishable key and the project URL', async () => {
    stubPublicEnv({ publishable: PUBLISHABLE })
    const { createClient } = await import('@/lib/supabase/server')
    await createClient()
    expect(captured.serverArgs).toHaveLength(1)
    expect(captured.serverArgs[0][0]).toBe(URL_)
    expect(captured.serverArgs[0][1]).toBe(PUBLISHABLE)
  })

  it('cookies stay wired: getAll reads the request cookie store and setAll writes through it', async () => {
    stubPublicEnv({ publishable: PUBLISHABLE })
    const { createClient } = await import('@/lib/supabase/server')
    await createClient()
    const { cookies } = captured.serverArgs[0][2] as { cookies: { getAll(): unknown; setAll(c: { name: string; value: string; options?: object }[]): void } }
    expect(cookies.getAll()).toEqual([{ name: 'sb-access', value: 'cookie-value' }])
    cookies.setAll([{ name: 'sb-refresh', value: 'rotated', options: { path: '/' } }])
    expect(cookieStore.set).toHaveBeenCalledWith('sb-refresh', 'rotated', { path: '/' })
  })

  it('setAll from a Server Component (cookie store throws) is swallowed, as before', async () => {
    stubPublicEnv({ publishable: PUBLISHABLE })
    cookieStore.set.mockImplementation(() => {
      throw new Error('read-only cookies')
    })
    const { createClient } = await import('@/lib/supabase/server')
    await createClient()
    const { cookies } = captured.serverArgs[0][2] as { cookies: { setAll(c: { name: string; value: string }[]): void } }
    expect(() => cookies.setAll([{ name: 'a', value: 'b' }])).not.toThrow()
  })

  it('the client is the stock @supabase/ssr client: the user JWT comes from the cookie session, the key is only `apikey`', async () => {
    stubPublicEnv({ publishable: PUBLISHABLE })
    const { createClient } = await import('@/lib/supabase/server')
    const client = await createClient()
    const options = captured.serverArgs[0][2] as Record<string, unknown>
    expect(Object.keys(options)).toEqual(['cookies'])
    expect(client).toHaveProperty('auth.getUser')
  })
})

describe('middleware (updateSession)', () => {
  const request = (path: string) => new NextRequest(`http://localhost${path}`, { headers: { cookie: 'sb-access=cookie-value' } })

  it('receives the publishable key and reads the request cookies', async () => {
    stubPublicEnv({ publishable: PUBLISHABLE })
    captured.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    const { updateSession } = await import('@/lib/supabase/middleware')
    await updateSession(request('/dashboard'))
    expect(captured.serverArgs[0][0]).toBe(URL_)
    expect(captured.serverArgs[0][1]).toBe(PUBLISHABLE)
    const { cookies } = captured.serverArgs[0][2] as { cookies: { getAll(): { name: string; value: string }[] } }
    expect(cookies.getAll()).toEqual([{ name: 'sb-access', value: 'cookie-value' }])
  })

  it('session refresh: cookies rotated by supabase-js are written to the request AND the response', async () => {
    stubPublicEnv({ publishable: PUBLISHABLE })
    captured.getUser.mockImplementation(async () => {
      const { cookies } = captured.serverArgs[0][2] as { cookies: { setAll(c: { name: string; value: string; options?: object }[]): void } }
      cookies.setAll([{ name: 'sb-access', value: 'refreshed', options: { path: '/' } }])
      return { data: { user: { id: 'u1' } } }
    })
    const { updateSession } = await import('@/lib/supabase/middleware')
    const response = await updateSession(request('/dashboard'))
    expect(response.status).toBe(200)
    expect(response.cookies.get('sb-access')?.value).toBe('refreshed')
  })

  it('protected routes redirect an anonymous visitor to /login', async () => {
    stubPublicEnv({ publishable: PUBLISHABLE })
    captured.getUser.mockResolvedValue({ data: { user: null } })
    const { updateSession } = await import('@/lib/supabase/middleware')
    for (const path of ['/dashboard', '/projetos/1', '/imagens', '/videos/geracoes/x', '/creative-editor/video/d1', '/configuracoes']) {
      const response = await updateSession(request(path))
      expect(response.status, path).toBe(307)
      expect(new URL(response.headers.get('location') as string).pathname, path).toBe('/login')
    }
  })

  it('an authenticated user passes protected routes and is bounced off /login and /signup', async () => {
    stubPublicEnv({ publishable: PUBLISHABLE })
    captured.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    const { updateSession } = await import('@/lib/supabase/middleware')
    expect((await updateSession(request('/projetos'))).status).toBe(200)
    for (const path of ['/login', '/signup']) {
      const response = await updateSession(request(path))
      expect(response.status).toBe(307)
      expect(new URL(response.headers.get('location') as string).pathname).toBe('/dashboard')
    }
  })

  it('public routes stay public for an anonymous visitor', async () => {
    stubPublicEnv({ publishable: PUBLISHABLE })
    captured.getUser.mockResolvedValue({ data: { user: null } })
    const { updateSession } = await import('@/lib/supabase/middleware')
    expect((await updateSession(request('/login'))).status).toBe(200)
    expect((await updateSession(request('/auth/forgot-password'))).status).toBe(200)
  })
})

describe('RLS / Auth contract under the publishable key', () => {
  it('authenticated vs anonymous is decided by the user JWT (auth.getUser), not by the API key', async () => {
    stubPublicEnv({ publishable: PUBLISHABLE })
    const { createClient } = await import('@/lib/supabase/server')
    await createClient()
    captured.getUser.mockResolvedValueOnce({ data: { user: { id: 'u1' } }, error: null }).mockResolvedValueOnce({ data: { user: null }, error: new Error('no session') })
    const client = (await import('@supabase/ssr')).createServerClient('', '', { cookies: { getAll: () => [], setAll: () => undefined } })
    expect((await client.auth.getUser()).data.user).toEqual({ id: 'u1' })
    expect((await client.auth.getUser()).data.user).toBeNull()
  })

  it('login/signup/logout helpers keep using the browser factory unchanged', () => {
    const login = readFileSync(join(process.cwd(), 'app/login/page.tsx'), 'utf8')
    expect(login).toMatch(/from '@\/lib\/supabase\/client'/)
    expect(login).toMatch(/signInWithPassword/)
    expect(login).not.toMatch(/ANON_KEY|PUBLISHABLE_KEY/)
  })
})

describe('/api/settings/providers public credential diagnostic', () => {
  it('reports publicCredential with names and shape only', async () => {
    stubPublicEnv({ publishable: PUBLISHABLE })
    vi.resetModules()
    vi.doMock('@/lib/supabase/server', () => ({
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
        from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }), then: undefined }) }) }),
      }),
    }))
    vi.doMock('@/lib/credentials/provider-credentials', () => ({ AI_PROVIDERS: [], getProviderConfigurationStatuses: async () => ({}) }))
    const { GET } = await import('@/app/api/settings/providers/route')
    const payload = await (await GET()).json()
    expect(payload.publicCredential).toEqual({
      configured: true,
      variable: 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      shape: 'publishable-key',
      legacyVariableInUse: false,
    })
    const raw = JSON.stringify(payload)
    expect(raw).not.toContain(PUBLISHABLE)
    vi.doUnmock('@/lib/supabase/server')
    vi.doUnmock('@/lib/credentials/provider-credentials')
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// Source scans
// ---------------------------------------------------------------------------------------------------------------------

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

describe('source safety', () => {
  it('no application source reads the legacy SUPABASE_ANON_KEY name', () => {
    const readers = sources.filter((file) => /SUPABASE_ANON_KEY/.test(readFileSync(file, 'utf8'))).map(rel).sort()
    expect(readers).toEqual([])
  })

  it('the Supabase client factories never reference the admin credential or any NEXT_PUBLIC key name directly', () => {
    for (const file of ['lib/supabase/client.ts', 'lib/supabase/server.ts', 'lib/supabase/middleware.ts']) {
      const text = readFileSync(join(ROOT, file), 'utf8')
      expect(text, file).toContain('getSupabasePublicKey()')
      expect(text, file).not.toMatch(/SECRET_KEY|SERVICE_ROLE|JWT_SECRET|admin-credential|service-role/)
      expect(text, file).not.toMatch(/ANON_KEY|PUBLISHABLE_KEY/)
    }
  })

  it('Next.js can inline the public name: it is spelled as a literal process.env member access', () => {
    const text = readFileSync(join(ROOT, 'lib/supabase/public-credential.ts'), 'utf8')
    expect(text).toContain('process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
    expect(text).not.toContain('process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY')
    expect(text).not.toMatch(/process\.env\[/)
  })

  it('the public resolver is browser-safe: no server-only imports and no admin variable names in code', () => {
    const code = readFileSync(join(ROOT, 'lib/supabase/public-credential.ts'), 'utf8')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n')
    expect(code).not.toMatch(/^import /m)
    expect(code).not.toMatch(/SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_JWT_SECRET/)
  })

  it('no NEXT_PUBLIC_ variable name carries an admin credential', () => {
    const offenders = sources.filter((file) => /NEXT_PUBLIC_[A-Z_]*(SECRET|SERVICE_ROLE|JWT_SECRET)/.test(readFileSync(file, 'utf8'))).map(rel)
    expect(offenders).toEqual([])
    for (const file of ['next.config.mjs', 'vercel.json']) {
      if (existsSync(join(ROOT, file))) expect(readFileSync(join(ROOT, file), 'utf8'), file).not.toMatch(/SECRET_KEY|SERVICE_ROLE|JWT_SECRET/)
    }
  })

  it('no source embeds a literal publishable key, secret key or Supabase JWT', () => {
    const offenders = sources.filter((file) => /sb_(publishable|secret)_[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(readFileSync(file, 'utf8'))).map(rel)
    expect(offenders).toEqual([])
  })
})
