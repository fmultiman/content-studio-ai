import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  USER_SELECTABLE_THEMES,
  isUserSelectableTheme,
  normalizeUserSelectableTheme,
  resolveBootstrapThemePreference,
} from '../theme'
import { executeThemeBootstrap } from '../theme-bootstrap'

describe('theme infrastructure helpers', () => {
  it('keeps only light, dark and system as user-selectable themes', () => {
    expect(USER_SELECTABLE_THEMES).toEqual(['light', 'dark', 'system'])
    expect(DEFAULT_THEME).toBe('dark')
    expect(isUserSelectableTheme('light')).toBe(true)
    expect(isUserSelectableTheme('dark')).toBe(true)
    expect(isUserSelectableTheme('system')).toBe(true)
    expect(isUserSelectableTheme('studio')).toBe(false)
  })

  it('normalizes unsupported values to the default theme', () => {
    expect(normalizeUserSelectableTheme('studio')).toBe('dark')
    expect(normalizeUserSelectableTheme(undefined, 'system')).toBe('system')
  })

  it('prefers a valid local theme and otherwise bootstraps from a valid remote theme', () => {
    expect(THEME_STORAGE_KEY).toBe('theme')
    expect(resolveBootstrapThemePreference('light', 'dark')).toBeNull()
    expect(resolveBootstrapThemePreference('dark', 'system')).toBeNull()
    expect(resolveBootstrapThemePreference('invalid', 'light')).toBe('light')
    expect(resolveBootstrapThemePreference(null, 'system')).toBe('system')
    expect(resolveBootstrapThemePreference(undefined, 'studio')).toBeNull()
  })

  it('does not conclude bootstrap before authentication is resolved', async () => {
    const attemptedUserIds = new Set<string>()
    const fetchRemoteTheme = async () => 'light'
    const applyTheme = () => undefined
    const onError = () => undefined

    await expect(
      executeThemeBootstrap({
        authResolved: false,
        userId: null,
        localTheme: null,
        attemptedUserIds,
        fetchRemoteTheme,
        applyTheme,
        onError,
      }),
    ).resolves.toBe('waiting-for-auth')

    expect(attemptedUserIds.size).toBe(0)
  })

  it('boots when a user becomes available later and applies a valid remote theme', async () => {
    const attemptedUserIds = new Set<string>()
    const appliedThemes: string[] = []

    await expect(
      executeThemeBootstrap({
        authResolved: true,
        userId: 'user-1',
        localTheme: null,
        attemptedUserIds,
        fetchRemoteTheme: async () => 'light',
        applyTheme: (theme) => appliedThemes.push(theme),
        onError: () => undefined,
      }),
    ).resolves.toBe('applied-remote-theme')

    expect(appliedThemes).toEqual(['light'])
    expect(attemptedUserIds.has('user-1')).toBe(true)
  })

  it('keeps a valid local theme ahead of a conflicting remote theme', async () => {
    const attemptedUserIds = new Set<string>()
    const appliedThemes: string[] = []
    let fetchCalls = 0

    await expect(
      executeThemeBootstrap({
        authResolved: true,
        userId: 'user-1',
        localTheme: 'dark',
        attemptedUserIds,
        fetchRemoteTheme: async () => {
          fetchCalls += 1
          return 'light'
        },
        applyTheme: (theme) => appliedThemes.push(theme),
        onError: () => undefined,
      }),
    ).resolves.toBe('skipped-local-theme')

    expect(fetchCalls).toBe(0)
    expect(appliedThemes).toEqual([])
  })

  it('keeps the default path when the remote theme is invalid', async () => {
    const attemptedUserIds = new Set<string>()
    const appliedThemes: string[] = []

    await expect(
      executeThemeBootstrap({
        authResolved: true,
        userId: 'user-1',
        localTheme: null,
        attemptedUserIds,
        fetchRemoteTheme: async () => 'studio',
        applyTheme: (theme) => appliedThemes.push(theme),
        onError: () => undefined,
      }),
    ).resolves.toBe('no-valid-remote-theme')

    expect(appliedThemes).toEqual([])
  })

  it('surfaces query failure instead of marking silent success', async () => {
    const attemptedUserIds = new Set<string>()
    const appliedThemes: string[] = []
    const capturedErrors: Array<{ error: unknown; userId: string }> = []

    await expect(
      executeThemeBootstrap({
        authResolved: true,
        userId: 'user-1',
        localTheme: null,
        attemptedUserIds,
        fetchRemoteTheme: async () => {
          throw new Error('boom')
        },
        applyTheme: (theme) => appliedThemes.push(theme),
        onError: (error, userId) => capturedErrors.push({ error, userId }),
      }),
    ).resolves.toBe('query-failed')

    expect(appliedThemes).toEqual([])
    expect(capturedErrors).toHaveLength(1)
    expect(capturedErrors[0]?.userId).toBe('user-1')
  })

  it('does not reuse bootstrap state across different authenticated users', async () => {
    const attemptedUserIds = new Set<string>()
    const appliedThemes: string[] = []
    const fetchedUserIds: string[] = []

    await executeThemeBootstrap({
      authResolved: true,
      userId: 'user-1',
      localTheme: null,
      attemptedUserIds,
      fetchRemoteTheme: async (userId) => {
        fetchedUserIds.push(userId)
        return 'light'
      },
      applyTheme: (theme) => appliedThemes.push(theme),
      onError: () => undefined,
    })

    await executeThemeBootstrap({
      authResolved: true,
      userId: 'user-2',
      localTheme: null,
      attemptedUserIds,
      fetchRemoteTheme: async (userId) => {
        fetchedUserIds.push(userId)
        return 'dark'
      },
      applyTheme: (theme) => appliedThemes.push(theme),
      onError: () => undefined,
    })

    expect(fetchedUserIds).toEqual(['user-1', 'user-2'])
    expect(appliedThemes).toEqual(['light', 'dark'])
  })

  it('runs at most once per authenticated user within the same mount lifetime', async () => {
    const attemptedUserIds = new Set<string>()
    const appliedThemes: string[] = []
    let fetchCalls = 0

    await executeThemeBootstrap({
      authResolved: true,
      userId: 'user-1',
      localTheme: null,
      attemptedUserIds,
      fetchRemoteTheme: async () => {
        fetchCalls += 1
        return 'light'
      },
      applyTheme: (theme) => appliedThemes.push(theme),
      onError: () => undefined,
    })

    await expect(
      executeThemeBootstrap({
        authResolved: true,
        userId: 'user-1',
        localTheme: null,
        attemptedUserIds,
        fetchRemoteTheme: async () => {
          fetchCalls += 1
          return 'light'
        },
        applyTheme: (theme) => appliedThemes.push(theme),
        onError: () => undefined,
      }),
    ).resolves.toBe('already-attempted')

    expect(fetchCalls).toBe(1)
    expect(appliedThemes).toEqual(['light'])
  })
})

describe('design system token infrastructure', () => {
  it('declares the semantic product tokens and preserves shadcn aliases', () => {
    const source = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8')

    expect(source).toContain('--canvas: var(--background);')
    expect(source).toContain('--surface-translucent:')
    expect(source).toContain('--text-primary: var(--foreground);')
    expect(source).toContain('--border-focus: var(--ring);')
    expect(source).toContain('--action-primary: var(--primary);')
    expect(source).toContain('--success:')
    expect(source).toContain('--atmosphere-primary:')
    expect(source).toContain('--elevation-low:')
    expect(source).toContain('--radius-control:')
    expect(source).toContain('--color-background: var(--background);')
    expect(source).toContain('--color-canvas: var(--canvas);')
    expect(source).toContain('--shadow-elevation-low: var(--elevation-low);')
  })

  it('integrates next-themes in the layout without forcing dark mode', () => {
    const layoutSource = readFileSync(join(process.cwd(), 'app/layout.tsx'), 'utf8')
    const dashboardLayoutSource = readFileSync(
      join(process.cwd(), 'app/(dashboard)/layout.tsx'),
      'utf8',
    )

    expect(layoutSource).toContain('suppressHydrationWarning')
    expect(layoutSource).toContain('<ThemeProvider>')
    expect(layoutSource).not.toContain('className="dark bg-background"')
    expect(dashboardLayoutSource).toContain('<ThemePreferenceBootstrap />')
  })

  it('bootstraps the remote theme outside settings and reacts to authenticated user availability', () => {
    const bootstrapSource = readFileSync(
      join(process.cwd(), 'components/theme-preference-bootstrap.tsx'),
      'utf8',
    )

    expect(bootstrapSource).toContain("window.localStorage.getItem(THEME_STORAGE_KEY)")
    expect(bootstrapSource).toContain('const [authResolved, setAuthResolved] = useState(false)')
    expect(bootstrapSource).toContain("supabase.auth.onAuthStateChange")
    expect(bootstrapSource).toContain("supabase.auth.getSession()")
    expect(bootstrapSource).toContain(".from('user_settings')")
    expect(bootstrapSource).toContain(".select('theme')")
    expect(bootstrapSource).toContain('executeThemeBootstrap({')
    expect(bootstrapSource).toContain('attemptedUserIdsRef')
    expect(bootstrapSource).toContain("console.error('ThemePreferenceBootstrap failed to load remote theme'")
    expect(bootstrapSource).not.toContain('studio')

    expect(
      bootstrapSource.indexOf("supabase.auth.onAuthStateChange"),
    ).toBeLessThan(
      bootstrapSource.indexOf("supabase.auth.getSession()"),
    )
  })

  it('uses next-themes as the single source of truth in settings without bootstrap logic', () => {
    const settingsSource = readFileSync(
      join(process.cwd(), 'app/(dashboard)/configuracoes/page.tsx'),
      'utf8',
    )

    expect(settingsSource).toContain("import { useTheme } from 'next-themes'")
    expect(settingsSource).toContain('const { theme, setTheme } = useTheme()')
    expect(settingsSource).toContain("handleThemeChange('system')")
    expect(settingsSource).not.toContain('resolveBootstrapThemePreference(')
    expect(settingsSource).not.toContain('THEME_STORAGE_KEY')
    expect(settingsSource).not.toContain(".from('user_settings').select('theme')")
    expect(settingsSource).not.toContain('document.documentElement')
    expect(settingsSource).not.toContain('classList.remove')
    expect(settingsSource).not.toContain('localStorage.setItem')
  })

  it('keeps Studio out of the runtime theme provider configuration', () => {
    const providerSource = readFileSync(
      join(process.cwd(), 'components/theme-provider.tsx'),
      'utf8',
    )

    expect(providerSource).toContain('attribute="class"')
    expect(providerSource).toContain('defaultTheme="dark"')
    expect(providerSource).toContain('storageKey={THEME_STORAGE_KEY}')
    expect(providerSource).toContain('enableSystem')
    expect(providerSource).toContain("themes={['light', 'dark']}")
    expect(providerSource).not.toContain('studio')
  })
})
