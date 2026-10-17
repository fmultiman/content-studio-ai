'use client'

// STRUCTURAL WAVE 1A-2, STEP S2 - the Gallery's single data source: GET /api/gallery/outputs.
//
//   * the server filters (type / Project / Production) restart the list: pagination is reset and EVERY request still in flight for
//     the previous filters is aborted and, should it still answer, ignored (a request generation guards every state write);
//   * "Carregar mais" continues with the cursor the API returned, never with a guess; a second click while one is running is a no-op;
//   * pages are merged by typed output key, so an output is never two cards;
//   * a failed source keeps the loaded outputs, is reported by name, and the same cursor retries it (the API keeps it open);
//   * a total is only what the API said was exact, and it comes from the first page of the CURRENT filters.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type GalleryOutput, type GalleryOutputType, type GallerySourceState, type GalleryTotals } from '@/lib/gallery/outputs'
import { isOutputsResponse, mergeOutputs, outputsQuery, serverFilterKey, type ServerFilters } from '@/lib/gallery/ui-model'

export type GalleryPhase = 'loading' | 'ready' | 'error'

export interface GalleryOutputsState {
  /** The request (filters + reload) this state answers. A state of another request is never shown. */
  requestKey: string
  items: GalleryOutput[]
  phase: GalleryPhase
  /** Why the FIRST page failed as a whole (nothing could be loaded). */
  errorMessage: string | null
  /** The last "Carregar mais" failed; the loaded outputs are untouched. */
  loadMoreError: string | null
  loadingMore: boolean
  /** The collection (for these filters) has more outputs than are loaded, or a failed source still owes some. */
  hasMore: boolean
  partial: boolean
  sources: Partial<Record<GalleryOutputType, GallerySourceState>> | null
  totals: GalleryTotals | null
}

const INITIAL: GalleryOutputsState = { requestKey: '', items: [], phase: 'loading', errorMessage: null, loadMoreError: null, loadingMore: false, hasMore: false, partial: false, sources: null, totals: null }

interface PageResult {
  ok: boolean
  status: number
  body: unknown
}

async function requestPage(query: string, signal: AbortSignal): Promise<PageResult> {
  const response = await fetch(`/api/gallery/outputs${query}`, { signal, credentials: 'same-origin' })
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    body = null
  }
  return { ok: response.ok, status: response.status, body }
}

export function useGalleryOutputs(filters: ServerFilters) {
  const [state, setState] = useState<GalleryOutputsState>(INITIAL)
  const [reloadToken, setReloadToken] = useState(0)
  const generation = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const cursor = useRef<string | null>(null)
  const loadingMore = useRef(false)
  const filterKey = serverFilterKey(filters)
  // The filters' identity is their key: the object only changes when a filter really changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableFilters = useMemo(() => filters, [filterKey])
  const requestKey = `${filterKey}#${reloadToken}`

  // First page of the current server filters. Runs on mount, on every server-filter change and on an explicit reload.
  useEffect(() => {
    const mine = ++generation.current
    controller.current?.abort()
    const abort = new AbortController()
    controller.current = abort
    cursor.current = null
    loadingMore.current = false

    requestPage(outputsQuery(stableFilters, { totals: true }), abort.signal)
      .then((result) => {
        if (generation.current !== mine) return // a newer filter/reload owns the screen
        if (isOutputsResponse(result.body)) {
          const body = result.body
          cursor.current = body.nextCursor
          // The API answers 503 with the full envelope when EVERY source failed: still an incomplete list, never an empty Gallery.
          setState({
            requestKey,
            items: mergeOutputs([], body.items),
            phase: result.ok ? 'ready' : 'error',
            errorMessage: result.ok ? null : 'Não foi possível carregar a Galeria agora.',
            loadMoreError: null,
            loadingMore: false,
            hasMore: body.nextCursor !== null,
            partial: body.partial,
            sources: body.sources,
            totals: body.totals ?? null,
          })
          return
        }
        setState({ ...INITIAL, requestKey, phase: 'error', errorMessage: 'Não foi possível carregar a Galeria agora.' })
      })
      .catch((error: unknown) => {
        if (generation.current !== mine || (error instanceof DOMException && error.name === 'AbortError')) return
        setState({ ...INITIAL, requestKey, phase: 'error', errorMessage: 'Não foi possível carregar a Galeria agora.' })
      })

    return () => abort.abort()
  }, [stableFilters, requestKey])

  const loadMore = useCallback(() => {
    const next = cursor.current
    if (!next || loadingMore.current) return
    const mine = generation.current
    const abort = new AbortController()
    controller.current = abort
    loadingMore.current = true
    setState((current) => (current.requestKey === requestKey ? { ...current, loadingMore: true, loadMoreError: null } : current))

    requestPage(outputsQuery(stableFilters, { cursor: next }), abort.signal)
      .then((result) => {
        if (generation.current !== mine) return
        loadingMore.current = false
        if (isOutputsResponse(result.body) && result.ok) {
          const body = result.body
          cursor.current = body.nextCursor
          setState((current) => current.requestKey !== requestKey ? current : ({
            ...current,
            items: mergeOutputs(current.items, body.items),
            loadingMore: false,
            hasMore: body.nextCursor !== null,
            partial: body.partial,
            sources: body.sources,
            loadMoreError: null,
          }))
          return
        }
        // The loaded outputs stay exactly as they were; the cursor is kept so the same click can be retried.
        setState((current) => (current.requestKey === requestKey ? { ...current, loadingMore: false, loadMoreError: 'Não foi possível carregar mais outputs agora.' } : current))
      })
      .catch((error: unknown) => {
        if (generation.current !== mine || (error instanceof DOMException && error.name === 'AbortError')) return
        loadingMore.current = false
        setState((current) => (current.requestKey === requestKey ? { ...current, loadingMore: false, loadMoreError: 'Não foi possível carregar mais outputs agora.' } : current))
      })
  }, [stableFilters, requestKey])

  const reload = useCallback(() => setReloadToken((value) => value + 1), [])

  // A state that answers another request (older filters, before a reload) is never shown: the new request starts from "loading".
  return useMemo(
    () => ({ ...(state.requestKey === requestKey ? state : { ...INITIAL, requestKey }), loadMore, reload }),
    [state, requestKey, loadMore, reload],
  )
}
