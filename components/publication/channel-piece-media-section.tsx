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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useToast } from '@/hooks/use-toast'
import type { ChannelPieceMediaResolved, ChannelPieceMediaRole } from '@/lib/types'
import {
  ChevronDown,
  ChevronUp,
  Download,
  FileText,
  ImageIcon,
  Loader2,
  MoreHorizontal,
  Music,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  Video,
} from 'lucide-react'
import { MediaPickerDialog } from './media-picker-dialog'

// ─── Labels ──────────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<ChannelPieceMediaRole, string> = {
  primary:       'Principal',
  thumbnail:     'Thumbnail',
  carousel_item: 'Item de carrossel',
  background:    'Fundo',
  attachment:    'Anexo',
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
    item.media_kind === 'video'    ? Video
    : item.media_kind === 'audio'  ? Music
    : item.media_kind === 'document' ? FileText
    : ImageIcon

  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-border/50 bg-muted">
      <Icon className="h-4 w-4 text-muted-foreground" />
    </div>
  )
}

// ─── Single media row (read-only, used in card mode) ─────────────────────────

interface MediaItemReadOnlyProps {
  item: ChannelPieceMediaResolved
}

function MediaItemReadOnly({ item }: MediaItemReadOnlyProps) {
  const origin      = item.image_id || item.library_origin === 'studio_render' ? 'Imagem gerada' : 'Arquivo do projeto'
  const displayName = item.name || item.mime_type || null

  return (
    <div className="flex items-center gap-2 rounded-md px-1 py-1">
      <MediaThumb item={item} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="h-4 px-1 text-[10px]">
            {ROLE_LABELS[item.role]}
          </Badge>
          {item.media_kind === 'video' && (
            <Badge variant="secondary" className="h-4 px-1 text-[10px]">Vídeo</Badge>
          )}
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
      </div>
    </div>
  )
}

// ─── Single media row (editable) ─────────────────────────────────────────────

interface MediaItemEditableProps {
  item:          ChannelPieceMediaResolved
  isFirst:       boolean
  isLast:        boolean
  anyBusy:       boolean
  isOrganizing:  boolean  // this specific item is being moved/role-changed
  isRemoving:    boolean  // this specific item is being removed
  onMoveUp:      (id: string) => void
  onMoveDown:    (id: string) => void
  onRoleChange:  (id: string, role: ChannelPieceMediaRole) => void
  onRemove:      (id: string) => void
  onPreview:     (item: ChannelPieceMediaResolved) => void
}

function MediaItemEditable({
  item,
  isFirst,
  isLast,
  anyBusy,
  isOrganizing,
  isRemoving,
  onMoveUp,
  onMoveDown,
  onRoleChange,
  onRemove,
  onPreview,
}: MediaItemEditableProps) {
  const origin      = item.image_id || item.library_origin === 'studio_render' ? 'Imagem gerada' : 'Arquivo do projeto'
  const displayName = item.name || item.mime_type || null

  const busy = anyBusy || isOrganizing || isRemoving

  return (
    <div className="flex items-center gap-1 rounded-md px-1 py-1 hover:bg-muted/40">
      {/* Order controls */}
      <div className="flex shrink-0 flex-col">
        <button
          type="button"
          disabled={isFirst || busy}
          onClick={() => onMoveUp(item.id)}
          className="flex h-4 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-default"
          title="Mover para cima"
          aria-label="Mover para cima"
        >
          {isOrganizing
            ? null
            : <ChevronUp className="h-3 w-3" />}
        </button>
        <button
          type="button"
          disabled={isLast || busy}
          onClick={() => onMoveDown(item.id)}
          className="flex h-4 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-default"
          title="Mover para baixo"
          aria-label="Mover para baixo"
        >
          {isOrganizing
            ? null
            : <ChevronDown className="h-3 w-3" />}
        </button>
      </div>

      {/* Spinner replaces arrows while this item is being reorganized */}
      {isOrganizing && (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
      )}

      <MediaThumb item={item} />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="h-4 px-1 text-[10px]">
            {ROLE_LABELS[item.role]}
          </Badge>
          {item.media_kind === 'video' && (
            <Badge variant="secondary" className="h-4 px-1 text-[10px]">Vídeo</Badge>
          )}
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
      </div>

      {/* Play preview (video only) */}
      {item.media_kind === 'video' && item.image_url && (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 shrink-0 px-1.5"
          disabled={busy}
          onClick={() => onPreview(item)}
          title="Reproduzir"
        >
          <Play className="h-3 w-3" />
          <span className="sr-only">Reproduzir</span>
        </Button>
      )}

      {/* Download button */}
      <Button
        size="sm"
        variant="ghost"
        className="h-7 shrink-0 px-1.5"
        disabled={busy || item.source_deleted || !item.image_url}
        title="Baixar arquivo"
        onClick={() => window.open(`/api/channel-piece-media/${item.id}/download`, '_blank')}
      >
        <Download className="h-3 w-3" />
        <span className="sr-only">Baixar</span>
      </Button>

      {/* Role change menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 shrink-0 px-1.5"
            disabled={busy}
            title="Alterar função"
          >
            <MoreHorizontal className="h-3 w-3" />
            <span className="sr-only">Opções da mídia</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem
            disabled={item.role === 'primary'}
            onClick={() => onRoleChange(item.id, 'primary')}
          >
            Definir como principal
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={item.role === 'thumbnail'}
            onClick={() => onRoleChange(item.id, 'thumbnail')}
          >
            Usar como thumbnail
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={item.role === 'carousel_item'}
            onClick={() => onRoleChange(item.id, 'carousel_item')}
          >
            Usar como item de carrossel
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={item.role === 'background'}
            onClick={() => onRoleChange(item.id, 'background')}
          >
            Usar como fundo
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={item.role === 'attachment'}
            onClick={() => onRoleChange(item.id, 'attachment')}
          >
            Usar como anexo
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Remove button */}
      <Button
        size="sm"
        variant="ghost"
        className="h-7 shrink-0 gap-1 px-1.5 text-xs text-muted-foreground hover:text-destructive"
        disabled={busy}
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
  editable?:      boolean
  projectId?:     string
}

export function ChannelPieceMediaSection({
  channelPieceId,
  editable = false,
  projectId,
}: Props) {
  const { toast } = useToast()

  const [items,    setItems]    = useState<ChannelPieceMediaResolved[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)

  // Delete state
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [deletingId,   setDeletingId]   = useState<string | null>(null)
  const isDeleteInFlight = useRef(false)

  // Organize state
  const [organizingId, setOrganizingId] = useState<string | null>(null)
  const isOrganizeInFlight = useRef(false)

  // Picker state
  const [pickerOpen, setPickerOpen] = useState(false)

  // Video preview state
  const [previewItem, setPreviewItem] = useState<ChannelPieceMediaResolved | null>(null)

  // ── Fetch ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/channel-piece-media?channelPieceId=${channelPieceId}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setItems(d.channelPieceMedia ?? []) })
      .catch(() => { if (!cancelled) setError('Erro ao carregar mídias desta versão.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [channelPieceId, retryKey])

  // ── Organize (reorder + role change) ──────────────────────────────────────

  const callOrganize = useCallback(
    async (
      newArrangement: Array<{ id: string; position: number; role: ChannelPieceMediaRole }>,
      triggerItemId: string,
    ) => {
      if (isOrganizeInFlight.current) return
      isOrganizeInFlight.current = true
      setOrganizingId(triggerItemId)
      try {
        const res = await fetch('/api/channel-piece-media/organize', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channelPieceId, items: newArrangement }),
        })
        const d = await res.json()
        if (!res.ok) throw new Error((d as { error?: string }).error || 'Erro ao reorganizar')
        setItems(d.channelPieceMedia ?? [])
      } catch (err) {
        toast({
          title: 'Erro ao reorganizar',
          description: err instanceof Error ? err.message : 'Tente novamente.',
          variant: 'destructive',
        })
        setRetryKey((k) => k + 1)
      } finally {
        isOrganizeInFlight.current = false
        setOrganizingId(null)
      }
    },
    [channelPieceId, toast],
  )

  const handleMoveUp = useCallback(
    (id: string) => {
      const idx = items.findIndex((i) => i.id === id)
      if (idx <= 0 || isOrganizeInFlight.current) return
      const reordered = [...items]
      ;[reordered[idx - 1], reordered[idx]] = [reordered[idx], reordered[idx - 1]]
      callOrganize(
        reordered.map((item, i) => ({ id: item.id, position: i, role: item.role })),
        id,
      )
    },
    [items, callOrganize],
  )

  const handleMoveDown = useCallback(
    (id: string) => {
      const idx = items.findIndex((i) => i.id === id)
      if (idx < 0 || idx >= items.length - 1 || isOrganizeInFlight.current) return
      const reordered = [...items]
      ;[reordered[idx], reordered[idx + 1]] = [reordered[idx + 1], reordered[idx]]
      callOrganize(
        reordered.map((item, i) => ({ id: item.id, position: i, role: item.role })),
        id,
      )
    },
    [items, callOrganize],
  )

  const handleRoleChange = useCallback(
    (id: string, newRole: ChannelPieceMediaRole) => {
      if (isOrganizeInFlight.current) return
      // If promoting to primary, demote current primary to carousel_item
      const newItems = items.map((item) => ({
        id:       item.id,
        position: item.position,
        role:
          item.id === id          ? newRole
          : newRole === 'primary' && item.role === 'primary' ? 'carousel_item' as ChannelPieceMediaRole
          : item.role,
      }))
      callOrganize(newItems, id)
    },
    [items, callOrganize],
  )

  // ── Delete ─────────────────────────────────────────────────────────────────

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
      const d = await res.json()
      // Server returns the updated list with compacted positions + promoted primary
      if (Array.isArray(d.channelPieceMedia)) {
        setItems(d.channelPieceMedia)
      } else {
        setItems((prev) => prev.filter((i) => i.id !== targetId))
      }
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
  const anyBusy = isOrganizeInFlight.current || !!deletingId

  // ── Render ─────────────────────────────────────────────────────────────────

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
            <p className="text-xs text-muted-foreground">
              Nenhuma mídia associada a esta versão.
            </p>
            {!editable && (
              <p className="mt-0.5 text-xs text-muted-foreground/60">
                A seleção e o upload de mídia serão adicionados na próxima etapa.
              </p>
            )}
          </div>
        ) : (
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">
              Mídia ({items.length})
            </p>
            <div className="space-y-0.5">
              {editable
                ? items.map((item, idx) => (
                    <MediaItemEditable
                      key={item.id}
                      item={item}
                      isFirst={idx === 0}
                      isLast={idx === items.length - 1}
                      anyBusy={anyBusy}
                      isOrganizing={organizingId === item.id}
                      isRemoving={deletingId === item.id}
                      onMoveUp={handleMoveUp}
                      onMoveDown={handleMoveDown}
                      onRoleChange={handleRoleChange}
                      onRemove={setConfirmingId}
                      onPreview={setPreviewItem}
                    />
                  ))
                : items.map((item) => (
                    <MediaItemReadOnly key={item.id} item={item} />
                  ))}
            </div>
          </div>
        )}

        {editable && projectId && (
          <div className="mt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs"
              onClick={() => setPickerOpen(true)}
              disabled={loading || anyBusy}
            >
              <Plus className="h-3 w-3" />
              Adicionar mídia
            </Button>
          </div>
        )}
      </div>

      {/* Media picker */}
      {editable && projectId && (
        <MediaPickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          projectId={projectId}
          channelPieceId={channelPieceId}
          currentItems={items}
          onAssociated={() => setRetryKey((k) => k + 1)}
        />
      )}

      {/* Video preview */}
      <Dialog open={!!previewItem} onOpenChange={(o) => { if (!o) setPreviewItem(null) }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{previewItem?.name || 'Reprodução'}</DialogTitle>
          </DialogHeader>
          {previewItem?.image_url && (
            <video
              src={previewItem.image_url}
              controls
              preload="metadata"
              className="w-full rounded-md"
            />
          )}
        </DialogContent>
      </Dialog>

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
