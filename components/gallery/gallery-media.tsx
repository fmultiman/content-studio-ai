/* eslint-disable @next/next/no-img-element */
'use client'

// STRUCTURAL WAVE 1A-2, STEP S2 - media of Gallery outputs.
//
// The list never carries a displayable URL. Whenever a picture, a player or a download is needed the PER-ITEM authenticated endpoint
// of the output's family is asked for a fresh, transient URL (`item.access`). That URL lives in this component's state only: it is
// never stored with the output, never used as its identity and never reused after the card/dialog goes away. A missing, expired or
// inaccessible file leaves the card in place with an honest message - the history entry is never removed because of its media.

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, ImageIcon, Loader2, RefreshCw, Video as VideoIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { GalleryOutput } from '@/lib/gallery/outputs'
import { describeMediaFailure, downloadFilename, mediaRenderer, readMediaAnswer, type MediaAnswer, type MediaPurpose } from '@/lib/gallery/ui-model'

export type MediaState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; url: string }
  | { status: 'failed'; reason: Extract<MediaAnswer, { ok: false }>['reason'] }

/** Asks the output's own endpoint for a fresh URL. Never throws: every failure is a typed answer. */
export async function fetchMediaUrl(item: Pick<GalleryOutput, 'type' | 'access'>, purpose: MediaPurpose, signal?: AbortSignal): Promise<MediaAnswer> {
  const endpoint = purpose === 'download' ? item.access.downloadEndpoint : item.access.previewEndpoint
  try {
    const response = await fetch(endpoint, { signal, credentials: 'same-origin' })
    let body: unknown = null
    try {
      body = await response.json()
    } catch {
      body = null
    }
    return readMediaAnswer(item.type, response.status, body, purpose)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    return { ok: false, reason: 'failed' }
  }
}

/** Fresh URL for one output while `enabled`. Re-fetched when the output or purpose changes, cleared when it goes away. */
export function useOutputMedia(item: Pick<GalleryOutput, 'key' | 'type' | 'access'> | null, purpose: MediaPurpose, enabled: boolean) {
  const [state, setState] = useState<MediaState>({ status: 'idle' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!item || !enabled) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState({ status: 'idle' })
      return
    }
    const abort = new AbortController()
    setState({ status: 'loading' })
    fetchMediaUrl(item, purpose, abort.signal)
      .then((answer) => {
        if (abort.signal.aborted) return
        setState(answer.ok ? { status: 'ready', url: answer.url } : { status: 'failed', reason: answer.reason })
      })
      .catch(() => undefined)
    return () => abort.abort()
    // The output is identified by its key; the endpoints are a function of it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.key, purpose, enabled, attempt])

  const retry = useCallback(() => setAttempt((value) => value + 1), [])
  return { state, retry }
}

/** True once the element has been near the viewport (or immediately where IntersectionObserver does not exist). */
function useNearViewport() {
  const ref = useRef<HTMLDivElement | null>(null)
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    if (near || !ref.current) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setNear(true)
        observer.disconnect()
      }
    }, { rootMargin: '200px' })
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [near])
  return { ref, near }
}

const TYPE_PLACEHOLDER_TEXT: Record<GalleryOutput['type'], string> = {
  image: 'Imagem indisponível',
  static_render: 'Render indisponível',
  video_generation: 'Vídeo IA',
  video_render: 'Vídeo renderizado',
}

/** The card/list picture. Pictures resolve lazily; videos have no thumbnail infrastructure (deliberately) and show their kind. */
export function GalleryMediaFrame({ output, compact = false }: { output: GalleryOutput; compact?: boolean }) {
  const { ref, near } = useNearViewport()
  const isPicture = mediaRenderer(output) === 'image'
  const { state, retry } = useOutputMedia(output, 'thumbnail', isPicture && near)
  const [broken, setBroken] = useState(0)
  const retried = useRef(false)

  if (!isPicture) {
    return (
      <div ref={ref} className="relative flex aspect-square flex-col items-center justify-center gap-2 bg-muted p-4 text-center text-sm text-muted-foreground" data-testid="gallery-video-placeholder">
        <VideoIcon className={compact ? 'h-5 w-5' : 'h-10 w-10'} />
        {!compact && TYPE_PLACEHOLDER_TEXT[output.type]}
      </div>
    )
  }

  const unavailable = state.status === 'failed' || broken > 1
  return (
    <div ref={ref} className="relative aspect-square bg-muted">
      {state.status === 'ready' && !unavailable ? (
        <img
          src={state.url}
          alt={output.title}
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => {
            // A URL can expire while the page is open: ask for a fresh one once, then show the honest placeholder.
            if (!retried.current) {
              retried.current = true
              retry()
            }
            setBroken((value) => value + 1)
          }}
        />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-sm text-muted-foreground">
          {state.status === 'loading' || state.status === 'idle' ? <Loader2 className={compact ? 'h-4 w-4 animate-spin' : 'h-6 w-6 animate-spin'} aria-hidden /> : <ImageIcon className={compact ? 'h-5 w-5' : 'h-10 w-10'} />}
          {!compact && (state.status === 'loading' || state.status === 'idle' ? 'Carregando…' : TYPE_PLACEHOLDER_TEXT[output.type])}
        </div>
      )}
    </div>
  )
}

/** Large picture / player of the preview dialog, for any family. */
export function GalleryPreviewMedia({ output }: { output: GalleryOutput }) {
  const renderer = mediaRenderer(output)
  const { state, retry } = useOutputMedia(output, 'preview', true)
  // The endpoint answering 200 with a URL does not prove the object exists or is still readable: the element can still fail to
  // load it (object gone, URL expired, storage/network error, playback error). That failure is shown here, for THIS output only
  // (the dialog content is keyed by output, so it can never leak into the next one) and is cleared only by an explicit retry.
  const [elementFailed, setElementFailed] = useState(false)
  const retryWithFreshUrl = () => {
    setElementFailed(false)
    retry() // asks the existing per-item endpoint again: a NEW transient URL, once per click (no automatic retry loop)
  }

  if (state.status === 'idle' || state.status === 'loading') {
    return (
      <div className="flex flex-col items-center gap-3 p-6 text-center text-sm text-muted-foreground" role="status">
        <Loader2 className="h-8 w-8 animate-spin" aria-hidden />
        Carregando prévia...
      </div>
    )
  }
  if (state.status === 'failed' || elementFailed) {
    // Either the endpoint refused (typed reason) or the element could not load/play the object it was given.
    const reason = state.status === 'failed' ? state.reason : 'unavailable'
    return (
      <div className="flex flex-col items-center gap-3 p-6 text-center text-sm text-muted-foreground" role="alert" data-testid="gallery-preview-error">
        <AlertCircle className="h-8 w-8 text-red-400" aria-hidden />
        <p>{describeMediaFailure(reason)}</p>
        <Button variant="outline" size="sm" className="gap-2" onClick={retryWithFreshUrl}>
          <RefreshCw className="h-3 w-3" />
          Tentar novamente
        </Button>
      </div>
    )
  }
  return renderer === 'video' ? (
    // The INLINE endpoint's URL: never the attachment-disposition one that Download uses.
    <video key={`${output.key}:${state.url}`} src={state.url} controls playsInline className="h-full w-full bg-black object-contain" crossOrigin="anonymous" data-testid="gallery-preview-video" onError={() => setElementFailed(true)} />
  ) : (
    <img key={`${output.key}:${state.url}`} src={state.url} alt={output.title} className="max-h-[70vh] w-full object-contain" data-testid="gallery-preview-image" onError={() => setElementFailed(true)} />
  )
}

/**
 * Saves the output through its own download endpoint. Renders and AI videos answer with an attachment-disposition URL (the browser
 * downloads it); AI images answer with the image URL, fetched as a blob so the file gets a real name, with a plain open as fallback.
 *
 * `ok: true` is only returned when the browser action actually happened. Whatever is KNOWN to have failed - the endpoint, the image
 * fetch followed by a blocked pop-up, or a browser that refuses to start the download - is reported as a failure. (Whether the
 * file finally lands on disk after the browser takes over is not observable from a page.)
 */
export async function downloadOutput(output: GalleryOutput): Promise<{ ok: true } | { ok: false; message: string }> {
  const failure = { ok: false as const, message: output.mediaType === 'video' ? 'Não foi possível baixar o vídeo.' : 'Não foi possível baixar o arquivo.' }
  const answer = await fetchMediaUrl(output, 'download')
  if (!answer.ok) return failure
  const anchor = (href: string, name: string) => {
    const link = document.createElement('a')
    link.href = href
    link.download = name
    document.body.appendChild(link)
    try {
      link.click()
    } finally {
      document.body.removeChild(link)
    }
  }
  if (output.type === 'image') {
    try {
      const response = await fetch(answer.url)
      if (!response.ok) throw new Error('image download failed')
      const blob = await response.blob()
      const objectUrl = window.URL.createObjectURL(blob)
      try {
        anchor(objectUrl, downloadFilename(output, blob.type))
      } finally {
        window.URL.revokeObjectURL(objectUrl)
      }
      return { ok: true }
    } catch {
      // Fallback: let the browser open the (signed) image itself. A blocked pop-up is a known failure, not a success.
      let opened: Window | null = null
      try {
        opened = window.open(answer.url, '_blank')
      } catch {
        opened = null
      }
      if (!opened) return { ok: false, message: 'Não foi possível baixar o arquivo: o navegador bloqueou a abertura. Permita pop-ups para este site ou tente novamente.' }
      opened.opener = null
      return { ok: true }
    }
  }
  try {
    anchor(answer.url, '')
  } catch {
    return failure
  }
  return { ok: true }
}
