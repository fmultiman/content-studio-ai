import * as React from 'react'

import { cn } from '@/lib/utils'

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex field-sizing-content min-h-16 w-full rounded-md border !border-[var(--control-border)] !bg-[var(--control-background)] px-3 py-2 text-base !text-[var(--control-text)] shadow-elevation-low transition-[color,box-shadow,background-color,border-color] outline-none placeholder:text-[var(--control-placeholder)] hover:!border-[var(--control-border-hover)] hover:!bg-[var(--control-background-hover)] focus-visible:!border-[var(--border-focus)] focus-visible:ring-[3px] focus-visible:ring-[color:var(--control-focus)] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive disabled:cursor-not-allowed disabled:!border-[var(--control-disabled-border)] disabled:!bg-[var(--control-disabled-background)] disabled:!text-[var(--control-disabled-text)] read-only:!bg-[var(--control-readonly-background)] read-only:!text-[var(--text-secondary)] md:text-sm',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
