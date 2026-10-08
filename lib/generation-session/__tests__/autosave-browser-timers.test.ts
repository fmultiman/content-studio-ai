import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  createDefaultClock,
  createGenerationSessionAutosave,
  type GenerationSessionAutosaveAdapter,
  type SaveFailure,
  type SaveSuccess,
} from '../autosave'
import { installBrowserFaithfulTimers } from './browser-timers'

// GENERATION_WORKSPACE_INTERACTION_CRASH_V1 — the shared autosave controller must work with the DEFAULT
// clock under browser timer semantics (receiver-checked setTimeout/clearTimeout). Production threw
// `TypeError: Illegal invocation` from setLocal on the first Image prompt edit / Video model change.

type State = { prompt: string }
type Token = number

function makeAdapter(options: { conflictOnce?: boolean } = {}) {
  const saves: Array<{ snapshot: State; expectedToken: Token }> = []
  let serverToken = 1
  let conflictOnce = options.conflictOnce === true
  const adapter: GenerationSessionAutosaveAdapter<State, Token> = {
    serialize: (value) => ({ prompt: value.prompt }),
    fingerprint: (value) => JSON.stringify(value),
    save: async ({ snapshot, expectedToken }) => {
      saves.push({ snapshot, expectedToken })
      if (conflictOnce) {
        conflictOnce = false
        throw 'conflict'
      }
      serverToken += 1
      return { ok: true, snapshot, token: serverToken } as SaveSuccess<State, Token>
    },
    classify: (error, snapshot, token): SaveFailure<State, Token> => ({
      ok: false,
      kind: error === 'conflict' ? 'conflict' : 'network',
      snapshot,
      token,
      retryable: true,
      code: String(error),
    }),
    fetchCurrent: async () => ({ snapshot: { prompt: 'server' }, token: serverToken }),
  }
  return { adapter, saves }
}

function create(adapter: GenerationSessionAutosaveAdapter<State, Token>, initial = '') {
  return createGenerationSessionAutosave({
    sessionKey: 'image:session-1',
    initial: { snapshot: { prompt: initial }, token: 1 },
    adapter,
    debounceMs: 20,
    canPersist: () => true,
  })
}

async function until(predicate: () => boolean) {
  await vi.waitFor(() => expect(predicate()).toBe(true), { timeout: 2000 })
}

let restoreTimers: () => void
beforeEach(() => {
  restoreTimers = installBrowserFaithfulTimers()
})
afterEach(() => {
  vi.useRealTimers()
  restoreTimers()
})

describe('browser timer harness', () => {
  it('rejects a bare-property timer call exactly like a real browser (the Production bug shape)', () => {
    const detached = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout }
    expect(() => detached.setTimeout(() => undefined, 1)).toThrow(/Illegal invocation/)
    expect(() => detached.clearTimeout(undefined)).toThrow(/Illegal invocation/)
    // Bare and globalThis calls remain legal.
    const id = setTimeout(() => undefined, 1)
    expect(() => clearTimeout(id)).not.toThrow()
    expect(() => globalThis.clearTimeout(globalThis.setTimeout(() => undefined, 1))).not.toThrow()
  })

  it('the default clock is legal when invoked as a property of the clock object', () => {
    const clock = createDefaultClock()
    const id = clock.setTimeout(() => undefined, 1)
    expect(() => clock.clearTimeout(id)).not.toThrow()
  })

  it('the default clock stays late-bound so fake timers installed after creation still drive it', () => {
    vi.useFakeTimers()
    const clock = createDefaultClock()
    const fired = vi.fn()
    clock.setTimeout(fired, 100)
    vi.advanceTimersByTime(100)
    expect(fired).toHaveBeenCalledTimes(1)
  })
})

describe('autosave controller with the default clock under browser timer semantics', () => {
  it('21. first edit does not throw, goes dirty, saves the prompt, and returns to clean', async () => {
    const { adapter, saves } = makeAdapter()
    const controller = create(adapter)
    expect(controller.state).toBe('clean')

    expect(() => controller.setLocal({ prompt: 'x' })).not.toThrow()
    expect(controller.state).toBe('dirty')
    expect(saves).toHaveLength(0)

    await until(() => controller.state === 'clean' && saves.length === 1)
    expect(saves[0].snapshot).toEqual({ prompt: 'x' })
    expect(saves[0].expectedToken).toBe(1)
    expect(controller.acknowledged?.token).toBe(2)
    controller.dispose()
  })

  it('rapid edits coalesce and the newest value wins', async () => {
    const { adapter, saves } = makeAdapter()
    const controller = create(adapter)
    for (const value of ['a', 'ab', 'abc', 'abcd']) controller.setLocal({ prompt: value })

    await until(() => controller.state === 'clean' && saves.length >= 1)
    expect(saves.map((entry) => entry.snapshot.prompt).at(-1)).toBe('abcd')
    expect(controller.acknowledged?.snapshot.prompt).toBe('abcd')
    expect(controller.local.prompt).toBe('abcd')
    controller.dispose()
  })

  it('deleting the whole prompt is a safe, persisted edit', async () => {
    const { adapter, saves } = makeAdapter()
    const controller = create(adapter, 'hello')
    expect(() => controller.setLocal({ prompt: '' })).not.toThrow()
    await until(() => controller.state === 'clean' && saves.length === 1)
    expect(saves[0].snapshot).toEqual({ prompt: '' })
    controller.dispose()
  })

  it('editing back to the acknowledged value cancels the pending save (restore path)', async () => {
    const { adapter, saves } = makeAdapter()
    const controller = create(adapter, 'original')
    controller.setLocal({ prompt: 'original!' })
    expect(controller.state).toBe('dirty')
    controller.setLocal({ prompt: 'original' })
    await until(() => controller.state === 'clean')
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(saves).toHaveLength(0)
    controller.dispose()
  })

  it('22. a CAS conflict still surfaces as conflict and keeps the local edit', async () => {
    const { adapter } = makeAdapter({ conflictOnce: true })
    const controller = create(adapter)
    controller.setLocal({ prompt: 'mine' })
    await until(() => controller.state === 'conflict')
    expect(controller.local.prompt).toBe('mine')
    controller.dispose()
  })

  it('dispose cancels a scheduled save without throwing', async () => {
    const { adapter, saves } = makeAdapter()
    const controller = create(adapter)
    controller.setLocal({ prompt: 'never saved' })
    expect(() => controller.dispose()).not.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(saves).toHaveLength(0)
  })

  it('flush resolves with the acknowledged snapshot', async () => {
    const { adapter, saves } = makeAdapter()
    const controller = create(adapter)
    controller.setLocal({ prompt: 'flush me' })
    const result = await controller.flush()
    expect(result.ok).toBe(true)
    expect(saves.at(-1)?.snapshot.prompt).toBe('flush me')
    controller.dispose()
  })
})

describe('detached browser timer guard', () => {
  const ROOTS = ['lib', 'hooks', 'components', 'app']
  const SKIP = new Set(['node_modules', '.next', '__tests__'])
  const DETACHED = /(setTimeout|clearTimeout|setInterval|clearInterval|requestAnimationFrame|cancelAnimationFrame)\s*:\s*(globalThis|window|self)\./

  function* sources(dir: string): Generator<string> {
    for (const name of readdirSync(dir)) {
      if (SKIP.has(name)) continue
      const full = join(dir, name)
      if (statSync(full).isDirectory()) yield* sources(full)
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) yield full
    }
  }

  it('no production source stores a native timer as a bare object property (browsers throw Illegal invocation)', () => {
    const offenders: string[] = []
    for (const root of ROOTS) {
      for (const file of sources(join(process.cwd(), root))) {
        if (DETACHED.test(readFileSync(file, 'utf8'))) offenders.push(file)
      }
    }
    expect(offenders).toEqual([])
  })
})
