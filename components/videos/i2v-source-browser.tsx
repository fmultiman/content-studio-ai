'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, Folder, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { galleryStudioRenderTitle } from '@/lib/gallery-output-library'
import type { LibraryFolder } from '@/lib/types'
import {
  I2V_CATEGORY_LABEL,
  type I2vSourceCategory,
  type I2vSourceSelection,
} from '@/lib/video-generation/i2v-source'
import {
  SEARCH_MAX_LENGTH,
  aiImagesUrl,
  appendCursor,
  breadcrumbsFor,
  childFolders,
  folderDisplayName,
  libraryBrowseUrl,
  parentFolderPath,
  productionParam,
  projectRootPath,
  uploadDestinationFolder,
  type ProductionFilterMode,
} from '@/lib/video-generation/i2v-source-browse'
import { SourceList, type SourceTileItem } from '@/components/videos/i2v-source-list'
import { I2vSourceUpload } from '@/components/videos/i2v-source-upload'
import { usePagedSource, type Page } from '@/components/videos/use-paged-source'

// VIDEO_I2V_SOURCE_BROWSER_V1 — the chooser itself: Geradas por IA | Galeria | Arquivos | Enviar.
// One panel, one selection contract. Every list is bounded and cursor-paged; nothing here can widen a server
// scope (the browser sends a Project id, a Production filter, a folder, a search text and an opaque cursor).

const CATEGORIES: I2vSourceCategory[] = ['ai', 'gallery', 'library', 'upload']

interface ProductionOption {
  id: string
  title: string
}

interface AiImageRow {
  id: string
  name: string
  created_at: string
  thumbnail_url: string | null
  production_id: string | null
}

interface LibraryRow {
  id: string
  name: string
  folder: string | null
  created_at: string
  production_id: string | null
  thumbnail_url: string | null
  public_url: string | null
}

// Stable (module-level) page parsers: the list hook keys its effect on them.
const parseAiPage = (payload: unknown): Page<AiImageRow> => ({
  items: (payload as { images?: AiImageRow[] })?.images ?? [],
  nextCursor: (payload as { nextCursor?: string | null })?.nextCursor ?? null,
})
const parseLibraryPage = (payload: unknown): Page<LibraryRow> => ({
  items: (payload as { files?: LibraryRow[] })?.files ?? [],
  nextCursor: (payload as { nextCursor?: string | null })?.nextCursor ?? null,
})

const EMPTY_COPY = {
  ai: 'Nenhuma imagem gerada por IA neste projeto.',
  gallery: 'Nenhum render de imagem disponível na Galeria.',
  library: 'Nenhuma imagem encontrada nesta pasta/filtro.',
  search: 'Nenhuma imagem encontrada.',
} as const

const FAILED_COPY = 'Não foi possível carregar as imagens agora.'

const dateLabel = (iso: string) => {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString('pt-BR')
}

export function I2vSourceBrowser({
  projectId,
  productionId,
  selectedId,
  onSelect,
  onClose,
  locked = false,
  onUploadBusyChange,
  defaultProductionMode = 'current',
}: {
  projectId: string
  /** The Production of the generation form. Default filter, and the Production of any upload. */
  productionId: string | null
  selectedId: string | null
  onSelect: (selection: I2vSourceSelection) => void
  onClose: () => void
  /** True while an upload is in flight: categories and "Fechar" are locked so the upload always ends in a selection. */
  locked?: boolean
  onUploadBusyChange?: (busy: boolean) => void
  /** The Production filter before the user chooses one. AI Video keeps 'current'; a Project-scoped caller (Static) passes 'all'. */
  defaultProductionMode?: ProductionFilterMode
}) {
  const [category, setCategory] = useState<I2vSourceCategory>('ai')
  // An explicit Production filter choice is remembered WITH the generation Production it was made for: a different
  // generation Production falls back to the default ("Production atual" unless the caller sets another) with no effect needed.
  const [explicitFilter, setExplicitFilter] = useState<{ forProductionId: string | null; mode: ProductionFilterMode } | null>(null)
  const productionMode: ProductionFilterMode = explicitFilter && explicitFilter.forProductionId === productionId ? explicitFilter.mode : defaultProductionMode
  const setProductionMode = (mode: ProductionFilterMode) => setExplicitFilter({ forProductionId: productionId, mode })
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [folderPath, setFolderPath] = useState<string | null>(null)
  const [productions, setProductions] = useState<ProductionOption[]>([])
  const [folders, setFolders] = useState<LibraryFolder[]>([])
  const [foldersFailed, setFoldersFailed] = useState(false)

  // Search is applied after a short pause and is bounded in length.
  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput.trim().slice(0, SEARCH_MAX_LENGTH)), 300)
    return () => clearTimeout(handle)
  }, [searchInput])

  // Changing category starts that category clean (no search/Production carry-over between unrelated lists).
  const changeCategory = (next: I2vSourceCategory) => {
    setCategory(next)
    setSearchInput('')
    setSearch('')
  }

  // The Productions of THIS Project only.
  useEffect(() => {
    let cancelled = false
    createClient()
      .from('productions')
      .select('id, title')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .then(({ data }: { data: ProductionOption[] | null }) => {
        if (!cancelled) setProductions(data ?? [])
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  // Library folders of THIS Project (path / parent_path is the only folder truth). Needed by Arquivos and Enviar.
  const needsFolders = category === 'library' || category === 'upload'
  useEffect(() => {
    if (!needsFolders || folders.length > 0) return
    const controller = new AbortController()
    fetch(`/api/library-folders?${new URLSearchParams({ projectId })}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`status ${response.status}`)
        const payload = await response.json()
        if (controller.signal.aborted) return
        setFolders((payload?.folders ?? []) as LibraryFolder[])
        setFoldersFailed(false)
      })
      .catch(() => {
        if (!controller.signal.aborted) setFoldersFailed(true)
      })
    return () => controller.abort()
  }, [needsFolders, folders.length, projectId])

  const productionName = useCallback((id: string | null) => (id ? productions.find((row) => row.id === id)?.title ?? null : null), [productions])
  const currentProductionName = productionName(productionId)
  const rootPath = projectRootPath(folders)
  // The Project's root Library folder carries the Project's name.
  const projectName = folders.find((folder) => folder.is_project_root)?.name ?? 'Raiz do projeto'
  const activeFolder = folderPath ?? rootPath
  const production = productionParam(productionMode, productionId)

  // ---- per-category lists (exactly one is active at a time) ----------------------------------------------------
  const aiUrl = category === 'ai' ? aiImagesUrl({ projectId }) : null
  const ai = usePagedSource<AiImageRow>({
    url: aiUrl,
    withCursor: appendCursor,
    parse: parseAiPage,
  })

  const libraryActive = category === 'gallery' || category === 'library'
  // Arquivos waits for the Project root folder (or for the folder list to fail, then browses without a folder).
  const libraryReady = category === 'gallery' || Boolean(rootPath) || foldersFailed
  const libraryUrl = libraryActive && libraryReady
    ? libraryBrowseUrl({ category: category as 'gallery' | 'library', projectId, production, search, folder: category === 'library' ? activeFolder : null })
    : null
  const library = usePagedSource<LibraryRow>({
    url: libraryUrl,
    withCursor: appendCursor,
    parse: parseLibraryPage,
  })

  // While Arquivos is still waiting for its folder list the panel shows "loading", never an empty list.
  const libraryState = library.state === 'idle' && libraryActive ? 'loading' : library.state

  const aiTiles: SourceTileItem[] = useMemo(
    () =>
      ai.items.map((row) => ({
        id: row.id,
        label: row.name,
        context: [productionName(row.production_id), dateLabel(row.created_at)].filter(Boolean).join(' · ') || null,
        thumbnailUrl: row.thumbnail_url,
      })),
    [ai.items, productionName],
  )

  const libraryTiles: SourceTileItem[] = useMemo(
    () =>
      library.items.map((row) => ({
        id: row.id,
        label: category === 'gallery' ? galleryStudioRenderTitle(row.name) : row.name,
        context:
          category === 'gallery'
            ? [productionName(row.production_id) ?? 'Sem Production associada', dateLabel(row.created_at)].filter(Boolean).join(' · ')
            : search
              ? folderDisplayName(folders, row.folder, projectName)
              : productionName(row.production_id),
        thumbnailUrl: row.thumbnail_url || row.public_url,
      })),
    [library.items, category, search, folders, projectName, productionName],
  )

  const pickAi = (id: string) => {
    const row = ai.items.find((item) => item.id === id)
    if (!row) return
    onSelect({
      source: { type: 'generated', id },
      summary: { category: 'ai', label: row.name, thumbnailUrl: row.thumbnail_url, productionName: productionName(row.production_id), folder: null },
    })
  }

  const pickLibrary = (id: string) => {
    const row = library.items.find((item) => item.id === id)
    if (!row) return
    onSelect({
      source: { type: 'library', id },
      summary: {
        category: category === 'gallery' ? 'gallery' : 'library',
        label: category === 'gallery' ? galleryStudioRenderTitle(row.name) : row.name,
        thumbnailUrl: row.thumbnail_url || row.public_url,
        productionName: productionName(row.production_id),
        folder: category === 'library' ? folderDisplayName(folders, row.folder, projectName) : null,
      },
    })
  }

  const subfolders = childFolders(folders, activeFolder)
  const crumbs = breadcrumbsFor(folders, activeFolder, projectName)
  const parent = parentFolderPath(folders, activeFolder)
  const uploadFolder = uploadDestinationFolder(folders, folderPath)
  const uploadLabel = folderDisplayName(folders, uploadFolder, projectName)

  const filterRow = (showSearch = true) => (
    <div className="flex flex-wrap items-end gap-2" data-testid="i2v-source-filters">
      <div className="min-w-[10rem] flex-1 space-y-1">
        <Label className="text-xs">Production</Label>
        <Select value={productionMode} onValueChange={(value) => setProductionMode(value as ProductionFilterMode)}>
          <SelectTrigger className="h-8 w-full text-xs" aria-label="Filtrar por Production" data-testid="i2v-source-production-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="current">{currentProductionName ? `Production atual (${currentProductionName})` : 'Production atual'}</SelectItem>
            <SelectItem value="all">Todas as Productions</SelectItem>
            <SelectItem value="unscoped">Sem Production</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {showSearch && (
        <div className="min-w-[10rem] flex-1 space-y-1">
          <Label htmlFor="i2v-source-search" className="text-xs">Buscar</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            <Input
              id="i2v-source-search"
              data-testid="i2v-source-search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Nome da imagem"
              maxLength={SEARCH_MAX_LENGTH}
              className="h-8 pl-7 text-xs"
            />
          </div>
        </div>
      )}
    </div>
  )

  return (
    <div className="space-y-3 rounded-md border border-border/60 p-2 sm:p-3" data-testid="i2v-source-browser">
      <div className="flex items-center justify-between gap-2">
        <div role="tablist" aria-label="Origem da imagem" className="flex min-w-0 flex-1 gap-1 overflow-x-auto rounded-md bg-muted p-1" data-testid="i2v-source-tabs">
          {CATEGORIES.map((entry) => (
            <button
              key={entry}
              type="button"
              role="tab"
              id={`i2v-source-tab-${entry}`}
              aria-selected={category === entry}
              aria-controls={`i2v-source-panel-${entry}`}
              data-testid={`i2v-source-tab-${entry}`}
              disabled={locked && category !== entry}
              onClick={() => changeCategory(entry)}
              className={cn(
                'shrink-0 whitespace-nowrap rounded px-2.5 py-1 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[color:var(--control-focus)] disabled:cursor-not-allowed disabled:opacity-50',
                category === entry ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {I2V_CATEGORY_LABEL[entry]}
            </button>
          ))}
        </div>
        <Button type="button" size="sm" variant="ghost" className="shrink-0" disabled={locked} onClick={onClose} data-testid="i2v-source-close">
          Fechar
        </Button>
      </div>

      <div role="tabpanel" id={`i2v-source-panel-${category}`} aria-labelledby={`i2v-source-tab-${category}`} className="space-y-3" data-testid={`i2v-source-panel-${category}`}>
        {category === 'ai' && (
          <div className="max-h-[min(22rem,50vh)] overflow-y-auto pr-1">
            <SourceList
              testId="i2v-ai"
              state={ai.state}
              items={aiTiles}
              hasMore={ai.hasMore}
              isLoadingMore={ai.isLoadingMore}
              loadMoreFailed={ai.loadMoreFailed}
              onLoadMore={ai.loadMore}
              onRetry={ai.reload}
              selectedId={selectedId}
              onPick={pickAi}
              emptyText={EMPTY_COPY.ai}
              failedText={FAILED_COPY}
            />
          </div>
        )}

        {category === 'gallery' && (
          <>
            {filterRow()}
            <div className="max-h-[min(22rem,50vh)] overflow-y-auto pr-1">
              <SourceList
                testId="i2v-gallery"
                state={libraryState}
                items={libraryTiles}
                hasMore={library.hasMore}
                isLoadingMore={library.isLoadingMore}
                loadMoreFailed={library.loadMoreFailed}
                onLoadMore={library.loadMore}
                onRetry={library.reload}
                selectedId={selectedId}
                onPick={pickLibrary}
                emptyText={search || production !== 'all' ? EMPTY_COPY.search : EMPTY_COPY.gallery}
                failedText={FAILED_COPY}
              />
            </div>
          </>
        )}

        {category === 'library' && (
          <>
            {filterRow()}
            {foldersFailed && folders.length === 0 ? (
              <p className="text-xs text-muted-foreground" role="alert" data-testid="i2v-folders-failed">
                Não foi possível carregar as pastas. A busca continua disponível.
              </p>
            ) : (
              !search && (
                <nav aria-label="Pastas de Arquivos" className="space-y-2" data-testid="i2v-folder-nav">
                  <div className="flex min-w-0 items-center gap-1">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 shrink-0"
                      disabled={!parent}
                      aria-label="Voltar para a pasta anterior"
                      data-testid="i2v-folder-back"
                      onClick={() => parent && setFolderPath(parent === rootPath ? null : parent)}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <ol className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 text-xs text-muted-foreground" data-testid="i2v-breadcrumbs">
                      {crumbs.map((crumb, index) => (
                        <li key={crumb.path} className="flex min-w-0 items-center gap-1">
                          {index > 0 && <span aria-hidden="true">/</span>}
                          <button
                            type="button"
                            className={cn('max-w-[10rem] truncate rounded px-1 outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--control-focus)]', index === crumbs.length - 1 ? 'font-medium text-foreground' : 'hover:text-foreground')}
                            aria-current={index === crumbs.length - 1 ? 'page' : undefined}
                            title={crumb.label}
                            data-testid={`i2v-crumb-${index}`}
                            onClick={() => setFolderPath(index === 0 ? null : crumb.path)}
                          >
                            {crumb.label}
                          </button>
                        </li>
                      ))}
                    </ol>
                  </div>
                  {subfolders.length > 0 && (
                    <ul className="grid grid-cols-1 gap-1 min-[420px]:grid-cols-2" data-testid="i2v-subfolders">
                      {subfolders.map((folder) => (
                        <li key={folder.id} className="min-w-0">
                          <button
                            type="button"
                            className="flex w-full min-w-0 items-center gap-1.5 rounded-md border border-border/50 px-2 py-1.5 text-left text-xs outline-none hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-[color:var(--control-focus)]"
                            title={folder.name}
                            data-testid={`i2v-folder-${folder.id}`}
                            onClick={() => setFolderPath(folder.path)}
                          >
                            <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                            <span className="min-w-0 truncate">{folder.name}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </nav>
              )
            )}
            <div className="max-h-[min(22rem,50vh)] overflow-y-auto pr-1">
              <SourceList
                testId="i2v-library"
                state={libraryState}
                items={libraryTiles}
                hasMore={library.hasMore}
                isLoadingMore={library.isLoadingMore}
                loadMoreFailed={library.loadMoreFailed}
                onLoadMore={library.loadMore}
                onRetry={library.reload}
                selectedId={selectedId}
                onPick={pickLibrary}
                emptyText={search ? EMPTY_COPY.search : EMPTY_COPY.library}
                failedText={FAILED_COPY}
              />
            </div>
          </>
        )}

        {category === 'upload' && (
          <I2vSourceUpload
            projectId={projectId}
            productionId={productionId}
            productionName={currentProductionName}
            destinationFolder={uploadFolder}
            destinationLabel={uploadLabel}
            onUploaded={onSelect}
            onBusyChange={onUploadBusyChange}
          />
        )}
      </div>
    </div>
  )
}
