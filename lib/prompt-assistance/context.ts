import type { ProjectIdentity } from '@/lib/schemas/project-identity'
import { buildImageGenerationContext } from '@/lib/context-compiler'

export type PromptAssistanceContextSource = {
  projectContext?: string | null
  production?: { title?: string | null; intention?: string | null; type?: string | null } | null
  identity?: ProjectIdentity | null
}

function block(label: string, value: string) {
  return `**${label}:** ${value}`
}

/**
 * Prompt Assistance uses the established image context ordering and adds the
 * validated visual token fields without serializing internal Identity JSON.
 */
export function buildPromptAssistanceContext(source: PromptAssistanceContextSource): string {
  const parts: string[] = []
  const base = buildImageGenerationContext({ context: source.projectContext, identity: source.identity })
  if (base) parts.push(base)

  const production = source.production
  if (production?.title?.trim()) parts.push(block('Production', production.title.trim()))
  if (production?.type?.trim()) parts.push(block('Tipo de Production', production.type.trim()))
  if (production?.intention?.trim()) parts.push(block('Intenção da Production', production.intention.trim()))

  const visuals = source.identity?.visuals
  if (visuals?.colors) {
    const colors = Object.entries(visuals.colors)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0)
      .map(([key, value]) => `${key}: ${value}`)
    if (colors.length) parts.push(block('Cores de Identidade', colors.join(', ')))
  }
  if (visuals?.typography) {
    const typography = Object.entries(visuals.typography)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0)
      .map(([key, value]) => `${key}: ${value}`)
    if (typography.length) parts.push(block('Tipografia de Identidade', typography.join(', ')))
  }

  return parts.join('\n\n')
}
