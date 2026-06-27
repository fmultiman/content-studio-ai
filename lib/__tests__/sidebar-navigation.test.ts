import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  flattenNavigationGroups,
  getActiveNavigationItem,
  isNavigationItemActive,
  navigationGroups,
} from '../sidebar-navigation'

const sidebarSource = () =>
  readFileSync(join(process.cwd(), 'components/layout/sidebar.tsx'), 'utf8')

describe('UX-H3D sidebar navigation reconciliation', () => {
  it('keeps Dashboard first and groups navigation in the intended order', () => {
    expect(navigationGroups.map((group) => group.label)).toEqual([
      'Workspace',
      'Criação',
      'Bibliotecas',
      'Sistema',
    ])

    expect(flattenNavigationGroups().map((item) => item.label)).toEqual([
      'Dashboard',
      'Projetos',
      'Conteúdos',
      'Imagens',
      'Vídeos',
      'Galeria',
      'Arquivos',
      'Configurações',
    ])
  })

  it('keeps areas in their documented roles', () => {
    const [workspace, creation, libraries, system] = navigationGroups

    expect(workspace.items.map((item) => item.label)).toEqual([
      'Dashboard',
      'Projetos',
      'Conteúdos',
    ])
    expect(creation.items.map((item) => item.label)).toEqual([
      'Imagens',
      'Vídeos',
    ])
    expect(libraries.items.map((item) => item.label)).toEqual([
      'Galeria',
      'Arquivos',
    ])
    expect(system.items.map((item) => item.label)).toEqual(['Configurações'])
  })

  it('does not add a global Rascunhos item', () => {
    expect(flattenNavigationGroups().map((item) => item.label)).not.toContain(
      'Rascunhos',
    )
    expect(navigationGroups.map((group) => group.label)).not.toContain(
      'Trabalho',
    )
  })

  it.each([
    ['/dashboard', 'Dashboard'],
    ['/projetos', 'Projetos'],
    ['/projetos/project-1', 'Projetos'],
    ['/projetos/project-1/producoes/production-1', 'Projetos'],
    ['/imagens', 'Imagens'],
    ['/imagens?draft=draft-1&project=project-1', 'Imagens'],
    ['/imagens/rascunhos', 'Imagens'],
    ['/videos', 'Vídeos'],
    ['/videos?draft=draft-1&project=project-1', 'Vídeos'],
    ['/videos/rascunhos', 'Vídeos'],
    ['/conteudos', 'Conteúdos'],
    ['/conteudos?project=project-1', 'Conteúdos'],
    ['/galeria', 'Galeria'],
    ['/arquivos', 'Arquivos'],
    ['/configuracoes', 'Configurações'],
    ['/configuracoes/api', 'Configurações'],
  ])('activates %s as %s', (pathname, label) => {
    expect(getActiveNavigationItem(pathname)?.label).toBe(label)
  })

  it('keeps only one active item for each routed area', () => {
    const routes = [
      '/dashboard',
      '/projetos/project-1/producoes/production-1',
      '/imagens?draft=draft-1&project=project-1&production=production-1',
      '/videos/rascunhos',
      '/conteudos',
      '/galeria',
      '/arquivos',
      '/configuracoes/integracoes',
    ]

    for (const route of routes) {
      const activeItems = flattenNavigationGroups().filter((item) =>
        isNavigationItemActive(item, route),
      )

      expect(activeItems).toHaveLength(1)
    }
  })

  it('uses a single shared navigation source in the Sidebar UI', () => {
    const source = sidebarSource()

    expect(source).toContain('navigationGroups,')
    expect(source).toContain('mainNavigationGroups.map')
    expect(source).toContain('aria-label="Navegação principal"')
    expect(source).toContain("aria-current={isActive ? 'page' : undefined}")
  })

  it('keeps navigation labels concise and in PT-BR', () => {
    expect(flattenNavigationGroups().map((item) => item.label)).toEqual(
      expect.not.arrayContaining([
        'Rascunhos de imagem',
        'Rascunhos de vídeo',
        'Biblioteca de outputs visuais',
        'Conteúdos editoriais completos',
      ]),
    )
  })

  it('exposes group semantics without adding duplicate navigation data', () => {
    const source = sidebarSource()

    expect(source).toContain('<section')
    expect(source).toContain('aria-label={group.label}')
    expect(source).toContain('aria-label={systemNavigationGroup.label}')
    expect(source).toContain('title={collapsed ? item.label : undefined}')
  })

  it('removes the permanent beta box and keeps Settings reachable', () => {
    const source = sidebarSource()

    expect(source).not.toContain('Versão Beta')
    expect(source).not.toContain('Criação de conteúdo com IA')
    expect(source).toContain('systemNavigationGroup')
    expect(source).not.toContain('{systemNavigationGroup.label}\n              </p>')
    expect(navigationGroups.at(-1)?.items.map((item) => item.label)).toEqual([
      'Configurações',
    ])
  })

  it('keeps open and close controls available with accessible labels', () => {
    const source = sidebarSource()

    expect(source).toContain("collapsed ? 'Abrir menu' : 'Fechar menu'")
    expect(source).toContain('aria-label={toggleLabel}')
    expect(source).toContain('aria-expanded={!collapsed}')
    expect(source).toContain('type="button"')
    expect(source).toContain('<Menu className="h-4 w-4" />')
    expect(source).toContain('<ChevronLeft className="h-4 w-4" />')
  })

  it('keeps short-height navigation reachable without hiding overflow', () => {
    const source = sidebarSource()

    expect(source).toContain('overflow-y-auto')
    expect(source).toContain('[scrollbar-width:thin]')
    expect(source).toContain('shrink-0 border-t')
  })

  it('does not mutate navigation configuration when resolving active items', () => {
    const snapshot = structuredClone(navigationGroups)

    getActiveNavigationItem('/projetos/project-1')
    flattenNavigationGroups()

    expect(navigationGroups).toEqual(snapshot)
  })
})
