'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/hooks/use-toast'
import type { ChannelPieceMediaResolved, Image as ImageType, LibraryFile, LibraryFileKind } from '@/lib/types'
import { FileText, ImageIcon, Loader2, Music, Upload, Video, X } from 'lucide-react'

// ─── Sub-icons ────────────────────────────────────────────────────────────────

function KindIcon({ kind }: { kind: LibraryFileKind }) {
  if (kind === 'video') return <Video className="h-7 w-7 text-muted-foreground" />
  if (kind === 'audio') return <Music className="h-7 w-7 text-muted-foreground" />
  if (kind === 'document') return <FileText className="h-7 w-7 text-muted-foreground" />
  return <ImageIcon className="h-7 w-7 text-muted-foreground" />
}

// ─── Gallery card ─────────────────────────────────────────────────────────────

interface GalleryCardProps {
  img: ImageType
  isDupe: boolean
  isAssigning: boolean
  disabled: boolean
  onSelect: () => void
}

function GalleryCard({ img, isDupe, isAssigning, disabled, onSelect }: GalleryCardProps) {
  const [imgError, setImgError] = useState(false)
  const src = img.thumbnail_url || img.image_url

  return (
    <button
      type="button"
      disabled={isDupe || disabled}
      onClick={onSelect}
      className={[
        'relative flex flex-col overflow-hidden rounded-md border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isDupe
          ? 'cursor-not-allowed border-border/30 opacity-50'
          : disabled
            ? 'cursor-not-allowed border-border/30 opacity-60'
            : 'cursor-pointer border-border/50 hover:border-primary/60 hover:bg-accent/30',
      ].join(' ')}
    >
      <div className="relative aspect-square bg-muted">
        {src && !imgError ? (
          <img
            src={src}
            alt={img.user_input}
            className="h-full w-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <ImageIcon className="h-7 w-7 text-muted-foreground/40" />
          </div>
        )}
        {isAssigning && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/70">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}
        {isDupe && (
          <Badge className="absolute right-1 top-1 px-1 py-0 text-[9px]">
            Adicionada
          </Badge>
        )}
      </div>
      <p className="line-clamp-2 px-1.5 py-1 text-[11px] text-muted-foreground">
        {img.user_input}
      </p>
    </button>
  )
}

// ─── Library card ─────────────────────────────────────────────────────────────

interface LibraryCardProps {
  file: LibraryFile
  isDupe: boolean
  isAssigning: boolean
  disabled: boolean
  onSelect: () => void
}

function LibraryCard({ file, isDupe, isAssigning, disabled, onSelect }: LibraryCardProps) {
  const [imgError, setImgError] = useState(false)
  const thumbSrc = file.thumbnail_url || (file.kind === 'image' ? file.public_url : null)

  return (
    <button
      type="button"
      disabled={isDupe || disabled}
      onClick={onSelect}
      className={[
        'relative flex flex-col overflow-hidden rounded-md border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isDupe
          ? 'cursor-not-allowed border-border/30 opacity-50'
          : disabled
            ? 'cursor-not-allowed border-border/30 opacity-60'
            : 'cursor-pointer border-border/50 hover:border-primary/60 hover:bg-accent/30',
      ].join(' ')}
    >
      <div className="relative aspect-square bg-muted">
        {thumbSrc && !imgError ? (
          <img
            src={thumbSrc}
            alt={file.name}
            className="h-full w-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <KindIcon kind={file.kind} />
          </div>
        )}
        {isAssigning && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/70">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}
        {isDupe && (
          <Badge className="absolute right-1 top-1 px-1 py-0 text-[9px]">
            Adicionado
          </Badge>
        )}
        {file.kind === 'video' && !isDupe && (
          <Badge variant="secondary" className="absolute left-1 bottom-1 px-1 py-0 text-[9px]">
            Vídeo
          </Badge>
        )}
      </div>
      <p className="line-clamp-2 px-1.5 pt-1 text-[11px] text-muted-foreground">
        {file.name}
      </p>
      {file.file_size != null && (
        <p className="px-1.5 pb-1 text-[10px] text-muted-foreground/60">
          {formatFileSize(file.file_size)}
        </p>
      )}
    </button>
  )
}

// ─── Main dialog ──────────────────────────────────────────────────────────────

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  channelPieceId: string
  currentItems: ChannelPieceMediaResolved[]
  onAssociated: () => void
}

const ACCEPTED_MIME = 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime'
const ALLOWED_UPLOAD_MIMES = new Set(ACCEPTED_MIME.split(','))
const MAX_UPLOAD_MB = 50

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function MediaPickerDialog({
  open,
  onOpenChange,
  projectId,
  channelPieceId,
  currentItems,
  onAssociated,
}: Props) {
  const { toast } = useToast()

  // Tab state
  const [tab, setTab] = useState<'galeria' | 'biblioteca' | 'envio'>('galeria')

  // Galeria state
  const [images, setImages] = useState<ImageType[]>([])
  const [loadingGaleria, setLoadingGaleria] = useState(false)
  const [galeriaError, setGaleriaError] = useState<string | null>(null)

  // Biblioteca state
  const [files, setFiles] = useState<LibraryFile[]>([])
  const [loadingBiblioteca, setLoadingBiblioteca] = useState(false)
  const [bibliotecaError, setBibliotecaError] = useState<string | null>(null)
  const [kindFilter, setKindFilter] = useState<'all' | 'image' | 'video'>('all')

  // Association spinner (galeria + biblioteca tabs)
  const [assigningId, setAssigningId] = useState<string | null>(null)
  const isAssigningRef = useRef(false)

  // Upload state (envio tab)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const isUploadingRef = useRef(false)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const nextRole = currentItems.some((i) => i.role === 'primary') ? 'carousel_item' : 'primary'
  const nextPosition =
    currentItems.length > 0
      ? Math.max(...currentItems.map((i) => i.position)) + 1
      : 0

  // Load galeria on open or tab switch (cached after first load)
  useEffect(() => {
    if (!open || tab !== 'galeria' || images.length > 0 || loadingGaleria) return
    setLoadingGaleria(true)
    setGaleriaError(null)
    const supabase = createClient()
    supabase
      .from('images')
      .select('id, image_url, thumbnail_url, storage_path, thumbnail_path, user_input, status, project_id')
      .eq('project_id', projectId)
      .order('updated_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) setGaleriaError('Erro ao carregar imagens.')
        else setImages((data as ImageType[]) ?? [])
        setLoadingGaleria(false)
      })
  }, [open, tab, projectId, images.length, loadingGaleria])

  // Load biblioteca on tab switch (cached after first load)
  useEffect(() => {
    if (!open || tab !== 'biblioteca' || files.length > 0 || loadingBiblioteca) return
    setLoadingBiblioteca(true)
    setBibliotecaError(null)
    fetch(`/api/library-files?projectId=${encodeURIComponent(projectId)}`)
      .then((r) => r.json())
      .then((d) => {
        setFiles(d.files ?? [])
        setLoadingBiblioteca(false)
      })
      .catch(() => {
        setBibliotecaError('Erro ao carregar arquivos.')
        setLoadingBiblioteca(false)
      })
  }, [open, tab, projectId, files.length, loadingBiblioteca])

  // Reset all state when dialog closes
  useEffect(() => {
    if (open) return
    setImages([])
    setFiles([])
    setGaleriaError(null)
    setBibliotecaError(null)
    setAssigningId(null)
    isAssigningRef.current = false
    setTab('galeria')
    setKindFilter('all')
    // Upload state
    setSelectedFile(null)
    setUploadError(null)
    setIsUploading(false)
    isUploadingRef.current = false
    setIsDragging(false)
  }, [open])

  // Block closing dialog during upload
  const handleOpenChange = (v: boolean) => {
    if (!v && isUploading) return
    onOpenChange(v)
  }

  const isDuplicateImage = (imageId: string) =>
    currentItems.some((i) => i.image_id === imageId)

  const isDuplicateFile = (fileId: string) =>
    currentItems.some((i) => i.library_file_id === fileId)

  // Associate existing image or library file (galeria + biblioteca tabs)
  const associate = async (
    body: { imageId?: string; libraryFileId?: string },
    idForSpinner: string,
  ) => {
    if (isAssigningRef.current) return
    isAssigningRef.current = true
    setAssigningId(idForSpinner)
    try {
      const res = await fetch('/api/channel-piece-media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelPieceId,
          role: nextRole,
          position: nextPosition,
          ...body,
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error((d as { error?: string }).error || 'Erro ao associar mídia')
      onAssociated()
      toast({
        title: 'Mídia associada',
        description:
          nextRole === 'primary'
            ? 'Definida como Principal.'
            : 'Adicionada como Item de carrossel.',
      })
      onOpenChange(false)
    } catch (err) {
      toast({
        title: 'Erro ao associar',
        description: err instanceof Error ? err.message : 'Tente novamente.',
        variant: 'destructive',
      })
    } finally {
      isAssigningRef.current = false
      setAssigningId(null)
    }
  }

  // Validate and set a file for upload
  const handleFileSelect = (file: File) => {
    setUploadError(null)
    if (!ALLOWED_UPLOAD_MIMES.has(file.type)) {
      setUploadError('Arquivo não suportado. Formatos aceitos: JPEG, PNG, WebP, GIF, MP4, WebM, MOV.')
      return
    }
    if (file.size === 0) {
      setUploadError('Arquivo não pode ser vazio.')
      return
    }
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      setUploadError(`O arquivo excede o limite de ${MAX_UPLOAD_MB} MB.`)
      return
    }
    setSelectedFile(file)
  }

  // Upload the selected file (envio tab)
  const handleUpload = async () => {
    if (!selectedFile || isUploadingRef.current) return
    isUploadingRef.current = true
    setIsUploading(true)
    setUploadError(null)

    const formData = new FormData()
    formData.append('file', selectedFile)
    formData.append('channelPieceId', channelPieceId)

    try {
      const res = await fetch('/api/channel-piece-media/upload', {
        method: 'POST',
        body: formData,
      })
      const d = await res.json()
      if (!res.ok) throw new Error((d as { error?: string }).error || 'Não foi possível enviar o arquivo.')
      onAssociated()
      toast({
        title: 'Arquivo enviado',
        description: 'Mídia adicionada à versão com sucesso.',
      })
      onOpenChange(false)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Não foi possível enviar o arquivo.')
    } finally {
      isUploadingRef.current = false
      setIsUploading(false)
    }
  }

  const anyBusy = !!assigningId || isUploading

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[80vh] max-w-3xl flex-col gap-0 p-0">
        <DialogHeader className="px-6 pb-3 pt-6">
          <DialogTitle>Adicionar mídia</DialogTitle>
          <DialogDescription>
            Escolha uma imagem gerada, um arquivo existente ou envie um novo arquivo.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={tab}
          onValueChange={(v) => !anyBusy && setTab(v as typeof tab)}
          className="flex min-h-0 flex-1 flex-col gap-0"
        >
          <TabsList className="mx-6 mb-3 w-fit">
            <TabsTrigger value="galeria" disabled={anyBusy}>Imagens geradas</TabsTrigger>
            <TabsTrigger value="biblioteca" disabled={anyBusy}>Arquivos do projeto</TabsTrigger>
            <TabsTrigger value="envio" disabled={anyBusy}>Enviar arquivo</TabsTrigger>
          </TabsList>

          {/* ── Galeria ── */}
          <TabsContent value="galeria" className="mt-0 min-h-0 flex-1 overflow-auto px-6 pb-6">
            {loadingGaleria ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : galeriaError ? (
              <p className="py-10 text-center text-sm text-muted-foreground">{galeriaError}</p>
            ) : images.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Nenhuma imagem gerada para este projeto.
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                {images.map((img) => (
                  <GalleryCard
                    key={img.id}
                    img={img}
                    isDupe={isDuplicateImage(img.id)}
                    isAssigning={assigningId === img.id}
                    disabled={anyBusy}
                    onSelect={() => associate({ imageId: img.id }, img.id)}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── Biblioteca ── */}
          <TabsContent value="biblioteca" className="mt-0 min-h-0 flex-1 overflow-auto px-6 pb-6">
            {loadingBiblioteca ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : bibliotecaError ? (
              <p className="py-10 text-center text-sm text-muted-foreground">{bibliotecaError}</p>
            ) : files.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Nenhum arquivo enviado para este projeto.
              </p>
            ) : (
              <>
                <div className="mb-3 flex gap-1.5">
                  {(['all', 'image', 'video'] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setKindFilter(k)}
                      className={[
                        'rounded-full border px-2.5 py-0.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        kindFilter === k
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border/50 text-muted-foreground hover:border-primary/50',
                      ].join(' ')}
                    >
                      {k === 'all' ? 'Todos' : k === 'image' ? 'Imagens' : 'Vídeos'}
                    </button>
                  ))}
                </div>
                {(() => {
                  const filtered = files.filter((f) => kindFilter === 'all' || f.kind === kindFilter)
                  return filtered.length === 0 ? (
                    <p className="py-10 text-center text-sm text-muted-foreground">
                      Nenhum arquivo encontrado para este filtro.
                    </p>
                  ) : (
                    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                      {filtered.map((file) => (
                        <LibraryCard
                          key={file.id}
                          file={file}
                          isDupe={isDuplicateFile(file.id)}
                          isAssigning={assigningId === file.id}
                          disabled={anyBusy}
                          onSelect={() => associate({ libraryFileId: file.id }, file.id)}
                        />
                      ))}
                    </div>
                  )
                })()}
              </>
            )}
          </TabsContent>

          {/* ── Enviar arquivo ── */}
          <TabsContent value="envio" className="mt-0 min-h-0 flex-1 overflow-auto px-6 pb-6">
            <div className="space-y-4">
              {/* Drop zone */}
              <div
                role="button"
                tabIndex={0}
                aria-label="Selecionar arquivo para envio"
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setIsDragging(false)
                  const f = e.dataTransfer.files?.[0]
                  if (f) handleFileSelect(f)
                }}
                onClick={() => !isUploading && fileInputRef.current?.click()}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ' ') && !isUploading) {
                    fileInputRef.current?.click()
                  }
                }}
                className={[
                  'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-10 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isDragging
                    ? 'border-primary bg-accent/30'
                    : isUploading
                      ? 'cursor-not-allowed border-border/30 opacity-60'
                      : 'border-border/50 hover:border-primary/50 hover:bg-muted/30',
                ].join(' ')}
              >
                <Upload className="h-8 w-8 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Clique ou arraste um arquivo aqui</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    JPEG, PNG, WebP, GIF, MP4, WebM, MOV — máx {MAX_UPLOAD_MB} MB
                  </p>
                </div>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_MIME}
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) handleFileSelect(f)
                  e.target.value = ''
                }}
                disabled={isUploading}
              />

              {/* Selected file preview */}
              {selectedFile && (
                <div className="flex items-center gap-3 rounded-md border border-border/50 bg-muted/30 px-3 py-2.5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-border/50 bg-background">
                    {selectedFile.type.startsWith('video/') ? (
                      <Video className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ImageIcon className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{selectedFile.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatFileSize(selectedFile.size)} · {selectedFile.type}
                    </p>
                  </div>
                  {!isUploading && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-1.5 text-muted-foreground"
                      onClick={() => { setSelectedFile(null); setUploadError(null) }}
                    >
                      <X className="h-3.5 w-3.5" />
                      <span className="sr-only">Remover seleção</span>
                    </Button>
                  )}
                </div>
              )}

              {/* Error message */}
              {uploadError && (
                <p className="text-sm text-destructive">{uploadError}</p>
              )}

              {/* Upload button */}
              {selectedFile && (
                <Button
                  type="button"
                  className="w-full"
                  disabled={isUploading}
                  onClick={handleUpload}
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Enviando…
                    </>
                  ) : (
                    <>
                      <Upload className="mr-2 h-4 w-4" />
                      Enviar e adicionar
                    </>
                  )}
                </Button>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
