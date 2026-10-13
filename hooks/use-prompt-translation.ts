'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { requestPromptTranslation } from '@/lib/prompts/translation'

// The caller owns the translation text (so Images can keep persisting it in its working state). This hook adds the
// invariants of the reading view: it is bound to the exact prompt it translated, it is dropped as soon as that
// prompt changes, a request for an older prompt is aborted and its late response discarded, and an existing
// translation is reused (cache).
//
// `epoch` is the caller's explicit "I just loaded a saved session" signal. Bump it in the same state batch that
// replaces the prompt and the translation: the pair then counts as one translated prompt, even when the saved
// translation text happens to equal the previous one. Without a bump, any prompt change is an edit.

export function usePromptTranslation({
  prompt,
  translation,
  setTranslation,
  epoch = 0,
}: {
  prompt: string
  translation: string
  setTranslation: (value: string) => void
  epoch?: number
}) {
  const [source, setSource] = useState<string | null>(null)
  const [seenEpoch, setSeenEpoch] = useState(epoch)
  const [translating, setTranslating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const inFlightRef = useRef<string | null>(null)
  const promptRef = useRef(prompt)
  useEffect(() => { promptRef.current = prompt }, [prompt])

  const cancelRequest = useCallback(() => {
    requestRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    inFlightRef.current = null
    setTranslating(false)
    setError(null)
  }, [])

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (epoch !== seenEpoch) {
      // A saved session was loaded: whatever came with it belongs to the prompt that came with it.
      setSeenEpoch(epoch)
      cancelRequest()
      setSource(translation ? prompt : null)
      return
    }
    // A request for a prompt that is no longer the current one is stale, with or without a translation yet.
    if (inFlightRef.current !== null && inFlightRef.current !== prompt) cancelRequest()
    if (!translation) {
      if (source !== null) setSource(null)
      return
    }
    if (source !== prompt) {
      // Editing the prompt invalidates the translation.
      cancelRequest()
      setSource(null)
      setTranslation('')
    }
  }, [epoch, seenEpoch, translation, prompt, source, cancelRequest, setTranslation])
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => () => { abortRef.current?.abort() }, [])

  const valid = Boolean(translation) && (source === prompt || epoch !== seenEpoch)

  const translate = useCallback(async () => {
    const text = promptRef.current
    if (!text.trim() || translating) return
    if (translation && valid) return // already available for this exact prompt (cache)
    const id = ++requestRef.current
    const controller = new AbortController()
    abortRef.current?.abort()
    abortRef.current = controller
    inFlightRef.current = text
    setTranslating(true)
    setError(null)
    try {
      const result = await requestPromptTranslation(text, controller.signal)
      if (id !== requestRef.current || promptRef.current !== text) return
      setSource(text)
      setTranslation(result)
    } catch (caught) {
      if (id !== requestRef.current || controller.signal.aborted) return
      setError(caught instanceof Error ? caught.message : 'Não foi possível traduzir o prompt.')
    } finally {
      if (id === requestRef.current) {
        inFlightRef.current = null
        setTranslating(false)
      }
    }
  }, [setTranslation, translating, translation, valid])

  return { translation: valid ? translation : '', translating, error, translate }
}
