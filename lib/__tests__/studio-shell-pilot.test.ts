import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { flattenNavigationGroups, navigationGroups } from '@/lib/sidebar-navigation'
import {
  getDefaultStudioShellDesktopPreference,
  getLastVisibleStudioShellMode,
  getStudioShellEffectiveMode,
  sanitizeStudioShellDesktopPreference,
  STUDIO_SHELL_COMPACT_WIDTH,
  STUDIO_SHELL_EXPANDED_WIDTH,
  STUDIO_SHELL_LAST_VISIBLE_STORAGE_KEY,
  STUDIO_SHELL_MOBILE_BREAKPOINT,
  STUDIO_SHELL_STORAGE_KEY,
  STUDIO_SHELL_TOP_BAR_HEIGHT,
  STUDIO_SHELL_TRANSITION_MS,
  STUDIO_SHELL_WIDE_BREAKPOINT,
} from '@/lib/studio-shell-state'

const studioShellSource = () =>
  readFileSync(
    join(process.cwd(), 'components/layout/studio-shell.tsx'),
    'utf8',
  )

describe('DS-1H-B shell pilot composition', () => {
  it('uses the approved default desktop preference by viewport width', () => {
    expect(getDefaultStudioShellDesktopPreference(1600)).toBe('expanded')
    expect(getDefaultStudioShellDesktopPreference(1280)).toBe('expanded')
    expect(getDefaultStudioShellDesktopPreference(1024)).toBe('compact')
    expect(getDefaultStudioShellDesktopPreference(769)).toBe('compact')
    expect(getDefaultStudioShellDesktopPreference(768)).toBe('compact')
  })

  it('separates persisted desktop preference from the effective mode with <=768 as drawer', () => {
    expect(getStudioShellEffectiveMode('expanded', 1600)).toBe('expanded')
    expect(getStudioShellEffectiveMode('expanded', 1024)).toBe('compact')
    expect(getStudioShellEffectiveMode('expanded', 769)).toBe('compact')
    expect(getStudioShellEffectiveMode('expanded', 768)).toBe('mobile-drawer')
    expect(getStudioShellEffectiveMode('expanded', 390)).toBe('mobile-drawer')
    expect(getStudioShellEffectiveMode('hidden', 1600)).toBe('hidden')
  })

  it('keeps the last visible desktop mode when hiding the rail', () => {
    expect(getLastVisibleStudioShellMode('compact', 'expanded')).toBe('compact')
    expect(getLastVisibleStudioShellMode('hidden', 'compact')).toBe('compact')
    expect(getLastVisibleStudioShellMode('hidden', 'expanded')).toBe('expanded')
  })

  it('sanitizes invalid persisted values before reading desktop preference', () => {
    expect(sanitizeStudioShellDesktopPreference('expanded')).toBe('expanded')
    expect(sanitizeStudioShellDesktopPreference('compact')).toBe('compact')
    expect(sanitizeStudioShellDesktopPreference('hidden')).toBe('hidden')
    expect(sanitizeStudioShellDesktopPreference('drawer')).toBeNull()
    expect(sanitizeStudioShellDesktopPreference(null)).toBeNull()
  })

  it('keeps shell persistence local-only and writes last visible mode separately', () => {
    const source = studioShellSource()
    const stateSource = readFileSync(
      join(process.cwd(), 'lib/studio-shell-state.ts'),
      'utf8',
    )

    expect(stateSource).toContain(STUDIO_SHELL_STORAGE_KEY)
    expect(stateSource).toContain(STUDIO_SHELL_LAST_VISIBLE_STORAGE_KEY)
    expect(source).toContain('window.localStorage.getItem')
    expect(source).toContain('window.localStorage.setItem')
    expect(source).toContain('setHasExplicitPreference(Boolean(storedPreference))')
  })

  it('mounts a global utility bar instead of duplicating the header chrome per route', () => {
    const layoutSource = readFileSync(
      join(process.cwd(), 'app/(dashboard)/layout.tsx'),
      'utf8',
    )
    const headerSource = readFileSync(
      join(process.cwd(), 'components/layout/header.tsx'),
      'utf8',
    )

    expect(layoutSource).toContain('<StudioShell>{children}</StudioShell>')
    expect(studioShellSource()).toContain('function GlobalUtilityBar()')
    expect(studioShellSource()).toContain('<GlobalUtilityBar />')
    expect(headerSource).not.toContain('Bell')
    expect(headerSource).not.toContain('AvatarFallback')
  })

  it('keeps Configurações as a global action and not as a rail destination', () => {
    const source = studioShellSource()

    expect(flattenNavigationGroups().map((item) => item.label)).not.toContain(
      'Configurações',
    )
    expect(source).toContain('Abrir configurações')
    expect(source).toContain("router.push('/configuracoes')")
    expect(source).not.toContain('Studio shell pilot')
  })

  it('reuses the shared sidebar primitive for compact tooltip, hidden desktop mode, and mobile drawer control', () => {
    const source = studioShellSource()
    const primitiveSource = readFileSync(
      join(process.cwd(), 'components/ui/sidebar.tsx'),
      'utf8',
    )

    expect(source).toContain("collapsible={effectiveMode === 'hidden' ? 'offcanvas' : 'icon'}")
    expect(source).toContain('tooltip={item.label}')
    expect(source).toContain('closeMobileDrawerForNavigation()')
    expect(source).toContain('triggerRef.current?.focus()')
    expect(primitiveSource).toContain('openMobile?: boolean')
    expect(primitiveSource).toContain('onOpenMobileChange?: (open: boolean) => void')
  })

  it('documents the approved shell constants and compact composition', () => {
    expect(STUDIO_SHELL_EXPANDED_WIDTH).toBe('9.5rem')
    expect(STUDIO_SHELL_COMPACT_WIDTH).toBe('3.25rem')
    expect(STUDIO_SHELL_TOP_BAR_HEIGHT).toBe('3.125rem')
    expect(STUDIO_SHELL_TRANSITION_MS).toBe(200)
    expect(STUDIO_SHELL_MOBILE_BREAKPOINT).toBe(768)
    expect(STUDIO_SHELL_WIDE_BREAKPOINT).toBe(1280)

    const source = studioShellSource()
    expect(source).toContain('rounded-[1.25rem]')
    expect(source).toContain("return 'Ocultar navegação'")
    expect(source).toContain("return 'Mostrar navegação'")
    expect(source).not.toContain('EyeOff')
    expect(source).not.toContain('Content Agent Studio shell pilot')
    expect(source).not.toContain('theme ===')
    expect(source).not.toContain('activeTheme')
  })

  it('keeps a dedicated mobile drawer composition and reserves a future center slot in the top utility bar', () => {
    const source = studioShellSource()

    expect(source).toContain('data-slot="shell-utility-center"')
    expect(source).toContain('if (isMobileViewport)')
    expect(source).toContain('collapsible="offcanvas"')
    expect(source).toContain('!bg-surface-elevated')
    expect(source).toContain('!w-[min(11.75rem,56vw)]')
    expect(source).toContain('Content Studio')
  })

  it('keeps only the approved rail groups after removing the system section', () => {
    expect(navigationGroups.map((group) => group.label)).toEqual([
      'Workspace',
      'Criação',
      'Bibliotecas',
    ])
  })
})
