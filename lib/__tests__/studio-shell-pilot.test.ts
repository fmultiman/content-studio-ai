import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { flattenNavigationGroups, navigationGroups } from '@/lib/sidebar-navigation'
import {
  canStudioShellExpandImmediately,
  getDefaultStudioShellDesktopPreference,
  getLastVisibleStudioShellMode,
  getStudioShellEffectiveMode,
  getStudioShellRenderedDesktopMode,
  resolveStudioShellState,
  sanitizeStudioShellDesktopPreference,
  STUDIO_SHELL_COMPACT_WIDTH,
  STUDIO_SHELL_EXPANDED_WIDTH,
  STUDIO_SHELL_LAST_VISIBLE_STORAGE_KEY,
  STUDIO_SHELL_MOBILE_BREAKPOINT,
  STUDIO_SHELL_MOBILE_DRAWER_VIEWPORT_WIDTH,
  STUDIO_SHELL_MOBILE_DRAWER_WIDTH,
  STUDIO_SHELL_STORAGE_KEY,
  STUDIO_SHELL_PAGE_PADDING,
  STUDIO_SHELL_RAIL_MAX_HEIGHT,
  STUDIO_SHELL_RAIL_RADIUS,
  STUDIO_SHELL_RAIL_TOP_OFFSET,
  STUDIO_SHELL_TOP_BAR_HEIGHT,
  STUDIO_SHELL_TRANSITION_MS,
  STUDIO_SHELL_WIDE_BREAKPOINT,
} from '@/lib/studio-shell-state'

const studioShellSource = () =>
  readFileSync(
    join(process.cwd(), 'components/layout/studio-shell.tsx'),
    'utf8',
  )

describe('DS-1H-C shell foundation', () => {
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

  it('forces compact at 1279 and respects expanded again at 1280', () => {
    expect(getStudioShellEffectiveMode('expanded', 1279)).toBe('compact')
    expect(getStudioShellEffectiveMode('expanded', 1280)).toBe('expanded')
    expect(canStudioShellExpandImmediately(1279)).toBe(false)
    expect(canStudioShellExpandImmediately(1280)).toBe(true)
  })

  it('resolves first load without preference from viewport defaults', () => {
    expect(
      resolveStudioShellState({
        viewportWidth: 1600,
        storedPreference: null,
        storedLastVisibleMode: null,
      }),
    ).toMatchObject({
      desktopPreference: 'expanded',
      effectiveMode: 'expanded',
      hasExplicitPreference: false,
      lastVisibleMode: 'expanded',
    })

    expect(
      resolveStudioShellState({
        viewportWidth: 768,
        storedPreference: null,
        storedLastVisibleMode: null,
      }),
    ).toMatchObject({
      desktopPreference: 'compact',
      effectiveMode: 'mobile-drawer',
      hasExplicitPreference: false,
      lastVisibleMode: 'compact',
    })
  })

  it('resolves persisted expanded and compact preferences without overwriting them', () => {
    expect(
      resolveStudioShellState({
        viewportWidth: 1600,
        storedPreference: 'expanded',
        storedLastVisibleMode: 'expanded',
      }),
    ).toMatchObject({
      desktopPreference: 'expanded',
      effectiveMode: 'expanded',
      hasExplicitPreference: true,
      lastVisibleMode: 'expanded',
    })

    expect(
      resolveStudioShellState({
        viewportWidth: 1600,
        storedPreference: 'compact',
        storedLastVisibleMode: 'compact',
      }),
    ).toMatchObject({
      desktopPreference: 'compact',
      effectiveMode: 'compact',
      hasExplicitPreference: true,
      lastVisibleMode: 'compact',
    })
  })

  it('preserves hidden plus lastVisibleMode and keeps expanded preference compact-effective at 1024', () => {
    expect(
      resolveStudioShellState({
        viewportWidth: 1600,
        storedPreference: 'hidden',
        storedLastVisibleMode: 'compact',
      }),
    ).toMatchObject({
      desktopPreference: 'hidden',
      effectiveMode: 'hidden',
      hasExplicitPreference: true,
      lastVisibleMode: 'compact',
    })

    expect(
      resolveStudioShellState({
        viewportWidth: 1024,
        storedPreference: 'expanded',
        storedLastVisibleMode: 'expanded',
      }),
    ).toMatchObject({
      desktopPreference: 'expanded',
      effectiveMode: 'compact',
      hasExplicitPreference: true,
      lastVisibleMode: 'expanded',
    })
  })

  it('returns to desktop without overwriting persisted preference after mobile drawer mode', () => {
    const mobileState = resolveStudioShellState({
      viewportWidth: 768,
      storedPreference: 'expanded',
      storedLastVisibleMode: 'expanded',
    })
    const desktopState = resolveStudioShellState({
      viewportWidth: 1280,
      storedPreference: mobileState.desktopPreference,
      storedLastVisibleMode: mobileState.lastVisibleMode,
    })

    expect(mobileState).toMatchObject({
      desktopPreference: 'expanded',
      effectiveMode: 'mobile-drawer',
      lastVisibleMode: 'expanded',
    })
    expect(desktopState).toMatchObject({
      desktopPreference: 'expanded',
      effectiveMode: 'expanded',
      lastVisibleMode: 'expanded',
    })
  })

  it('keeps the last visible desktop mode when hiding the rail', () => {
    expect(getLastVisibleStudioShellMode('compact', 'expanded')).toBe('compact')
    expect(getLastVisibleStudioShellMode('hidden', 'compact')).toBe('compact')
    expect(getLastVisibleStudioShellMode('hidden', 'expanded')).toBe('expanded')
  })

  it('preserves compact and expanded geometry during hidden desktop exit transitions', () => {
    expect(
      getStudioShellRenderedDesktopMode({
        effectiveMode: 'hidden',
        lastVisibleMode: 'expanded',
        hiddenVisualMode: 'compact',
      }),
    ).toBe('compact')

    expect(
      getStudioShellRenderedDesktopMode({
        effectiveMode: 'hidden',
        lastVisibleMode: 'compact',
        hiddenVisualMode: 'expanded',
      }),
    ).toBe('expanded')

    expect(
      getStudioShellRenderedDesktopMode({
        effectiveMode: 'compact',
        lastVisibleMode: 'expanded',
      }),
    ).toBe('compact')

    expect(
      getStudioShellRenderedDesktopMode({
        effectiveMode: 'expanded',
        lastVisibleMode: 'compact',
      }),
    ).toBe('expanded')
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
    expect(source).toContain('useSyncExternalStore')
    expect(source).toContain('getStoredStudioShellStateSnapshot')
    expect(source).toContain('data-shell-rendered-desktop-mode')
    expect(source).not.toContain('setHasExplicitPreference(')
  })

  it('mounts a global utility bar and removes legacy shell call sites', () => {
    const layoutSource = readFileSync(
      join(process.cwd(), 'app/(dashboard)/layout.tsx'),
      'utf8',
    )

    expect(layoutSource).toContain('<StudioShell>{children}</StudioShell>')
    expect(studioShellSource()).toContain('function GlobalUtilityBar()')
    expect(studioShellSource()).toContain('<GlobalUtilityBar />')
    expect(
      existsSync(join(process.cwd(), 'components/layout/header.tsx')),
    ).toBe(false)
    expect(
      existsSync(join(process.cwd(), 'components/layout/sidebar.tsx')),
    ).toBe(false)
    expect(
      existsSync(join(process.cwd(), 'components/ui/use-mobile.tsx')),
    ).toBe(false)
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
    expect(STUDIO_SHELL_MOBILE_DRAWER_WIDTH).toBe('11.75rem')
    expect(STUDIO_SHELL_MOBILE_DRAWER_VIEWPORT_WIDTH).toBe('56vw')
    expect(STUDIO_SHELL_TOP_BAR_HEIGHT).toBe('3.125rem')
    expect(STUDIO_SHELL_RAIL_TOP_OFFSET).toBe('3.75rem')
    expect(STUDIO_SHELL_RAIL_MAX_HEIGHT).toBe('calc(100svh - 4.5rem)')
    expect(STUDIO_SHELL_RAIL_RADIUS).toBe('1.25rem')
    expect(STUDIO_SHELL_PAGE_PADDING).toBe('1.5rem')
    expect(STUDIO_SHELL_TRANSITION_MS).toBe(200)
    expect(STUDIO_SHELL_MOBILE_BREAKPOINT).toBe(768)
    expect(STUDIO_SHELL_WIDE_BREAKPOINT).toBe(1280)

    const source = studioShellSource()
    expect(source).toContain('STUDIO_SHELL_RAIL_RADIUS')
    expect(source).toContain('STUDIO_SHELL_RAIL_MAX_HEIGHT')
    expect(source).toContain('canStudioShellExpandImmediately')
    expect(source).toContain('getStudioShellRenderedDesktopMode')
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
    expect(source).toContain('STUDIO_SHELL_MOBILE_DRAWER_WIDTH')
    expect(source).toContain('STUDIO_SHELL_MOBILE_DRAWER_VIEWPORT_WIDTH')
    expect(source).toContain('Content Studio')
  })

  it('freezes hidden exit geometry from the rendered mode instead of the persisted preference', () => {
    const source = studioShellSource()

    expect(source).toContain("setHiddenVisualMode(\n      effectiveMode === 'expanded' ? 'expanded' : 'compact',")
    expect(source).toContain("renderedDesktopMode === 'compact'")
    expect(source).toContain("data-shell-rendered-desktop-mode={renderedDesktopMode ?? ''}")
  })

  it('hides the local expand affordance at constrained tablet widths and uses a real mobile menu trigger', () => {
    const source = studioShellSource()

    expect(source).toContain('if (isCompact && !canExpandImmediately) {')
    expect(source).toContain("<Menu className=\"h-4 w-4\" />")
    expect(source).toContain("<X className=\"h-4 w-4\" />")
    expect(source).not.toContain('<PanelLeft className="h-4 w-4" />')
  })

  it('keeps only the approved rail groups after removing the system section', () => {
    expect(navigationGroups.map((group) => group.label)).toEqual([
      'Workspace',
      'Criação',
      'Bibliotecas',
    ])
  })
})
