'use client'

// GENERATED_MEDIA_TO_CREATIVE_EDITOR_HANDOFF_V1
//
// "Abrir no editor" for ONE saved LibraryFile (a generated image/video that was explicitly saved in
// Arquivos). It never promotes media and never creates a target: the user chooses an EXISTING compatible
// authoring target of the file's Project, and navigation carries only the LibraryFile id. Opening the
// editor is not an authoring action (the receiving editor shows "Mídia recebida" and waits).

import { useEffect, useId, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Clapperboard, ImageIcon, Loader2, SquareArrowOutUpRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { handoffCompatibility, type HandoffTargetFamily, type StaticHandoffTarget, type VideoHandoffTarget, type HandoffFileSummary } from '@/lib/creative/handoff/media-handoff'

type TargetsPayload = { file: HandoffFileSummary; static: HandoffTargetFamily<StaticHandoffTarget>; video: HandoffTargetFamily<VideoHandoffTarget> }
type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: TargetsPayload }

export function OpenInEditorButton({ libraryFileId, size = 'default', className }: { libraryFileId: string; size?: 'sm' | 'default'; className?: string }) {
  const [open, setOpen] = useState(false)
  // Mounted on first use only: the closed state costs nothing and needs no router.
  const [everOpened, setEverOpened] = useState(false)
  return (
    <>
      <Button type="button" size={size} variant="outline" className={className ?? 'gap-1'} onClick={() => { setEverOpened(true); setOpen(true) }} data-testid="open-in-editor">
        <SquareArrowOutUpRight className="h-4 w-4" aria-hidden="true" />
        Abrir no editor
      </Button>
      {everOpened ? <OpenInEditorDialog libraryFileId={libraryFileId} open={open} onOpenChange={setOpen} /> : null}
    </>
  )
}

export function OpenInEditorDialog({ libraryFileId, open, onOpenChange }: { libraryFileId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter()
  const headingId = useId()
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setState({ status: 'loading' })
    void (async () => {
      try {
        const response = await fetch(`/api/library-files/${encodeURIComponent(libraryFileId)}/handoff`, { signal: controller.signal })
        const payload = await response.json().catch(() => null) as (TargetsPayload & { error?: string }) | null
        if (controller.signal.aborted) return
        if (!response.ok || !payload?.file) setState({ status: 'error', message: payload?.error ?? 'Não foi possível carregar os destinos.' })
        else setState({ status: 'ready', data: payload })
      } catch (cause) {
        if (controller.signal.aborted || (cause instanceof DOMException && cause.name === 'AbortError')) return
        setState({ status: 'error', message: 'Não foi possível carregar os destinos.' })
      }
    })()
    return () => controller.abort()
  }, [open, libraryFileId])

  const go = (href: string) => {
    onOpenChange(false)
    router.push(href)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-[95vw] max-w-lg flex-col gap-0 p-0" data-testid="open-in-editor-dialog" aria-describedby={`${headingId}-description`}>
        <DialogHeader className="px-6 pb-3 pt-6">
          <DialogTitle>Abrir no editor</DialogTitle>
          <DialogDescription id={`${headingId}-description`}>
            Escolha um destino que já existe neste Projeto. A mídia chega ao editor como “Mídia recebida”: nada é inserido até você escolher como usá-la.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 pb-6" data-testid="open-in-editor-body">
          {state.status === 'loading' ? (
            <div className="flex justify-center py-8" role="status" aria-label="Carregando destinos"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : state.status === 'error' ? (
            <p className="py-6 text-center text-sm text-destructive" role="alert" data-testid="open-in-editor-error">{state.message}</p>
          ) : (
            <TargetLists data={state.data} onGo={go} headingId={headingId} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function TargetLists({ data, onGo, headingId }: { data: TargetsPayload; onGo: (href: string) => void; headingId: string }) {
  const compatibility = handoffCompatibility({ kind: data.file.kind, mime_type: data.file.mimeType })
  const hasStatic = compatibility.static && data.static.items.length > 0
  const hasVideo = compatibility.video && data.video.items.length > 0
  const sameProduction = (productionId: string | null) => Boolean(productionId) && productionId === data.file.productionId

  return (
    <>
      <p className="truncate text-sm text-muted-foreground" title={data.file.name}>
        Mídia: <span className="font-medium text-foreground">{data.file.name}</span>{data.file.productionTitle ? <> · Production: {data.file.productionTitle}</> : null}
      </p>

      {compatibility.static ? (
        <section aria-labelledby={`${headingId}-static`} className="space-y-2" data-testid="handoff-static-targets">
          <h3 id={`${headingId}-static`} className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground"><ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />Editor estático (peças)</h3>
          {hasStatic ? (
            <ul className="space-y-1.5">
              {data.static.items.map((target) => (
                <li key={target.channelPieceId}>
                  <button type="button" onClick={() => onGo(target.href)} className="w-full rounded-md border border-border/60 px-3 py-2 text-left text-sm hover:border-primary/60 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="handoff-static-target" aria-label={`Abrir no editor estático: ${target.title}, ${target.formatLabel}`}>
                    <span className="block truncate font-medium">{target.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{target.editorialContentTitle} · {target.formatLabel}</span>
                    {target.productionTitle ? <span className="block truncate text-xs text-muted-foreground">Production: {target.productionTitle}{sameProduction(target.productionId) ? ' · mesma da mídia' : ''}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted-foreground" data-testid="handoff-static-empty">{data.static.blockedReason === 'PROJECT_IDENTITY_REQUIRED' ? 'O editor estático exige uma Identidade válida no Projeto.' : 'Nenhuma peça estática existente neste Projeto.'}</p>}
          {data.static.truncated ? <p className="text-[11px] text-muted-foreground">Mostrando os conteúdos editoriais mais recentes.</p> : null}
        </section>
      ) : null}

      {compatibility.video ? (
        <section aria-labelledby={`${headingId}-video`} className="space-y-2" data-testid="handoff-video-targets">
          <h3 id={`${headingId}-video`} className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground"><Clapperboard className="h-3.5 w-3.5" aria-hidden="true" />Editor de vídeo (rascunhos)</h3>
          {hasVideo ? (
            <ul className="space-y-1.5">
              {data.video.items.map((target) => (
                <li key={target.draftId}>
                  <button type="button" onClick={() => onGo(target.href)} className="w-full rounded-md border border-border/60 px-3 py-2 text-left text-sm hover:border-primary/60 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="handoff-video-target" aria-label={`Abrir no editor de vídeo: ${target.name}`}>
                    <span className="block truncate font-medium">{target.name}</span>
                    {target.productionTitle ? <span className="block truncate text-xs text-muted-foreground">Production: {target.productionTitle}{sameProduction(target.productionId) ? ' · mesma da mídia' : ''}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted-foreground" data-testid="handoff-video-empty">Nenhum rascunho de vídeo existente neste Projeto.</p>}
          {data.video.truncated ? <p className="text-[11px] text-muted-foreground">Mostrando os rascunhos mais recentes.</p> : null}
        </section>
      ) : null}

      {(compatibility.static || compatibility.video) && !hasStatic && !hasVideo ? (
        <div className="space-y-2 rounded-md border border-dashed border-border/60 p-3 text-sm" data-testid="handoff-empty">
          <p>Nenhum destino compatível existente neste Projeto.</p>
          <Link href={`/projetos/${data.file.projectId}`} className="text-sm underline underline-offset-2">Ir para o Projeto</Link>
        </div>
      ) : null}

      {!compatibility.static && !compatibility.video ? <p className="text-sm text-muted-foreground" data-testid="handoff-unsupported">Este tipo de arquivo não pode ser aberto em um editor.</p> : null}
    </>
  )
}
