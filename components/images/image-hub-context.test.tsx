// @vitest-environment jsdom
// STRUCTURAL_WAVE_0 (D4 + D6) - the REAL /imagens hub, only network/Supabase/router faked.
//
// D4: arriving from a Production (?project=&production=) pre-selects the creation context, validated against what the user can read,
//     and never creates a Session by itself.
// D6: "Ver todos" in the compact drafts card no longer pushes /imagens/rascunhos (a compatibility route that redirects back here);
//     it takes the user to the complete drafts list on this same page.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { GenerationSessionNavigationProvider } from '@/components/generation-session/session-navigation-guard'
import ImagesPage from '@/app/(dashboard)/imagens/page'
import ImageGenerationSessionPage from '@/app/(dashboard)/imagens/geracoes/[sessionId]/page'

const PROJECT_A = '11111111-1111-4111-8111-111111111111'
const PROJECT_B = '11111111-1111-4111-8111-222222222222'
const PRODUCTION_A = '22222222-2222-4222-8222-111111111111'
const PRODUCTION_B = '22222222-2222-4222-8222-222222222222'
const SESSION_ID = 'a12c58b0-e79a-4d0e-8dbf-c3e04e14a250'

const push = vi.fn()
const replace = vi.fn()
let searchParams = new URLSearchParams()
let routeParams: Record<string, string> = {}

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  useParams: () => routeParams,
  useSearchParams: () => searchParams,
}))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))

const PROJECTS = [
  { id: PROJECT_A, name: 'Projeto Alfa' },
  { id: PROJECT_B, name: 'Projeto Beta' },
]
const PRODUCTIONS = [
  { id: PRODUCTION_A, project_id: PROJECT_A, title: 'Producao Alfa Um', intention: null, updated_at: '2026-10-01T00:00:00Z' },
  { id: PRODUCTION_B, project_id: PROJECT_B, title: 'Producao Beta Um', intention: null, updated_at: '2026-10-01T00:00:00Z' },
]

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
    from: (table: string) => {
      const result = { data: table === 'projects' ? PROJECTS : table === 'productions' ? PRODUCTIONS : [], error: null }
      const builder: any = {
        select: () => builder, order: () => builder, eq: () => builder, in: () => builder, single: () => Promise.resolve({ data: null, error: null }),
        then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
      }
      return builder
    },
  }),
}))

type Call = { url: string; method: string }
let calls: Call[]
let drafts: unknown[]

const draft = (id: string, projectId: string, productionId: string) => ({
  id, name: `Rascunho ${id.slice(0, 4)}`, user_input: 'um retrato', generated_prompt: 'portrait', image_status: 'draft',
  project_id: projectId, production_id: productionId, updated_at: '2026-10-05T10:00:00Z',
})

beforeEach(() => {
  calls = []
  drafts = []
  push.mockReset()
  replace.mockReset()
  routeParams = {}
  searchParams = new URLSearchParams()
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => undefined
  Element.prototype.releasePointerCapture ??= () => undefined
  global.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, method: init?.method ?? 'GET' })
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
    if (url.startsWith('/api/image-drafts')) return json({ drafts })
    if (url === '/api/image-generation-sessions') {
      return init?.method === 'POST' ? json({ session: { id: SESSION_ID } }, 201) : json({ sessions: [] })
    }
    if (url.startsWith('/api/productions/')) {
      const production = PRODUCTIONS.find((entry) => url.endsWith(entry.id))
      return production ? json({ production }) : json({}, 404)
    }
    return json({})
  }) as unknown as typeof fetch
})
afterEach(() => cleanup())

const renderHub = () => render(<GenerationSessionNavigationProvider><ImagesPage /></GenerationSessionNavigationProvider>)
const trigger = (id: 'image-hub-project' | 'image-hub-production') => document.getElementById(id) as HTMLElement
const createButton = () => screen.getByRole('button', { name: 'Criar na Production' }) as HTMLButtonElement

async function openHub(query: string) {
  searchParams = new URLSearchParams(query)
  renderHub()
  await screen.findByText('Gerações recentes')
}

describe('D4 - /imagens creation context from a Production entry', () => {
  it('pre-selects the Project and the Production of the entry and enables the explicit create action', async () => {
    await openHub(`project=${PROJECT_A}&production=${PRODUCTION_A}`)
    await waitFor(() => expect(trigger('image-hub-project').textContent).toContain('Projeto Alfa'))
    expect(trigger('image-hub-production').textContent).toContain('Producao Alfa Um')
    expect(createButton().disabled).toBe(false)
  })

  it('never creates a Session by itself: no write request, no navigation', async () => {
    await openHub(`project=${PROJECT_A}&production=${PRODUCTION_A}`)
    await waitFor(() => expect(trigger('image-hub-project').textContent).toContain('Projeto Alfa'))
    expect(calls.filter((call) => call.method !== 'GET')).toEqual([])
    expect(calls.some((call) => call.url === '/api/image-generation-sessions' && call.method === 'POST')).toBe(false)
    expect(push).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
  })

  it('"Criar na Production" still creates exactly one Session, only on the click, for the pre-selected context', async () => {
    await openHub(`project=${PROJECT_A}&production=${PRODUCTION_A}`)
    await waitFor(() => expect(createButton().disabled).toBe(false))
    fireEvent.click(createButton())
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/imagens/geracoes/${SESSION_ID}`))
    const posts = calls.filter((call) => call.url === '/api/image-generation-sessions' && call.method === 'POST')
    expect(posts).toHaveLength(1)
  })

  it('a Production that belongs to ANOTHER Project is not selected (the relationship is validated); the Project stays', async () => {
    await openHub(`project=${PROJECT_A}&production=${PRODUCTION_B}`)
    await waitFor(() => expect(trigger('image-hub-project').textContent).toContain('Projeto Alfa'))
    expect(trigger('image-hub-production').textContent).not.toContain('Producao Beta Um')
    expect(trigger('image-hub-production').textContent).toContain('Selecione uma Production')
    expect(createButton().disabled).toBe(true)
  })

  it('identifiers the user cannot read select nothing', async () => {
    await openHub('project=99999999-9999-4999-8999-999999999999&production=88888888-8888-4888-8888-888888888888')
    await waitFor(() => expect(calls.some((call) => call.url.startsWith('/api/image-generation-sessions'))).toBe(true))
    expect(trigger('image-hub-project').textContent).toContain('Selecione um Project')
    expect(trigger('image-hub-production').textContent).toContain('Selecione uma Production')
    expect(createButton().disabled).toBe(true)
  })

  it('without parameters the hub starts empty, exactly as before', async () => {
    await openHub('')
    expect(trigger('image-hub-project').textContent).toContain('Selecione um Project')
    expect(createButton().disabled).toBe(true)
  })

  it('does not touch the context persisted in an existing Session: the canonical workspace ignores the entry parameters', async () => {
    routeParams = { sessionId: SESSION_ID }
    searchParams = new URLSearchParams(`project=${PROJECT_B}&production=${PRODUCTION_B}`)
    global.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, method: init?.method ?? 'GET' })
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
      if (url === `/api/image-generation-sessions/${SESSION_ID}`) {
        return json({
          session: {
            id: SESSION_ID, projectId: PROJECT_A, productionId: PRODUCTION_A, name: null, workingPrompt: 'Retrato', currentImageId: null, status: 'active', revision: 0,
            legacyImageDraftId: null, legacyCurrentEvaluation: null, createdAt: '2026-10-06T10:00:00.000Z', updatedAt: '2026-10-06T10:00:00.000Z',
            workingState: {
              schemaVersion: 1, generatedPrompt: 'portrait', generatedPromptPt: null, promptDetails: null, autoMode: false, selectedModel: 'gpt-image-1', imageStatus: 'draft',
              currentAttempt: 1, currentImageId: null, sourceReferences: [], generationConfig: { size: '1024x1024', quality: 'medium', aspectRatio: '1:1', style: null, providerOptions: {} }, legacyImageUrl: null,
            },
          },
        })
      }
      if (url.startsWith('/api/image-generation-attempts')) return json({ attempts: [] })
      if (url === '/api/image-generation-sessions') return json({ sessions: [] })
      if (url.startsWith('/api/image-drafts')) return json({ drafts: [] })
      return json({})
    }) as unknown as typeof fetch
    render(<GenerationSessionNavigationProvider><ImageGenerationSessionPage /></GenerationSessionNavigationProvider>)
    const back = await screen.findByText('Voltar para a Produção')
    // The entry parameters (Project/Production B) were not applied to the Session: the Production lookup never used them.
    expect(calls.some((call) => call.url.includes(PRODUCTION_B))).toBe(false)
    expect(screen.queryByText('Gerações recentes')).toBeNull()
    fireEvent.click(back)
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/projetos/${PROJECT_A}/producoes/${PRODUCTION_A}`))
  })
})

describe('D6 - "Ver todos" in the compact drafts card', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn()
  })

  it('goes to the complete drafts list on this page instead of the redirecting /imagens/rascunhos', async () => {
    drafts = [draft('d1000000-0000-4000-8000-000000000001', PROJECT_A, PRODUCTION_A), draft('d2000000-0000-4000-8000-000000000002', PROJECT_A, PRODUCTION_A)]
    await openHub(`project=${PROJECT_A}&production=${PRODUCTION_A}`)
    const viewAll = await screen.findByTestId('image-drafts-view-all')
    fireEvent.click(viewAll)

    expect(push).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
    const section = screen.getByTestId('image-draft-hub-section')
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
    expect(document.activeElement).toBe(section)
    // The destination is the real, complete list (with its filters), and it is reachable.
    expect(section.textContent).toContain('Rascunhos recentes')
    expect(section.textContent).toContain('Rascunho d100')
    expect(section.textContent).toContain('Rascunho d200')
    expect(section.querySelector('#image-filter-search')).toBeTruthy()
  })

  it('nothing in the hub still links to the redirecting compatibility route', () => {
    const source = readFileSync(join(process.cwd(), 'app/(dashboard)/imagens/page.tsx'), 'utf8')
    expect(source).not.toContain("router.push('/imagens/rascunhos')")
    expect(source).not.toContain('/imagens/rascunhos')
  })
})
