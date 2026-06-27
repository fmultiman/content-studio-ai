import { describe, expect, it } from 'vitest'
import type { ProjectIdentity } from '../schemas/project-identity'
import {
  getWorkspaceIdentityCopy,
  resolveInheritedIdentitySummary,
  shouldShowEditorialIdentityContext,
  truncateIdentityText,
} from '../inherited-project-identity'

const completeIdentity: ProjectIdentity = {
  schema_version: 1,
  foundation: {
    purpose: 'Explorar relações entre tecnologia, cultura e imaginação.',
  },
  relationship: {
    audience: 'Criadores e pesquisadores culturais.',
  },
  expression: {
    visual_identity: 'Atmosférica, editorial e simbólica.',
    voice: 'Clara, ensaística e convidativa.',
  },
  governance: {
    principles: ['Rigor cultural', 'Imaginação aplicada', 'Continuidade editorial'],
    restrictions: ['Evitar promessas mágicas', 'Não usar jargão vazio'],
  },
  practice: {
    generation_preferences: ['Priorizar exemplos concretos', 'Manter linguagem PT-BR'],
  },
}

describe('inherited Project Identity UX helpers', () => {
  it('resolves a complete identity without duplicating the full form', () => {
    const summary = resolveInheritedIdentitySummary({
      identity: completeIdentity,
      projectName: 'Portal Norte',
    })

    expect(summary.kind).toBe('complete')
    expect(summary.headline).toBe('Identidade herdada de Portal Norte')
    expect(summary.purpose).toBe(completeIdentity.foundation?.purpose)
    expect(summary.audience).toBe(completeIdentity.relationship?.audience)
    expect(summary.visualIdentity).toBe(completeIdentity.expression?.visual_identity)
    expect(summary.principleCount).toBe(3)
    expect(summary.restrictionCount).toBe(2)
    expect(summary.preferenceCount).toBe(2)
  })

  it('classifies partial identity and keeps populated dimensions visible', () => {
    const partialIdentity: ProjectIdentity = {
      schema_version: 1,
      foundation: { purpose: 'Criar presença editorial reconhecível.' },
      governance: { restrictions: ['Evitar linguagem genérica'] },
    }

    const summary = resolveInheritedIdentitySummary({
      identity: partialIdentity,
      projectName: 'Portal Norte',
    })

    expect(summary.kind).toBe('partial')
    expect(summary.populatedZones).toBe(2)
    expect(summary.missingLabels).toContain('Público')
    expect(summary.headline).toBe('Identidade parcial de Portal Norte')
  })

  it('uses a predictable empty state when identity is absent', () => {
    const summary = resolveInheritedIdentitySummary({
      identity: null,
      projectName: 'Portal Norte',
    })

    expect(summary.kind).toBe('empty')
    expect(summary.headline).toBe('Identidade ainda não estruturada')
    expect(summary.actionLabel).toBe('Estruturar identidade')
  })

  it('uses legacy context state when free Project context is still available', () => {
    const summary = resolveInheritedIdentitySummary({
      identity: null,
      projectName: 'Portal Norte',
      hasLegacyContext: true,
    })

    expect(summary.kind).toBe('legacy')
    expect(summary.headline).toBe('Usando contexto legado do Project')
  })

  it('uses a safe invalid state without rendering partial data as valid', () => {
    const summary = resolveInheritedIdentitySummary({
      identity: completeIdentity,
      projectName: 'Portal Norte',
      readError: true,
    })

    expect(summary.kind).toBe('invalid')
    expect(summary.purpose).toBeNull()
    expect(summary.headline).toBe('Não foi possível carregar a identidade do Project')
  })

  it('does not mutate the input object', () => {
    const snapshot = structuredClone(completeIdentity)

    resolveInheritedIdentitySummary({
      identity: completeIdentity,
      projectName: 'Portal Norte',
    })

    expect(completeIdentity).toEqual(snapshot)
  })

  it('keeps loading distinct from the empty state', () => {
    const summary = resolveInheritedIdentitySummary({
      identity: null,
      projectName: 'Portal Norte',
      isLoading: true,
    })

    expect(summary.kind).toBe('loading')
    expect(summary.headline).toBe('Carregando identidade do Project')
  })

  it('says Image identity is applied to generation and evaluation', () => {
    const summary = resolveInheritedIdentitySummary({
      identity: completeIdentity,
      projectName: 'Portal Norte',
    })

    expect(getWorkspaceIdentityCopy('image', summary)).toBe('Aplicada à geração e avaliação')
  })

  it('says partial Image identity is partially applied', () => {
    const summary = resolveInheritedIdentitySummary({
      identity: { schema_version: 1, expression: { visual_identity: 'Editorial' } },
      projectName: 'Portal Norte',
    })

    expect(getWorkspaceIdentityCopy('image', summary)).toBe('Identidade parcial aplicada')
  })

  it('says Image uses legacy Project context when identity is absent and context exists', () => {
    const summary = resolveInheritedIdentitySummary({
      identity: null,
      projectName: 'Portal Norte',
      hasLegacyContext: true,
    })

    expect(getWorkspaceIdentityCopy('image', summary)).toBe('Usando contexto legado do Project')
  })

  it('keeps Video language reference-only', () => {
    const summary = resolveInheritedIdentitySummary({
      identity: completeIdentity,
      projectName: 'Portal Norte',
    })

    expect(getWorkspaceIdentityCopy('video', summary)).toBe('Disponível como referência')
  })

  it('keeps Editorial language reference-only', () => {
    const summary = resolveInheritedIdentitySummary({
      identity: completeIdentity,
      projectName: 'Portal Norte',
    })

    expect(getWorkspaceIdentityCopy('editorial', summary)).toBe(
      'Disponível como referência editorial',
    )
  })

  it('does not show Editorial context for content without Production', () => {
    expect(shouldShowEditorialIdentityContext(false)).toBe(false)
    expect(shouldShowEditorialIdentityContext(true)).toBe(true)
  })

  it('does not produce forbidden snapshot or copy language', () => {
    const summary = resolveInheritedIdentitySummary({
      identity: completeIdentity,
      projectName: 'Portal Norte',
    })
    const allCopy = [
      summary.headline,
      summary.description,
      summary.actionLabel,
      getWorkspaceIdentityCopy('image', summary),
      getWorkspaceIdentityCopy('video', summary),
      getWorkspaceIdentityCopy('editorial', summary),
    ].join(' ')

    expect(allCopy).not.toMatch(/snapshot|congelada|copiada|override|schema|JSON|compiler/i)
  })

  it('truncates long text without affecting short labels', () => {
    expect(truncateIdentityText('Curto', 10)).toBe('Curto')
    expect(truncateIdentityText('Texto longo demais para o card', 12)).toBe('Texto longo...')
    expect(truncateIdentityText(null)).toBeNull()
  })
})
