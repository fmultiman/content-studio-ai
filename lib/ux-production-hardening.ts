export type ProductionDisplayInput = {
  title: string | null | undefined
  intention?: string | null
  projectName?: string | null
}

export type ProductionDisplay = {
  title: string
  intention: string
  breadcrumb: string[]
}

const UNTITLED_PRODUCTION = 'Produção sem título'

export function resolveProductionDisplay({
  title,
  intention,
  projectName,
}: ProductionDisplayInput): ProductionDisplay {
  const rawTitle = normalizeText(title)
  const cleanIntention = normalizeText(intention)
  const cleanProjectName = normalizeText(projectName)
  let displayTitle = rawTitle

  if (displayTitle && cleanIntention && cleanProjectName) {
    const legacyPrefix = `${cleanIntention}${cleanProjectName}`

    if (displayTitle.startsWith(legacyPrefix) && displayTitle.length > legacyPrefix.length) {
      displayTitle = displayTitle.slice(legacyPrefix.length).trim()
    }
  }

  const resolvedTitle = displayTitle || rawTitle || UNTITLED_PRODUCTION

  return {
    title: resolvedTitle,
    intention: cleanIntention,
    breadcrumb: ['Projetos', cleanProjectName, resolvedTitle].filter(Boolean),
  }
}

export function productionWorkspaceLoadingMessage(section: 'page' | 'overview' | 'images' | 'videos' | 'editorial') {
  switch (section) {
    case 'page':
      return 'Carregando Production...'
    case 'overview':
      return 'Carregando entregáveis da Production...'
    case 'images':
      return 'Carregando rascunhos de imagem...'
    case 'videos':
      return 'Carregando rascunhos de vídeo...'
    case 'editorial':
      return 'Carregando conteúdos da Production...'
  }
}

export function draftLoadingMessage(kind: 'image' | 'video', hasDraftId: boolean) {
  if (hasDraftId) {
    return kind === 'image' ? 'Carregando rascunho de imagem...' : 'Carregando rascunho de vídeo...'
  }

  return kind === 'image' ? 'Carregando editor de imagem...' : 'Carregando editor de vídeo...'
}

export function productionReturnPath(projectId?: string | null, productionId?: string | null) {
  if (!projectId || !productionId) return null
  return `/projetos/${projectId}/producoes/${productionId}`
}

export const PRODUCTION_TABS_GRID_CLASS = 'grid w-full grid-cols-4'

function normalizeText(value: string | null | undefined) {
  return value?.trim().replace(/\s+/g, ' ') ?? ''
}
