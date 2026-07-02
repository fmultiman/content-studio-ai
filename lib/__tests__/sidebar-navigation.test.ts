import { describe, expect, it } from 'vitest'

import {
  flattenNavigationGroups,
  getActiveNavigationItem,
  isNavigationItemActive,
  navigationGroups,
} from '../sidebar-navigation'

describe('DS-1H-B shell navigation source', () => {
  it('keeps only the approved workspace, creation, and library groups', () => {
    expect(navigationGroups.map((group) => group.label)).toEqual([
      'Workspace',
      'Criação',
      'Bibliotecas',
    ])

    expect(flattenNavigationGroups().map((item) => item.label)).toEqual([
      'Dashboard',
      'Projetos',
      'Conteúdos',
      'Imagens',
      'Vídeos',
      'Galeria',
      'Arquivos',
    ])
  })

  it('keeps icons in the canonical navigation source', () => {
    for (const item of flattenNavigationGroups()) {
      expect(item.icon).toBeTruthy()
    }
  })

  it('does not keep Configurações as a rail navigation destination', () => {
    expect(flattenNavigationGroups().map((item) => item.label)).not.toContain(
      'Configurações',
    )
    expect(getActiveNavigationItem('/configuracoes')).toBeNull()
  })

  it.each([
    ['/dashboard', 'Dashboard'],
    ['/projetos', 'Projetos'],
    ['/projetos/project-1', 'Projetos'],
    ['/imagens', 'Imagens'],
    ['/videos/rascunhos', 'Vídeos'],
    ['/conteudos?project=project-1', 'Conteúdos'],
    ['/galeria', 'Galeria'],
    ['/arquivos', 'Arquivos'],
  ])('activates %s as %s', (pathname, label) => {
    expect(getActiveNavigationItem(pathname)?.label).toBe(label)
  })

  it('keeps only one active item for each routed rail area', () => {
    const routes = [
      '/dashboard',
      '/projetos/project-1/producoes/production-1',
      '/imagens?draft=draft-1&project=project-1&production=production-1',
      '/videos/rascunhos',
      '/conteudos',
      '/galeria',
      '/arquivos',
    ]

    for (const route of routes) {
      const activeItems = flattenNavigationGroups().filter((item) =>
        isNavigationItemActive(item, route),
      )

      expect(activeItems).toHaveLength(1)
    }
  })
})
