import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

type StatusTone = 'neutral' | 'positive' | 'warning' | 'danger'

type StatusBadgeProps = {
  label: string
  tone?: StatusTone
  className?: string
}

const STATUS_TONE_CLASSNAME: Record<StatusTone, string> = {
  neutral: '',
  positive: '',
  warning: 'border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/10',
  danger: 'border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/10',
}

export function StatusBadge({
  label,
  tone = 'neutral',
  className,
}: StatusBadgeProps) {
  const variant = tone === 'positive' ? 'default' : 'outline'

  return (
    <Badge
      variant={variant}
      className={cn('whitespace-nowrap', STATUS_TONE_CLASSNAME[tone], className)}
    >
      {label}
    </Badge>
  )
}
