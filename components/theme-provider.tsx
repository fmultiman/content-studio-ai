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

function StudioIntensityProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [studioIntensity, setStudioIntensityState] = React.useState<StudioIntensity>(() => {
    if (typeof window === 'undefined') {
      return DEFAULT_STUDIO_INTENSITY
    }

    return normalizeStudioIntensity(
      window.localStorage.getItem(STUDIO_INTENSITY_STORAGE_KEY),
    )
  })
  React.useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    document.documentElement.dataset.studioIntensity = studioIntensity
    window.localStorage.setItem(STUDIO_INTENSITY_STORAGE_KEY, studioIntensity)
  }, [studioIntensity])

  const setStudioIntensity = (nextStudioIntensity: StudioIntensity) => {
    setStudioIntensityState(normalizeStudioIntensity(nextStudioIntensity))
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
