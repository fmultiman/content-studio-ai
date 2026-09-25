import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { StateMessage } from '@/components/ui/state-message'

describe('UX-H4B4 states, forms and final polish', () => {
  it('renders loading and error state messages with explicit semantics', () => {
    const loadingMarkup = renderToStaticMarkup(
      <StateMessage
        tone="loading"
        title="Carregando configurações..."
        description="Preparando preferências."
      />,
    )
    const errorMarkup = renderToStaticMarkup(
      <StateMessage
        tone="error"
        title="Falha ao carregar"
        description="Tente novamente."
        actionLabel="Tentar novamente"
        onAction={() => undefined}
      />,
    )

    expect(loadingMarkup).toContain('role="status"')
    expect(loadingMarkup).toContain('aria-live="polite"')
    expect(errorMarkup).toContain('role="alert"')
    expect(errorMarkup).toContain('Tentar novamente')
  })

  it('keeps Project and Production forms with inline validation near the fields', () => {
    const projectForm = readFileSync(join(process.cwd(), 'components/projects/project-form.tsx'), 'utf8')
    const productionForm = readFileSync(join(process.cwd(), 'components/productions/production-form.tsx'), 'utf8')

    expect(projectForm).toContain('aria-invalid={!!nameError}')
    expect(projectForm).toContain('<FieldError id="project-name-error">{nameError}</FieldError>')
    expect(projectForm).toContain('disabled={isLoading || !!nameError}')

    expect(productionForm).toContain('aria-invalid={!!intentionError}')
    expect(productionForm).toContain('aria-invalid={!!titleError}')
    expect(productionForm).toContain('<FieldError id="production-intention-error">{intentionError}</FieldError>')
    expect(productionForm).toContain('<FieldError id="production-title-error">{titleError}</FieldError>')
  })

  it('distinguishes empty and filtered-empty states in structural collection pages', () => {
    const projectsPage = readFileSync(join(process.cwd(), 'app/(dashboard)/projetos/page.tsx'), 'utf8')
    const filesPage = readFileSync(join(process.cwd(), 'app/(dashboard)/arquivos/page.tsx'), 'utf8')
    const contentsPage = readFileSync(join(process.cwd(), 'app/(dashboard)/conteudos/page.tsx'), 'utf8')

    expect(projectsPage).toContain('Nenhum Project ainda')
    expect(projectsPage).toContain('Nenhum resultado encontrado')

    expect(filesPage).toContain('Lixeira vazia')
    expect(filesPage).toContain('Nenhum resultado encontrado')
    expect(filesPage).toContain('Nenhum arquivo encontrado')

    expect(contentsPage).toContain('Nenhum conteúdo editorial ainda')
    expect(contentsPage).toContain('Nenhum resultado encontrado')
  })

  it('keeps image provider guidance distinct from temporary load errors', () => {
    const imagePage = readFileSync(join(process.cwd(), 'app/(dashboard)/imagens/page.tsx'), 'utf8')

    expect(imagePage).toContain('Provider de prompt não configurado')
    expect(imagePage).toContain('Abrir Configurações')
    expect(imagePage).toContain('NanoBanana indisponível neste workspace')
    expect(imagePage).toContain('Não foi possível carregar os dados de imagem')
  })

  it('keeps settings tabs reachable on mobile and saves with inline feedback', () => {
    const settingsPage = readFileSync(join(process.cwd(), 'app/(dashboard)/configuracoes/page.tsx'), 'utf8')

    expect(settingsPage).toContain('const [activeTab, setActiveTab] = useState(\'profile\')')
    expect(settingsPage).toContain('<div className="overflow-x-auto pb-1">')
    expect(settingsPage).toContain('<TabsList className="inline-flex min-w-full gap-2">')
    expect(settingsPage).toContain('setSaveFeedback({')
    expect(settingsPage).toContain('Configurações salvas')
    expect(settingsPage).toContain('Falha ao salvar')
  })

  it('preserves gallery terminal loading and retry-safe structural states', () => {
    const galleryPage = readFileSync(join(process.cwd(), 'app/(dashboard)/galeria/page.tsx'), 'utf8')

    expect(galleryPage).toContain('setIsLoading(true)')
    expect(galleryPage).toContain('setIsLoading(false)')
    expect(galleryPage).toContain('Falha ao carregar a Galeria')
    expect(galleryPage).toContain('Carregando Galeria...')
  })

  it('keeps dashboard usable during partial failure', () => {
    const dashboardPage = readFileSync(join(process.cwd(), 'app/(dashboard)/dashboard/page.tsx'), 'utf8')

    expect(dashboardPage).toContain('const hasLoadError = [')
    expect(dashboardPage).toContain('<DashboardContinuationHub')
    expect(dashboardPage).toContain('Não foi possível carregar todos os dados do Dashboard.')
  })

  it('keeps file upload errors inline and avoids fake actions for empty states', () => {
    const filesPage = readFileSync(join(process.cwd(), 'app/(dashboard)/arquivos/page.tsx'), 'utf8')

    expect(filesPage).toContain('const [uploadError, setUploadError] = useState<string | null>(null)')
    expect(filesPage).toContain('title="Upload indisponível"')
    expect(filesPage).toContain('selectedProject !== \'all\' || selectedKind !== \'all\' || folder !== \'/\'')
  })
})
