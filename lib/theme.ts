export const USER_SELECTABLE_THEMES = ['light', 'dark', 'system'] as const

export type UserSelectableTheme = (typeof USER_SELECTABLE_THEMES)[number]

export const DEFAULT_THEME: UserSelectableTheme = 'dark'
export const THEME_STORAGE_KEY = 'theme'

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

export function resolveBootstrapThemePreference(
  localTheme: unknown,
  remoteTheme: unknown,
): UserSelectableTheme | null {
  if (isUserSelectableTheme(localTheme)) {
    return null
  }

  return isUserSelectableTheme(remoteTheme) ? remoteTheme : null
}
