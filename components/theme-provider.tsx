'use client'

import * as React from 'react'
import {
  ThemeProvider as NextThemesProvider,
  type ThemeProviderProps,
} from 'next-themes'
import {
  DEFAULT_STUDIO_INTENSITY,
  normalizeStudioIntensity,
  STUDIO_INTENSITY_STORAGE_KEY,
  type StudioIntensity,
  THEME_STORAGE_KEY,
} from '@/lib/theme'

type StudioIntensityContextValue = {
  setStudioIntensity: (studioIntensity: StudioIntensity) => void
  studioIntensity: StudioIntensity
}

const StudioIntensityContext = React.createContext<StudioIntensityContextValue | null>(null)

const STUDIO_INTENSITY_SERVER_SNAPSHOT = DEFAULT_STUDIO_INTENSITY
const STUDIO_INTENSITY_CHANGE_EVENT = 'studio-intensity-change'

function readStudioIntensitySnapshot() {
  if (typeof window === 'undefined') {
    return STUDIO_INTENSITY_SERVER_SNAPSHOT
  }

  return normalizeStudioIntensity(
    window.localStorage.getItem(STUDIO_INTENSITY_STORAGE_KEY),
  )
}

function subscribeToStudioIntensity(onStoreChange: () => void) {
  if (typeof window === 'undefined') {
    return () => undefined
  }

  const handleStorage = (event: StorageEvent) => {
    if (
      event.key !== null &&
      event.key !== STUDIO_INTENSITY_STORAGE_KEY
    ) {
      return
    }

    onStoreChange()
  }

  window.addEventListener('storage', handleStorage)
  window.addEventListener(STUDIO_INTENSITY_CHANGE_EVENT, onStoreChange)

  return () => {
    window.removeEventListener('storage', handleStorage)
    window.removeEventListener(STUDIO_INTENSITY_CHANGE_EVENT, onStoreChange)
  }
}

function StudioIntensityProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const studioIntensity = React.useSyncExternalStore(
    subscribeToStudioIntensity,
    readStudioIntensitySnapshot,
    () => STUDIO_INTENSITY_SERVER_SNAPSHOT,
  )

  React.useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    document.documentElement.dataset.studioIntensity = studioIntensity
    window.localStorage.setItem(STUDIO_INTENSITY_STORAGE_KEY, studioIntensity)
  }, [studioIntensity])

  const setStudioIntensity = (nextStudioIntensity: StudioIntensity) => {
    const normalizedStudioIntensity = normalizeStudioIntensity(nextStudioIntensity)

    document.documentElement.dataset.studioIntensity = normalizedStudioIntensity
    window.localStorage.setItem(STUDIO_INTENSITY_STORAGE_KEY, normalizedStudioIntensity)
    window.dispatchEvent(new Event(STUDIO_INTENSITY_CHANGE_EVENT))
  }

  return (
    <StudioIntensityContext.Provider
      value={{
        setStudioIntensity,
        studioIntensity,
      }}
    >
      {children}
    </StudioIntensityContext.Provider>
  )
}

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      storageKey={THEME_STORAGE_KEY}
      enableSystem
      disableTransitionOnChange
      themes={['light', 'dark', 'studio']}
      {...props}
    >
      <StudioIntensityProvider>{children}</StudioIntensityProvider>
    </NextThemesProvider>
  )
}

export function useStudioIntensity() {
  const context = React.useContext(StudioIntensityContext)

  if (!context) {
    throw new Error('useStudioIntensity must be used within ThemeProvider')
  }

  return context
}
