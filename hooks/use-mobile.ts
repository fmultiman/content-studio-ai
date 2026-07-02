import * as React from 'react'

import { STUDIO_SHELL_MOBILE_BREAKPOINT } from '@/lib/studio-shell-state'

function subscribeToMobileBreakpoint(onStoreChange: () => void) {
  const mediaQuery = window.matchMedia(
    `(max-width: ${STUDIO_SHELL_MOBILE_BREAKPOINT}px)`,
  )

  mediaQuery.addEventListener('change', onStoreChange)

  return () => {
    mediaQuery.removeEventListener('change', onStoreChange)
  }
}

function getMobileBreakpointSnapshot() {
  return window.innerWidth <= STUDIO_SHELL_MOBILE_BREAKPOINT
}

function getMobileBreakpointServerSnapshot() {
  return false
}

export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribeToMobileBreakpoint,
    getMobileBreakpointSnapshot,
    getMobileBreakpointServerSnapshot,
  )
}
