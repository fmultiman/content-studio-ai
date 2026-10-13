import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeKlingMcpVideoCapabilities } from '@/lib/provider-connections/kling-mcp-video-capabilities'
import type { ProviderConnectionRow } from '@/lib/provider-connections/types'
import { createFakeDb } from './helpers/fake-db'
import { whoAmIFixture } from './helpers/kling-who-am-i-fixture'
import {
  CAPABILITY_FRESH_MS,
  CAPABILITY_MAX_AGE_MS,
  describeMcpConnection,
  describeRestConnection,
  listVideoGenerationConnections,
  resolveGenerationConnection,
  serverOperationsFor,
} from '@/lib/video-generation/connections'
import { accountConnectionRef, GEMINI_CONNECTION_REF, parseConnectionRef, REST_CONNECTION_REF } from '@/lib/video-generation/connection-ref'
import { defaultAspectRatio, defaultDuration, defaultResolution, findModel, findOperation, type VideoModelCapability } from '@/lib/video-generation/capabilities'
import { restVideoOperations } from '@/lib/video-generation/rest-capabilities'

const NOW = new Date('2026-09-29T12:00:00.000Z')
const CONNECTION_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ID = '22222222-2222-4222-8222-222222222222'

const iso = (msAgo: number) => new Date(NOW.getTime() - msAgo).toISOString()

function mcpRow(overrides: Partial<ProviderConnectionRow> = {}): ProviderConnectionRow {
  return {
    id: CONNECTION_ID,
    user_id: 'user-a',
    provider: 'kling',
    connection_method: 'mcp_oauth',
    status: 'connected',
    scopes: ['generation.read', 'account.credit.read'],
    external_account_id: '424242',
    capabilities: {
      membership: { type: 'SVIP', label: 'Pro' },
      video: normalizeKlingMcpVideoCapabilities(whoAmIFixture()),
    },
    last_checked_at: iso(60_000),
    last_error_code: null,
    created_at: iso(1e9),
    updated_at: iso(1e9),
    ...overrides,
  }
}

const withGeneration = (overrides: Partial<ProviderConnectionRow> = {}) =>
  mcpRow({ scopes: ['generation.read', 'account.credit.read', 'generation.create'], ...overrides })

describe('REST connection descriptor (code-backed)', () => {
  it('describes Kling API with the capabilities the executing adapter actually supports', () => {
    const rest = describeRestConnection('configured')

    expect(rest).toMatchObject({
      ref: REST_CONNECTION_REF,
      label: 'Kling API',
      transport: 'rest',
      connectionMethod: 'api_key',
      funding: 'kling_api_package',
      status: 'connected',
      canGenerate: true,
      capabilitiesFreshness: 'static',
      needsGenerationAuthorization: false,
    })
    expect(rest.operations.map((entry) => entry.operation).sort()).toEqual(['image_to_video', 'text_to_video'])

    const t2v = findModel(rest.operations, 'text_to_video', 'kling-v3')!
    expect(t2v).toMatchObject({ durations: [5, 10], resolutions: ['720p', '1080p'], aspectRatios: ['16:9', '9:16', '1:1'], audio: true, multiShot: true })
    // REST never advertises what it has not productized: no 4K, no extra durations, only supported models.
    expect(findOperation(rest.operations, 'text_to_video')!.models).toHaveLength(2)
    expect(JSON.stringify(rest)).not.toMatch(/4k/i)
  })

  it('declares truthful, model-specific REST capability contracts for Kling 3.0 and Kling 2.6', () => {
    const ops = restVideoOperations()
    const t2v30 = findModel(ops, 'text_to_video', 'kling-v3')!
    const i2v30 = findModel(ops, 'image_to_video', 'kling-v3')!
    const t2v26 = findModel(ops, 'text_to_video', 'kling-v2-6')!
    const i2v26 = findModel(ops, 'image_to_video', 'kling-v2-6')!

    // 1. Every model/operation has capabilities
    expect(t2v30).toBeDefined()
    expect(i2v30).toBeDefined()
    expect(t2v26).toBeDefined()
    expect(i2v26).toBeDefined()

    // 2. Defaults belong to allowed values
    for (const model of [t2v30, i2v30, t2v26, i2v26]) {
      expect(model.durations).toContain(defaultDuration(model))
      expect(model.resolutions).toContain(defaultResolution(model))
      if (model.aspectRatios.length > 0) {
        expect(model.aspectRatios).toContain(defaultAspectRatio(model)!)
      } else {
        expect(defaultAspectRatio(model)).toBeNull()
      }
    }

    // 3. Unsupported capabilities are distinguishable (multiShot: true vs false)
    expect(t2v30.multiShot).toBe(true)
    expect(t2v26.multiShot).toBe(false)
    expect(i2v30.multiShot).toBe(true)
    expect(i2v26.multiShot).toBe(false)

    // 4. No duplicate entries in operations
    for (const op of ops) {
      const ids = op.models.map((m) => m.id)
      expect(new Set(ids).size).toBe(ids.length)
    }

    // 5. Kling 3.0 contract
    expect(t2v30).toMatchObject({
      id: 'kling-v3',
      label: 'Kling 3.0',
      durations: [5, 10],
      resolutions: ['720p', '1080p'],
      aspectRatios: ['16:9', '9:16', '1:1'],
      audio: true,
      multiShot: true,
    })

    // 6. Kling 2.6 contract (no multiShot, audio requires 1080p on I2V)
    expect(t2v26).toMatchObject({
      id: 'kling-v2-6',
      label: 'Kling 2.6',
      durations: [5, 10],
      resolutions: ['720p', '1080p'],
      aspectRatios: ['16:9', '9:16', '1:1'],
      audio: true,
      multiShot: false,
    })
    expect(i2v26).toMatchObject({
      id: 'kling-v2-6',
      label: 'Kling 2.6',
      durations: [5, 10],
      resolutions: ['720p', '1080p'],
      aspectRatios: [],
      audio: true,
      multiShot: false,
      audioRequiresResolution: '1080p',
    })
  })

  it('image_to_video has no aspect-ratio control', () => {
    expect(findModel(restVideoOperations(), 'image_to_video', 'kling-v3')!.aspectRatios).toEqual([])
  })

  it('an unconfigured Kling API is listed as unavailable (never as "no models"), with no operations', () => {
    const rest = describeRestConnection('missing')
    expect(rest).toMatchObject({ status: 'not_configured', canGenerate: false, blockedReason: 'not_configured', operations: [] })
  })
})

describe('MCP capability normalization (who_am_i -> bounded contract)', () => {
  const snapshot = normalizeKlingMcpVideoCapabilities(whoAmIFixture())
  const model = (operation: 'text_to_video' | 'image_to_video', id: string): VideoModelCapability =>
    findModel(snapshot.operations, operation, id)!

  it('exposes exactly the two product operations', () => {
    expect(snapshot.operations.map((entry) => entry.operation).sort()).toEqual(['image_to_video', 'text_to_video'])
  })

  it('derives the model list from the account, not from a hardcoded count', () => {
    expect(findOperation(snapshot.operations, 'text_to_video')!.models.map((entry) => entry.id)).toEqual([
      'kling-video-v2_5',
      'kling-video-v2_6',
      'kling-video-o1',
      'kling-video-v3_0_omni',
      'kling-video-v3_0',
      'kling-video-v3_0_turbo',
    ])

    // A different account exposing a subset yields a different list.
    const other = whoAmIFixture() as any
    other.availableModels.text_to_video.models = other.availableModels.text_to_video.models.slice(0, 2)
    const normalized = normalizeKlingMcpVideoCapabilities(other)
    expect(findOperation(normalized.operations, 'text_to_video')!.models).toHaveLength(2)
  })

  it('model-specific durations (enum values, ascending)', () => {
    expect(model('text_to_video', 'kling-video-v2_5').durations).toEqual([5, 10])
    expect(model('text_to_video', 'kling-video-o1').durations).toEqual([3, 4, 5, 6, 7, 8, 9, 10])
    expect(model('text_to_video', 'kling-video-v3_0').durations).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
  })

  it('model-specific resolutions (4k only where the model offers it)', () => {
    expect(model('text_to_video', 'kling-video-v3_0').resolutions).toEqual(['720p', '1080p', '4k'])
    expect(model('text_to_video', 'kling-video-v3_0_turbo').resolutions).toEqual(['720p', '1080p'])
    expect(model('text_to_video', 'kling-video-v2_5').resolutions).toEqual(['720p', '1080p'])
  })

  it('aspect ratio is present for text_to_video and ABSENT for image_to_video', () => {
    expect(model('text_to_video', 'kling-video-v3_0').aspectRatios).toEqual(['16:9', '9:16', '1:1'])
    expect(model('image_to_video', 'kling-video-v3_0').aspectRatios).toEqual([])
  })

  it('audio and multi-shot are present only on the models that declare them', () => {
    expect(model('text_to_video', 'kling-video-v3_0')).toMatchObject({ audio: true, multiShot: true })
    expect(model('text_to_video', 'kling-video-v3_0_omni')).toMatchObject({ audio: true, multiShot: true })
    expect(model('text_to_video', 'kling-video-v2_6')).toMatchObject({ audio: true, multiShot: false })
    expect(model('text_to_video', 'kling-video-v3_0_turbo')).toMatchObject({ audio: false, multiShot: false })
    expect(model('text_to_video', 'kling-video-o1')).toMatchObject({ audio: false, multiShot: false })
  })

  it('image_to_video exposes only single-source models (multi-reference omni/o1 are excluded)', () => {
    expect(findOperation(snapshot.operations, 'image_to_video')!.models.map((entry) => entry.id)).toEqual([
      'kling-video-v2_5',
      'kling-video-v2_6',
      'kling-video-v3_0',
      'kling-video-v3_0_turbo',
    ])
  })

  it('records the provider-documented "audio only at 1080p" constraint for Kling 2.6 image-to-video', () => {
    expect(model('image_to_video', 'kling-video-v2_6').audioRequiresResolution).toBe('1080p')
    expect(model('text_to_video', 'kling-video-v2_6').audioRequiresResolution).toBeUndefined()
  })

  it('ignores unsupported/unproductized provider arguments (asr, audio/music prompts, elements, tail image)', () => {
    const serialized = JSON.stringify(snapshot)
    for (const ignored of ['enable_asmr', 'audio_prompt', 'music_prompt', 'elements', 'tail_image', 'first_image', 'image_1']) {
      expect(serialized).not.toContain(ignored)
    }
  })

  it('records that the output-count argument exists (it is always pinned to 1 by the mapper), never its 1-4 range', () => {
    expect(model('text_to_video', 'kling-video-v3_0').outputCountArg).toBe(true)
    expect(JSON.stringify(snapshot)).not.toMatch(/"4"|maxImages|imageCount/)
  })

  it('never carries the raw provider schema, defaults, descriptions or the account id', () => {
    const serialized = JSON.stringify(snapshot)
    expect(serialized).not.toContain('424242')
    expect(serialized).not.toContain('allowedValues')
    expect(serialized).not.toContain('description')
    expect(serialized).not.toContain('default')
  })

  it('drops models that need an argument/input Content Studio does not supply, and unsafe or duplicate ids', () => {
    const odd = {
      availableModels: {
        text_to_video: {
          models: [
            { model: 'needs-style', arguments: [{ name: 'prompt', required: true }, { name: 'style', required: true }, { name: 'duration', allowedValues: ['5'] }, { name: 'resolution', allowedValues: ['720p'] }] },
            { model: 'Bad Id!', arguments: [{ name: 'prompt', required: true }, { name: 'duration', allowedValues: ['5'] }, { name: 'resolution', allowedValues: ['720p'] }] },
            { model: 'no-duration', arguments: [{ name: 'prompt', required: true }, { name: 'resolution', allowedValues: ['720p'] }] },
            { model: 'ok', arguments: [{ name: 'prompt', required: true }, { name: 'duration', allowedValues: ['5', '5', 'x', '9999'] }, { name: 'resolution', allowedValues: ['8k', '720p'] }] },
            { model: 'ok', arguments: [{ name: 'prompt', required: true }, { name: 'duration', allowedValues: ['7'] }, { name: 'resolution', allowedValues: ['720p'] }] },
          ],
        },
      },
    }
    const normalized = normalizeKlingMcpVideoCapabilities(odd)
    const models = findOperation(normalized.operations, 'text_to_video')!.models
    expect(models).toHaveLength(1)
    expect(models[0]).toMatchObject({ id: 'ok', durations: [5], resolutions: ['720p'] })
  })

  it('tolerates malformed input (no throw, empty operations)', () => {
    for (const input of [{}, { availableModels: null }, { availableModels: { text_to_video: { models: 'nope' } } }, { availableModels: { text_to_video: { models: [null, 3, 'x'] } } }]) {
      const normalized = normalizeKlingMcpVideoCapabilities(input as Record<string, unknown>)
      expect(normalized.operations.every((entry) => entry.models.length === 0)).toBe(true)
    }
  })
})

describe('MCP connection descriptor', () => {
  it('a read-only connection can be explored but not used: models are listed, generation is blocked with a specific reason', () => {
    const descriptor = describeMcpConnection(mcpRow(), NOW)

    expect(descriptor).toMatchObject({
      ref: accountConnectionRef(CONNECTION_ID),
      label: 'Minha conta Kling',
      accountLabel: 'Pro',
      transport: 'mcp',
      connectionMethod: 'mcp_oauth',
      funding: 'kling_web_credits',
      status: 'connected',
      canGenerate: false,
      blockedReason: 'generation_authorization_required',
      needsGenerationAuthorization: true,
      capabilitiesFreshness: 'fresh',
    })
    expect(findOperation(descriptor.operations, 'text_to_video')!.models.length).toBeGreaterThan(0)
  })

  it('a generation-authorized connection with fresh capabilities can generate', () => {
    const descriptor = describeMcpConnection(withGeneration(), NOW)
    expect(descriptor).toMatchObject({ canGenerate: true, needsGenerationAuthorization: false })
    expect(descriptor.blockedReason).toBeUndefined()
  })

  it('never exposes server-side mapping hints or the account identifier to the browser', () => {
    const serialized = JSON.stringify(describeMcpConnection(withGeneration(), NOW))
    expect(serialized).not.toContain('outputCountArg')
    expect(serialized).not.toContain('424242')
    expect(serialized).not.toMatch(/token|secret|ciphertext/i)
  })

  it('a snapshot from before the video capability version is "missing": refresh required, no operations invented', () => {
    const descriptor = describeMcpConnection(
      withGeneration({ capabilities: { models: { text_to_video: ['kling-video-v3_0'] }, membership: { label: 'Pro' } } }),
      NOW,
    )
    expect(descriptor).toMatchObject({ canGenerate: false, blockedReason: 'capabilities_missing', capabilitiesFreshness: 'missing', operations: [] })
  })

  it('never checked (last_checked_at null) is missing', () => {
    expect(describeMcpConnection(withGeneration({ last_checked_at: null }), NOW).blockedReason).toBe('capabilities_missing')
  })

  it('freshness rule: <=24h fresh, <=7d stale (still usable), >7d expired (blocked)', () => {
    expect(describeMcpConnection(withGeneration({ last_checked_at: iso(CAPABILITY_FRESH_MS - 1) }), NOW)).toMatchObject({ capabilitiesFreshness: 'fresh', canGenerate: true })
    const stale = describeMcpConnection(withGeneration({ last_checked_at: iso(CAPABILITY_FRESH_MS + 1) }), NOW)
    expect(stale).toMatchObject({ capabilitiesFreshness: 'stale', canGenerate: true })
    expect(stale.operations.length).toBeGreaterThan(0)
    const expired = describeMcpConnection(withGeneration({ last_checked_at: iso(CAPABILITY_MAX_AGE_MS + 1) }), NOW)
    expect(expired).toMatchObject({ capabilitiesFreshness: 'stale', canGenerate: false, blockedReason: 'capabilities_expired', operations: [] })
  })

  it('a snapshot with no compatible models is "no supported models", not "not connected"', () => {
    const empty = { schemaVersion: 1 as const, operations: [{ operation: 'text_to_video' as const, models: [] }, { operation: 'image_to_video' as const, models: [] }] }
    const descriptor = describeMcpConnection(withGeneration({ capabilities: { video: empty } }), NOW)
    expect(descriptor).toMatchObject({ status: 'connected', canGenerate: false, blockedReason: 'no_supported_models' })
  })

  it.each([
    ['authorization_required', 'authorization_required', 'authorization_required'],
    ['error', 'error', 'connection_error'],
  ] as const)('a %s connection is blocked as %s with no operations', (rowStatus, status, blockedReason) => {
    const descriptor = describeMcpConnection(withGeneration({ status: rowStatus }), NOW)
    expect(descriptor).toMatchObject({ status, canGenerate: false, blockedReason, operations: [] })
  })

  it('server-side operations keep the mapping hints the browser copy strips', () => {
    expect(JSON.stringify(serverOperationsFor(withGeneration()))).toContain('outputCountArg')
  })
})

describe('connection references', () => {
  it('parses only the two known shapes; everything else is rejected', () => {
    expect(parseConnectionRef(REST_CONNECTION_REF)).toEqual({ kind: 'rest' })
    expect(parseConnectionRef(accountConnectionRef(CONNECTION_ID))).toEqual({ kind: 'provider_connection', connectionId: CONNECTION_ID })
    for (const forged of ['', 'rest', 'mcp', 'kling:account:', 'kling:account:not-a-uuid', 'kling:account:1;drop table', 'kling:api:extra', 42, null, undefined, {}]) {
      expect(parseConnectionRef(forged)).toBeNull()
    }
  })
})

describe('listing and resolving connections (server authority)', () => {
  const dbWith = (seed: { settings?: any; rows?: ProviderConnectionRow[] }) =>
    createFakeDb({ seed: { user_settings: seed.settings ? [seed.settings] : [], provider_connections: seed.rows ?? [] } }) as any

  it('lists Kling API first, then Google Veo, then only the user’s own account connections', async () => {
    const db = dbWith({ settings: { user_id: 'user-a', kling_api_key: 'k' }, rows: [withGeneration(), withGeneration({ id: OTHER_ID, user_id: 'user-b' })] })
    const connections = await listVideoGenerationConnections(db, 'user-a', NOW)
    expect(connections.map((entry) => entry.ref)).toEqual([REST_CONNECTION_REF, GEMINI_CONNECTION_REF, accountConnectionRef(CONNECTION_ID)])
  })

  it('lists only the two API connections (both unconfigured) when the user has nothing else — never hypothetical providers', async () => {
    const connections = await listVideoGenerationConnections(dbWith({}), 'user-a', NOW)
    expect(connections.map((entry) => entry.ref)).toEqual([REST_CONNECTION_REF, GEMINI_CONNECTION_REF])
    expect(connections[0]).toMatchObject({ ref: REST_CONNECTION_REF, status: 'not_configured' })
    expect(connections[1]).toMatchObject({ ref: GEMINI_CONNECTION_REF, provider: 'gemini', status: 'not_configured', canGenerate: false, operations: [] })
  })

  afterEach(() => vi.unstubAllEnvs())

  it('Google Veo is a connection only when the user has their own Gemini key (BYOK); never a platform key', async () => {
    // Released (the switch is on): without it the connection is listed but cannot generate (see video-first-last-frame-contract.test.ts).
    vi.stubEnv('CONTENT_STUDIO_VEO_VIDEO_GENERATION', 'enabled')
    const withKey = await listVideoGenerationConnections(dbWith({ settings: { user_id: 'user-a', gemini_api_key: 'g' } }), 'user-a', NOW)
    const veo = withKey.find((entry) => entry.ref === GEMINI_CONNECTION_REF)!
    expect(veo).toMatchObject({ provider: 'gemini', transport: 'rest', funding: 'google_gemini_api', canGenerate: true, capabilitiesFreshness: 'static' })
    expect(veo.operations.map((operation) => operation.operation).sort()).toEqual(['image_to_video', 'text_to_video'])
  })

  it('a store failure is an error, never "not configured" / "no models"', async () => {
    const failing: any = {
      from: () => {
        const chain: any = { select: () => chain, eq: () => chain, order: () => chain, maybeSingle: () => Promise.resolve({ data: null, error: { message: 'down' } }), then: (r: any) => r({ data: null, error: { message: 'down' } }) }
        return chain
      },
    }
    await expect(listVideoGenerationConnections(failing, 'user-a', NOW)).rejects.toMatchObject({ code: 'CONNECTIONS_UNAVAILABLE' })
  })

  it('resolves the user’s own MCP connection with its server-side operations', async () => {
    const db = dbWith({ rows: [withGeneration()] })
    const resolved = await resolveGenerationConnection(db, 'user-a', accountConnectionRef(CONNECTION_ID), NOW)
    expect(resolved).toMatchObject({ ok: true, kind: 'provider_connection' })
    if (resolved.ok && resolved.kind === 'provider_connection') {
      expect(resolved.connection.id).toBe(CONNECTION_ID)
      expect(JSON.stringify(resolved.operations)).toContain('outputCountArg')
    }
  })

  it('another user’s connection is indistinguishable from a missing one (404)', async () => {
    const db = dbWith({ rows: [withGeneration({ user_id: 'user-b' })] })
    expect(await resolveGenerationConnection(db, 'user-a', accountConnectionRef(CONNECTION_ID), NOW)).toMatchObject({ ok: false, status: 404, code: 'CONNECTION_NOT_FOUND' })
  })

  it.each(['kling:account:00000000-0000-4000-8000-000000000000', 'nonsense', undefined])('an unknown or forged reference (%s) is 404', async (ref) => {
    const db = dbWith({ rows: [withGeneration()] })
    expect(await resolveGenerationConnection(db, 'user-a', ref, NOW)).toMatchObject({ ok: false, status: 404 })
  })

  it.each([
    ['authorization_required connection', { status: 'authorization_required' as const }, 409, 'AUTHORIZATION_REQUIRED'],
    ['errored connection', { status: 'error' as const }, 409, 'CONNECTION_ERROR'],
    ['read-only connection (no generation permission)', { scopes: ['generation.read', 'account.credit.read'] }, 403, 'GENERATION_AUTHORIZATION_REQUIRED'],
    ['connection without a capability snapshot', { capabilities: {} }, 409, 'CAPABILITIES_MISSING'],
  ])('refuses a %s', async (_name, overrides, status, code) => {
    const db = dbWith({ rows: [withGeneration(overrides as Partial<ProviderConnectionRow>)] })
    expect(await resolveGenerationConnection(db, 'user-a', accountConnectionRef(CONNECTION_ID), NOW)).toMatchObject({ ok: false, status, code })
  })

  it('REST: missing key keeps the historical PROVIDER_NOT_CONFIGURED code', async () => {
    expect(await resolveGenerationConnection(dbWith({}), 'user-a', REST_CONNECTION_REF, NOW)).toMatchObject({ ok: false, status: 422, code: 'PROVIDER_NOT_CONFIGURED' })
  })

  it('REST: configured key resolves without any provider connection row', async () => {
    const db = dbWith({ settings: { user_id: 'user-a', kling_api_key: 'k' } })
    expect(await resolveGenerationConnection(db, 'user-a', REST_CONNECTION_REF, NOW)).toMatchObject({ ok: true, kind: 'rest' })
  })

  it('a store failure while resolving is 503 (not "not found")', async () => {
    const failing: any = {
      from: () => {
        const chain: any = { select: () => chain, eq: () => chain, maybeSingle: () => Promise.resolve({ data: null, error: { message: 'down' } }) }
        return chain
      },
    }
    expect(await resolveGenerationConnection(failing, 'user-a', accountConnectionRef(CONNECTION_ID), NOW)).toMatchObject({ ok: false, status: 503, code: 'CONNECTIONS_UNAVAILABLE' })
  })
})

describe('capability snapshot lifecycle (deliberate check → persisted snapshot → freshness)', () => {
  it('a real connection check persists the normalized video snapshot, and the descriptor moves missing → fresh → stale → expired', async () => {
    const { buildCapabilitySnapshot } = await import('@/lib/provider-connections/kling-mcp-client')
    const { checkKlingMcpConnection } = await import('@/lib/provider-connections/connection-check')
    const { saveConnectionTokens } = await import('@/lib/provider-connections/token-store')
    const { useTestConnectionEnv, clearTestConnectionEnv } = await import('./helpers/fake-db')

    useTestConnectionEnv()
    try {
      const db = createFakeDb({
        seed: {
          provider_connections: [{ ...withGeneration({ capabilities: { models: { text_to_video: ['old'] } }, last_checked_at: null }) }],
        },
      }) as any
      await saveConnectionTokens(db, CONNECTION_ID, { access_token: 'at', refresh_token: 'rt', token_type: 'Bearer', expires_in: 3600 } as any, { clientId: 'c1', issuer: 'https://kling.ai/auth' })

      // Before any (new-version) check: refresh required.
      expect(describeMcpConnection(db.tables.provider_connections[0], NOW).blockedReason).toBe('capabilities_missing')

      const snapshot = buildCapabilitySnapshot({ toolNames: ['who_am_i', 'query_tasks'], whoAmI: whoAmIFixture(), membership: { membershipType: 'SVIP', membershipTypeDescription: 'Pro', availableRemainCredits: 987654 } })
      const outcome = await checkKlingMcpConnection(db, { connectionId: CONNECTION_ID, userId: 'user-a' }, {
        runCheck: async () => ({ accountId: '424242', capabilities: snapshot, credits: { available: 987654 } }),
      })
      expect(outcome.ok).toBe(true)

      const stored = db.tables.provider_connections[0]
      // Normalized video capabilities are persisted; the live credit balance is NOT (a snapshot is not a billing ledger).
      expect(stored.capabilities.video.schemaVersion).toBe(1)
      expect(JSON.stringify(stored)).not.toContain('987654')
      expect(describeMcpConnection(stored, new Date(Date.parse(stored.last_checked_at) + 60_000))).toMatchObject({ canGenerate: true, capabilitiesFreshness: 'fresh' })
      expect(describeMcpConnection(stored, new Date(Date.parse(stored.last_checked_at) + CAPABILITY_FRESH_MS + 1000))).toMatchObject({ canGenerate: true, capabilitiesFreshness: 'stale' })
      expect(describeMcpConnection(stored, new Date(Date.parse(stored.last_checked_at) + CAPABILITY_MAX_AGE_MS + 1000))).toMatchObject({ canGenerate: false, blockedReason: 'capabilities_expired' })
    } finally {
      clearTestConnectionEnv()
    }
  })

  it('a failed refresh leaves the previous snapshot in place (a provider outage does not erase capabilities)', async () => {
    const { checkKlingMcpConnection } = await import('@/lib/provider-connections/connection-check')
    const { saveConnectionTokens } = await import('@/lib/provider-connections/token-store')
    const { ProviderConnectionError } = await import('@/lib/provider-connections/types')
    const { useTestConnectionEnv, clearTestConnectionEnv } = await import('./helpers/fake-db')

    useTestConnectionEnv()
    try {
      const db = createFakeDb({ seed: { provider_connections: [{ ...withGeneration() }] } }) as any
      await saveConnectionTokens(db, CONNECTION_ID, { access_token: 'at', refresh_token: 'rt', token_type: 'Bearer', expires_in: 3600 } as any, { clientId: 'c1', issuer: 'https://kling.ai/auth' })
      const before = JSON.stringify(db.tables.provider_connections[0].capabilities)

      const outcome = await checkKlingMcpConnection(db, { connectionId: CONNECTION_ID, userId: 'user-a' }, {
        runCheck: async () => { throw new ProviderConnectionError('PROVIDER_UNAVAILABLE') },
      })

      expect(outcome).toMatchObject({ ok: false, code: 'PROVIDER_UNAVAILABLE' })
      expect(JSON.stringify(db.tables.provider_connections[0].capabilities)).toBe(before)
      expect(db.tables.provider_connections[0].status).toBe('connected')
    } finally {
      clearTestConnectionEnv()
    }
  })
})
