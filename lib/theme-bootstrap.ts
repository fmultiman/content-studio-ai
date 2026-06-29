import {
  isUserSelectableTheme,
  resolveBootstrapThemePreference,
  type UserSelectableTheme,
} from './theme'

export type ThemeBootstrapStatus =
  | 'waiting-for-auth'
  | 'waiting-for-user'
  | 'already-attempted'
  | 'skipped-local-theme'
  | 'applied-remote-theme'
  | 'no-valid-remote-theme'
  | 'query-failed'

type ExecuteThemeBootstrapOptions = {
  authResolved: boolean
  userId: null | string
  localTheme: unknown
  attemptedUserIds: Set<string>
  fetchRemoteTheme: (userId: string) => Promise<unknown>
  applyTheme: (theme: UserSelectableTheme) => void
  onError: (error: unknown, userId: string) => void
}

export async function executeThemeBootstrap({
  authResolved,
  userId,
  localTheme,
  attemptedUserIds,
  fetchRemoteTheme,
  applyTheme,
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

  if (isUserSelectableTheme(localTheme)) {
    attemptedUserIds.add(userId)
    return 'skipped-local-theme'
  }

  attemptedUserIds.add(userId)

  try {
    const remoteTheme = await fetchRemoteTheme(userId)
    const bootstrapTheme = resolveBootstrapThemePreference(localTheme, remoteTheme)

    if (bootstrapTheme) {
      applyTheme(bootstrapTheme)
      return 'applied-remote-theme'
    }

    return 'no-valid-remote-theme'
  } catch (error) {
    onError(error, userId)
    return 'query-failed'
  }
}
