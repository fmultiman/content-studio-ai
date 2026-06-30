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
  dense?: boolean
}

export function ContextMetadata({
  items,
  className,
  itemClassName,
  dense = false,
}: ContextMetadataProps) {
  const visibleItems = items.filter((item) => item.value !== null && item.value !== undefined && item.value !== '')

  if (visibleItems.length === 0) {
    return null
  }

  return (
    <dl
      data-slot="context-metadata"
      className={cn(
        dense ? 'grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2' : 'grid gap-3 text-sm sm:grid-cols-2',
        className,
      )}
    >
      {visibleItems.map((item) => (
        <div
          key={item.label}
          data-slot="context-metadata-item"
          className={cn(item.fullWidth && 'sm:col-span-2', itemClassName)}
        >
          <dt
            data-slot="context-metadata-label"
            className={cn(
              'text-[var(--card-metadata-label)]',
              dense ? 'text-[11px]' : 'text-xs',
            )}
          >
            {item.label}
          </dt>
          <dd
            data-slot="context-metadata-value"
            className={cn(
              'mt-0.5 break-words text-[var(--card-metadata-value)]',
              dense ? 'text-xs' : 'text-sm',
              item.valueClassName,
            )}
            title={item.title}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
