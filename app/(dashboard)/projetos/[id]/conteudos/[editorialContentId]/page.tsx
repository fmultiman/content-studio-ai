'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { useToast } from '@/hooks/use-toast'
import { createClient } from '@/lib/supabase/client'
import { getFormatsForChannel, PUBLICATION_CHANNELS } from '@/lib/publication-channels'
import type {
  ChannelPiece,
  ChannelPieceStatus,
  EditorialContent,
  EditorialContentStatus,
  Production,
  Project,
  PublicationChannel,
  PublicationFormat,
} from '@/lib/types'
import { Edit2, Loader2, Plus, RefreshCw, Save, Sparkles, Trash2 } from 'lucide-react'

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<EditorialContentStatus, string> = {
  draft: 'Rascunho',
  ready: 'Pronto',
  archived: 'Arquivado',
}

const CHANNEL_LABELS: Record<PublicationChannel, string> = {
  instagram: 'Instagram',
  youtube: 'YouTube',
  whatsapp: 'WhatsApp',
  linkedin: 'LinkedIn',
  x: 'X (Twitter)',
  tiktok: 'TikTok',
}

const FORMAT_LABELS: Record<PublicationFormat, string> = {
  feed: 'Feed',
  story: 'Story',
  reel: 'Reel',
  short: 'Short',
  video_description: 'Descrição de vídeo',
  post: 'Post',
  channel_message: 'Mensagem de canal',
  carousel: 'Carrossel',
  article: 'Artigo',
}

const CP_STATUS_LABELS: Record<ChannelPieceStatus, string> = {
  draft: 'Rascunho',
  ready: 'Pronta',
  approved: 'Aprovada',
  archived: 'Arquivada',
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function EditorialContentDetailPage() {
  const params = useParams()
  const router = useRouter()
  const { toast } = useToast()

  const ecId = params.editorialContentId as string
  const projectId = params.id as string

  // EC state
  const [ec, setEc] = useState<EditorialContent | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [productions, setProductions] = useState<Production[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)
  const [isSaving, setIsSaving] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  // EC form state
  const [formTitle, setFormTitle] = useState('')
  const [formBody, setFormBody] = useState('')
  const [formAiContext, setFormAiContext] = useState('')
  const [formStatus, setFormStatus] = useState<EditorialContentStatus>('draft')
  const [formProjectId, setFormProjectId] = useState('')
  const [formProductionId, setFormProductionId] = useState('none')

  // ChannelPieces list state
  const [channelPieces, setChannelPieces] = useState<ChannelPiece[]>([])
  const [isLoadingCps, setIsLoadingCps] = useState(false)
  const [cpLoadError, setCpLoadError] = useState(false)
  const [cpRetryKey, setCpRetryKey] = useState(0)

  // CP create/edit dialog
  const [showCpDialog, setShowCpDialog] = useState(false)
  const [editingCp, setEditingCp] = useState<ChannelPiece | null>(null)
  const [cpFormChannel, setCpFormChannel] = useState('')
  const [cpFormFormat, setCpFormFormat] = useState('')
  const [cpFormTitle, setCpFormTitle] = useState('')
  const [cpFormBody, setCpFormBody] = useState('')
  const [cpFormCta, setCpFormCta] = useState('')
  const [cpFormHashtags, setCpFormHashtags] = useState('')
  const [cpFormStatus, setCpFormStatus] = useState<ChannelPieceStatus>('draft')
  const [isSavingCp, setIsSavingCp] = useState(false)

  // CP delete dialog
  const [showDeleteCpDialog, setShowDeleteCpDialog] = useState(false)
  const [deletingCp, setDeletingCp] = useState<ChannelPiece | null>(null)
  const [isDeletingCp, setIsDeletingCp] = useState(false)

  // Generation state
  const [isGeneratingBody, setIsGeneratingBody] = useState(false)
  const [generateBodyError, setGenerateBodyError] = useState<string | null>(null)
  const [showOverwriteConfirm, setShowOverwriteConfirm] = useState(false)

  // ---------------------------------------------------------------------------
  // EC load effect — with mounted guard and URL projectId validation
  // ---------------------------------------------------------------------------

  useEffect(() => {
    setIsLoading(true)
    setError(null)
    let cancelled = false
    const load = async () => {
      try {
        const supabase = createClient()
        const [ecRes, { data: projectsData }] = await Promise.all([
          fetch(`/api/editorial-contents/${ecId}`),
          supabase.from('projects').select('*').order('created_at', { ascending: false }),
        ])

        if (cancelled) return

        if (!ecRes.ok) {
          setError(
            ecRes.status === 404 || ecRes.status === 401
              ? 'Conteúdo editorial não encontrado.'
              : 'Erro ao carregar conteúdo editorial.',
          )
          return
        }

        const ecData = await ecRes.json()
        const loaded: EditorialContent = ecData.editorialContent

        if (cancelled) return

        // Validate URL projectId matches the EC's actual project
        if (loaded.project_id !== projectId) {
          setError('Conteúdo editorial não encontrado.')
          return
        }

        setEc(loaded)
        setFormTitle(loaded.title)
        setFormBody(loaded.body || '')
        setFormAiContext(loaded.ai_context || '')
        setFormStatus(loaded.status)
        setFormProjectId(loaded.project_id)
        setFormProductionId(loaded.production_id || 'none')

        if (projectsData) setProjects(projectsData)
      } catch {
        if (!cancelled) setError('Erro inesperado. Tente novamente.')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [ecId, projectId, retryKey])

  // Productions sub-effect (depends on formProjectId)
  useEffect(() => {
    if (!formProjectId) {
      setProductions([])
      return
    }
    let cancelled = false
    fetch(`/api/productions?projectId=${formProjectId}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setProductions(d.productions || []) })
      .catch(() => { if (!cancelled) setProductions([]) })
    return () => { cancelled = true }
  }, [formProjectId])

  // Channel pieces load effect
  useEffect(() => {
    if (!ecId) return
    setIsLoadingCps(true)
    setCpLoadError(false)
    let cancelled = false
    fetch(`/api/channel-pieces?editorialContentId=${ecId}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setChannelPieces(d.channelPieces || []) })
      .catch(() => { if (!cancelled) setCpLoadError(true) })
      .finally(() => { if (!cancelled) setIsLoadingCps(false) })
    return () => { cancelled = true }
  }, [ecId, cpRetryKey])

  // ---------------------------------------------------------------------------
  // Valid formats for selected CP channel
  // ---------------------------------------------------------------------------

  const validFormatsForChannel = useMemo(
    () => (cpFormChannel ? getFormatsForChannel(cpFormChannel as PublicationChannel) : []),
    [cpFormChannel],
  )

  // ---------------------------------------------------------------------------
  // EC handlers
  // ---------------------------------------------------------------------------

  const handleSave = async () => {
    if (!formTitle.trim()) {
      toast({ title: 'Título obrigatório', variant: 'destructive' })
      return
    }
    if (!formProjectId) {
      toast({ title: 'Projeto obrigatório', variant: 'destructive' })
      return
    }
    setIsSaving(true)
    try {
      const res = await fetch(`/api/editorial-contents/${ecId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: formTitle.trim(),
          body: formBody || null,
          aiContext: formAiContext || null,
          status: formStatus,
          projectId: formProjectId,
          productionId: formProductionId === 'none' ? null : formProductionId,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao salvar')
      setEc(data.editorialContent)
      toast({ title: 'Salvo!', description: 'Conteúdo editorial atualizado.' })
    } catch (err) {
      toast({
        title: 'Erro ao salvar',
        description: err instanceof Error ? err.message : 'Tente novamente.',
        variant: 'destructive',
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    setIsDeleting(true)
    try {
      const res = await fetch(`/api/editorial-contents/${ecId}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        toast({
          title: 'Erro',
          description: data.error || 'Não foi possível excluir.',
          variant: 'destructive',
        })
        return
      }
      toast({ title: 'Excluído', description: 'Conteúdo editorial removido.' })
      router.push('/publicacoes')
    } catch {
      toast({ title: 'Erro', description: 'Erro de conexão.', variant: 'destructive' })
    } finally {
      setIsDeleting(false)
      setShowDeleteDialog(false)
    }
  }

  // ---------------------------------------------------------------------------
  // CP dialog handlers
  // ---------------------------------------------------------------------------

  const openCreateCpDialog = () => {
    setEditingCp(null)
    setCpFormChannel('')
    setCpFormFormat('')
    setCpFormTitle('')
    setCpFormBody('')
    setCpFormCta('')
    setCpFormHashtags('')
    setCpFormStatus('draft')
    setGenerateBodyError(null)
    setShowCpDialog(true)
  }

  const openEditCpDialog = (cp: ChannelPiece) => {
    // Security: CP must belong to the current EC
    if (cp.editorial_content_id !== ecId) return
    setEditingCp(cp)
    setCpFormChannel(cp.channel)
    setCpFormFormat(cp.format)
    setCpFormTitle(cp.title || '')
    setCpFormBody(cp.body || '')
    setCpFormCta(cp.cta || '')
    setCpFormHashtags(cp.hashtags || '')
    setCpFormStatus(cp.status)
    setGenerateBodyError(null)
    setShowCpDialog(true)
  }

  const handleCpChannelChange = (channel: string) => {
    setCpFormChannel(channel)
    if (cpFormFormat) {
      const formats = getFormatsForChannel(channel as PublicationChannel)
      if (!formats.includes(cpFormFormat as PublicationFormat)) {
        setCpFormFormat('')
      }
    }
  }

  const handleSaveCp = async () => {
    if (!cpFormChannel) {
      toast({ title: 'Canal obrigatório', variant: 'destructive' })
      return
    }
    if (!cpFormFormat) {
      toast({ title: 'Formato obrigatório', variant: 'destructive' })
      return
    }
    setIsSavingCp(true)
    try {
      if (editingCp) {
        // Security check
        if (editingCp.editorial_content_id !== ecId) {
          toast({ title: 'Erro de segurança: peça não pertence a este conteúdo.', variant: 'destructive' })
          return
        }
        const res = await fetch(`/api/channel-pieces/${editingCp.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channel: cpFormChannel,
            format: cpFormFormat,
            title: cpFormTitle.trim() || null,
            body: cpFormBody.trim() || null,
            cta: cpFormCta.trim() || null,
            hashtags: cpFormHashtags.trim() || null,
            status: cpFormStatus,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Erro ao salvar')
        setChannelPieces((prev) => prev.map((cp) => (cp.id === editingCp.id ? data.channelPiece : cp)))
        toast({ title: 'Peça atualizada!' })
        setShowCpDialog(false)
      } else {
        const res = await fetch('/api/channel-pieces', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            editorialContentId: ecId,
            channel: cpFormChannel,
            format: cpFormFormat,
            title: cpFormTitle.trim() || null,
            body: cpFormBody.trim() || null,
            cta: cpFormCta.trim() || null,
            hashtags: cpFormHashtags.trim() || null,
            status: cpFormStatus,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Erro ao criar')
        setChannelPieces((prev) => [data.channelPiece, ...prev])
        toast({ title: 'Peça criada!' })
        setShowCpDialog(false)
      }
    } catch (err) {
      toast({
        title: editingCp ? 'Erro ao atualizar' : 'Erro ao criar',
        description: err instanceof Error ? err.message : 'Tente novamente.',
        variant: 'destructive',
      })
    } finally {
      setIsSavingCp(false)
    }
  }

  const handleDeleteCp = async () => {
    if (!deletingCp) return
    if (deletingCp.editorial_content_id !== ecId) {
      toast({ title: 'Erro de segurança', variant: 'destructive' })
      setShowDeleteCpDialog(false)
      return
    }
    setIsDeletingCp(true)
    try {
      const res = await fetch(`/api/channel-pieces/${deletingCp.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Erro ao excluir')
      }
      setChannelPieces((prev) => prev.filter((cp) => cp.id !== deletingCp.id))
      toast({ title: 'Peça excluída' })
      setShowDeleteCpDialog(false)
      setDeletingCp(null)
    } catch (err) {
      toast({
        title: 'Erro ao excluir',
        description: err instanceof Error ? err.message : '',
        variant: 'destructive',
      })
    } finally {
      setIsDeletingCp(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Body generation handlers
  // ---------------------------------------------------------------------------

  const handleGenerateBody = async () => {
    if (!cpFormChannel || !cpFormFormat) return
    if (cpFormBody.trim()) {
      setShowOverwriteConfirm(true)
      return
    }
    await doGenerateBody()
  }

  const doGenerateBody = async () => {
    setShowOverwriteConfirm(false)
    setIsGeneratingBody(true)
    setGenerateBodyError(null)
    try {
      const res = await fetch('/api/channel-pieces/generate-body', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          editorialContentId: ecId,
          channel: cpFormChannel,
          format: cpFormFormat,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro na geração')
      setCpFormBody(data.generatedBody)
    } catch (err) {
      setGenerateBodyError(err instanceof Error ? err.message : 'Erro ao gerar sugestão')
    } finally {
      setIsGeneratingBody(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Early returns (loading / error)
  // ---------------------------------------------------------------------------

  if (isLoading) {
    return (
      <>
        <Header title="Carregando..." />
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </>
    )
  }

  if (error || !ec) {
    return (
      <>
        <Header title="Erro" />
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <p className="text-muted-foreground">{error || 'Conteúdo editorial não encontrado'}</p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setRetryKey((k) => k + 1)} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Tentar novamente
            </Button>
            <Button variant="outline" onClick={() => router.push('/publicacoes')}>
              Voltar para Publicações
            </Button>
          </div>
        </div>
      </>
    )
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <>
      <Header title={ec.title} />
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-4xl space-y-6">

          {/* Breadcrumb */}
          <nav className="flex items-center gap-1 text-sm text-muted-foreground">
            <Button
              variant="ghost"
              size="sm"
              className="h-auto px-0 py-0 hover:text-foreground"
              onClick={() => router.push('/publicacoes')}
            >
              Publicações
            </Button>
            <span>/</span>
            <span className="truncate font-medium text-foreground">{ec.title}</span>
          </nav>

          {/* EC Edit Form */}
          <Card className="border-border/50 bg-card/30 backdrop-blur-sm">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Conteúdo Editorial</CardTitle>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 text-destructive hover:text-destructive"
                  onClick={() => setShowDeleteDialog(true)}
                >
                  <Trash2 className="h-4 w-4" />
                  Excluir
                </Button>
                <Button size="sm" className="gap-2" onClick={handleSave} disabled={isSaving}>
                  {isSaving
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Save className="h-4 w-4" />}
                  Salvar
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="ec-title">Título *</Label>
                <Input
                  id="ec-title"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="Título do conteúdo editorial"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select
                    value={formStatus}
                    onValueChange={(v) => setFormStatus(v as EditorialContentStatus)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(['draft', 'ready', 'archived'] as EditorialContentStatus[]).map((s) => (
                        <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Projeto *</Label>
                  <Select
                    value={formProjectId}
                    onValueChange={(v) => {
                      setFormProjectId(v)
                      setFormProductionId('none')
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {projects.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Produção</Label>
                  <Select value={formProductionId} onValueChange={setFormProductionId}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sem produção</SelectItem>
                      {productions.map((prod) => (
                        <SelectItem key={prod.id} value={prod.id}>{prod.title}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ec-body">Corpo do conteúdo</Label>
                <Textarea
                  id="ec-body"
                  value={formBody}
                  onChange={(e) => setFormBody(e.target.value)}
                  placeholder="Escreva o conteúdo editorial aqui..."
                  rows={8}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="ec-ai-context">Contexto para IA</Label>
                <Textarea
                  id="ec-ai-context"
                  value={formAiContext}
                  onChange={(e) => setFormAiContext(e.target.value)}
                  placeholder="Tom de voz, público-alvo, referências..."
                  rows={4}
                />
              </div>
            </CardContent>
          </Card>

          {/* Channel Pieces section */}
          <Card className="border-border/50 bg-card/30 backdrop-blur-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base">
                Peças de Canal
                {!isLoadingCps && !cpLoadError && (
                  <span className="ml-1 text-muted-foreground">({channelPieces.length})</span>
                )}
              </CardTitle>
              <Button
                size="sm"
                variant="outline"
                className="gap-2"
                onClick={openCreateCpDialog}
              >
                <Plus className="h-4 w-4" />
                Nova peça
              </Button>
            </CardHeader>
            <CardContent>
              {isLoadingCps ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : cpLoadError ? (
                <div className="flex flex-col items-center gap-3 py-8 text-center">
                  <p className="text-sm text-muted-foreground">Erro ao carregar peças de canal.</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() => setCpRetryKey((k) => k + 1)}
                  >
                    <RefreshCw className="h-4 w-4" />
                    Tentar novamente
                  </Button>
                </div>
              ) : channelPieces.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center">
                  <p className="text-sm font-medium">Nenhuma peça de canal</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Crie adaptações do conteúdo editorial para cada canal e formato.
                  </p>
                  <Button className="mt-4" size="sm" onClick={openCreateCpDialog}>
                    <Plus className="mr-2 h-4 w-4" />
                    Nova peça de canal
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {channelPieces.map((cp) => (
                    <div
                      key={cp.id}
                      className="rounded-lg border border-border/50 bg-background/50 p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">{CHANNEL_LABELS[cp.channel]}</Badge>
                          <Badge variant="outline">{FORMAT_LABELS[cp.format]}</Badge>
                          <Badge
                            variant={
                              cp.status === 'approved'
                                ? 'default'
                                : cp.status === 'archived'
                                  ? 'secondary'
                                  : 'outline'
                            }
                          >
                            {CP_STATUS_LABELS[cp.status]}
                          </Badge>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 gap-1.5 px-2 text-xs"
                            onClick={() => openEditCpDialog(cp)}
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                            Editar
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 gap-1.5 px-2 text-xs text-destructive hover:text-destructive"
                            onClick={() => {
                              setDeletingCp(cp)
                              setShowDeleteCpDialog(true)
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Excluir
                          </Button>
                        </div>
                      </div>
                      {cp.title && (
                        <p className="mt-2 text-sm font-medium">{cp.title}</p>
                      )}
                      {cp.body && (
                        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                          {cp.body}
                        </p>
                      )}
                      {cp.hashtags && (
                        <p className="mt-1 truncate text-xs text-muted-foreground/70">
                          {cp.hashtags}
                        </p>
                      )}
                      <p className="mt-2 text-xs text-muted-foreground">
                        Atualizado em {new Date(cp.updated_at).toLocaleDateString('pt-BR')}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* EC Delete Confirmation */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir conteúdo editorial?</AlertDialogTitle>
            <AlertDialogDescription>
              O conteúdo <strong>&quot;{ec.title}&quot;</strong> será removido
              permanentemente, incluindo todas as suas peças de canal.
              Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* CP Create/Edit Dialog */}
      <Dialog
        open={showCpDialog}
        onOpenChange={(open) => {
          if (!open && !isSavingCp) setShowCpDialog(false)
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingCp ? 'Editar peça de canal' : 'Nova peça de canal'}
            </DialogTitle>
            <DialogDescription>
              Configure canal, formato e conteúdo adaptado para esta peça.
              Aprovada significa revisada e pronta para uso — não publicada.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[65vh] space-y-4 overflow-y-auto py-1 pr-1">
            {/* Channel + Format */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Canal *</Label>
                <Select value={cpFormChannel} onValueChange={handleCpChannelChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o canal" />
                  </SelectTrigger>
                  <SelectContent>
                    {PUBLICATION_CHANNELS.map((ch) => (
                      <SelectItem key={ch} value={ch}>
                        {CHANNEL_LABELS[ch]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Formato *</Label>
                <Select
                  value={cpFormFormat}
                  onValueChange={setCpFormFormat}
                  disabled={!cpFormChannel}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        cpFormChannel ? 'Selecione o formato' : 'Selecione o canal primeiro'
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {validFormatsForChannel.map((fmt) => (
                      <SelectItem key={fmt} value={fmt}>
                        {FORMAT_LABELS[fmt]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Status */}
            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={cpFormStatus}
                onValueChange={(v) => setCpFormStatus(v as ChannelPieceStatus)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Rascunho</SelectItem>
                  <SelectItem value="ready">Pronta</SelectItem>
                  <SelectItem value="approved">Aprovada</SelectItem>
                  <SelectItem value="archived">Arquivada</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Title override */}
            <div className="space-y-2">
              <Label htmlFor="cp-title">Título para este canal</Label>
              <Input
                id="cp-title"
                value={cpFormTitle}
                onChange={(e) => setCpFormTitle(e.target.value)}
                placeholder="Override de título (opcional)"
              />
            </div>

            {/* Body + Generate */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="cp-body">Texto adaptado</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={handleGenerateBody}
                  disabled={!cpFormChannel || !cpFormFormat || isGeneratingBody}
                >
                  {isGeneratingBody
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Sparkles className="h-4 w-4" />}
                  Gerar sugestão
                </Button>
              </div>
              {generateBodyError && (
                <p className="text-xs text-destructive">{generateBodyError}</p>
              )}
              <Textarea
                id="cp-body"
                value={cpFormBody}
                onChange={(e) => setCpFormBody(e.target.value)}
                placeholder="Texto adaptado para este canal e formato..."
                rows={6}
              />
            </div>

            {/* CTA */}
            <div className="space-y-2">
              <Label htmlFor="cp-cta">CTA (Call to Action)</Label>
              <Input
                id="cp-cta"
                value={cpFormCta}
                onChange={(e) => setCpFormCta(e.target.value)}
                placeholder="Ex: Clique no link da bio"
              />
            </div>

            {/* Hashtags */}
            <div className="space-y-2">
              <Label htmlFor="cp-hashtags">Hashtags</Label>
              <Input
                id="cp-hashtags"
                value={cpFormHashtags}
                onChange={(e) => setCpFormHashtags(e.target.value)}
                placeholder="#hashtag1 #hashtag2 #hashtag3"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCpDialog(false)}
              disabled={isSavingCp}
            >
              Cancelar
            </Button>
            <Button onClick={handleSaveCp} disabled={isSavingCp}>
              {isSavingCp && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingCp ? 'Salvar alterações' : 'Criar peça'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CP Delete Confirmation */}
      <AlertDialog
        open={showDeleteCpDialog}
        onOpenChange={(open) => {
          if (!open && !isDeletingCp) {
            setShowDeleteCpDialog(false)
            setDeletingCp(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir peça de canal?</AlertDialogTitle>
            <AlertDialogDescription>
              A peça{' '}
              <strong>
                {deletingCp
                  ? `${CHANNEL_LABELS[deletingCp.channel]} / ${FORMAT_LABELS[deletingCp.format]}`
                  : ''}
              </strong>{' '}
              será removida permanentemente. O conteúdo editorial será preservado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingCp}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteCp}
              disabled={isDeletingCp}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeletingCp && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Overwrite body confirmation */}
      <AlertDialog open={showOverwriteConfirm} onOpenChange={setShowOverwriteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Substituir texto existente?</AlertDialogTitle>
            <AlertDialogDescription>
              Já existe texto no campo &quot;Texto adaptado&quot;. A sugestão da IA vai substituí-lo.
              Você poderá editar o resultado antes de salvar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={doGenerateBody}>Gerar nova versão</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
