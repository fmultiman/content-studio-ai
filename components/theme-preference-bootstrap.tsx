'use client'

import { useEffect, useRef, useState } from 'react'
import { useTheme } from 'next-themes'
import type { Session } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/client'
import { executeThemeBootstrap } from '@/lib/theme-bootstrap'
import { THEME_STORAGE_KEY } from '@/lib/theme'

export function ThemePreferenceBootstrap() {
  const { setTheme } = useTheme()
  const [authResolved, setAuthResolved] = useState(false)
  const [userId, setUserId] = useState<null | string>(null)
  const attemptedUserIdsRef = useRef(new Set<string>())

  useEffect(() => {
    const supabase = createClient()
    let active = true

    const syncSessionState = (session: Session | null) => {
      if (!active) {
        return
      }

      setUserId(session?.user?.id ?? null)
      setAuthResolved(true)
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      syncSessionState(session)
    })

    const resolveCurrentSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      syncSessionState(session)
    }

    void resolveCurrentSession()

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    const localTheme = window.localStorage.getItem(THEME_STORAGE_KEY)
    let cancelled = false

    const bootstrapThemePreference = async () => {
      await executeThemeBootstrap({
        authResolved,
        userId,
        localTheme,
        attemptedUserIds: attemptedUserIdsRef.current,
        fetchRemoteTheme: async (authenticatedUserId) => {
          const supabase = createClient()
          const { data: settingsData, error } = await supabase
            .from('user_settings')
            .select('theme')
            .eq('user_id', authenticatedUserId)
            .single()

          if (error) {
            throw error
          }

          return settingsData?.theme
        },
        applyTheme: (bootstrapTheme) => {
          if (!cancelled) {
            setTheme(bootstrapTheme)
          }
        },
        onError: (error, authenticatedUserId) => {
          console.error('ThemePreferenceBootstrap failed to load remote theme', {
            error,
            userId: authenticatedUserId,
          })
        },
      })
    }

    void bootstrapThemePreference()

    return () => {
      cancelled = true
    }
  }, [authResolved, setTheme, userId])

  return null
}
