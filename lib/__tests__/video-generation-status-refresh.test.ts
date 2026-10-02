import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  describeGenerationNotReady,
  isInFlightGeneration,
  isSchedulerStalled,
  RECOVERY_SYNC_MIN_INTERVAL_MS,
  SCHEDULER_STALL_MS,
  selectRecoverySyncs,
  STATUS_REFRESH_MS,
} from '@/lib/video-generation/status-refresh'
import { POLL_LEASE_MS } from '@/lib/video-generation/polling'

// VIDEO_GENERATION_POLLING_LATENCY_V1 — the browser refreshes status from OUR
// database; it asks the provider only when the scheduler is not serving a row.

const NOW = Date.parse('2026-09-29T12:00:00.000Z')
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString()
const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'gen-1',
  status: 'processing',
  transport: 'mcp',
  task_id: 'task-1',
  next_poll_at: at(5_000),
  ...overrides,
})

describe('status refresh cadence', () => {
  it('refreshes status every 10 s — well inside the previous 30 s — from the database', () => {
    expect(STATUS_REFRESH_MS).toBe(10_000)
  })

  it('the stall threshold is far above a normal scheduling lag (a 10 s wake plus a poll) and above any single step', () => {
    expect(SCHEDULER_STALL_MS).toBeGreaterThanOrEqual(2 * 60_000)
    expect(SCHEDULER_STALL_MS).toBeGreaterThanOrEqual(10 * STATUS_REFRESH_MS)
    // While a row is being checked its lease puts next_poll_at 3 minutes AHEAD, so it is never "overdue" mid-check.
    expect(POLL_LEASE_MS).toBeGreaterThan(0)
  })
})

describe('isInFlightGeneration', () => {
  it.each(['queued', 'submitted', 'processing'])('%s keeps the refresh running', (status) => {
    expect(isInFlightGeneration({ status })).toBe(true)
  })
  it.each(['succeeded', 'failed', undefined, null, ''])('%s stops it', (status) => {
    expect(isInFlightGeneration({ status: status as any })).toBe(false)
  })
})

describe('isSchedulerStalled — provider sync is recovery only', () => {
  it('a row scheduled in the future, due just now, or overdue by less than the threshold is NOT stalled (no provider call from the browser)', () => {
    expect(isSchedulerStalled(row({ next_poll_at: at(5_000) }), NOW)).toBe(false)
    expect(isSchedulerStalled(row({ next_poll_at: at(-1_000) }), NOW)).toBe(false)
    expect(isSchedulerStalled(row({ next_poll_at: at(-SCHEDULER_STALL_MS) }), NOW)).toBe(false)
  })

  it('a row whose scheduled check is overdue beyond the threshold IS stalled', () => {
    expect(isSchedulerStalled(row({ next_poll_at: at(-SCHEDULER_STALL_MS - 1) }), NOW)).toBe(true)
  })

  it.each([
    ['a REST generation (completes by callback)', { transport: 'rest' }],
    ['a legacy row without transport', { transport: null }],
    ['a row without a provider task', { task_id: null }],
    ['a terminal row', { status: 'succeeded' }],
    ['a queued row', { status: 'queued' }],
    ['an unscheduled row', { next_poll_at: null }],
    ['an unparseable schedule', { next_poll_at: 'not-a-date' }],
  ])('never syncs %s', (_name, overrides) => {
    expect(isSchedulerStalled(row({ next_poll_at: at(-10 * 60_000), ...overrides }), NOW)).toBe(false)
  })
})

describe('selectRecoverySyncs', () => {
  it('returns nothing while the scheduler is healthy, however often the page refreshes', () => {
    const memory = new Map<string, number>()
    for (let tick = 0; tick < 30; tick += 1) {
      const now = NOW + tick * STATUS_REFRESH_MS
      // A healthy scheduler re-schedules a row 10-20 s ahead (or leases it 3 min ahead) after every check.
      const healthy = [
        row({ id: 'a', next_poll_at: new Date(now + 8_000).toISOString() }),
        row({ id: 'b', next_poll_at: new Date(now - 3_000).toISOString() }),
        row({ id: 'leased', next_poll_at: new Date(now + POLL_LEASE_MS).toISOString() }),
        row({ id: 'c', status: 'succeeded', next_poll_at: null }),
      ]
      expect(selectRecoverySyncs(healthy, now, memory)).toEqual([])
    }
    expect(memory.size).toBe(0)
  })

  it('syncs a stalled row once, then at most once per minute (never every refresh)', () => {
    const memory = new Map<string, number>()
    const stalled = [row({ next_poll_at: at(-10 * 60_000) })]
    expect(selectRecoverySyncs(stalled, NOW, memory)).toHaveLength(1)
    expect(selectRecoverySyncs(stalled, NOW + STATUS_REFRESH_MS, memory)).toHaveLength(0)
    expect(selectRecoverySyncs(stalled, NOW + RECOVERY_SYNC_MIN_INTERVAL_MS - 1, memory)).toHaveLength(0)
    expect(selectRecoverySyncs(stalled, NOW + RECOVERY_SYNC_MIN_INTERVAL_MS, memory)).toHaveLength(1)
  })

  it('only the stalled rows of a mixed list are selected', () => {
    const memory = new Map<string, number>()
    const picked = selectRecoverySyncs([row({ id: 'ok' }), row({ id: 'stalled', next_poll_at: at(-5 * 60_000) })], NOW, memory)
    expect(picked.map((generation) => generation.id)).toEqual(['stalled'])
  })
})

describe('/videos page wiring', () => {
  const page = readFileSync(join(process.cwd(), 'app/(dashboard)/videos/page.tsx'), 'utf8')

  it('refreshes by re-reading the generation list (a database read), on the shared cadence constant', () => {
    expect(page).toMatch(/fetch\('\/api\/video-generations'\)/)
    expect(page).toMatch(/setInterval\(\(\) => void tick\(\), STATUS_REFRESH_MS\)/)
  })

  it('no longer syncs every in-flight row with the provider: the only /sync call is the recovery path', () => {
    const syncCalls = page.match(/\/sync`/g) ?? []
    expect(syncCalls).toHaveLength(1)
    expect(page).toMatch(/selectRecoverySyncs\(fresh, Date\.now\(\), recoverySyncedAtRef\.current\)\.map\(recoverySync\)/)
    expect(page).not.toMatch(/hasActiveMcpGeneration/)
  })

  it('the page can never create a (paid) generation: it issues no POST to the create route', () => {
    expect(page).not.toMatch(/fetch\('\/api\/video-generations',\s*\{[^}]*method:\s*'POST'/)
    expect(page).not.toMatch(/\/api\/video-generations['`"]\s*,\s*\{\s*method:\s*'POST'/)
  })

  it('does not refresh from a hidden tab and never overlaps ticks', () => {
    expect(page).toMatch(/document\.visibilityState === 'hidden'/)
    expect(page).toMatch(/refreshInFlightRef\.current/)
  })
})

describe('describeGenerationNotReady — what "Assistir" says without a playable result', () => {
  it.each(['queued', 'submitted', 'processing'])('%s is "not ready yet", not an error', (status) => {
    expect(describeGenerationNotReady({ status })).toEqual({ title: 'Aguardando', description: 'O vídeo ainda não está pronto.' })
  })

  it('a failed generation is reported as failed with its recorded reason — never as "not ready yet"', () => {
    const notice = describeGenerationNotReady({ status: 'failed', error_details: { message: 'O resultado do provedor não pôde ser copiado com segurança.' } })
    expect(notice).toEqual({ title: 'A geração falhou', description: 'O resultado do provedor não pôde ser copiado com segurança.', variant: 'destructive' })
  })

  it('a failed generation without a recorded reason still says it failed', () => {
    for (const error_details of [null, undefined, {}, { message: '  ' }, { message: 42 }]) {
      const notice = describeGenerationNotReady({ status: 'failed', error_details: error_details as any })
      expect(notice.title).toBe('A geração falhou')
      expect(notice.description).toBe('A Kling não concluiu esta geração.')
    }
  })
})
