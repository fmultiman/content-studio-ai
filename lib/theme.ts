export const USER_SELECTABLE_THEMES = ['light', 'dark', 'system', 'studio'] as const
export const STUDIO_INTENSITIES = ['soft', 'balanced', 'expressive'] as const

export type UserSelectableTheme = (typeof USER_SELECTABLE_THEMES)[number]
export type StudioIntensity = (typeof STUDIO_INTENSITIES)[number]

export const DEFAULT_THEME: UserSelectableTheme = 'dark'
export const DEFAULT_STUDIO_INTENSITY: StudioIntensity = 'balanced'
export const THEME_STORAGE_KEY = 'theme'
export const STUDIO_INTENSITY_STORAGE_KEY = 'studio-intensity'

export function isUserSelectableTheme(value: unknown): value is UserSelectableTheme {
  return (
    typeof value === 'string' &&
    USER_SELECTABLE_THEMES.includes(value as UserSelectableTheme)
  )
}

export function normalizeUserSelectableTheme(
  value: unknown,
  fallback: UserSelectableTheme = DEFAULT_THEME,
): UserSelectableTheme {
  return isUserSelectableTheme(value) ? value : fallback
}

export function isStudioIntensity(value: unknown): value is StudioIntensity {
  return (
    typeof value === 'string' &&
    STUDIO_INTENSITIES.includes(value as StudioIntensity)
  )
}

export function normalizeStudioIntensity(
  value: unknown,
  fallback: StudioIntensity = DEFAULT_STUDIO_INTENSITY,
): StudioIntensity {
  return isStudioIntensity(value) ? value : fallback
}

export function resolveBootstrapThemePreference(
  localTheme: unknown,
  remoteTheme: unknown,
): UserSelectableTheme | null {
  if (isUserSelectableTheme(localTheme)) {
    return null
  }

  return isUserSelectableTheme(remoteTheme) ? remoteTheme : null
}

export function resolveBootstrapStudioIntensityPreference(
  localStudioIntensity: unknown,
  remoteStudioIntensity: unknown,
): StudioIntensity | null {
  if (isStudioIntensity(localStudioIntensity)) {
    return null
  }

  return normalizeStudioIntensity(remoteStudioIntensity)
}
