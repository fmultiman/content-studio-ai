import { describe, it, expect } from 'vitest'
import { buildImageGenerationContext, buildImageEvaluationContext } from '../context-compiler'
import type { ProjectContextSource } from '../context-compiler'
import type { ProjectIdentity } from '../schemas/project-identity'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const fullIdentity: ProjectIdentity = {
  schema_version: 1,
  foundation: { purpose: 'Iluminar criadores.' },
  relationship: { audience: 'Artistas independentes.' },
  expression: {
    visual_identity: 'Paleta terrosa, tipografia serifada.',
    voice: 'Direto e poético.',
  },
  governance: {
    principles: ['Autenticidade'],
    restrictions: ['Sem logos de terceiros'],
  },
  practice: {
    generation_preferences: ['Luz natural'],
  },
}

const emptySource: ProjectContextSource = {}

// ─── buildImageGenerationContext ───────────────────────────────────────────────

describe('buildImageGenerationContext', () => {
  it('returns empty string when source is empty', () => {
    expect(buildImageGenerationContext(emptySource)).toBe('')
  })

  it('includes context when present', () => {
    const result = buildImageGenerationContext({ context: 'Contexto geral.' })
    expect(result).toContain('Contexto do Projeto')
    expect(result).toContain('Contexto geral.')
  })

  it('includes foundation.purpose when present', () => {
    const result = buildImageGenerationContext({ identity: fullIdentity })
    expect(result).toContain('Propósito')
    expect(result).toContain('Iluminar criadores.')
  })

  it('includes relationship.audience when present', () => {
    const result = buildImageGenerationContext({ identity: fullIdentity })
    expect(result).toContain('Audiência')
    expect(result).toContain('Artistas independentes.')
  })

  it('includes visual_identity from identity.expression', () => {
    const result = buildImageGenerationContext({ identity: fullIdentity })
    expect(result).toContain('Identidade Visual')
    expect(result).toContain('Paleta terrosa')
  })

  it('includes voice from identity.expression', () => {
    const result = buildImageGenerationContext({ identity: fullIdentity })
    expect(result).toContain('Voz e Tom')
    expect(result).toContain('Direto e poético.')
  })

  it('includes governance.principles', () => {
    const result = buildImageGenerationContext({ identity: fullIdentity })
    expect(result).toContain('Princípios')
    expect(result).toContain('Autenticidade')
  })

  it('includes governance.restrictions', () => {
    const result = buildImageGenerationContext({ identity: fullIdentity })
    expect(result).toContain('Restrições')
    expect(result).toContain('Sem logos de terceiros')
  })

  it('includes practice.generation_preferences', () => {
    const result = buildImageGenerationContext({ identity: fullIdentity })
    expect(result).toContain('Preferências de Geração')
    expect(result).toContain('Luz natural')
  })

  it('returns empty string when identity has no visual_identity and no context', () => {
    const noVisual: ProjectIdentity = {
      schema_version: 1,
      expression: { voice: 'Sutil.' },
    }
    const result = buildImageGenerationContext({ identity: noVisual })
    expect(result).toContain('Voz e Tom')
    expect(result).not.toContain('Identidade Visual')
  })

  it('omits Identidade Visual block when visual_identity is absent', () => {
    const noVisual: ProjectIdentity = {
      schema_version: 1,
      foundation: { purpose: 'Só foundation.' },
    }
    const result = buildImageGenerationContext({ identity: noVisual })
    expect(result).not.toContain('Identidade Visual')
  })

  it('omits blocks whose values are null or undefined', () => {
    const result = buildImageGenerationContext({
      context: null,
      identity: null,
    })
    expect(result).toBe('')
  })

  it('outputs blocks in the correct order', () => {
    const result = buildImageGenerationContext({
      context: 'ctx',
      identity: fullIdentity,
    })
    const ctxIdx = result.indexOf('Contexto do Projeto')
    const purposeIdx = result.indexOf('Propósito')
    const audienceIdx = result.indexOf('Audiência')
    const visualIdx = result.indexOf('Identidade Visual')
    const voiceIdx = result.indexOf('Voz e Tom')
    const principlesIdx = result.indexOf('Princípios')
    const restrictionsIdx = result.indexOf('Restrições')
    const prefIdx = result.indexOf('Preferências de Geração')

    expect(ctxIdx).toBeLessThan(purposeIdx)
    expect(purposeIdx).toBeLessThan(audienceIdx)
    expect(audienceIdx).toBeLessThan(visualIdx)
    expect(visualIdx).toBeLessThan(voiceIdx)
    expect(voiceIdx).toBeLessThan(principlesIdx)
    expect(principlesIdx).toBeLessThan(restrictionsIdx)
    expect(restrictionsIdx).toBeLessThan(prefIdx)
  })

  it('context and purpose are both present and separate (not merged)', () => {
    const result = buildImageGenerationContext({
      context: 'Narrativa geral.',
      identity: { schema_version: 1, foundation: { purpose: 'Raison dêtre.' } },
    })
    expect(result).toContain('Contexto do Projeto')
    expect(result).toContain('Narrativa geral.')
    expect(result).toContain('Propósito')
    expect(result).toContain("Raison dêtre.")
  })
})

// ─── buildImageEvaluationContext ──────────────────────────────────────────────

describe('buildImageEvaluationContext', () => {
  it('returns empty string when source is empty', () => {
    expect(buildImageEvaluationContext(emptySource)).toBe('')
  })

  it('includes context when present', () => {
    const result = buildImageEvaluationContext({ context: 'Contexto geral.' })
    expect(result).toContain('Contexto do Projeto')
  })

  it('includes foundation.purpose', () => {
    const result = buildImageEvaluationContext({ identity: fullIdentity })
    expect(result).toContain('Propósito')
  })

  it('includes relationship.audience', () => {
    const result = buildImageEvaluationContext({ identity: fullIdentity })
    expect(result).toContain('Audiência')
  })

  it('includes visual_identity', () => {
    const result = buildImageEvaluationContext({ identity: fullIdentity })
    expect(result).toContain('Identidade Visual')
  })

  it('does NOT include voice (not relevant to image scoring)', () => {
    const result = buildImageEvaluationContext({ identity: fullIdentity })
    expect(result).not.toContain('Voz e Tom')
  })

  it('includes governance.principles', () => {
    const result = buildImageEvaluationContext({ identity: fullIdentity })
    expect(result).toContain('Princípios')
  })

  it('includes restrictions with emphasis label', () => {
    const result = buildImageEvaluationContext({ identity: fullIdentity })
    expect(result).toContain('verificar violações')
    expect(result).toContain('Sem logos de terceiros')
  })

  it('includes generation_preferences with preference label', () => {
    const result = buildImageEvaluationContext({ identity: fullIdentity })
    expect(result).toContain('preferência, não regra absoluta')
    expect(result).toContain('Luz natural')
  })

  it('omits Identidade Visual block when visual_identity is absent', () => {
    const noVisual: ProjectIdentity = {
      schema_version: 1,
      foundation: { purpose: 'Só foundation.' },
    }
    const result = buildImageEvaluationContext({ identity: noVisual })
    expect(result).not.toContain('Identidade Visual')
  })

  it('outputs blocks in the correct order (no voice block)', () => {
    const result = buildImageEvaluationContext({
      context: 'ctx',
      identity: fullIdentity,
    })
    const ctxIdx = result.indexOf('Contexto do Projeto')
    const purposeIdx = result.indexOf('Propósito')
    const audienceIdx = result.indexOf('Audiência')
    const visualIdx = result.indexOf('Identidade Visual')
    const principlesIdx = result.indexOf('Princípios')
    const restrictionsIdx = result.indexOf('verificar violações')
    const prefIdx = result.indexOf('preferência, não regra absoluta')

    expect(ctxIdx).toBeLessThan(purposeIdx)
    expect(purposeIdx).toBeLessThan(audienceIdx)
    expect(audienceIdx).toBeLessThan(visualIdx)
    expect(visualIdx).toBeLessThan(principlesIdx)
    expect(principlesIdx).toBeLessThan(restrictionsIdx)
    expect(restrictionsIdx).toBeLessThan(prefIdx)
  })
})

// ─── Determinism and immutability ─────────────────────────────────────────────

describe('formatter determinism and immutability', () => {
  it('buildImageGenerationContext returns the same output for the same input', () => {
    const source: ProjectContextSource = { context: 'ctx', identity: fullIdentity }
    expect(buildImageGenerationContext(source)).toBe(buildImageGenerationContext(source))
  })

  it('buildImageEvaluationContext returns the same output for the same input', () => {
    const source: ProjectContextSource = { context: 'ctx', identity: fullIdentity }
    expect(buildImageEvaluationContext(source)).toBe(buildImageEvaluationContext(source))
  })

  it('buildImageGenerationContext does not mutate the source object', () => {
    const source: ProjectContextSource = {
      context: 'ctx',
      identity: fullIdentity,
    }
    const contextBefore = source.context
    buildImageGenerationContext(source)
    expect(source.context).toBe(contextBefore)
    expect(source.identity).toBe(fullIdentity)
  })

  it('buildImageEvaluationContext does not mutate the source object', () => {
    const source: ProjectContextSource = { context: 'ctx', identity: fullIdentity }
    buildImageEvaluationContext(source)
    expect(source.context).toBe('ctx')
    expect(source.identity).toBe(fullIdentity)
  })
})

// ─── No style_profile fallback (M11-G) ───────────────────────────────────────

describe('no style_profile fallback — M11-G', () => {
  it('identity without visual_identity produces no Identidade Visual block (no fallback)', () => {
    const noVisual: ProjectIdentity = {
      schema_version: 1,
      foundation: { purpose: 'Purpose only, no visual_identity' },
    }
    const result = buildImageGenerationContext({ identity: noVisual })
    expect(result).not.toContain('Identidade Visual')
    expect(result).toContain('Propósito')
  })

  it('identity null with context only produces only context block', () => {
    const result = buildImageGenerationContext({ context: 'Só contexto.', identity: null })
    expect(result).toContain('Contexto do Projeto')
    expect(result).not.toContain('Identidade Visual')
  })

  it('buildImageEvaluationContext: no fallback when visual_identity absent', () => {
    const noVisual: ProjectIdentity = {
      schema_version: 1,
      governance: { restrictions: ['Sem clichê'] },
    }
    const result = buildImageEvaluationContext({ identity: noVisual })
    expect(result).not.toContain('Identidade Visual')
    expect(result).toContain('verificar violações')
  })
})
