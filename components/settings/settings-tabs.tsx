import type { LucideIcon } from 'lucide-react'
import { Bell, Gauge, Key, Palette, User, Zap } from 'lucide-react'
import { TabsList, TabsTrigger } from '@/components/ui/tabs'

// USAGE_SETTINGS_POLISH_AND_HISTORICAL_PROOFS_V1
//
// The Settings navigation. It must render inside a Radix <Tabs> root.
//
// Root cause of the previous clipping: the list was `inline-flex min-w-full
// justify-center` (fixed `h-9`, `whitespace-nowrap` items) inside an
// `overflow-x-auto` wrapper. When the six items were wider than the container, a
// CENTERED flex row overflowed equally to the left and right: the left overflow can
// never be scrolled to (first item clipped), the right needed a native scrollbar.
//
// The navigation now WRAPS instead of overflowing, so nothing is ever hidden or
// scrolled: a two-column grid on phones, a left-aligned wrapping row from `sm` up
// (one row on desktop, at most two on a narrow tablet). No overflow container, no
// negative margins, no hidden scrollbar.

export const SETTINGS_TABS: ReadonlyArray<{ value: string; label: string; Icon: LucideIcon }> = [
  { value: 'profile', label: 'Perfil', Icon: User },
  { value: 'appearance', label: 'Aparência', Icon: Palette },
  { value: 'automation', label: 'Automação', Icon: Zap },
  { value: 'notifications', label: 'Notificações', Icon: Bell },
  { value: 'api', label: 'API', Icon: Key },
  { value: 'usage', label: 'Uso e custos', Icon: Gauge },
]

export function SettingsTabsList() {
  return (
    <TabsList
      className="grid h-auto w-full grid-cols-2 justify-start gap-1.5 sm:flex sm:flex-wrap"
      data-testid="settings-tabs"
    >
      {SETTINGS_TABS.map(({ value, label, Icon }) => (
        <TabsTrigger
          key={value}
          value={value}
          className="h-9 min-w-0 gap-2 sm:flex-none sm:px-4"
          data-testid={`settings-tab-${value}`}
        >
          <Icon className="h-4 w-4" />
          <span className="truncate">{label}</span>
        </TabsTrigger>
      ))}
    </TabsList>
  )
}
