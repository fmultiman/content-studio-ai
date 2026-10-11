import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// FUTURE_059_BYOK_CREDENTIAL_HARDENING_SLICE_1 — security contract of the server-only credential store.
// Dummy keys and in-memory fakes only: no real credential, no database, no provider.

const serviceRoleFactory = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('@/lib/supabase/service-role', () => ({
  createServiceRoleSupabase: serviceRoleFactory.create,
}))

// The shared vitest setup already loaded the real store (and, through it, the real service-role module) before this
// file's mock was registered, so the modules under test are re-imported fresh after `vi.resetModules()`.
type Store = typeof import('../api-credential-store')
type Creds = typeof import('../provider-credentials')
type Execution = typeof import('../provider-execution')
let store: Store
let creds: Creds
let execution: Execution

class CredentialAccessDeniedError {
  static [Symbol.hasInstance](value: unknown) {
    return value instanceof store.CredentialAccessDeniedError
  }
}
class ProviderCredentialUnavailableError {
  static [Symbol.hasInstance](value: unknown) {
    return value instanceof store.ProviderCredentialUnavailableError
  }
}

const KEY_A = 'sk-DUMMY-user-a-0000'
const KEY_B = 'sk-DUMMY-user-b-1111'
const LEAKY_DB_MESSAGE = 'duplicate key value violates constraint sk-DUMMY-LEAK-IN-DB-ERROR'

type Row = Record<string, unknown> & { user_id: string }
type Call = { client: string; op: string; columns?: string; filters: Record<string, unknown>; payload?: unknown }

/** Minimal PostgREST-shaped fake of `user_settings`. `sessionUser` emulates the own-row RLS policy. */
function fakeClient(name: string, rows: Row[], calls: Call[], options: { sessionUser?: string; error?: string; throwOn?: 'select' | 'upsert' | 'update' } = {}) {
  const visible = () => (options.sessionUser ? rows.filter((r) => r.user_id === options.sessionUser) : rows)
  const failure = options.error ? { message: options.error } : null
  return {
    from: vi.fn((table: string) => {
      if (table !== 'user_settings') throw new Error(`unexpected table ${table}`)
      return {
        select: (columns: string) => {
          const filters: Record<string, unknown> = {}
          const builder = {
            eq: (column: string, value: unknown) => {
              filters[column] = value
              return builder
            },
            maybeSingle: async () => {
              calls.push({ client: name, op: 'select', columns, filters: { ...filters } })
              if (options.throwOn === 'select') throw new Error('boom')
              if (failure) return { data: null, error: failure }
              const match = visible().find((r) => Object.entries(filters).every(([k, v]) => r[k] === v))
              if (!match) return { data: null, error: null }
              const projected: Record<string, unknown> = {}
              for (const column of columns.split(',').map((c) => c.trim())) projected[column] = match[column]
              return { data: projected, error: null }
            },
          }
          return builder
        },
        upsert: async (payload: unknown) => {
          calls.push({ client: name, op: 'upsert', filters: {}, payload })
          return { error: failure }
        },
        update: (payload: unknown) => ({
          eq: async (column: string, value: unknown) => {
            calls.push({ client: name, op: 'update', filters: { [column]: value }, payload })
            return { error: failure }
          },
        }),
      }
    }),
  } as unknown as SupabaseClient
}

const BOTH_USERS: Row[] = [
  { user_id: 'user-a', openai_api_key: KEY_A, gemini_api_key: null, nanobanana_api_key: '  ', kling_api_key: 'kling-DUMMY-a', replicate_api_key: null },
  { user_id: 'user-b', openai_api_key: KEY_B, gemini_api_key: 'gemini-DUMMY-b', nanobanana_api_key: null, kling_api_key: null, replicate_api_key: null },
]

let errorLog: ReturnType<typeof vi.spyOn>

beforeEach(async () => {
  vi.resetModules()
  store = await import('../api-credential-store')
  creds = await import('../provider-credentials')
  execution = await import('../provider-execution')
  store.__setCredentialStoreCallerClientHarnessForTests(false)
  store.__setPrivilegedCredentialClientForTests(null)
  serviceRoleFactory.create.mockReset()
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  store.__setPrivilegedCredentialClientForTests(null)
  store.__setCredentialStoreCallerClientHarnessForTests(true)
  vi.restoreAllMocks()
})

function asUser(sessionUser: string, privilegedRows: Row[] = BOTH_USERS, privilegedOptions: Parameters<typeof fakeClient>[3] = {}) {
  const calls: Call[] = []
  const caller = fakeClient('caller', BOTH_USERS, calls, { sessionUser })
  const privileged = fakeClient('privileged', privilegedRows, calls, privilegedOptions)
  store.__setPrivilegedCredentialClientForTests(privileged)
  return { caller, privileged, calls }
}

describe('own-user resolution', () => {
  it('reads the owner credential with the privileged client; the caller client only proves ownership with user_id', async () => {
    const { caller, calls } = asUser('user-a')
    await expect(store.readStoredApiCredential(caller, { userId: 'user-a', provider: 'openai' })).resolves.toEqual({ status: 'configured', secret: KEY_A })

    const callerCalls = calls.filter((c) => c.client === 'caller')
    expect(callerCalls).toEqual([{ client: 'caller', op: 'select', columns: 'user_id', filters: { user_id: 'user-a' } }])
    const privilegedCalls = calls.filter((c) => c.client === 'privileged')
    expect(privilegedCalls).toEqual([{ client: 'privileged', op: 'select', columns: 'openai_api_key', filters: { user_id: 'user-a' } }])
  })

  it.each([
    ['openai', 'openai_api_key'],
    ['gemini', 'gemini_api_key'],
    ['nano_banana', 'nanobanana_api_key'],
    ['kling', 'kling_api_key'],
    ['replicate', 'replicate_api_key'],
  ] as const)('%s reads exactly one explicit column (%s), never a wildcard', async (provider, column) => {
    const { caller, calls } = asUser('user-b')
    await store.readStoredApiCredential(caller, { userId: 'user-b', provider })
    const selects = calls.filter((c) => c.client === 'privileged').map((c) => c.columns)
    expect(selects).toEqual([column])
  })
})

describe('cross-user denial and caller-supplied ids', () => {
  it('a session for user A cannot read user B even when the (untrusted) id says user B', async () => {
    const { caller, calls } = asUser('user-a')
    await expect(store.readStoredApiCredential(caller, { userId: 'user-b', provider: 'openai' })).resolves.toEqual({ status: 'missing' })
    expect(calls.some((c) => c.client === 'privileged')).toBe(false)
    expect(JSON.stringify(calls)).not.toContain(KEY_B)
  })

  it('statuses for a foreign id are all missing and never touch the privileged client', async () => {
    const { caller, calls } = asUser('user-a')
    const statuses = await store.readStoredApiCredentialStatuses(caller, 'user-b')
    expect(Object.values(statuses)).toEqual(['missing', 'missing', 'missing', 'missing', 'missing'])
    expect(calls.some((c) => c.client === 'privileged')).toBe(false)
  })

  it('a caller whose proof returns a different owner row is refused (defence in depth)', async () => {
    const calls: Call[] = []
    const lying = fakeClient('caller', [{ user_id: 'user-b' }], calls)
    // The "caller" ignores the filter and answers with user B's row for a request about user A.
    const mismatching = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { user_id: 'user-b' }, error: null }) }) }) }) } as unknown as SupabaseClient
    void lying
    store.__setPrivilegedCredentialClientForTests(fakeClient('privileged', BOTH_USERS, calls))
    await expect(store.readStoredApiCredential(mismatching, { userId: 'user-a', provider: 'openai' })).rejects.toBeInstanceOf(CredentialAccessDeniedError)
    expect(calls.some((c) => c.client === 'privileged')).toBe(false)
  })

  it('a trusted server caller (service-role client, owner id taken from our own database row) resolves that owner', async () => {
    const calls: Call[] = []
    const serviceCaller = fakeClient('caller', BOTH_USERS, calls) // no session: sees every row, like the service role
    store.__setPrivilegedCredentialClientForTests(fakeClient('privileged', BOTH_USERS, calls))
    await expect(store.readStoredApiCredential(serviceCaller, { userId: 'user-b', provider: 'openai' })).resolves.toEqual({ status: 'configured', secret: KEY_B })
  })

  it.each([[''], ['   '], [' user-a'], ['x'.repeat(200)], [undefined], [null], [42]])('refuses an unacceptable owner id %j before any query', async (userId) => {
    const { caller, calls } = asUser('user-a')
    await expect(store.readStoredApiCredential(caller, { userId: userId as string, provider: 'openai' })).rejects.toBeInstanceOf(CredentialAccessDeniedError)
    await expect(store.readStoredApiCredentialStatuses(caller, userId as string)).rejects.toBeInstanceOf(CredentialAccessDeniedError)
    await expect(store.writeStoredApiCredential(caller, { userId: userId as string, provider: 'openai', secret: KEY_A })).rejects.toBeInstanceOf(CredentialAccessDeniedError)
    await expect(store.removeStoredApiCredential(caller, { userId: userId as string, provider: 'openai' })).rejects.toBeInstanceOf(CredentialAccessDeniedError)
    expect(calls).toEqual([])
  })

  it.each([['__proto__'], ['constructor'], ['toString'], ['unknown'], ['']])('refuses the provider %j (no column lookup through the prototype)', async (provider) => {
    const { caller, calls } = asUser('user-a')
    await expect(store.readStoredApiCredential(caller, { userId: 'user-a', provider: provider as never })).rejects.toBeInstanceOf(CredentialAccessDeniedError)
    expect(calls).toEqual([])
  })
})

describe('missing credentials', () => {
  it('no settings row, null, empty and whitespace values are all "missing"', async () => {
    const rows: Row[] = [
      { user_id: 'user-c', openai_api_key: null, gemini_api_key: '', nanobanana_api_key: '   ', kling_api_key: null, replicate_api_key: null },
    ]
    const calls: Call[] = []
    const caller = fakeClient('caller', rows, calls, { sessionUser: 'user-c' })
    store.__setPrivilegedCredentialClientForTests(fakeClient('privileged', rows, calls))
    for (const provider of ['openai', 'gemini', 'nano_banana', 'kling', 'replicate'] as const) {
      await expect(store.readStoredApiCredential(caller, { userId: 'user-c', provider })).resolves.toEqual({ status: 'missing' })
    }

    const empty = fakeClient('caller', [], calls, { sessionUser: 'user-d' })
    await expect(store.readStoredApiCredential(empty, { userId: 'user-d', provider: 'openai' })).resolves.toEqual({ status: 'missing' })
  })

  it('statuses report configured / missing per provider', async () => {
    const { caller } = asUser('user-a')
    await expect(store.readStoredApiCredentialStatuses(caller, 'user-a')).resolves.toEqual({
      openai: 'configured',
      gemini: 'missing',
      nano_banana: 'missing',
      kling: 'configured',
      replicate: 'missing',
    })
  })

  it('a platform env credential is never used when the user has none', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'platform-DUMMY')
    try {
      const { caller } = asUser('user-c', [{ user_id: 'user-c' }])
      await expect(creds.resolveProviderCredential(caller, { userId: 'user-c', provider: 'openai' })).resolves.toEqual({ status: 'missing' })
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

describe('read failures are never reported as missing', () => {
  it('a privileged read error throws ProviderCredentialUnavailableError(store_failure)', async () => {
    const { caller } = asUser('user-a', BOTH_USERS, { error: LEAKY_DB_MESSAGE })
    await expect(store.readStoredApiCredential(caller, { userId: 'user-a', provider: 'openai' })).rejects.toMatchObject({
      name: 'ProviderCredentialUnavailableError',
      code: 'PROVIDER_CREDENTIAL_UNAVAILABLE',
      status: 503,
      reason: 'store_failure',
      provider: 'openai',
    })
  })

  it('an ownership-proof read error throws as well (and the privileged client is not used)', async () => {
    const calls: Call[] = []
    const caller = fakeClient('caller', BOTH_USERS, calls, { sessionUser: 'user-a', error: LEAKY_DB_MESSAGE })
    store.__setPrivilegedCredentialClientForTests(fakeClient('privileged', BOTH_USERS, calls))
    await expect(store.readStoredApiCredential(caller, { userId: 'user-a', provider: 'openai' })).rejects.toBeInstanceOf(ProviderCredentialUnavailableError)
    expect(calls.some((c) => c.client === 'privileged')).toBe(false)
  })

  it('a privileged client that cannot be created (not configured / not permitted locally) fails closed', async () => {
    serviceRoleFactory.create.mockImplementation(() => {
      throw new Error('SERVICE_ROLE_NOT_CONFIGURED sk-DUMMY-LEAK-IN-FACTORY')
    })
    const caller = fakeClient('caller', BOTH_USERS, [], { sessionUser: 'user-a' })
    const failure = await store.readStoredApiCredential(caller, { userId: 'user-a', provider: 'openai' }).catch((e) => e)
    expect(failure).toBeInstanceOf(ProviderCredentialUnavailableError)
    expect(failure.reason).toBe('store_client_unavailable')
    expect(failure.message).not.toContain('sk-DUMMY')
    expect(serviceRoleFactory.create).toHaveBeenCalled()
  })

  it('statuses become "unavailable" for every provider on a store failure (not "missing")', async () => {
    const { caller } = asUser('user-a', BOTH_USERS, { error: LEAKY_DB_MESSAGE })
    const statuses = await store.readStoredApiCredentialStatuses(caller, 'user-a')
    expect(Object.values(statuses)).toEqual(['unavailable', 'unavailable', 'unavailable', 'unavailable', 'unavailable'])
    expect(await creds.getProviderConfigurationStatuses(caller, 'user-a')).toEqual(statuses)
  })

  it('getProviderConfigurationState keeps its "unavailable" contract and never throws for an unreadable store', async () => {
    const { caller } = asUser('user-a', BOTH_USERS, { error: LEAKY_DB_MESSAGE })
    await expect(creds.getProviderConfigurationState(caller, { userId: 'user-a', provider: 'kling' })).resolves.toBe('unavailable')
    const ok = asUser('user-a')
    await expect(creds.getProviderConfigurationState(ok.caller, { userId: 'user-a', provider: 'kling' })).resolves.toBe('configured')
    await expect(creds.getProviderConfigurationState(ok.caller, { userId: 'user-a', provider: 'gemini' })).resolves.toBe('missing')
  })

  it('resolveProviderExecution surfaces the failure; it is not provider_not_configured and never becomes a platform key', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'platform-DUMMY')
    try {
      const { caller } = asUser('user-a', BOTH_USERS, { error: LEAKY_DB_MESSAGE })
      await expect(execution.resolveProviderExecution(caller, { userId: 'user-a', provider: 'openai' })).rejects.toBeInstanceOf(ProviderCredentialUnavailableError)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('resolveProviderExecution still returns ready for a readable credential and provider_not_configured for a missing one', async () => {
    const { caller } = asUser('user-a')
    await expect(execution.resolveProviderExecution(caller, { userId: 'user-a', provider: 'openai' })).resolves.toMatchObject({ status: 'ready', secret: KEY_A, credentialSource: 'user' })
    await expect(execution.resolveProviderExecution(caller, { userId: 'user-a', provider: 'gemini' })).resolves.toMatchObject({ status: 'provider_not_configured', code: 'PROVIDER_NOT_CONFIGURED' })
  })
})

describe('malformed stored configuration', () => {
  const malformedRows: Row[] = [{ user_id: 'user-m', openai_api_key: 12345, gemini_api_key: { nested: true }, nanobanana_api_key: null, kling_api_key: 'kling-DUMMY-m', replicate_api_key: null }]

  it('a non-string stored value throws reason "malformed" and is not treated as a credential', async () => {
    const calls: Call[] = []
    const caller = fakeClient('caller', malformedRows, calls, { sessionUser: 'user-m' })
    store.__setPrivilegedCredentialClientForTests(fakeClient('privileged', malformedRows, calls))
    await expect(store.readStoredApiCredential(caller, { userId: 'user-m', provider: 'openai' })).rejects.toMatchObject({ reason: 'malformed', provider: 'openai' })
    await expect(store.readStoredApiCredential(caller, { userId: 'user-m', provider: 'gemini' })).rejects.toMatchObject({ reason: 'malformed' })
  })

  it('statuses mark only the malformed providers unavailable', async () => {
    const calls: Call[] = []
    const caller = fakeClient('caller', malformedRows, calls, { sessionUser: 'user-m' })
    store.__setPrivilegedCredentialClientForTests(fakeClient('privileged', malformedRows, calls))
    await expect(store.readStoredApiCredentialStatuses(caller, 'user-m')).resolves.toEqual({
      openai: 'unavailable',
      gemini: 'unavailable',
      nano_banana: 'missing',
      kling: 'configured',
      replicate: 'missing',
    })
  })
})

describe('no secret in logs, errors or serialized failures', () => {
  it('failures carry a static message and a reason only', async () => {
    const { caller } = asUser('user-a', BOTH_USERS, { error: LEAKY_DB_MESSAGE })
    const failure = await store.readStoredApiCredential(caller, { userId: 'user-a', provider: 'openai' }).catch((e) => e)
    const serialized = JSON.stringify({ message: failure.message, name: failure.name, reason: failure.reason, code: failure.code, provider: failure.provider, stack: failure.stack })
    expect(serialized).not.toContain('sk-DUMMY')
    expect(serialized).not.toContain(KEY_A)
    expect('cause' in failure).toBe(false)
  })

  it('logs are code-only lines and contain no key, database message or user id', async () => {
    const { caller } = asUser('user-a', BOTH_USERS, { error: LEAKY_DB_MESSAGE })
    await store.readStoredApiCredential(caller, { userId: 'user-a', provider: 'openai' }).catch(() => {})
    await store.readStoredApiCredentialStatuses(caller, 'user-a')
    await store.writeStoredApiCredential(caller, { userId: 'user-a', provider: 'openai', secret: KEY_A }).catch(() => {})
    await store.removeStoredApiCredential(caller, { userId: 'user-a', provider: 'openai' }).catch(() => {})

    const logged = JSON.stringify(errorLog.mock.calls)
    expect(errorLog).toHaveBeenCalled()
    expect(logged).toContain('[credential-store]')
    for (const forbidden of ['sk-DUMMY', KEY_A, KEY_B, LEAKY_DB_MESSAGE, 'user-a', 'duplicate key']) expect(logged).not.toContain(forbidden)
  })

  it('successful reads and writes log nothing', async () => {
    const { caller } = asUser('user-a')
    await store.readStoredApiCredential(caller, { userId: 'user-a', provider: 'openai' })
    await store.writeStoredApiCredential(caller, { userId: 'user-a', provider: 'openai', secret: KEY_A })
    await store.removeStoredApiCredential(caller, { userId: 'user-a', provider: 'openai' })
    expect(errorLog).not.toHaveBeenCalled()
  })
})

describe('writes and removal', () => {
  it('save upserts only the owner row and the one column through the privileged client (never the caller)', async () => {
    const { caller, calls } = asUser('user-a')
    await store.writeStoredApiCredential(caller, { userId: 'user-a', provider: 'gemini', secret: 'gemini-DUMMY-new' })
    expect(calls).toEqual([{ client: 'privileged', op: 'upsert', filters: {}, payload: { user_id: 'user-a', gemini_api_key: 'gemini-DUMMY-new' } }])
  })

  it('the NanoBanana base URL rides in the same atomic upsert; other providers ignore it', async () => {
    const { caller, calls } = asUser('user-a')
    await store.writeStoredApiCredential(caller, { userId: 'user-a', provider: 'nano_banana', secret: 'nb-DUMMY', nanobananaBaseUrl: 'https://nb.example.test' })
    await store.writeStoredApiCredential(caller, { userId: 'user-a', provider: 'openai', secret: KEY_A, nanobananaBaseUrl: 'https://ignored.example.test' })
    expect(calls.map((c) => c.payload)).toEqual([
      { user_id: 'user-a', nanobanana_api_key: 'nb-DUMMY', nanobanana_base_url: 'https://nb.example.test' },
      { user_id: 'user-a', openai_api_key: KEY_A },
    ])
  })

  it('an empty secret is refused before any write', async () => {
    const { caller, calls } = asUser('user-a')
    await expect(store.writeStoredApiCredential(caller, { userId: 'user-a', provider: 'openai', secret: '   ' })).rejects.toBeInstanceOf(CredentialAccessDeniedError)
    expect(calls).toEqual([])
  })

  it('remove nulls exactly one column of the owner row', async () => {
    const { caller, calls } = asUser('user-a')
    await store.removeStoredApiCredential(caller, { userId: 'user-a', provider: 'kling' })
    expect(calls).toEqual([{ client: 'privileged', op: 'update', filters: { user_id: 'user-a' }, payload: { kling_api_key: null } }])
  })

  it('a failed save or removal throws unavailable and never reports success', async () => {
    const { caller } = asUser('user-a', BOTH_USERS, { error: LEAKY_DB_MESSAGE })
    await expect(store.writeStoredApiCredential(caller, { userId: 'user-a', provider: 'openai', secret: KEY_A })).rejects.toMatchObject({ reason: 'store_failure' })
    await expect(store.removeStoredApiCredential(caller, { userId: 'user-a', provider: 'openai' })).rejects.toMatchObject({ reason: 'store_failure' })
  })

  it('writes need the privileged client: without it they fail closed instead of using the browser-session client', async () => {
    serviceRoleFactory.create.mockImplementation(() => {
      throw new Error('not configured')
    })
    const calls: Call[] = []
    const caller = fakeClient('caller', BOTH_USERS, calls, { sessionUser: 'user-a' })
    await expect(store.writeStoredApiCredential(caller, { userId: 'user-a', provider: 'openai', secret: KEY_A })).rejects.toMatchObject({ reason: 'store_client_unavailable' })
    expect(calls).toEqual([])
  })
})

describe('test seams cannot loosen a deployed runtime', () => {
  it('the harness and override setters refuse to run outside vitest', () => {
    vi.stubEnv('VITEST', '')
    try {
      expect(() => store.__setCredentialStoreCallerClientHarnessForTests(true)).toThrow(/vitest only/)
      expect(() => store.__setPrivilegedCredentialClientForTests(null)).toThrow(/vitest only/)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('with the harness off and no override, the real service-role factory is what the store asks for', async () => {
    serviceRoleFactory.create.mockReturnValue(fakeClient('service-role', BOTH_USERS, []))
    const caller = fakeClient('caller', BOTH_USERS, [], { sessionUser: 'user-a' })
    await expect(store.readStoredApiCredential(caller, { userId: 'user-a', provider: 'openai' })).resolves.toEqual({ status: 'configured', secret: KEY_A })
    expect(serviceRoleFactory.create).toHaveBeenCalledTimes(1)
  })
})
