'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  DashboardPage,
  DashboardPageContent,
} from '@/components/layout/dashboard-page'
import { PageHeader } from '@/components/layout/page-header'
import { createClient } from '@/lib/supabase/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardActions, CardContent, CardMedia, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { ContextMetadata } from '@/components/ui/context-metadata'
import { StateMessage } from '@/components/ui/state-message'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { VideoReviewControl } from '@/components/reviews/video-review-control'
import { isLibraryFileReviewable } from '@/lib/reviews/video-review-presentation'
import type { LibraryFile, LibraryFileKind, LibraryFolder, Project } from '@/lib/types'
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  File,
  FileAudio,
  FileText,
  FileVideo,
  Folder,
  FolderInput,
  FolderPlus,
  ImageIcon,
  Loader2,
  MoreVertical,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  UploadCloud,
} from 'lucide-react'

type KindFilter = 'all' | LibraryFileKind

function getKind(mimeType: string): LibraryFileKind {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  if (
    mimeType.startsWith('text/') ||
    mimeType === 'application/pdf' ||
    mimeType.includes('document') ||
    mimeType.includes('spreadsheet') ||
    mimeType.includes('presentation')
  ) {
    return 'document'
  }
  return 'other'
}

function kindLabel(kind: LibraryFileKind) {
  const labels: Record<LibraryFileKind, string> = {
    image: 'Imagem',
    video: 'Vídeo',
    audio: 'Áudio',
    document: 'Documento',
    other: 'Outro',
  }
  return labels[kind]
}

function KindIcon({ kind }: { kind: LibraryFileKind }) {
  if (kind === 'image') return <ImageIcon className="h-8 w-8 text-muted-foreground" />
  if (kind === 'video') return <FileVideo className="h-8 w-8 text-muted-foreground" />
  if (kind === 'audio') return <FileAudio className="h-8 w-8 text-muted-foreground" />
  if (kind === 'document') return <FileText className="h-8 w-8 text-muted-foreground" />
  return <File className="h-8 w-8 text-muted-foreground" />
}

function formatFileSize(size: number | null | undefined) {
  if (!size) return 'Tamanho desconhecido'
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

export default function ArquivosPage() {
  const { toast } = useToast()
  const [files, setFiles] = useState<LibraryFile[]>([])
  const [folders, setFolders] = useState<LibraryFolder[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [selectedProject, setSelectedProject] = useState('all')
  const [selectedKind, setSelectedKind] = useState<KindFilter>('all')
  const [folder, setFolder] = useState('/')
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)
  const [showFolderInput, setShowFolderInput] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [showTrash, setShowTrash] = useState(false)
  const [moveIds, setMoveIds] = useState<string[]>([])
  const [moveTarget, setMoveTarget] = useState('root')
  const [isMoving, setIsMoving] = useState(false)
  const [renameFolder, setRenameFolder] = useState<LibraryFolder | null>(null)
  const [renameFolderName, setRenameFolderName] = useState('')
  const [isRenamingFolder, setIsRenamingFolder] = useState(false)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  // MEDIA_LIBRARY_PRODUCTION_SCOPING_V1: with a Project selected the list comes from the bounded browse endpoint
  // (server-side Production filter + name search + keyset pagination). "Todos os projetos" keeps the legacy list.
  const [productions, setProductions] = useState<Array<{ id: string; title: string }>>([])
  const [selectedProduction, setSelectedProduction] = useState('all')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [isLoadingMore, setIsLoadingMore] = useState(false)

  const imageFiles = useMemo(() => files.filter((file) => file.kind === 'image'), [files])
  const previewFile = previewIndex === null ? null : imageFiles[previewIndex] || null

  // Browse mode (Project selected): server-side filters + cursor pagination. Null when not applicable.
  const browseParams = (cursor?: string | null) => {
    if (selectedProject === 'all') return null
    const query = new URLSearchParams({ projectId: selectedProject, scope: 'arquivos' })
    if (selectedKind !== 'all') query.set('kind', selectedKind)
    if (selectedProduction !== 'all') query.set('production', selectedProduction)
    if (search.trim()) query.set('q', search.trim())
    if (showTrash) query.set('trash', 'true')
    else if (folder.trim() && folder.trim() !== '/') query.set('folder', folder.trim())
    if (cursor) query.set('cursor', cursor)
    return query
  }

  const loadFiles = async () => {
    setIsLoading(true)
    setLoadError(null)
    const browse = browseParams()
    const params = new URLSearchParams()
    if (selectedProject !== 'all') params.set('projectId', selectedProject)
    if (selectedKind !== 'all') params.set('kind', selectedKind)
    // The Project root also shows video renders saved before its folder row
    // existed (their LibraryFile folder is '/'). Other folders stay exact.
    const selectedRoot = folders.find((item) => item.project_id === selectedProject && item.is_project_root)
    const projectRootSelected = !showTrash && selectedRoot?.path === folder
    if (!showTrash && !projectRootSelected && folder.trim() && folder.trim() !== '/') params.set('folder', folder.trim())
    if (showTrash) params.set('trash', 'true')
    // Arquivos contains user/imported media plus Video renders explicitly
    // persisted through "Salvar em Arquivos". Static studio PNGs remain in
    // Galeria because their durable product context is the ChannelPiece.
    params.set('origin', 'all')

    const foldersUrl = `/api/library-folders${selectedProject !== 'all'
      ? `?projectId=${encodeURIComponent(selectedProject)}`
      : ''
    }`
    const filesUrl = browse ? `/api/library-files/browse?${browse.toString()}` : `/api/library-files?${params.toString()}`
    const [filesResponse, foldersResponse, projectsResult] = await Promise.all([
      fetch(filesUrl),
      fetch(foldersUrl),
      createClient().from('projects').select('*').order('created_at', { ascending: false }),
    ])
    const filesPayload = await filesResponse.json()
    const foldersPayload = await foldersResponse.json()

    if (filesResponse.ok) {
      if (browse) {
        setFiles((filesPayload.files || []) as LibraryFile[])
        setNextCursor(filesPayload.nextCursor ?? null)
      } else {
        const visibleFiles = ((filesPayload.files || []) as LibraryFile[])
          .filter((file) => file.origin !== 'studio_render' || file.kind === 'video')
          .filter((file) => !projectRootSelected || file.folder === folder || (file.origin === 'studio_render' && file.kind === 'video' && file.folder === '/'))
        setFiles(visibleFiles)
        setNextCursor(null)
      }
    } else {
      console.error('[v0] Library files load error:', filesPayload)
      setLoadError('Não foi possível carregar os arquivos da biblioteca.')
    }
    if (foldersResponse.ok) {
      const nextFolders = foldersPayload.folders || []
      setFolders(nextFolders)
      const projectRoot = nextFolders.find((item: LibraryFolder) => item.is_project_root)
      if (selectedProject !== 'all' && folder === '/' && projectRoot?.path) {
        setFolder(projectRoot.path)
      }
    } else {
      console.error('[v0] Library folders load error:', foldersPayload)
      setLoadError('Não foi possível carregar a estrutura de pastas agora.')
    }
    if (projectsResult.data) setProjects(projectsResult.data)
    setIsLoading(false)
  }

  const loadMore = async () => {
    const browse = browseParams(nextCursor)
    if (!browse || !nextCursor || isLoadingMore) return
    setIsLoadingMore(true)
    try {
      const response = await fetch(`/api/library-files/browse?${browse.toString()}`)
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Erro')
      setFiles((current) => {
        const seen = new Set(current.map((file) => file.id))
        return [...current, ...((payload.files || []) as LibraryFile[]).filter((file) => !seen.has(file.id))]
      })
      setNextCursor(payload.nextCursor ?? null)
    } catch {
      toast({ title: 'Não foi possível carregar mais arquivos', variant: 'destructive' })
    } finally {
      setIsLoadingMore(false)
    }
  }

  // Search is applied after a short pause, server-side.
  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput), 300)
    return () => clearTimeout(handle)
  }, [searchInput])

  // The Productions of the selected Project only (never a cross-Project list).
  useEffect(() => {
    if (selectedProject === 'all') return // the Production filter is only rendered for a selected Project
    let cancelled = false
    createClient()
      .from('productions')
      .select('id, title')
      .eq('project_id', selectedProject)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (!cancelled) setProductions((data || []) as Array<{ id: string; title: string }>)
      })
    return () => {
      cancelled = true
    }
  }, [selectedProject])

  useEffect(() => {
    loadFiles()
  }, [selectedProject, selectedKind, folder, showTrash, selectedProduction, search])

  const availableFolders = useMemo(() => {
    return Array.from(new Set(['/', ...folders.map((item) => item.path), ...files.map((file) => file.folder)])).sort((a, b) =>
      a.localeCompare(b, 'pt-BR'),
    )
  }, [files, folders])

  const projectNameById = useMemo(() => {
    return new Map(projects.map((project) => [project.id, project.name]))
  }, [projects])

  const moveTargets = useMemo(() => {
    return [
      { value: 'root', label: 'Sem projeto / Raiz' },
      ...folders.map((item) => ({
        value: `folder:${item.id}`,
        label: `${projectNameById.get(item.project_id) || 'Projeto'} / ${item.path === '/' ? 'Raiz' : item.path}`,
      })),
    ]
  }, [folders, projectNameById])

  const folderTreeRows = useMemo(() => {
    return folders
      .map((item) => {
        const segments = item.path.split('/').filter(Boolean)
        return {
          ...item,
          depth: Math.max(0, segments.length - 1),
          label: item.is_project_root ? projectNameById.get(item.project_id) || item.name : segments.at(-1) || item.name,
          projectName: projectNameById.get(item.project_id) || 'Projeto',
        }
      })
      .sort((a, b) => {
        const projectCompare = a.projectName.localeCompare(b.projectName, 'pt-BR')
        return projectCompare || a.path.localeCompare(b.path, 'pt-BR')
      })
  }, [folders, projectNameById])

  const uploadFileDirectly = async (file: File) => {
    const response = await fetch('/api/storage/presign-image-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folder: 'library',
        prefix: folder,
        mimeType: file.type || 'application/octet-stream',
        filename: file.name,
      }),
    })
    const data = await response.json()

    if (!response.ok) throw new Error(data.error || 'Não foi possível preparar o upload')

    const uploadResponse = await fetch(data.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    })
    if (!uploadResponse.ok) throw new Error('Não foi possível enviar o arquivo')

    const saveResponse = await fetch('/api/library-files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: selectedProject === 'all' ? null : selectedProject,
        folder,
        name: file.name,
        kind: getKind(file.type || ''),
        mimeType: file.type || 'application/octet-stream',
        fileSize: file.size,
        storageProvider: data.storageProvider,
        storagePath: data.storagePath,
        publicUrl: data.imageUrl,
        thumbnailUrl: null,
      }),
    })
    const savePayload = await saveResponse.json()
    if (!saveResponse.ok) throw new Error(savePayload.error || 'Não foi possível salvar o arquivo')
    return {
      ...savePayload.file,
      public_url: data.imageUrl,
      thumbnail_url: data.imageUrl,
    } as LibraryFile
  }

  const handleUpload = async (fileList: FileList | null) => {
    const selectedFiles = Array.from(fileList || [])
    if (selectedFiles.length === 0) return

    setIsUploading(true)
    setUploadError(null)
    try {
      await Promise.all(selectedFiles.map(uploadFileDirectly))
      await loadFiles()
      toast({
        title: selectedFiles.length > 1 ? 'Arquivos enviados' : 'Arquivo enviado',
        description: `${selectedFiles.length} arquivo(s) salvo(s) na biblioteca.`,
      })
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Não foi possível enviar os arquivos.')
      toast({
        title: 'Erro no upload',
        description: error instanceof Error ? error.message : 'Não foi possível enviar os arquivos.',
        variant: 'destructive',
      })
    } finally {
      setIsUploading(false)
    }
  }

  const createFolder = async () => {
    if (selectedProject === 'all') {
      toast({
        title: 'Selecione um projeto',
        description: 'Pastas só podem ser criadas dentro de um projeto.',
        variant: 'destructive',
      })
      return
    }

    const name = newFolderName.trim()
    if (!name) {
      toast({
        title: 'Nome obrigatório',
        description: 'Informe o nome da nova pasta.',
        variant: 'destructive',
      })
      return
    }

    setIsCreatingFolder(true)
    try {
      const response = await fetch('/api/library-folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: selectedProject,
          parentPath: folder,
          name,
        }),
      })
      const payload = await response.json()

      if (!response.ok) throw new Error(payload.error || 'Não foi possível criar a pasta')

      setFolders((prev) => [...prev, payload.folder])
      setFolder(payload.folder.path)
      setNewFolderName('')
      setShowFolderInput(false)
      toast({
        title: 'Pasta criada',
        description: `A pasta ${payload.folder.path} está pronta para receber arquivos.`,
      })
    } catch (error) {
      toast({
        title: 'Erro ao criar pasta',
        description: error instanceof Error ? error.message : 'Não foi possível criar a pasta.',
        variant: 'destructive',
      })
    } finally {
      setIsCreatingFolder(false)
    }
  }

  const deleteFolder = async (folderToDelete: LibraryFolder) => {
    const response = await fetch('/api/library-folders', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: folderToDelete.id }),
    })
    const payload = await response.json()

    if (!response.ok) {
      toast({
        title: 'Erro ao excluir pasta',
        description: payload.error || 'Não foi possível excluir a pasta.',
        variant: 'destructive',
      })
      return
    }

    setFolders((prev) => prev.filter((item) => item.id !== folderToDelete.id))
    if (folder === folderToDelete.path || folder.startsWith(`${folderToDelete.path}/`)) {
      const projectRoot = folders.find(
        (item) => item.project_id === folderToDelete.project_id && item.is_project_root,
      )
      setFolder(projectRoot?.path || '/')
    }
    toast({
      title: 'Pasta excluída',
      description: 'A pasta vazia foi removida da biblioteca.',
    })
  }

  const openRenameFolder = (folderToRename: LibraryFolder) => {
    setRenameFolder(folderToRename)
    setRenameFolderName(folderToRename.name)
  }

  const submitRenameFolder = async () => {
    if (!renameFolder) return

    const name = renameFolderName.trim()
    if (!name) {
      toast({
        title: 'Nome obrigatório',
        description: 'Informe o novo nome da pasta.',
        variant: 'destructive',
      })
      return
    }

    setIsRenamingFolder(true)
    try {
      const response = await fetch('/api/library-folders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: renameFolder.id, name }),
      })
      const payload = await response.json()

      if (!response.ok) throw new Error(payload.error || 'Não foi possível renomear a pasta')

      await loadFiles()
      setFolder(payload.folder.path)
      setRenameFolder(null)
      setRenameFolderName('')
      toast({
        title: 'Pasta renomeada',
        description: `Agora a pasta se chama ${payload.folder.name}.`,
      })
    } catch (error) {
      toast({
        title: 'Erro ao renomear pasta',
        description: error instanceof Error ? error.message : 'Não foi possível renomear a pasta.',
        variant: 'destructive',
      })
    } finally {
      setIsRenamingFolder(false)
    }
  }

  const openMoveDialog = (ids: string[]) => {
    setMoveIds(ids)
    const currentFolder = folders.find((item) => item.path === folder && item.project_id === selectedProject)
    setMoveTarget(currentFolder ? `folder:${currentFolder.id}` : 'root')
  }

  const moveFiles = async () => {
    if (moveIds.length === 0) return

    setIsMoving(true)
    try {
      const response = await fetch('/api/library-files', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          moveTarget === 'root'
            ? { ids: moveIds, targetFolder: '/', targetProjectId: null }
            : { ids: moveIds, targetFolderId: moveTarget.replace('folder:', '') },
        ),
      })
      const payload = await response.json()

      if (!response.ok) throw new Error(payload.error || 'Não foi possível mover os arquivos')

      await loadFiles()
      setSelectedIds((prev) => prev.filter((id) => !moveIds.includes(id)))
      setMoveIds([])
      toast({
        title: moveIds.length > 1 ? 'Arquivos movidos' : 'Arquivo movido',
        description: `Movido para ${moveTargets.find((item) => item.value === moveTarget)?.label || 'a pasta selecionada'}.`,
      })
    } catch (error) {
      toast({
        title: 'Erro ao mover',
        description: error instanceof Error ? error.message : 'Não foi possível mover os arquivos.',
        variant: 'destructive',
      })
    } finally {
      setIsMoving(false)
    }
  }

  const deleteFiles = async (ids: string[]) => {
    if (ids.length === 0) return

    const response = await fetch('/api/library-files', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    })
    const data = await response.json()
    if (!response.ok) {
      toast({
        title: 'Erro ao excluir',
        description: data.error || 'Não foi possível excluir os arquivos.',
        variant: 'destructive',
      })
      return
    }

    setFiles((prev) => prev.filter((file) => !ids.includes(file.id)))
    setSelectedIds((prev) => prev.filter((id) => !ids.includes(id)))
    toast({
      title: ids.length > 1 ? 'Arquivos movidos para a lixeira' : 'Arquivo movido para a lixeira',
      description: 'Você ainda pode restaurar ou excluir permanentemente.',
    })
  }

  const restoreFiles = async (ids: string[]) => {
    if (ids.length === 0) return

    const response = await fetch('/api/library-files', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, restore: true }),
    })
    const data = await response.json()
    if (!response.ok) {
      toast({
        title: 'Erro ao restaurar',
        description: data.error || 'Não foi possível restaurar os arquivos.',
        variant: 'destructive',
      })
      return
    }

    setFiles((prev) => prev.filter((file) => !ids.includes(file.id)))
    setSelectedIds((prev) => prev.filter((id) => !ids.includes(id)))
    toast({
      title: ids.length > 1 ? 'Arquivos restaurados' : 'Arquivo restaurado',
      description: 'O item voltou para a biblioteca.',
    })
  }

  const permanentDeleteFiles = async (ids: string[]) => {
    if (ids.length === 0) return

    const response = await fetch('/api/library-files', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, permanent: true }),
    })
    const data = await response.json()
    if (!response.ok) {
      toast({
        title: 'Erro ao excluir permanentemente',
        description: data.error || 'Não foi possível excluir os arquivos.',
        variant: 'destructive',
      })
      return
    }

    setFiles((prev) => prev.filter((file) => !ids.includes(file.id)))
    setSelectedIds((prev) => prev.filter((id) => !ids.includes(id)))
    toast({
      title: ids.length > 1 ? 'Arquivos excluídos permanentemente' : 'Arquivo excluído permanentemente',
      description: 'O arquivo também foi removido do MinIO.',
    })
  }

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => prev.includes(id)
      ? prev.filter((item) => item !== id)
      : [...prev, id],
    )
  }

  const handleProjectChange = (value: string) => {
    setSelectedProject(value)
    setSelectedProduction('all')
    setFolder('/')
    setSelectedIds([])
    setShowFolderInput(false)
    setNewFolderName('')
    setShowTrash(false)
  }

  const openImagePreview = (fileId: string) => {
    const index = imageFiles.findIndex((file) => file.id === fileId)
    if (index >= 0) setPreviewIndex(index)
  }

  const showPreviousImage = () => {
    setPreviewIndex((current) => {
      if (current === null || imageFiles.length === 0) return current
      return current === 0 ? imageFiles.length - 1 : current - 1
    })
  }

  const showNextImage = () => {
    setPreviewIndex((current) => {
      if (current === null || imageFiles.length === 0) return current
      return current === imageFiles.length - 1 ? 0 : current + 1
    })
  }

  return (
    <>
      <DashboardPage>
        <DashboardPageContent width="7xl" className="space-y-6">
          <PageHeader
            context="Biblioteca"
            title="Arquivos"
            description="Guarde uploads, referências, documentos e vídeos renderizados salvos por Project e pasta."
            actions={(
              <>
                <input
                  id="library-upload"
                  type="file"
                  multiple
                  className="sr-only"
                  onChange={(event) => handleUpload(event.target.files)}
                />
                <Button
                  type="button"
                  variant={showTrash ? 'default' : 'outline'}
                  className="gap-2"
                  onClick={() => {
                    setShowTrash((current) => !current)
                    setSelectedIds([])
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                  Lixeira
                </Button>
                <Button asChild className="gap-2">
                  <label htmlFor="library-upload" className="cursor-pointer">
                    {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    Enviar Arquivos
                  </label>
                </Button>
              </>
            )}
          />

          <Card className="border-border/50 bg-card/30 backdrop-blur-sm">
            <CardContent className="space-y-4 p-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[240px] space-y-2">
                  <Label>Projeto</Label>
                  <Select value={selectedProject} onValueChange={handleProjectChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos os projetos</SelectItem>
                      {projects.map((project) => (
                        <SelectItem key={project.id} value={project.id}>
                          {project.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="min-w-[240px] space-y-2">
                  <Label>Pasta</Label>
                  <Select value={folder} onValueChange={setFolder}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {availableFolders.map((item) => (
                        <SelectItem key={item} value={item}>
                          {item === '/' ? 'Raiz' : item}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="min-w-[180px] space-y-2">
                  <Label>Tipo</Label>
                  <Select value={selectedKind} onValueChange={(value: KindFilter) => setSelectedKind(value)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="image">Imagens</SelectItem>
                      <SelectItem value="video">Vídeos</SelectItem>
                      <SelectItem value="audio">Áudios</SelectItem>
                      <SelectItem value="document">Documentos</SelectItem>
                      <SelectItem value="other">Outros</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {selectedProject !== 'all' && (
                  <div className="min-w-[200px] space-y-2" data-testid="arquivos-production-filter">
                    <Label>Production</Label>
                    <Select value={selectedProduction} onValueChange={setSelectedProduction}>
                      <SelectTrigger aria-label="Filtrar por Production">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todas as Productions</SelectItem>
                        {productions.map((production) => (
                          <SelectItem key={production.id} value={production.id}>
                            {production.title}
                          </SelectItem>
                        ))}
                        <SelectItem value="unscoped">Sem Production</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {selectedProject !== 'all' && (
                  <div className="min-w-[200px] flex-1 space-y-2" data-testid="arquivos-search">
                    <Label htmlFor="arquivos-search-input">Buscar</Label>
                    <Input
                      id="arquivos-search-input"
                      value={searchInput}
                      onChange={(event) => setSearchInput(event.target.value)}
                      placeholder="Nome do arquivo"
                      maxLength={100}
                    />
                  </div>
                )}

                <Button
                  type="button"
                  variant="outline"
                  className="gap-2"
                  disabled={selectedProject === 'all'}
                  onClick={() => setShowFolderInput((current) => !current)}
                >
                  <FolderPlus className="h-4 w-4" />
                  Nova pasta
                </Button>
              </div>

              {selectedProject === 'all' && (
                <p className="text-sm text-muted-foreground">
                  Selecione um projeto para criar pastas e organizar os uploads por campanha.
                </p>
              )}
              {uploadError && (
                <StateMessage
                  tone="error"
                  title="Upload indisponível"
                  description={uploadError}
                  compact
                />
              )}

              {showFolderInput && selectedProject !== 'all' && (
                <div className="flex flex-col gap-2 rounded-lg border border-border/50 bg-background/40 p-3 sm:flex-row sm:items-end">
                  <div className="flex-1 space-y-2">
                    <Label>Nova pasta em {folder === '/' ? 'Raiz' : folder}</Label>
                    <Input
                      value={newFolderName}
                      onChange={(event) => setNewFolderName(event.target.value)}
                      placeholder="Ex: Referências, Capas, Roteiros"
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') createFolder()
                      }}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" onClick={createFolder} disabled={isCreatingFolder} className="gap-2">
                      {isCreatingFolder ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderPlus className="h-4 w-4" />}
                      Criar
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setShowFolderInput(false)
                        setNewFolderName('')
                      }}
                    >
                      Cancelar
                    </Button>
                  </div>
                </div>
              )}

              {folderTreeRows.length > 0 && !showTrash && (
                <div className="rounded-lg border border-border/50 bg-background/30 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <Label>Pastas</Label>
                    <span className="text-xs text-muted-foreground">
                      {folderTreeRows.length} pasta(s)
                    </span>
                  </div>
                  <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                    {folderTreeRows.map((item) => (
                      <div
                        key={item.id}
                        className="flex min-w-0 items-center gap-1 rounded-md border border-transparent bg-card/30 p-1"
                      >
                        <Button
                          type="button"
                          variant={folder === item.path ? 'secondary' : 'ghost'}
                          size="sm"
                          className="min-w-0 flex-1 justify-start gap-2"
                          style={{ paddingLeft: `${8 + item.depth * 14}px` }}
                          onClick={() => setFolder(item.path)}
                        >
                          <Folder className="h-4 w-4 shrink-0" />
                          <span className="truncate">
                            {selectedProject === 'all' ? `${item.projectName} / ${item.label}` : item.label}
                          </span>
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 shrink-0 text-muted-foreground"
                              aria-label={`Opções da pasta ${item.label}`}
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem disabled={item.is_project_root} onClick={() => openRenameFolder(item)}>
                              <Pencil className="h-4 w-4" />
                              Renomear
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={item.is_project_root}
                              variant="destructive"
                              onClick={() => deleteFolder(item)}
                            >
                              <Trash2 className="h-4 w-4" />
                              Excluir
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {selectedIds.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-card/60 p-3">
              <Badge variant="secondary">{selectedIds.length} selecionado(s)</Badge>
              {showTrash ? (
                <>
                  <Button variant="outline" size="sm" onClick={() => restoreFiles(selectedIds)} className="gap-2">
                    <RotateCcw className="h-4 w-4" />
                    Restaurar
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => permanentDeleteFiles(selectedIds)} className="gap-2">
                    <Trash2 className="h-4 w-4" />
                    Excluir permanentemente
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" size="sm" onClick={() => openMoveDialog(selectedIds)} className="gap-2">
                    <FolderInput className="h-4 w-4" />
                    Mover
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => deleteFiles(selectedIds)} className="gap-2">
                    <Trash2 className="h-4 w-4" />
                    Excluir
                  </Button>
                </>
              )}
              <Button variant="ghost" size="sm" onClick={() => setSelectedIds([])}>
                Limpar seleção
              </Button>
            </div>
          )}

          {isLoading ? (
            <StateMessage
              tone="loading"
              title="Carregando arquivos..."
              description="Estamos organizando uploads, pastas e ações disponíveis."
              className="py-10"
            />
          ) : loadError ? (
            <StateMessage
              tone="error"
              title="Não foi possível carregar a biblioteca"
              description={loadError}
              actionLabel="Tentar novamente"
              onAction={loadFiles}
            />
          ) : files.length === 0 ? (
            <StateMessage
              tone="empty"
              title={
                showTrash
                  ? 'Lixeira vazia'
                  : selectedProject !== 'all' || selectedKind !== 'all' || folder !== '/' || selectedProduction !== 'all' || search !== ''
                    ? 'Nenhum resultado encontrado'
                    : 'Nenhum arquivo encontrado'
              }
              description={
                showTrash
                  ? 'Arquivos excluídos aparecerão aqui até serem restaurados ou removidos permanentemente.'
                  : selectedProject !== 'all' || selectedKind !== 'all' || folder !== '/' || selectedProduction !== 'all' || search !== ''
                    ? 'Ajuste os filtros ou volte para outra pasta para localizar seus uploads.'
                    : 'Envie arquivos para começar a biblioteca de inputs e referências.'
              }
              actionLabel={
                !showTrash && (selectedProject !== 'all' || selectedKind !== 'all' || folder !== '/' || selectedProduction !== 'all' || search !== '')
                  ? 'Limpar filtros'
                  : undefined
              }
              onAction={
                !showTrash && (selectedProject !== 'all' || selectedKind !== 'all' || folder !== '/' || selectedProduction !== 'all' || search !== '')
                  ? () => {
                      setSelectedProject('all')
                      setSelectedKind('all')
                      setSelectedProduction('all')
                      setSearchInput('')
                      setFolder('/')
                    }
                  : undefined
              }
            />
          ) : (
            <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {files.map((file) => (
                <Card key={file.id} className="overflow-hidden border-border/50 bg-card/30 backdrop-blur-sm">
                  <CardMedia
                    className="relative aspect-video bg-muted"
                    role={file.kind === 'image' ? 'button' : undefined}
                    tabIndex={file.kind === 'image' ? 0 : undefined}
                    onClick={() => file.kind === 'image' && openImagePreview(file.id)}
                    onKeyDown={(event) => {
                      if (file.kind === 'image' && (event.key === 'Enter' || event.key === ' ')) {
                        event.preventDefault()
                        openImagePreview(file.id)
                      }
                    }}
                  >
                    <Checkbox
                      checked={selectedIds.includes(file.id)}
                      onCheckedChange={() => toggleSelection(file.id)}
                      onClick={(event) => event.stopPropagation()}
                      className="absolute left-2 top-2 z-20 border-background bg-background shadow"
                      aria-label={`Selecionar ${file.name}`}
                    />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="secondary"
                          size="icon"
                          className="absolute right-2 top-2 z-20 h-8 w-8 bg-background/90 text-muted-foreground shadow"
                          onClick={(event) => event.stopPropagation()}
                          aria-label={`Opções de ${file.name}`}
                        >
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
                        {showTrash ? (
                          <>
                            <DropdownMenuItem onClick={() => restoreFiles([file.id])}>
                              <RotateCcw className="h-4 w-4" />
                              Restaurar
                            </DropdownMenuItem>
                            <DropdownMenuItem variant="destructive" onClick={() => permanentDeleteFiles([file.id])}>
                              <Trash2 className="h-4 w-4" />
                              Excluir permanentemente
                            </DropdownMenuItem>
                          </>
                        ) : (
                          <>
                            <DropdownMenuItem onClick={() => openMoveDialog([file.id])}>
                              <FolderInput className="h-4 w-4" />
                              Mover
                            </DropdownMenuItem>
                            <DropdownMenuItem variant="destructive" onClick={() => deleteFiles([file.id])}>
                              <Trash2 className="h-4 w-4" />
                              Excluir
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    {file.kind === 'image' ? (
                      <img
                        src={file.thumbnail_url || file.public_url}
                        alt={file.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <KindIcon kind={file.kind} />
                      </div>
                    )}
                  </CardMedia>
                  <CardContent className="space-y-3 p-4">
                    <div className="space-y-3">
                      <div>
                        <CardTitle className="line-clamp-1 text-sm" title={file.name}>
                          {file.name}
                        </CardTitle>
                      </div>
                      <ContextMetadata
                        dense
                        items={[
                          { label: 'Project', value: file.project_id ? projectNameById.get(file.project_id) || 'Projeto' : 'Sem Project' },
                          { label: 'Pasta', value: file.folder || 'Raiz', title: file.folder || 'Raiz' },
                          { label: 'Tipo', value: kindLabel(file.kind) },
                          { label: 'Tamanho', value: formatFileSize(file.file_size) },
                          { label: 'Atualizado', value: new Date(file.updated_at).toLocaleDateString('pt-BR') },
                        ]}
                      />
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline">{kindLabel(file.kind)}</Badge>
                        <Badge variant="outline">{formatFileSize(file.file_size)}</Badge>
                      </div>
                    </div>
                    <CardActions className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        className="gap-2"
                        onClick={() => {
                          if (file.kind === 'image') {
                            openImagePreview(file.id)
                            return
                          }

                          window.open(file.public_url, '_blank', 'noopener,noreferrer')
                        }}
                      >
                        <Eye className="h-4 w-4" />
                        Visualizar
                      </Button>
                      <Button asChild variant="outline" size="sm" className="gap-2">
                        <a href={`/api/library-files/${file.id}/download`}>
                          <Download className="h-4 w-4" />
                          Baixar
                        </a>
                      </Button>
                      {/* VIDEO_REVIEW_UI_AND_HISTORY_V1: videos only, never in the trash; sends only the LibraryFile id. */}
                      {!showTrash && isLibraryFileReviewable(file) && (
                        <VideoReviewControl source={{ kind: 'library_file', id: file.id }} size="sm" subjectLabel={file.name} />
                      )}
                    </CardActions>
                  </CardContent>
                </Card>
              ))}
            </div>
            {nextCursor && (
              <div className="flex justify-center pt-2">
                <Button type="button" variant="outline" disabled={isLoadingMore} onClick={() => void loadMore()} data-testid="arquivos-load-more">
                  {isLoadingMore ? 'Carregando...' : 'Carregar mais'}
                </Button>
              </div>
            )}
            </>
          )}
        </DashboardPageContent>
      </DashboardPage>

      <Dialog open={previewIndex !== null} onOpenChange={(open) => !open && setPreviewIndex(null)}>
        <DialogContent className="h-[90vh] max-h-[90vh] w-[92vw] max-w-[92vw] border-border/60 bg-black p-0 text-white sm:max-w-[92vw]">
          <DialogHeader className="border-b border-white/10 px-6 py-4">
            <DialogTitle className="line-clamp-1 text-base">{previewFile?.name || 'Imagem'}</DialogTitle>
            <DialogDescription className="text-white/60">
              {previewFile ? `${previewIndex! + 1} de ${imageFiles.length}` : 'Pré-visualização'}
            </DialogDescription>
          </DialogHeader>
          <div className="relative flex min-h-0 flex-1 items-center justify-center px-5 pb-5">
            {previewFile && (
              <img
                src={previewFile.public_url}
                alt={previewFile.name}
                className="max-h-full max-w-full object-contain"
              />
            )}
            {imageFiles.length > 1 && (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  className="absolute left-5 top-1/2 h-10 w-10 -translate-y-1/2 rounded-full bg-white/15 text-white hover:bg-white/25"
                  onClick={showPreviousImage}
                  aria-label="Imagem anterior"
                >
                  <ChevronLeft className="h-5 w-5" />
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  className="absolute right-5 top-1/2 h-10 w-10 -translate-y-1/2 rounded-full bg-white/15 text-white hover:bg-white/25"
                  onClick={showNextImage}
                  aria-label="Próxima imagem"
                >
                  <ChevronRight className="h-5 w-5" />
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={moveIds.length > 0} onOpenChange={(open) => !open && setMoveIds([])}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mover arquivo</DialogTitle>
            <DialogDescription>
              Escolha a pasta de destino para {moveIds.length} arquivo(s).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Pasta de destino</Label>
            <Select value={moveTarget} onValueChange={setMoveTarget}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {moveTargets.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setMoveIds([])}>
              Cancelar
            </Button>
            <Button type="button" onClick={moveFiles} disabled={isMoving} className="gap-2">
              {isMoving ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderInput className="h-4 w-4" />}
              Mover
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!renameFolder} onOpenChange={(open) => !open && setRenameFolder(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Renomear pasta</DialogTitle>
            <DialogDescription>
              O novo nome será aplicado à pasta, subpastas e arquivos dentro dela.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Novo nome</Label>
            <Input
              value={renameFolderName}
              onChange={(event) => setRenameFolderName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submitRenameFolder()
              }}
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setRenameFolder(null)}>
              Cancelar
            </Button>
            <Button type="button" onClick={submitRenameFolder} disabled={isRenamingFolder} className="gap-2">
              {isRenamingFolder ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
              Renomear
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
