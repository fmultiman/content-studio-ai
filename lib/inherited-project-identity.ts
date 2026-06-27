import type { ProjectIdentity } from '@/lib/schemas/project-identity'

export type IdentitySurface = 'production' | 'image' | 'video' | 'editorial'

export type InheritedIdentityKind = 'complete' | 'partial' | 'empty' | 'legacy' | 'invalid' | 'loading'

export interface InheritedIdentityInput {
  identity: ProjectIdentity | null
  projectName?: string | null
  hasLegacyContext?: boolean
  readError?: boolean
  isLoading?: boolean
}

export interface InheritedIdentitySummary {
  kind: InheritedIdentityKind
  projectName: string
  populatedZones: number
  totalZones: 5
  purpose: string | null
  audience: string | null
  visualIdentity: string | null
  voice: string | null
  principleCount: number
  restrictionCount: number
  preferenceCount: number
  availableLabels: string[]
  missingLabels: string[]
  headline: string
  description: string
  actionLabel: string
  hasLegacyContext: boolean
}

const TOTAL_ZONES = 5 as const

const ZONE_LABELS = {
  foundation: 'Propósito',
  relationship: 'Público',
  expression: 'Direção visual',
  governance: 'Princípios e restrições',
  practice: 'Preferências práticas',
} as const

export function resolveInheritedIdentitySummary({
  identity,
  projectName,
  hasLegacyContext = false,
  readError = false,
  isLoading = false,
}: InheritedIdentityInput): InheritedIdentitySummary {
  const safeProjectName = normalizeLabel(projectName) || 'Project'

  if (isLoading) {
    return buildBaseSummary({
      kind: 'loading',
      projectName: safeProjectName,
      headline: 'Carregando identidade do Project',
      description: 'A identidade herdada será exibida quando o Project terminar de carregar.',
      actionLabel: 'Ver identidade completa',
      hasLegacyContext,
    })
  }

  if (readError) {
    return buildBaseSummary({
      kind: 'invalid',
      projectName: safeProjectName,
      headline: 'Não foi possível carregar a identidade do Project',
      description: 'Corrija a identidade no Project antes de usar fluxos que dependem dela.',
      actionLabel: 'Corrigir no Project',
      hasLegacyContext,
    })
  }

  if (identity === null) {
    return buildBaseSummary({
      kind: hasLegacyContext ? 'legacy' : 'empty',
      projectName: safeProjectName,
      headline: hasLegacyContext ? 'Usando contexto legado do Project' : 'Identidade ainda não estruturada',
      description: hasLegacyContext
        ? 'Esta Production ainda usa o contexto livre do Project e sua intenção local.'
        : 'Este Project funciona normalmente. Estruture a identidade para aumentar consistência entre entregáveis.',
      actionLabel: 'Estruturar identidade',
      hasLegacyContext,
    })
  }

  const zoneChecks = [
    {
      label: ZONE_LABELS.foundation,
      populated: hasText(identity.foundation?.purpose),
    },
    {
      label: ZONE_LABELS.relationship,
      populated: hasText(identity.relationship?.audience),
    },
    {
      label: ZONE_LABELS.expression,
      populated: hasText(identity.expression?.visual_identity) || hasText(identity.expression?.voice),
    },
    {
      label: ZONE_LABELS.governance,
      populated:
        hasItems(identity.governance?.principles) || hasItems(identity.governance?.restrictions),
    },
    {
      label: ZONE_LABELS.practice,
      populated: hasItems(identity.practice?.generation_preferences),
    },
  ]

  const populatedZones = zoneChecks.filter((zone) => zone.populated).length
  const availableLabels = zoneChecks.filter((zone) => zone.populated).map((zone) => zone.label)
  const missingLabels = zoneChecks.filter((zone) => !zone.populated).map((zone) => zone.label)
  const kind: InheritedIdentityKind = populatedZones === TOTAL_ZONES ? 'complete' : 'partial'

  return {
    kind,
    projectName: safeProjectName,
    populatedZones,
    totalZones: TOTAL_ZONES,
    purpose: normalizeLabel(identity.foundation?.purpose),
    audience: normalizeLabel(identity.relationship?.audience),
    visualIdentity: normalizeLabel(identity.expression?.visual_identity),
    voice: normalizeLabel(identity.expression?.voice),
    principleCount: identity.governance?.principles?.length ?? 0,
    restrictionCount: identity.governance?.restrictions?.length ?? 0,
    preferenceCount: identity.practice?.generation_preferences?.length ?? 0,
    availableLabels,
    missingLabels,
    headline:
      kind === 'complete'
        ? `Identidade herdada de ${safeProjectName}`
        : `Identidade parcial de ${safeProjectName}`,
    description:
      kind === 'complete'
        ? 'Esta Production usa a identidade atual do Project como direção persistente.'
        : `${populatedZones} de ${TOTAL_ZONES} zonas preenchidas. Algumas dimensões ainda podem ser completadas no Project.`,
    actionLabel: 'Ver identidade completa',
    hasLegacyContext,
  }
}

export function getWorkspaceIdentityCopy(
  surface: Exclude<IdentitySurface, 'production'>,
  summary: InheritedIdentitySummary,
): string {
  if (summary.kind === 'loading') return 'Carregando identidade do Project'
  if (summary.kind === 'invalid') return 'Não foi possível carregar a identidade do Project'
  if (summary.kind === 'legacy') return 'Usando contexto legado do Project'
  if (summary.kind === 'empty') return 'Sem identidade estruturada'

  if (surface === 'image') {
    return summary.kind === 'partial'
      ? 'Identidade parcial aplicada'
      : 'Aplicada à geração e avaliação'
  }

  if (surface === 'video') return 'Disponível como referência'

  return 'Disponível como referência editorial'
}

export function getIdentityStatusLabel(summary: InheritedIdentitySummary): string {
  if (summary.kind === 'complete') return 'Identidade herdada'
  if (summary.kind === 'partial') return 'Identidade parcial'
  if (summary.kind === 'legacy') return 'Contexto legado'
  if (summary.kind === 'empty') return 'Sem identidade estruturada'
  if (summary.kind === 'invalid') return 'Identidade com problema'
  return 'Carregando identidade'
}

export function shouldShowEditorialIdentityContext(hasProduction: boolean): boolean {
  return hasProduction
}

export function truncateIdentityText(value: string | null, maxLength = 180): string | null {
  if (!value) return null
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength).trimEnd()}...`
}

function buildBaseSummary({
  kind,
  projectName,
  headline,
  description,
  actionLabel,
  hasLegacyContext,
}: {
  kind: InheritedIdentityKind
  projectName: string
  headline: string
  description: string
  actionLabel: string
  hasLegacyContext: boolean
}): InheritedIdentitySummary {
  return {
    kind,
    projectName,
    populatedZones: 0,
    totalZones: TOTAL_ZONES,
    purpose: null,
    audience: null,
    visualIdentity: null,
    voice: null,
    principleCount: 0,
    restrictionCount: 0,
    preferenceCount: 0,
    availableLabels: [],
    missingLabels: Object.values(ZONE_LABELS),
    headline,
    description,
    actionLabel,
    hasLegacyContext,
  }
}

function hasText(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function hasItems(value: string[] | null | undefined): boolean {
  return Array.isArray(value) && value.length > 0
}

function normalizeLabel(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
