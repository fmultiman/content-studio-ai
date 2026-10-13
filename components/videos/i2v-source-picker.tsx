'use client'

import { useState } from 'react'
import { ImageIcon, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { I2vSourceBrowser } from '@/components/videos/i2v-source-browser'
import { I2V_CATEGORY_SUMMARY_LABEL, type I2vSourceSelection } from '@/lib/video-generation/i2v-source'
import type { ImageSourceProfile } from '@/lib/media-source/profile'

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
  profile?: ImageSourceProfile
  /**
   * VEO_KLING_FIRST_LAST_FRAME_V1: the same chooser serves the first frame (default, unchanged ids/labels) and the
   * optional last frame. A distinct prefix keeps every id and test id unique when both are on screen.
   */
  idPrefix?: string
  label?: string
  chooseLabel?: string
  hint?: string
  /** Text for the thumbnail alt / remove action, e.g. "Imagem de origem" / "Imagem final". */
  noun?: string
  /** Shown under the compact field when set (e.g. why the frame cannot be used with the current model). */
  note?: string | null
  disabled?: boolean
}

export function I2vSourcePicker({
  projectId,
  productionId,
  value,
  onChange,
  profile = 'video-i2v',
  idPrefix = 'i2v-source',
  label = 'Imagem de Origem',
  chooseLabel = 'Escolher uma imagem',
  hint = 'Escolha uma imagem gerada por IA, da Galeria, dos Arquivos ou envie uma do seu computador.',
  noun = 'Imagem de origem',
  note = null,
  disabled = false,
}: I2vSourcePickerProps) {
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
    <div className="min-w-0 max-w-full space-y-2" data-testid={`${idPrefix}-picker`}>
      <Label id={`${idPrefix}-label`}>{label}</Label>

      {!summary ? (
        <Button
          type="button"
          variant="outline"
          className="w-full justify-start gap-2"
          aria-expanded={open}
          aria-controls={`${idPrefix}-browser-region`}
          disabled={uploadBusy || disabled}
          onClick={() => setOpen((current) => !current)}
          data-testid={`${idPrefix}-choose`}
        >
          <ImageIcon className="h-4 w-4" aria-hidden="true" />
          {chooseLabel}
        </Button>
      ) : (
        <div className="flex min-w-0 items-center gap-3 rounded-md border border-border/60 p-2" data-testid={`${idPrefix}-summary`} data-category={summary.category}>
          <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
            {summary.thumbnailUrl && !thumbBroken ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={summary.thumbnailUrl} alt={`${noun}: ${summary.label}`} onError={() => setThumbBroken(true)} className="h-full w-full object-cover" />
            ) : (
              <ImageIcon className="h-5 w-5 text-muted-foreground" role="img" aria-label="Sem pré-visualização" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium" title={summary.label} data-testid={`${idPrefix}-summary-name`}>{summary.label}</p>
            <p className="truncate text-xs text-muted-foreground" data-testid={`${idPrefix}-summary-category`}>{I2V_CATEGORY_SUMMARY_LABEL[summary.category]}</p>
            {context && <p className="truncate text-xs text-muted-foreground" title={context} data-testid={`${idPrefix}-summary-context`}>{context}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button type="button" size="sm" variant="outline" aria-expanded={open} aria-controls={`${idPrefix}-browser-region`} disabled={uploadBusy || disabled} onClick={() => setOpen((current) => !current)} data-testid={`${idPrefix}-change`}>
              Trocar
            </Button>
            <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label={`Remover ${noun.toLowerCase()}`} disabled={uploadBusy || disabled} onClick={() => { onChange(null); setOpen(false) }} data-testid={`${idPrefix}-clear`}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {open && (
        <div id={`${idPrefix}-browser-region`}>
          <I2vSourceBrowser
            profile={profile}
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
        <p className="text-xs text-muted-foreground" data-testid={`${idPrefix}-hint`}>
          {hint}
        </p>
      )}
      {note && (
        <p className="text-xs text-destructive" role="alert" data-testid={`${idPrefix}-note`}>
          {note}
        </p>
      )}
    </div>
  )
}
