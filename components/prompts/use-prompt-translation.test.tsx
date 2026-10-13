// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { usePromptTranslation } from '@/hooks/use-prompt-translation'

// GENERATION_PROMPT_MODES_LANGUAGE_UX_CONVERGENCE_V1 — invariants of the read-only Portuguese view.

type Pending = { resolve: (text: string) => void; signal: AbortSignal | undefined; prompt: string }
let pending: Pending[] = []

function stubTranslateEndpoint() {
  pending = []
  vi.stubGlobal('fetch', vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    const prompt = JSON.parse(String(init?.body)).prompt as string
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    pending.push({ prompt, signal: init?.signal ?? undefined, resolve: (text) => resolve(new Response(JSON.stringify({ translatedPrompt: text }), { status: 200 })) })
  })))
}

// The caller owns prompt + translation, exactly like the Images/Videos pages.
function useHarness(initial: { prompt: string; translation: string }) {
  const [prompt, setPrompt] = useState(initial.prompt)
  const [translation, setTranslation] = useState(initial.translation)
  const [epoch, setEpoch] = useState(0)
  const hook = usePromptTranslation({ prompt, translation, setTranslation, epoch })
  return {
    ...hook,
    prompt,
    rawTranslation: translation,
    edit: setPrompt,
    // A saved session loaded in the same batch.
    hydrate: (next: { prompt: string; translation: string }) => { setPrompt(next.prompt); setTranslation(next.translation); setEpoch((value) => value + 1) },
  }
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('usePromptTranslation', () => {
  it('never calls the provider by itself and reuses an existing translation of the same prompt', async () => {
    stubTranslateEndpoint()
    const { result } = renderHook(() => useHarness({ prompt: 'A', translation: '' }))
    expect(pending).toHaveLength(0)
    await act(async () => { void result.current.translate() })
    expect(pending).toHaveLength(1)
    await act(async () => { pending[0].resolve('T(A)') })
    await waitFor(() => expect(result.current.translation).toBe('T(A)'))
    await act(async () => { await result.current.translate() })
    expect(pending).toHaveLength(1)
  })

  it('editing during a pending request (no translation yet) aborts it and frees the action; A→B→A never accepts the old response', async () => {
    stubTranslateEndpoint()
    const { result } = renderHook(() => useHarness({ prompt: 'A', translation: '' }))
    await act(async () => { void result.current.translate() })
    expect(result.current.translating).toBe(true)
    act(() => result.current.edit('B'))
    await waitFor(() => expect(result.current.translating).toBe(false))
    expect(pending[0].signal?.aborted).toBe(true)
    act(() => result.current.edit('A'))
    await act(async () => { pending[0].resolve('T(A) late') })
    expect(result.current.translation).toBe('')
    // The action is available again for the current prompt.
    await act(async () => { void result.current.translate() })
    expect(pending).toHaveLength(2)
  })

  it('editing the prompt discards the translation', async () => {
    stubTranslateEndpoint()
    const { result } = renderHook(() => useHarness({ prompt: 'A', translation: '' }))
    await act(async () => { void result.current.translate() })
    await act(async () => { pending[0].resolve('T(A)') })
    await waitFor(() => expect(result.current.translation).toBe('T(A)'))
    act(() => result.current.edit('A!'))
    await waitFor(() => expect(result.current.rawTranslation).toBe(''))
    expect(result.current.translation).toBe('')
  })

  it('loading a saved session keeps its prompt/translation pair, even when the saved translation text equals the previous one', async () => {
    stubTranslateEndpoint()
    const { result } = renderHook(() => useHarness({ prompt: 'A', translation: 'T' }))
    await waitFor(() => expect(result.current.translation).toBe('T'))
    act(() => result.current.hydrate({ prompt: 'B', translation: 'T' }))
    await waitFor(() => expect(result.current.prompt).toBe('B'))
    expect(result.current.translation).toBe('T')
    expect(result.current.rawTranslation).toBe('T')
    // ...and it is still bound to B: editing B discards it.
    act(() => result.current.edit('B!'))
    await waitFor(() => expect(result.current.rawTranslation).toBe(''))
    expect(pending).toHaveLength(0)
  })

  it('loading a saved session aborts a request that was pending for the previous prompt', async () => {
    stubTranslateEndpoint()
    const { result } = renderHook(() => useHarness({ prompt: 'A', translation: '' }))
    await act(async () => { void result.current.translate() })
    act(() => result.current.hydrate({ prompt: 'B', translation: '' }))
    await waitFor(() => expect(result.current.translating).toBe(false))
    await act(async () => { pending[0].resolve('T(A)') })
    expect(result.current.translation).toBe('')
  })
})
