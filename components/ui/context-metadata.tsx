import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export type ContextMetadataItem = {
  label: string
  value: ReactNode
  title?: string
  fullWidth?: boolean
  valueClassName?: string
}

type ContextMetadataProps = {
  items: ContextMetadataItem[]
  className?: string
  itemClassName?: string
}

export function ContextMetadata({
  items,
  className,
  itemClassName,
}: ContextMetadataProps) {
  const visibleItems = items.filter((item) => item.value !== null && item.value !== undefined && item.value !== '')

  if (visibleItems.length === 0) {
    return null
  }

  return (
    <dl className={cn('grid gap-2 text-sm sm:grid-cols-2', className)}>
      {visibleItems.map((item) => (
        <div
          key={item.label}
          className={cn(item.fullWidth && 'sm:col-span-2', itemClassName)}
        >
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd
            className={cn('mt-0.5 break-words text-foreground', item.valueClassName)}
            title={item.title}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
