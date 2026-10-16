// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { createRecordingSupabase, type Row } from '@/lib/__tests__/helpers/recording-supabase'

// STRUCTURAL_WAVE_1A1 - the REAL Dashboard page (an async server component) and the REAL continuity hub, rendered against a recording
// fake of the data source: what the user actually sees for Sessions, edits, contents, counters and failures.

const ME = 'user-me'
const OTHER = 'user-other'
const P1 = 'p1'
const PR1 = 'pr1'

let tables: Record<string, Row[]>
let failing: Set<string>
let user: { id: string; email: string } | null

const redirect = vi.fn((target: string) => { throw new Error(`REDIRECT:${target}`) })
vi.mock('next/navigation', () => ({ redirect: (target: string) => redirect(target) }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    const { supabase } = createRecordingSupabase(tables, failing)
    return Object.assign(supabase, { auth: { getUser: async () => ({ data: { user } }) } })
  },
}))

const iso = (day: number, hour = 10) => `2026-10-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00.000Z`

beforeEach(() => {
  user = { id: ME, email: 'maria@example.com' }
  failing = new Set()
  redirect.mockClear()
  tables = {
    projects: [{ id: P1, user_id: ME, name: 'Portal Norte', description: null, context: null, identity: null, updated_at: iso(1) }],
    productions: [{ id: PR1, user_id: ME, project_id: P1, title: 'Campanha de outono', intention: 'Campanha', type: 'campaign', updated_at: iso(2) }],
    image_drafts: [],
    video_drafts: [],
    editorial_contents: [],
    image_generation_sessions: [],
    video_generation_sessions: [],
    video_generations: [],
  }
})
afterEach(() => cleanup())

async function renderDashboard() {
  const { default: DashboardPage } = await import('@/app/(dashboard)/dashboard/page')
  render(await DashboardPage())
}

const session = (id: string, overrides: Row = {}): Row => ({ id, user_id: ME, project_id: P1, production_id: PR1, name: null, working_prompt: `Sessão ${id}`, status: 'active', legacy_image_draft_id: null, image_status: 'draft', updated_at: iso(10), ...overrides })

describe('Dashboard continuity - what the user sees', () => {
  it('shows image and video Sessions, a Creative Editor edit and a content, each opening its own canonical destination', async () => {
    tables.image_generation_sessions = [session('img-1', { updated_at: iso(14) })]
    tables.video_generation_sessions = [{ id: 'vid-1', user_id: ME, project_id: P1, production_id: PR1, working_prompt: 'Vídeo do mar', updated_at: iso(13) }]
    tables.video_drafts = [{ id: 'edit-1', user_id: ME, project_id: P1, production_id: PR1, name: 'Teaser', updated_at: iso(12) }]
    tables.editorial_contents = [{ id: 'content-1', user_id: ME, project_id: P1, production_id: PR1, title: 'Lançamento', status: 'draft', updated_at: iso(11) }]
    await renderDashboard()

    const cards = screen.getAllByTestId('dashboard-work-item')
    expect(cards.map((card) => card.getAttribute('data-entity'))).toEqual(['image_session', 'video_session', 'video_draft', 'editorial'])
    const hrefOf = (entity: string) => within(cards.find((card) => card.getAttribute('data-entity') === entity)!).getByRole('link').getAttribute('href')
    expect(hrefOf('image_session')).toBe('/imagens/geracoes/img-1')
    expect(hrefOf('video_session')).toBe('/videos/geracoes/vid-1')
    expect(hrefOf('video_draft')).toBe('/creative-editor/video/edit-1')
    expect(hrefOf('editorial')).toBe('/projetos/p1/conteudos/content-1')
    // Each card names what it is.
    expect(within(cards[0]).getByText('Sessão de imagem')).toBeTruthy()
    expect(within(cards[1]).getByText('Sessão de vídeo')).toBeTruthy()
    expect(within(cards[2]).getByText('Edição de vídeo')).toBeTruthy()
  })

  it('a video Session shows its latest Attempt status in Portuguese', async () => {
    tables.video_generation_sessions = [{ id: 'vid-1', user_id: ME, project_id: P1, production_id: PR1, working_prompt: 'Vídeo do mar', updated_at: iso(13) }]
    tables.video_generations = [{ id: 'a1', user_id: ME, session_id: 'vid-1', status: 'failed', created_at: iso(13) }]
    await renderDashboard()
    expect(within(screen.getByTestId('dashboard-work-item')).getByText('Falhou')).toBeTruthy()
  })

  it('does not list a legacy ImageDraft twice when a Session carries it, and still lists one no Session carries', async () => {
    tables.image_drafts = [
      { id: 'd-linked', user_id: ME, project_id: P1, production_id: PR1, name: 'Rascunho vinculado', user_input: 'x', image_status: 'draft', updated_at: iso(9) },
      { id: 'd-orphan', user_id: ME, project_id: P1, production_id: PR1, name: 'Rascunho órfão', user_input: 'x', image_status: 'draft', updated_at: iso(8) },
    ]
    tables.image_generation_sessions = [session('img-1', { legacy_image_draft_id: 'd-linked', updated_at: iso(9) })]
    await renderDashboard()
    const entities = screen.getAllByTestId('dashboard-work-item').map((card) => `${card.getAttribute('data-entity')}`)
    expect(entities).toEqual(['image_session', 'image_draft'])
    expect(screen.queryByText('Rascunho vinculado')).toBeNull()
    expect(screen.getByText('Rascunho órfão')).toBeTruthy()
  })

  it('the Production card counts each entity on its own; the summary cards do too (never one merged total)', async () => {
    tables.image_generation_sessions = [session('i1'), session('i2'), session('i3', { legacy_image_draft_id: 'd-1' })]
    tables.image_drafts = [{ id: 'd-1', user_id: ME, project_id: P1, production_id: PR1, name: 'x', user_input: 'x', image_status: 'draft', updated_at: iso(9) }]
    tables.video_generation_sessions = [{ id: 'v1', user_id: ME, project_id: P1, production_id: PR1, working_prompt: 'v', updated_at: iso(11) }]
    tables.video_drafts = [1, 2].map((n) => ({ id: `e${n}`, user_id: ME, project_id: P1, production_id: PR1, name: `Edição ${n}`, updated_at: iso(8) }))
    tables.editorial_contents = [{ id: 'c1', user_id: ME, project_id: P1, production_id: PR1, title: 'Conteúdo', status: 'draft', updated_at: iso(7) }]
    await renderDashboard()
    expect(screen.getByTestId('production-counters').textContent).toBe('3 sessões de imagem · 1 sessão de vídeo · 2 edições de vídeo · 1 conteúdo')
    const stat = (id: string) => within(screen.getByTestId(id)).getByText(/^\d+$|—/).textContent
    expect(stat('stat-image-sessions')).toBe('3')
    expect(stat('stat-video-sessions')).toBe('1')
    expect(stat('stat-video-drafts')).toBe('2')
    expect(stat('stat-editorial')).toBe('1')
    // The legacy ImageDraft is not a Dashboard counter any more (its Session is the counted work).
    expect(screen.queryByText('Rascunhos de imagem')).toBeNull()
  })

  it('counts stay exact beyond the recent slice (more than 20 Sessions)', async () => {
    tables.image_generation_sessions = Array.from({ length: 57 }, (_, index) => session(`img-${index}`, { updated_at: iso(1 + (index % 25), index % 20) }))
    await renderDashboard()
    expect(screen.getByTestId('production-counters').textContent).toBe('57 sessões de imagem')
    expect(within(screen.getByTestId('stat-image-sessions')).getByText('57')).toBeTruthy()
  })

  it('shows only the signed-in user\'s work', async () => {
    tables.image_generation_sessions = [session('mine'), session('theirs', { user_id: OTHER, working_prompt: 'Sessão alheia' })]
    await renderDashboard()
    expect(screen.queryByText('Sessão alheia')).toBeNull()
    expect(screen.getAllByTestId('dashboard-work-item')).toHaveLength(1)
    expect(within(screen.getByTestId('stat-image-sessions')).getByText('1')).toBeTruthy()
  })

  it('a Production activity date reflects its Session work', async () => {
    tables.image_generation_sessions = [session('img-1', { updated_at: iso(21) })]
    await renderDashboard()
    const card = screen.getByRole('link', { name: /Continuar Production Campanha de outono/ }).closest('[data-slot="card"], div')!
    expect(card).toBeTruthy()
    expect(document.body.textContent).toContain('21 de out.')
  })
})

describe('Dashboard continuity - empty states and failures', () => {
  it('a new user sees the real empty state, no error banner and dashes-free zeros', async () => {
    tables = { projects: [], productions: [], image_drafts: [], video_drafts: [], editorial_contents: [], image_generation_sessions: [], video_generation_sessions: [], video_generations: [] }
    await renderDashboard()
    expect(screen.getByText('Comece criando um Project')).toBeTruthy()
    expect(screen.queryByText(/Não foi possível carregar todos os dados/)).toBeNull()
    expect(within(screen.getByTestId('stat-image-sessions')).getByText('0')).toBeTruthy()
  })

  it('a failing Session source shows the banner and an unknown ("—") count, not a false zero, and the rest still renders', async () => {
    tables.video_drafts = [{ id: 'edit-1', user_id: ME, project_id: P1, production_id: PR1, name: 'Teaser', updated_at: iso(12) }]
    failing = new Set(['image_generation_sessions'])
    await renderDashboard()
    expect(screen.getByText(/Não foi possível carregar todos os dados do Dashboard/)).toBeTruthy()
    expect(within(screen.getByTestId('stat-image-sessions')).getByText('—')).toBeTruthy()
    expect(within(screen.getByTestId('stat-video-drafts')).getByText('1')).toBeTruthy()
    expect(screen.getByText('Teaser')).toBeTruthy()
  })

  it('a partial Production count names the unavailable categories instead of looking complete', async () => {
    tables.video_drafts = [{ id: 'edit-1', user_id: ME, project_id: P1, production_id: PR1, name: 'Teaser', updated_at: iso(12) }]
    failing = new Set(['image_generation_sessions'])
    await renderDashboard()
    expect(screen.getByTestId('production-counters').textContent).toBe('1 edição de vídeo · sem contagem de: sessões de imagem')
  })

  it('an all-zero Production count names what is counted and does not deny legacy items that are still listed', async () => {
    // An old ImageDraft no Session carries and a standalone historical video generation: neither is in the counters.
    tables.image_drafts = [{ id: 'd-orphan', user_id: ME, project_id: P1, production_id: PR1, name: 'Rascunho órfão', user_input: 'x', image_status: 'draft', updated_at: iso(8) }]
    tables.video_generations = [{ id: 'g-old', user_id: ME, session_id: null, project_id: P1, production_id: PR1, status: 'succeeded', created_at: iso(7) }]
    await renderDashboard()
    const text = screen.getByTestId('production-counters').textContent ?? ''
    expect(text).not.toMatch(/nenhum item vinculado/i)
    expect(text).toContain('Sem sessões de imagem, sessões de vídeo, edições de vídeo ou conteúdos')
    expect(text).toContain('Rascunhos legados de imagem e gerações de vídeo avulsas não entram nesta contagem')
    // Preserved where it already was: the orphan legacy draft keeps its own card.
    expect(screen.getByText('Rascunho órfão')).toBeTruthy()
  })

  it('unreadable totals never produce a "you have no Projects" claim', async () => {
    tables = { projects: [], productions: [], image_drafts: [], video_drafts: [], editorial_contents: [], image_generation_sessions: [], video_generation_sessions: [], video_generations: [] }
    failing = new Set(['projects'])
    await renderDashboard()
    expect(screen.queryByText('Comece criando um Project')).toBeNull()
    expect(screen.queryByText('Nenhum Project criado')).toBeNull()
    expect(screen.getByText('Projects indisponíveis agora')).toBeTruthy()
    expect(screen.getByText(/Não foi possível carregar todos os dados do Dashboard/)).toBeTruthy()
  })

  it('redirects an anonymous visitor to /login before reading anything', async () => {
    user = null
    const { default: DashboardPage } = await import('@/app/(dashboard)/dashboard/page')
    await expect(DashboardPage()).rejects.toThrow('REDIRECT:/login')
  })
})
