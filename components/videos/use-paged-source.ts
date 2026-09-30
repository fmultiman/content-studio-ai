'use client'

import { useCallback, useEffect, useState } from 'react'

// VIDEO_I2V_SOURCE_BROWSER_V1 — one bounded, cursor-paged, race-safe list loader shared by every source category.
//
//  - `url === null` means "not active": nothing is requested and nothing is shown.
//  - the loaded data is stored WITH the request key it belongs to. When the key changes (category / Project /
//    Production / search / folder / retry) the old data is simply no longer "current": the list reads as loading at
//    once, the previous request is aborted, and a late response from an older request can never replace newer data.
//  - "load more" appends the next page and de-duplicates by id; it never auto-fetches the remaining pages.
//  - failure is its own state: it is never displayed as an empty list.

export type PagedState = 'idle' | 'loading' | 'ready' | 'failed'

export interface Page<T> {
  items: T[]
  nextCursor: string | null
}

interface Loaded<T> {
  key: string
  failed: boolean
  items: T[]
  nextCursor: string | null
  isLoadingMore: boolean
  loadMoreFailed: boolean
}

export function usePagedSource<T extends { id: string }>(input: {
  /** First-page URL for the current filters; null while inactive. */
  url: string | null
  /** Builds the next-page URL from the current one and an opaque cursor. Must be referentially stable. */
  withCursor: (url: string, cursor: string) => string
  /** Must be referentially stable (module-level function). */
  parse: (payload: unknown) => Page<T>
}) {
  const { url, withCursor, parse } = input
  const [reloadToken, setReloadToken] = useState(0)
  const [loaded, setLoaded] = useState<Loaded<T> | null>(null)

  const key = url === null ? null : `${reloadToken}|${url}`

  useEffect(() => {
    if (key === null || url === null) return
    const controller = new AbortController()
    fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`status ${response.status}`)
        const page = parse(await response.json())
        if (controller.signal.aborted) return
        setLoaded({ key, failed: false, items: dedupe(page.items), nextCursor: page.nextCursor, isLoadingMore: false, loadMoreFailed: false })
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setLoaded({ key, failed: true, items: [], nextCursor: null, isLoadingMore: false, loadMoreFailed: false })
      })
    return () => controller.abort()
  }, [key, url, parse])

  const current = key !== null && loaded?.key === key ? loaded : null

  const loadMore = useCallback(() => {
    if (!url || !key || !current || current.failed || !current.nextCursor || current.isLoadingMore) return
    const cursor = current.nextCursor
    setLoaded((data) => (data?.key === key ? { ...data, isLoadingMore: true, loadMoreFailed: false } : data))
    fetch(withCursor(url, cursor))
      .then(async (response) => {
        if (!response.ok) throw new Error(`status ${response.status}`)
        const page = parse(await response.json())
        // A different key means the filters changed while this page was in flight: drop it.
        setLoaded((data) => (data?.key === key ? { ...data, items: dedupe([...data.items, ...page.items]), nextCursor: page.nextCursor, isLoadingMore: false } : data))
      })
      .catch(() => {
        setLoaded((data) => (data?.key === key ? { ...data, isLoadingMore: false, loadMoreFailed: true } : data))
      })
  }, [url, key, current, withCursor, parse])

  const reload = useCallback(() => setReloadToken((value) => value + 1), [])

  const state: PagedState = key === null ? 'idle' : !current ? 'loading' : current.failed ? 'failed' : 'ready'

  return {
    items: current?.items ?? [],
    state,
    hasMore: Boolean(current?.nextCursor),
    isLoadingMore: current?.isLoadingMore ?? false,
    loadMoreFailed: current?.loadMoreFailed ?? false,
    loadMore,
    reload,
  }
}

function dedupe<T extends { id: string }>(list: T[]): T[] {
  const seen = new Set<string>()
  return list.filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)))
}
