export type ViewMode = 'list' | 'card'

export type ViewModeStorage = Pick<Storage, 'getItem' | 'setItem'>

export function isViewMode(value: unknown): value is ViewMode {
  return value === 'list' || value === 'card'
}

export function resolveViewMode(value: unknown, fallback: ViewMode = 'list'): ViewMode {
  return isViewMode(value) ? value : fallback
}

export function readViewModePreference(
  storage: ViewModeStorage | null | undefined,
  key: string,
  fallback: ViewMode = 'list',
): ViewMode {
  if (!storage) return fallback

  try {
    return resolveViewMode(storage.getItem(key), fallback)
  } catch {
    return fallback
  }
}

export function writeViewModePreference(
  storage: ViewModeStorage | null | undefined,
  key: string,
  mode: ViewMode,
) {
  if (!storage) return

  try {
    storage.setItem(key, mode)
  } catch {
    // Preference persistence is optional; the active UI state should keep working.
  }
}
