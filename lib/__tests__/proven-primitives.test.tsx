import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardActions,
  CardContent,
  CardDescription,
  CardHeader,
  CardMedia,
  CardTitle,
} from '@/components/ui/card'
import { ContextMetadata } from '@/components/ui/context-metadata'
import { StateMessage } from '@/components/ui/state-message'
import { StatusBadge } from '@/components/ui/status-badge'

describe('DS-1G proven primitives cleanup', () => {
  it('keeps the toast system canonical on hooks/use-toast plus toaster and toast primitives', () => {
    const layoutSource = readFileSync(join(process.cwd(), 'app/layout.tsx'), 'utf8')
    const toasterSource = readFileSync(join(process.cwd(), 'components/ui/toaster.tsx'), 'utf8')
    const toastSource = readFileSync(join(process.cwd(), 'components/ui/toast.tsx'), 'utf8')

    expect(layoutSource).toContain("import { Toaster } from '@/components/ui/toaster'")
    expect(layoutSource).toContain('<Toaster />')
    expect(toasterSource).toContain("import { useToast } from '@/hooks/use-toast'")
    expect(toastSource).toContain('ToastProvider')

    expect(existsSync(join(process.cwd(), 'hooks/use-toast.ts'))).toBe(true)
    expect(existsSync(join(process.cwd(), 'components/ui/use-toast.ts'))).toBe(false)
    expect(existsSync(join(process.cwd(), 'components/ui/sonner.tsx'))).toBe(false)
  })

  it('removes orphan UI wrappers and inactive card APIs from the shared contract', () => {
    const removedFiles = [
      'components/ui/progress.tsx',
      'components/ui/popover.tsx',
      'components/ui/button-group.tsx',
      'components/ui/input-group.tsx',
      'components/ui/form.tsx',
      'components/ui/empty.tsx',
      'components/ui/spinner.tsx',
      'components/ui/command.tsx',
      'components/ui/drawer.tsx',
      'components/ui/hover-card.tsx',
      'components/ui/context-menu.tsx',
      'components/ui/table.tsx',
    ]

    for (const relativePath of removedFiles) {
      expect(existsSync(join(process.cwd(), relativePath))).toBe(false)
    }

    const cardSource = readFileSync(join(process.cwd(), 'components/ui/card.tsx'), 'utf8')
    expect(cardSource).not.toContain('function CardEyebrow')
    expect(cardSource).not.toContain('function CardFooter')
    expect(cardSource).not.toContain('CardEyebrow,')
    expect(cardSource).not.toContain('CardFooter,')
  })

  it('keeps proven primitives renderable without introducing theme-specific component forks', () => {
    const markup = renderToStaticMarkup(
      <>
        <PageHeader title="Projetos" description="Acompanhe os pilots aprovados." />
        <Card>
          <CardMedia>
            <div>media</div>
          </CardMedia>
          <CardHeader>
            <CardTitle>Portal Norte</CardTitle>
            <CardDescription>Campanha multimodal</CardDescription>
          </CardHeader>
          <CardContent>
            <ContextMetadata
              dense
              items={[
                { label: 'Project', value: 'Portal Norte' },
                { label: 'Production', value: 'Campanha multimodal' },
              ]}
            />
            <StatusBadge label="Aprovada" tone="approved" />
            <StateMessage title="Carregando" description="Buscando resultados." />
          </CardContent>
          <CardActions>
            <Button>Abrir</Button>
          </CardActions>
        </Card>
      </>,
    )

    expect(markup).toContain('data-slot="page-header"')
    expect(markup).toContain('data-slot="card"')
    expect(markup).toContain('data-slot="card-media"')
    expect(markup).toContain('data-slot="card-actions"')
    expect(markup).toContain('data-slot="button"')
    expect(markup).toContain('data-slot="context-metadata"')
    expect(markup).toContain('data-slot="status-badge"')
    expect(markup).toContain('data-slot="state-message"')

    const uiFiles = readdirSync(join(process.cwd(), 'components/ui'))
    expect(uiFiles.some((file) => /^studio/i.test(file))).toBe(false)
  })

  it('preserves intentional local wrappers and shared collection headers without forcing a new abstraction', () => {
    expect(existsSync(join(process.cwd(), 'components/dashboard/stats-cards.tsx'))).toBe(true)
    expect(existsSync(join(process.cwd(), 'components/images/image-input-section.tsx'))).toBe(true)
    expect(existsSync(join(process.cwd(), 'components/images/image-result.tsx'))).toBe(true)
    expect(existsSync(join(process.cwd(), 'components/images/prompt-section.tsx'))).toBe(true)

    const projectPageSource = readFileSync(
      join(process.cwd(), 'app/(dashboard)/projetos/page.tsx'),
      'utf8',
    )
    const galleryPageSource = readFileSync(
      join(process.cwd(), 'app/(dashboard)/galeria/page.tsx'),
      'utf8',
    )

    expect(projectPageSource).toContain('PageHeader')
    expect(galleryPageSource).toContain('PageHeader')
  })
})
