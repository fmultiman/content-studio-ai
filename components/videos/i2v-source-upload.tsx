'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, Upload } from 'lucide-react'
import { type I2vSourceSelection } from '@/lib/video-generation/i2v-source'
import { sourceAcceptedFormatsCopy, sourceFormatErrorCopy, sourceMaxBytes, sourceMimeFromFile, sourceMimeTypes, sourceSizeErrorCopy, type ImageSourceProfile } from '@/lib/media-source/profile'

// VIDEO_I2V_SOURCE_BROWSER_V1 — "Enviar": a local image becomes a normal LibraryFile and is selected as
// source_library_file_id. It reuses the canonical Library upload (presign -> PUT -> POST /api/library-files), so
// every server-side trust check of migration 046/048 applies. There is NO temporary/disposable upload.

type Stage = 'idle' | 'preparing' | 'sending' | 'saving'

const STAGE_LABEL: Record<Exclude<Stage, 'idle'>, string> = {
  preparing: 'Preparando o envio…',
  sending: 'Enviando a imagem…',
  saving: 'Salvando em Arquivos…',
}

/** In-memory thumbnail for the summary. Cosmetic only: if the browser cannot make one, the summary shows a placeholder. */
function localPreviewUrl(file: File): string | null {
  try {
    return typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null
  } catch {
    return null
  }
}

export const UNSUPPORTED_UPLOAD_COPY = sourceFormatErrorCopy('video-i2v')

export function I2vSourceUpload({
  projectId,
  productionId,
  productionName,
  destinationFolder,
  destinationLabel,
  onUploaded,
  onBusyChange,
  profile = 'video-i2v',
}: {
  projectId: string
  productionId: string | null
  productionName: string | null
  /** Library folder path for the new file: the Arquivos folder in view, otherwise the Project root. */
  destinationFolder: string | null
  destinationLabel: string
  onUploaded: (selection: I2vSourceSelection) => void
  /** Lets the chooser lock tab/close/replace actions while a file is in flight (an upload must end in a selection). */
  onBusyChange?: (busy: boolean) => void
  profile?: ImageSourceProfile
}) {
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const busy = stage !== 'idle'

  const upload = async (file: File) => {
    const mimeType = sourceMimeFromFile(file, profile)
    if (!mimeType) {
      setError(sourceFormatErrorCopy(profile))
      return
    }
    const maxBytes = sourceMaxBytes(profile)
    if (maxBytes !== null && (file.size <= 0 || file.size > maxBytes)) {
      setError(`${sourceSizeErrorCopy(profile).slice(0, -1)} e não pode estar vazia.`)
      return
    }
    if (!destinationFolder) {
      setError('A pasta de destino ainda não está disponível. Tente novamente em instantes.')
      return
    }
    setError(null)
    setStage('preparing')
    onBusyChange?.(true)
    try {
      const presign = await fetch('/api/storage/presign-image-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: 'library', prefix: destinationFolder, mimeType, filename: file.name, ...(profile !== 'video-i2v' ? { profile, projectId, fileSize: file.size } : {}) }),
      })
      const presigned = await presign.json().catch(() => ({}))
      if (!presign.ok || !presigned.uploadUrl) throw new Error('prepare')

      if (mountedRef.current) setStage('sending')
      const sent = await fetch(presigned.uploadUrl, { method: 'PUT', headers: { 'Content-Type': mimeType }, body: file })
      if (!sent.ok) throw new Error('send')

      if (mountedRef.current) setStage('saving')
      const saved = await fetch('/api/library-files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          ...(profile !== 'video-i2v' ? { profile } : {}),
          // Production context is stored as production_id (independent of the folder); the server verifies it.
          ...(productionId ? { productionId } : {}),
          folder: destinationFolder,
          name: file.name,
          kind: 'image',
          mimeType,
          fileSize: file.size,
          storageProvider: presigned.storageProvider,
          storagePath: presigned.storagePath,
          publicUrl: presigned.imageUrl,
          thumbnailUrl: null,
        }),
      })
      const payload = await saved.json().catch(() => ({}))
      if (!saved.ok || !payload?.file?.id) throw new Error('save')

      const preview = localPreviewUrl(file)
      if (!mountedRef.current) return
      setStage('idle')
      onUploaded({
        source: { type: 'library', id: payload.file.id as string },
        summary: { category: 'upload', label: file.name, thumbnailUrl: preview, productionName, folder: destinationLabel },
      })
    } catch {
      if (!mountedRef.current) return
      setStage('idle')
      setError('Não foi possível enviar a imagem. Nada foi alterado. Tente novamente.')
    } finally {
      onBusyChange?.(false)
    }
  }

  return (
    <div className="space-y-3" data-testid="i2v-upload">
      <div className="space-y-1 text-xs text-muted-foreground">
        <p data-testid="i2v-upload-notice">A imagem será adicionada aos seus Arquivos.</p>
        <p className="break-words" data-testid="i2v-upload-destination">
          Destino: Arquivos / {destinationLabel}
          {productionName ? ` · Production: ${productionName}` : ''}
        </p>
        <p>{sourceAcceptedFormatsCopy(profile)}</p>
      </div>

      <label
        htmlFor="i2v-upload-input"
        className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border/70 px-3 py-6 text-center text-xs text-muted-foreground outline-none transition-colors focus-within:ring-2 focus-within:ring-[color:var(--control-focus)] hover:border-primary/60 hover:bg-accent/30 aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
        aria-disabled={busy}
      >
        {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <Upload className="h-5 w-5" aria-hidden="true" />}
        <span className="font-medium text-foreground">{busy ? STAGE_LABEL[stage as Exclude<Stage, 'idle'>] : 'Escolher uma imagem do computador'}</span>
        <input
          ref={inputRef}
          id="i2v-upload-input"
          data-testid="i2v-upload-input"
          type="file"
          accept={sourceMimeTypes(profile).join(',')}
          className="sr-only"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void upload(file)
          }}
        />
      </label>

      {busy && (
        <div className="space-y-1" data-testid="i2v-upload-progress">
          <div className="h-1.5 w-full overflow-hidden rounded bg-muted" role="progressbar" aria-busy="true" aria-label="Enviando imagem">
            <div className="h-full w-1/3 animate-pulse rounded bg-primary" />
          </div>
          <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
            {STAGE_LABEL[stage as Exclude<Stage, 'idle'>]}
          </p>
        </div>
      )}

      {error && (
        <p className="text-xs text-destructive" role="alert" data-testid="i2v-upload-error">
          {error}
        </p>
      )}
    </div>
  )
}
