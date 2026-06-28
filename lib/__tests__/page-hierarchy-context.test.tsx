import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { PageHeader } from '@/components/layout/page-header'

describe('UX-H4B2 page hierarchy and contextual messaging', () => {
  it('renders a single h1 and omits empty supporting markup', () => {
    const markup = renderToStaticMarkup(<PageHeader title="Projetos" />)

    expect((markup.match(/<h1/g) || [])).toHaveLength(1)
    expect(markup).toContain('Projetos')
    expect(markup).not.toContain('max-w-3xl text-sm text-muted-foreground')
    expect(markup).not.toContain('justify-end')
  })

  it('supports optional context, description and actions in reading order', () => {
    const markup = renderToStaticMarkup(
      <PageHeader
        context="Workspace"
        title="Projetos"
        description="Organize identidade, contexto e Productions em um mesmo espaço."
        actions={
          <>
            <button type="button">Ação principal</button>
            <button type="button">Ação secundária</button>
          </>
        }
      />,
    )

    expect(markup.indexOf('Workspace')).toBeLessThan(markup.indexOf('<h1'))
    expect(markup.indexOf('Ação principal')).toBeLessThan(markup.indexOf('Ação secundária'))
    expect(markup).toContain('Organize identidade, contexto e Productions em um mesmo espaço.')
  })

  it('applies the shared page header to hubs, collections and libraries in scope', () => {
    const files = [
      'app/(dashboard)/dashboard/page.tsx',
      'app/(dashboard)/projetos/page.tsx',
      'app/(dashboard)/conteudos/page.tsx',
      'app/(dashboard)/galeria/page.tsx',
      'app/(dashboard)/arquivos/page.tsx',
      'app/(dashboard)/configuracoes/page.tsx',
    ]

    for (const file of files) {
      const source = readFileSync(join(process.cwd(), file), 'utf8')
      expect(source).toContain('PageHeader')
      expect(source).toContain('<Header />')
    }
  })

  it('keeps Imagens and Vídeos aligned with H4B1 while adding contextual page hierarchy', () => {
    const imagePage = readFileSync(join(process.cwd(), 'app/(dashboard)/imagens/page.tsx'), 'utf8')
    const videoPage = readFileSync(join(process.cwd(), 'app/(dashboard)/videos/page.tsx'), 'utf8')

    for (const source of [imagePage, videoPage]) {
      expect(source).toContain('PageHeader')
      expect(source).toContain("title={productionId ? 'Geração")
      expect(source).toContain("PageHeader\n              context=\"Criação\"")
      expect(source).toContain('Rascunhos recentes')
    }
  })

  it('removes the duplicate Galeria h1 while preserving outputs, cards and filters', () => {
    const galleryPage = readFileSync(join(process.cwd(), 'app/(dashboard)/galeria/page.tsx'), 'utf8')

    expect(galleryPage).toContain('PageHeader')
    expect(galleryPage).not.toContain('<Header title="Galeria" />')
    expect(galleryPage).not.toContain('<h1 className="text-2xl font-semibold tracking-normal">Galeria</h1>')
    expect(galleryPage).toContain('Outputs gerados')
    expect(galleryPage).toContain('ViewModeToggle')
  })

  it('distinguishes Galeria and Arquivos through contextual messaging', () => {
    const galleryPage = readFileSync(join(process.cwd(), 'app/(dashboard)/galeria/page.tsx'), 'utf8')
    const filesPage = readFileSync(join(process.cwd(), 'app/(dashboard)/arquivos/page.tsx'), 'utf8')

    expect(galleryPage).toContain('Uploads, referências e documentos continuam em Arquivos.')
    expect(filesPage).toContain('Outputs visuais gerados ficam na Galeria.')
  })

  it('preserves Configurações tabs under the new page hierarchy', () => {
    const settingsPage = readFileSync(join(process.cwd(), 'app/(dashboard)/configuracoes/page.tsx'), 'utf8')

    expect(settingsPage).toContain('PageHeader')
    expect(settingsPage).toContain('TabsList')
    expect(settingsPage).toContain('Gerencie preferências, integrações e chaves usadas pelo Studio.')
  })

  it('keeps Project and Production detail pages contextual without duplicating the top title', () => {
    const projectPage = readFileSync(join(process.cwd(), 'app/(dashboard)/projetos/[id]/page.tsx'), 'utf8')
    const productionPage = readFileSync(
      join(process.cwd(), 'app/(dashboard)/projetos/[id]/producoes/[productionId]/page.tsx'),
      'utf8',
    )

    expect(projectPage).not.toContain('<Header title={project.name} />')
    expect(projectPage).toContain('<h1 className="text-2xl font-semibold leading-none text-foreground">{project.name}</h1>')
    expect(productionPage).not.toContain('<Header title={productionDisplay.title} />')
    expect(productionPage).toContain('<h1 className="text-2xl font-semibold leading-none text-foreground">{productionDisplay.title}</h1>')
  })
})
