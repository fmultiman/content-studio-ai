'use client'

import * as React from 'react'
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { CheckIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer size-4 shrink-0 rounded-[4px] border border-[var(--control-border)] bg-[var(--control-background)] text-[var(--action-primary-foreground)] shadow-elevation-low transition-[background-color,border-color,box-shadow,color] outline-none data-[state=checked]:border-[color:color-mix(in_oklch,var(--action-primary)_56%,var(--border-default))] data-[state=checked]:bg-[var(--action-primary)] data-[state=unchecked]:text-transparent focus-visible:border-[var(--border-focus)] focus-visible:ring-[3px] focus-visible:ring-[color:var(--control-focus)] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive disabled:cursor-not-allowed disabled:border-[var(--control-disabled-border)] disabled:bg-[var(--control-disabled-background)] disabled:text-[var(--control-disabled-text)] disabled:opacity-100',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current transition-none"
      >
        <CheckIcon className="size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
