import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow] [&>svg]:size-3 [&>svg]:pointer-events-none focus-visible:border-[var(--border-focus)] focus-visible:ring-[3px] focus-visible:ring-[color:var(--control-focus)] aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-[color:color-mix(in_oklch,var(--indicator-brand)_18%,transparent)] text-[var(--text-primary)] [a&]:hover:bg-[color:color-mix(in_oklch,var(--indicator-brand)_24%,transparent)]',
        secondary:
          'border-[var(--border-subtle)] bg-[var(--surface-subtle)] text-[var(--text-secondary)] [a&]:hover:bg-[var(--control-background-hover)]',
        destructive:
          'border-[color:color-mix(in_oklch,var(--indicator-danger)_48%,var(--border-default))] bg-[color:color-mix(in_oklch,var(--indicator-danger)_14%,transparent)] text-[var(--text-primary)] [a&]:hover:bg-[color:color-mix(in_oklch,var(--indicator-danger)_20%,transparent)]',
        success:
          'border-[color:color-mix(in_oklch,var(--indicator-success)_48%,var(--border-default))] bg-[color:color-mix(in_oklch,var(--indicator-success)_16%,transparent)] text-[var(--text-primary)]',
        warning:
          'border-[color:color-mix(in_oklch,var(--indicator-warning)_48%,var(--border-default))] bg-[color:color-mix(in_oklch,var(--indicator-warning)_18%,transparent)] text-[var(--text-primary)]',
        info:
          'border-[color:color-mix(in_oklch,var(--indicator-info)_48%,var(--border-default))] bg-[color:color-mix(in_oklch,var(--indicator-info)_16%,transparent)] text-[var(--text-primary)]',
        neutral:
          'border-[var(--border-default)] bg-[color:color-mix(in_oklch,var(--indicator-neutral)_10%,transparent)] text-[var(--text-secondary)]',
        outline:
          'border-[var(--border-default)] bg-transparent text-[var(--text-secondary)] [a&]:hover:bg-[var(--control-background-hover)] [a&]:hover:text-[var(--text-primary)]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<'span'> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'span'

  return (
    <Comp
      data-slot="badge"
      data-variant={variant ?? 'default'}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
