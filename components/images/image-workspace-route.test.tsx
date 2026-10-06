// @vitest-environment jsdom
// IMAGE_GENERATION_WORKSPACE_REGRESSION_RECOVERY_V1
//
// Production regression: creating (or continuing) an Image Session navigated to
// /imagens/geracoes/[sessionId] but the page bounced to the hub. Cause: in Next.js 16 the page `params`
// prop is a Promise, so `params.sessionId` was `undefined`, `canonicalSessionId` was falsy, and the shell
// rendered the HUB after the loading state. These tests render the REAL route page and the REAL workspace
// shell (only network/Supabase/router are faked) so that class of break cannot pass CI again.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { GenerationSessionNavigationProvider } from '@/components/generation-session/session-navigation-guard'
import ImageGenerationSessionPage from '@/app/(dashboard)/imagens/geracoes/[sessionId]/page'
import ImagesPage from '@/app/(dashboard)/imagens/page'
import { ImageSessionCard } from '@/components/images/image-session-card'

const SESSION_ID = 'a12c58b0-e79a-4d0e-8dbf-c3e04e14a250'
const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const PRODUCTION_ID = '22222222-2222-4222-8222-222222222222'

const push = vi.fn()
const replace = vi.fn()
let routeParams: Record<string, string> = { sessionId: SESSION_ID }
// Next returns a stable object; a new one per render would re-run the hydration effect forever.
const searchParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  useParams: () => routeParams,
  useSearchParams: () => searchParams,
}))

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))

vi.mock('@/lib/supabase/client', () => {
  const result = { data: [], error: null }
  const builder: any = {
    select: () => builder, order: () => builder, eq: () => builder, in: () => builder, single: () => Promise.resolve({ data: null, error: null }),
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
  }
  return { createClient: () => ({ from: () => builder, auth: { getUser: async () => ({ data: { user: null } }) } }) }
})

function sessionPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION_ID,
    projectId: PROJECT_ID,
    productionId: PRODUCTION_ID,
    name: null,
    workingPrompt: 'Retrato de estúdio em luz suave',
    workingState: {
      schemaVersion: 1, generatedPrompt: 'soft studio portrait', generatedPromptPt: null, promptDetails: null, autoMode: false,
      selectedModel: 'gpt-image-1', imageStatus: 'draft', currentAttempt: 1, currentImageId: null, sourceReferences: [],
      generationConfig: { size: '1024x1024', quality: 'medium', aspectRatio: '1:1', style: null, providerOptions: {} }, legacyImageUrl: null,
    },
    currentImageId: null,
    status: 'active',
    revision: 0,
    legacyImageDraftId: null,
    legacyCurrentEvaluation: null,
    createdAt: '2026-10-06T10:00:00.000Z',
    updatedAt: '2026-10-06T10:00:00.000Z',
    ...overrides,
  }
}

function installFetch(handlers: { session?: () => Response; sessions?: unknown[] } = {}) {
  const calls: string[] = []
  global.fetch = vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    calls.push(url)
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
    if (url === `/api/image-generation-sessions/${SESSION_ID}`) return handlers.session ? handlers.session() : json({ session: sessionPayload() })
    if (url.startsWith('/api/image-generation-attempts')) return json({ attempts: [] })
    if (url === '/api/image-generation-sessions') return json({ sessions: handlers.sessions ?? [] })
    if (url.startsWith('/api/image-drafts')) return json({ drafts: [] })
    return json({})
  }) as unknown as typeof fetch
  return calls
}

const renderRoute = () => render(<GenerationSessionNavigationProvider><ImageGenerationSessionPage /></GenerationSessionNavigationProvider>)

describe('canonical Image workspace route', () => {
  beforeEach(() => {
    routeParams = { sessionId: SESSION_ID }
    push.mockReset()
    replace.mockReset()
  })
  afterEach(() => cleanup())

  it('stays on the canonical workspace and hydrates the Session (no bounce to the hub)', async () => {
    const calls = installFetch()
    renderRoute()

    // The workspace chrome of the canonical route appears, and the hub never does.
    expect(await screen.findByText('Voltar para a Produção')).toBeTruthy()
    expect(calls).toContain(`/api/image-generation-sessions/${SESSION_ID}`)
    expect(calls).toContain(`/api/image-generation-attempts?sessionId=${SESSION_ID}`)
    expect(screen.queryByText('Gerações recentes')).toBeNull()
    expect(replace).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('does not depend on the Next.js 16 Promise `params` prop (the production break)', async () => {
    installFetch()
    // Next.js 16 passes `params` as a Promise. Reading `.sessionId` off it is `undefined`.
    const props = { params: Promise.resolve({ sessionId: SESSION_ID }) } as unknown as Record<string, never>
    const Page = ImageGenerationSessionPage as unknown as (p: Record<string, never>) => React.ReactElement
    render(<GenerationSessionNavigationProvider><Page {...props} /></GenerationSessionNavigationProvider>)
    expect(await screen.findByText('Voltar para a Produção')).toBeTruthy()
    expect(screen.queryByText('Gerações recentes')).toBeNull()
  })

  it('hydrates again after a refresh (remount) and stays open', async () => {
    const calls = installFetch()
    const first = renderRoute()
    expect(await screen.findByText('Voltar para a Produção')).toBeTruthy()
    first.unmount()
    renderRoute()
    expect(await screen.findByText('Voltar para a Produção')).toBeTruthy()
    expect(calls.filter((url) => url === `/api/image-generation-sessions/${SESSION_ID}`).length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText('Gerações recentes')).toBeNull()
  })

  it('hydrates a Session without a current image and a Session that has one', async () => {
    installFetch()
    renderRoute()
    expect(await screen.findByText('Voltar para a Produção')).toBeTruthy()
    cleanup()
    const imageId = '33333333-3333-4333-8333-333333333333'
    installFetch({ session: () => new Response(JSON.stringify({ session: sessionPayload({ currentImageId: imageId, workingState: { ...sessionPayload().workingState, currentImageId: imageId } }) }), { status: 200 }) })
    renderRoute()
    expect(await screen.findByText('Voltar para a Produção')).toBeTruthy()
  })

  it('treats a missing/unauthorized Session as an error state, never as a hub redirect loop', async () => {
    installFetch({ session: () => new Response(JSON.stringify({ error: 'not found' }), { status: 404 }) })
    renderRoute()
    expect((await screen.findAllByText(/Não foi possível carregar os dados/)).length).toBeGreaterThan(0)
    expect(screen.queryByText('Gerações recentes')).toBeNull()
  })

  it('still renders the hub (and not the workspace) when there is no sessionId', async () => {
    routeParams = {}
    const calls = installFetch()
    render(<GenerationSessionNavigationProvider><ImagesPage /></GenerationSessionNavigationProvider>)
    expect(await screen.findByText('Gerações recentes')).toBeTruthy()
    expect(calls.some((url) => url.startsWith(`/api/image-generation-sessions/${SESSION_ID}`))).toBe(false)
    expect(screen.queryByText('Voltar para a Produção')).toBeNull()
  })
})

describe('Gerações recentes cards', () => {
  afterEach(() => cleanup())

  it('renders the thumbnail of a Session with a current image', () => {
    render(<ImageSessionCard session={{ id: SESSION_ID, workingPrompt: 'Prompt', updatedAt: '2026-10-06T10:00:00.000Z', thumbnailUrl: 'https://cdn.example/thumb.webp' }} onContinue={() => {}} />)
    const img = screen.getByTestId('image-session-thumbnail').querySelector('img')
    expect(img?.getAttribute('src')).toBe('https://cdn.example/thumb.webp')
    expect(screen.queryByTestId('image-session-placeholder')).toBeNull()
  })

  it('renders an intentional placeholder for a Session without an image', () => {
    render(<ImageSessionCard session={{ id: SESSION_ID, workingPrompt: 'Prompt', updatedAt: '2026-10-06T10:00:00.000Z', thumbnailUrl: null }} onContinue={() => {}} />)
    expect(screen.getByTestId('image-session-placeholder')).toBeTruthy()
    expect(screen.queryByTestId('image-session-thumbnail')).toBeNull()
  })

  it('Continuar opens the canonical Session route', () => {
    const onContinue = vi.fn()
    render(<ImageSessionCard session={{ id: SESSION_ID, updatedAt: '2026-10-06T10:00:00.000Z' }} onContinue={onContinue} />)
    fireEvent.click(screen.getByRole('button', { name: /Continuar/ }))
    expect(onContinue).toHaveBeenCalledWith(SESSION_ID)
  })

  it('the hub shows the thumbnail returned by the Sessions list and navigates to the canonical route on Continuar', async () => {
    routeParams = {}
    installFetch({ sessions: [sessionPayload({ thumbnailUrl: 'https://cdn.example/session-thumb.webp', currentImageId: '33333333-3333-4333-8333-333333333333' })] })
    render(<GenerationSessionNavigationProvider><ImagesPage /></GenerationSessionNavigationProvider>)
    const thumb = await screen.findByTestId('image-session-thumbnail')
    expect(thumb.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example/session-thumb.webp')
    fireEvent.click(screen.getByRole('button', { name: /Continuar/ }))
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/imagens/geracoes/${SESSION_ID}`))
  })
})
