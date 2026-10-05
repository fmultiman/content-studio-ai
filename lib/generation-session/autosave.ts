export type SaveToken = number | string | null

export type SaveState = 'clean' | 'dirty' | 'pending' | 'saving' | 'error' | 'conflict'

export type SaveSuccess<S, T extends SaveToken> = {
  ok: true
  snapshot: S
  token: T
}

export type SaveFailure<S, T extends SaveToken> = {
  ok: false
  kind: 'network' | 'server' | 'auth' | 'validation' | 'conflict'
  snapshot: S
  token: T
  server?: { snapshot: S; token: T }
  retryable: boolean
  code?: string
}

export type SaveResult<S, T extends SaveToken> = SaveSuccess<S, T> | SaveFailure<S, T>

export type GenerationSessionAutosaveAdapter<S, T extends SaveToken> = {
  serialize(value: S): S
  fingerprint(snapshot: S): string
  save(input: { snapshot: S; expectedToken: T; keepalive: boolean }): Promise<SaveSuccess<S, T>>
  classify(error: unknown, snapshot: S, token: T): SaveFailure<S, T>
  fetchCurrent(): Promise<{ snapshot: S; token: T }>
}

export type AutosaveSnapshot<S, T extends SaveToken> = {
  state: SaveState
  acknowledged: { snapshot: S; token: T } | null
  local: S
  pending: S | null
}

export type GenerationSessionAutosave<S, T extends SaveToken> = {
  state: SaveState
  acknowledged: { snapshot: S; token: T } | null
  local: S
  pending: S | null
  resetAcknowledged(snapshot: S, token: T): void
  observeServer(snapshot: S, token: T): void
  subscribe(listener: () => void): () => void
  getSnapshot(): AutosaveSnapshot<S, T>
  setLocal(value: S): void
  flush(): Promise<SaveResult<S, T>>
  flushSnapshot(value: S): Promise<SaveResult<S, T>>
  retry(): Promise<SaveResult<S, T>>
  flushLifecycle(): void
  resolveConflict(mode: 'reload_server' | 'keep_local' | 'discard_local'): Promise<boolean>
  dispose(): void
}

export type CreateGenerationSessionAutosaveOptions<S, T extends SaveToken> = {
  sessionKey: string
  initial: { snapshot: S; token: T }
  adapter: GenerationSessionAutosaveAdapter<S, T>
  debounceMs?: number
  canPersist(snapshot: S, token: T): boolean
  clock?: Pick<typeof globalThis, 'setTimeout' | 'clearTimeout'>
}

type Clock = Pick<typeof globalThis, 'setTimeout' | 'clearTimeout'>

type Target<S> = {
  snapshot: S
  fingerprint: string
}

type Waiter<S, T extends SaveToken> = {
  fingerprint: string
  resolve: (result: SaveResult<S, T>) => void
}

type FailedTarget<S, T extends SaveToken> = {
  target: Target<S>
  token: T
}

const DEFAULT_DEBOUNCE_MS = 800

function cloneSnapshot<S>(snapshot: S): S {
  if (snapshot === null || typeof snapshot !== 'object') return snapshot
  if (typeof structuredClone === 'function') return structuredClone(snapshot)
  return JSON.parse(JSON.stringify(snapshot)) as S
}

function noopTimer() {
  return undefined
}

export function createGenerationSessionAutosave<S, T extends SaveToken>(
  options: CreateGenerationSessionAutosaveOptions<S, T>,
): GenerationSessionAutosave<S, T> {
  const clock: Clock = options.clock || {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  }
  const listeners = new Set<() => void>()
  const initialSnapshot = cloneSnapshot(options.adapter.serialize(options.initial.snapshot))
  let acknowledged: { snapshot: S; token: T } = {
    snapshot: initialSnapshot,
    token: options.initial.token,
  }
  let local = cloneSnapshot(initialSnapshot)
  let pending: Target<S> | null = null
  let state: SaveState = 'clean'
  let timer: ReturnType<typeof setTimeout> | undefined
  let inFlight: { sequence: number; epoch: number; target: Target<S> } | null = null
  let epoch = 0
  let sequence = 0
  let disposed = false
  let waiters: Waiter<S, T>[] = []
  let failed: FailedTarget<S, T> | null = null
  let view: AutosaveSnapshot<S, T> = {
    state,
    acknowledged,
    local,
    pending: null,
  }

  const currentFingerprint = () => options.adapter.fingerprint(local)
  const acknowledgedFingerprint = () => options.adapter.fingerprint(acknowledged.snapshot)
  const notify = () => {
    view = { state, acknowledged, local, pending: pending?.snapshot || null }
    if (!disposed) listeners.forEach((listener) => listener())
  }
  const setState = (next: SaveState) => {
    if (state === next) return
    state = next
    notify()
  }
  const clearTimer = () => {
    if (timer !== undefined) clock.clearTimeout(timer)
    timer = undefined
  }
  const makeFailure = (
    kind: SaveFailure<S, T>['kind'],
    snapshot: S,
    token: T,
    retryable: boolean,
    code?: string,
    server?: { snapshot: S; token: T },
  ): SaveFailure<S, T> => ({
    ok: false,
    kind,
    snapshot: cloneSnapshot(snapshot),
    token,
    retryable,
    code,
    server,
  })
  const resolveWaiters = (result: SaveResult<S, T>, fingerprint?: string) => {
    const remaining: Waiter<S, T>[] = []
    for (const waiter of waiters) {
      if (!fingerprint || waiter.fingerprint === fingerprint || !result.ok) waiter.resolve(result)
      else remaining.push(waiter)
    }
    waiters = remaining
  }
  const targetFor = (snapshot: S): Target<S> => {
    const serialized = cloneSnapshot(options.adapter.serialize(snapshot))
    return { snapshot: serialized, fingerprint: options.adapter.fingerprint(serialized) }
  }
  const isCurrent = (requestEpoch: number, requestSequence: number) =>
    !disposed && requestEpoch === epoch && inFlight?.sequence === requestSequence

  const send = async (target: Target<S>, keepalive = false): Promise<void> => {
    const requestEpoch = epoch
    const requestSequence = ++sequence
    const expectedToken = acknowledged.token
    inFlight = { sequence: requestSequence, epoch: requestEpoch, target }
    setState('saving')
    let result: SaveResult<S, T>
    try {
      result = await options.adapter.save({
        snapshot: cloneSnapshot(target.snapshot),
        expectedToken,
        keepalive,
      })
    } catch (error) {
      result = options.adapter.classify(error, target.snapshot, expectedToken)
    }

    if (!isCurrent(requestEpoch, requestSequence)) return
    inFlight = null

    if (!result.ok) {
      failed = { target, token: expectedToken }
      pending = null
      setState(result.kind === 'conflict' ? 'conflict' : 'error')
      resolveWaiters(result)
      return
    }

    const returnedSnapshot = targetFor(result.snapshot)
    if (returnedSnapshot.fingerprint !== target.fingerprint) {
      const malformed = makeFailure('server', target.snapshot, expectedToken, true, 'ACK_SNAPSHOT_MISMATCH')
      failed = { target, token: expectedToken }
      pending = null
      setState('error')
      resolveWaiters(malformed)
      return
    }

    acknowledged = { snapshot: returnedSnapshot.snapshot, token: result.token }
    failed = null
    notify()

    // A flush barrier is for the exact snapshot it captured. A newer local
    // edit may already be queued, but that must not keep the older barrier
    // pending or make it observe the newer snapshot.
    const acknowledgedResult: SaveSuccess<S, T> = {
      ok: true,
      snapshot: returnedSnapshot.snapshot,
      token: result.token,
    }
    resolveWaiters(acknowledgedResult, returnedSnapshot.fingerprint)

    if (pending && pending.fingerprint !== returnedSnapshot.fingerprint) {
      const next = pending
      pending = null
      setState('pending')
      await send(next, false)
      return
    }

    pending = null
    setState('clean')
  }

  const enqueue = (target: Target<S>, waiter?: Waiter<S, T>, keepalive = false) => {
    if (waiter) waiters.push(waiter)
    if (!options.canPersist(target.snapshot, acknowledged.token)) {
      pending = null
      setState('clean')
      resolveWaiters({ ok: true, snapshot: target.snapshot, token: acknowledged.token }, target.fingerprint)
      return
    }
    if (inFlight) {
      pending = target
      setState('pending')
      notify()
      return
    }
    void send(target, keepalive)
  }

  const schedule = () => {
    clearTimer()
    if (state === 'error' || state === 'conflict') return
    timer = clock.setTimeout(() => {
      timer = undefined
      const target = targetFor(local)
      if (target.fingerprint === acknowledgedFingerprint()) {
        pending = null
        setState('clean')
        return
      }
      enqueue(target)
    }, options.debounceMs ?? DEFAULT_DEBOUNCE_MS)
  }

  const resetAcknowledged = (snapshot: S, token: T) => {
    epoch += 1
    clearTimer()
    const next = targetFor(snapshot)
    acknowledged = { snapshot: next.snapshot, token }
    local = cloneSnapshot(next.snapshot)
    pending = null
    failed = null
    inFlight = null
    const abandoned = makeFailure('network', next.snapshot, token, false, 'RESET')
    resolveWaiters(abandoned)
    setState('clean')
    notify()
  }

  const observeServer = (snapshot: S, token: T) => {
    if (disposed || inFlight || pending) return
    const serverTarget = targetFor(snapshot)
    const ackFp = acknowledgedFingerprint()
    const localFp = currentFingerprint()
    if (serverTarget.fingerprint === ackFp) {
      acknowledged = { snapshot: serverTarget.snapshot, token }
      if (localFp === serverTarget.fingerprint) setState('clean')
      notify()
      return
    }
    const conflict = makeFailure('conflict', local, acknowledged.token, false, 'SERVER_CHANGED', {
      snapshot: serverTarget.snapshot,
      token,
    })
    setState('conflict')
    resolveWaiters(conflict)
  }

  const setLocal = (value: S) => {
    if (disposed) return
    const target = targetFor(value)
    local = target.snapshot
    const localFp = currentFingerprint()
    if (state === 'conflict') {
      notify()
      return
    }
    if (state === 'error') {
      notify()
      return
    }
    if (!inFlight && localFp === acknowledgedFingerprint()) {
      pending = null
      setState('clean')
      return
    }
    if (inFlight) {
      pending = target
      setState('pending')
      notify()
      return
    }
    setState('dirty')
    schedule()
    notify()
  }

  const flushSnapshot = (value: S): Promise<SaveResult<S, T>> => {
    if (disposed) return Promise.resolve(makeFailure('network', value, acknowledged.token, false, 'DISPOSED'))
    clearTimer()
    const target = targetFor(value)
    local = cloneSnapshot(target.snapshot)
    if (!inFlight && target.fingerprint === acknowledgedFingerprint()) {
      pending = null
      setState('clean')
      return Promise.resolve({ ok: true, snapshot: target.snapshot, token: acknowledged.token })
    }
    return new Promise((resolve) => {
      enqueue(target, { fingerprint: target.fingerprint, resolve })
    })
  }

  const flush = () => flushSnapshot(local)

  const retry = async (): Promise<SaveResult<S, T>> => {
    if (disposed) return makeFailure('network', local, acknowledged.token, false, 'DISPOSED')
    if (state !== 'error' || !failed) return flush()
    let current: { snapshot: S; token: T }
    try {
      current = await options.adapter.fetchCurrent()
    } catch (error) {
      const result = options.adapter.classify(error, failed.target.snapshot, failed.token)
      setState('error')
      return result
    }
    const currentTarget = targetFor(current.snapshot)
    if (currentTarget.fingerprint === failed.target.fingerprint) {
      acknowledged = { snapshot: currentTarget.snapshot, token: current.token }
      failed = null
      if (currentFingerprint() === currentTarget.fingerprint) {
        setState('clean')
        return { ok: true, snapshot: currentTarget.snapshot, token: current.token }
      }
      return flush()
    }
    if (currentTarget.fingerprint === acknowledgedFingerprint()) {
      acknowledged = { snapshot: currentTarget.snapshot, token: current.token }
      failed = null
      setState('dirty')
      return flush()
    }
    const result = makeFailure('conflict', local, acknowledged.token, false, 'SERVER_CHANGED', current)
    setState('conflict')
    return result
  }

  const resolveConflict = async (mode: 'reload_server' | 'keep_local' | 'discard_local') => {
    if (disposed) return false
    if (mode === 'discard_local' || mode === 'reload_server') {
      try {
        const current = await options.adapter.fetchCurrent()
        resetAcknowledged(current.snapshot, current.token)
        return true
      } catch {
        return false
      }
    }
    try {
      const current = await options.adapter.fetchCurrent()
      const preserved = cloneSnapshot(local)
      resetAcknowledged(current.snapshot, current.token)
      local = preserved
      return (await flush()).ok
    } catch {
      return false
    }
  }

  const flushLifecycle = () => {
    if (disposed || state === 'error' || state === 'conflict' || inFlight) return
    clearTimer()
    const target = targetFor(local)
    if (target.fingerprint === acknowledgedFingerprint()) return
    enqueue(target, undefined, true)
  }

  const dispose = () => {
    if (disposed) return
    disposed = true
    epoch += 1
    clearTimer()
    inFlight = null
    pending = null
    const failure = makeFailure('network', local, acknowledged.token, false, 'DISPOSED')
    resolveWaiters(failure)
    listeners.clear()
  }

  const controller: GenerationSessionAutosave<S, T> = {
    get state() { return state },
    get acknowledged() { return acknowledged },
    get local() { return local },
    get pending() { return pending?.snapshot || null },
    resetAcknowledged,
    observeServer,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot() {
      return view
    },
    setLocal,
    flush,
    flushSnapshot,
    retry,
    flushLifecycle,
    resolveConflict,
    dispose,
  }

  return controller
}

export const createNoopClock = (): Clock => ({
  setTimeout: noopTimer as unknown as typeof setTimeout,
  clearTimeout: () => undefined,
})
