'use client'

import Link, { type LinkProps } from 'next/link'
import { useRouter } from 'next/navigation'
import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from 'react'
import type { SaveState } from '@/lib/generation-session/autosave'

type Registration = {
  sessionKey: string
  getState: () => SaveState
  flush: () => Promise<boolean>
  discardLocal?: () => void
}

type NavigationContextValue = {
  register(registration: Registration): () => void
  runBeforeNavigate(target: string, navigate: () => void | Promise<void>): Promise<boolean>
}

const NavigationContext = createContext<NavigationContextValue | null>(null)

export function GenerationSessionNavigationProvider({ children }: { children: ReactNode }) {
  const activeRef = useRef<Registration | null>(null)
  const navigationInFlightRef = useRef(false)

  const register = useCallback((registration: Registration) => {
    activeRef.current = registration
    return () => {
      if (activeRef.current?.sessionKey === registration.sessionKey) activeRef.current = null
    }
  }, [])

  const runBeforeNavigate = useCallback(async (target: string, navigate: () => void | Promise<void>) => {
    const active = activeRef.current
    if (!active || active.getState() === 'clean') {
      await navigate()
      return true
    }
    if (navigationInFlightRef.current) return false
    navigationInFlightRef.current = true
    try {
      const saved = await active.flush()
      if (!saved) return false
      await navigate()
      return true
    } finally {
      navigationInFlightRef.current = false
    }
  }, [])

  const value = useMemo(() => ({ register, runBeforeNavigate }), [register, runBeforeNavigate])
  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>
}

export function useGenerationSessionNavigation() {
  const context = useContext(NavigationContext)
  if (!context) throw new Error('GenerationSessionNavigationProvider is missing')
  return context
}

type GuardedLinkProps = LinkProps & {
  children: ReactNode
  className?: string
  target?: string
  rel?: string
  'aria-label'?: string
}

export function GuardedLink({ href, onNavigate, children, ...props }: GuardedLinkProps) {
  const { runBeforeNavigate } = useGenerationSessionNavigation()
  const router = useRouter()
  return (
    <Link
      {...props}
      href={href}
      onNavigate={(event) => {
        onNavigate?.(event)
        event.preventDefault()
        void runBeforeNavigate(String(href), () => router.push(String(href)))
      }}
    >
      {children}
    </Link>
  )
}
