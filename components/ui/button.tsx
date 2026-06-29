import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border border-transparent text-sm font-medium shadow-elevation-low transition-[background-color,border-color,color,box-shadow,transform] disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-[var(--control-disabled-border)] disabled:bg-[var(--control-disabled-background)] disabled:text-[var(--control-disabled-text)] disabled:shadow-none [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-[var(--border-focus)] focus-visible:ring-2 focus-visible:ring-[color:color-mix(in_oklch,var(--control-focus)_42%,transparent)] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive active:translate-y-px",
  {
    variants: {
      variant: {
        default:
          'bg-[var(--action-primary)] text-[var(--action-primary-foreground)] hover:bg-[var(--action-primary-hover)] hover:shadow-elevation-medium focus-visible:ring-[3px] focus-visible:ring-[color:var(--control-focus)]',
        destructive:
          'bg-[var(--action-destructive)] text-[var(--danger-foreground)] hover:bg-[var(--action-destructive-hover)] focus-visible:ring-[3px] focus-visible:ring-[color:color-mix(in_oklch,var(--danger)_34%,white)]',
        outline:
          'border-[var(--control-border)] bg-[var(--control-background)] text-[var(--control-text)] hover:border-[var(--control-border-hover)] hover:bg-[var(--control-background-hover)]',
        secondary:
          'border-[var(--control-border)] bg-[var(--action-secondary)] text-[var(--action-secondary-foreground)] hover:border-[var(--control-border-hover)] hover:bg-[var(--action-secondary-hover)]',
        ghost:
          'bg-transparent text-[var(--text-secondary)] shadow-none hover:bg-[var(--action-ghost-hover)] hover:text-[var(--text-primary)]',
        link: 'bg-transparent text-[var(--text-link)] shadow-none underline-offset-4 hover:text-[var(--action-primary-hover)] hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3',
        sm: 'h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5',
        lg: 'h-10 rounded-md px-6 has-[>svg]:px-4',
        icon: 'size-9',
        'icon-sm': 'size-8',
        'icon-lg': 'size-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : 'button'

  return (
    <Comp
      data-slot="button"
      data-size={size ?? 'default'}
      data-variant={variant ?? 'default'}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
