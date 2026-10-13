'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { ImageIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { I2vSourceBrowser } from '@/components/videos/i2v-source-browser'
import { I2V_CATEGORY_SUMMARY_LABEL, type I2vSourceSelection } from '@/lib/video-generation/i2v-source'
import type { ImageReference } from '@/lib/images/image-reference'

export { imageReferenceModelReason } from '@/lib/images/image-reference'
export type { ImageReference }
export type ImageReferenceAttempt = { sourceReferences?: ImageReference[] }

export function imageReferenceFromSelection(selection: I2vSourceSelection): ImageReference {
  return { type: selection.source.type === 'generated' ? 'image' : 'library_file', id: selection.source.id }
}

// Display data is resolved afresh from the durable ID. It never enters working state or a generation request.
export function ImageReferencePreview({ reference, projectId, selection }: {
  reference: ImageReference
  projectId: string | null
  selection?: I2vSourceSelection | null
}) {
  const [display, setDisplay] = useState<{ key: string; name: string; url: string | null; origin: string } | null>(null)
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null)
  const key = `${projectId}:${reference.type}:${reference.id}`
  const summary = selection?.source.id === reference.id ? selection.summary : null
  useEffect(() => {
    if (summary || !projectId) return
    const controller = new AbortController()
    const url = reference.type === 'image'
      ? `/api/images/${reference.id}/signed-url`
      : `/api/library-files/${reference.id}/display?${new URLSearchParams({ projectId })}`
    fetch(url, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) return
      const payload = await response.json()
      if (controller.signal.aborted) return
      const file = payload.file
      setDisplay({ key, name: file?.name || 'Imagem gerada por IA', url: payload.imageUrl || file?.thumbnail_url || file?.public_url || null,
        origin: reference.type === 'image' ? 'Gerada por IA' : file?.origin === 'studio_render' ? 'Galeria' : 'Arquivos' })
    }).catch(() => undefined)
    return () => controller.abort()
  }, [key, projectId, reference.id, reference.type, summary])
  const current = display?.key === key ? display : null
  const name = summary?.label || current?.name || 'Imagem de referência'
  const url = summary?.thumbnailUrl || current?.url
  const origin = summary ? I2V_CATEGORY_SUMMARY_LABEL[summary.category] : current?.origin || (reference.type === 'image' ? 'Gerada por IA' : 'Arquivos')
  return (
    <div className="flex min-w-0 items-center gap-3" data-testid="image-reference-preview">
      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
        {url && brokenUrl !== url ? <Image src={url} width={56} height={56} unoptimized alt={`Referência: ${name}`} onError={() => setBrokenUrl(url)} className="h-full w-full object-cover" /> : <ImageIcon className="h-5 w-5 text-muted-foreground" aria-label="Referência sem pré-visualização" />}
      </div>
      <div className="min-w-0"><p className="truncate text-sm font-medium" title={name}>{name}</p><p className="text-xs text-muted-foreground">{origin}</p></div>
    </div>
  )
}

export function ImageReferencePicker({ projectId, productionId, references, selection, onChange, disabled, unavailableReason, mode, onUploadBusyChange }: {
  projectId: string | null
  productionId: string | null
  references: ImageReference[]
  selection: I2vSourceSelection | null
  onChange: (selection: I2vSourceSelection | null) => void
  disabled: boolean
  unavailableReason: string | null
  mode: 'manual' | 'assisted' | 'automatic'
  onUploadBusyChange: (busy: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const [uploadBusy, setUploadBusy] = useState(false)
  const locked = disabled || uploadBusy
  const reference = references[0]
  return (
    <section className="min-w-0 max-w-full space-y-3 rounded-xl border border-border/50 bg-card/30 p-6" aria-label="Imagem de referência" data-testid="image-reference-picker">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">Imagem de referência <span className="text-sm font-normal text-muted-foreground">(opcional)</span></h2>
        <div className="flex min-w-0 max-w-full flex-wrap gap-2" data-testid="image-reference-actions">
          <Button variant="outline" disabled={locked || !projectId || Boolean(unavailableReason)} aria-expanded={open} onClick={() => setOpen(!open)}>{reference ? 'Trocar referência' : 'Escolher referência'}</Button>
          {reference && <Button variant="ghost" disabled={locked} onClick={() => { onChange(null); setOpen(false) }}>Remover referência</Button>}
        </div>
      </div>
      {reference && <ImageReferencePreview reference={reference} projectId={projectId} selection={selection} />}
      <p className="text-xs text-muted-foreground">Uma imagem por geração. PNG, JPEG ou WebP; até 10 MB e 8192 px por lado.</p>
      {!projectId && <p className="text-xs text-muted-foreground">Selecione um projeto para escolher a referência.</p>}
      {unavailableReason && <p className="text-xs text-muted-foreground" role="status">{unavailableReason}</p>}
      {reference && mode !== 'manual' && <p className="text-xs text-muted-foreground" data-testid="image-reference-text-ai-note">A IA de texto não vê a imagem de referência; ela só é enviada ao modelo de imagem</p>}
      {open && projectId && !disabled && !unavailableReason && <I2vSourceBrowser profile="image-reference" projectId={projectId} productionId={productionId} selectedId={reference?.id || null}
        onSelect={(next) => { onChange(next); setOpen(false) }} onClose={() => setOpen(false)} locked={locked}
        onUploadBusyChange={(busy) => { setUploadBusy(busy); onUploadBusyChange(busy) }} />}
    </section>
  )
}

export function ImageAttemptReferences({ references, projectId }: { references?: ImageReference[]; projectId: string | null }) {
  if (!references?.length) return null
  return <div className="space-y-2 rounded-md border border-border/50 p-3" data-testid="image-attempt-references"><p className="text-xs text-muted-foreground">Referência usada nesta tentativa</p>{references.map((reference) => <ImageReferencePreview key={`${reference.type}:${reference.id}`} reference={reference} projectId={projectId} />)}</div>
}
