// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import SettingsPage from '@/app/(dashboard)/configuracoes/page'

// FUTURE-064 Slice B — Settings -> API / Automação: accurate provider labels and status for the official Google Gemini
// image models versus the legacy third-party NanoBananaAPI.ai. Mocked network only.

const stored = { current: {} as Record<string, unknown> }
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
        single: () => Promise.resolve({ data: { ...stored.current }, error: null }),
        upsert: (row: Record<string, unknown>) => { upserts.push(row); return Promise.resolve({ error: null }) },
      }
      return chain
    },
  }),
}))

const baseSettings = {
  theme: 'dark', studio_intensity: 'balanced', auto_mode_default: true, save_prompt_history: true, notifications_email: true,
  notifications_browser: false, automation_enabled: false, default_image_model: 'gpt-image-2', image_evaluator_enabled: true, max_refinement_iterations: 3,
}

let providersPayload: Record<string, unknown>
beforeEach(() => {
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  upserts.length = 0
  stored.current = { ...baseSettings }
  providersPayload = { providers: { gemini: { status: 'configured' }, openai: { status: 'configured' } }, imageGeneration: { gemini: { available: false, reason: 'release_switch_off' } } }
  global.fetch = vi.fn((input: unknown) => {
    const url = String(input)
    if (url.startsWith('/api/settings/providers')) return Promise.resolve(new Response(JSON.stringify(providersPayload), { status: 200 }))
    return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
  }) as unknown as typeof fetch
})
afterEach(cleanup)

async function openTab(value: 'automation' | 'api') {
  render(<SettingsPage />)
  const tab = await screen.findByTestId(`settings-tab-${value}`)
  fireEvent.mouseDown(tab, { button: 0, ctrlKey: false })
}
const radio = (id: string) => document.getElementById(id) as HTMLButtonElement
const text = () => document.body.textContent ?? ''

describe('Settings → Automação → Modelo Padrão de Imagem', () => {
  it('shows the official Google models and the legacy third-party models with distinct, accurate labels', async () => {
    await openTab('automation')
    await screen.findByText('Modelo Padrão de Imagem')
    expect(text()).toContain('Google Gemini — Nano Banana 2.1 (oficial)')
    expect(text()).toContain('Google Gemini — Nano Banana 2 Lite (oficial)')
    expect(text()).toContain('NanoBananaAPI.ai V1 (terceiros — legado)')
    expect(text()).toContain('NanoBananaAPI.ai V2 (terceiros — legado)')
    expect(text()).not.toMatch(/NanoBanana V1|NanoBanana V2|Modelo estável NanoBanana/)
    expect(text()).toMatch(/pode gerar cobrança na sua conta Google/)
    expect(text()).not.toMatch(/gr[aá]tis/i)
  })

  it('while the release switch is OFF the Google defaults are disabled with an accurate explanation; OpenAI and legacy stay selectable', async () => {
    await openTab('automation')
    await screen.findByText('Modelo Padrão de Imagem')
    await waitFor(() => expect(screen.getByTestId('settings-google-model-note')).toBeTruthy())
    expect(screen.getByTestId('settings-google-model-note').textContent).toMatch(/ainda não foi habilitada/)
    expect(radio('model-gemini-nb-21').disabled).toBe(true)
    expect(radio('model-gemini-nb-lite').disabled).toBe(true)
    expect(radio('model-gpt-image-2').disabled).toBe(false)
    expect(radio('model-nb-v1').disabled).toBe(false)
    expect(radio('model-nb-v2').disabled).toBe(false)
  })

  it('when the capability is available the Google defaults can be chosen, and the choice saves as the short alias', async () => {
    providersPayload = { providers: { gemini: { status: 'configured' } }, imageGeneration: { gemini: { available: true, reason: 'available' } } }
    await openTab('automation')
    await screen.findByText('Modelo Padrão de Imagem')
    await waitFor(() => expect(radio('model-gemini-nb-21').disabled).toBe(false))
    expect(screen.queryByTestId('settings-google-model-note')).toBeNull()
    fireEvent.click(radio('model-gemini-nb-21'))
    const save = screen.getAllByRole('button', { name: /Salvar Preferências/ })
    fireEvent.click(save[save.length - 1])
    await waitFor(() => expect(upserts).toHaveLength(1))
    expect(upserts[0].default_image_model).toBe('gemini-nb-2.1')
    expect(String(upserts[0].default_image_model).length).toBeLessThanOrEqual(20)
  })

  it('an existing default is never changed by merely opening and saving Settings (OFF state, every stored model)', async () => {
    for (const model of ['gpt-image-1', 'nanobanana-v2', 'gemini-nb-lite']) {
      cleanup()
      upserts.length = 0
      stored.current = { ...baseSettings, default_image_model: model }
      await openTab('automation')
      await screen.findByText('Modelo Padrão de Imagem')
      const save = screen.getAllByRole('button', { name: /Salvar Preferências/ })
      fireEvent.click(save[save.length - 1])
      await waitFor(() => expect(upserts).toHaveLength(1))
      expect(upserts[0].default_image_model).toBe(model)
    }
  })

  it('the saved Google default stays selectable (not stranded) even if the capability is switched off later', async () => {
    stored.current = { ...baseSettings, default_image_model: 'gemini-nb-2.1' }
    await openTab('automation')
    await screen.findByText('Modelo Padrão de Imagem')
    await waitFor(() => expect(screen.getByTestId('settings-google-model-note')).toBeTruthy())
    expect(radio('model-gemini-nb-21').disabled).toBe(false)
    expect(radio('model-gemini-nb-lite').disabled).toBe(true)
  })

  it('treats a missing availability signal as unavailable', async () => {
    providersPayload = { providers: { gemini: { status: 'configured' } } }
    await openTab('automation')
    await screen.findByText('Modelo Padrão de Imagem')
    await waitFor(() => expect(screen.getByTestId('settings-google-model-note')).toBeTruthy())
    expect(radio('model-gemini-nb-21').disabled).toBe(true)
  })
})

describe('Settings → API', () => {
  const card = (provider: string) => document.querySelector(`[data-provider="${provider}"]`) as HTMLElement
  const startEditing = async (provider: string) => {
    await waitFor(() => expect(card(provider)).toBeTruthy())
    fireEvent.click(within(card(provider)).getByRole('button', { name: /Configurar|Substituir/ }))
  }

  it('labels the NanoBananaAPI.ai card as a third-party legacy service and keeps its credential field', async () => {
    await openTab('api')
    await screen.findByText('NanoBananaAPI.ai (terceiros — legado)')
    expect(card('nano_banana').textContent).toMatch(/serviço de terceiros que não é a API oficial do Google/)
    expect(text()).not.toContain('Nano Banana (Gemini Flash Image)')
    await startEditing('nano_banana')
    expect(card('nano_banana').querySelector('input[placeholder="nb_..."]')).toBeTruthy() // the third-party credential field is not removed
    expect(card('nano_banana').textContent).toMatch(/NanoBananaAPI\.ai \(terceiros — legado\)/)
  })

  it('describes the Gemini key as ONE BYOK key for Review, prompt assistance and official image generation, with the capability status', async () => {
    await openTab('api')
    await screen.findByText('Google Gemini API')
    await waitFor(() => expect(card('gemini').textContent).toMatch(/Geração de imagem Google: ainda não habilitada neste ambiente/))
    expect(card('gemini').textContent).toMatch(/avaliações multimodais \(Review\), assistência de prompt e geração de imagem com os modelos oficiais Nano Banana/)
    expect(card('gemini').textContent).not.toMatch(/será habilitada em uma missão posterior|futuras avaliações/)
    await startEditing('gemini')
    expect(card('gemini').textContent).toMatch(/podem gerar cobrança na sua conta Google/)
    // still ONE Gemini key field and no separate "Nano Banana (Google)" credential
    expect(document.querySelectorAll('input[placeholder="Chave da API Gemini..."]').length).toBe(1)
    const providers = Array.from(document.querySelectorAll('[data-provider]')).map((node) => node.getAttribute('data-provider'))
    expect(providers.filter((provider) => provider === 'gemini')).toHaveLength(1)
    expect(providers.filter((provider) => provider === 'nano_banana')).toHaveLength(1)
    expect(providers.some((provider) => /google|nano_banana_google|gemini_image/i.test(provider ?? '') && provider !== 'gemini')).toBe(false)
  })

  it('shows "habilitada" only when the server says the capability is available', async () => {
    providersPayload = { providers: { gemini: { status: 'configured' } }, imageGeneration: { gemini: { available: true, reason: 'available' } } }
    await openTab('api')
    await waitFor(() => expect(card('gemini').textContent).toMatch(/Geração de imagem Google: habilitada neste ambiente/))
    expect(card('gemini').textContent).not.toMatch(/ainda não habilitada/)
  })
})
