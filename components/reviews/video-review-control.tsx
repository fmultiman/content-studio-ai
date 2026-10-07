'use client'

// VIDEO_REVIEW_UI_AND_HISTORY_V1
//
// "Revisar" for ONE video: a button that opens the Video Review history for a typed source and lets the user
// intentionally run a Review. The browser sends only `{ source: { kind, id }, clientRequestId }`; the server
// resolves ownership, storage, MIME, size, duration, provider, model and credentials.
//
//  - History is a READ-ONLY GET: opening the panel never creates an artifact, a Review or a provider call.
//  - One user gesture = one request id. A ref guards the request itself (two clicks in one tick can both see
//    `running === false`), and the id is kept only while the outcome is unknown (a retry then replays); after any
//    definitive answer the next intentional "Revisar novamente" gets a brand-new id.
//  - A missing Gemini credential is explained, with the existing Configurações → API navigation, before any request.
//  - Review is advisory: this control never edits a generation, a prompt, a VideoDraft or a Library file.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ClipboardCheck, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { StateMessage } from '@/components/ui/state-message'
import { useToast } from '@/hooks/use-toast'
import type { VideoReviewSource } from '@/lib/reviews/contracts'
import type { VideoReviewHistoryItem } from '@/lib/reviews/video-review-dto'
import {
  GEMINI_NOT_CONFIGURED_COPY,
  VIDEO_REVIEW_NETWORK_NOTICE,
  VIDEO_REVIEW_POLL_MS,
  describeVideoReviewError,
  isInFlightReview,
  isStaleInFlightReview,
  sourceQuery,
  type VideoReviewNotice,
} from '@/lib/reviews/video-review-presentation'
import { VideoReviewResult } from './video-review-result'

const ENDPOINT = '/api/reviews/video'

type HistoryState = { state: 'idle' | 'loading' | 'ready' | 'error'; items: VideoReviewHistoryItem[] }

function shortDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

export function VideoReviewControl({
  source,
  size = 'sm',
  subjectLabel,
}: {
  source: VideoReviewSource
  size?: 'sm' | 'default'
  /** Optional human name of the video, only used for accessible labels. */
  subjectLabel?: string
}) {
  const { toast } = useToast()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [history, setHistory] = useState<HistoryState>({ state: 'idle', items: [] })
  const [running, setRunning] = useState(false)
  const [notice, setNotice] = useState<VideoReviewNotice | null>(null)
  const [geminiMissing, setGeminiMissing] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  // The request itself is guarded by a ref: two clicks in the same tick can both observe `running === false`.
  const inFlight = useRef(false)
  // The id of the CURRENT submission. Kept only while its outcome is unknown; rotated after any definitive answer.
  const requestId = useRef<string | null>(null)

  const loadHistory = useCallback(async (silent = false) => {
    if (!silent) setHistory((current) => ({ ...current, state: 'loading' }))
    try {
      const response = await fetch(`${ENDPOINT}?${sourceQuery(source)}`, { cache: 'no-store' })
      const payload = await response.json().catch(() => null)
      if (response.ok && Array.isArray(payload?.items)) {
        setHistory({ state: 'ready', items: payload.items as VideoReviewHistoryItem[] })
        setNow(Date.now())
        return
      }
      setHistory((current) => ({ ...current, state: 'error' }))
    } catch {
      setHistory((current) => ({ ...current, state: 'error' }))
    }
  }, [source])

  const loadCredentialState = useCallback(async () => {
    try {
      const response = await fetch('/api/settings/providers')
      if (!response.ok) return
      const payload = await response.json().catch(() => null)
      // Unknown or failed lookups never block the user: the server remains the authority.
      setGeminiMissing(payload?.providers?.gemini?.status === 'missing')
    } catch {
      // keep the previous knowledge
    }
  }, [])

  // Loading is driven by the user's open gesture (not an effect): nothing is requested until the panel is opened.
  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) return
    void loadHistory()
    void loadCredentialState()
  }

  // Slow, bounded refresh while a Review is genuinely in flight (stops once it finishes or looks interrupted).
  const freshInFlight = history.items.some((item) => isInFlightReview(item) && !isStaleInFlightReview(item, now))
  useEffect(() => {
    if (!open || running || !freshInFlight) return
    const timer = setTimeout(() => void loadHistory(true), VIDEO_REVIEW_POLL_MS)
    return () => clearTimeout(timer)
  }, [open, running, freshInFlight, history.items, loadHistory])

  const run = async () => {
    if (inFlight.current) return
    inFlight.current = true
    setRunning(true)
    setNotice(null)
    const clientRequestId = requestId.current ?? crypto.randomUUID()
    requestId.current = clientRequestId
    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, clientRequestId }),
      })
      const payload = await response.json().catch(() => null)
      if (response.ok && payload?.review) {
        requestId.current = null
        toast({ title: 'Revisão concluída', description: 'A revisão do vídeo está disponível no histórico.' })
        await loadHistory(true)
        return
      }
      const next = describeVideoReviewError(response.status, payload)
      if (next.definitive) requestId.current = null
      if (next.kind === 'provider_not_configured') setGeminiMissing(true)
      setNotice(next)
      // A recorded failure or an in-flight Review changes the history; show the truth.
      await loadHistory(true)
    } catch {
      setNotice(VIDEO_REVIEW_NETWORK_NOTICE)
    } finally {
      inFlight.current = false
      setRunning(false)
    }
  }

  const hasCompleted = history.items.some((item) => item.status === 'completed')
  const busy = running || freshInFlight
  const label = busy ? 'Revisão em andamento…' : hasCompleted ? 'Revisar novamente' : 'Revisar vídeo'
  const total = history.items.length

  return (
    <>
      <Button
        type="button"
        size={size}
        variant="outline"
        className="gap-1"
        onClick={() => handleOpenChange(true)}
        aria-label={subjectLabel ? `Revisar ${subjectLabel}` : 'Revisar vídeo'}
        data-testid="video-review-open"
      >
        <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
        Revisar
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        {/* The dialog is a CSS grid: `minmax(0,1fr)` stops a long unbroken word from widening its column, and
            `overflow-wrap:anywhere` (inherited) lets such text actually wrap instead of forcing a sideways scroll. */}
        <DialogContent className="max-h-[90vh] w-[calc(100vw-1.5rem)] max-w-2xl grid-cols-[minmax(0,1fr)] overflow-y-auto [overflow-wrap:anywhere] sm:max-w-2xl" data-testid="video-review-panel">
          <DialogHeader>
            <DialogTitle>Revisão do vídeo</DialogTitle>
            <DialogDescription>
              Avaliação consultiva feita pelo Gemini. Ela não aprova, publica nem altera o vídeo.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {geminiMissing ? (
              <StateMessage
                tone="info"
                title="Configure o Google Gemini"
                description={GEMINI_NOT_CONFIGURED_COPY}
                actionLabel="Abrir Configurações"
                onAction={() => router.push('/configuracoes?tab=api')}
                compact
              />
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" onClick={run} disabled={busy} aria-busy={busy} data-testid="video-review-run">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ClipboardCheck className="h-4 w-4" aria-hidden="true" />}
                  {label}
                </Button>
                {freshInFlight && !running && (
                  <span className="text-xs text-text-secondary" data-testid="video-review-in-progress">
                    Já existe uma revisão em andamento para este vídeo.
                  </span>
                )}
              </div>
            )}

            {notice && notice.kind !== 'provider_not_configured' && (
              <StateMessage
                tone={notice.kind === 'in_progress' ? 'info' : 'error'}
                title={notice.title}
                description={notice.description}
                compact
              />
            )}

            {history.state === 'loading' && history.items.length === 0 && (
              <StateMessage tone="loading" title="Carregando histórico…" compact />
            )}
            {history.state === 'error' && (
              <StateMessage
                tone="error"
                title="Não foi possível carregar o histórico"
                description="Tente novamente."
                actionLabel="Tentar de novo"
                onAction={() => void loadHistory()}
                compact
              />
            )}
            {history.state === 'ready' && total === 0 && (
              <StateMessage
                tone="empty"
                title="Nenhuma revisão ainda"
                description="Use “Revisar vídeo” para pedir a primeira avaliação visual."
                compact
              />
            )}

            {total > 0 && (
              <div className="space-y-3" data-testid="video-review-history">
                {history.items.map((item, index) => {
                  const position = total - index
                  if (index === 0) return <VideoReviewResult key={item.id} item={item} position={position} total={total} nowMs={now} />
                  return (
                    <details key={item.id} className="rounded-lg border border-border-subtle" data-testid={`video-review-older-${item.id}`}>
                      <summary className="cursor-pointer break-words p-3 text-sm">
                        Revisão {position} · {shortDate(item.completedAt ?? item.createdAt)}
                        {item.result ? ` · ${item.result.overall.score}/100` : item.status === 'failed' ? ' · falhou' : ' · em andamento'}
                      </summary>
                      <div className="p-3 pt-0">
                        <VideoReviewResult item={item} position={position} total={total} nowMs={now} />
                      </div>
                    </details>
                  )
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
