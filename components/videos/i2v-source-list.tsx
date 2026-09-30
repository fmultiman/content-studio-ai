'use client'

import { useState } from 'react'
import { Check, ImageIcon, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { PagedState } from '@/components/videos/use-paged-source'

// VIDEO_I2V_SOURCE_BROWSER_V1 — the one tile grid every category renders, with DISTINCT loading / failed /
// empty states (a failed query is never shown as an empty list) and a bounded "Carregar mais".

export interface SourceTileItem {
  id: string
  label: string
  /** One short context line (Production, folder, date). Truncated; the full text is in the tooltip. */
  context: string | null
  thumbnailUrl: string | null
}

export function SourceTile({ item, selected, testId, onPick }: { item: SourceTileItem; selected: boolean; testId: string; onPick: () => void }) {
  const [broken, setBroken] = useState(false)
  const title = item.context ? `${item.label} — ${item.context}` : item.label
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={selected}
      title={title}
      data-testid={testId}
      className={cn(
        'relative flex min-w-0 flex-col overflow-hidden rounded-md border text-left outline-none transition-colors',
        'focus-visible:ring-2 focus-visible:ring-[color:var(--control-focus)]',
        selected ? 'border-primary bg-primary/10 ring-1 ring-primary' : 'border-border/50 hover:border-primary/60 hover:bg-accent/30',
      )}
    >
      <div className="relative flex aspect-square w-full items-center justify-center bg-muted">
        {item.thumbnailUrl && !broken ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.thumbnailUrl} alt={item.label} loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover" />
        ) : (
          <ImageIcon className="h-6 w-6 text-muted-foreground" aria-label={`Sem pré-visualização: ${item.label}`} role="img" />
        )}
        {selected && (
          <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Check className="h-3 w-3" />
          </span>
        )}
      </div>
      <span className="block min-w-0 truncate px-1.5 pt-1 text-[11px] text-foreground">{item.label}</span>
      <span className="block min-w-0 truncate px-1.5 pb-1 text-[10px] text-muted-foreground">{item.context || ' '}</span>
    </button>
  )
}

export function SourceList({
  testId,
  state,
  items,
  hasMore,
  isLoadingMore,
  loadMoreFailed,
  onLoadMore,
  onRetry,
  selectedId,
  onPick,
  emptyText,
  failedText,
}: {
  testId: string
  state: PagedState
  items: SourceTileItem[]
  hasMore: boolean
  isLoadingMore: boolean
  loadMoreFailed: boolean
  onLoadMore: () => void
  onRetry: () => void
  selectedId: string | null
  onPick: (id: string) => void
  emptyText: string
  failedText: string
}) {
  if (state === 'idle') return null
  if (state === 'loading') {
    return (
      <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground" role="status" aria-live="polite" data-testid={`${testId}-loading`}>
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        <span>Carregando imagens…</span>
      </div>
    )
  }
  if (state === 'failed') {
    return (
      <div className="space-y-2 py-4 text-center" role="alert" data-testid={`${testId}-failed`}>
        <p className="text-xs text-muted-foreground">{failedText}</p>
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          Tentar novamente
        </Button>
      </div>
    )
  }
  if (items.length === 0) {
    return (
      <p className="py-4 text-center text-xs text-muted-foreground" data-testid={`${testId}-empty`}>
        {emptyText}
      </p>
    )
  }
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 min-[420px]:grid-cols-3 sm:grid-cols-4" data-testid={`${testId}-grid`}>
        {items.map((item) => (
          <SourceTile key={item.id} item={item} selected={item.id === selectedId} testId={`${testId}-option-${item.id}`} onPick={() => onPick(item.id)} />
        ))}
      </div>
      {hasMore && (
        <div className="flex flex-col items-center gap-1 pt-1">
          {loadMoreFailed && (
            <p className="text-xs text-muted-foreground" role="alert" data-testid={`${testId}-load-more-failed`}>
              Não foi possível carregar mais imagens.
            </p>
          )}
          <Button type="button" size="sm" variant="outline" disabled={isLoadingMore} onClick={onLoadMore} data-testid={`${testId}-load-more`}>
            {isLoadingMore ? 'Carregando…' : 'Carregar mais'}
          </Button>
        </div>
      )}
    </div>
  )
}
