// GENERATION_WORKSPACE_INTERACTION_CRASH_V1
//
// Node and jsdom do not brand-check the receiver of `setTimeout`/`clearTimeout`; real browsers do:
// `({ setTimeout: window.setTimeout }).setTimeout(fn, 1)` throws `TypeError: Illegal invocation`.
// Production crashed on every Image prompt edit and Video model change because of exactly that, and every
// test stayed green. Installing these guards makes the test environment fail the way a browser fails.
// A bare call (`setTimeout(fn)`) has `this === undefined` and a global call has `this === globalThis`;
// anything else is an illegal invocation.

type TimerGlobals = {
  setTimeout: typeof setTimeout
  clearTimeout: typeof clearTimeout
}

function guard<F extends (...args: never[]) => unknown>(name: string, real: F): F {
  return function (this: unknown, ...args: Parameters<F>) {
    const receiver = this
    const isGlobal = receiver === undefined || receiver === null || receiver === globalThis
    if (!isGlobal) {
      throw new TypeError(`Failed to execute '${name}' on 'Window': Illegal invocation`)
    }
    return real(...args)
  } as unknown as F
}

/** Replaces the global timers with receiver-checking versions. Returns the restore function. */
export function installBrowserFaithfulTimers(): () => void {
  const target = globalThis as unknown as TimerGlobals
  const realSet = target.setTimeout
  const realClear = target.clearTimeout
  target.setTimeout = guard('setTimeout', realSet.bind(globalThis) as typeof setTimeout)
  target.clearTimeout = guard('clearTimeout', realClear.bind(globalThis) as typeof clearTimeout)
  return () => {
    target.setTimeout = realSet
    target.clearTimeout = realClear
  }
}
