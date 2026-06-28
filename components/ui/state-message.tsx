import type { ReactNode } from 'react'

import { AlertCircle, FileSearch, Info, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type StateMessageTone = 'loading' | 'empty' | 'error' | 'info' | 'success'

interface StateMessageProps {
  title: string
  description?: string
  tone?: StateMessageTone
  actionLabel?: string
  onAction?: () => void
  className?: string
  compact?: boolean
  icon?: ReactNode
}

const toneStyles: Record<StateMessageTone, string> = {
  loading: 'border-border/50 bg-card/30 text-muted-foreground',
  empty: 'border-dashed border-border/50 bg-card/30 text-muted-foreground',
  error: 'border-destructive/30 bg-destructive/10 text-destructive',
  info: 'border-cyan-500/20 bg-cyan-500/5 text-cyan-100',
  success: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-100',
}

function defaultIcon(tone: StateMessageTone) {
  switch (tone) {
    case 'loading':
      return <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
    case 'empty':
      return <FileSearch className="h-5 w-5" aria-hidden="true" />
    case 'error':
      return <AlertCircle className="h-5 w-5" aria-hidden="true" />
    default:
      return <Info className="h-5 w-5" aria-hidden="true" />
  }
}

export function StateMessage({
  title,
  description,
  tone = 'info',
  actionLabel,
  onAction,
  className,
  compact = false,
  icon,
}: StateMessageProps) {
  const liveRole = tone === 'error' ? 'alert' : tone === 'loading' ? 'status' : undefined
  const livePoliteness = tone === 'loading' ? 'polite' : undefined

  return (
    <div
      role={liveRole}
      aria-live={livePoliteness}
      className={cn(
        'rounded-xl border p-4',
        compact ? 'space-y-2' : 'space-y-3',
        toneStyles[tone],
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">{icon || defaultIcon(tone)}</div>
        <div className="min-w-0 space-y-1">
          <p className="font-medium text-foreground">{title}</p>
          {description ? (
            <p className={cn('text-sm', tone === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {actionLabel && onAction ? (
        <Button type="button" variant={tone === 'error' ? 'outline' : 'outline'} size="sm" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  )
}
