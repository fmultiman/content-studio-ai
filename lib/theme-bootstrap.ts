import {
  isStudioIntensity,
  isUserSelectableTheme,
  resolveBootstrapStudioIntensityPreference,
  resolveBootstrapThemePreference,
  type StudioIntensity,
  type UserSelectableTheme,
} from './theme'

export type ThemeBootstrapStatus =
  | 'waiting-for-auth'
  | 'waiting-for-user'
  | 'already-attempted'
  | 'skipped-local-preferences'
  | 'applied-remote-theme'
  | 'applied-remote-studio-intensity'
  | 'applied-remote-theme-and-studio-intensity'
  | 'applied-default-studio-intensity'
  | 'applied-remote-theme-and-default-studio-intensity'
  | 'no-valid-remote-theme'
  | 'query-failed'

type ExecuteThemeBootstrapOptions = {
  authResolved: boolean
  userId: null | string
  localTheme: unknown
  localStudioIntensity: unknown
  attemptedUserIds: Set<string>
  fetchRemotePreferences: (userId: string) => Promise<{
    studioIntensity: unknown
    theme: unknown
  }>
  applyTheme: (theme: UserSelectableTheme) => void
  applyStudioIntensity: (studioIntensity: StudioIntensity) => void
  onError: (error: unknown, userId: string) => void
}

export async function executeThemeBootstrap({
  authResolved,
  userId,
  localTheme,
  localStudioIntensity,
  attemptedUserIds,
  fetchRemotePreferences,
  applyTheme,
  applyStudioIntensity,
  onError,
}: ExecuteThemeBootstrapOptions): Promise<ThemeBootstrapStatus> {
  if (!authResolved) {
    return 'waiting-for-auth'
  }

  if (!userId) {
    return 'waiting-for-user'
  }

  if (attemptedUserIds.has(userId)) {
    return 'already-attempted'
  }

  const hasValidLocalTheme = isUserSelectableTheme(localTheme)
  const hasValidLocalStudioIntensity = isStudioIntensity(localStudioIntensity)

  if (hasValidLocalTheme && hasValidLocalStudioIntensity) {
    attemptedUserIds.add(userId)
    return 'skipped-local-preferences'
  }

  attemptedUserIds.add(userId)

  try {
    const remotePreferences = await fetchRemotePreferences(userId)
    const bootstrapTheme = resolveBootstrapThemePreference(
      localTheme,
      remotePreferences.theme,
    )
    const bootstrapStudioIntensity = resolveBootstrapStudioIntensityPreference(
      localStudioIntensity,
      remotePreferences.studioIntensity,
    )

    if (bootstrapStudioIntensity) {
      applyStudioIntensity(bootstrapStudioIntensity)
    }
    if (bootstrapTheme) {
      applyTheme(bootstrapTheme)

      if (bootstrapStudioIntensity) {
        return remotePreferences.studioIntensity === bootstrapStudioIntensity
          ? 'applied-remote-theme-and-studio-intensity'
          : 'applied-remote-theme-and-default-studio-intensity'
      }

      return 'applied-remote-theme'
    }

    if (bootstrapStudioIntensity) {
      return remotePreferences.studioIntensity === bootstrapStudioIntensity
        ? 'applied-remote-studio-intensity'
        : 'applied-default-studio-intensity'
    }

    return 'no-valid-remote-theme'
  } catch (error) {
    onError(error, userId)
    return 'query-failed'
  }
}
