import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateImagePrompt } from '../ai-simulator'
import { normalizeProjectIdentity, ProjectIdentityParseError } from '../project-identity-normalizer'
import { buildImageGenerationContext } from '../context-compiler'
import type { ProjectIdentity } from '../schemas/project-identity'

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Call generateImagePrompt via simulated path (no apiKey) with fake timers. */
async function callSimulated(
  userInput: string,
  projectContext: string | null,
  evaluationMode: 'default' | 'conceptual' | 'aesthetic' | 'commercial' | 'experimental' = 'default',
  identity: ProjectIdentity | null = null,
) {
  const p = generateImagePrompt(userInput, projectContext, undefined, evaluationMode, identity)
  await vi.runAllTimersAsync()
  return p
}

// ─── Case 1: Project sem identity + context ───────────────────────────────────

describe('case 1 — sem identity: context preservado', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('includes context in the prompt when identity is null', async () => {
    const result = await callSimulated('foto de produto', 'Contexto legado do projeto')
    expect(result.prompt).toContain('Contexto legado do projeto')
  })

  it('uses detectStyle when identity is null and no visual_identity', async () => {
    const result = await callSimulated('foto de produto', null)
    expect(typeof result.style).toBe('string')
    expect(result.style.length).toBeGreaterThan(0)
  })

  it('returns PromptGenerationResult contract: prompt, style, lighting, composition', async () => {
    const result = await callSimulated('test input', null)
    expect(result).toHaveProperty('prompt')
    expect(result).toHaveProperty('style')
    expect(result).toHaveProperty('lighting')
    expect(result).toHaveProperty('composition')
    expect(typeof result.prompt).toBe('string')
    expect(result.prompt.length).toBeGreaterThan(0)
  })
})

// ─── Case 2: identity parcial ─────────────────────────────────────────────────

describe('case 2 — identity parcial (só foundation)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('includes purpose in prompt when only foundation is defined', async () => {
    const identity: ProjectIdentity = {
      schema_version: 1,
      foundation: { purpose: 'Criação de arte minimalista para marcas premium' },
    }
    const result = await callSimulated('logo concept', null, 'default', identity)
    expect(result.prompt).toContain('arte minimalista para marcas premium')
  })

  it('does not include audience when relationship is absent', async () => {
    const identity: ProjectIdentity = {
      schema_version: 1,
      foundation: { purpose: 'Somente propósito' },
    }
    const result = await callSimulated('input', null, 'default', identity)
    expect(result.prompt).not.toContain('Audiência')
  })
})

// ─── Case 3: identity completa ────────────────────────────────────────────────

describe('case 3 — identity completa: todas as dimensões no prompt', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('includes all identity dimensions in the compiled context', async () => {
    const identity: ProjectIdentity = {
      schema_version: 1,
      foundation: { purpose: 'Arte conceitual abstrata' },
      relationship: { audience: 'Colecionadores europeus' },
      expression: { visual_identity: 'Paleta monocromática', voice: 'Tom filosófico' },
      governance: { principles: ['Originalidade radical'], restrictions: ['Sem referências comerciais'] },
      practice: { generation_preferences: ['Composição fragmentada'] },
    }
    const result = await callSimulated('imagem abstrata', null, 'default', identity)
    expect(result.prompt).toContain('Arte conceitual abstrata')
    expect(result.prompt).toContain('Colecionadores europeus')
    expect(result.prompt).toContain('Paleta monocromática')
    expect(result.prompt).toContain('Originalidade radical')
    expect(result.prompt).toContain('Sem referências comerciais')
    expect(result.prompt).toContain('Composição fragmentada')
  })
})

// ─── Case 4: context e purpose separados ─────────────────────────────────────

describe('case 4 — context e purpose aparecem separados no compiled context', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('both context and purpose are present independently in the prompt', async () => {
    const identity: ProjectIdentity = {
      schema_version: 1,
      foundation: { purpose: 'Propósito estruturado da identidade' },
    }
    const result = await callSimulated(
      'foto para campanha',
      'Contexto geral do projeto diferente do propósito',
      'default',
      identity,
    )
    expect(result.prompt).toContain('Contexto geral do projeto diferente do propósito')
    expect(result.prompt).toContain('Propósito estruturado da identidade')
  })
})

// ─── Case 5: visual_identity usada quando presente ───────────────────────────

describe('case 5 — visual_identity é a fonte canônica de identidade visual', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('uses visual_identity as style when identity has it', async () => {
    const identity: ProjectIdentity = {
      schema_version: 1,
      expression: { visual_identity: 'Estética dark neo-noir' },
    }
    const result = await callSimulated('cena urbana', null, 'default', identity)
    expect(result.style).toBe('Estética dark neo-noir')
    expect(result.prompt).toContain('Estética dark neo-noir')
  })

  it('falls back to detectStyle when identity has no visual_identity', async () => {
    const identity: ProjectIdentity = {
      schema_version: 1,
      foundation: { purpose: 'Purpose sem visual' },
    }
    const result = await callSimulated('cyberpunk city', null, 'default', identity)
    expect(typeof result.style).toBe('string')
    expect(result.style.length).toBeGreaterThan(0)
  })
})

// ─── Case 6 (M11-G): sem style_profile — identity null usa detectStyle ────────

describe('case 6 (M11-G) — identity null: style derivado de detectStyle, não de style_profile legado', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('identity null uses detectStyle based on userInput keywords', async () => {
    const result = await callSimulated('cyberpunk city', null, 'default', null)
    expect(result.style).toContain('cyberpunk')
  })

  it('identity null with context: context still appears in prompt', async () => {
    const result = await callSimulated('paisagem', 'Contexto puro sem identity', 'default', null)
    expect(result.prompt).toContain('Contexto puro sem identity')
  })

  it('no Identidade Visual block when identity is null', async () => {
    const result = await callSimulated('cena simples', null, 'default', null)
    expect(result.prompt).not.toContain('Identidade Visual')
  })
})

// ─── Case 7: principles entram como orientações positivas ────────────────────

describe('case 7 — principles entram como orientações positivas', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('includes governance principles in the prompt', async () => {
    const identity: ProjectIdentity = {
      schema_version: 1,
      governance: { principles: ['Originalidade radical', 'Minimalismo intencional'] },
    }
    const result = await callSimulated('imagem', null, 'default', identity)
    expect(result.prompt).toContain('Originalidade radical')
    expect(result.prompt).toContain('Minimalismo intencional')
  })
})

// ─── Case 8: restrictions entram como limites ─────────────────────────────────

describe('case 8 — restrictions entram como limites explícitos', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('includes governance restrictions in the prompt', async () => {
    const identity: ProjectIdentity = {
      schema_version: 1,
      governance: { restrictions: ['Sem logos de terceiros', 'Sem filtros excessivos'] },
    }
    const result = await callSimulated('produto', null, 'default', identity)
    expect(result.prompt).toContain('Sem logos de terceiros')
    expect(result.prompt).toContain('Sem filtros excessivos')
  })
})

// ─── Case 9: generation_preferences entram como preferências ─────────────────

describe('case 9 — generation_preferences entram como preferências', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('includes practice preferences in the prompt', async () => {
    const identity: ProjectIdentity = {
      schema_version: 1,
      practice: { generation_preferences: ['Luz natural', 'Enquadramento amplo'] },
    }
    const result = await callSimulated('cena externa', null, 'default', identity)
    expect(result.prompt).toContain('Luz natural')
    expect(result.prompt).toContain('Enquadramento amplo')
  })
})

// ─── Case 10: schema_version não aparece no prompt ───────────────────────────

describe('case 10 — schema_version nunca aparece no prompt', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('does not include schema_version in the generated prompt', async () => {
    const identity: ProjectIdentity = {
      schema_version: 1,
      foundation: { purpose: 'Projeto com identidade completa' },
      expression: { visual_identity: 'Visual premium' },
    }
    const result = await callSimulated('input', 'contexto', 'default', identity)
    expect(result.prompt).not.toContain('schema_version')
    expect(result.prompt).not.toContain('"schema_version"')
  })
})

// ─── Case 11: JSON bruto não aparece no prompt ────────────────────────────────

describe('case 11 — JSON bruto nunca aparece no prompt', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('does not include raw JSON structure in the prompt', async () => {
    const identity: ProjectIdentity = {
      schema_version: 1,
      foundation: { purpose: 'Test' },
      governance: { principles: ['P1'], restrictions: ['R1'] },
    }
    const result = await callSimulated('test', null, 'default', identity)
    expect(result.prompt).not.toMatch(/"\w+":\s*\{/)
    expect(result.prompt).not.toContain('"schema_version": 1')
    expect(result.prompt).not.toContain('JSON')
  })
})

// ─── Cases 12 & 13: identity inválida bloqueia geração ───────────────────────

describe('cases 12 & 13 — identity inválida: normalização lança erro, não fallback silencioso', () => {
  it('throws ProjectIdentityParseError for invalid schema_version', () => {
    expect(() => normalizeProjectIdentity({ schema_version: 2 })).toThrow(ProjectIdentityParseError)
  })

  it('throws ProjectIdentityParseError for unknown top-level key', () => {
    expect(() => normalizeProjectIdentity({ schema_version: 1, unknownKey: 'bad' })).toThrow(ProjectIdentityParseError)
  })

  it('throws for non-object input (proves page must block before calling generator)', () => {
    expect(() => normalizeProjectIdentity('not an object')).toThrow(ProjectIdentityParseError)
  })

  it('throws for wrong nested structure', () => {
    expect(() =>
      normalizeProjectIdentity({ schema_version: 1, foundation: { purpose: 123 } })
    ).toThrow(ProjectIdentityParseError)
  })
})

// ─── Case 14: identity null — context continua funcionando ───────────────────

describe('case 14 — identity null: context continua sendo usado', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('uses context when identity is null', async () => {
    const result = await callSimulated('foto', 'Contexto legado', 'default', null)
    expect(result.prompt).toContain('Contexto legado')
  })

  it('behaves identically whether identity is null or not passed (default)', async () => {
    const p1 = generateImagePrompt('foto', 'ctx', undefined, 'default', null)
    const p2 = generateImagePrompt('foto', 'ctx', undefined, 'default')
    await vi.runAllTimersAsync()
    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1.style).toBe(r2.style)
  })
})

// ─── Case 15: evaluation_mode continua chegando sem alteração ────────────────

describe('case 15 — evaluation_mode inalterado', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('conceptual mode includes symbolic guidance regardless of identity', async () => {
    const result = await callSimulated('cena abstrata', null, 'conceptual', null)
    expect(result.prompt).toContain('symbolic')
  })

  it('commercial mode includes impact guidance', async () => {
    const result = await callSimulated('produto', null, 'commercial', null)
    expect(result.prompt.toLowerCase()).toMatch(/commercial|impact|visual/)
  })

  it('evaluation_mode is unaffected by presence of identity', async () => {
    const identity: ProjectIdentity = { schema_version: 1, foundation: { purpose: 'Conceptual project' } }
    const resultConceptual = await callSimulated('imagem', null, 'conceptual', identity)
    expect(resultConceptual.prompt).toContain('symbolic')
  })
})

// ─── Case 17: output mantém contrato atual ────────────────────────────────────

describe('case 17 — output contract unchanged', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('always returns { prompt, style, lighting, composition }', async () => {
    const identity: ProjectIdentity = {
      schema_version: 1,
      foundation: { purpose: 'Test' },
      expression: { visual_identity: 'Dark aesthetic' },
    }
    const result = await callSimulated('portrait', 'ctx', 'aesthetic', identity)
    expect(typeof result.prompt).toBe('string')
    expect(typeof result.style).toBe('string')
    expect(typeof result.lighting).toBe('string')
    expect(typeof result.composition).toBe('string')
    expect(result.prompt.trim().length).toBeGreaterThan(0)
  })
})

// ─── Case 18: fallback simulado continua funcional ────────────────────────────

describe('case 18 — simulated fallback works with all identity states', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('simulated path succeeds with full identity', async () => {
    const identity: ProjectIdentity = {
      schema_version: 1,
      foundation: { purpose: 'p' },
      relationship: { audience: 'a' },
      expression: { visual_identity: 'v', voice: 'voz' },
      governance: { principles: ['P1'], restrictions: ['R1'] },
      practice: { generation_preferences: ['G1'] },
    }
    const result = await callSimulated('input', null, 'default', identity)
    expect(result.prompt.length).toBeGreaterThan(0)
  })

  it('simulated path succeeds with null identity', async () => {
    const result = await callSimulated('input', 'ctx', 'default', null)
    expect(result.prompt.length).toBeGreaterThan(0)
  })

  it('simulated path succeeds with no context and no identity', async () => {
    const result = await callSimulated('input', null, 'default', null)
    expect(result.prompt.length).toBeGreaterThan(0)
  })
})

// ─── Case 19: não mutação de identity ────────────────────────────────────────

describe('case 19 — identity object not mutated after generateImagePrompt', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('identity object is unchanged after prompt generation', async () => {
    const identity: ProjectIdentity = {
      schema_version: 1,
      foundation: { purpose: 'Original' },
      governance: { principles: ['P1', 'P2'] },
    }
    const snapshot = JSON.parse(JSON.stringify(identity))
    await callSimulated('input', null, 'default', identity)
    expect(identity).toEqual(snapshot)
  })
})

// ─── Case 20: determinismo da montagem de contexto ────────────────────────────

describe('case 20 — compiled context is deterministic', () => {
  it('same identity and context always produce same compiled context string', () => {
    const identity: ProjectIdentity = {
      schema_version: 1,
      foundation: { purpose: 'Arte minimalista' },
      expression: { visual_identity: 'Dark aesthetic' },
    }
    const source = { context: 'Contexto fixo', identity }
    const r1 = buildImageGenerationContext(source)
    const r2 = buildImageGenerationContext(source)
    expect(r1).toBe(r2)
    expect(r1).toContain('Arte minimalista')
    expect(r1).toContain('Dark aesthetic')
  })
})

// ─── OpenAI path: verifica formato do userMessage ────────────────────────────

describe('OpenAI path — userMessage format with mocked fetch', () => {
  afterEach(() => vi.restoreAllMocks())

  it('sends PROJECT CONTEXT AND IDENTITY block instead of separate context/style_profile fields', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'generated prompt text' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const identity: ProjectIdentity = {
      schema_version: 1,
      foundation: { purpose: 'Conteúdo visual para marcas independentes' },
    }

    await generateImagePrompt('portrait shot', 'legacy context', 'fake-key', 'default', identity)

    expect(mockFetch).toHaveBeenCalledOnce()
    const callBody = JSON.parse(mockFetch.mock.calls[0][1]!.body as string)
    const userMsg: string = callBody.messages.find((m: { role: string }) => m.role === 'user')?.content ?? ''

    expect(userMsg).toContain('PROJECT CONTEXT AND IDENTITY:')
    expect(userMsg).not.toContain('style_profile:')
    expect(userMsg).not.toContain('context:\nlegacy context')
    expect(userMsg).toContain('Conteúdo visual para marcas independentes')
    expect(userMsg).toContain('legacy context') // context is compiled into the block
    expect(userMsg).not.toContain('schema_version')
  })

  it('sends Not specified when no context or identity', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'a prompt' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    await generateImagePrompt('simple input', null, 'fake-key', 'default', null)

    const callBody = JSON.parse(mockFetch.mock.calls[0][1]!.body as string)
    const userMsg: string = callBody.messages.find((m: { role: string }) => m.role === 'user')?.content ?? ''

    expect(userMsg).toContain('PROJECT CONTEXT AND IDENTITY:\nNot specified')
  })

  it('visual_identity is used as style display field', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'match lighting composition and more text here' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const identity: ProjectIdentity = {
      schema_version: 1,
      expression: { visual_identity: 'Estetica preferida da identidade' },
    }

    const result = await generateImagePrompt('input', null, 'fake-key', 'default', identity)
    expect(result.style).toBe('Estetica preferida da identidade')
  })

  it('detectStyle is used when identity has no visual_identity (OpenAI path)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'a generated prompt' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const result = await generateImagePrompt('cyberpunk city', null, 'fake-key', 'default', null)
    expect(result.style).toContain('cyberpunk')
  })
})

// ─── Metadata Refinement — chips backed by model output only (M11-D closure) ──

describe('metadata refinement — OpenAI path extracts or returns null, never random fallback', () => {
  afterEach(() => vi.restoreAllMocks())

  it('test 1 — extracts lighting chip when model output contains "lighting"', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'a studio with soft rim lighting with diffused fill, centered framing' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    const result = await generateImagePrompt('portrait', null, 'fake-key')
    expect(result.lighting).toBe('lighting with diffused fill')
  })

  it('test 2 — returns null lighting when model output has no "lighting" keyword', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'a red circle on a white background' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    const result = await generateImagePrompt('circle', null, 'fake-key')
    expect(result.lighting).toBeNull()
  })

  it('test 3 — extracts composition chip when model output contains "composition"', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'wide-angle composition for the mountain scene' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    const result = await generateImagePrompt('mountain', null, 'fake-key')
    expect(result.composition).toBe('composition for the mountain scene')
  })

  it('test 4 — returns null composition when model output has no "composition" keyword', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'a flat lay of coffee beans on burlap' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    const result = await generateImagePrompt('coffee', null, 'fake-key')
    expect(result.composition).toBeNull()
  })

  it('test 5 — null is deterministic: no random array value leaks into OpenAI path', async () => {
    const promptWithNoKeywords = 'minimalist product shot on white'
    const results = await Promise.all(
      Array.from({ length: 4 }, () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
          new Response(
            JSON.stringify({ choices: [{ message: { content: promptWithNoKeywords } }] }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
        return generateImagePrompt('product', null, 'fake-key')
      }),
    )
    for (const r of results) {
      expect(r.lighting).toBeNull()
      expect(r.composition).toBeNull()
    }
  })

  it('test 6 — null lighting and composition are valid PromptGenerationResult values', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'dark moody scene' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    const result = await generateImagePrompt('scene', null, 'fake-key')
    expect(result).toHaveProperty('lighting')
    expect(result).toHaveProperty('composition')
    if (result.lighting !== null) {
      expect(result.prompt).toMatch(/lighting/i)
    }
    if (result.composition !== null) {
      expect(result.prompt).toMatch(/composition/i)
    }
  })
})

describe('metadata refinement — simulated path retains random values embedded in prompt', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('test 7 — simulated path always produces non-null lighting (embedded in prompt)', async () => {
    const result = await callSimulated('landscape', null)
    expect(result.lighting).not.toBeNull()
    expect(typeof result.lighting).toBe('string')
    expect((result.lighting as string).length).toBeGreaterThan(0)
  })

  it('test 8 — simulated lighting and composition values are embedded in result.prompt', async () => {
    const result = await callSimulated('forest scene', null)
    expect(result.prompt).toContain(result.lighting as string)
    expect(result.prompt).toContain(result.composition as string)
  })

  it('test 9 — style precedence: visual_identity > detectStyle (simulated)', async () => {
    const withVisual = await callSimulated('shot', 'ctx', 'default', {
      schema_version: 1,
      expression: { visual_identity: 'Neo-noir' },
    })
    expect(withVisual.style).toBe('Neo-noir')

    const withDetect = await callSimulated('cyberpunk city', null, 'default', null)
    expect(withDetect.style).toContain('cyberpunk')
  })

  it('test 10 — prompt string is unaffected by metadata chip changes; contract intact', async () => {
    const result = await callSimulated('product photo', 'project context', 'default', {
      schema_version: 1,
      foundation: { purpose: 'Brand identity' },
    })
    expect(typeof result.prompt).toBe('string')
    expect(result.prompt.length).toBeGreaterThan(0)
    expect(result.prompt).toContain('Brand identity')
    expect(result.prompt).toContain('project context')
  })
})
