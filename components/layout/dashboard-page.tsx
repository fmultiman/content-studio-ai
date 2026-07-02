'use client'

import type { CSSProperties, ReactNode } from 'react'

import { STUDIO_SHELL_PAGE_PADDING } from '@/lib/studio-shell-state'
import { cn } from '@/lib/utils'

const pagePaddingStyle = {
  '--studio-shell-page-padding': STUDIO_SHELL_PAGE_PADDING,
} as CSSProperties

const widthClasses = {
  '3xl': 'max-w-3xl',
  '4xl': 'max-w-4xl',
  '5xl': 'max-w-5xl',
  '7xl': 'max-w-7xl',
  full: 'max-w-none',
} as const

type DashboardPageProps = {
  children: ReactNode
  className?: string
}

type DashboardPageContentProps = DashboardPageProps & {
  width?: keyof typeof widthClasses
}

export function DashboardPage({ children, className }: DashboardPageProps) {
  return (
    <div
      data-slot="dashboard-page"
      className={cn('flex min-h-full flex-col', className)}
    >
      {children}
    </div>
  )
}

export function DashboardPageBar({ children, className }: DashboardPageProps) {
  return (
    <div
      data-slot="dashboard-page-bar"
      className={cn(
        'border-b border-border/50 bg-card/30 px-[var(--studio-shell-page-padding)] py-2',
        className,
      )}
      style={pagePaddingStyle}
    >
      {children}
    </div>
  )
}

export function DashboardPageContent({
  children,
  className,
  width = '7xl',
}: DashboardPageContentProps) {
  return (
    <div
      data-slot="dashboard-page-content"
      className="px-[var(--studio-shell-page-padding)] py-[var(--studio-shell-page-padding)]"
      style={pagePaddingStyle}
    >
      <div className={cn('mx-auto w-full', widthClasses[width], className)}>
        {children}
      </div>
    </div>
  )
}
