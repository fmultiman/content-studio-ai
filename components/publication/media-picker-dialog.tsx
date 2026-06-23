'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Badge } from '@/components/ui/badge'
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
import { FileText, ImageIcon, Loader2, Music, Video } from 'lucide-react'

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
      </div>
      <p className="line-clamp-2 px-1.5 py-1 text-[11px] text-muted-foreground">
        {file.name}
      </p>
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

export function MediaPickerDialog({
  open,
  onOpenChange,
  projectId,
  channelPieceId,
  currentItems,
  onAssociated,
}: Props) {
  const { toast } = useToast()
  const [tab, setTab] = useState<'galeria' | 'biblioteca'>('galeria')
  const [images, setImages] = useState<ImageType[]>([])
  const [files, setFiles] = useState<LibraryFile[]>([])
  const [loadingGaleria, setLoadingGaleria] = useState(false)
  const [loadingBiblioteca, setLoadingBiblioteca] = useState(false)
  const [galeriaError, setGaleriaError] = useState<string | null>(null)
  const [bibliotecaError, setBibliotecaError] = useState<string | null>(null)
  const [assigningId, setAssigningId] = useState<string | null>(null)
  const isAssigningRef = useRef(false)

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

  // Reset state when dialog closes so next open reloads fresh data
  useEffect(() => {
    if (open) return
    setImages([])
    setFiles([])
    setGaleriaError(null)
    setBibliotecaError(null)
    setAssigningId(null)
    isAssigningRef.current = false
    setTab('galeria')
  }, [open])

  const isDuplicateImage = (imageId: string) =>
    currentItems.some((i) => i.image_id === imageId)

  const isDuplicateFile = (fileId: string) =>
    currentItems.some((i) => i.library_file_id === fileId)

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] max-w-3xl flex-col gap-0 p-0">
        <DialogHeader className="px-6 pb-3 pt-6">
          <DialogTitle>Adicionar mídia</DialogTitle>
          <DialogDescription>
            Escolha uma imagem gerada ou um arquivo existente deste projeto.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as 'galeria' | 'biblioteca')}
          className="flex min-h-0 flex-1 flex-col gap-0"
        >
          <TabsList className="mx-6 mb-3 w-fit">
            <TabsTrigger value="galeria">Imagens geradas</TabsTrigger>
            <TabsTrigger value="biblioteca">Arquivos do projeto</TabsTrigger>
          </TabsList>

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
                    disabled={!!assigningId}
                    onSelect={() => associate({ imageId: img.id }, img.id)}
                  />
                ))}
              </div>
            )}
          </TabsContent>

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
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                {files.map((file) => (
                  <LibraryCard
                    key={file.id}
                    file={file}
                    isDupe={isDuplicateFile(file.id)}
                    isAssigning={assigningId === file.id}
                    disabled={!!assigningId}
                    onSelect={() => associate({ libraryFileId: file.id }, file.id)}
                  />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
