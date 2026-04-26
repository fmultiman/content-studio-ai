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
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useToast } from '@/hooks/use-toast'
import type { Post, PublicationType, PostStatus, Project } from '@/lib/types'
import {
  CheckCircle2,
  FileText,
  FolderKanban,
  Instagram,
  Loader2,
  MoreVertical,
  Plus,
  Save,
  Sparkles,
  Trash2,
  Youtube,
} from 'lucide-react'

type StatusFilter = 'all' | PostStatus
type ChannelFilter = 'all' | PublicationType

const emptyPost = {
  name: '',
  channel: 'instagram_post' as PublicationType,
  description: '',
  aiContext: '',
  feedText: '',
  imageUrl: null as string | null,
  projectId: 'none',
}

const publicationOptions: Array<{
  value: PublicationType
  label: string
  icon: typeof Instagram
}> = [
  { value: 'instagram_post', label: 'Instagram Post', icon: Instagram },
  { value: 'instagram_story', label: 'Instagram Story', icon: Instagram },
  { value: 'youtube_post', label: 'YouTube Post', icon: Youtube },
  { value: 'youtube_shorts', label: 'YouTube Shorts', icon: Youtube },
  { value: 'youtube_video', label: 'YouTube Video', icon: Youtube },
]

function channelLabel(channel: PublicationType) {
  return publicationOptions.find((option) => option.value === channel)?.label || 'Instagram Post'
}

function statusLabel(status: PostStatus) {
  return status === 'saved' ? 'Salvo' : 'Rascunho'
}

function readImageAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export default function PostsPage() {
  const { toast } = useToast()
  const [projects, setProjects] = useState<Project[]>([])
  const [posts, setPosts] = useState<Post[]>([])
  const [selectedProject, setSelectedProject] = useState('all')
  const [selectedChannel, setSelectedChannel] = useState<ChannelFilter>('all')
  const [selectedStatus, setSelectedStatus] = useState<StatusFilter>('all')
  const [selectedPostIds, setSelectedPostIds] = useState<string[]>([])
  const [currentPostId, setCurrentPostId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyPost)
  const [isLoading, setIsLoading] = useState(true)
  const [isDataReady, setIsDataReady] = useState(false)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)

  const currentPost = posts.find((post) => post.id === currentPostId) || null

  useEffect(() => {
    const loadData = async () => {
      const supabase = createClient()
      const [{ data: projectsData }, postsResponse] = await Promise.all([
        supabase.from('projects').select('*').order('created_at', { ascending: false }),
        fetch('/api/posts'),
      ])
      const postsPayload = await postsResponse.json()

      if (projectsData) setProjects(projectsData)
      if (postsResponse.ok) setPosts(postsPayload.posts || [])
      else console.error('[v0] Posts load error:', postsPayload)

      setIsLoading(false)
      setIsDataReady(true)
    }

    loadData()
  }, [])

  useEffect(() => {
    if (!isDataReady || !currentPostId) return

    const timeoutId = window.setTimeout(() => {
      savePost('draft', false).catch((error) => {
        console.error('[v0] Post auto-save error:', error)
      })
    }, 800)

    return () => window.clearTimeout(timeoutId)
  }, [
    form.name,
    form.channel,
    form.description,
    form.aiContext,
    form.feedText,
    form.imageUrl,
    form.projectId,
    currentPostId,
    isDataReady,
  ])

  const filteredPosts = useMemo(() => {
    return posts.filter((post) => {
      const matchesProject = selectedProject === 'all' || post.project_id === selectedProject
      const matchesChannel = selectedChannel === 'all' || post.channel === selectedChannel
      const matchesStatus = selectedStatus === 'all' || post.status === selectedStatus
      return matchesProject && matchesChannel && matchesStatus
    })
  }, [posts, selectedChannel, selectedProject, selectedStatus])

  const selectedCount = selectedPostIds.length

  const updatePostList = (post: Post) => {
    setPosts((prev) => {
      const withoutCurrent = prev.filter((item) => item.id !== post.id)
      return [post, ...withoutCurrent]
    })
  }

  const applyPostToForm = (post: Post) => {
    setCurrentPostId(post.id)
    setForm({
      name: post.name,
      channel: post.channel,
      description: post.description || '',
      aiContext: post.ai_context || '',
      feedText: post.feed_text || '',
      imageUrl: post.image_url || null,
      projectId: post.project_id || 'none',
    })
  }

  const createPost = async () => {
    if (!form.name.trim()) {
      toast({
        title: 'Nome obrigatorio',
        description: 'Informe um nome para criar o post.',
        variant: 'destructive',
      })
      return
    }

    const post = await savePost('draft', false, true)
    if (post) {
      applyPostToForm(post)
      setIsCreateOpen(false)
    }
  }

  const savePost = async (
    status: PostStatus = currentPost?.status || 'draft',
    showToast = true,
    forceCreate = false,
  ) => {
    if (
      !form.name.trim() &&
      !form.description.trim() &&
      !form.aiContext.trim() &&
      !form.feedText.trim()
    ) {
      return null
    }

    setIsSaving(true)

    try {
      const response = await fetch('/api/posts', {
        method: currentPostId && !forceCreate ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: currentPostId,
          name: form.name,
          projectId: form.projectId === 'none' ? null : form.projectId,
          channel: form.channel,
          description: form.description || null,
          aiContext: form.aiContext || null,
          feedText: form.feedText || null,
          imageUrl: form.imageUrl,
          status,
        }),
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Erro ao salvar post')
      }

      updatePostList(data.post)
      setCurrentPostId(data.post.id)

      if (showToast) {
        toast({
          title: status === 'saved' ? 'Post salvo!' : 'Rascunho salvo!',
          description: status === 'saved'
            ? 'O post foi marcado como pronto.'
            : 'O rascunho foi atualizado.',
        })
      }

      return data.post as Post
    } finally {
      setIsSaving(false)
    }
  }

  const resetForm = () => {
    setCurrentPostId(null)
    setForm(emptyPost)
  }

  const handleImageChange = async (file: File | null) => {
    if (!file) return

    try {
      const imageUrl = await readImageAsDataUrl(file)
      setForm((prev) => ({ ...prev, imageUrl }))
    } catch {
      toast({
        title: 'Erro no upload',
        description: 'Nao foi possivel carregar a imagem.',
        variant: 'destructive',
      })
    }
  }

  const generateFeedText = async () => {
    if (!form.description.trim()) {
      toast({
        title: 'Descricao obrigatoria',
        description: 'Descreva o post antes de gerar o texto do feed.',
        variant: 'destructive',
      })
      return
    }

    setIsGenerating(true)

    try {
      const response = await fetch('/api/posts/generate-feed-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          channel: form.channel,
          description: form.description,
          aiContext: form.aiContext,
          projectId: form.projectId === 'none' ? null : form.projectId,
        }),
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Erro ao gerar texto')
      }

      setForm((prev) => ({ ...prev, feedText: data.feedText }))
      toast({
        title: 'Texto gerado',
        description: 'Revise o texto antes de salvar o post.',
      })
    } catch (error) {
      toast({
        title: 'Erro',
        description: error instanceof Error ? error.message : 'Nao foi possivel gerar o texto.',
        variant: 'destructive',
      })
    } finally {
      setIsGenerating(false)
    }
  }

  const toggleSelection = (id: string) => {
    setSelectedPostIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    )
  }

  const selectAllVisible = () => {
    const visibleIds = filteredPosts.map((post) => post.id)
    const allSelected = visibleIds.every((id) => selectedPostIds.includes(id))

    if (allSelected) {
      setSelectedPostIds((prev) => prev.filter((id) => !visibleIds.includes(id)))
    } else {
      setSelectedPostIds((prev) => Array.from(new Set([...prev, ...visibleIds])))
    }
  }

  const bulkUpdateStatus = async (status: PostStatus) => {
    await Promise.all(
      selectedPostIds.map((id) => {
        const post = posts.find((item) => item.id === id)
        if (!post) return null

        return fetch('/api/posts', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: post.id,
            name: post.name,
            projectId: post.project_id,
            channel: post.channel,
            description: post.description,
            aiContext: post.ai_context,
            feedText: post.feed_text,
            imageUrl: post.image_url,
            status,
          }),
        })
      }),
    )

    setPosts((prev) => prev.map((post) =>
      selectedPostIds.includes(post.id) ? { ...post, status } : post,
    ))
    setSelectedPostIds([])
  }

  const deletePosts = async (ids: string[]) => {
    const response = await fetch('/api/posts', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    })

    if (!response.ok) {
      const data = await response.json()
      throw new Error(data.error || 'Erro ao excluir post')
    }

    setPosts((prev) => prev.filter((post) => !ids.includes(post.id)))
    setSelectedPostIds((prev) => prev.filter((id) => !ids.includes(id)))

    if (currentPostId && ids.includes(currentPostId)) {
      resetForm()
    }

    toast({
      title: ids.length > 1 ? 'Publicacoes excluidas' : 'Publicacao excluida',
      description: ids.length > 1
        ? 'As publicacoes selecionadas foram removidas.'
        : 'A publicacao foi removida.',
    })
  }

  return (
    <>
      <Header title="PublicaÃ§Ãµes" />
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-7xl space-y-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-muted-foreground">
              Crie posts, stories, shorts e videos para Instagram e YouTube com rascunho automatico.
            </p>
            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2 bg-gradient-to-r from-violet-600 to-cyan-500 text-white" onClick={resetForm}>
                  <Plus className="h-4 w-4" />
                  Novo Post
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Novo Post</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="post-name">Nome do post</Label>
                    <Input
                      id="post-name"
                      value={form.name}
                      onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                      placeholder="Ex: Lancamento da campanha"
                    />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Rede</Label>
                      <ToggleGroup
                        type="single"
                        value={form.channel}
                        onValueChange={(value: PublicationType) => value && setForm((prev) => ({ ...prev, channel: value }))}
                        className="flex-wrap justify-start rounded-lg border border-border/50 p-1"
                      >
                        {publicationOptions.map((option) => (
                          <ToggleGroupItem key={option.value} value={option.value} className="gap-2">
                            <option.icon className="h-4 w-4" />
                            {option.label}
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                    </div>
                    <div className="space-y-2">
                      <Label>Projeto</Label>
                      <Select
                        value={form.projectId}
                        onValueChange={(value) => setForm((prev) => ({ ...prev, projectId: value }))}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Sem projeto</SelectItem>
                          {projects.map((project) => (
                            <SelectItem key={project.id} value={project.id}>
                              {project.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="post-context">Contexto para IA</Label>
                    <Textarea
                      id="post-context"
                      value={form.aiContext}
                      onChange={(event) => setForm((prev) => ({ ...prev, aiContext: event.target.value }))}
                      placeholder="Tom de voz, publico, objetivo, restricoes..."
                      rows={4}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="post-image">Imagem do post</Label>
                    <Input id="post-image" type="file" accept="image/*" onChange={(event) => handleImageChange(event.target.files?.[0] || null)} />
                  </div>
                  <Button onClick={createPost} className="gap-2">
                    <Plus className="h-4 w-4" />
                    Criar Post
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <ToggleGroup
              type="single"
              value={selectedStatus}
              onValueChange={(value: StatusFilter) => value && setSelectedStatus(value)}
              className="flex-wrap justify-start rounded-lg border border-border/50"
            >
              <ToggleGroupItem value="all" className="gap-2 text-xs">
                <FileText className="h-3.5 w-3.5" />
                Todos
              </ToggleGroupItem>
              <ToggleGroupItem value="draft" className="gap-2 text-xs">
                Rascunhos
              </ToggleGroupItem>
              <ToggleGroupItem value="saved" className="gap-2 text-xs">
                Salvos
              </ToggleGroupItem>
            </ToggleGroup>

            <ToggleGroup
              type="single"
              value={selectedChannel}
              onValueChange={(value: ChannelFilter) => value && setSelectedChannel(value)}
              className="rounded-lg border border-border/50"
            >
              <ToggleGroupItem value="all" className="gap-2 text-xs">
                Todos
              </ToggleGroupItem>
              {publicationOptions.map((option) => (
                <ToggleGroupItem key={option.value} value={option.value} className="gap-2 text-xs">
                  <option.icon className="h-3.5 w-3.5" />
                  {option.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>

            <div className="flex min-w-[240px] items-center gap-2">
              <FolderKanban className="h-4 w-4 text-muted-foreground" />
              <Select value={selectedProject} onValueChange={setSelectedProject}>
                <SelectTrigger className="bg-background/50">
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
          </div>

          {selectedCount > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-card/60 p-3">
              <Badge variant="secondary">{selectedCount} selecionado(s)</Badge>
              <Button size="sm" variant="outline" onClick={() => bulkUpdateStatus('saved')} className="gap-2">
                <CheckCircle2 className="h-4 w-4" />
                Marcar salvos
              </Button>
              <Button size="sm" variant="outline" onClick={() => bulkUpdateStatus('draft')} className="gap-2">
                <FileText className="h-4 w-4" />
                Voltar para rascunho
              </Button>
              <Button size="sm" variant="destructive" onClick={() => deletePosts(selectedPostIds)} className="gap-2">
                <Trash2 className="h-4 w-4" />
                Excluir
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelectedPostIds([])}>
                Limpar selecao
              </Button>
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-[minmax(320px,420px)_1fr]">
            <Card className="border-border/50 bg-card/30 backdrop-blur-sm">
              <CardContent className="space-y-3 p-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-semibold">Publicacoes salvas e rascunhos</h2>
                  <Button size="sm" variant="outline" onClick={selectAllVisible}>
                    Selecionar visiveis
                  </Button>
                </div>
                {isLoading ? (
                  <div className="flex justify-center py-12">
                    <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
                  </div>
                ) : filteredPosts.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                    Nenhum post encontrado.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredPosts.map((post) => (
                      <div
                        key={post.id}
                        className={`group relative rounded-lg border p-3 pr-11 transition-colors ${
                          currentPostId === post.id
                            ? 'border-violet-500/70 bg-violet-500/10'
                            : 'border-border/50 hover:border-border'
                        }`}
                      >
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="absolute right-2 top-2 h-8 w-8 opacity-0 transition-opacity group-hover:opacity-100"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={(event) => {
                                event.stopPropagation()
                                deletePosts([post.id])
                              }}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Excluir
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <div className="flex gap-3">
                          <Checkbox
                            checked={selectedPostIds.includes(post.id)}
                            onCheckedChange={() => toggleSelection(post.id)}
                            aria-label={`Selecionar ${post.name}`}
                          />
                          <button className="flex-1 text-left" onClick={() => applyPostToForm(post)}>
                            <div className="flex items-center gap-2">
                              <span className="line-clamp-1 text-sm font-medium">{post.name}</span>
                              <Badge variant={post.status === 'saved' ? 'default' : 'secondary'}>
                                {statusLabel(post.status)}
                              </Badge>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <Badge variant="outline">{channelLabel(post.channel)}</Badge>
                              {post.project_id && (
                                <Badge variant="outline">
                                  {projects.find((project) => project.id === post.project_id)?.name || 'Projeto'}
                                </Badge>
                              )}
                            </div>
                            {post.description && (
                              <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{post.description}</p>
                            )}
                          </button>
                          <div className="flex flex-col items-end gap-2">
                            {post.image_url && (
                              <img src={post.image_url} alt="" className="h-14 w-14 rounded-md object-cover" />
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-border/50 bg-card/30 backdrop-blur-sm">
              <CardContent className="space-y-5 p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">Criar seu post</h2>
                    <p className="text-sm text-muted-foreground">
                      Escreva a ideia, gere o texto do feed e salve quando estiver pronto.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {currentPostId && (
                      <Button
                        variant="destructive"
                        onClick={() => deletePosts([currentPostId])}
                        className="gap-2"
                      >
                        <Trash2 className="h-4 w-4" />
                        Excluir Publicacao
                      </Button>
                    )}
                    <Button variant="outline" onClick={() => savePost('draft')} disabled={isSaving} className="gap-2">
                      <Save className="h-4 w-4" />
                      Salvar Rascunho
                    </Button>
                    <Button onClick={() => savePost('saved')} disabled={isSaving} className="gap-2">
                      <CheckCircle2 className="h-4 w-4" />
                      Salvar Post
                    </Button>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="editor-post-name">Nome do post</Label>
                    <Input
                      id="editor-post-name"
                      value={form.name}
                      onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                      placeholder="Nome interno do post"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Projeto</Label>
                    <Select
                      value={form.projectId}
                      onValueChange={(value) => setForm((prev) => ({ ...prev, projectId: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Sem projeto</SelectItem>
                        {projects.map((project) => (
                          <SelectItem key={project.id} value={project.id}>
                            {project.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Rede</Label>
                  <ToggleGroup
                    type="single"
                    value={form.channel}
                    onValueChange={(value: PublicationType) => value && setForm((prev) => ({ ...prev, channel: value }))}
                    className="flex-wrap justify-start rounded-lg border border-border/50 p-1"
                  >
                    {publicationOptions.map((option) => (
                      <ToggleGroupItem key={option.value} value={option.value} className="gap-2">
                        <option.icon className="h-4 w-4" />
                        {option.label}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>

                <div className="grid gap-4 lg:grid-cols-[1fr_220px]">
                  <div className="space-y-2">
                    <Label htmlFor="editor-description">Descricao</Label>
                    <Textarea
                      id="editor-description"
                      value={form.description}
                      onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                      placeholder="Descreva o que esse post precisa comunicar."
                      rows={7}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="editor-image">Imagem</Label>
                    <div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg border border-border/50 bg-muted">
                      {form.imageUrl ? (
                        <img src={form.imageUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <FileText className="h-10 w-10 text-muted-foreground" />
                      )}
                    </div>
                    <Input id="editor-image" type="file" accept="image/*" onChange={(event) => handleImageChange(event.target.files?.[0] || null)} />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="editor-ai-context">Contexto para IA</Label>
                  <Textarea
                    id="editor-ai-context"
                    value={form.aiContext}
                    onChange={(event) => setForm((prev) => ({ ...prev, aiContext: event.target.value }))}
                    placeholder="Contexto, tom de voz, publico e qualquer detalhe importante."
                    rows={5}
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="editor-feed-text">Texto do feed</Label>
                    <Button variant="outline" size="sm" onClick={generateFeedText} disabled={isGenerating} className="gap-2">
                      {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                      Gerar texto do feed
                    </Button>
                  </div>
                  <Textarea
                    id="editor-feed-text"
                    value={form.feedText}
                    onChange={(event) => setForm((prev) => ({ ...prev, feedText: event.target.value }))}
                    placeholder="O texto gerado pela IA aparece aqui e pode ser editado."
                    rows={12}
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </>
  )
}
