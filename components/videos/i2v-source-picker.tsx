'use client'

import { useState } from 'react'
import { ImageIcon, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { I2vSourceBrowser } from '@/components/videos/i2v-source-browser'
import { I2V_CATEGORY_SUMMARY_LABEL, type I2vSourceSelection } from '@/lib/video-generation/i2v-source'

// VIDEO_I2V_SOURCE_BROWSER_V1
//
// "Imagem de Origem" as a COMPACT field:
//   nothing chosen -> [ Escolher uma imagem ]
//   chosen         -> thumbnail + name + origin + context, with [ Trocar ] and a remove action
// The full source browser (Geradas por IA | Galeria | Arquivos | Enviar) is an inline panel that opens on demand and
// collapses as soon as an image is chosen, so it never permanently occupies the generation form.
// This component owns NO source state of its own: the form owns the selection (Project-bound, XOR identity) and
// this only reports a stable id + class. No storage path, signed URL or database field name is ever shown.

interface I2vSourcePickerProps {
  projectId: string
  productionId: string | null
  value: I2vSourceSelection | null
  onChange: (selection: I2vSourceSelection | null) => void
}

export function I2vSourcePicker({ projectId, productionId, value, onChange }: I2vSourcePickerProps) {
  const [open, setOpen] = useState(false)
  const [thumbBroken, setThumbBroken] = useState(false)
  // While a chooser upload is in flight, opening/closing/replacing/removing is locked: an upload must end in a selection.
  const [uploadBusy, setUploadBusy] = useState(false)

  const choose = (selection: I2vSourceSelection) => {
    setThumbBroken(false)
    onChange(selection)
    setOpen(false)
  }

  const summary = value?.summary ?? null
  const context = summary ? [summary.productionName ?? null, summary.folder ? `Arquivos / ${summary.folder}` : null].filter(Boolean).join(' · ') : ''

  return (
    <div className="min-w-0 max-w-full space-y-2" data-testid="i2v-source-picker">
      <Label id="i2v-source-label">Imagem de Origem</Label>

      {!summary ? (
        <Button
          type="button"
          variant="outline"
          className="w-full justify-start gap-2"
          aria-expanded={open}
          aria-controls="i2v-source-browser-region"
          disabled={uploadBusy}
          onClick={() => setOpen((current) => !current)}
          data-testid="i2v-source-choose"
        >
          <ImageIcon className="h-4 w-4" aria-hidden="true" />
          Escolher uma imagem
        </Button>
      ) : (
        <div className="flex min-w-0 items-center gap-3 rounded-md border border-border/60 p-2" data-testid="i2v-source-summary" data-category={summary.category}>
          <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
            {summary.thumbnailUrl && !thumbBroken ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={summary.thumbnailUrl} alt={`Imagem de origem: ${summary.label}`} onError={() => setThumbBroken(true)} className="h-full w-full object-cover" />
            ) : (
              <ImageIcon className="h-5 w-5 text-muted-foreground" role="img" aria-label="Sem pré-visualização" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium" title={summary.label} data-testid="i2v-source-summary-name">{summary.label}</p>
            <p className="truncate text-xs text-muted-foreground" data-testid="i2v-source-summary-category">{I2V_CATEGORY_SUMMARY_LABEL[summary.category]}</p>
            {context && <p className="truncate text-xs text-muted-foreground" title={context} data-testid="i2v-source-summary-context">{context}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button type="button" size="sm" variant="outline" aria-expanded={open} aria-controls="i2v-source-browser-region" disabled={uploadBusy} onClick={() => setOpen((current) => !current)} data-testid="i2v-source-change">
              Trocar
            </Button>
            <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label="Remover imagem de origem" disabled={uploadBusy} onClick={() => { onChange(null); setOpen(false) }} data-testid="i2v-source-clear">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {open && (
        <div id="i2v-source-browser-region">
          <I2vSourceBrowser
            projectId={projectId}
            productionId={productionId}
            selectedId={value?.source.id ?? null}
            onSelect={choose}
            onClose={() => setOpen(false)}
            locked={uploadBusy}
            onUploadBusyChange={setUploadBusy}
          />
        </div>
      )}

      {!summary && !open && (
        <p className="text-xs text-muted-foreground" data-testid="i2v-source-hint">
          Escolha uma imagem gerada por IA, da Galeria, dos Arquivos ou envie uma do seu computador.
        </p>
      )}
    </div>
  )
}
