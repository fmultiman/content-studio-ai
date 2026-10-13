'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { requestPromptTranslation } from '@/lib/prompts/translation'

// The caller owns the translation text (so Images can keep persisting it in its working state). This hook adds the
// invariants of the reading view: it is bound to the exact prompt it translated, it is dropped as soon as that
// prompt changes, a late response for an older prompt is discarded, and an existing translation is reused (cache).

export function usePromptTranslation({
  prompt,
  translation,
  setTranslation,
}: {
  prompt: string
  translation: string
  setTranslation: (value: string) => void
}) {
  const [source, setSource] = useState<string | null>(null)
  const [translating, setTranslating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const promptRef = useRef(prompt)
  useEffect(() => { promptRef.current = prompt }, [prompt])
  // The last translation THIS hook produced (or adopted). A different value arriving from the caller (session hydration) is adopted
  // as the translation of the prompt that arrived with it.
  const [own, setOwn] = useState('')

  // Synchronizes the translation's provenance with the prompt/translation owned by the caller.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!translation) {
      if (own !== '') setOwn('')
      if (source !== null) setSource(null)
      return
    }
    if (translation !== own) {
      setOwn(translation)
      requestRef.current += 1
      abortRef.current?.abort()
      setTranslating(false)
      setError(null)
      setSource(prompt)
      return
    }
    if (source !== prompt) {
      // Editing the prompt invalidates the translation and any request still in flight.
      requestRef.current += 1
      abortRef.current?.abort()
      setTranslating(false)
      setError(null)
      setTranslation('')
    }
  }, [translation, prompt, source, own, setTranslation])
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => () => { abortRef.current?.abort() }, [])

  const valid = Boolean(translation) && (translation !== own || source === prompt)

  const translate = useCallback(async () => {
    const text = promptRef.current
    if (!text.trim() || translating) return
    if (translation && valid) return // already available for this exact prompt (cache)
    const id = ++requestRef.current
    const controller = new AbortController()
    abortRef.current?.abort()
    abortRef.current = controller
    setTranslating(true)
    setError(null)
    try {
      const result = await requestPromptTranslation(text, controller.signal)
      if (id !== requestRef.current || promptRef.current !== text) return
      setOwn(result)
      setSource(text)
      setTranslation(result)
    } catch (caught) {
      if (id !== requestRef.current || controller.signal.aborted) return
      setError(caught instanceof Error ? caught.message : 'Não foi possível traduzir o prompt.')
    } finally {
      if (id === requestRef.current) setTranslating(false)
    }
  }, [setTranslation, translating, translation, valid])

  return { translation: valid ? translation : '', translating, error, translate }
}
