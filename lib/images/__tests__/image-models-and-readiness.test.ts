import { describe, expect, it } from 'vitest'
import {
  ALL_IMAGE_MODELS,
  DEFAULT_IMAGE_MODEL,
  IMAGE_MODEL_LABELS,
  IMAGE_PROVIDER_LABELS,
  GEMINI_IMAGE_DEFAULT_ASPECT_RATIO,
  imageModelProvider,
  interpretStoredImageModel,
  isGeminiImageModel,
  parseImageModel,
  type ImageModel,
} from '@/lib/images/image-models'
import {
  GEMINI_IMAGE_COST_NOTICE,
  buildImageModelGroups,
  evaluateImageReadiness,
  type ImageReadinessInput,
} from '@/lib/images/image-readiness'
import { geminiImageAvailabilityMessage, parseGeminiImageAvailability } from '@/lib/images/gemini-availability'
import { describeGeminiImageFailure, interpretGeminiReplay } from '@/lib/images/gemini-image-errors'
import { GEMINI_IMAGE_ALIASES, resolveGeminiImageModel } from '@/lib/providers/gemini/image-models'
import { describeGeminiImageAvailability, GEMINI_IMAGE_GENERATION_FLAG } from '@/lib/providers/gemini/image-feature'

// FUTURE-064 Slice B — pure logic behind the /imagens and Settings integration. No network, no DOM.

const ON = { available: true, reason: 'available' } as const
const OFF = { available: false, reason: 'release_switch_off' } as const
const BLOCKED = { available: false, reason: 'environment_blocked' } as const

describe('model catalog', () => {
  it('lists the OpenAI models, the two approved Google aliases and the legacy third-party models, and nothing else', () => {
    expect([...ALL_IMAGE_MODELS]).toEqual(['gpt-image-2', 'gpt-image-1.5', 'gpt-image-1', 'gpt-image-1-mini', 'gemini-nb-2.1', 'gemini-nb-lite', 'nanobanana-v1', 'nanobanana-v2'])
  })

  it('every persisted selector value fits varchar(20) (user_settings.default_image_model / image_drafts.selected_model)', () => {
    for (const model of ALL_IMAGE_MODELS) expect(model.length).toBeLessThanOrEqual(20)
  })

  it('the Google aliases are exactly the server registry (no drift between client and server)', () => {
    expect(ALL_IMAGE_MODELS.filter((model) => imageModelProvider(model) === 'gemini')).toEqual([...GEMINI_IMAGE_ALIASES])
    for (const alias of GEMINI_IMAGE_ALIASES) expect(resolveGeminiImageModel(alias)).not.toBeNull()
    expect(GEMINI_IMAGE_DEFAULT_ASPECT_RATIO).toBe('1:1')
  })

  it('uses the approved distinct provider labels', () => {
    expect(IMAGE_MODEL_LABELS['gemini-nb-2.1']).toBe('Google Gemini — Nano Banana 2.1 (oficial)')
    expect(IMAGE_MODEL_LABELS['gemini-nb-lite']).toBe('Google Gemini — Nano Banana 2 Lite (oficial)')
    expect(IMAGE_MODEL_LABELS['nanobanana-v1']).toBe('NanoBananaAPI.ai V1 (terceiros — legado)')
    expect(IMAGE_MODEL_LABELS['nanobanana-v2']).toBe('NanoBananaAPI.ai V2 (terceiros — legado)')
    expect(IMAGE_PROVIDER_LABELS.nanobanana).toBe('NanoBananaAPI.ai (terceiros — legado)')
    expect(IMAGE_PROVIDER_LABELS.gemini).toMatch(/Google Gemini \(oficial\)/)
    // a legacy model is never labelled as the official API, and an official model never as third-party
    for (const model of ALL_IMAGE_MODELS) {
      if (imageModelProvider(model) === 'nanobanana') expect(IMAGE_MODEL_LABELS[model]).not.toMatch(/Google|oficial/)
      if (imageModelProvider(model) === 'gemini') expect(IMAGE_MODEL_LABELS[model]).not.toMatch(/terceiros|NanoBananaAPI/)
    }
  })

  it('maps every model to exactly one provider (no "everything else is NanoBanana")', () => {
    const providers = ALL_IMAGE_MODELS.map((model) => [model, imageModelProvider(model)])
    expect(providers).toEqual([
      ['gpt-image-2', 'openai'], ['gpt-image-1.5', 'openai'], ['gpt-image-1', 'openai'], ['gpt-image-1-mini', 'openai'],
      ['gemini-nb-2.1', 'gemini'], ['gemini-nb-lite', 'gemini'], ['nanobanana-v1', 'nanobanana'], ['nanobanana-v2', 'nanobanana'],
    ])
    expect(isGeminiImageModel('gemini-nb-lite')).toBe(true)
    expect(isGeminiImageModel('nanobanana-v1')).toBe(false)
  })

  it.each(['', ' gpt-image-2', 'GPT-IMAGE-2', 'banana-9000', 'gemini-nano-banana-2.1', 'gemini-3.1-flash-lite-image', 'gemini-3-pro-image', 'v1', 'openai', '__proto__', 'constructor'])(
    'parseImageModel rejects %j (no fallback)', (value) => {
      expect(parseImageModel(value)).toBeNull()
    })
  it.each([undefined, null, 1, true, {}, []])('parseImageModel rejects the non-string %j', (value) => {
    expect(parseImageModel(value)).toBeNull()
  })

  describe('interpreting stored selectors', () => {
    it('absent values keep the existing default (nothing is invented)', () => {
      for (const value of [null, undefined, '']) expect(interpretStoredImageModel(value)).toEqual({ kind: 'absent' })
      expect(DEFAULT_IMAGE_MODEL).toBe('gpt-image-2')
    })
    it('every catalog id round-trips unchanged, including the new aliases and the legacy NanoBanana ids', () => {
      for (const model of ALL_IMAGE_MODELS) expect(interpretStoredImageModel(model)).toEqual({ kind: 'model', model })
    })
    it('keeps the historical "openai" default readable as GPT Image 2 (read-mapped, never rewritten)', () => {
      expect(interpretStoredImageModel('openai')).toEqual({ kind: 'model', model: 'gpt-image-2' })
    })
    it.each(['banana-9000', 'gemini-nano-banana-2.1', 'GEMINI-NB-2.1', 'gpt-image-9', '__proto__', 'toString'])(
      'an unknown stored id %j is reported as unknown, not mapped to gpt-image-2 or another provider', (raw) => {
        expect(interpretStoredImageModel(raw)).toEqual({ kind: 'unknown', raw })
      })
  })
})

const base: ImageReadinessInput = {
  model: 'gpt-image-2', unrecognizedModel: null, providerStatusLoaded: true,
  openaiConfigured: true, geminiConfigured: true, nanobananaConfigured: true,
  geminiImageAvailability: ON, canonicalWorkspace: true,
}
const readiness = (patch: Partial<ImageReadinessInput>) => evaluateImageReadiness({ ...base, ...patch })
const codeOf = (patch: Partial<ImageReadinessInput>) => {
  const result = readiness(patch)
  return result.ready ? 'ready' : result.code
}

describe('provider-specific readiness', () => {
  it('OpenAI depends only on the OpenAI key', () => {
    expect(codeOf({})).toBe('ready')
    expect(codeOf({ openaiConfigured: false })).toBe('openai_not_configured')
    expect(codeOf({ geminiConfigured: false, nanobananaConfigured: false, geminiImageAvailability: OFF })).toBe('ready')
  })

  it('NanoBananaAPI.ai (third party) depends only on its own key and is never confused with Google', () => {
    expect(codeOf({ model: 'nanobanana-v1' })).toBe('ready')
    expect(codeOf({ model: 'nanobanana-v2', nanobananaConfigured: false })).toBe('nanobanana_not_configured')
    expect(codeOf({ model: 'nanobanana-v1', geminiConfigured: true, nanobananaConfigured: false })).toBe('nanobanana_not_configured')
    expect(codeOf({ model: 'nanobanana-v1', geminiImageAvailability: OFF, geminiConfigured: false })).toBe('ready')
    const missing = readiness({ model: 'nanobanana-v1', nanobananaConfigured: false })
    expect(!missing.ready && missing.message).toMatch(/NanoBananaAPI\.ai \(terceiros — legado\)/)
  })

  it('Google Gemini needs the capability AND the key AND the canonical workspace', () => {
    expect(codeOf({ model: 'gemini-nb-2.1' })).toBe('ready')
    expect(codeOf({ model: 'gemini-nb-lite' })).toBe('ready')
    expect(codeOf({ model: 'gemini-nb-2.1', geminiConfigured: false })).toBe('gemini_not_configured')
    expect(codeOf({ model: 'gemini-nb-2.1', canonicalWorkspace: false })).toBe('gemini_requires_session')
  })

  it('a disabled capability is reported as DISABLED, never as a missing key (even when the key is also missing)', () => {
    for (const geminiConfigured of [true, false]) {
      expect(codeOf({ model: 'gemini-nb-2.1', geminiImageAvailability: OFF, geminiConfigured })).toBe('gemini_capability_disabled')
      expect(codeOf({ model: 'gemini-nb-2.1', geminiImageAvailability: BLOCKED, geminiConfigured })).toBe('gemini_capability_disabled')
    }
    const off = readiness({ model: 'gemini-nb-2.1', geminiImageAvailability: OFF })
    expect(!off.ready && off.message).toMatch(/ainda não foi habilitada/)
    expect(!off.ready && off.message).not.toMatch(/chave|Configure/i)
  })

  it('an unknown availability signal is treated as unavailable (a malformed signal never enables paid generation)', () => {
    expect(codeOf({ model: 'gemini-nb-2.1', geminiImageAvailability: null })).toBe('gemini_capability_unknown')
  })

  it('a configured Google key never implies the capability (key readiness does not enable the disabled route)', () => {
    expect(codeOf({ model: 'gemini-nb-2.1', geminiConfigured: true, geminiImageAvailability: OFF })).not.toBe('ready')
  })

  it('an unrecognized saved model blocks every provider and is named in the message', () => {
    for (const patch of [{}, { geminiImageAvailability: ON }, { openaiConfigured: false }]) {
      const result = readiness({ model: null, unrecognizedModel: 'banana-9000', ...patch })
      expect(result.ready).toBe(false)
      expect(!result.ready && result.code).toBe('model_unrecognized')
      expect(!result.ready && result.message).toMatch(/banana-9000/)
    }
  })

  it('waits for provider status before declaring anything ready', () => {
    for (const model of ALL_IMAGE_MODELS) expect(codeOf({ model, providerStatusLoaded: false })).toBe('status_loading')
  })
})

describe('selector option groups', () => {
  const find = (groups: ReturnType<typeof buildImageModelGroups>, provider: string) => groups.find((group) => group.provider === provider)

  it('with the capability ON: Google options are enabled and carry no note', () => {
    const google = find(buildImageModelGroups({ selectedModel: 'gpt-image-2', nanobananaConfigured: true, gemini: { availability: ON, canonicalWorkspace: true } }), 'gemini')!
    expect(google.options.map((option) => [option.value, option.disabled])).toEqual([['gemini-nb-2.1', false], ['gemini-nb-lite', false]])
    expect(google.note).toBeNull()
    expect(google.label).toBe('Google Gemini (oficial)')
  })

  it.each([['OFF', OFF], ['BLOCKED', BLOCKED], ['unknown', null]] as const)('with the capability %s: Google options are disabled with an explanation', (_name, availability) => {
    const google = find(buildImageModelGroups({ selectedModel: 'gpt-image-2', nanobananaConfigured: false, gemini: { availability, canonicalWorkspace: true } }), 'gemini')!
    expect(google.options.every((option) => option.disabled)).toBe(true)
    expect(google.note).toBe(geminiImageAvailabilityMessage(availability))
    expect(google.note).not.toMatch(/chave/i)
  })

  it('outside the canonical workspace Google options are disabled with the right reason', () => {
    const google = find(buildImageModelGroups({ selectedModel: 'gpt-image-2', nanobananaConfigured: false, gemini: { availability: ON, canonicalWorkspace: false } }), 'gemini')!
    expect(google.options.every((option) => option.disabled)).toBe(true)
    expect(google.note).toMatch(/Nova Imagem/)
  })

  it('the current Google selection is never disabled (the Select must be able to display it)', () => {
    const google = find(buildImageModelGroups({ selectedModel: 'gemini-nb-lite', nanobananaConfigured: false, gemini: { availability: OFF, canonicalWorkspace: true } }), 'gemini')!
    expect(google.options.map((option) => [option.value, option.disabled])).toEqual([['gemini-nb-2.1', true], ['gemini-nb-lite', false]])
  })

  it('omits Google entirely for callers that do not opt in; OpenAI is always listed', () => {
    const groups = buildImageModelGroups({ selectedModel: 'gpt-image-2', nanobananaConfigured: false })
    expect(groups.map((group) => group.provider)).toEqual(['openai'])
    expect(groups[0].options.map((option) => option.value)).toEqual(['gpt-image-2', 'gpt-image-1.5', 'gpt-image-1', 'gpt-image-1-mini'])
  })

  it('lists the legacy third-party models when their key exists or when one is the current selection', () => {
    expect(find(buildImageModelGroups({ selectedModel: 'gpt-image-2', nanobananaConfigured: true }), 'nanobanana')).toBeDefined()
    expect(find(buildImageModelGroups({ selectedModel: 'gpt-image-2', nanobananaConfigured: false }), 'nanobanana')).toBeUndefined()
    expect(find(buildImageModelGroups({ selectedModel: 'nanobanana-v2', nanobananaConfigured: false }), 'nanobanana')).toBeDefined()
    expect(find(buildImageModelGroups({ selectedModel: 'gpt-image-2', nanobananaConfigured: true }), 'nanobanana')!.label).toBe('NanoBananaAPI.ai (terceiros — legado)')
  })

  it('every listed option is a catalog model', () => {
    const groups = buildImageModelGroups({ selectedModel: null, nanobananaConfigured: true, gemini: { availability: ON, canonicalWorkspace: true } })
    const values = groups.flatMap((group) => group.options.map((option) => option.value)) as ImageModel[]
    expect(values.sort()).toEqual([...ALL_IMAGE_MODELS].sort())
  })
})

describe('cost communication', () => {
  it('states BYOK charges may apply without claiming free generation or a zero cost', () => {
    expect(GEMINI_IMAGE_COST_NOTICE).toMatch(/pode gerar cobrança na sua conta Google/)
    expect(GEMINI_IMAGE_COST_NOTICE).toMatch(/custo estimado ainda não está disponível/)
    expect(GEMINI_IMAGE_COST_NOTICE).not.toMatch(/gr[aá]tis|free|sem custo|\$\s?0|R\$\s?0|0,00/i)
  })
})

describe('availability signal (browser-safe)', () => {
  it('accepts only known, self-consistent answers', () => {
    expect(parseGeminiImageAvailability({ available: true, reason: 'available' })).toEqual(ON)
    expect(parseGeminiImageAvailability({ available: false, reason: 'release_switch_off' })).toEqual(OFF)
    expect(parseGeminiImageAvailability({ available: false, reason: 'environment_blocked' })).toEqual(BLOCKED)
    for (const bad of [null, undefined, 'yes', 1, [], {}, { available: 'true', reason: 'available' }, { available: true, reason: 'release_switch_off' },
      { available: false, reason: 'available' }, { available: true, reason: 'nope' }, { available: true }]) {
      expect(parseGeminiImageAvailability(bad)).toBeNull()
    }
  })

  describe('server derivation (switch + FUTURE-050 policy)', () => {
    const production = { VERCEL_URL: 'app.vercel.app', VERCEL_ENV: 'production' }
    it('is OFF by default and for boolean-ish values', () => {
      expect(describeGeminiImageAvailability({})).toEqual(OFF)
      expect(describeGeminiImageAvailability({ ...production })).toEqual(OFF)
      for (const value of ['1', 'true', 'TRUE', 'ENABLED', ' enabled']) expect(describeGeminiImageAvailability({ ...production, [GEMINI_IMAGE_GENERATION_FLAG]: value })).toEqual(OFF)
    })
    it('is available only in a real Production runtime with the exact switch value', () => {
      expect(describeGeminiImageAvailability({ ...production, [GEMINI_IMAGE_GENERATION_FLAG]: 'enabled' })).toEqual(ON)
    })
    it('stays blocked in Preview and in an unknown runtime even with the switch ON', () => {
      expect(describeGeminiImageAvailability({ VERCEL_URL: 'x.vercel.app', VERCEL_ENV: 'preview', [GEMINI_IMAGE_GENERATION_FLAG]: 'enabled' })).toEqual(BLOCKED)
      expect(describeGeminiImageAvailability({ NODE_ENV: 'production', [GEMINI_IMAGE_GENERATION_FLAG]: 'enabled' })).toEqual(BLOCKED)
    })
    it('never contains the variable name or value', () => {
      const payload = JSON.stringify(describeGeminiImageAvailability({ ...production, [GEMINI_IMAGE_GENERATION_FLAG]: 'enabled' }))
      expect(payload).not.toMatch(/CONTENT_STUDIO|enabled"|GEMINI_IMAGE_GENERATION/)
    })
  })
})

describe('Slice A error mapping', () => {
  const failure = (status: number, code: string) => describeGeminiImageFailure(status, { error: 'server text', code })
  it('separates a disabled capability from every credential state', () => {
    expect(failure(403, 'GEMINI_IMAGE_GENERATION_DISABLED')).toMatchObject({ kind: 'capability_disabled', capabilityOff: true })
    expect(failure(403, 'PROVIDER_EXECUTION_DISABLED_IN_ENVIRONMENT')).toMatchObject({ kind: 'environment_blocked', capabilityOff: true })
    expect(failure(400, 'PROVIDER_NOT_CONFIGURED')).toMatchObject({ kind: 'credential_missing', capabilityOff: false })
    expect(failure(503, 'PROVIDER_CREDENTIAL_UNAVAILABLE')).toMatchObject({ kind: 'credential_unavailable', capabilityOff: false })
    expect(failure(400, 'PROVIDER_CREDENTIAL_REJECTED')).toMatchObject({ kind: 'credential_rejected' })
    expect(failure(403, 'GEMINI_IMAGE_GENERATION_DISABLED').message).not.toMatch(/chave|configure/i)
    expect(failure(400, 'PROVIDER_NOT_CONFIGURED').message).toMatch(/Configure a chave do Google Gemini/)
    expect(failure(503, 'PROVIDER_CREDENTIAL_UNAVAILABLE').message).not.toMatch(/Configure a chave/)
  })
  it.each([
    [429, 'PROVIDER_RATE_LIMITED', 'rate_limited'], [422, 'PROVIDER_CONTENT_BLOCKED', 'content_blocked'], [400, 'INVALID_IMAGE_MODEL', 'invalid_model'],
    [400, 'SOURCE_NOT_SUPPORTED', 'source_not_supported'], [409, 'IDEMPOTENCY_CONFLICT', 'conflict'], [404, 'SESSION_NOT_FOUND', 'session'],
    [504, 'PROVIDER_TIMEOUT', 'provider'], [502, 'PROVIDER_UNAVAILABLE', 'provider'], [502, 'EMPTY_PROVIDER_RESULT', 'provider'], [502, 'INVALID_PROVIDER_RESPONSE', 'provider'],
    [503, 'STORAGE_UNAVAILABLE', 'storage'], [503, 'OUTPUT_SAVE_FAILED', 'storage'],
  ])('HTTP %i %s -> %s', (status, code, kind) => {
    const result = failure(status, code)
    expect(result.kind).toBe(kind)
    expect(result.capabilityOff).toBe(false)
    expect(result.message).not.toMatch(/server text/)
  })
  it('falls back safely for unknown bodies, never echoing server text', () => {
    expect(describeGeminiImageFailure(401, {}).kind).toBe('unauthenticated')
    expect(describeGeminiImageFailure(429, null).kind).toBe('rate_limited')
    for (const body of [null, undefined, 'x', 7, [], { code: 7 }, { code: '__proto__' }, { code: 'toString' }, { code: 'UNKNOWN', error: 'leak' }]) {
      const result = describeGeminiImageFailure(500, body)
      expect(result.kind).toBe('other')
      expect(result.message).not.toMatch(/leak/)
    }
  })
  it('timeouts and provider failures warn that a charge may have occurred', () => {
    for (const code of ['PROVIDER_TIMEOUT', 'PROVIDER_UNAVAILABLE', 'STORAGE_UNAVAILABLE', 'OUTPUT_SAVE_FAILED']) expect(failure(500, code).message).toMatch(/cobrança pode ter ocorrido/)
  })
  it('interprets replays without ever treating a non-success as an image', () => {
    expect(interpretGeminiReplay({ status: 'succeeded', imageUrl: 'https://x/y.png', image: { id: 'i' } })).toEqual({ kind: 'image', imageUrl: 'https://x/y.png' })
    expect(interpretGeminiReplay({ status: 'succeeded', imageUrl: 'https://x/y.png' }).kind).toBe('in_progress')
    expect(interpretGeminiReplay({ status: 'failed' }).kind).toBe('failed')
    for (const status of ['submitted', 'processing', 'queued', undefined]) expect(interpretGeminiReplay({ status }).kind).toBe('in_progress')
  })
})
