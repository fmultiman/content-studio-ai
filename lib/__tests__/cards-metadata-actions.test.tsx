import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ContextMetadata } from '@/components/ui/context-metadata'
import { StatusBadge } from '@/components/ui/status-badge'

describe('UX-H4B3 cards, metadata and actions', () => {
  it('renders metadata in explicit label-value order', () => {
    const markup = renderToStaticMarkup(
      <ContextMetadata
        items={[
          { label: 'Project', value: 'Portal Norte' },
          { label: 'Production', value: 'Campanha multimodal' },
          { label: 'Atualizado', value: '28 jun 2026' },
        ]}
      />,
    )

    expect(markup.indexOf('Project')).toBeLessThan(markup.indexOf('Production'))
    expect(markup).toContain('Portal Norte')
    expect(markup).toContain('Campanha multimodal')
  })

  it('keeps status labels textual instead of color-only markers', () => {
    const markup = renderToStaticMarkup(<StatusBadge label="Aprovada" tone="positive" />)

    expect(markup).toContain('Aprovada')
    expect(markup).toContain('whitespace-nowrap')
  })

  it('keeps dashboard continuity cards focused on next actions and context', () => {
    const source = readFileSync(join(process.cwd(), 'components/dashboard/continuation-hub.tsx'), 'utf8')

    expect(source).toContain("label: 'Project'")
    expect(source).toContain("label: 'Production'")
    expect(source).toContain('Continuar Production')
    expect(source).toContain('StatusBadge')
  })

  it('keeps project cards structural and removes misleading image counters', () => {
    const source = readFileSync(join(process.cwd(), 'components/projects/project-list.tsx'), 'utf8')

    expect(source).toContain("label: 'Status'")
    expect(source).toContain("label: 'Atualizado'")
    expect(source).toContain('Abrir')
    expect(source).not.toContain('0 imagens')
  })

  it('keeps production cards distinct from project cards', () => {
    const projectDetailSource = readFileSync(
      join(process.cwd(), 'app/(dashboard)/projetos/[id]/page.tsx'),
      'utf8',
    )

    expect(projectDetailSource).toContain('PRODUCTION_TYPE_LABELS')
    expect(projectDetailSource).toContain('StatusBadge label="Ativa"')
    expect(projectDetailSource).toContain('Abrir')
  })

  it('keeps image and video draft hubs aligned in metadata order and verbs', () => {
    const imagePage = readFileSync(join(process.cwd(), 'app/(dashboard)/imagens/page.tsx'), 'utf8')
    const videoPage = readFileSync(join(process.cwd(), 'app/(dashboard)/videos/page.tsx'), 'utf8')

    for (const source of [imagePage, videoPage]) {
      expect(source.indexOf("label: 'Project'")).toBeLessThan(source.indexOf("label: 'Production'"))
      expect(source).toContain('StatusBadge')
      expect(source).toContain('Abrir')
      expect(source).toContain('Ver Production')
    }
  })

  it('keeps gallery actions equivalent across cards and list', () => {
    const source = readFileSync(join(process.cwd(), 'app/(dashboard)/galeria/page.tsx'), 'utf8')

    expect(source).toContain('Abrir origem')
    expect(source).toContain('Ver Production')
    expect(source).toContain('Baixar')
    expect(source).toContain('output.sourceHref &&')
    expect(source).toContain('output.productionHref &&')
    expect(source).toContain('output.canDownload &&')
  })

  it('keeps files distinct from outputs and exposes explicit preview/download actions', () => {
    const source = readFileSync(join(process.cwd(), 'app/(dashboard)/arquivos/page.tsx'), 'utf8')

    expect(source).toContain('Outputs visuais gerados ficam na Galeria.')
    expect(source).toContain('Visualizar')
    expect(source).toContain('Baixar')
    expect(source).toContain("label: 'Project'")
    expect(source).toContain("label: 'Pasta'")
  })

  it('keeps editorial content cards explicit about context and opening action', () => {
    const source = readFileSync(join(process.cwd(), 'app/(dashboard)/conteudos/page.tsx'), 'utf8')

    expect(source).toContain("label: 'Project'")
    expect(source).toContain("label: 'Production'")
    expect(source).toContain('StatusBadge')
    expect(source).toContain('Abrir')
  })

  it('preserves H4B1 and H4B2 structures while refining card internals', () => {
    const imagePage = readFileSync(join(process.cwd(), 'app/(dashboard)/imagens/page.tsx'), 'utf8')
    const galleryPage = readFileSync(join(process.cwd(), 'app/(dashboard)/galeria/page.tsx'), 'utf8')

    expect(imagePage).toContain('PageHeader')
    expect(imagePage).not.toContain('<table')
    expect(galleryPage).toContain('PageHeader')
    expect(galleryPage).toContain('ViewModeToggle')
  })
})
