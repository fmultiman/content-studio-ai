// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import SettingsPage from '@/app/(dashboard)/configuracoes/page'

// STRUCTURAL_WAVE_0 (D5) - /configuracoes?tab=<value> opens that tab (the AI-credential CTAs link to ?tab=api), an invalid value
// falls back to Perfil, and the normal navigation between tabs keeps working. The real page; only Supabase/network are faked.

let currentSearch = ''
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(currentSearch),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'dark', setTheme: vi.fn() }) }))
vi.mock('@/components/theme-provider', () => ({ useStudioIntensity: () => ({ studioIntensity: 'balanced', setStudioIntensity: vi.fn() }) }))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'user-1', email: 'a@b.c', created_at: '2026-01-01T00:00:00Z' } } }) },
    from: () => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        single: () => Promise.resolve({ data: { theme: 'dark', studio_intensity: 'balanced', default_image_model: 'gpt-image-2' }, error: null }),
        upsert: () => Promise.resolve({ error: null }),
      }
      return chain
    },
  }),
}))

beforeEach(() => {
  currentSearch = ''
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  global.fetch = vi.fn((input: unknown) => {
    const url = String(input)
    if (url.startsWith('/api/settings/providers')) return Promise.resolve(new Response(JSON.stringify({ providers: {} }), { status: 200 }))
    return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
  }) as unknown as typeof fetch
})
afterEach(cleanup)

const state = (tab: string) => screen.getByTestId(`settings-tab-${tab}`).getAttribute('data-state')

async function open(search: string) {
  currentSearch = search
  render(<SettingsPage />)
  await screen.findByTestId('settings-tab-api')
}

describe('Settings deep links', () => {
  it('?tab=api opens the API tab (credentials), not Perfil', async () => {
    await open('tab=api')
    expect(state('api')).toBe('active')
    expect(state('profile')).toBe('inactive')
    // The API panel is the one on screen.
    expect(screen.getByRole('tabpanel').getAttribute('id')).toMatch(/content-api$/)
  })

  it.each(['profile', 'appearance', 'automation', 'notifications', 'usage'])('?tab=%s opens that tab', async (tab) => {
    await open(`tab=${tab}`)
    expect(state(tab)).toBe('active')
  })

  it.each(['', 'tab=', 'tab=unknown', 'tab=API', 'tab=constructor', 'tab=__proto__', 'other=api'])('"%s" falls back to Perfil without breaking the page', async (search) => {
    await open(search)
    expect(state('profile')).toBe('active')
    expect(state('api')).toBe('inactive')
  })

  it('manual navigation between tabs still works after a deep link, and the user choice is kept', async () => {
    await open('tab=api')
    fireEvent.mouseDown(screen.getByTestId('settings-tab-usage'), { button: 0, ctrlKey: false })
    expect(state('usage')).toBe('active')
    expect(state('api')).toBe('inactive')
    fireEvent.mouseDown(screen.getByTestId('settings-tab-profile'), { button: 0, ctrlKey: false })
    expect(state('profile')).toBe('active')
  })

  it('a later navigation to another ?tab= value (same mounted page) is followed once', async () => {
    currentSearch = 'tab=automation'
    const view = render(<SettingsPage />)
    await screen.findByTestId('settings-tab-api')
    expect(state('automation')).toBe('active')
    currentSearch = 'tab=api'
    view.rerender(<SettingsPage />)
    expect(state('api')).toBe('active')
    // Dropping the parameter (for example after the OAuth redirect cleans the URL) does not yank the user away.
    currentSearch = ''
    view.rerender(<SettingsPage />)
    expect(state('api')).toBe('active')
  })
})
