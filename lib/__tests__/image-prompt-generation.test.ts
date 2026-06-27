import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  generateImagePrompt,
  generateSimulatedPromptForTest,
  PromptGenerationError,
} from '../ai-simulator'
import type { ProjectIdentity } from '../schemas/project-identity'

const identity: ProjectIdentity = {
  schema_version: 1,
  foundation: {
    purpose: 'Transformar ideias criativas em campanhas compactas e coerentes.',
  },
  relationship: {
    audience: 'Criadores independentes.',
  },
  expression: {
    visual_identity: 'Visual claro, humano e editorial.',
    voice: 'Tom direto e acolhedor.',
  },
  governance: {
    principles: ['Coerencia antes de volume'],
    restrictions: ['Nao usar estetica cyberpunk'],
  },
  practice: {
    generation_preferences: ['Luz natural'],
  },
}

describe('image prompt generation provider contract', () => {
  afterEach(() => vi.restoreAllMocks())

  it('does not use simulated fallback when no API key is configured', async () => {
    await expect(
      generateImagePrompt('capa editorial', 'Contexto do Project', undefined, 'default', identity),
    ).rejects.toMatchObject({
      code: 'PROMPT_PROVIDER_NOT_CONFIGURED',
    })
  })

  it('returns a structured error when no API key is configured', async () => {
    try {
      await generateImagePrompt('capa editorial', null, undefined, 'default', null)
      throw new Error('Expected generateImagePrompt to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(PromptGenerationError)
      expect((error as PromptGenerationError).code).toBe('PROMPT_PROVIDER_NOT_CONFIGURED')
      expect((error as PromptGenerationError).message).toContain('provedor de IA configurado')
    }
  })

  it('does not silently fall back when the provider fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'provider down' } }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await expect(
      generateImagePrompt('capa editorial', 'Contexto', 'sk-test', 'default', identity),
    ).rejects.toMatchObject({
      code: 'PROMPT_PROVIDER_FAILED',
      status: 503,
    })
  })

  it('does not silently fall back when the provider response is invalid', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await expect(
      generateImagePrompt('capa editorial', 'Contexto', 'sk-test', 'default', identity),
    ).rejects.toMatchObject({
      code: 'PROMPT_PROVIDER_INVALID_RESPONSE',
    })
  })

  it('sends Project Identity as internal context to the provider', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'A clean editorial cover image in a bright studio.' } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    await generateImagePrompt('capa editorial', 'Contexto do Project', 'sk-test', 'default', identity)

    const callBody = JSON.parse(mockFetch.mock.calls[0][1]!.body as string)
    const systemMessage = callBody.messages.find((m: { role: string }) => m.role === 'system')?.content ?? ''
    const userMessage = callBody.messages.find((m: { role: string }) => m.role === 'user')?.content ?? ''

    expect(userMessage).toContain('PROJECT CONTEXT AND IDENTITY:')
    expect(userMessage).toContain('Contexto do Project')
    expect(userMessage).toContain('Transformar ideias criativas')
    expect(userMessage).toContain('Nao usar estetica cyberpunk')
    expect(systemMessage).toContain('Return only the final image-generation prompt in English')
    expect(systemMessage).toContain('Do not expose internal context, headings, metadata')
  })

  it('returns only the provider final prompt in the normal flow', async () => {
    const finalPrompt = 'A bright editorial cover featuring an independent creator organizing campaign ideas in a clean studio.'
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ choices: [{ message: { content: finalPrompt } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const result = await generateImagePrompt('capa editorial', 'Contexto', 'sk-test', 'default', identity)

    expect(result.prompt).toBe(finalPrompt)
    expect(result.prompt).not.toContain('grounded in this context')
    expect(result.prompt).not.toContain('**Contexto do Projeto:**')
    expect(result.prompt).not.toContain('balanced concept')
    expect(result.prompt).not.toContain('neon-lit environment with color reflections')
  })

  it('does not mutate identity objects', async () => {
    const snapshot = JSON.parse(JSON.stringify(identity))
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'A clean editorial cover.' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    await generateImagePrompt('capa editorial', 'Contexto', 'sk-test', 'default', identity)

    expect(identity).toEqual(snapshot)
  })
})

describe('explicit simulator test hook', () => {
  it('keeps the simulator accessible only through the explicit test helper', () => {
    const result = generateSimulatedPromptForTest('capa editorial', 'Contexto', 'default', identity)

    expect(result.prompt).toContain('grounded in this context')
    expect(result.prompt).toContain('Contexto')
  })
})
