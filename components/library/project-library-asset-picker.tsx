'use client'

import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { LibraryFile, LibraryFileKind } from '@/lib/types'
import { FileAudio, FileText, FileVideo, ImageIcon, Loader2 } from 'lucide-react'

type ProjectLibraryAssetPickerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string | null
  selectedId?: string | null
  allowedKinds?: LibraryFileKind[]
  onSelect: (file: LibraryFile) => void
}

const DEFAULT_ALLOWED_KINDS: LibraryFileKind[] = ['image']

export function filterProjectLibraryFiles(
  files: LibraryFile[],
  projectId: string,
  allowedKinds: LibraryFileKind[],
): LibraryFile[] {
  const allowed = new Set(allowedKinds)
  return files.filter((file) => file.project_id === projectId && allowed.has(file.kind) && file.deleted_at === null)
}

function KindIcon({ kind }: { kind: LibraryFileKind }) {
  if (kind === 'video') return <FileVideo className="h-7 w-7 text-muted-foreground" />
  if (kind === 'audio') return <FileAudio className="h-7 w-7 text-muted-foreground" />
  if (kind === 'document') return <FileText className="h-7 w-7 text-muted-foreground" />
  return <ImageIcon className="h-7 w-7 text-muted-foreground" />
}

function formatFileSize(bytes: number | null): string | null {
  if (bytes == null) return null
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function LibraryAssetCard({
  file,
  selected,
  onSelect,
}: {
  file: LibraryFile
  selected: boolean
  onSelect: () => void
}) {
  const [imageError, setImageError] = useState(false)
  const previewUrl = file.thumbnail_url || (file.kind === 'image' ? file.public_url : null)
  const fileSize = formatFileSize(file.file_size)

  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        'relative flex flex-col overflow-hidden rounded-md border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected
          ? 'border-primary bg-primary/10 ring-1 ring-primary'
          : 'border-border/50 hover:border-primary/60 hover:bg-accent/30',
      ].join(' ')}
      aria-pressed={selected}
    >
      <div className="relative aspect-square bg-muted">
        {previewUrl && !imageError ? (
          <img
            src={previewUrl}
            alt={file.name}
            className="h-full w-full object-cover"
            onError={() => setImageError(true)}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <KindIcon kind={file.kind} />
          </div>
        )}
        {selected && (
          <Badge className="absolute right-1 top-1 px-1 py-0 text-[9px]">
            Selecionado
          </Badge>
        )}
      </div>
      <p className="line-clamp-2 px-1.5 pt-1 text-[11px] text-muted-foreground">
        {file.name}
      </p>
      {fileSize && (
        <p className="px-1.5 pb-1 text-[10px] text-muted-foreground/60">{fileSize}</p>
      )}
    </button>
  )
}

export function ProjectLibraryAssetPicker({
  open,
  onOpenChange,
  projectId,
  selectedId,
  allowedKinds = DEFAULT_ALLOWED_KINDS,
  onSelect,
}: ProjectLibraryAssetPickerProps) {
  const [files, setFiles] = useState<LibraryFile[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    if (!projectId) {
      setFiles([])
      setError('Selecione um Projeto para escolher um asset da Biblioteca.')
      return
    }

    const controller = new AbortController()
    const loadFiles = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const query = new URLSearchParams({ projectId })
        if (allowedKinds.length === 1) query.set('kind', allowedKinds[0])
        const response = await fetch(`/api/library-files?${query.toString()}`, {
          signal: controller.signal,
        })
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.error || 'Não foi possível carregar a Biblioteca.')
        setFiles(filterProjectLibraryFiles(payload.files || [], projectId, allowedKinds))
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === 'AbortError') return
        setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar a Biblioteca.')
      } finally {
        if (!controller.signal.aborted) setIsLoading(false)
      }
    }

    loadFiles()
    return () => controller.abort()
  }, [allowedKinds, open, projectId])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] max-w-3xl flex-col gap-0 p-0">
        <DialogHeader className="px-6 pb-3 pt-6">
          <DialogTitle>Escolher asset da Biblioteca</DialogTitle>
          <DialogDescription>
            Selecione uma imagem do Projeto atual. O asset será associado à cena, sem copiar o arquivo.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto px-6 pb-6">
          {isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <p className="py-10 text-center text-sm text-muted-foreground">{error}</p>
          ) : files.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Nenhuma imagem disponível neste Projeto.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {files.map((file) => (
                <LibraryAssetCard
                  key={file.id}
                  file={file}
                  selected={file.id === selectedId}
                  onSelect={() => {
                    onSelect(file)
                    onOpenChange(false)
                  }}
                />
              ))}
            </div>
          )}
          <Button type="button" variant="ghost" className="mt-4" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
