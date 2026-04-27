'use client'

import { useEffect, useMemo, useState } from 'react'
import { Header } from '@/components/layout/header'
import { createClient } from '@/lib/supabase/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
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
  FolderInput,
  FolderPlus,
  ImageIcon,
  Loader2,
  MoreVertical,
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
  const [isUploading, setIsUploading] = useState(false)
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)
  const [showFolderInput, setShowFolderInput] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [showTrash, setShowTrash] = useState(false)
  const [moveIds, setMoveIds] = useState<string[]>([])
  const [moveTargetFolder, setMoveTargetFolder] = useState('/')
  const [isMoving, setIsMoving] = useState(false)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)

  const imageFiles = useMemo(() => files.filter((file) => file.kind === 'image'), [files])
  const previewFile = previewIndex === null ? null : imageFiles[previewIndex] || null

  const loadFiles = async () => {
    setIsLoading(true)
    const params = new URLSearchParams()
    if (selectedProject !== 'all') params.set('projectId', selectedProject)
    if (selectedKind !== 'all') params.set('kind', selectedKind)
    if (!showTrash && folder.trim() && folder.trim() !== '/') params.set('folder', folder.trim())
    if (showTrash) params.set('trash', 'true')

    const foldersUrl = selectedProject !== 'all'
      ? `/api/library-folders?projectId=${encodeURIComponent(selectedProject)}`
      : null
    const [filesResponse, foldersResponse, projectsResult] = await Promise.all([
      fetch(`/api/library-files?${params.toString()}`),
      foldersUrl ? fetch(foldersUrl) : Promise.resolve(null),
      createClient().from('projects').select('*').order('created_at', { ascending: false }),
    ])
    const filesPayload = await filesResponse.json()
    const foldersPayload = foldersResponse ? await foldersResponse.json() : { folders: [] }

    if (filesResponse.ok) setFiles(filesPayload.files || [])
    else console.error('[v0] Library files load error:', filesPayload)
    if (!foldersResponse || foldersResponse.ok) {
      const nextFolders = foldersPayload.folders || []
      setFolders(nextFolders)
      const projectRoot = nextFolders.find((item: LibraryFolder) => item.is_project_root)
      if (selectedProject !== 'all' && folder === '/' && projectRoot?.path) {
        setFolder(projectRoot.path)
      }
    } else console.error('[v0] Library folders load error:', foldersPayload)
    if (projectsResult.data) setProjects(projectsResult.data)
    setIsLoading(false)
  }

  useEffect(() => {
    loadFiles()
  }, [selectedProject, selectedKind, folder, showTrash])

  const availableFolders = useMemo(() => {
    return Array.from(new Set(['/', ...folders.map((item) => item.path), ...files.map((file) => file.folder)])).sort((a, b) =>
      a.localeCompare(b, 'pt-BR'),
    )
  }, [files, folders])

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
    try {
      await Promise.all(selectedFiles.map(uploadFileDirectly))
      await loadFiles()
      toast({
        title: selectedFiles.length > 1 ? 'Arquivos enviados' : 'Arquivo enviado',
        description: `${selectedFiles.length} arquivo(s) salvo(s) na biblioteca.`,
      })
    } catch (error) {
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

  const openMoveDialog = (ids: string[]) => {
    setMoveIds(ids)
    setMoveTargetFolder(folder)
  }

  const moveFiles = async () => {
    if (moveIds.length === 0) return

    setIsMoving(true)
    try {
      const response = await fetch('/api/library-files', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: moveIds, targetFolder: moveTargetFolder }),
      })
      const payload = await response.json()

      if (!response.ok) throw new Error(payload.error || 'Não foi possível mover os arquivos')

      await loadFiles()
      setSelectedIds((prev) => prev.filter((id) => !moveIds.includes(id)))
      setMoveIds([])
      toast({
        title: moveIds.length > 1 ? 'Arquivos movidos' : 'Arquivo movido',
        description: `Movido para ${moveTargetFolder === '/' ? 'Raiz' : moveTargetFolder}.`,
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
      <Header title="Arquivos" />
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-7xl space-y-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-muted-foreground">
              Biblioteca geral de arquivos pesados no MinIO, organizada por projeto e pasta.
            </p>
            <div className="flex flex-wrap gap-2">
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
              <Button asChild className="gap-2 bg-gradient-to-r from-violet-600 to-cyan-500 text-white">
                <label htmlFor="library-upload" className="cursor-pointer">
                  {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Enviar Arquivos
                </label>
              </Button>
            </div>
          </div>

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
            <div className="flex justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : files.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                {showTrash ? (
                  <Trash2 className="mb-4 h-12 w-12 text-muted-foreground" />
                ) : (
                  <UploadCloud className="mb-4 h-12 w-12 text-muted-foreground" />
                )}
                <h3 className="text-lg font-semibold">
                  {showTrash ? 'Lixeira vazia' : 'Nenhum arquivo encontrado'}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {showTrash ? 'Arquivos excluídos aparecerão aqui.' : 'Envie arquivos para criar sua biblioteca.'}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {files.map((file) => (
                <Card key={file.id} className="overflow-hidden border-border/50 bg-card/30 backdrop-blur-sm">
                  <div
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
                  </div>
                  <CardContent className="space-y-3 p-4">
                    <div>
                      <p className="line-clamp-1 text-sm font-medium">{file.name}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Badge variant="outline">{kindLabel(file.kind)}</Badge>
                        <Badge variant="outline">{formatFileSize(file.file_size)}</Badge>
                      </div>
                      <p className="mt-2 line-clamp-1 text-xs text-muted-foreground">{file.folder}</p>
                    </div>
                    <div className="flex gap-2">
                      {file.kind !== 'image' && (
                        <Button asChild variant="outline" size="sm" className="gap-2">
                          <a href={file.public_url} target="_blank" rel="noreferrer">
                            <Eye className="h-4 w-4" />
                            Ver
                          </a>
                        </Button>
                      )}
                      <Button asChild variant="outline" size="sm" className="flex-1 gap-2">
                        <a href={`/api/library-files/${file.id}/download`}>
                          <Download className="h-4 w-4" />
                          Baixar
                        </a>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

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
            <Select value={moveTargetFolder} onValueChange={setMoveTargetFolder}>
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
    </>
  )
}
