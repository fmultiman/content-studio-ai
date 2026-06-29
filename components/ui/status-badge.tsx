import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

type StatusTone =
  | 'neutral'
  | 'positive'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'draft'
  | 'approved'
  | 'generated'
  | 'unavailable'

type StatusBadgeProps = {
  label: string
  tone?: StatusTone
  className?: string
}

const STATUS_TONE_CLASSNAME: Record<StatusTone, string> = {
  neutral:
    'border-[var(--border-default)] bg-[color:color-mix(in_oklch,var(--indicator-neutral)_10%,transparent)] text-[var(--text-secondary)]',
  positive:
    'border-[color:color-mix(in_oklch,var(--indicator-info)_34%,var(--border-default))] bg-[color:color-mix(in_oklch,var(--indicator-info)_12%,transparent)] text-[var(--text-primary)]',
  success:
    'border-[color:color-mix(in_oklch,var(--indicator-success)_48%,var(--border-default))] bg-[color:color-mix(in_oklch,var(--indicator-success)_16%,transparent)] text-[var(--text-primary)]',
  warning:
    'border-[color:color-mix(in_oklch,var(--indicator-warning)_48%,var(--border-default))] bg-[color:color-mix(in_oklch,var(--indicator-warning)_18%,transparent)] text-[var(--text-primary)]',
  danger:
    'border-[color:color-mix(in_oklch,var(--indicator-danger)_48%,var(--border-default))] bg-[color:color-mix(in_oklch,var(--indicator-danger)_14%,transparent)] text-[var(--text-primary)]',
  info:
    'border-[color:color-mix(in_oklch,var(--indicator-info)_48%,var(--border-default))] bg-[color:color-mix(in_oklch,var(--indicator-info)_16%,transparent)] text-[var(--text-primary)]',
  draft: 'border-[var(--border-default)] bg-[var(--surface-subtle)] text-[var(--text-secondary)]',
  approved:
    'border-[color:color-mix(in_oklch,var(--indicator-info)_34%,var(--border-default))] bg-[color:color-mix(in_oklch,var(--indicator-info)_12%,transparent)] text-[var(--text-primary)]',
  generated:
    'border-[var(--border-default)] bg-[color:color-mix(in_oklch,var(--indicator-neutral)_10%,transparent)] text-[var(--text-secondary)]',
  unavailable:
    'border-[var(--control-disabled-border)] bg-[var(--control-disabled-background)] text-[var(--text-disabled)]',
}

export function StatusBadge({
  label,
  tone = 'neutral',
  className,
}: StatusBadgeProps) {
  return (
    <Badge
      data-slot="status-badge"
      variant="outline"
      className={cn('whitespace-nowrap border font-medium', STATUS_TONE_CLASSNAME[tone], className)}
    >
      {label}
    </Badge>
  )
}
