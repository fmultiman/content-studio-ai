import * as React from 'react'

import { cn } from '@/lib/utils'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'h-9 w-full min-w-0 rounded-md border !border-[var(--control-border)] !bg-[var(--control-background)] px-3 py-1 text-base !text-[var(--control-text)] shadow-elevation-low transition-[color,box-shadow,background-color,border-color] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-[var(--control-text)] placeholder:text-[var(--control-placeholder)] selection:bg-primary selection:text-primary-foreground hover:!border-[var(--control-border-hover)] hover:!bg-[var(--control-background-hover)] disabled:pointer-events-none disabled:cursor-not-allowed disabled:!border-[var(--control-disabled-border)] disabled:!bg-[var(--control-disabled-background)] disabled:!text-[var(--control-disabled-text)] read-only:!bg-[var(--control-readonly-background)] read-only:!text-[var(--text-secondary)] md:text-sm',
        'focus-visible:!border-[var(--border-focus)] focus-visible:ring-2 focus-visible:ring-[color:color-mix(in_oklch,var(--control-focus)_40%,transparent)]',
        'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
