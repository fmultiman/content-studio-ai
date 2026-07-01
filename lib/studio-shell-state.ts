export const STUDIO_SHELL_STORAGE_KEY = 'studio-shell-desktop-preference'
export const STUDIO_SHELL_LAST_VISIBLE_STORAGE_KEY =
  'studio-shell-last-visible-mode'
export const STUDIO_SHELL_MOBILE_BREAKPOINT = 768
export const STUDIO_SHELL_WIDE_BREAKPOINT = 1280
export const STUDIO_SHELL_EXPANDED_WIDTH = '9.5rem'
export const STUDIO_SHELL_COMPACT_WIDTH = '3.25rem'
export const STUDIO_SHELL_TOP_BAR_HEIGHT = '3.125rem'
export const STUDIO_SHELL_TRANSITION_MS = 200

export type StudioShellDesktopPreference = 'expanded' | 'compact' | 'hidden'
export type StudioShellVisibleMode = Exclude<StudioShellDesktopPreference, 'hidden'>
export type StudioShellEffectiveMode =
  | StudioShellDesktopPreference
  | 'mobile-drawer'

export function isStudioShellDesktopPreference(
  value: string | null | undefined,
): value is StudioShellDesktopPreference {
  return value === 'expanded' || value === 'compact' || value === 'hidden'
}

export function sanitizeStudioShellDesktopPreference(
  value: string | null | undefined,
) {
  return isStudioShellDesktopPreference(value) ? value : null
}

export function isStudioShellVisibleMode(
  value: string | null | undefined,
): value is StudioShellVisibleMode {
  return value === 'expanded' || value === 'compact'
}

export function getDefaultStudioShellDesktopPreference(viewportWidth: number) {
  if (viewportWidth >= STUDIO_SHELL_WIDE_BREAKPOINT) {
    return 'expanded' as const
  }

  if (viewportWidth > STUDIO_SHELL_MOBILE_BREAKPOINT) {
    return 'compact' as const
  }

  return 'compact' as const
}

export function getStudioShellEffectiveMode(
  desktopPreference: StudioShellDesktopPreference,
  viewportWidth: number,
): StudioShellEffectiveMode {
  if (viewportWidth <= STUDIO_SHELL_MOBILE_BREAKPOINT) {
    return 'mobile-drawer'
  }

  if (
    viewportWidth < STUDIO_SHELL_WIDE_BREAKPOINT &&
    desktopPreference === 'expanded'
  ) {
    return 'compact'
  }

  return desktopPreference
}

export function getLastVisibleStudioShellMode(
  desktopPreference: StudioShellDesktopPreference,
  previousVisibleMode: StudioShellVisibleMode,
): StudioShellVisibleMode {
  if (desktopPreference === 'hidden') {
    return previousVisibleMode
  }

  return desktopPreference
}
