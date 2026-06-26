/**
 * M11-E — Image Evaluator + Project Identity integration tests
 *
 * Coverage strategy:
 * - Cases 1–4, 8–16, 34: pure buildImageEvaluationContext tests (no mocks needed)
 * - Case 5: normalizeProjectIdentity throws on invalid input (client-side block)
 * - Cases 6–7, 17–33: route handler tests (mocked supabase + fetch)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildImageEvaluationContext } from '../context-compiler'
import { normalizeProjectIdentity, ProjectIdentityParseError } from '../project-identity-normalizer'
import type { ProjectIdentity } from '../schemas/project-identity'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const VALID_IMAGE_URL = 'https://example.com/image.jpg'
const VALID_PROMPT = 'A beautiful landscape photo'

/** Minimal valid body accepted by the route (excluding identity) */
function makeBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    userInput: 'foto de produto premium',
    generatedPrompt: VALID_PROMPT,
    imageUrl: VALID_IMAGE_URL,
    evaluation_mode: 'default',
    attempt: 1,
    ...overrides,
  }
}

/** Build a mock Request for the route handler */
function makeRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/evaluate-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Standard OpenAI success response */
function openAISuccess(partial: Partial<{
  score: number; approved: boolean; feedback: string;
  improvements: string[]; refinedPrompt: string
}> = {}): Response {
  const result = {
    score: 82,
    approved: true,
    feedback: 'Imagem bem alinhada com o contexto.',
    improvements: ['Melhorar contraste'],
    refinedPrompt: 'An improved landscape with better contrast',
    ...partial,
  }
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(result) } }],
  }), { status: 200 })
}

// ─── Supabase mock ────────────────────────────────────────────────────────────

const mockSingle = vi.fn()
const mockEq = vi.fn()
const mockSelect = vi.fn()
const mockFrom = vi.fn()
const mockGetUser = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockImplementation(async () => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  })),
}))

function setupAuthSuccess() {
  mockGetUser.mockResolvedValue({ data: { user: { id: 'test-user' } }, error: null })
  mockSingle.mockResolvedValue({ data: { openai_api_key: 'sk-test' }, error: null })
  mockEq.mockReturnValue({ single: mockSingle })
  mockSelect.mockReturnValue({ eq: mockEq })
  mockFrom.mockReturnValue({ select: mockSelect })
}

// ─── Part 1: buildImageEvaluationContext (pure function tests) ─────────────────

describe('case 1 — sem identity: context e style_profile entram no bloco compilado', () => {
  it('includes context in compiled block', () => {
    const result = buildImageEvaluationContext({ context: 'Contexto legado', style_profile: null })
    expect(result).toContain('Contexto legado')
  })

  it('includes style_profile as visual identity fallback', () => {
    const result = buildImageEvaluationContext({ context: null, style_profile: 'Minimalista escuro' })
    expect(result).toContain('Minimalista escuro')
  })

  it('returns empty string when no inputs', () => {
    const result = buildImageEvaluationContext({ context: null, style_profile: null })
    expect(result).toBe('')
  })
})

describe('case 2 — identity null: comportamento igual ao sem identity', () => {
  it('null identity does not break compilation', () => {
    const a = buildImageEvaluationContext({ context: 'CTX', style_profile: 'S', identity: null })
    const b = buildImageEvaluationContext({ context: 'CTX', style_profile: 'S' })
    expect(a).toBe(b)
  })
})

describe('case 3 — identity parcial: apenas dimensões presentes entram', () => {
  const partialIdentity: ProjectIdentity = {
    schema_version: 1,
    foundation: { purpose: 'Arte para marcas premium' },
  }

  it('includes only the present zone (foundation.purpose)', () => {
    const result = buildImageEvaluationContext({ context: null, style_profile: null, identity: partialIdentity })
    expect(result).toContain('Arte para marcas premium')
  })

  it('does not include absent zones', () => {
    const result = buildImageEvaluationContext({ context: null, style_profile: null, identity: partialIdentity })
    expect(result).not.toContain('Audiência')
    expect(result).not.toContain('Restrições')
    expect(result).not.toContain('Princípios')
  })
})

describe('case 4 — identity completa: todas as dimensões exceto voice', () => {
  const fullIdentity: ProjectIdentity = {
    schema_version: 1,
    foundation: { purpose: 'Conteúdo aspiracional' },
    relationship: { audience: 'Jovens criativos 18-35' },
    expression: {
      visual_identity: 'Monocromático com acentos dourados',
      voice: 'Tom poético e introspectivo',
    },
    governance: {
      principles: ['Autenticidade radical'],
      restrictions: ['Sem rostos visíveis', 'Sem elementos digitais'],
    },
    practice: { generation_preferences: ['Alta profundidade de campo'] },
  }

  it('includes purpose', () => {
    expect(buildImageEvaluationContext({ context: null, style_profile: null, identity: fullIdentity })).toContain('Conteúdo aspiracional')
  })

  it('includes audience', () => {
    expect(buildImageEvaluationContext({ context: null, style_profile: null, identity: fullIdentity })).toContain('Jovens criativos 18-35')
  })

  it('includes visual_identity', () => {
    expect(buildImageEvaluationContext({ context: null, style_profile: null, identity: fullIdentity })).toContain('Monocromático com acentos dourados')
  })

  it('includes principles', () => {
    expect(buildImageEvaluationContext({ context: null, style_profile: null, identity: fullIdentity })).toContain('Autenticidade radical')
  })

  it('includes restrictions', () => {
    expect(buildImageEvaluationContext({ context: null, style_profile: null, identity: fullIdentity })).toContain('Sem rostos visíveis')
  })

  it('includes generation_preferences', () => {
    expect(buildImageEvaluationContext({ context: null, style_profile: null, identity: fullIdentity })).toContain('Alta profundidade de campo')
  })
})

describe('case 5 — identity inválida no cliente bloqueia POST', () => {
  it('normalizeProjectIdentity throws ProjectIdentityParseError on invalid schema_version', () => {
    expect(() => normalizeProjectIdentity({ schema_version: 2 })).toThrow(ProjectIdentityParseError)
  })

  it('normalizeProjectIdentity throws on missing schema_version in non-empty object', () => {
    expect(() => normalizeProjectIdentity({ purpose: 'x' })).toThrow(ProjectIdentityParseError)
  })

  it('normalizeProjectIdentity returns null for null input (no error)', () => {
    expect(normalizeProjectIdentity(null)).toBeNull()
  })
})

describe('case 8 — context e purpose aparecem separados', () => {
  const identity: ProjectIdentity = {
    schema_version: 1,
    foundation: { purpose: 'Inspirar criadores independentes' },
  }

  it('general context and identity purpose are both present and distinct', () => {
    const result = buildImageEvaluationContext({
      context: 'Contexto geral do projeto X',
      style_profile: null,
      identity,
    })
    expect(result).toContain('Contexto geral do projeto X')
    expect(result).toContain('Inspirar criadores independentes')
    // They appear as separate labeled blocks
    expect(result).toContain('**Contexto do Projeto:**')
    expect(result).toContain('**Propósito:**')
  })
})

describe('case 9 — visual_identity prevalece sobre style_profile', () => {
  it('uses visual_identity when both are present', () => {
    const identity: ProjectIdentity = {
      schema_version: 1,
      expression: { visual_identity: 'Estética raw e granulada' },
    }
    const result = buildImageEvaluationContext({
      context: null,
      style_profile: 'Minimalista clean',
      identity,
    })
    expect(result).toContain('Estética raw e granulada')
    expect(result).not.toContain('Minimalista clean')
  })
})

describe('case 10 — fallback de style_profile quando visual_identity ausente', () => {
  it('uses style_profile when identity has no visual_identity', () => {
    const identity: ProjectIdentity = {
      schema_version: 1,
      foundation: { purpose: 'Propósito sem identidade visual' },
    }
    const result = buildImageEvaluationContext({
      context: null,
      style_profile: 'Cinematográfico dourado',
      identity,
    })
    expect(result).toContain('Cinematográfico dourado')
  })
})

describe('case 11 — voice NÃO entra no contexto visual do avaliador', () => {
  it('omits voice from evaluation context', () => {
    const identity: ProjectIdentity = {
      schema_version: 1,
      expression: {
        visual_identity: 'Tons terrosos',
        voice: 'Tom poético e melancólico',
      },
    }
    const result = buildImageEvaluationContext({ context: null, style_profile: null, identity })
    expect(result).toContain('Tons terrosos')
    expect(result).not.toContain('Tom poético e melancólico')
    expect(result).not.toContain('Voz e Tom')
  })
})

describe('case 12 — principles entram como orientações positivas', () => {
  it('includes principles under the Princípios label', () => {
    const identity: ProjectIdentity = {
      schema_version: 1,
      governance: { principles: ['Beleza sem esforço', 'Humanidade acima da técnica'] },
    }
    const result = buildImageEvaluationContext({ context: null, style_profile: null, identity })
    expect(result).toContain('**Princípios:**')
    expect(result).toContain('- Beleza sem esforço')
    expect(result).toContain('- Humanidade acima da técnica')
  })
})

describe('case 13 — restrictions entram como limites com label enfatizado', () => {
  it('includes restrictions under the emphasized label for violation checking', () => {
    const identity: ProjectIdentity = {
      schema_version: 1,
      governance: { restrictions: ['Sem logos visíveis', 'Sem textos sobrepostos'] },
    }
    const result = buildImageEvaluationContext({ context: null, style_profile: null, identity })
    expect(result).toContain('Restrições (verificar violações no score)')
    expect(result).toContain('- Sem logos visíveis')
    expect(result).toContain('- Sem textos sobrepostos')
  })
})

describe('case 14 — generation_preferences entram como preferências (não regra absoluta)', () => {
  it('includes preferences under the non-absolute preference label', () => {
    const identity: ProjectIdentity = {
      schema_version: 1,
      practice: { generation_preferences: ['Foco em texturas orgânicas'] },
    }
    const result = buildImageEvaluationContext({ context: null, style_profile: null, identity })
    expect(result).toContain('Preferências de Geração (preferência, não regra absoluta)')
    expect(result).toContain('- Foco em texturas orgânicas')
  })
})

describe('case 15 — schema_version não aparece no contexto compilado', () => {
  it('schema_version is never present in the compiled context string', () => {
    const identity: ProjectIdentity = {
      schema_version: 1,
      foundation: { purpose: 'Algum propósito' },
    }
    const result = buildImageEvaluationContext({ context: null, style_profile: null, identity })
    expect(result).not.toContain('schema_version')
    expect(result).not.toContain('"schema_version"')
  })
})

describe('case 16 — JSON bruto não aparece no contexto compilado', () => {
  it('does not contain raw JSON notation', () => {
    const identity: ProjectIdentity = {
      schema_version: 1,
      foundation: { purpose: 'Propósito visível' },
      governance: {
        principles: ['Princípio A'],
        restrictions: ['Restrição B'],
      },
    }
    const result = buildImageEvaluationContext({ context: null, style_profile: null, identity })
    // No JSON curly braces from serialization
    expect(result).not.toMatch(/\{.*"schema_version"/)
    expect(result).not.toMatch(/"foundation":\s*\{/)
  })
})

describe('case 34 — comportamento legado preservado (Project sem identity)', () => {
  it('only context and style_profile appear when identity is absent', () => {
    const result = buildImageEvaluationContext({
      context: 'Contexto de marca legada',
      style_profile: 'Visual editorial clássico',
      identity: null,
    })
    expect(result).toContain('Contexto de marca legada')
    expect(result).toContain('Visual editorial clássico')
    expect(result).not.toContain('Propósito')
    expect(result).not.toContain('Restrições')
  })

  it('returns empty string when all inputs are absent', () => {
    const result = buildImageEvaluationContext({ context: null, style_profile: null, identity: null })
    expect(result).toBe('')
  })
})

// ─── Part 2: Route handler tests (mocked supabase + OpenAI) ──────────────────

describe('route handler — cases 6, 7, 17–33', () => {
  let POST: (req: Request) => Promise<Response>

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    setupAuthSuccess()
    // Dynamic import after vi.mock is set up
    const mod = await import('../../app/api/evaluate-image/route')
    POST = mod.POST
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── Case 6: identity inválida na rota retorna 400 ────────────────────────────
  it('case 6 — invalid identity in route body returns 400', async () => {
    const req = makeRequest(makeBody({ identity: { schema_version: 2, garbage: true } }))
    const res = await POST(req)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('Identity inválida')
  })

  it('case 6b — identity with missing schema_version returns 400', async () => {
    const req = makeRequest(makeBody({ identity: { foundation: { purpose: 'x' } } }))
    const res = await POST(req)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('Identity inválida')
  })

  // ── Case 7: identity inválida não chama OpenAI ────────────────────────────────
  it('case 7 — invalid identity does not call OpenAI', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(openAISuccess())
    const req = makeRequest(makeBody({ identity: { schema_version: 99 } }))
    await POST(req)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  // ── Case 32: body inválido (sem prompt) não chama provider ───────────────────
  it('case 32 — missing generatedPrompt returns 400 without calling OpenAI', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(openAISuccess())
    const req = makeRequest({ imageUrl: VALID_IMAGE_URL })
    const res = await POST(req)
    expect(res.status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  // ── Cases 17–20: userInput, generatedPrompt, evaluation_mode, attempt are sent ─
  it('cases 17–20 — all required inputs reach the OpenAI payload', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(openAISuccess())
    const req = makeRequest(makeBody({
      userInput: 'meu input especifico',
      generatedPrompt: 'o prompt gerado',
      evaluation_mode: 'conceptual',
      attempt: 2,
    }))
    await POST(req)

    const callBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
    const userMsg = callBody.messages[1].content[0].text as string
    expect(userMsg).toContain('meu input especifico')
    expect(userMsg).toContain('o prompt gerado')
    expect(userMsg).toContain('conceptual')
    expect(userMsg).toContain('2 de 3')
  })

  // ── Case 21: imageUrl continues in multimodal payload ───────────────────────
  it('case 21 — imageUrl is present in image_url message part', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(openAISuccess())
    const req = makeRequest(makeBody())
    await POST(req)

    const callBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
    const imagePart = callBody.messages[1].content[1]
    expect(imagePart.type).toBe('image_url')
    expect(imagePart.image_url.url).toBe(VALID_IMAGE_URL)
  })

  // ── Case 22: detail continues `low` ─────────────────────────────────────────
  it('case 22 — image_url detail is low', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(openAISuccess())
    const req = makeRequest(makeBody())
    await POST(req)

    const callBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
    const imagePart = callBody.messages[1].content[1]
    expect(imagePart.image_url.detail).toBe('low')
  })

  // ── Case 23: model unchanged ─────────────────────────────────────────────────
  it('case 23 — model is gpt-4o-mini by default', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(openAISuccess())
    const req = makeRequest(makeBody())
    await POST(req)

    const callBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
    expect(callBody.model).toBe('gpt-4o-mini')
  })

  // ── Cases 24–29: response contract preserved ─────────────────────────────────
  it('cases 24–29 — score, approved, feedback, improvements, refinedPrompt contract', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(openAISuccess({
      score: 80,
      approved: true,
      feedback: 'Bom alinhamento',
      improvements: ['Melhore a iluminação'],
      refinedPrompt: 'Better composition photo',
    }))
    const req = makeRequest(makeBody())
    const res = await POST(req)
    const data = await res.json()

    expect(typeof data.score).toBe('number')
    expect(data.score).toBeGreaterThanOrEqual(0)
    expect(data.score).toBeLessThanOrEqual(100)
    expect(typeof data.approved).toBe('boolean')
    expect(typeof data.feedback).toBe('string')
    expect(Array.isArray(data.improvements)).toBe(true)
    expect(typeof data.refinedPrompt).toBe('string')
    expect(data.score).toBe(80)
    expect(data.approved).toBe(true)
  })

  // ── Case 26: threshold 75 — approved=true when score >= 75 ──────────────────
  it('case 26 — threshold 75: model score=74 → approved=false', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(openAISuccess({ score: 74, approved: false }))
    const req = makeRequest(makeBody())
    const res = await POST(req)
    const data = await res.json()
    expect(data.score).toBe(74)
    expect(data.approved).toBe(false)
  })

  it('case 26b — threshold 75: model score=75 without approved field → approved derived as true', async () => {
    // Model returns score=75 but no approved field — route derives approved from score
    const modelOutput = { score: 75, feedback: 'OK', improvements: [], refinedPrompt: 'same' }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(modelOutput) } }],
    }), { status: 200 }))
    const req = makeRequest(makeBody())
    const res = await POST(req)
    const data = await res.json()
    expect(data.approved).toBe(true)
  })

  // ── Case 30: no universal score cap ─────────────────────────────────────────
  it('case 30 — score=85 with restriction note is NOT capped below 40', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(openAISuccess({
      score: 85,
      approved: true,
      feedback: 'Pequena violação de restrição não material',
      improvements: [],
      refinedPrompt: 'same prompt',
    }))
    const identity: ProjectIdentity = {
      schema_version: 1,
      governance: { restrictions: ['Sem logos'] },
    }
    const req = makeRequest(makeBody({ identity }))
    const res = await POST(req)
    const data = await res.json()
    // Score should come through as-is — no hard cap
    expect(data.score).toBe(85)
  })

  // ── Case 31: material restriction violation can orientate approved=false ─────
  it('case 31 — model can return approved=false for material restriction violation', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(openAISuccess({
      score: 55,
      approved: false,
      feedback: 'Violação de restrição: logo visível',
      improvements: ['Remover o logo da imagem'],
      refinedPrompt: 'same prompt without logo',
    }))
    const identity: ProjectIdentity = {
      schema_version: 1,
      governance: { restrictions: ['Sem logos visíveis'] },
    }
    const req = makeRequest(makeBody({ identity }))
    const res = await POST(req)
    const data = await res.json()
    expect(data.approved).toBe(false)
    expect(data.score).toBe(55)
  })

  // ── Case 33: input objects are not mutated ───────────────────────────────────
  it('case 33 — buildImageEvaluationContext does not mutate its input', () => {
    const identity: ProjectIdentity = {
      schema_version: 1,
      governance: {
        principles: ['P1', 'P2'],
        restrictions: ['R1'],
      },
    }
    const source = { context: 'CTX', style_profile: 'S', identity }
    const originalPrinciples = [...(identity.governance?.principles ?? [])]
    const originalRestrictions = [...(identity.governance?.restrictions ?? [])]
    buildImageEvaluationContext(source)
    expect(identity.governance?.principles).toEqual(originalPrinciples)
    expect(identity.governance?.restrictions).toEqual(originalRestrictions)
    expect(source.context).toBe('CTX')
  })

  // ── identity null → body null: works normally ───────────────────────────────
  it('case 2b — identity null in body is accepted without error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(openAISuccess())
    const req = makeRequest(makeBody({ identity: null }))
    const res = await POST(req)
    expect(res.status).toBe(200)
  })

  // ── identity absent in body → null path ─────────────────────────────────────
  it('case 1b — absent identity in body is accepted without error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(openAISuccess())
    const req = makeRequest(makeBody())
    const res = await POST(req)
    expect(res.status).toBe(200)
  })

  // ── Context compilation is used in the user message ─────────────────────────
  it('evaluation context replaces manual context/style_profile blocks', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(openAISuccess())
    const req = makeRequest(makeBody({
      context: 'Contexto do projeto teste',
      styleProfile: 'Visual minimalista',
    }))
    await POST(req)

    const callBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
    const userMsg = callBody.messages[1].content[0].text as string
    expect(userMsg).toContain('PROJECT CONTEXT AND IDENTITY:')
    expect(userMsg).toContain('Contexto do projeto teste')
    expect(userMsg).not.toContain('context:\nContexto do projeto teste')
    expect(userMsg).not.toContain('style_profile:')
  })

  // ── Governance in system prompt ──────────────────────────────────────────────
  it('system prompt contains governance guidance about principles and restrictions', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(openAISuccess())
    const req = makeRequest(makeBody())
    await POST(req)

    const callBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
    const sysMsg = callBody.messages[0].content as string
    expect(sysMsg).toContain('Principios')
    expect(sysMsg).toContain('Restricoes')
    expect(sysMsg).toContain('approved = false')
    expect(sysMsg).not.toContain('score <= 40')
    // Confirms instruction forbids universal ceiling (present as negative instruction)
    expect(sysMsg).toContain('Nao usar teto numerico')
  })

  // ── response_format json_object preserved ───────────────────────────────────
  it('case 23b — response_format json_object is preserved', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(openAISuccess())
    const req = makeRequest(makeBody())
    await POST(req)

    const callBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
    expect(callBody.response_format).toEqual({ type: 'json_object' })
  })

  // ── valid partial identity accepted, context compiled ────────────────────────
  it('case 3b — valid partial identity is compiled into context without error', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(openAISuccess())
    const identity: ProjectIdentity = {
      schema_version: 1,
      foundation: { purpose: 'Arte premium' },
    }
    const req = makeRequest(makeBody({ identity }))
    const res = await POST(req)
    expect(res.status).toBe(200)

    const callBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
    const userMsg = callBody.messages[1].content[0].text as string
    expect(userMsg).toContain('Arte premium')
  })

  // ── voice excluded from evaluation context reaching the model ────────────────
  it('case 11b — voice is not present in the user message sent to the model', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(openAISuccess())
    const identity: ProjectIdentity = {
      schema_version: 1,
      expression: {
        visual_identity: 'Tons terrosos',
        voice: 'Tom poético confidencial',
      },
    }
    const req = makeRequest(makeBody({ identity }))
    await POST(req)

    const callBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
    const userMsg = callBody.messages[1].content[0].text as string
    expect(userMsg).toContain('Tons terrosos')
    expect(userMsg).not.toContain('Tom poético confidencial')
  })
})
