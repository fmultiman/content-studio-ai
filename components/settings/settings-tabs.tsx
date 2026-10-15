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
// scrolled: a left-aligned flex row whose items keep their NATURAL width and wrap
// onto further rows when the container is narrower (one row on desktop, two on a
// tablet, three on a phone). Natural widths mean a label is never squeezed or
// ellipsized (a fixed-column grid did squeeze the longer uppercase labels at
// 390 px). No overflow container, no negative margins, no hidden scrollbar.

export const SETTINGS_TABS: ReadonlyArray<{ value: string; label: string; Icon: LucideIcon }> = [
  { value: 'profile', label: 'Perfil', Icon: User },
  { value: 'appearance', label: 'Aparência', Icon: Palette },
  { value: 'automation', label: 'Automação', Icon: Zap },
  { value: 'notifications', label: 'Notificações', Icon: Bell },
  { value: 'api', label: 'API', Icon: Key },
  { value: 'usage', label: 'Uso e custos', Icon: Gauge },
]

export const DEFAULT_SETTINGS_TAB = 'profile'

/**
 * STRUCTURAL_WAVE_0 (D5): the tab a `/configuracoes?tab=<value>` deep link asks for. Only an exact, known tab value is honoured;
 * anything else (missing, empty, unknown, wrong case, repeated, a prototype key) falls back to the default tab - never an error and
 * never a blank panel.
 */
export function resolveSettingsTab(requested: string | null | undefined): string {
  return SETTINGS_TABS.some((tab) => tab.value === requested) ? (requested as string) : DEFAULT_SETTINGS_TAB
}

export function SettingsTabsList() {
  return (
    <TabsList
      className="flex h-auto w-full flex-wrap justify-start gap-1.5"
      data-testid="settings-tabs"
    >
      {SETTINGS_TABS.map(({ value, label, Icon }) => (
        <TabsTrigger
          key={value}
          value={value}
          className="h-9 flex-none gap-2 px-3 sm:px-4"
          data-testid={`settings-tab-${value}`}
        >
          <Icon className="h-4 w-4" />
          <span>{label}</span>
        </TabsTrigger>
      ))}
    </TabsList>
  )
}
