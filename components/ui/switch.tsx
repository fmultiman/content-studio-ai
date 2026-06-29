'use client'

import * as React from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'

import { cn } from '@/lib/utils'

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border shadow-elevation-low transition-[background-color,border-color,box-shadow] outline-none data-[state=checked]:border-[color:color-mix(in_oklch,var(--action-primary)_56%,var(--border-default))] data-[state=checked]:bg-[var(--action-primary)] data-[state=unchecked]:border-[var(--control-border)] data-[state=unchecked]:bg-[var(--control-background)] focus-visible:border-[var(--border-focus)] focus-visible:ring-[3px] focus-visible:ring-[color:var(--control-focus)] disabled:cursor-not-allowed disabled:border-[var(--control-disabled-border)] disabled:bg-[var(--control-disabled-background)] disabled:opacity-100',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-4 rounded-full bg-surface-elevated ring-0 shadow-[0_1px_2px_rgb(0_0_0_/_0.22)] transition-transform data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
