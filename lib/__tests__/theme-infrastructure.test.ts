import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_STUDIO_INTENSITY,
  DEFAULT_THEME,
  STUDIO_INTENSITIES,
  STUDIO_INTENSITY_STORAGE_KEY,
  THEME_STORAGE_KEY,
  USER_SELECTABLE_THEMES,
  isStudioIntensity,
  isUserSelectableTheme,
  normalizeStudioIntensity,
  normalizeUserSelectableTheme,
  resolveBootstrapStudioIntensityPreference,
  resolveBootstrapThemePreference,
} from '../theme'
import { executeThemeBootstrap } from '../theme-bootstrap'

describe('theme infrastructure helpers', () => {
  it('keeps studio as a single user-selectable theme', () => {
    expect(USER_SELECTABLE_THEMES).toEqual(['light', 'dark', 'system', 'studio'])
    expect(DEFAULT_THEME).toBe('dark')
    expect(isUserSelectableTheme('light')).toBe(true)
    expect(isUserSelectableTheme('dark')).toBe(true)
    expect(isUserSelectableTheme('system')).toBe(true)
    expect(isUserSelectableTheme('studio')).toBe(true)
    expect(isUserSelectableTheme('studio-soft')).toBe(false)
  })

  it('declares valid studio intensity presets with balanced as the fallback', () => {
    expect(STUDIO_INTENSITIES).toEqual(['soft', 'balanced', 'expressive'])
    expect(DEFAULT_STUDIO_INTENSITY).toBe('balanced')
    expect(STUDIO_INTENSITY_STORAGE_KEY).toBe('studio-intensity')
    expect(isStudioIntensity('soft')).toBe(true)
    expect(isStudioIntensity('balanced')).toBe(true)
    expect(isStudioIntensity('expressive')).toBe(true)
    expect(isStudioIntensity('studio')).toBe(false)
  })

  it('normalizes unsupported theme and intensity values to safe defaults', () => {
    expect(normalizeUserSelectableTheme(undefined, 'system')).toBe('system')
    expect(normalizeUserSelectableTheme('unknown')).toBe('dark')
    expect(normalizeStudioIntensity(undefined)).toBe('balanced')
    expect(normalizeStudioIntensity('unknown')).toBe('balanced')
  })

  it('prefers a valid local theme and otherwise bootstraps from a valid remote theme', () => {
    expect(THEME_STORAGE_KEY).toBe('theme')
    expect(resolveBootstrapThemePreference('light', 'dark')).toBeNull()
    expect(resolveBootstrapThemePreference('dark', 'system')).toBeNull()
    expect(resolveBootstrapThemePreference('invalid', 'light')).toBe('light')
    expect(resolveBootstrapThemePreference(null, 'system')).toBe('system')
    expect(resolveBootstrapThemePreference(undefined, 'studio')).toBe('studio')
  })

  it('prefers a valid local studio intensity and otherwise falls back to balanced', () => {
    expect(resolveBootstrapStudioIntensityPreference('soft', 'expressive')).toBeNull()
    expect(resolveBootstrapStudioIntensityPreference(undefined, 'soft')).toBe('soft')
    expect(resolveBootstrapStudioIntensityPreference(null, 'balanced')).toBe('balanced')
    expect(resolveBootstrapStudioIntensityPreference('unknown', 'invalid')).toBe('balanced')
  })

  it('does not conclude bootstrap before authentication is resolved', async () => {
    const attemptedUserIds = new Set<string>()
    const appliedThemes: string[] = []
    const appliedStudioIntensities: string[] = []

    await expect(
      executeThemeBootstrap({
        authResolved: false,
        userId: null,
        localTheme: null,
        localStudioIntensity: null,
        attemptedUserIds,
        fetchRemotePreferences: async () => ({
          studioIntensity: 'balanced',
          theme: 'light',
        }),
        applyTheme: (theme) => appliedThemes.push(theme),
        applyStudioIntensity: (studioIntensity) => appliedStudioIntensities.push(studioIntensity),
        onError: () => undefined,
      }),
    ).resolves.toBe('waiting-for-auth')

    expect(appliedThemes).toEqual([])
    expect(appliedStudioIntensities).toEqual([])
    expect(attemptedUserIds.size).toBe(0)
  })

  it('boots when a user becomes available later and applies remote theme plus remote intensity', async () => {
    const attemptedUserIds = new Set<string>()
    const appliedThemes: string[] = []
    const appliedStudioIntensities: string[] = []

    await expect(
      executeThemeBootstrap({
        authResolved: true,
        userId: 'user-1',
        localTheme: null,
        localStudioIntensity: null,
        attemptedUserIds,
        fetchRemotePreferences: async () => ({
          studioIntensity: 'expressive',
          theme: 'studio',
        }),
        applyTheme: (theme) => appliedThemes.push(theme),
        applyStudioIntensity: (studioIntensity) => appliedStudioIntensities.push(studioIntensity),
        onError: () => undefined,
      }),
    ).resolves.toBe('applied-remote-theme-and-studio-intensity')

    expect(appliedThemes).toEqual(['studio'])
    expect(appliedStudioIntensities).toEqual(['expressive'])
    expect(attemptedUserIds.has('user-1')).toBe(true)
  })

  it('keeps a valid local theme and valid local intensity ahead of conflicting remote preferences', async () => {
    const attemptedUserIds = new Set<string>()
    const appliedThemes: string[] = []
    const appliedStudioIntensities: string[] = []
    let fetchCalls = 0

    await expect(
      executeThemeBootstrap({
        authResolved: true,
        userId: 'user-1',
        localTheme: 'dark',
        localStudioIntensity: 'soft',
        attemptedUserIds,
        fetchRemotePreferences: async () => {
          fetchCalls += 1
          return {
            studioIntensity: 'expressive',
            theme: 'studio',
          }
        },
        applyTheme: (theme) => appliedThemes.push(theme),
        applyStudioIntensity: (studioIntensity) => appliedStudioIntensities.push(studioIntensity),
        onError: () => undefined,
      }),
    ).resolves.toBe('skipped-local-preferences')

    expect(fetchCalls).toBe(0)
    expect(appliedThemes).toEqual([])
    expect(appliedStudioIntensities).toEqual([])
  })

  it('can bootstrap only the remote studio intensity when the local theme is already valid', async () => {
    const attemptedUserIds = new Set<string>()
    const appliedThemes: string[] = []
    const appliedStudioIntensities: string[] = []

    await expect(
      executeThemeBootstrap({
        authResolved: true,
        userId: 'user-1',
        localTheme: 'studio',
        localStudioIntensity: null,
        attemptedUserIds,
        fetchRemotePreferences: async () => ({
          studioIntensity: 'soft',
          theme: 'dark',
        }),
        applyTheme: (theme) => appliedThemes.push(theme),
        applyStudioIntensity: (studioIntensity) => appliedStudioIntensities.push(studioIntensity),
        onError: () => undefined,
      }),
    ).resolves.toBe('applied-remote-studio-intensity')

    expect(appliedThemes).toEqual([])
    expect(appliedStudioIntensities).toEqual(['soft'])
  })

  it('falls back to balanced when the remote intensity is missing or invalid', async () => {
    const attemptedUserIds = new Set<string>()
    const appliedThemes: string[] = []
    const appliedStudioIntensities: string[] = []

    await expect(
      executeThemeBootstrap({
        authResolved: true,
        userId: 'user-1',
        localTheme: 'light',
        localStudioIntensity: null,
        attemptedUserIds,
        fetchRemotePreferences: async () => ({
          studioIntensity: 'unknown',
          theme: 'dark',
        }),
        applyTheme: (theme) => appliedThemes.push(theme),
        applyStudioIntensity: (studioIntensity) => appliedStudioIntensities.push(studioIntensity),
        onError: () => undefined,
      }),
    ).resolves.toBe('applied-default-studio-intensity')

    expect(appliedThemes).toEqual([])
    expect(appliedStudioIntensities).toEqual(['balanced'])
  })

  it('keeps the default path when the remote theme is invalid and the intensity is already local', async () => {
    const attemptedUserIds = new Set<string>()
    const appliedThemes: string[] = []
    const appliedStudioIntensities: string[] = []

    await expect(
      executeThemeBootstrap({
        authResolved: true,
        userId: 'user-1',
        localTheme: null,
        localStudioIntensity: 'balanced',
        attemptedUserIds,
        fetchRemotePreferences: async () => ({
          studioIntensity: 'expressive',
          theme: 'invalid',
        }),
        applyTheme: (theme) => appliedThemes.push(theme),
        applyStudioIntensity: (studioIntensity) => appliedStudioIntensities.push(studioIntensity),
        onError: () => undefined,
      }),
    ).resolves.toBe('no-valid-remote-theme')

    expect(appliedThemes).toEqual([])
    expect(appliedStudioIntensities).toEqual([])
  })

  it('surfaces query failure instead of marking silent success', async () => {
    const attemptedUserIds = new Set<string>()
    const appliedThemes: string[] = []
    const appliedStudioIntensities: string[] = []
    const capturedErrors: Array<{ error: unknown; userId: string }> = []

    await expect(
      executeThemeBootstrap({
        authResolved: true,
        userId: 'user-1',
        localTheme: null,
        localStudioIntensity: null,
        attemptedUserIds,
        fetchRemotePreferences: async () => {
          throw new Error('boom')
        },
        applyTheme: (theme) => appliedThemes.push(theme),
        applyStudioIntensity: (studioIntensity) => appliedStudioIntensities.push(studioIntensity),
        onError: (error, userId) => capturedErrors.push({ error, userId }),
      }),
    ).resolves.toBe('query-failed')

    expect(appliedThemes).toEqual([])
    expect(appliedStudioIntensities).toEqual([])
    expect(capturedErrors).toHaveLength(1)
    expect(capturedErrors[0]?.userId).toBe('user-1')
  })

  it('does not reuse bootstrap state across different authenticated users', async () => {
    const attemptedUserIds = new Set<string>()
    const appliedThemes: string[] = []
    const appliedStudioIntensities: string[] = []
    const fetchedUserIds: string[] = []

    await executeThemeBootstrap({
      authResolved: true,
      userId: 'user-1',
      localTheme: null,
      localStudioIntensity: null,
      attemptedUserIds,
      fetchRemotePreferences: async (userId) => {
        fetchedUserIds.push(userId)
        return {
          studioIntensity: 'soft',
          theme: 'studio',
        }
      },
      applyTheme: (theme) => appliedThemes.push(theme),
      applyStudioIntensity: (studioIntensity) => appliedStudioIntensities.push(studioIntensity),
      onError: () => undefined,
    })

    await executeThemeBootstrap({
      authResolved: true,
      userId: 'user-2',
      localTheme: null,
      localStudioIntensity: null,
      attemptedUserIds,
      fetchRemotePreferences: async (userId) => {
        fetchedUserIds.push(userId)
        return {
          studioIntensity: 'expressive',
          theme: 'dark',
        }
      },
      applyTheme: (theme) => appliedThemes.push(theme),
      applyStudioIntensity: (studioIntensity) => appliedStudioIntensities.push(studioIntensity),
      onError: () => undefined,
    })

    expect(fetchedUserIds).toEqual(['user-1', 'user-2'])
    expect(appliedThemes).toEqual(['studio', 'dark'])
    expect(appliedStudioIntensities).toEqual(['soft', 'expressive'])
  })

  it('runs at most once per authenticated user within the same mount lifetime', async () => {
    const attemptedUserIds = new Set<string>()
    const appliedThemes: string[] = []
    const appliedStudioIntensities: string[] = []
    let fetchCalls = 0

    await executeThemeBootstrap({
      authResolved: true,
      userId: 'user-1',
      localTheme: null,
      localStudioIntensity: null,
      attemptedUserIds,
      fetchRemotePreferences: async () => {
        fetchCalls += 1
        return {
          studioIntensity: 'soft',
          theme: 'studio',
        }
      },
      applyTheme: (theme) => appliedThemes.push(theme),
      applyStudioIntensity: (studioIntensity) => appliedStudioIntensities.push(studioIntensity),
      onError: () => undefined,
    })

    await expect(
      executeThemeBootstrap({
        authResolved: true,
        userId: 'user-1',
        localTheme: null,
        localStudioIntensity: null,
        attemptedUserIds,
        fetchRemotePreferences: async () => {
          fetchCalls += 1
          return {
            studioIntensity: 'balanced',
            theme: 'light',
          }
        },
        applyTheme: (theme) => appliedThemes.push(theme),
        applyStudioIntensity: (studioIntensity) => appliedStudioIntensities.push(studioIntensity),
        onError: () => undefined,
      }),
    ).resolves.toBe('already-attempted')

    expect(fetchCalls).toBe(1)
    expect(appliedThemes).toEqual(['studio'])
    expect(appliedStudioIntensities).toEqual(['soft'])
  })
})

describe('design system token infrastructure', () => {
  it('declares the semantic product tokens and studio atmosphere tokens without cycles', () => {
    const source = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8')

    expect(source).toContain('--canvas: var(--background);')
    expect(source).toContain('--surface-translucent:')
    expect(source).toContain('--text-primary: var(--foreground);')
    expect(source).toContain('--border-focus: var(--ring);')
    expect(source).toContain('--action-primary: var(--primary);')
    expect(source).toContain('--success:')
    expect(source).toContain('--studio-atmosphere-opacity:')
    expect(source).toContain('--studio-halo-primary-opacity:')
    expect(source).toContain('--studio-halo-secondary-opacity:')
    expect(source).toContain('--studio-halo-size:')
    expect(source).toContain('--studio-glass-opacity:')
    expect(source).toContain('--studio-glass-blur:')
    expect(source).toContain('--studio-accent-intensity:')
    expect(source).toContain('.studio[data-studio-intensity="soft"]')
    expect(source).toContain('.studio[data-studio-intensity="balanced"]')
    expect(source).toContain('.studio[data-studio-intensity="expressive"]')
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

  it('bootstraps remote theme and studio intensity outside settings', () => {
    const bootstrapSource = readFileSync(
      join(process.cwd(), 'components/theme-preference-bootstrap.tsx'),
      'utf8',
    )

    expect(bootstrapSource).toContain("window.localStorage.getItem(THEME_STORAGE_KEY)")
    expect(bootstrapSource).toContain(
      "window.localStorage.getItem(STUDIO_INTENSITY_STORAGE_KEY)",
    )
    expect(bootstrapSource).toContain('const [authResolved, setAuthResolved] = useState(false)')
    expect(bootstrapSource).toContain("supabase.auth.onAuthStateChange")
    expect(bootstrapSource).toContain("supabase.auth.getSession()")
    expect(bootstrapSource).toContain(".from('user_settings')")
    expect(bootstrapSource).toContain(".select('theme, studio_intensity')")
    expect(bootstrapSource).toContain('executeThemeBootstrap({')
    expect(bootstrapSource).toContain('applyStudioIntensity')
    expect(bootstrapSource).toContain('attemptedUserIdsRef')
    expect(bootstrapSource).toContain(
      "console.error('ThemePreferenceBootstrap failed to load remote preferences'",
    )

    expect(
      bootstrapSource.indexOf("supabase.auth.onAuthStateChange"),
    ).toBeLessThan(
      bootstrapSource.indexOf("supabase.auth.getSession()"),
    )
  })

  it('uses next-themes and the studio intensity provider in settings without manual dom theme toggling', () => {
    const settingsSource = readFileSync(
      join(process.cwd(), 'app/(dashboard)/configuracoes/page.tsx'),
      'utf8',
    )

    expect(settingsSource).toContain("import { useTheme } from 'next-themes'")
    expect(settingsSource).toContain("import { useStudioIntensity } from '@/components/theme-provider'")
    expect(settingsSource).toContain('const { theme, setTheme } = useTheme()')
    expect(settingsSource).toContain('isStudioIntensityReady')
    expect(settingsSource).toContain("handleThemeChange('studio')")
    expect(settingsSource).toContain('handleStudioIntensityChange')
    expect(settingsSource).not.toContain('resolveBootstrapThemePreference(')
    expect(settingsSource).not.toContain('THEME_STORAGE_KEY')
    expect(settingsSource).not.toContain(".from('user_settings').select('theme')")
    expect(settingsSource).not.toContain('document.documentElement')
    expect(settingsSource).not.toContain('classList.remove')
    expect(settingsSource).not.toContain('localStorage.setItem')
  })

  it('registers studio as a runtime theme while keeping system separate', () => {
    const providerSource = readFileSync(
      join(process.cwd(), 'components/theme-provider.tsx'),
      'utf8',
    )

    expect(providerSource).toContain('attribute="class"')
    expect(providerSource).toContain('defaultTheme="dark"')
    expect(providerSource).toContain('storageKey={THEME_STORAGE_KEY}')
    expect(providerSource).toContain('enableSystem')
    expect(providerSource).toContain("themes={['light', 'dark', 'studio']}")
    expect(providerSource).toContain('STUDIO_INTENSITY_STORAGE_KEY')
    expect(providerSource).toContain('document.documentElement.dataset.studioIntensity')
    expect(providerSource).not.toContain('themes={[\'light\', \'dark\', \'studio-soft\'')
  })
})
