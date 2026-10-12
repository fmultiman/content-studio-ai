import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
// The ledger recorder writes a provider execution's rows with ONE batched upsert; this stand-in supports that.
import { createReviewTestDb } from '@/lib/reviews/__tests__/review-test-db'
import * as server from '@/lib/supabase/server'
import * as serviceRole from '@/lib/supabase/service-role'
import { PromptAssistanceRequestSchema } from '@/lib/prompt-assistance/contract'

const executePromptProvider = vi.fn()
const resolveProviderExecution = vi.fn()
const providerExecutionBlockedResponse = vi.fn((..._args: unknown[]) => null as unknown)

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/service-role', () => ({ createServiceRoleSupabase: vi.fn() }))
vi.mock('@/lib/credentials/provider-execution', () => ({ resolveProviderExecution: (...args: unknown[]) => resolveProviderExecution(...args) }))
vi.mock('@/lib/providers/execution-policy-http', () => ({ providerExecutionBlockedResponse: (...args: unknown[]) => providerExecutionBlockedResponse(...args) }))
vi.mock('@/lib/prompt-assistance/providers', () => ({ executePromptProvider: (...args: unknown[]) => executePromptProvider(...args) }))

const PROJECT = '11111111-1111-4111-8111-111111111111'
const PRODUCTION = '22222222-2222-4222-8222-222222222222'
const USER = 'user-1'

function chain(result: { data: unknown; error: unknown }) {
  const builder: any = {
    select: () => builder,
    eq: vi.fn(() => builder),
    maybeSingle: () => Promise.resolve(result),
  }
  return builder
}

function buildSupabase(options: { project?: unknown; production?: unknown; projectError?: unknown; productionError?: unknown } = {}) {
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER } }, error: null }) },
    from: vi.fn((table: string) => table === 'projects'
      ? chain({ data: options.project ?? null, error: options.projectError ?? null })
      : chain({ data: options.production ?? null, error: options.productionError ?? null })),
  }
}

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/prompt-assistance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const base = (overrides: Record<string, unknown> = {}) => ({
  projectId: PROJECT,
  mediaType: 'image',
  operation: 'create',
  originalText: 'uma capa editorial sobre rios',
  provider: 'openai',
  model: 'gpt-4o-mini',
  ...overrides,
})

describe('POST /api/prompt-assistance', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    resolveProviderExecution.mockResolvedValue({ status: 'ready', secret: 'server-secret', executionMode: 'user_byok' })
    executePromptProvider.mockResolvedValue({
      text: 'A refined editorial cover featuring a river landscape.',
      usage: { inputTokens: 12, outputTokens: 9, totalTokens: 21, providerRequestId: 'req-1' },
    })
    providerExecutionBlockedResponse.mockReturnValue(null)
  })

  it.each(['text_to_video', 'image_to_video'])('assists %s with text only and records video usage', async (videoMode) => {
    const db = createReviewTestDb()
    const supabase = buildSupabase({
      project: { id: PROJECT, context: 'Documental e luminosa.', identity: null },
      production: { id: PRODUCTION, project_id: PROJECT, title: 'Rios', intention: 'Mostrar o fluxo da água.', type: 'video' },
    })
    vi.mocked(server.createClient).mockResolvedValue(supabase as any)
    vi.mocked(serviceRole.createServiceRoleSupabase).mockReturnValue(db as any)
    const { POST } = await import('@/app/api/prompt-assistance/route')
    const response = await POST(request(base({ mediaType: 'video', videoMode, productionId: PRODUCTION, workflow: 'automatic' })))
    expect(response.status).toBe(200)
    expect(Object.keys(await response.json()).sort()).toEqual(['model', 'operation', 'provider', 'suggestedPrompt', 'usage'])
    expect(executePromptProvider).toHaveBeenCalledTimes(1)
    expect(supabase.from.mock.calls).toEqual([['projects'], ['productions']])
    expect(supabase.from.mock.results[0].value.eq.mock.calls).toEqual([['id', PROJECT], ['user_id', USER]])
    expect(supabase.from.mock.results[1].value.eq.mock.calls).toEqual([['id', PRODUCTION], ['project_id', PROJECT], ['user_id', USER]])
    const input = executePromptProvider.mock.calls[0][0]
    expect(Object.keys(input).sort()).toEqual(['apiKey', 'model', 'provider', 'systemInstruction', 'userInstruction'])
    expect(input.userInstruction).toContain('Documental e luminosa.')
    expect(input.userInstruction).toContain('Mostrar o fluxo da água.')
    expect(input.systemInstruction).toContain('geração de vídeos')
    expect(input.systemInstruction).toContain('câmera')
    expect(input.systemInstruction).toContain('temporal')
    if (videoMode === 'text_to_video') {
      expect(input.systemInstruction).toContain('cena')
      expect(input.systemInstruction).toContain('ação dos sujeitos')
    } else {
      expect(input.systemInstruction).toContain('preservando a composição, identidade, estilo e iluminação')
      expect(input.systemInstruction).toContain('Nenhuma imagem foi enviada')
      expect(input.systemInstruction).toContain('sem afirmar que viu ou analisou a imagem')
    }
    expect(db.tables.provider_usage_events).toHaveLength(2)
    for (const row of db.tables.provider_usage_events) {
      expect(row.provider_metadata).toMatchObject({ media_type: 'video', workflow: 'automatic', funding: 'user_byok' })
      expect(row.resource_type).toBe('prompt_assistance')
    }
    expect(JSON.stringify(db.tables.provider_usage_events)).not.toMatch(/uma capa editorial|server-secret|Documental e luminosa/)
  })

  it('improves the current video prompt through Gemini and keeps the original description as context', async () => {
    const db = createReviewTestDb()
    vi.mocked(server.createClient).mockResolvedValue(buildSupabase() as any)
    vi.mocked(serviceRole.createServiceRoleSupabase).mockReturnValue(db as any)
    const { POST } = await import('@/app/api/prompt-assistance/route')
    const response = await POST(request(base({
      projectId: null, mediaType: 'video', videoMode: 'image_to_video', operation: 'improve', workflow: 'assisted',
      currentText: '  Track left while the water ripples.  ', provider: 'gemini', model: 'gemini-3.5-flash',
    })))
    expect(response.status).toBe(200)
    expect(executePromptProvider).toHaveBeenCalledTimes(1)
    expect(executePromptProvider).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'gemini', model: 'gemini-3.5-flash',
      userInstruction: expect.stringContaining('PROMPT ATUAL A SER MELHORADO:\nTrack left while the water ripples.'),
      systemInstruction: expect.stringContaining('melhore o prompt existente preservando a intenção'),
    }))
    expect(executePromptProvider.mock.calls[0][0].userInstruction).toContain('uma capa editorial sobre rios')
    expect(db.tables.provider_usage_events.every((row: any) => row.provider_metadata.media_type === 'video')).toBe(true)
  })

  it.each([
    { videoMode: undefined }, { videoMode: null }, { videoMode: 'video_to_video' },
    { videoMode: 'text_to_video', operation: 'improve' },
    { videoMode: 'text_to_video', operation: 'improve', currentText: '   ' },
    { videoMode: 'text_to_video', operation: 'improve', currentText: 'a prompt', workflow: 'automatic' },
    { videoMode: 'text_to_video', productionId: PRODUCTION, projectId: null },
  ])('rejects invalid video contracts before context or credentials are read: %j', async (overrides) => {
    const supabase = buildSupabase()
    vi.mocked(server.createClient).mockResolvedValue(supabase as any)
    const { POST } = await import('@/app/api/prompt-assistance/route')
    const response = await POST(request(base({ mediaType: 'video', ...overrides })))
    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('INVALID_REQUEST')
    expect(supabase.from).not.toHaveBeenCalled()
    expect(resolveProviderExecution).not.toHaveBeenCalled()
    expect(executePromptProvider).not.toHaveBeenCalled()
  })

  it.each(['sourceReference', 'source', 'sourceImage', 'image', 'imageUrl', 'sourceImageUrl', 'source_image_url', 'source_image_id', 'source_library_file_id', 'storageKey', 'apiKey', 'duration', 'resolution', 'audio'])('rejects the unaccepted video field %s', async (field) => {
    vi.mocked(server.createClient).mockResolvedValue(buildSupabase() as any)
    const { POST } = await import('@/app/api/prompt-assistance/route')
    const response = await POST(request(base({ mediaType: 'video', videoMode: 'image_to_video', [field]: 'unaccepted' })))
    expect(response.status).toBe(400)
    expect(resolveProviderExecution).not.toHaveBeenCalled()
    expect(executePromptProvider).not.toHaveBeenCalled()
  })

  it('keeps image requests compatible and rejects non-image mode and media payloads', () => {
    expect(PromptAssistanceRequestSchema.parse(base())).toEqual(base())
    expect(PromptAssistanceRequestSchema.safeParse(base({ videoMode: undefined, sourceReference: undefined })).success).toBe(true)
    for (const overrides of [{ videoMode: 'text_to_video' }, { sourceReference: {} }, { imageUrl: 'https://example.com/image.png' }, { mediaType: 'audio' }]) {
      expect(PromptAssistanceRequestSchema.safeParse(base(overrides)).success).toBe(false)
    }
  })

  it.each(['text_to_video', 'image_to_video'])('keeps authentication, ownership, environment, model and credential gates for %s', async (videoMode) => {
    const input = base({ mediaType: 'video', videoMode })
    const anonymous = buildSupabase()
    anonymous.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: null } as any)
    vi.mocked(server.createClient).mockResolvedValue(anonymous as any)
    const { POST } = await import('@/app/api/prompt-assistance/route')
    expect((await POST(request(input))).status).toBe(401)
    expect(providerExecutionBlockedResponse).not.toHaveBeenCalled()

    vi.mocked(server.createClient).mockResolvedValue(buildSupabase() as any)
    expect((await POST(request(input))).status).toBe(403)
    expect(resolveProviderExecution).not.toHaveBeenCalled()

    const blocked = new Response(JSON.stringify({ code: 'PROMPT_ASSISTANCE_BLOCKED' }), { status: 403 })
    providerExecutionBlockedResponse.mockReturnValueOnce(blocked)
    expect(await POST(request(input))).toBe(blocked)
    expect(providerExecutionBlockedResponse).toHaveBeenLastCalledWith({ provider: 'openai', operation: 'text_generation' })

    expect((await POST(request({ ...input, model: 'unlisted' }))).status).toBe(422)
    vi.mocked(server.createClient).mockResolvedValue(buildSupabase({ project: { id: PROJECT, context: null, identity: null } }) as any)
    resolveProviderExecution.mockResolvedValueOnce({ status: 'missing', code: 'MISSING_CREDENTIAL' })
    const missing = await POST(request(input))
    expect(missing.status).toBe(422)
    expect((await missing.json()).code).toBe('PROVIDER_NOT_CONFIGURED')
    expect(executePromptProvider).not.toHaveBeenCalled()
    expect(serviceRole.createServiceRoleSupabase).not.toHaveBeenCalled()
  })

  it('records video error usage without retrying the provider or fabricating unreported usage', async () => {
    const db = createReviewTestDb()
    vi.mocked(server.createClient).mockResolvedValue(buildSupabase() as any)
    vi.mocked(serviceRole.createServiceRoleSupabase).mockReturnValue(db as any)
    const { PromptAssistanceError } = await import('@/lib/prompt-assistance/contract')
    executePromptProvider.mockRejectedValueOnce(new PromptAssistanceError('PROVIDER_INVALID_RESPONSE', 'invalid', 502, {
      inputTokens: 20, outputTokens: 10, totalTokens: 4030, thoughtsTokens: 4000, providerRequestId: 'video-error',
    }))
    const { POST } = await import('@/app/api/prompt-assistance/route')
    const input = base({ projectId: null, mediaType: 'video', videoMode: 'text_to_video', provider: 'gemini', model: 'gemini-3.5-flash' })
    expect((await POST(request(input))).status).toBe(502)
    expect(executePromptProvider).toHaveBeenCalledTimes(1)
    expect(db.tables.provider_usage_events.map((row: any) => [row.unit, Number(row.quantity)])).toEqual([['input_tokens', 20], ['output_tokens', 10], ['tokens', 4000]])
    expect(db.tables.provider_usage_events.every((row: any) => row.provider_metadata.media_type === 'video')).toBe(true)
    executePromptProvider.mockRejectedValueOnce(new PromptAssistanceError('PROVIDER_RATE_LIMITED', 'limited', 429))
    expect((await POST(request(input))).status).toBe(429)
    expect(executePromptProvider).toHaveBeenCalledTimes(2)
    expect(db.tables.provider_usage_events).toHaveLength(3)
  })

  it('returns a controlled credential-store failure for video without provider execution or ledger writes', async () => {
    vi.mocked(server.createClient).mockResolvedValue(buildSupabase() as any)
    const { ProviderCredentialUnavailableError } = await import('@/lib/credentials/credential-errors')
    resolveProviderExecution.mockRejectedValueOnce(new ProviderCredentialUnavailableError('decryption_failed', 'openai'))
    const { POST } = await import('@/app/api/prompt-assistance/route')
    const response = await POST(request(base({ projectId: null, mediaType: 'video', videoMode: 'text_to_video' })))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'As credenciais do provedor estão temporariamente indisponíveis. Tente novamente.', code: 'PROVIDER_CREDENTIAL_UNAVAILABLE', provider: 'openai' })
    expect(executePromptProvider).not.toHaveBeenCalled()
    expect(serviceRole.createServiceRoleSupabase).not.toHaveBeenCalled()
  })

  it('authenticates, resolves Project/Production server-side and compiles Identity without returning raw JSON', async () => {
    const db = createReviewTestDb()
    const supabase = buildSupabase({
      project: {
        id: PROJECT,
        context: 'Campanha editorial sobre água.',
        identity: {
          schema_version: 1,
          foundation: { purpose: 'Educar com clareza.' },
          expression: { visual_identity: 'Documental e luminosa.' },
          visuals: { colors: { accent: '#ff0066' }, typography: { display_font: 'Inter' } },
        },
      },
      production: { id: PRODUCTION, project_id: PROJECT, title: 'Rios', intention: 'Aproximar pessoas da água.', type: 'editorial' },
    })
    vi.mocked(server.createClient).mockResolvedValue(supabase as any)
    vi.mocked(serviceRole.createServiceRoleSupabase).mockReturnValue(db as any)

    const { POST } = await import('@/app/api/prompt-assistance/route')
    const response = await POST(request(base({ productionId: PRODUCTION })))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({ suggestedPrompt: expect.stringContaining('editorial'), provider: 'openai', model: 'gpt-4o-mini', operation: 'create' })
    const providerInput = executePromptProvider.mock.calls[0][0]
    expect(providerInput.apiKey).toBe('server-secret')
    expect(providerInput.userInstruction).toContain('Educar com clareza.')
    expect(providerInput.userInstruction).toContain('#ff0066')
    expect(providerInput.userInstruction).not.toContain('schema_version')
    expect(db.tables.provider_usage_events).toHaveLength(2)
    expect(db.tables.prompts ?? []).toHaveLength(0)
  })

  it('requires currentText for improve and does not call a provider', async () => {
    vi.mocked(server.createClient).mockResolvedValue(buildSupabase() as any)
    const { POST } = await import('@/app/api/prompt-assistance/route')
    const response = await POST(request(base({ operation: 'improve' })))
    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('INVALID_REQUEST')
    expect(executePromptProvider).not.toHaveBeenCalled()
  })

  it('rejects a Production that is missing or belongs to another Project', async () => {
    const supabase = buildSupabase({ project: { id: PROJECT, context: null, identity: null }, production: null })
    vi.mocked(server.createClient).mockResolvedValue(supabase as any)
    const { POST } = await import('@/app/api/prompt-assistance/route')
    const response = await POST(request(base({ productionId: PRODUCTION })))
    expect(response.status).toBe(403)
    expect((await response.json()).code).toBe('PRODUCTION_NOT_FOUND')
    expect(executePromptProvider).not.toHaveBeenCalled()
  })

  it('fails closed on invalid Identity and on unsupported or unconfigured models', async () => {
    const invalid = buildSupabase({ project: { id: PROJECT, context: null, identity: { schema_version: 99 } } })
    vi.mocked(server.createClient).mockResolvedValue(invalid as any)
    const { POST } = await import('@/app/api/prompt-assistance/route')
    const invalidResponse = await POST(request(base()))
    expect(invalidResponse.status).toBe(422)
    expect((await invalidResponse.json()).code).toBe('IDENTITY_INVALID')
    expect(executePromptProvider).not.toHaveBeenCalled()

    const unsupported = await POST(request(base({ model: 'gpt-5-unknown' })))
    expect(unsupported.status).toBe(422)
    expect((await unsupported.json()).code).toBe('UNSUPPORTED_MODEL')

    vi.mocked(server.createClient).mockResolvedValue(buildSupabase({ project: { id: PROJECT, context: null, identity: null } }) as any)
    resolveProviderExecution.mockResolvedValueOnce({ status: 'missing', code: 'MISSING_CREDENTIAL' })
    const missing = await POST(request(base({ model: 'gpt-3.5-turbo' })))
    expect(missing.status).toBe(422)
    expect((await missing.json()).code).toBe('PROVIDER_NOT_CONFIGURED')
  })

  it('routes Gemini through the explicit catalog and does not duplicate usage events on an invocation id', async () => {
    const db = createReviewTestDb()
    vi.mocked(server.createClient).mockResolvedValue(buildSupabase({ project: { id: PROJECT, context: null, identity: null } }) as any)
    vi.mocked(serviceRole.createServiceRoleSupabase).mockReturnValue(db as any)
    executePromptProvider.mockResolvedValue({ text: 'A cinematic river portrait.', usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5, providerRequestId: 'gemini-req' } })
    const { POST } = await import('@/app/api/prompt-assistance/route')

    const first = await POST(request(base({ provider: 'gemini', model: 'gemini-3.5-flash' })))
    const second = await POST(request(base({ provider: 'gemini', model: 'gemini-3.5-flash' })))
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(executePromptProvider).toHaveBeenCalledWith(expect.objectContaining({ provider: 'gemini', model: 'gemini-3.5-flash' }))
    expect(db.tables.provider_usage_events).toHaveLength(2)
  })

  it('records factual usage for a paid call that returned an unusable response, and returns a sanitized typed error', async () => {
    const db = createReviewTestDb()
    vi.mocked(server.createClient).mockResolvedValue(buildSupabase({ project: { id: PROJECT, context: null, identity: null } }) as any)
    vi.mocked(serviceRole.createServiceRoleSupabase).mockReturnValue(db as any)
    const { PromptAssistanceError } = await import('@/lib/prompt-assistance/contract')
    executePromptProvider.mockRejectedValue(new PromptAssistanceError('PROVIDER_INVALID_RESPONSE', 'O Gemini retornou uma sugestão inválida.', 502, {
      inputTokens: 20, outputTokens: 4096, totalTokens: 4116, providerRequestId: 'gemini-cut',
    }))
    const { POST } = await import('@/app/api/prompt-assistance/route')
    const response = await POST(request(base({ provider: 'gemini', model: 'gemini-3.5-flash' })))
    expect(response.status).toBe(502)
    expect((await response.json()).code).toBe('PROVIDER_INVALID_RESPONSE')
    expect(db.tables.provider_usage_events).toHaveLength(2)
    const serialized = JSON.stringify(db.tables.provider_usage_events)
    expect(serialized).not.toContain('uma capa editorial')
    expect(serialized).not.toContain('server-secret')
  })

  it('does not fabricate usage for a provider failure that reported none', async () => {
    const db = createReviewTestDb()
    vi.mocked(server.createClient).mockResolvedValue(buildSupabase({ project: { id: PROJECT, context: null, identity: null } }) as any)
    vi.mocked(serviceRole.createServiceRoleSupabase).mockReturnValue(db as any)
    const { PromptAssistanceError } = await import('@/lib/prompt-assistance/contract')
    executePromptProvider.mockRejectedValue(new PromptAssistanceError('PROVIDER_RATE_LIMITED', 'limitado', 429))
    const { POST } = await import('@/app/api/prompt-assistance/route')
    const response = await POST(request(base()))
    expect(response.status).toBe(429)
    expect((await response.json()).code).toBe('PROVIDER_RATE_LIMITED')
    expect(db.tables.provider_usage_events ?? []).toHaveLength(0)
  })

  it('records Gemini thinking tokens as their own row, with the reported tier and the truthful funding, and exposes no extra response fields', async () => {
    const db = createReviewTestDb()
    vi.mocked(server.createClient).mockResolvedValue(buildSupabase({ project: { id: PROJECT, context: null, identity: null } }) as any)
    vi.mocked(serviceRole.createServiceRoleSupabase).mockReturnValue(db as any)
    executePromptProvider.mockResolvedValue({
      text: 'A cinematic river portrait.',
      usage: { inputTokens: 273, outputTokens: 79, totalTokens: 432, thoughtsTokens: 80, serviceTier: 'standard', providerRequestId: 'gem-think' },
    })
    const { POST } = await import('@/app/api/prompt-assistance/route')
    const response = await POST(request(base({ provider: 'gemini', model: 'gemini-3.5-flash-lite' })))
    expect(response.status).toBe(200)
    expect(Object.keys(await response.json()).sort()).toEqual(['model', 'operation', 'provider', 'suggestedPrompt', 'usage'])
    const rows = db.tables.provider_usage_events
    expect(rows.map((r: any) => [r.unit, Number(r.quantity)])).toEqual([['input_tokens', 273], ['output_tokens', 79], ['tokens', 80]])
    expect(rows[2].provider_metadata).toMatchObject({ usage_category: 'thoughts', funding: 'user_byok', usage: { serviceTier: 'standard', totalTokenCount: 432 } })
    expect(JSON.stringify(rows)).not.toMatch(/uma capa editorial|server-secret|cinematic river/)
  })

  it('a replay of the same provider execution never duplicates billable usage', async () => {
    const db = createReviewTestDb()
    vi.mocked(server.createClient).mockResolvedValue(buildSupabase({ project: { id: PROJECT, context: null, identity: null } }) as any)
    vi.mocked(serviceRole.createServiceRoleSupabase).mockReturnValue(db as any)
    const { POST } = await import('@/app/api/prompt-assistance/route')
    await POST(request(base()))
    await POST(request(base()))
    expect(executePromptProvider).toHaveBeenCalledTimes(2)
    expect(db.tables.provider_usage_events).toHaveLength(2)
  })

  it('a paid response that is unusable still records its thinking tokens, and no usage is recorded when none was reported', async () => {
    const db = createReviewTestDb()
    vi.mocked(server.createClient).mockResolvedValue(buildSupabase({ project: { id: PROJECT, context: null, identity: null } }) as any)
    vi.mocked(serviceRole.createServiceRoleSupabase).mockReturnValue(db as any)
    const { PromptAssistanceError } = await import('@/lib/prompt-assistance/contract')
    executePromptProvider.mockRejectedValueOnce(new PromptAssistanceError('PROVIDER_INVALID_RESPONSE', 'x', 502, {
      inputTokens: 20, outputTokens: 10, totalTokens: 4030, thoughtsTokens: 4000, providerRequestId: 'gem-cut2',
    }))
    const { POST } = await import('@/app/api/prompt-assistance/route')
    expect((await POST(request(base({ provider: 'gemini', model: 'gemini-3.5-flash' })))).status).toBe(502)
    expect(db.tables.provider_usage_events.map((r: any) => [r.unit, Number(r.quantity)])).toEqual([['input_tokens', 20], ['output_tokens', 10], ['tokens', 4000]])
    executePromptProvider.mockRejectedValueOnce(new PromptAssistanceError('PROVIDER_UNAVAILABLE', 'x', 502))
    await POST(request(base()))
    expect(db.tables.provider_usage_events).toHaveLength(3)
  })

  it('records the automatic/assisted label in usage metadata without changing billing dimensions or authorization', async () => {
    const db = createReviewTestDb()
    vi.mocked(server.createClient).mockResolvedValue(buildSupabase({ project: { id: PROJECT, context: null, identity: null } }) as any)
    vi.mocked(serviceRole.createServiceRoleSupabase).mockReturnValue(db as any)
    const { POST } = await import('@/app/api/prompt-assistance/route')
    expect((await POST(request(base({ workflow: 'automatic' })))).status).toBe(200)
    const rows = db.tables.provider_usage_events
    expect(rows).toHaveLength(2)
    expect(rows.every((r: any) => r.provider_metadata.workflow === 'automatic')).toBe(true)
    expect(rows.map((r: any) => [r.unit, Number(r.quantity), r.user_id])).toEqual([['input_tokens', 12, USER], ['output_tokens', 9, USER]])
  })

  it('an invalid workflow label is a 400 before any provider call, and the label never bypasses Project ownership', async () => {
    vi.mocked(server.createClient).mockResolvedValue(buildSupabase({ project: null }) as any)
    const { POST } = await import('@/app/api/prompt-assistance/route')
    const invalid = await POST(request(base({ workflow: 'background' })))
    expect(invalid.status).toBe(400)
    const foreign = await POST(request(base({ workflow: 'automatic' })))
    expect(foreign.status).toBe(403)
    expect((await foreign.json()).code).toBe('PROJECT_NOT_FOUND')
    expect(executePromptProvider).not.toHaveBeenCalled()
  })
})
