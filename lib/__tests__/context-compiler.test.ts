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

  it('uses style_profile as fallback when visual_identity is absent', () => {
    const noVisual: ProjectIdentity = {
      schema_version: 1,
      expression: { voice: 'Sutil.' },
    }
    const result = buildImageGenerationContext({
      identity: noVisual,
      style_profile: 'Estilo minimalista legado.',
    })
    expect(result).toContain('Identidade Visual')
    expect(result).toContain('Estilo minimalista legado.')
  })

  it('prefers visual_identity over style_profile (no concatenation)', () => {
    const result = buildImageGenerationContext({
      identity: fullIdentity,
      style_profile: 'Legado que não deve aparecer.',
    })
    expect(result).not.toContain('Legado que não deve aparecer.')
    expect(result).toContain('Paleta terrosa')
  })

  it('omits blocks whose values are null or undefined', () => {
    const result = buildImageGenerationContext({
      context: null,
      style_profile: null,
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
      style_profile: 'legado',
      identity: fullIdentity,
    }
    const contextBefore = source.context
    const profileBefore = source.style_profile
    buildImageGenerationContext(source)
    expect(source.context).toBe(contextBefore)
    expect(source.style_profile).toBe(profileBefore)
    expect(source.identity).toBe(fullIdentity)
  })

  it('buildImageEvaluationContext does not mutate the source object', () => {
    const source: ProjectContextSource = { context: 'ctx', identity: fullIdentity }
    buildImageEvaluationContext(source)
    expect(source.context).toBe('ctx')
    expect(source.identity).toBe(fullIdentity)
  })
})
