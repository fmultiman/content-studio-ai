export const STUDIO_SHELL_STORAGE_KEY = 'studio-shell-desktop-preference'
export const STUDIO_SHELL_LAST_VISIBLE_STORAGE_KEY =
  'studio-shell-last-visible-mode'
export const STUDIO_SHELL_MOBILE_BREAKPOINT = 768
export const STUDIO_SHELL_WIDE_BREAKPOINT = 1280
export const STUDIO_SHELL_EXPANDED_WIDTH = '9.5rem'
export const STUDIO_SHELL_COMPACT_WIDTH = '3.25rem'
export const STUDIO_SHELL_MOBILE_DRAWER_WIDTH = '11.75rem'
export const STUDIO_SHELL_MOBILE_DRAWER_VIEWPORT_WIDTH = '56vw'
export const STUDIO_SHELL_TOP_BAR_HEIGHT = '3.125rem'
export const STUDIO_SHELL_RAIL_TOP_OFFSET = '3.75rem'
export const STUDIO_SHELL_RAIL_MAX_HEIGHT = 'calc(100svh - 4.5rem)'
export const STUDIO_SHELL_RAIL_RADIUS = '1.25rem'
export const STUDIO_SHELL_PAGE_PADDING = '1.5rem'
export const STUDIO_SHELL_TRANSITION_MS = 200

export type StudioShellDesktopPreference = 'expanded' | 'compact' | 'hidden'
export type StudioShellVisibleMode = Exclude<StudioShellDesktopPreference, 'hidden'>
export type StudioShellEffectiveMode =
  | StudioShellDesktopPreference
  | 'mobile-drawer'

export type ResolvedStudioShellState = {
  desktopPreference: StudioShellDesktopPreference
  effectiveMode: StudioShellEffectiveMode
  hasExplicitPreference: boolean
  lastVisibleMode: StudioShellVisibleMode
}

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

export function canStudioShellExpandImmediately(viewportWidth: number) {
  return viewportWidth > STUDIO_SHELL_MOBILE_BREAKPOINT
}

export function getStudioShellRenderedDesktopMode({
  effectiveMode,
  lastVisibleMode,
  hiddenVisualMode,
}: {
  effectiveMode: StudioShellEffectiveMode
  lastVisibleMode: StudioShellVisibleMode
  hiddenVisualMode?: StudioShellVisibleMode | null
}) {
  if (effectiveMode === 'expanded') {
    return 'expanded' as const
  }

  if (effectiveMode === 'compact') {
    return 'compact' as const
  }

  if (effectiveMode === 'hidden') {
    return hiddenVisualMode ?? lastVisibleMode
  }

  return null
}

export function resolveStudioShellState({
  viewportWidth,
  storedPreference,
  storedLastVisibleMode,
  desktopPreferenceOverride,
  lastVisibleModeOverride,
}: {
  viewportWidth: number
  storedPreference: StudioShellDesktopPreference | null
  storedLastVisibleMode: StudioShellVisibleMode | null
  desktopPreferenceOverride?: StudioShellDesktopPreference | null
  lastVisibleModeOverride?: StudioShellVisibleMode | null
}): ResolvedStudioShellState {
  const defaultDesktopPreference =
    getDefaultStudioShellDesktopPreference(viewportWidth)
  const desktopPreference =
    desktopPreferenceOverride ?? storedPreference ?? defaultDesktopPreference
  const lastVisibleMode =
    lastVisibleModeOverride ??
    storedLastVisibleMode ??
    (desktopPreference === 'hidden' ? 'expanded' : desktopPreference)

  return {
    desktopPreference,
    effectiveMode: getStudioShellEffectiveMode(desktopPreference, viewportWidth),
    hasExplicitPreference:
      desktopPreferenceOverride !== null && desktopPreferenceOverride !== undefined
        ? true
        : storedPreference !== null,
    lastVisibleMode,
  }
}
