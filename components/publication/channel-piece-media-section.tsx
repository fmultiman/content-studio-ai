'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import type { ChannelPieceMediaResolved, ChannelPieceMediaRole } from '@/lib/types'
import { FileText, ImageIcon, Loader2, Music, RefreshCw, Trash2, Video } from 'lucide-react'

// ─── Labels ──────────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<ChannelPieceMediaRole, string> = {
  primary: 'Principal',
  thumbnail: 'Thumbnail',
  carousel_item: 'Item de carrossel',
  background: 'Fundo',
  attachment: 'Anexo',
}

// ─── Thumbnail / icon ─────────────────────────────────────────────────────────

function MediaThumb({ item }: { item: ChannelPieceMediaResolved }) {
  const [imgError, setImgError] = useState(false)

  const src = item.thumbnail_url || item.image_url

  if (item.source_deleted) {
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-border/50 bg-muted">
        <ImageIcon className="h-4 w-4 text-muted-foreground/40" />
      </div>
    )
  }

  if (src && !imgError && (item.media_kind === 'image' || item.thumbnail_url)) {
    return (
      <img
        src={src}
        alt={item.alt_text || ''}
        className="h-10 w-10 shrink-0 rounded border border-border/50 object-cover"
        onError={() => setImgError(true)}
      />
    )
  }

  const Icon =
    item.media_kind === 'video' ? Video
    : item.media_kind === 'audio' ? Music
    : item.media_kind === 'document' ? FileText
    : ImageIcon

  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-border/50 bg-muted">
      <Icon className="h-4 w-4 text-muted-foreground" />
    </div>
  )
}

// ─── Single media row ─────────────────────────────────────────────────────────

interface MediaItemProps {
  item: ChannelPieceMediaResolved
  onRemove: (id: string) => void
  isRemoving: boolean
}

function MediaItem({ item, onRemove, isRemoving }: MediaItemProps) {
  const origin = item.image_id ? 'Galeria' : 'Biblioteca'
  const displayName = item.name || item.mime_type || null

  return (
    <div className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-muted/40">
      <MediaThumb item={item} />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="h-4 px-1 text-[10px]">
            {ROLE_LABELS[item.role]}
          </Badge>
          <span className="text-xs text-muted-foreground">{origin}</span>
          {item.source_deleted && (
            <Badge variant="secondary" className="h-4 px-1 text-[10px] text-muted-foreground">
              Mídia indisponível
            </Badge>
          )}
        </div>
        {displayName && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground/70">{displayName}</p>
        )}
        {item.alt_text && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground/50" title={item.alt_text}>
            {item.alt_text}
          </p>
        )}
      </div>

      <Button
        size="sm"
        variant="ghost"
        className="h-7 shrink-0 gap-1 px-1.5 text-xs text-muted-foreground hover:text-destructive"
        disabled={isRemoving}
        onClick={() => onRemove(item.id)}
        title="Remover da versão"
      >
        {isRemoving
          ? <Loader2 className="h-3 w-3 animate-spin" />
          : <Trash2 className="h-3 w-3" />}
        <span className="sr-only">Remover da versão</span>
      </Button>
    </div>
  )
}

// ─── Section ──────────────────────────────────────────────────────────────────

interface Props {
  channelPieceId: string
}

export function ChannelPieceMediaSection({ channelPieceId }: Props) {
  const { toast } = useToast()

  const [items, setItems] = useState<ChannelPieceMediaResolved[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)

  // Delete state — useRef guards against double-click
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const isDeleteInFlight = useRef(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/channel-piece-media?channelPieceId=${channelPieceId}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setItems(d.channelPieceMedia ?? [])
      })
      .catch(() => {
        if (!cancelled) setError('Erro ao carregar mídias desta versão.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [channelPieceId, retryKey])

  const handleConfirmDelete = useCallback(async () => {
    if (!confirmingId || isDeleteInFlight.current) return
    isDeleteInFlight.current = true
    setDeletingId(confirmingId)
    const targetId = confirmingId
    setConfirmingId(null)
    try {
      const res = await fetch(`/api/channel-piece-media/${targetId}`, { method: 'DELETE' })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error((d as { error?: string }).error || 'Erro ao remover')
      }
      setItems((prev) => prev.filter((i) => i.id !== targetId))
      toast({
        title: 'Mídia removida da versão',
        description: 'O arquivo original foi preservado.',
      })
    } catch (err) {
      toast({
        title: 'Erro ao remover',
        description: err instanceof Error ? err.message : 'Tente novamente.',
        variant: 'destructive',
      })
    } finally {
      isDeleteInFlight.current = false
      setDeletingId(null)
    }
  }, [confirmingId, toast])

  const confirmingItem = confirmingId ? items.find((i) => i.id === confirmingId) : null

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="mt-3 border-t border-border/30 pt-3">
        {loading ? (
          <div className="flex items-center gap-2 py-1">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Carregando mídias…</span>
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 py-1">
            <span className="text-xs text-muted-foreground">{error}</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-1.5 text-xs"
              onClick={() => setRetryKey((k) => k + 1)}
            >
              <RefreshCw className="h-3 w-3" />
              Tentar novamente
            </Button>
          </div>
        ) : items.length === 0 ? (
          <div className="py-1">
            <p className="text-xs text-muted-foreground">Nenhuma mídia associada a esta versão.</p>
            <p className="mt-0.5 text-xs text-muted-foreground/60">
              A seleção e o upload de mídia serão adicionados na próxima etapa.
            </p>
          </div>
        ) : (
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">
              Mídia ({items.length})
            </p>
            <div className="space-y-0.5">
              {items.map((item) => (
                <MediaItem
                  key={item.id}
                  item={item}
                  onRemove={setConfirmingId}
                  isRemoving={deletingId === item.id}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Remove association confirmation */}
      <AlertDialog
        open={!!confirmingId}
        onOpenChange={(open) => { if (!open) setConfirmingId(null) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover mídia desta versão?</AlertDialogTitle>
            <AlertDialogDescription>
              A associação com{' '}
              <strong>
                {confirmingItem
                  ? (confirmingItem.name || ROLE_LABELS[confirmingItem.role])
                  : 'esta mídia'}
              </strong>{' '}
              será removida. O arquivo original{' '}
              {confirmingItem?.image_id ? 'na Galeria' : 'na Biblioteca'}{' '}
              <strong>não será excluído</strong>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!deletingId}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              disabled={!!deletingId}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingId && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Remover da versão
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
