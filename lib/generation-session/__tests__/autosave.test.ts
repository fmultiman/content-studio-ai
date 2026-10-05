import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createGenerationSessionAutosave,
  type GenerationSessionAutosaveAdapter,
  type SaveFailure,
  type SaveSuccess,
} from '../autosave'

type State = { prompt: string }
type Token = number

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function makeAdapter() {
  const requests: Array<{
    snapshot: State
    token: Token | null
    keepalive: boolean
    deferred: ReturnType<typeof deferred<SaveSuccess<State, Token>>>
  }> = []
  let current = { snapshot: { prompt: '' }, token: 1 }
  let nextError: unknown = null
  const adapter: GenerationSessionAutosaveAdapter<State, Token> = {
    serialize: (value) => ({ prompt: value.prompt }),
    fingerprint: (value) => JSON.stringify(value),
    save: ({ snapshot, expectedToken, keepalive }) => {
      const pending = deferred<SaveSuccess<State, Token>>()
      requests.push({ snapshot, token: expectedToken, keepalive, deferred: pending })
      if (nextError !== null) {
        const error = nextError
        nextError = null
        pending.reject(error)
      }
      return pending.promise
    },
    classify: (error, snapshot, token): SaveFailure<State, Token> => ({
      ok: false,
      kind: error === 'conflict' ? 'conflict' : 'network',
      snapshot,
      token,
      retryable: true,
      code: String(error),
    }),
    fetchCurrent: async () => current,
  }
  return {
    adapter,
    requests,
    setCurrent: (snapshot: State, token: Token) => { current = { snapshot, token } },
    failNext: (error: unknown) => { nextError = error },
  }
}

async function settle(
  request: ReturnType<typeof makeAdapter>['requests'][number],
  snapshot: State,
  token: Token,
) {
  request.deferred.resolve({ ok: true, snapshot, token })
  await Promise.resolve()
  await Promise.resolve()
}

afterEach(() => vi.useRealTimers())

describe('generation session autosave controller', () => {
  it('uses an 800ms trailing debounce and does not save per mutation', async () => {
    vi.useFakeTimers()
    const fixture = makeAdapter()
    const controller = createGenerationSessionAutosave({
      sessionKey: 'image:session-1',
      initial: { snapshot: { prompt: '' }, token: 1 },
      adapter: fixture.adapter,
      canPersist: () => true,
      clock: { setTimeout, clearTimeout },
    })

    controller.setLocal({ prompt: 'a' })
    controller.setLocal({ prompt: 'ab' })
    expect(fixture.requests).toHaveLength(0)
    vi.advanceTimersByTime(799)
    expect(fixture.requests).toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(fixture.requests).toHaveLength(1)
    expect(fixture.requests[0].snapshot).toEqual({ prompt: 'ab' })
    expect(controller.state).toBe('saving')
    await settle(fixture.requests[0], { prompt: 'ab' }, 2)
    expect(controller.state).toBe('clean')
  })

  it('keeps one request in flight and coalesces A/B/C to C', async () => {
    const fixture = makeAdapter()
    const controller = createGenerationSessionAutosave({
      sessionKey: 'video:session-1',
      initial: { snapshot: { prompt: '' }, token: 1 },
      adapter: fixture.adapter,
      debounceMs: 0,
      canPersist: () => true,
    })
    controller.setLocal({ prompt: 'a' })
    const first = controller.flush()
    expect(fixture.requests).toHaveLength(1)

    controller.setLocal({ prompt: 'b' })
    controller.setLocal({ prompt: 'c' })
    expect(fixture.requests).toHaveLength(1)
    expect(controller.state).toBe('pending')

    await settle(fixture.requests[0], { prompt: 'a' }, 2)
    await first
    expect(fixture.requests).toHaveLength(2)
    expect(fixture.requests[1].snapshot).toEqual({ prompt: 'c' })
    expect(fixture.requests[1].token).toBe(2)
    await settle(fixture.requests[1], { prompt: 'c' }, 3)
    expect(controller.state).toBe('clean')
    expect(controller.acknowledged?.snapshot).toEqual({ prompt: 'c' })
  })

  it('flushSnapshot resolves its exact target while a later edit remains pending', async () => {
    const fixture = makeAdapter()
    const controller = createGenerationSessionAutosave({
      sessionKey: 'image:session-2',
      initial: { snapshot: { prompt: '' }, token: 1 },
      adapter: fixture.adapter,
      canPersist: () => true,
    })
    const first = controller.flushSnapshot({ prompt: 'b' })
    controller.setLocal({ prompt: 'c' })
    expect(fixture.requests).toHaveLength(1)
    await settle(fixture.requests[0], { prompt: 'b' }, 2)
    const firstResult = await first
    expect(firstResult).toMatchObject({ ok: true, snapshot: { prompt: 'b' }, token: 2 })
    expect(fixture.requests).toHaveLength(2)
    expect(controller.state).toBe('saving')
    await settle(fixture.requests[1], { prompt: 'c' }, 3)
  })

  it('rejects a CAS conflict without overwriting local state', async () => {
    const fixture = makeAdapter()
    const controller = createGenerationSessionAutosave({
      sessionKey: 'video:session-2',
      initial: { snapshot: { prompt: 'server-a' }, token: 1 },
      adapter: fixture.adapter,
      canPersist: () => true,
    })
    const resultPromise = controller.flushSnapshot({ prompt: 'local-b' })
    expect(fixture.requests).toHaveLength(1)
    fixture.requests[0].deferred.reject('conflict')
    const result = await resultPromise
    expect(result).toMatchObject({ ok: false, kind: 'conflict' })
    expect(controller.state).toBe('conflict')
    expect(controller.local).toEqual({ prompt: 'local-b' })
  })

  it('ignores a response from a disposed controller', async () => {
    const fixture = makeAdapter()
    const controller = createGenerationSessionAutosave({
      sessionKey: 'image:old',
      initial: { snapshot: { prompt: '' }, token: 1 },
      adapter: fixture.adapter,
      canPersist: () => true,
    })
    const resultPromise = controller.flushSnapshot({ prompt: 'old' })
    controller.dispose()
    await settle(fixture.requests[0], { prompt: 'old' }, 2)
    expect(await resultPromise).toMatchObject({ ok: false, code: 'DISPOSED' })
    expect(controller.acknowledged?.snapshot).toEqual({ prompt: '' })
  })

  it('retries ambiguously only after reconciling current server state', async () => {
    const fixture = makeAdapter()
    const controller = createGenerationSessionAutosave({
      sessionKey: 'video:session-3',
      initial: { snapshot: { prompt: 'a' }, token: 1 },
      adapter: fixture.adapter,
      canPersist: () => true,
    })
    fixture.failNext('timeout')
    const failedPromise = controller.flushSnapshot({ prompt: 'b' })
    const failed = await failedPromise
    expect(failed).toMatchObject({ ok: false, kind: 'network' })
    expect(fixture.requests).toHaveLength(1)

    fixture.setCurrent({ prompt: 'b' }, 2)
    const retried = await controller.retry()
    expect(retried).toMatchObject({ ok: true, snapshot: { prompt: 'b' }, token: 2 })
    expect(fixture.requests).toHaveLength(1)
  })

  it('flushLifecycle sends one keepalive request and never duplicates an in-flight save', async () => {
    const fixture = makeAdapter()
    const controller = createGenerationSessionAutosave({
      sessionKey: 'image:session-4',
      initial: { snapshot: { prompt: '' }, token: 1 },
      adapter: fixture.adapter,
      canPersist: () => true,
    })
    controller.setLocal({ prompt: 'lifecycle' })
    controller.flushLifecycle()
    controller.flushLifecycle()
    expect(fixture.requests).toHaveLength(1)
    expect(fixture.requests[0].keepalive).toBe(true)
    await settle(fixture.requests[0], { prompt: 'lifecycle' }, 2)
  })

  it('does not create a new Session for an empty non-persistable state', async () => {
    const fixture = makeAdapter()
    const controller = createGenerationSessionAutosave({
      sessionKey: 'video:new',
      initial: { snapshot: { prompt: '' }, token: null },
      adapter: fixture.adapter,
      canPersist: (snapshot, token) => token !== null || snapshot.prompt.trim().length > 0,
    })
    const result = await controller.flushSnapshot({ prompt: '' })
    expect(result).toMatchObject({ ok: true, token: null })
    expect(fixture.requests).toHaveLength(0)
    expect(controller.state).toBe('clean')
  })
})
