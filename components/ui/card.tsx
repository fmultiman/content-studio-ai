import * as React from 'react'

import { cn } from '@/lib/utils'

function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn(
        'shadow-elevation-low relative flex flex-col gap-6 overflow-hidden rounded-xl border border-[var(--card-border)] bg-[var(--card-background)] py-6 text-card-foreground transition-[background-color,border-color,box-shadow]',
        className,
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        '@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-2 px-6 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6',
        className,
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-title"
      className={cn('leading-none font-semibold text-[var(--card-title)]', className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-description"
      className={cn('text-sm text-[var(--card-description)]', className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        'col-start-2 row-span-2 row-start-1 self-start justify-self-end',
        className,
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-content"
      className={cn('px-6', className)}
      {...props}
    />
  )
}

function CardEyebrow({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-eyebrow"
      className={cn(
        'text-xs font-medium tracking-[0.08em] text-[var(--card-metadata-label)] uppercase',
        className,
      )}
      {...props}
    />
  )
}

function CardMedia({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-media"
      className={cn(
        'relative overflow-hidden bg-[var(--card-media-background)]',
        className,
      )}
      {...props}
    />
  )
}

function CardActions({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-actions"
      className={cn('flex flex-wrap items-center gap-2', className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-footer"
      className={cn('flex items-center px-6 [.border-t]:pt-6', className)}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
  CardEyebrow,
  CardMedia,
  CardActions,
}
