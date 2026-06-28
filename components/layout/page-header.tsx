import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

type PageHeaderProps = {
  title: string
  description?: ReactNode
  context?: ReactNode
  metadata?: ReactNode
  actions?: ReactNode
  className?: string
}

export function PageHeader({
  title,
  description,
  context,
  metadata,
  actions,
  className,
}: PageHeaderProps) {
  const hasSupportContent = description || metadata

  return (
    <section className={cn('space-y-4', className)}>
      {context ? (
        <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {context}
        </div>
      ) : null}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2">
          <h1 className="text-2xl font-semibold tracking-normal text-foreground sm:text-3xl">
            {title}
          </h1>
          {hasSupportContent ? (
            <div className="space-y-2">
              {description ? (
                <p className="max-w-3xl text-sm text-muted-foreground sm:text-base">
                  {description}
                </p>
              ) : null}
              {metadata ? <div className="flex flex-wrap gap-2">{metadata}</div> : null}
            </div>
          ) : null}
        </div>

        {actions ? (
          <div className="flex w-full flex-wrap gap-2 lg:w-auto lg:justify-end">
            {actions}
          </div>
        ) : null}
      </div>
    </section>
  )
}
