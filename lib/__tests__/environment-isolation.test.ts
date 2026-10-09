import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { assertServiceRolePermitted, ServiceRoleNotPermittedError, LOCAL_SERVICE_ROLE_PROJECT_REF_ENV, supabaseProjectRef } from '@/lib/supabase/service-role'

// FUTURE-050 — data-plane safety nets that do not need a database: the local service-role gate, the admin-script
// guard, the "no embedded admin credential" scan, and the Settings diagnostic.

const REF = 'abcdefghijklmnopqrst'
const URL_ = `https://${REF}.supabase.co`
const LOCAL = { NODE_ENV: 'development', NEXT_PUBLIC_SUPABASE_URL: URL_ }
const PRODUCTION = { NODE_ENV: 'production', VERCEL_ENV: 'production', VERCEL_TARGET_ENV: 'production', VERCEL_URL: 'x.vercel.app', NEXT_PUBLIC_SUPABASE_URL: URL_ }
const PREVIEW = { NODE_ENV: 'production', VERCEL_ENV: 'preview', VERCEL_URL: 'x.vercel.app', NEXT_PUBLIC_SUPABASE_URL: URL_ }

describe('local runtime service-role gate', () => {
  it('a plain local runtime does not silently inherit service-role authority', () => {
    expect(() => assertServiceRolePermitted(LOCAL)).toThrow(ServiceRoleNotPermittedError)
  })

  it('a local runtime must name exactly the project it administers', () => {
    expect(() => assertServiceRolePermitted({ ...LOCAL, [LOCAL_SERVICE_ROLE_PROJECT_REF_ENV]: REF })).not.toThrow()
    expect(() => assertServiceRolePermitted({ ...LOCAL, [LOCAL_SERVICE_ROLE_PROJECT_REF_ENV]: 'zzzzzzzzzzzzzzzzzzzz' })).toThrow(ServiceRoleNotPermittedError)
    expect(() => assertServiceRolePermitted({ ...LOCAL, [LOCAL_SERVICE_ROLE_PROJECT_REF_ENV]: '1' })).toThrow(ServiceRoleNotPermittedError)
  })

  it('Production and Preview servers are not affected (Preview must keep working for validation)', () => {
    expect(() => assertServiceRolePermitted(PRODUCTION)).not.toThrow()
    expect(() => assertServiceRolePermitted(PREVIEW)).not.toThrow()
  })

  it('parses the project ref from a Supabase URL only', () => {
    expect(supabaseProjectRef(URL_)).toBe(REF)
    expect(supabaseProjectRef('https://example.com')).toBeNull()
    expect(supabaseProjectRef(undefined)).toBeNull()
  })
})

const guard = createRequire(import.meta.url)('../../scripts/lib/production-admin-guard.cjs') as {
  projectRefFrom(target: string | undefined): string | null
  requireAdminAck(options: { script: string; target: string | undefined; argv?: string[]; exit?: (code: number) => never; log?: (line: string) => void }): string
}

describe('admin script guard', () => {
  const refuse = () => { throw new Error('EXIT') }

  it('derives the project ref from API URLs, direct DB hosts and pooler users', () => {
    expect(guard.projectRefFrom(URL_)).toBe(REF)
    expect(guard.projectRefFrom(`postgres://postgres:pw@db.${REF}.supabase.co:5432/postgres`)).toBe(REF)
    expect(guard.projectRefFrom(`postgres://postgres.${REF}:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres`)).toBe(REF)
    expect(guard.projectRefFrom('http://localhost:54321')).toBeNull()
    expect(guard.projectRefFrom(undefined)).toBeNull()
  })

  it('refuses without the flag, with a wrong ref, with an unknown target — before anything else can run', () => {
    const exit = vi.fn(refuse) as unknown as (code: number) => never
    const log = vi.fn()
    expect(() => guard.requireAdminAck({ script: 's', target: URL_, argv: ['node', 's'], exit, log })).toThrow('EXIT')
    expect(() => guard.requireAdminAck({ script: 's', target: URL_, argv: ['node', 's', '--admin-project-ref=zzzzzzzzzzzzzzzzzzzz'], exit, log })).toThrow('EXIT')
    expect(() => guard.requireAdminAck({ script: 's', target: 'http://localhost:54321', argv: ['node', 's', `--admin-project-ref=${REF}`], exit, log })).toThrow('EXIT')
    expect(exit).toHaveBeenCalledWith(2)
    expect(log.mock.calls.flat().join('\n')).not.toMatch(/eyJ|service_role|KEY/i)
  })

  it('proceeds only when the typed ref equals the target ref', () => {
    const exit = vi.fn(refuse) as unknown as (code: number) => never
    expect(guard.requireAdminAck({ script: 's', target: URL_, argv: ['node', 's', `--admin-project-ref=${REF}`], exit })).toBe(REF)
    expect(exit).not.toHaveBeenCalled()
  })

  it('an environment variable cannot satisfy the guard (no stale-shell authorisation)', () => {
    vi.stubEnv('ADMIN_PROJECT_REF', REF)
    vi.stubEnv('CONTENT_STUDIO_PRODUCTION_ADMIN', '1')
    const exit = vi.fn(refuse) as unknown as (code: number) => never
    expect(() => guard.requireAdminAck({ script: 's', target: URL_, argv: ['node', 's'], exit, log: () => undefined })).toThrow('EXIT')
    vi.unstubAllEnvs()
  })
})

describe('every script that uses admin authority is guarded', () => {
  const SCRIPTS = join(process.cwd(), 'scripts')
  const usesAdmin = /SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|SERVICE_ROLE_KEY|POSTGRES_URL/
  const scripts = readdirSync(SCRIPTS).filter((name) => /\.(mjs|cjs|js)$/.test(name))

  it.each(scripts)('%s requires --admin-project-ref before using admin credentials', (name) => {
    const text = readFileSync(join(SCRIPTS, name), 'utf8')
    if (!usesAdmin.test(text)) return
    expect(text).toContain('requireAdminAck')
  })
})

describe('root-level operator scripts that use admin authority are guarded too (FUTURE-052)', () => {
  const rootScripts = readdirSync(process.cwd()).filter((name) => /\.(mjs|cjs)$/.test(name))

  it.each(rootScripts)('%s requires --admin-project-ref before using admin credentials', (name) => {
    const text = readFileSync(join(process.cwd(), name), 'utf8')
    if (!/SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|SERVICE_ROLE_KEY|POSTGRES_URL/.test(text)) return
    expect(text).toContain('requireAdminAck')
  })
})

describe('no embedded admin credential in tracked source', () => {
  const SKIP = new Set(['node_modules', '.next', '.git', '__tests__'])
  const ROOTS = ['scripts', 'lib', 'app', 'components', 'hooks', 'infra', 'remotion', 'docs']
  const JWT = /eyJ[A-Za-z0-9_-]{10,}\.([A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g

  function* files(dir: string): Generator<string> {
    for (const name of readdirSync(dir)) {
      if (SKIP.has(name)) continue
      const full = join(dir, name)
      if (statSync(full).isDirectory()) yield* files(full)
      else if (/\.(ts|tsx|js|mjs|cjs|json|md|sql|yml|yaml|env)$/.test(name)) yield full
    }
  }

  it('no JWT literal carries the service_role claim', () => {
    const offenders: string[] = []
    for (const root of ROOTS) {
      let dir: string
      try { dir = join(process.cwd(), root); statSync(dir) } catch { continue }
      for (const file of files(dir)) {
        const text = readFileSync(file, 'utf8')
        for (const match of text.matchAll(JWT)) {
          try {
            const claims = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8')) as { role?: string }
            if (claims.role === 'service_role') offenders.push(relative(process.cwd(), file))
          } catch { /* not a JWT payload */ }
        }
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('Settings diagnostic', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('/api/settings/providers reports the policy class and allowed/blocked — and nothing secret', async () => {
    vi.resetModules()
    vi.doMock('@/lib/supabase/server', () => ({
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: { id: 'u' } }, error: null }) },
        from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
      }),
    }))
    vi.doMock('@/lib/credentials/provider-credentials', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@/lib/credentials/provider-credentials')>()),
      getProviderConfigurationStatuses: async () => ({ openai: 'configured', kling: 'missing', nano_banana: 'missing', gemini: 'configured' }),
    }))
    const { GET } = await import('@/app/api/settings/providers/route')
    const body = await (await GET()).json()
    expect(body.executionPolicy).toEqual({ environment: 'test', paidExecution: 'allowed' }) // vitest harness: mocked providers
    expect(JSON.stringify(body.executionPolicy)).not.toMatch(/VERCEL|KEY|http/i)
    vi.doUnmock('@/lib/supabase/server')
    vi.doUnmock('@/lib/credentials/provider-credentials')
  })
})
