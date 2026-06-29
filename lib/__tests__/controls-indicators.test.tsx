import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/status-badge'

describe('DS-1E controls and indicators', () => {
  it('declares shared control and indicator tokens in globals without a theme-parallel taxonomy', () => {
    const source = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8')

    expect(source).toContain('--control-background:')
    expect(source).toContain('--control-background-hover:')
    expect(source).toContain('--control-background-active:')
    expect(source).toContain('--control-border:')
    expect(source).toContain('--control-disabled-background:')
    expect(source).toContain('--indicator-brand:')
    expect(source).toContain('--indicator-success:')
    expect(source).toContain('--indicator-warning:')
    expect(source).toContain('--indicator-danger:')
    expect(source).toContain('--indicator-info:')
    expect(source).toContain('--indicator-unavailable:')
    expect(source).not.toContain('StudioButton')
    expect(source).not.toContain('StudioBadge')
  })

  it('keeps button variants on the shared primitive with explicit runtime metadata', () => {
    const markup = renderToStaticMarkup(
      <Button variant="outline" size="icon" disabled>
        A
      </Button>,
    )

    expect(markup).toContain('data-slot="button"')
    expect(markup).toContain('data-variant="outline"')
    expect(markup).toContain('data-size="icon"')

    const source = readFileSync(join(process.cwd(), 'components/ui/button.tsx'), 'utf8')
    expect(source).toContain("variant: 'default'")
    expect(source).toContain("size: 'default'")
    expect(source).toContain('var(--action-primary)')
    expect(source).toContain('var(--control-background)')
  })

  it('supports semantic status tones without collapsing them into brand colors', () => {
    const approved = renderToStaticMarkup(
      <StatusBadge label="Aprovado" tone="approved" />,
    )
    const warning = renderToStaticMarkup(
      <StatusBadge label="Gerando" tone="generated" />,
    )
    const unavailable = renderToStaticMarkup(
      <StatusBadge label="Indisponível" tone="unavailable" />,
    )

    expect(approved).toContain('data-slot="status-badge"')
    expect(approved).toContain('Aprovado')
    expect(warning).toContain('Gerando')
    expect(unavailable).toContain('Indisponível')

    const source = readFileSync(
      join(process.cwd(), 'components/ui/status-badge.tsx'),
      'utf8',
    )
    expect(source).toContain("'approved'")
    expect(source).toContain("'generated'")
    expect(source).toContain("'unavailable'")
    expect(source).toContain('var(--indicator-success)')
    expect(source).toContain('var(--indicator-warning)')
    expect(source).toContain('var(--indicator-danger)')
    expect(source).toContain('var(--indicator-info)')
  })

  it('keeps the settings appearance selector on shared controls with accessible selected state', () => {
    const source = readFileSync(
      join(process.cwd(), 'app/(dashboard)/configuracoes/page.tsx'),
      'utf8',
    )

    expect(source).toContain('aria-pressed={activeTheme === \'light\'}')
    expect(source).toContain('aria-pressed={activeTheme === \'dark\'}')
    expect(source).toContain('aria-pressed={activeTheme === \'system\'}')
    expect(source).toContain('aria-pressed={activeTheme === \'studio\'}')
    expect(source).toContain("data-selected={isSelected}")
    expect(source).not.toContain('StudioThemeSelector')
  })
})
