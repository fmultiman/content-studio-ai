'use client'

import { useEffect, useState } from 'react'
import { Grid2X2, List } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  readViewModePreference,
  writeViewModePreference,
  type ViewMode,
} from '@/lib/view-mode-preference'

type ViewModeToggleProps = {
  value: ViewMode
  onValueChange: (mode: ViewMode) => void
  label?: string
}

export function useViewModePreference(
  key: string,
  defaultMode: ViewMode = 'list',
): [ViewMode, (mode: ViewMode) => void] {
  const [mode, setModeState] = useState<ViewMode>(defaultMode)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const timeoutId = window.setTimeout(() => {
      setModeState(readViewModePreference(window.localStorage, key, defaultMode))
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [defaultMode, key])

  const setMode = (nextMode: ViewMode) => {
    setModeState(nextMode)
    writeViewModePreference(typeof window === 'undefined' ? null : window.localStorage, key, nextMode)
  }

  return [mode, setMode]
}

export function ViewModeToggle({
  value,
  onValueChange,
  label = 'Modo de visualizacao',
}: ViewModeToggleProps) {
  return (
    <div className="flex items-center gap-2" aria-label={label}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="inline-flex rounded-md border border-border/50 bg-background/40 p-1">
        <Button
          type="button"
          variant={value === 'list' ? 'secondary' : 'ghost'}
          size="sm"
          className="h-8 gap-1.5 px-2.5"
          aria-pressed={value === 'list'}
          onClick={() => onValueChange('list')}
        >
          <List className="h-4 w-4" aria-hidden="true" />
          Lista
        </Button>
        <Button
          type="button"
          variant={value === 'card' ? 'secondary' : 'ghost'}
          size="sm"
          className="h-8 gap-1.5 px-2.5"
          aria-pressed={value === 'card'}
          onClick={() => onValueChange('card')}
        >
          <Grid2X2 className="h-4 w-4" aria-hidden="true" />
          Cards
        </Button>
      </div>
    </div>
  )
}
