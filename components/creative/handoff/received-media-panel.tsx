'use client'

// GENERATED_MEDIA_TO_CREATIVE_EDITOR_HANDOFF_V1
//
// "Mídia recebida": the receiving side of the handoff, shared by both Creative Editors.
//
//   OPEN != USE.  Mounting this panel only READS: one GET revalidates the requested LibraryFile on the
//   server (owner, active, same Project the SERVER derives from the editor's real target, kind, trusted path). It never writes,
//   never calls an editor action by itself and holds NO authored state — so the editors' dirty/autosave
//   snapshots (which are derived from authored state only) cannot be affected by it, and a refresh,
//   back/forward or direct deep link simply shows it again without duplicating anything.
//
//   Authoring happens only when the user presses one of the editor-supplied actions. Those actions are
//   the editors' EXISTING Library intake functions; this component does not know what they do.

import { Suspense, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { AlertCircle, Check, FileVideo, ImageIcon, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { HANDOFF_MEDIA_PARAM, parseIncomingMediaParam, receivingTargetQuery, type ReceivingTarget } from '@/lib/creative/handoff/media-handoff'
import type { LibraryFile } from '@/lib/types'

export type ReceivedMediaAction = {
  key: string
  label: string
  /** Names exactly what the action does in this editor, so "opened" is never mistaken for "applied". */
  hint?: string
  run: (file: LibraryFile) => void
}

type Resolution =
  | { id: string; phase: 'valid'; file: LibraryFile }
  | { id: string; phase: 'used'; file: LibraryFile; label: string }
  | { id: string; phase: 'error'; message: string }

/** `target` names the editor's own authoring target (never a bare Project); null until the editor has loaded it. */
export function ReceivedMediaPanel(props: { target: ReceivingTarget | null; actionsFor: (file: LibraryFile) => ReceivedMediaAction[] }) {
  // `useSearchParams` needs a Suspense boundary; the editors themselves must not suspend because of it.
  return <Suspense fallback={null}><ReceivedMediaPanelInner {...props} /></Suspense>
}

function ReceivedMediaPanelInner({ target, actionsFor }: { target: ReceivingTarget | null; actionsFor: (file: LibraryFile) => ReceivedMediaAction[] }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const mediaId = parseIncomingMediaParam(searchParams.get(HANDOFF_MEDIA_PARAM))
  const [resolution, setResolution] = useState<Resolution | null>(null)
  const [dismissedId, setDismissedId] = useState<string | null>(null)
  const applied = useRef<string | null>(null)
  // A stable primitive: an inline target object must not re-run the revalidation on every render.
  const targetKey = target ? receivingTargetQuery(target).toString() : null

  useEffect(() => {
    if (!mediaId || !targetKey) return
    const controller = new AbortController()
    applied.current = null
    void (async () => {
      try {
        const response = await fetch(`/api/library-files/${encodeURIComponent(mediaId)}/handoff-media?${targetKey}`, { signal: controller.signal })
        const payload = await response.json().catch(() => null) as { file?: LibraryFile; error?: string } | null
        if (controller.signal.aborted) return
        if (response.ok && payload?.file) setResolution({ id: mediaId, phase: 'valid', file: payload.file })
        else setResolution({ id: mediaId, phase: 'error', message: payload?.error ?? 'Não foi possível validar a mídia recebida.' })
      } catch (cause) {
        if (controller.signal.aborted || (cause instanceof DOMException && cause.name === 'AbortError')) return
        setResolution({ id: mediaId, phase: 'error', message: 'Não foi possível validar a mídia recebida.' })
      }
    })()
    return () => controller.abort()
  }, [mediaId, targetKey])

  // After an explicit use the param is cleared (navigation hygiene), but the confirmation stays until dismissed.
  const shownId = mediaId ?? (resolution?.phase === 'used' ? resolution.id : null)
  if (!shownId || !targetKey || dismissedId === shownId) return null
  const current = resolution && resolution.id === shownId ? resolution : null

  /** Navigation hygiene only: correctness never depends on the param being cleared. */
  const clearParam = () => {
    const next = new URLSearchParams(searchParams.toString())
    next.delete(HANDOFF_MEDIA_PARAM)
    const query = next.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }
  const dismiss = () => {
    setDismissedId(shownId)
    clearParam()
  }
  const use = (action: ReceivedMediaAction, file: LibraryFile) => {
    // Idempotent per media: a double activation can never apply twice.
    if (applied.current === file.id) return
    applied.current = file.id
    action.run(file)
    setResolution({ id: file.id, phase: 'used', file, label: action.label })
    clearParam()
  }

  return (
    <section className="mb-2 flex min-w-0 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2" role="region" aria-label="Mídia recebida" data-testid="received-media" data-phase={current?.phase ?? 'loading'}>
      {!current ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Validando mídia recebida…</p>
      ) : current.phase === 'error' ? (
        <p className="flex min-w-0 flex-1 items-center gap-2 text-sm text-destructive" role="alert" data-testid="received-media-error"><AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="min-w-0">{current.message}</span></p>
      ) : (
        <>
          <Preview file={current.file} />
          <div className="min-w-0 flex-1 basis-48">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Mídia recebida</p>
            <p className="truncate text-sm font-medium" title={current.file.name} data-testid="received-media-name">{current.file.name}</p>
            <p className="text-xs text-muted-foreground" data-testid="received-media-kind">
              {current.file.kind === 'video' ? 'Vídeo' : 'Imagem'} ·{' '}
              {current.phase === 'used' ? 'Usada neste editor. Clique em Salvar para persistir.' : 'ainda não usada — nada foi alterado no editor.'}
            </p>
          </div>
          {current.phase === 'valid' ? (
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Como usar a mídia recebida">
              {actionsFor(current.file).map((action) => (
                <Button key={action.key} type="button" size="sm" variant="outline" className="h-8 text-xs" title={action.hint} onClick={() => use(action, current.file)} data-testid={`received-media-action-${action.key}`}>{action.label}</Button>
              ))}
            </div>
          ) : (
            <span className="flex items-center gap-1 text-xs text-muted-foreground" data-testid="received-media-used"><Check className="h-3.5 w-3.5" aria-hidden="true" />{current.label}</span>
          )}
        </>
      )}
      <Button type="button" size="icon-sm" variant="ghost" className="ml-auto shrink-0" onClick={dismiss} aria-label="Dispensar mídia recebida" title="Dispensar" data-testid="received-media-dismiss"><X className="h-4 w-4" /></Button>
    </section>
  )
}

function Preview({ file }: { file: LibraryFile }) {
  const [failed, setFailed] = useState(false)
  const url = file.thumbnail_url || file.public_url
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/60 bg-muted" data-testid="received-media-preview">
      {url && !failed ? (
        file.kind === 'video'
          ? <video src={url} muted playsInline preload="metadata" className="h-full w-full object-cover" onError={() => setFailed(true)} aria-label={file.name} />
          // eslint-disable-next-line @next/next/no-img-element -- short-lived presigned display URL, not an optimizable asset
          : <img src={url} alt={file.name} className="h-full w-full object-cover" onError={() => setFailed(true)} />
      ) : file.kind === 'video' ? <FileVideo className="h-5 w-5 text-muted-foreground" aria-hidden="true" /> : <ImageIcon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />}
    </div>
  )
}
