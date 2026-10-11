// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import SettingsPage from '@/app/(dashboard)/configuracoes/page'

// FUTURE-057 Slice A — Settings -> Automação describes only behaviour that exists, hides the inert controls and
// still round-trips every stored preference unchanged.

const STORED = {
  theme: 'dark',
  studio_intensity: 'balanced',
  auto_mode_default: true, // the DB default: present for every user, never a choice
  save_prompt_history: true,
  notifications_email: true,
  notifications_browser: false,
  automation_enabled: false,
  default_image_model: 'nanobanana-v2',
  image_evaluator_enabled: true,
  max_refinement_iterations: 3,
}

const upserts: Array<Record<string, unknown>> = []
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
        single: () => Promise.resolve({ data: { ...STORED }, error: null }),
        upsert: (row: Record<string, unknown>) => { upserts.push(row); return Promise.resolve({ error: null }) },
      }
      return chain
    },
  }),
}))

beforeEach(() => {
  // Radix Slider measures its track; jsdom has no ResizeObserver.
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  upserts.length = 0
  global.fetch = vi.fn((input: unknown) => {
    const url = String(input)
    if (url.startsWith('/api/settings/providers')) return Promise.resolve(new Response(JSON.stringify({ providers: {} }), { status: 200 }))
    return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
  }) as unknown as typeof fetch
})
afterEach(cleanup)

async function openAutomation() {
  render(<SettingsPage />)
  const tab = await screen.findByTestId('settings-tab-automation')
  fireEvent.mouseDown(tab, { button: 0, ctrlKey: false })
  await screen.findByText('Modelo Padrão de Imagem')
}

describe('Settings → Automação', () => {
  it('describes the three real workflows and never claims automatic evaluation or refinement', async () => {
    await openAutomation()
    const text = document.body.textContent ?? ''
    expect(text).toContain('Permitir o modo Automático')
    expect(text).toMatch(/Nada é executado sem você clicar em “Gerar automaticamente”/)
    expect(text).toMatch(/roda no seu navegador enquanto a página está aberta e nunca começa sozinha/)
    expect(text).toMatch(/avaliação é manual/)
    expect(text).toMatch(/Reservado: o refinamento automático ainda não está disponível/)
    // The false promises are gone.
    expect(text).not.toMatch(/Avaliar imagens automaticamente/)
    expect(text).not.toMatch(/tentativas automáticas/)
    expect(text).not.toMatch(/Gerar prompt e imagem automaticamente ao clicar/)
    expect(text).not.toMatch(/style profile/)
    expect(text).not.toMatch(/DALL-E/)
  })

  it('hides the inert controls but keeps their stored values and sends them back unchanged on save', async () => {
    await openAutomation()
    expect(screen.queryByText('Modo Automático Padrão')).toBeNull()
    expect(screen.queryByText('Salvar Histórico de Prompts')).toBeNull()
    expect(screen.queryByText('Preferências adicionais')).toBeNull()

    const save = screen.getAllByRole('button', { name: /Salvar Preferências/ })
    fireEvent.click(save[save.length - 1])
    await waitFor(() => expect(upserts).toHaveLength(1))
    expect(upserts[0]).toMatchObject({
      user_id: 'user-1',
      auto_mode_default: true,
      save_prompt_history: true,
      automation_enabled: false, // the global automation preference stays OFF unless the user turns it on
      default_image_model: 'nanobanana-v2',
      image_evaluator_enabled: true,
      max_refinement_iterations: 3,
    })
  })

  it('the refinement slider is shown as reserved (disabled) and does not change the stored value', async () => {
    await openAutomation()
    expect(await screen.findByTestId('refinement-reserved-note')).toBeTruthy()
    const slider = document.querySelector('[role="slider"]') as HTMLElement | null
    expect(slider?.getAttribute('data-disabled')).not.toBeNull()
    expect(slider?.getAttribute('aria-valuenow')).toBe('3')
  })

  it('turning the global automation preference on is only a preference write: no provider is called', async () => {
    await openAutomation()
    const toggle = screen.getByText('Permitir o modo Automático').closest('div')!.parentElement!.querySelector('button[role="switch"]') as HTMLElement
    fireEvent.click(toggle)
    const save = screen.getAllByRole('button', { name: /Salvar Preferências/ })
    fireEvent.click(save[save.length - 1])
    await waitFor(() => expect(upserts).toHaveLength(1))
    expect(upserts[0].automation_enabled).toBe(true)
    const urls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((call) => String(call[0]))
    expect(urls.filter((url) => /prompt-assistance|generate-image|nanobanana\/generate|reviews/.test(url))).toEqual([])
  })
})
