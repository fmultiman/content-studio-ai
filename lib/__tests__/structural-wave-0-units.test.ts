import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildVideoDraftHubCards, resolveDraftHubCreateContext } from '@/lib/draft-hub'
import {
  describeBlockedConnection,
  isEnvironmentBlockedReason,
  summarizeVideoConnections,
  videoProviderPhrases,
} from '@/lib/video-generation/connection-presentation'
import { describeGeminiConnection, describeRestConnection } from '@/lib/video-generation/connections'
import { describeGenerationNotReady } from '@/lib/video-generation/status-refresh'
import {
  NO_ATTEMPTS_STATUS,
  VIDEO_DRAFT_HUB_STATUS,
  VIDEO_GENERATION_STATUSES,
  describeGenerationStatus,
  sessionHubStatus,
  videoHubStatusFilterOptions,
} from '@/lib/video-generation/status-presentation'
import { DEFAULT_SETTINGS_TAB, SETTINGS_TABS, resolveSettingsTab } from '@/components/settings/settings-tabs'

// STRUCTURAL_WAVE_0 - D4 / D5 / D9 / D22 pure rules.

describe('D9 - video generation status presentation (pt-BR labels; stored values untouched)', () => {
  it('covers every status the database allows, with the labels the product uses', () => {
    expect(VIDEO_GENERATION_STATUSES.map((status) => describeGenerationStatus(status).label)).toEqual([
      'Na fila', 'Enviado', 'Processando', 'Concluído', 'Falhou',
    ])
    expect(describeGenerationStatus('queued')).toEqual({ label: 'Na fila', tone: 'neutral' })
    expect(describeGenerationStatus('submitted')).toEqual({ label: 'Enviado', tone: 'info' })
    expect(describeGenerationStatus('processing')).toEqual({ label: 'Processando', tone: 'warning' })
    expect(describeGenerationStatus('succeeded')).toEqual({ label: 'Concluído', tone: 'success' })
    expect(describeGenerationStatus('failed')).toEqual({ label: 'Falhou', tone: 'danger' })
  })

  it('the status list IS the database CHECK constraint (a new state cannot be added without a label)', () => {
    const sql = readFileSync(join(process.cwd(), 'scripts/039_create_video_generations.sql'), 'utf8')
    const match = sql.match(/status TEXT NOT NULL DEFAULT 'queued' CHECK \(status IN \(([^)]*)\)\)/)
    expect(match).not.toBeNull()
    const allowed = match![1].split(',').map((entry) => entry.trim().replace(/'/g, ''))
    expect([...VIDEO_GENERATION_STATUSES]).toEqual(allowed)
  })

  it('the defensive "cancelled" state and the Session without Attempts read in Portuguese too', () => {
    expect(describeGenerationStatus('cancelled').label).toBe('Cancelado')
    expect(describeGenerationStatus(NO_ATTEMPTS_STATUS).label).toBe('Sem tentativas')
  })

  it('never hides an unknown value and never maps it to a known state; a missing one reads "Sem status"', () => {
    expect(describeGenerationStatus('reviewing')).toEqual({ label: 'reviewing', tone: 'neutral' })
    expect(describeGenerationStatus('constructor').label).toBe('constructor')
    expect(describeGenerationStatus('__proto__').label).toBe('__proto__')
    expect(describeGenerationStatus(null).label).toBe('Sem status')
    expect(describeGenerationStatus(undefined).label).toBe('Sem status')
    expect(describeGenerationStatus('  ').label).toBe('Sem status')
  })

  it('a Session card carries the STORED status of its latest Attempt, or "no_attempts"', () => {
    expect(sessionHubStatus({ status: 'processing' })).toBe('processing')
    expect(sessionHubStatus(null)).toBe(NO_ATTEMPTS_STATUS)
    expect(sessionHubStatus(undefined)).toBe(NO_ATTEMPTS_STATUS)
    expect(sessionHubStatus({ status: null })).toBe(NO_ATTEMPTS_STATUS)
  })

  it('the hub filter offers the draft state AND every real generation state (values are the stored ones)', () => {
    const options = videoHubStatusFilterOptions()
    expect(options).toEqual([
      { value: 'Rascunho', label: 'Rascunho' },
      { value: 'queued', label: 'Na fila' },
      { value: 'submitted', label: 'Enviado' },
      { value: 'processing', label: 'Processando' },
      { value: 'succeeded', label: 'Concluído' },
      { value: 'failed', label: 'Falhou' },
      { value: 'no_attempts', label: 'Sem tentativas' },
    ])
    expect(new Set(options.map((option) => option.value)).size).toBe(options.length)
  })

  it('the draft option value is exactly the status Creative Editor drafts carry in the hub (so drafts stay filterable)', () => {
    const cards = buildVideoDraftHubCards({
      drafts: [{ id: 'd1', project_id: 'p1', production_id: 'pr1', name: 'Draft', updated_at: '2026-10-01T00:00:00Z', scenes: [] } as never],
      projects: [{ id: 'p1', name: 'Project' }],
      productions: [{ id: 'pr1', project_id: 'p1', title: 'Production', intention: null, updated_at: '2026-10-01T00:00:00Z' } as never],
    })
    expect(cards).toHaveLength(1)
    expect(cards[0].status).toBe(VIDEO_DRAFT_HUB_STATUS)
    expect(videoHubStatusFilterOptions().some((option) => option.value === cards[0].status)).toBe(true)
  })
})

describe('D22 - provider-aware wording', () => {
  it('names the provider of the selected connection, in the grammatical form each message needs', () => {
    expect(videoProviderPhrases('kling')).toEqual({ name: 'Kling', to: 'à Kling', toward: 'para a Kling', subject: 'A Kling' })
    expect(videoProviderPhrases('gemini')).toEqual({ name: 'Google Veo', to: 'ao Google Veo', toward: 'para o Google Veo', subject: 'O Google Veo' })
  })

  it('no selection or an unknown provider is neutral - never "Kling"', () => {
    for (const provider of [null, undefined, '', 'openai', 'constructor', '__proto__']) {
      const phrases = videoProviderPhrases(provider)
      expect(phrases.name).toBe('provedor de vídeo')
      expect(`${phrases.to} ${phrases.toward} ${phrases.subject}`).not.toMatch(/Kling|Veo/)
    }
  })

  it('"Assistir" on a failed generation without a recorded reason names the provider that really ran it', () => {
    expect(describeGenerationNotReady({ status: 'failed', provider: 'gemini', error_details: null }).description).toBe('O Google Veo não concluiu esta geração.')
    expect(describeGenerationNotReady({ status: 'failed', provider: 'kling', error_details: null }).description).toBe('A Kling não concluiu esta geração.')
    // A row from before Google Veo existed has no provider: it is a Kling row.
    expect(describeGenerationNotReady({ status: 'failed', error_details: null }).description).toBe('A Kling não concluiu esta geração.')
  })

  it('a recorded reason always wins, and a pending generation is still just "Aguardando"', () => {
    expect(describeGenerationNotReady({ status: 'failed', provider: 'gemini', error_details: { message: 'Cota excedida' } }).description).toBe('Cota excedida')
    expect(describeGenerationNotReady({ status: 'processing', provider: 'gemini' })).toEqual({ title: 'Aguardando', description: 'O vídeo ainda não está pronto.' })
  })
})

describe('D22 - summary of the connection descriptors (hub notice)', () => {
  const base = { label: 'Minha conta Kling', accountLabel: 'Pro', status: 'connected' as const, canGenerate: false }
  const rest = describeRestConnection('configured')
  const restMissing = describeRestConnection('missing')
  const veoOk = describeGeminiConnection('configured', true)
  const veoMissing = describeGeminiConnection('missing', true)

  it('available as soon as ONE connection can generate (Kling API, Google Veo or a Kling MCP account)', () => {
    expect(summarizeVideoConnections([rest, veoMissing])).toEqual({ kind: 'available' })
    expect(summarizeVideoConnections([restMissing, veoOk])).toEqual({ kind: 'available' })
    expect(summarizeVideoConnections([restMissing, veoMissing, { ...base, canGenerate: true }])).toEqual({ kind: 'available' })
    // A blocked connection never hides a usable one.
    expect(summarizeVideoConnections([{ ...base, blockedReason: 'connection_error', status: 'error' }, rest])).toEqual({ kind: 'available' })
  })

  it('none: no connection exists, or every descriptor is "not configured"', () => {
    expect(summarizeVideoConnections([])).toEqual({ kind: 'none' })
    expect(summarizeVideoConnections([restMissing, veoMissing])).toEqual({ kind: 'none' })
  })

  it('blocked: a connection exists but cannot generate - carrying the descriptor\'s own reason, not a verdict of "none"', () => {
    const summary = summarizeVideoConnections([restMissing, veoMissing, { ...base, blockedReason: 'generation_authorization_required' }])
    expect(summary).toEqual({ kind: 'blocked', blocked: [{ name: 'Minha conta Kling — Pro', reason: 'generation_authorization_required' }] })
    expect(summarizeVideoConnections([restMissing, describeGeminiConnection('configured', false)])).toEqual({
      kind: 'blocked', blocked: [{ name: 'Google Veo', reason: 'feature_disabled' }],
    })
  })

  it('every blocked reason the server can produce has a sentence, and none of them invents a reason', () => {
    const reasons = [
      'authorization_required', 'connection_error', 'generation_authorization_required', 'capabilities_missing',
      'capabilities_expired', 'no_supported_models', 'feature_disabled', 'canary_restricted',
    ] as const
    for (const reason of reasons) {
      const sentence = describeBlockedConnection({ name: 'Conexão X', reason })
      expect(sentence.startsWith('Conexão X ')).toBe(true)
      expect(sentence).not.toContain('não está disponível para gerar agora')
    }
    expect(describeBlockedConnection({ name: 'Conexão X', reason: null })).toBe('Conexão X não está disponível para gerar agora.')
  })

  it('only release-level reasons are outside the user\'s reach', () => {
    expect(isEnvironmentBlockedReason('feature_disabled')).toBe(true)
    expect(isEnvironmentBlockedReason('canary_restricted')).toBe(true)
    for (const reason of ['authorization_required', 'connection_error', 'generation_authorization_required', 'capabilities_missing', 'capabilities_expired', 'no_supported_models', null] as const) {
      expect(isEnvironmentBlockedReason(reason)).toBe(false)
    }
  })
})

describe('D4 - /imagens creation context from ?project=&production=', () => {
  const projects = [{ id: 'p1', name: 'Alpha' }, { id: 'p2', name: 'Beta' }]
  const productions = [
    { id: 'pr1', project_id: 'p1', title: 'Alpha 1', intention: null, updated_at: '2026-10-01T00:00:00Z' },
    { id: 'pr2', project_id: 'p2', title: 'Beta 1', intention: null, updated_at: '2026-10-01T00:00:00Z' },
  ] as never[]
  const resolve = (requestedProjectId: string | null, requestedProductionId: string | null, lists = { projects, productions }) =>
    resolveDraftHubCreateContext({ requestedProjectId, requestedProductionId, ...lists })

  it('selects a valid Project together with a Production that belongs to it', () => {
    expect(resolve('p1', 'pr1')).toEqual({ projectId: 'p1', productionId: 'pr1' })
  })

  it('a Production of ANOTHER Project is never selected (relationship is validated); the Project alone is kept', () => {
    expect(resolve('p1', 'pr2')).toEqual({ projectId: 'p1', productionId: '' })
  })

  it('a valid Production alone brings its own Project', () => {
    expect(resolve(null, 'pr2')).toEqual({ projectId: 'p2', productionId: 'pr2' })
  })

  it('an identifier the user cannot read (not in the loaded lists) selects nothing', () => {
    expect(resolve('foreign', 'pr1')).toEqual({ projectId: '', productionId: '' })
    expect(resolve('foreign', 'foreign-production')).toEqual({ projectId: '', productionId: '' })
    expect(resolve(null, 'foreign-production')).toEqual({ projectId: '', productionId: '' })
    expect(resolve('p1', 'pr1', { projects: [], productions: [] })).toEqual({ projectId: '', productionId: '' })
  })

  it('no parameters, empty strings and prototype keys select nothing', () => {
    expect(resolve(null, null)).toEqual({ projectId: '', productionId: '' })
    expect(resolve('', '')).toEqual({ projectId: '', productionId: '' })
    expect(resolve('constructor', '__proto__')).toEqual({ projectId: '', productionId: '' })
  })
})

describe('D5 - /configuracoes?tab= deep link', () => {
  it('honours every real tab value, including the API tab the credential CTAs use', () => {
    for (const tab of SETTINGS_TABS) expect(resolveSettingsTab(tab.value)).toBe(tab.value)
    expect(resolveSettingsTab('api')).toBe('api')
  })

  it('falls back to the default tab for anything else - no error, no blank panel', () => {
    expect(DEFAULT_SETTINGS_TAB).toBe('profile')
    for (const value of [null, undefined, '', 'API', ' api', 'api ', 'apis', 'unknown', 'constructor', '__proto__', 'toString', '../api', 'api&tab=usage']) {
      expect(resolveSettingsTab(value)).toBe('profile')
    }
  })
})

describe('D5 - every AI-credential CTA opens the API tab', () => {
  const files = [
    'app/(dashboard)/imagens/page.tsx',
    'app/(dashboard)/videos/page.tsx',
    'components/reviews/video-review-control.tsx',
    'components/prompts/prompt-language-panel.tsx',
    'components/videos/create-video-generation-dialog.tsx',
  ]
  for (const file of files) {
    it(`${file}: no link to bare /configuracoes`, () => {
      const source = readFileSync(join(process.cwd(), file), 'utf8')
      const targets = source.match(/['"`]\/configuracoes[^'"`]*['"`]/g) ?? []
      expect(targets.length).toBeGreaterThan(0)
      for (const target of targets) expect(target, target).toContain('?tab=api')
    })
  }
})
