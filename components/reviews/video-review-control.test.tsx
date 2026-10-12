// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { VideoReviewHistoryItem } from '@/lib/reviews/video-review-dto'
import { VideoReviewControl } from './video-review-control'

// VIDEO_REVIEW_UI_AND_HISTORY_V1 — the Review control, its states, request-id semantics and error UX.
// Every request is a mocked fetch: no server, storage or provider is contacted (0 paid calls).

const toast = vi.fn()
const push = vi.fn()
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
// A short poll interval keeps the polling test on real timers.
vi.mock('@/lib/reviews/video-review-presentation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/reviews/video-review-presentation')>()),
  VIDEO_REVIEW_POLL_MS: 40,
}))

const SOURCE = { kind: 'video_generation', id: '00000000-0000-4000-8000-000000000001' } as const
const fetchMock = vi.fn()
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

function item(overrides: Partial<VideoReviewHistoryItem> = {}, index = 1): VideoReviewHistoryItem {
  return {
    id: `10000000-0000-4000-8000-00000000000${index}`,
    status: 'completed',
    createdAt: '2026-10-07T08:05:00.000Z',
    completedAt: '2026-10-07T08:05:13.000Z',
    evaluator: { provider: 'gemini', model: 'gemini-3.5-flash' },
    result: {
      overall: { score: 70, assessment: 'mixed' },
      summary: 'Um vídeo estático de 3 segundos com texto de teste.',
      criteria: [
        { key: 'visual_consistency', label: 'Consistência visual', score: 90, assessment: 'strong', evidence: ['Fundo e texto estáveis.'], applicable: true },
        { key: 'pacing', label: 'Ritmo', score: 50, assessment: 'mixed', evidence: ['Sem movimento.'], applicable: true },
        { key: 'prompt_adherence', label: 'Aderência ao prompt', score: 0, assessment: 'insufficient_evidence', evidence: [], applicable: false },
        { key: 'text_caption_legibility', label: 'Legibilidade do texto', score: 0, assessment: 'insufficient_evidence', evidence: ['Pouco texto para julgar.'], applicable: true },
      ],
      strengths: ['Cores alinhadas à marca'],
      issues: ['O vídeo é totalmente estático'],
      recommendations: ['Animar o texto'],
      refinedPrompt: 'A calm sunrise, slower pan '.repeat(8),
      analyzed: 'visual_only',
    },
    failure: null,
    ...overrides,
  }
}

const inFlight = (status: 'pending' | 'running', createdAt = new Date().toISOString()): VideoReviewHistoryItem =>
  item({ status, result: null, completedAt: null, createdAt, id: '20000000-0000-4000-8000-000000000002' })

const failed = (): VideoReviewHistoryItem =>
  item({ status: 'failed', result: null, failure: { code: 'provider_timeout', message: 'Review provider timed out.' }, id: '30000000-0000-4000-8000-000000000003' })

type Server = {
  items: VideoReviewHistoryItem[]
  gemini: 'configured' | 'missing' | 'down'
  post: (body: any) => Response | Promise<Response>
  posts: any[]
  gets: number
}

let server: Server

function install() {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const target = String(url)
    if (target.startsWith('/api/reviews/video?')) { server.gets += 1; return json({ items: server.items }) }
    if (target === '/api/settings/providers') {
      return server.gemini === 'down' ? json({}, 500) : json({ providers: { gemini: { status: server.gemini } } })
    }
    if (target === '/api/reviews/video' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body))
      server.posts.push(body)
      return server.post(body)
    }
    throw new Error(`unexpected request ${init?.method ?? 'GET'} ${target}`)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  server = { items: [], gemini: 'configured', posts: [], gets: 0, post: () => json({ review: { id: 'x', status: 'completed' }, replayed: false }, 201) }
  install()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function openPanel() {
  render(<VideoReviewControl source={SOURCE} />)
  fireEvent.click(screen.getByTestId('video-review-open'))
  return screen.findByTestId('video-review-panel')
}
const writes = () => fetchMock.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET')

describe('opening the panel is read-only', () => {
  it('makes no request until opened, then reads history and credential status with GETs only', async () => {
    render(<VideoReviewControl source={SOURCE} />)
    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('video-review-open'))
    await screen.findByText('Nenhuma revisão ainda')
    expect(fetchMock.mock.calls.map(([url]) => String(url)).sort()).toEqual([
      `/api/reviews/video?kind=video_generation&id=${SOURCE.id}`,
      '/api/settings/providers',
    ])
    expect(writes()).toHaveLength(0)
    // No provider or model selector exists.
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('shows the empty state truthfully and offers the first Review', async () => {
    await openPanel()
    await screen.findByText('Nenhuma revisão ainda')
    expect(screen.getByTestId('video-review-run').textContent).toContain('Revisar vídeo')
  })

  it('reports a history load failure with a retry instead of pretending it is empty', async () => {
    fetchMock.mockImplementation(async (url: string) => (String(url).startsWith('/api/reviews/video?') ? json({}, 500) : json({ providers: { gemini: { status: 'configured' } } })))
    await openPanel()
    await screen.findByText('Não foi possível carregar o histórico')
    expect(screen.queryByText('Nenhuma revisão ainda')).toBeNull()
  })
})

describe('result presentation', () => {
  it('renders a completed Review without raw JSON: score, assessment, summary, criteria, lists and position', async () => {
    server.items = [item()]
    await openPanel()
    const result = await screen.findByTestId('review-item-10000000-0000-4000-8000-000000000001')
    expect(within(result).getByTestId('review-score').textContent).toContain('70')
    expect(within(result).getByTestId('review-assessment').textContent).toBe('Misto')
    expect(within(result).getByTestId('review-summary').textContent).toContain('vídeo estático')
    expect(within(result).getByTestId('review-position').textContent).toContain('Revisão 1 de 1')
    expect(within(result).getByTestId('review-evaluator').textContent).toBe('Gemini · gemini-3.5-flash')
    expect(within(result).getByTestId('review-strengths').textContent).toContain('Cores alinhadas')
    expect(within(result).getByTestId('review-issues').textContent).toContain('estático')
    expect(within(result).getByTestId('review-recommendations').textContent).toContain('Animar o texto')
    expect(result.textContent).not.toMatch(/[{}]\s*"|schemaVersion|adapterResult/)
  })

  it('shows not-applicable and insufficient-evidence criteria as such, never as a failure', async () => {
    server.items = [item()]
    await openPanel()
    expect((await screen.findByTestId('review-criterion-prompt_adherence-state')).textContent).toBe('Não se aplica')
    expect(screen.getByTestId('review-criterion-text_caption_legibility-state').textContent).toBe('Evidência insuficiente')
    expect(screen.getByTestId('review-criterion-visual_consistency-state').textContent).toContain('90/100')
    // A not-applicable criterion shows no score or evidence, and nothing on the card says "Falhou".
    expect(screen.getByTestId('review-criterion-prompt_adherence').textContent).not.toMatch(/\/100/)
    expect(screen.queryByText('Falhou')).toBeNull()
  })

  it('is visual-only: it says audio was not evaluated and never claims otherwise', async () => {
    server.items = [item()]
    await openPanel()
    const note = (await screen.findByTestId('review-visual-only')).textContent ?? ''
    expect(note).toContain('somente visual')
    expect(note).toContain('não foi avaliado')
    const panel = screen.getByTestId('video-review-panel').textContent ?? ''
    expect(panel).not.toMatch(/áudio (foi|foram) (analisad|avaliad)/i)
    expect(panel).not.toMatch(/narração|trilha sonora|música/i)
  })

  it('shows the refined prompt as a display-only suggestion: no action adopts it and nothing is requested', async () => {
    server.items = [item()]
    await openPanel()
    const box = await screen.findByTestId('review-refined-prompt')
    expect(box.textContent).toContain('Sugestão de prompt')
    expect(box.textContent).toContain('apenas uma sugestão')
    expect(box.textContent).toContain('A calm sunrise')
    expect(within(box).queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /usar|aplicar|adotar/i })).toBeNull()
    expect(writes()).toHaveLength(0)
  })

  it('hides the suggestion block when there is none', async () => {
    const base = item()
    server.items = [item({ result: { ...base.result!, refinedPrompt: null } })]
    await openPanel()
    await screen.findByTestId('review-summary')
    expect(screen.queryByTestId('review-refined-prompt')).toBeNull()
  })

  it('wraps long unbroken text instead of overflowing', async () => {
    const long = 'x'.repeat(400)
    const base = item()
    server.items = [item({ result: { ...base.result!, summary: long, refinedPrompt: long, issues: [long] } })]
    await openPanel()
    expect((await screen.findByTestId('review-summary')).className).toContain('break-words')
    expect(within(screen.getByTestId('review-refined-prompt')).getByText(long).className).toContain('break-words')
    expect(within(screen.getByTestId('review-issues')).getByText(long).className).toContain('break-words')
    const panel = screen.getByTestId('video-review-panel')
    expect(panel.className).toContain('overflow-y-auto')
    // jsdom has no layout, so the guards against a long word widening the grid column are asserted structurally;
    // the real overflow measurement is recorded in the Preview/harness smoke.
    expect(panel.className).toContain('grid-cols-[minmax(0,1fr)]')
    expect(panel.className).toContain('[overflow-wrap:anywhere]')
  })

  it('lists previous Reviews newest first with the newest expanded and older ones collapsed', async () => {
    const newest = item({ createdAt: '2026-10-07T10:00:00Z', completedAt: '2026-10-07T10:00:09Z' }, 3)
    const older = item({ createdAt: '2026-10-06T10:00:00Z', completedAt: '2026-10-06T10:00:09Z' }, 2)
    const oldest = failed()
    server.items = [newest, older, oldest]
    await openPanel()
    const history = await screen.findByTestId('video-review-history')
    expect(within(history).getByTestId(`review-item-${newest.id}`).closest('details')).toBeNull()
    expect(history.querySelectorAll('details')).toHaveLength(2)
    expect(within(history).getAllByTestId('review-position').map((el) => el.textContent?.slice(0, 14))).toEqual(['Revisão 3 de 3', 'Revisão 2 de 3', 'Revisão 1 de 3'])
  })
})

describe('explicit refined prompt action', () => {
  it.each(['latest', 'older'] as const)('uses the %s Review only on a click, keeps history immutable and sends no requests', async (selection) => {
    const base = item()
    const latest = item({ result: { ...base.result!, refinedPrompt: '  Latest prompt\nwith motion  ' } }, 2)
    const older = item({ result: { ...base.result!, refinedPrompt: '\n  Older prompt\nwith pacing \t' } })
    server.items = [latest, older]
    const originalHistory = JSON.stringify(server.items)
    const onUseRefinedPrompt = vi.fn()
    render(<VideoReviewControl source={SOURCE} onUseRefinedPrompt={onUseRefinedPrompt} />)
    expect(onUseRefinedPrompt).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('video-review-open'))
    await screen.findByTestId(`review-item-${latest.id}`)
    expect(onUseRefinedPrompt).not.toHaveBeenCalled()
    if (selection === 'older') {
      fireEvent.click(within(screen.getByTestId(`video-review-older-${older.id}`)).getByText(/Revisão 1 ·/))
    }
    const selected = selection === 'latest' ? latest : older
    const result = screen.getByTestId(`review-item-${selected.id}`)
    expect(within(result).getByTestId('review-visual-only').textContent).toContain('o áudio do vídeo não foi avaliado')
    const requestsBeforeApply = fetchMock.mock.calls.length
    fireEvent.click(within(result).getByRole('button', { name: 'Usar prompt refinado' }))
    expect(onUseRefinedPrompt).toHaveBeenCalledExactlyOnceWith(selected.result!.refinedPrompt!.trim())
    expect(screen.queryByTestId('video-review-panel')).toBeNull()
    expect(JSON.stringify(server.items)).toBe(originalHistory)
    expect(fetchMock).toHaveBeenCalledTimes(requestsBeforeApply)
    expect(writes()).toHaveLength(0)
    // Reopening still displays the original stored suggestions.
    fireEvent.click(screen.getByTestId('video-review-open'))
    await screen.findByTestId(`review-item-${latest.id}`)
    expect(screen.getByTestId(`review-item-${selected.id}`).textContent).toContain(selected.result!.refinedPrompt!)
    expect(onUseRefinedPrompt).toHaveBeenCalledTimes(1)
  })

  it.each([null, '', ' \n\t '])('offers no action for an absent or empty prompt (%j)', async (refinedPrompt) => {
    const base = item()
    server.items = [item({ result: { ...base.result!, refinedPrompt } })]
    const onUseRefinedPrompt = vi.fn()
    render(<VideoReviewControl source={SOURCE} onUseRefinedPrompt={onUseRefinedPrompt} />)
    fireEvent.click(screen.getByTestId('video-review-open'))
    await screen.findByTestId('review-summary')
    expect(screen.queryByRole('button', { name: 'Usar prompt refinado' })).toBeNull()
    expect(screen.queryByTestId('review-refined-prompt')).toBeNull()
    expect(onUseRefinedPrompt).not.toHaveBeenCalled()
    expect(writes()).toHaveLength(0)
  })

  it.each(['failed', 'pending', 'running'] as const)('offers no action for a %s Review, even with a stored prompt', async (status) => {
    server.items = [item({ status, createdAt: new Date().toISOString() })]
    const onUseRefinedPrompt = vi.fn()
    render(<VideoReviewControl source={SOURCE} onUseRefinedPrompt={onUseRefinedPrompt} />)
    fireEvent.click(screen.getByTestId('video-review-open'))
    await screen.findByTestId(`review-item-${server.items[0].id}`)
    expect(screen.queryByRole('button', { name: 'Usar prompt refinado' })).toBeNull()
    expect(onUseRefinedPrompt).not.toHaveBeenCalled()
    expect(writes()).toHaveLength(0)
  })

  it('keeps the action disabled while the workspace is busy and enables it when idle', async () => {
    server.items = [item()]
    const onUseRefinedPrompt = vi.fn()
    const { rerender } = render(<VideoReviewControl source={SOURCE} onUseRefinedPrompt={onUseRefinedPrompt} refinedPromptDisabled />)
    fireEvent.click(screen.getByTestId('video-review-open'))
    const action = await screen.findByRole('button', { name: 'Usar prompt refinado' })
    const requests = fetchMock.mock.calls.length
    expect((action as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(action)
    expect(onUseRefinedPrompt).not.toHaveBeenCalled()
    expect(screen.getByTestId('video-review-panel')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(requests)
    rerender(<VideoReviewControl source={SOURCE} onUseRefinedPrompt={onUseRefinedPrompt} refinedPromptDisabled={false} />)
    expect((action as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(action)
    expect(onUseRefinedPrompt).toHaveBeenCalledExactlyOnceWith(server.items[0].result!.refinedPrompt!.trim())
    expect(writes()).toHaveLength(0)
  })

  it('disables applying completed history while another Review is in flight', async () => {
    server.items = [inFlight('running'), item()]
    const onUseRefinedPrompt = vi.fn()
    render(<VideoReviewControl source={SOURCE} onUseRefinedPrompt={onUseRefinedPrompt} />)
    fireEvent.click(screen.getByTestId('video-review-open'))
    await screen.findByTestId('video-review-history')
    fireEvent.click(within(screen.getByTestId(`video-review-older-${server.items[1].id}`)).getByText(/Revisão 1 ·/))
    const action = screen.getByRole('button', { name: 'Usar prompt refinado' })
    expect((action as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(action)
    expect(onUseRefinedPrompt).not.toHaveBeenCalled()
    expect(writes()).toHaveLength(0)
  })
})

describe('Review states', () => {
  it('a Review recovered as stale (execution_stale) reads as an interruption and allows a new Review', async () => {
    server.items = [item({ status: 'failed', result: null, failure: { code: 'execution_stale', message: 'The previous Review execution was interrupted and did not complete.' }, id: '40000000-0000-4000-8000-000000000004' })]
    await openPanel()
    const text = (await screen.findByTestId('review-failure')).textContent ?? ''
    expect(text).toContain('interrompida')
    expect(text).not.toMatch(/Gemini/)
    expect((screen.getByTestId('video-review-run') as HTMLButtonElement).disabled).toBe(false)
  })

  it('failed: explains the failure and allows a new Review', async () => {
    server.items = [failed()]
    await openPanel()
    expect((await screen.findByTestId('review-failure')).textContent).toContain('demorou demais')
    const run = screen.getByTestId('video-review-run') as HTMLButtonElement
    expect(run.disabled).toBe(false)
    expect(run.textContent).toContain('Revisar vídeo')
  })

  it.each(['pending', 'running'] as const)('%s: disables duplicate submission and says it is in progress', async (status) => {
    server.items = [inFlight(status)]
    await openPanel()
    await screen.findByTestId('video-review-in-progress')
    const run = screen.getByTestId('video-review-run') as HTMLButtonElement
    expect(run.disabled).toBe(true)
    expect(run.textContent).toContain('Revisão em andamento')
    fireEvent.click(run)
    expect(server.posts).toHaveLength(0)
  })

  it('an in-flight Review older than the stale policy (30 minutes) is called out as possibly interrupted, and polling stops', async () => {
    server.items = [inFlight('running', new Date(Date.now() - 45 * 60_000).toISOString())]
    await openPanel()
    const note = (await screen.findByTestId('review-stale-note')).textContent ?? ''
    expect(note).toContain('pode ter sido interrompida')
    expect(note).toContain('30 minutos')
    expect((screen.getByTestId('video-review-run') as HTMLButtonElement).disabled).toBe(false)
    const gets = server.gets
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(server.gets).toBe(gets)
  })

  it('refreshes an in-flight Review slowly until it completes, then offers a re-review', async () => {
    server.items = [inFlight('running')]
    await openPanel()
    await screen.findByTestId('video-review-in-progress')
    server.items = [item()]
    await screen.findByTestId('review-score', undefined, { timeout: 2000 })
    await waitFor(() => expect(screen.getByTestId('video-review-run').textContent).toContain('Revisar novamente'))
    expect(server.posts).toHaveLength(0)
  })
})

describe('running a Review', () => {
  it('sends ONLY the typed source and a UUID clientRequestId, then shows the new result', async () => {
    await openPanel()
    await screen.findByText('Nenhuma revisão ainda')
    server.post = () => { server.items = [item()]; return json({ review: { id: 'x', status: 'completed' }, replayed: false }, 201) }
    fireEvent.click(screen.getByTestId('video-review-run'))
    await screen.findByTestId('review-score')
    expect(server.posts).toHaveLength(1)
    expect(Object.keys(server.posts[0]).sort()).toEqual(['clientRequestId', 'source'])
    expect(server.posts[0].source).toEqual(SOURCE)
    expect(server.posts[0].clientRequestId).toMatch(UUID)
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Revisão concluída' }))
  })

  it('a double click is one execution, not two', async () => {
    await openPanel()
    await screen.findByText('Nenhuma revisão ainda')
    let release!: () => void
    server.post = () => new Promise<Response>((resolve) => { release = () => resolve(json({ review: { id: 'x', status: 'completed' } }, 201)) })
    const run = screen.getByTestId('video-review-run')
    fireEvent.click(run)
    fireEvent.click(run)
    fireEvent.click(run)
    await waitFor(() => expect(server.posts).toHaveLength(1))
    expect((screen.getByTestId('video-review-run') as HTMLButtonElement).disabled).toBe(true)
    release()
    await waitFor(() => expect((screen.getByTestId('video-review-run') as HTMLButtonElement).disabled).toBe(false))
    expect(server.posts).toHaveLength(1)
  })

  it('an intentional "Revisar novamente" uses a brand-new clientRequestId', async () => {
    server.items = [item()]
    await openPanel()
    await waitFor(() => expect(screen.getByTestId('video-review-run').textContent).toContain('Revisar novamente'))
    fireEvent.click(screen.getByTestId('video-review-run'))
    await waitFor(() => expect(server.posts).toHaveLength(1))
    await waitFor(() => expect((screen.getByTestId('video-review-run') as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByTestId('video-review-run'))
    await waitFor(() => expect(server.posts).toHaveLength(2))
    expect(server.posts[0].clientRequestId).toMatch(UUID)
    expect(server.posts[1].clientRequestId).toMatch(UUID)
    expect(server.posts[1].clientRequestId).not.toBe(server.posts[0].clientRequestId)
    // Never the id of an existing Review either.
    expect([server.posts[0].clientRequestId, server.posts[1].clientRequestId]).not.toContain(item().id)
  })

  it('keeps the id after a dropped connection (outcome unknown, a retry replays) and rotates it after a definitive answer', async () => {
    await openPanel()
    await screen.findByText('Nenhuma revisão ainda')
    const answers: Array<() => Response> = [() => { throw new TypeError('network') }, () => json({ error: 'x', code: 'REVIEW_PROVIDER_ERROR' }, 502), () => json({ review: { id: 'x' } }, 201)]
    server.post = () => answers.shift()!()
    const click = async (count: number) => {
      fireEvent.click(screen.getByTestId('video-review-run'))
      await waitFor(() => expect(server.posts).toHaveLength(count))
      await waitFor(() => expect((screen.getByTestId('video-review-run') as HTMLButtonElement).disabled).toBe(false))
    }
    await click(1)
    expect(screen.getByText('Falha de conexão')).toBeTruthy()
    await click(2)
    expect(server.posts[1].clientRequestId).toBe(server.posts[0].clientRequestId)
    await click(3)
    expect(server.posts[2].clientRequestId).not.toBe(server.posts[1].clientRequestId)
  })
})

describe('error UX', () => {
  async function failWith(status: number, body: Record<string, unknown>) {
    await openPanel()
    await screen.findByText('Nenhuma revisão ainda')
    server.post = () => json(body, status)
    fireEvent.click(screen.getByTestId('video-review-run'))
    await waitFor(() => expect(server.posts).toHaveLength(1))
  }

  it('409 REVIEW_IN_PROGRESS becomes a controlled notice and the history is refreshed', async () => {
    await openPanel()
    await screen.findByText('Nenhuma revisão ainda')
    const before = server.gets
    server.post = () => { server.items = [inFlight('running')]; return json({ error: 'x', code: 'REVIEW_IN_PROGRESS', reviewId: 'r' }, 409) }
    fireEvent.click(screen.getByTestId('video-review-run'))
    await screen.findByText('Já existe uma revisão em andamento para este vídeo. Aguarde a conclusão.')
    await waitFor(() => expect(server.gets).toBeGreaterThan(before))
    await screen.findByTestId('video-review-in-progress')
    expect((screen.getByTestId('video-review-run') as HTMLButtonElement).disabled).toBe(true)
  })

  it('a missing Gemini key (known before any request) explains Configurações → API, offers navigation and sends nothing', async () => {
    server.gemini = 'missing'
    await openPanel()
    const message = await screen.findByText(/A API do Google Gemini precisa estar configurada em Configurações → API/)
    expect(message).toBeTruthy()
    expect(screen.queryByTestId('video-review-run')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir Configurações' }))
    expect(push).toHaveBeenCalledWith('/configuracoes?tab=api')
    expect(server.posts).toHaveLength(0)
  })

  it('a missing Gemini key reported by the server (status unknown beforehand) gets the same controlled UX', async () => {
    server.gemini = 'down'
    await failWith(422, { error: 'Video evaluator provider is not configured.', code: 'REVIEW_PROVIDER_NOT_CONFIGURED', reviewId: 'r' })
    await screen.findByText(/Configurações → API/)
    expect(screen.queryByText('Não foi possível concluir a revisão')).toBeNull()
    expect(screen.getByRole('button', { name: 'Abrir Configurações' })).toBeTruthy()
  })

  it('422 media guardrails are specific, not one generic error', async () => {
    await failWith(422, { error: 'Video exceeds the Review size limit (500 MB).', code: 'REVIEW_PROVIDER_UNSUPPORTED' })
    await screen.findByText('O vídeo excede o limite de tamanho da revisão (500 MB).')
    expect(screen.queryByText('Erro ao revisar vídeo')).toBeNull()
  })

  it.each([
    [404, 'REVIEW_SUBJECT_NOT_FOUND', 'Vídeo não encontrado'],
    [422, 'REVIEW_OUTPUT_UNAVAILABLE', 'Vídeo indisponível'],
    [502, 'REVIEW_INVALID_EVALUATOR_RESPONSE', 'Resposta inválida do Gemini'],
    [502, 'REVIEW_PROVIDER_ERROR', 'O Gemini não concluiu a revisão'],
    [503, 'REVIEW_STORE_UNAVAILABLE', 'Serviço de revisão indisponível'],
    [504, 'REVIEW_PROVIDER_TIMEOUT', 'O Gemini demorou demais'],
    [401, 'UNAUTHORIZED', 'Sessão expirada'],
  ])('%i %s is explained as "%s" and the run button stays usable', async (status, code, title) => {
    await failWith(status, { error: 'raw server text users/abc AIza-secret', code })
    await screen.findByText(title)
    expect(screen.getByTestId('video-review-panel').textContent).not.toMatch(/users\/abc|AIza|raw server text/)
    expect((screen.getByTestId('video-review-run') as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('what the browser sends', () => {
  it('never sends a URL, key, MIME, size, duration, provider, model, credential or artifact id', async () => {
    await openPanel()
    await screen.findByText('Nenhuma revisão ainda')
    fireEvent.click(screen.getByTestId('video-review-run'))
    await waitFor(() => expect(server.posts).toHaveLength(1))
    const text = JSON.stringify(server.posts[0])
    expect(text).not.toMatch(/url|storage|bucket|mime|size|duration|provider|model|apiKey|credential|artifact/i)
  })
})
