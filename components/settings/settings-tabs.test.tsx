// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import { SETTINGS_TABS, SettingsTabsList } from './settings-tabs'

// USAGE_SETTINGS_POLISH_AND_HISTORICAL_PROOFS_V1 — the Settings navigation.
//
// jsdom has no layout engine, so pixel behaviour is proven in a real browser at
// 1600 / 1280 / 768 / 390 px (recorded in the task report). What is asserted here
// is what jsdom CAN prove: every item exists and is reachable, the active state
// works, and the layout contract that made the old one clip is gone — the list
// wraps, and there is no overflow container to hide items in.

afterEach(cleanup)

function renderTabs(defaultValue = 'profile') {
  return render(
    <Tabs defaultValue={defaultValue}>
      <SettingsTabsList />
      {SETTINGS_TABS.map((tab) => (
        <TabsContent key={tab.value} value={tab.value}>
          <p data-testid={`panel-${tab.value}`}>{tab.label} panel</p>
        </TabsContent>
      ))}
    </Tabs>,
  )
}

describe('Settings navigation', () => {
  it('renders every item, in order — nothing is dropped or hidden', () => {
    renderTabs()
    const triggers = screen.getAllByRole('tab')
    expect(triggers.map((node) => node.textContent)).toEqual(['Perfil', 'Aparência', 'Automação', 'Notificações', 'API', 'Uso e custos'])
    expect(SETTINGS_TABS.map((tab) => tab.value)).toEqual(['profile', 'appearance', 'automation', 'notifications', 'api', 'usage'])
  })

  it('"Uso e custos" is reachable, becomes the active tab and shows its panel', () => {
    renderTabs()
    expect(screen.getByTestId('settings-tab-profile').getAttribute('data-state')).toBe('active')
    expect(screen.getByTestId('settings-tab-usage').getAttribute('data-state')).toBe('inactive')

    // Radix activates a tab on mousedown.
    fireEvent.mouseDown(screen.getByTestId('settings-tab-usage'), { button: 0, ctrlKey: false })

    expect(screen.getByTestId('settings-tab-usage').getAttribute('data-state')).toBe('active')
    expect(screen.getByTestId('settings-tab-profile').getAttribute('data-state')).toBe('inactive')
    expect(screen.getByTestId('panel-usage')).toBeTruthy()
    expect(screen.queryByTestId('panel-profile')).toBeNull()
  })

  it('every tab can be activated', () => {
    renderTabs()
    for (const tab of SETTINGS_TABS) {
      fireEvent.mouseDown(screen.getByTestId(`settings-tab-${tab.value}`), { button: 0, ctrlKey: false })
      expect(screen.getByTestId(`settings-tab-${tab.value}`).getAttribute('data-state')).toBe('active')
      expect(screen.getByTestId(`panel-${tab.value}`)).toBeTruthy()
    }
  })

  it('does not depend on horizontal scrolling: the list wraps (grid on phones, wrapping flex from sm) and is never a fixed-height, centred, no-wrap row', () => {
    renderTabs()
    const list = screen.getByTestId('settings-tabs').className
    expect(list).toMatch(/\bgrid\b/)
    expect(list).toMatch(/grid-cols-2/)
    expect(list).toMatch(/sm:flex\b/)
    expect(list).toMatch(/sm:flex-wrap/)
    expect(list).toMatch(/\bh-auto\b/)
    expect(list).toMatch(/\bw-full\b/)
    // The old defect: a centred row that overflows on both sides. Items start at the left edge instead.
    expect(list).toMatch(/\bjustify-start\b/)
    expect(list).not.toMatch(/justify-center/)
    expect(list).not.toMatch(/min-w-full/)
    expect(list).not.toMatch(/overflow/)
    for (const trigger of screen.getAllByRole('tab')) {
      expect(trigger.className).not.toMatch(/overflow/)
      expect(trigger.className).toMatch(/min-w-0/)
    }
  })

  it('the Settings page no longer wraps its tabs in a horizontal scroll container', () => {
    const page = readFileSync(join(process.cwd(), 'app/(dashboard)/configuracoes/page.tsx'), 'utf8')
    expect(page).toMatch(/<SettingsTabsList \/>/)
    expect(page).not.toMatch(/overflow-x-auto/)
    expect(page).not.toMatch(/<TabsTrigger value="(profile|appearance|automation|notifications|api|usage)"/)
  })
})
