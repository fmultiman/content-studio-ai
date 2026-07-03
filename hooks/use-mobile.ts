import * as React from 'react'

import {
  STUDIO_SHELL_MOBILE_BREAKPOINT,
  STUDIO_SHELL_WIDE_BREAKPOINT,
} from '@/lib/studio-shell-state'

export type StudioShellViewportSnapshot = {
  height: number
  isMobile: boolean
  isWide: boolean
  width: number
}

export const STUDIO_SHELL_VIEWPORT_SERVER_SNAPSHOT: StudioShellViewportSnapshot = {
  height: 0,
  isMobile: false,
  isWide: true,
  width: STUDIO_SHELL_WIDE_BREAKPOINT,
}

let viewportSnapshotCache: StudioShellViewportSnapshot =
  STUDIO_SHELL_VIEWPORT_SERVER_SNAPSHOT

export function isStudioShellViewportSnapshotEqual(
  left: StudioShellViewportSnapshot,
  right: StudioShellViewportSnapshot,
) {
  return (
    left.width === right.width &&
    left.height === right.height &&
    left.isMobile === right.isMobile &&
    left.isWide === right.isWide
  )
}

export function createStudioShellViewportSnapshot({
  height,
  width,
}: Pick<StudioShellViewportSnapshot, 'height' | 'width'>): StudioShellViewportSnapshot {
  return {
    width,
    height,
    isMobile: width <= STUDIO_SHELL_MOBILE_BREAKPOINT,
    isWide: width >= STUDIO_SHELL_WIDE_BREAKPOINT,
  }
}

function readViewportSnapshot() {
  return createStudioShellViewportSnapshot({
    width: window.innerWidth,
    height: window.innerHeight,
  })
}

function getViewportSnapshot() {
  if (typeof window === 'undefined') {
    return STUDIO_SHELL_VIEWPORT_SERVER_SNAPSHOT
  }

  const nextSnapshot = readViewportSnapshot()

  if (!isStudioShellViewportSnapshotEqual(viewportSnapshotCache, nextSnapshot)) {
    viewportSnapshotCache = nextSnapshot
  }

  return viewportSnapshotCache
}

function subscribeToViewport(onStoreChange: () => void) {
  const mobileMediaQuery = window.matchMedia(
    `(max-width: ${STUDIO_SHELL_MOBILE_BREAKPOINT}px)`,
  )
  const wideMediaQuery = window.matchMedia(
    `(min-width: ${STUDIO_SHELL_WIDE_BREAKPOINT}px)`,
  )

  const notifyViewportChange = () => {
    viewportSnapshotCache = readViewportSnapshot()
    onStoreChange()
  }

  window.addEventListener('resize', notifyViewportChange)
  mobileMediaQuery.addEventListener('change', notifyViewportChange)
  wideMediaQuery.addEventListener('change', notifyViewportChange)

  // Ensure hydration leaves the SSR snapshot immediately, even before resize.
  notifyViewportChange()

  return () => {
    window.removeEventListener('resize', notifyViewportChange)
    mobileMediaQuery.removeEventListener('change', notifyViewportChange)
    wideMediaQuery.removeEventListener('change', notifyViewportChange)
  }
}

function getViewportServerSnapshot() {
  return STUDIO_SHELL_VIEWPORT_SERVER_SNAPSHOT
}

export function useStudioShellViewport() {
  return React.useSyncExternalStore(
    subscribeToViewport,
    getViewportSnapshot,
    getViewportServerSnapshot,
  )
}

export function useIsMobile() {
  return useStudioShellViewport().isMobile
}
