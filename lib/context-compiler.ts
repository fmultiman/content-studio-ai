import type { ProjectIdentity } from './schemas/project-identity'

// ─── Source Interface ─────────────────────────────────────────────────────────

/**
 * Minimal interface consumed by context formatters.
 *
 * Deliberately isolated from the operational `Project` type so that this
 * module never depends on production code. Callers pass only what they have.
 */
export interface ProjectContextSource {
  /** General project narrative — semantically distinct from foundation.purpose. */
  context?: string | null
  /** Legacy field. Used only as fallback when identity.expression.visual_identity is absent. */
  style_profile?: string | null
  /** Structured identity from the JSONB column. */
  identity?: ProjectIdentity | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function block(label: string, value: string): string {
  return `**${label}:** ${value}`
}

function listBlock(label: string, items: string[]): string {
  return `**${label}:**\n${items.map((item) => `- ${item}`).join('\n')}`
}

/**
 * Resolves the visual identity string to use.
 *
 * Priority: identity.expression.visual_identity → style_profile (fallback only).
 * Never concatenates both.
 */
function resolveVisualIdentity(source: ProjectContextSource): string | null {
  const fromIdentity = source.identity?.expression?.visual_identity
  if (fromIdentity) return fromIdentity
  if (source.style_profile?.trim()) return source.style_profile.trim()
  return null
}

// ─── Generation Context ───────────────────────────────────────────────────────

/**
 * Builds a prompt block for image generation agents.
 *
 * Inclusion order (deterministic):
 * 1. context (general project narrative)
 * 2. foundation.purpose (project raison d'être — distinct from context)
 * 3. relationship.audience
 * 4. expression.visual_identity (or style_profile as fallback)
 * 5. expression.voice
 * 6. governance.principles[]
 * 7. governance.restrictions[]
 * 8. practice.generation_preferences[]
 *
 * Empty blocks are omitted. Returns empty string when nothing is available.
 */
export function buildImageGenerationContext(source: ProjectContextSource): string {
  const parts: string[] = []
  const id = source.identity

  if (source.context?.trim()) {
    parts.push(block('Contexto do Projeto', source.context.trim()))
  }

  if (id?.foundation?.purpose) {
    parts.push(block('Propósito', id.foundation.purpose))
  }

  if (id?.relationship?.audience) {
    parts.push(block('Audiência', id.relationship.audience))
  }

  const visualIdentity = resolveVisualIdentity(source)
  if (visualIdentity) {
    parts.push(block('Identidade Visual', visualIdentity))
  }

  if (id?.expression?.voice) {
    parts.push(block('Voz e Tom', id.expression.voice))
  }

  const principles = id?.governance?.principles
  if (principles?.length) {
    parts.push(listBlock('Princípios', principles))
  }

  const restrictions = id?.governance?.restrictions
  if (restrictions?.length) {
    parts.push(listBlock('Restrições', restrictions))
  }

  const preferences = id?.practice?.generation_preferences
  if (preferences?.length) {
    parts.push(listBlock('Preferências de Geração', preferences))
  }

  return parts.join('\n\n')
}

// ─── Evaluation Context ───────────────────────────────────────────────────────

/**
 * Builds a prompt block for image evaluation agents.
 *
 * Inclusion order (deterministic):
 * 1. context (general project narrative)
 * 2. foundation.purpose
 * 3. relationship.audience
 * 4. expression.visual_identity (or style_profile as fallback)
 * 5. governance.principles[]
 * 6. governance.restrictions[] — emphasized, must be checked in scoring
 * 7. practice.generation_preferences[] — treated as preference, not absolute rule
 *
 * Voice is omitted from evaluation context (not relevant to image scoring).
 * Empty blocks are omitted. Returns empty string when nothing is available.
 */
export function buildImageEvaluationContext(source: ProjectContextSource): string {
  const parts: string[] = []
  const id = source.identity

  if (source.context?.trim()) {
    parts.push(block('Contexto do Projeto', source.context.trim()))
  }

  if (id?.foundation?.purpose) {
    parts.push(block('Propósito', id.foundation.purpose))
  }

  if (id?.relationship?.audience) {
    parts.push(block('Audiência', id.relationship.audience))
  }

  const visualIdentity = resolveVisualIdentity(source)
  if (visualIdentity) {
    parts.push(block('Identidade Visual', visualIdentity))
  }

  const principles = id?.governance?.principles
  if (principles?.length) {
    parts.push(listBlock('Princípios', principles))
  }

  const restrictions = id?.governance?.restrictions
  if (restrictions?.length) {
    // Emphasized in evaluation — evaluator must check violations against these
    parts.push(listBlock('Restrições (verificar violações no score)', restrictions))
  }

  const preferences = id?.practice?.generation_preferences
  if (preferences?.length) {
    // Preferences, not hard rules — evaluator applies proportionally
    parts.push(listBlock('Preferências de Geração (preferência, não regra absoluta)', preferences))
  }

  return parts.join('\n\n')
}
