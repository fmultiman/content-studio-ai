import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createGenerationSessionAutosave,
  type GenerationSessionAutosaveAdapter,
  type SaveFailure,
  type SaveState,
  type SaveSuccess,
} from '../autosave'

// FUTURE-058 - benign revision-conflict reconciliation.
//
// `serverOwned` models what an image generation changes on the Session (the output pointer) together with the
// revision. It is deliberately NOT part of the adapter fingerprint, exactly like `currentImageId` in the Image
// workspace. `prompt` is authored state: a change to it is a real divergence.

type Snap = { prompt: string; serverOwned: string }
type Token = number

type Gate = { release: () => void }

function makeServer(options: { gateSaves?: boolean; omitServerSnapshot?: boolean; throwOnSerialize?: (s: Snap) => boolean } = {}) {
  let token: Token = 1
  let stored: Snap = { prompt: '', serverOwned: 'none' }
  const saves: Array<{ snapshot: Snap; expectedToken: Token; keepalive: boolean; outcome: 'ok' | '409' }> = []
  const gates: Gate[] = []
  const classifyCalls: unknown[] = []

  const adapter: GenerationSessionAutosaveAdapter<Snap, Token> = {
    serialize: (value) => {
      if (options.throwOnSerialize?.(value)) throw new Error('malformed snapshot')
      return { prompt: value.prompt, serverOwned: value.serverOwned }
    },
    fingerprint: (value) => JSON.stringify({ prompt: value.prompt }),
    save: async ({ snapshot, expectedToken, keepalive }) => {
      if (options.gateSaves) await new Promise<void>((resolve) => gates.push({ release: resolve }))
      if (expectedToken !== token) {
        saves.push({ snapshot, expectedToken, keepalive, outcome: '409' })
        throw { kind: 'conflict', server: options.omitServerSnapshot ? undefined : { snapshot: { ...stored }, token } }
      }
      stored = { prompt: snapshot.prompt, serverOwned: stored.serverOwned }
      token += 1
      saves.push({ snapshot, expectedToken, keepalive, outcome: 'ok' })
      return { ok: true, snapshot: { ...stored }, token } satisfies SaveSuccess<Snap, Token>
    },
    classify: (error, snapshot, tokenAtRequest): SaveFailure<Snap, Token> => {
      classifyCalls.push(error)
      const typed = error as { kind?: SaveFailure<Snap, Token>['kind']; server?: { snapshot: Snap; token: Token } }
      return { ok: false, kind: typed?.kind ?? 'network', snapshot, token: tokenAtRequest, retryable: typed?.kind !== 'conflict', server: typed?.server }
    },
    fetchCurrent: async () => ({ snapshot: { ...stored }, token }),
  }

  return {
    adapter,
    saves,
    gates,
    classifyCalls,
    get token() { return token },
    get stored() { return stored },
    /** A server-owned write (generation linking its output): revision +1, authored fields untouched. */
    generationLinksOutput: () => { token += 1; stored = { ...stored, serverOwned: 'image-1' } },
    /** Another writer changed an AUTHORED field: revision +1 and a different prompt. */
    anotherTabEdits: (prompt: string) => { token += 1; stored = { ...stored, prompt } },
  }
}

function setup(serverOptions: Parameters<typeof makeServer>[0] = {}) {
  const server = makeServer(serverOptions)
  const controller = createGenerationSessionAutosave<Snap, Token>({
    sessionKey: 'image:session-1',
    initial: { snapshot: { prompt: '', serverOwned: 'none' }, token: 1 },
    adapter: server.adapter,
    debounceMs: 0,
    canPersist: () => true,
  })
  const states: SaveState[] = []
  controller.subscribe(() => { if (states[states.length - 1] !== controller.state) states.push(controller.state) })
  return { server, controller, states }
}

const tick = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve() }
const edit = (prompt: string): Snap => ({ prompt, serverOwned: 'none' })

afterEach(() => vi.useRealTimers())

describe('benign revision conflict (server-owned write after a generation)', () => {
  it('normal autosave is unchanged: one save, new token, clean', async () => {
    const { server, controller, states } = setup()
    controller.setLocal(edit('a'))
    expect((await controller.flush()).ok).toBe(true)
    expect(server.saves.map((s) => [s.expectedToken, s.outcome])).toEqual([[1, 'ok']])
    expect(controller.state).toBe('clean')
    expect(states).not.toContain('conflict')
  })

  it('a revision-only 409 is reconciled: the token is adopted and the SAME snapshot is re-sent exactly once, ending clean', async () => {
    const { server, controller, states } = setup()
    controller.setLocal(edit('first'))
    await controller.flush() // token 2
    server.generationLinksOutput() // token 3, authored fields identical
    controller.setLocal(edit('edited after generation'))
    const result = await controller.flush()

    expect(result.ok).toBe(true)
    expect(server.saves.map((s) => [s.expectedToken, s.outcome])).toEqual([[1, 'ok'], [2, '409'], [3, 'ok']])
    expect(server.stored.prompt).toBe('edited after generation')
    expect(controller.state).toBe('clean')
    expect(controller.acknowledged?.token).toBe(4)
    expect(states).not.toContain('conflict')
    expect(states).not.toContain('error')
  })

  it('keeps the server-owned fields of the canonical snapshot as the new baseline, and later edits use the adopted token', async () => {
    const { server, controller } = setup()
    server.generationLinksOutput() // token 2
    controller.setLocal(edit('one'))
    await controller.flush()
    expect(controller.acknowledged?.snapshot.serverOwned).toBe('image-1')
    controller.setLocal(edit('two'))
    await controller.flush()
    expect(server.saves.map((s) => s.expectedToken)).toEqual([1, 2, 3])
    expect(server.saves.map((s) => s.outcome)).toEqual(['409', 'ok', 'ok'])
  })

  it('performs exactly ONE automatic retry: if the retry also receives 409, the conflict is surfaced and nothing else is sent', async () => {
    const { server, controller } = setup()
    let bumped = 0
    const original = server.adapter.save
    server.adapter.save = async (input) => {
      // A server-owned write lands between the first 409 and the retry as well.
      if (input.expectedToken === 2 && bumped === 0) { bumped += 1; server.generationLinksOutput() }
      return original(input)
    }
    server.generationLinksOutput() // token 2 -> first PATCH (token 1) conflicts; retry (token 2) conflicts again
    controller.setLocal(edit('x'))
    const result = await controller.flush()
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.kind).toBe('conflict')
    expect(server.saves.filter((s) => s.outcome === '409')).toHaveLength(2)
    expect(server.saves).toHaveLength(2) // no third attempt
    expect(controller.state).toBe('conflict')
    expect(controller.local.prompt).toBe('x') // local edit preserved
  })

  it('a genuine authored divergence is NOT reconciled: one save, conflict, local edit preserved', async () => {
    const { server, controller } = setup()
    server.anotherTabEdits('edited in another tab')
    controller.setLocal(edit('my edit'))
    const result = await controller.flush()
    expect(result.ok).toBe(false)
    expect(server.saves).toHaveLength(1)
    expect(controller.state).toBe('conflict')
    expect(controller.local.prompt).toBe('my edit')
    expect(server.stored.prompt).toBe('edited in another tab') // server state never overwritten
  })

  it('after a genuine conflict the existing "keep local" recovery still works', async () => {
    const { server, controller } = setup()
    server.anotherTabEdits('theirs')
    controller.setLocal(edit('mine'))
    await controller.flush()
    expect(controller.state).toBe('conflict')
    expect(await controller.resolveConflict('keep_local')).toBe(true)
    expect(controller.state).toBe('clean')
    expect(server.stored.prompt).toBe('mine')
  })

  it('"reload server" after a genuine conflict adopts the server version and drops the local edit (explicit user choice)', async () => {
    const { server, controller } = setup()
    server.anotherTabEdits('theirs')
    controller.setLocal(edit('mine'))
    await controller.flush()
    expect(await controller.resolveConflict('reload_server')).toBe(true)
    expect(controller.local.prompt).toBe('theirs')
    expect(controller.state).toBe('clean')
  })

  it('without a server snapshot the comparison cannot be made: normal conflict handling', async () => {
    const { server, controller } = setup({ omitServerSnapshot: true })
    server.generationLinksOutput()
    controller.setLocal(edit('x'))
    const result = await controller.flush()
    expect(result.ok).toBe(false)
    expect(server.saves).toHaveLength(1)
    expect(controller.state).toBe('conflict')
  })

  it('a malformed server snapshot (cannot be compared confidently) is a normal conflict', async () => {
    const { server, controller } = setup({ throwOnSerialize: (s) => s.serverOwned === 'image-1' })
    server.generationLinksOutput()
    controller.setLocal(edit('x'))
    const result = await controller.flush()
    expect(result.ok).toBe(false)
    expect(server.saves).toHaveLength(1)
    expect(controller.state).toBe('conflict')
  })

  it('a 409 that reports the SAME token is not treated as a revision-only change', async () => {
    const { server, controller } = setup()
    server.adapter.save = async ({ expectedToken }) => {
      server.saves.push({ snapshot: edit('x'), expectedToken, keepalive: false, outcome: '409' })
      throw { kind: 'conflict', server: { snapshot: { ...server.stored }, token: expectedToken } }
    }
    controller.setLocal(edit('x'))
    const result = await controller.flush()
    expect(result.ok).toBe(false)
    expect(server.saves).toHaveLength(1)
    expect(controller.state).toBe('conflict')
  })

  it('non-conflict failures are unaffected (network error stays an error, no automatic retry)', async () => {
    const { server, controller } = setup()
    server.adapter.save = async ({ expectedToken }) => {
      server.saves.push({ snapshot: edit('x'), expectedToken, keepalive: false, outcome: '409' })
      throw { kind: 'network' }
    }
    controller.setLocal(edit('x'))
    await controller.flush()
    expect(server.saves).toHaveLength(1)
    expect(controller.state).toBe('error')
  })
})

describe('benign reconciliation with concurrent local activity', () => {
  it('an edit typed while the first request is in flight is not dropped: the reconciled save lands first, then the newer edit', async () => {
    const { server, controller, states } = setup({ gateSaves: true })
    server.generationLinksOutput() // token 2; first PATCH (token 1) will 409
    controller.setLocal(edit('A'))
    const barrierA = controller.flush()
    await tick()
    expect(server.gates).toHaveLength(1) // request #1 in flight
    controller.setLocal(edit('B')) // typed during the in-flight save
    server.gates[0].release() // #1 -> 409 (benign)
    await tick()
    expect(server.gates).toHaveLength(2) // the single retry is now in flight
    server.gates[1].release() // retry -> ok (token 2 -> 3)
    await tick()
    expect((await barrierA).ok).toBe(true)
    expect(server.gates).toHaveLength(3) // B follows with the NEW token
    server.gates[2].release()
    await tick()
    expect(server.saves.map((s) => [s.snapshot.prompt, s.expectedToken, s.outcome])).toEqual([['A', 1, '409'], ['A', 2, 'ok'], ['B', 3, 'ok']])
    expect(server.stored.prompt).toBe('B')
    expect(controller.state).toBe('clean')
    expect(states).not.toContain('conflict')
  })

  it('rapid edits coalesce to the last value and a stale response from a reset controller is ignored', async () => {
    const { server, controller } = setup({ gateSaves: true })
    server.generationLinksOutput()
    controller.setLocal(edit('a'))
    void controller.flush()
    await tick()
    controller.setLocal(edit('ab'))
    controller.setLocal(edit('abc'))
    // the session is replaced (reload) while request #1 is still in flight
    controller.resetAcknowledged({ prompt: 'reloaded', serverOwned: 'image-1' }, 9)
    server.gates[0].release()
    await tick()
    expect(controller.state).toBe('clean')
    expect(controller.acknowledged?.token).toBe(9)
    expect(controller.local.prompt).toBe('reloaded')
    expect(server.saves.filter((s) => s.outcome === 'ok')).toHaveLength(0) // the stale retry never wrote
  })

  it('the lifecycle (keepalive) flush gets the same single reconciliation', async () => {
    const { server, controller } = setup()
    server.generationLinksOutput()
    controller.setLocal(edit('on the way out'))
    controller.flushLifecycle()
    await tick()
    expect(server.saves.map((s) => [s.keepalive, s.outcome])).toEqual([[true, '409'], [true, 'ok']])
    expect(server.stored.prompt).toBe('on the way out')
    expect(controller.state).toBe('clean')
  })

  it('a flush barrier for the exact snapshot resolves ok after reconciliation', async () => {
    const { server, controller } = setup()
    server.generationLinksOutput()
    const result = await controller.flushSnapshot(edit('barrier'))
    expect(result.ok).toBe(true)
    expect(server.stored.prompt).toBe('barrier')
  })

  it('the reconciliation sends no network call other than the save (no fetchCurrent, no provider)', async () => {
    const { server, controller } = setup()
    const fetchCurrent = vi.spyOn(server.adapter, 'fetchCurrent')
    server.generationLinksOutput()
    controller.setLocal(edit('x'))
    await controller.flush()
    expect(fetchCurrent).not.toHaveBeenCalled()
  })
})
