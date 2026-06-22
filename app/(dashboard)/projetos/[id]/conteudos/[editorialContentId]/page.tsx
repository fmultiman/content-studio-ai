'use client'

import { useEffect, useState } from 'react'
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
import type {
  EditorialContent,
  EditorialContentStatus,
  ChannelPiece,
  Project,
  Production,
  PublicationChannel,
  PublicationFormat,
} from '@/lib/types'
import { Loader2, Save, Trash2 } from 'lucide-react'

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
  video_description: 'Descrição de Vídeo',
  post: 'Post',
  channel_message: 'Mensagem de Canal',
  carousel: 'Carrossel',
  article: 'Artigo',
}

const CP_STATUS_LABELS: Record<string, string> = {
  draft: 'Rascunho',
  ready: 'Pronto',
  approved: 'Aprovado',
  archived: 'Arquivado',
}

export default function EditorialContentDetailPage() {
  const params = useParams()
  const router = useRouter()
  const { toast } = useToast()

  const ecId = params.editorialContentId as string

  const [ec, setEc] = useState<EditorialContent | null>(null)
  const [channelPieces, setChannelPieces] = useState<ChannelPiece[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [productions, setProductions] = useState<Production[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingCps, setIsLoadingCps] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  // Form state
  const [formTitle, setFormTitle] = useState('')
  const [formBody, setFormBody] = useState('')
  const [formAiContext, setFormAiContext] = useState('')
  const [formStatus, setFormStatus] = useState<EditorialContentStatus>('draft')
  const [formProjectId, setFormProjectId] = useState('')
  const [formProductionId, setFormProductionId] = useState('none')

  useEffect(() => {
    const load = async () => {
      try {
        const supabase = createClient()
        const [ecRes, { data: projectsData }] = await Promise.all([
          fetch(`/api/editorial-contents/${ecId}`),
          supabase.from('projects').select('*').order('created_at', { ascending: false }),
        ])

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
        setEc(loaded)
        setFormTitle(loaded.title)
        setFormBody(loaded.body || '')
        setFormAiContext(loaded.ai_context || '')
        setFormStatus(loaded.status)
        setFormProjectId(loaded.project_id)
        setFormProductionId(loaded.production_id || 'none')

        if (projectsData) setProjects(projectsData)
      } catch {
        setError('Erro inesperado. Tente novamente.')
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [ecId])

  // Load productions when formProjectId changes
  useEffect(() => {
    if (!formProjectId) {
      setProductions([])
      return
    }
    fetch(`/api/productions?projectId=${formProjectId}`)
      .then((r) => r.json())
      .then((d) => setProductions(d.productions || []))
      .catch(() => setProductions([]))
  }, [formProjectId])

  // Load channel pieces
  useEffect(() => {
    if (!ecId) return
    setIsLoadingCps(true)
    fetch(`/api/channel-pieces?editorialContentId=${ecId}`)
      .then((r) => r.json())
      .then((d) => setChannelPieces(d.channelPieces || []))
      .catch(() => {})
      .finally(() => setIsLoadingCps(false))
  }, [ecId])

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
          <Button variant="outline" onClick={() => router.push('/publicacoes')}>
            Voltar para Publicações
          </Button>
        </div>
      </>
    )
  }

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

          {/* Edit Form */}
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

          {/* Channel Pieces — read-only list */}
          <Card className="border-border/50 bg-card/30 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-base">Adaptações por Canal</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoadingCps ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : channelPieces.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                  Nenhuma adaptação por canal ainda. As adaptações serão gerenciadas em uma versão futura.
                </div>
              ) : (
                <div className="space-y-2">
                  {channelPieces.map((cp) => (
                    <div
                      key={cp.id}
                      className="flex flex-wrap items-center gap-3 rounded-lg border border-border/50 bg-background/50 p-3"
                    >
                      <Badge variant="outline">{CHANNEL_LABELS[cp.channel]}</Badge>
                      <Badge variant="outline">{FORMAT_LABELS[cp.format]}</Badge>
                      <Badge variant={cp.status === 'approved' ? 'default' : 'secondary'}>
                        {CP_STATUS_LABELS[cp.status] ?? cp.status}
                      </Badge>
                      {cp.title && (
                        <span className="truncate text-sm text-foreground">{cp.title}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Delete Confirmation */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir conteúdo editorial?</AlertDialogTitle>
            <AlertDialogDescription>
              O conteúdo <strong>&quot;{ec.title}&quot;</strong> será removido
              permanentemente, incluindo todas as suas adaptações por canal.
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
              {isDeleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Excluindo...
                </>
              ) : (
                'Excluir'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
