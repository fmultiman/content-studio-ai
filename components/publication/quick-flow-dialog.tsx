'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { ToastAction } from '@/components/ui/toast'
import { Loader2, ArrowLeft } from 'lucide-react'
import type { Production, Project } from '@/lib/types'
import type { PublicationChannel, PublicationFormat } from '@/lib/types'
import { PUBLICATION_CHANNELS, getFormatsForChannel } from '@/lib/publication-channels'

const CHANNEL_LABELS: Record<string, string> = {
  instagram: 'Instagram',
  youtube: 'YouTube',
  whatsapp: 'WhatsApp',
  linkedin: 'LinkedIn',
  x: 'X (Twitter)',
  tiktok: 'TikTok',
}

const FORMAT_LABELS: Record<string, string> = {
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

interface QuickFlowDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projects?: Project[]
  lockedProjectId?: string
  lockedProductionId?: string
  /** Pre-filled title for the editorial content (editable by user) */
  initialTitle?: string
  /** Pre-filled body for the editorial content (editable by user) */
  initialBody?: string
  /** Pre-filled AI context for the editorial content (editable by user) */
  initialAiContext?: string
  /** UI-only label shown in step 1 describing the origin (e.g. video name) */
  sourceLabel?: string
}

export function QuickFlowDialog({
  open,
  onOpenChange,
  projects = [],
  lockedProjectId,
  lockedProductionId,
  initialTitle = '',
  initialBody = '',
  initialAiContext = '',
  sourceLabel,
}: QuickFlowDialogProps) {
  const { toast } = useToast()
  const router = useRouter()

  const [step, setStep] = useState<1 | 2>(1)

  // Step 1 fields
  const [title, setTitle] = useState(initialTitle)
  const [ecBody, setEcBody] = useState(initialBody)
  const [aiContext, setAiContext] = useState(initialAiContext)
  const [projectId, setProjectId] = useState(lockedProjectId ?? 'none')
  const [productionId, setProductionId] = useState(lockedProductionId ?? 'none')
  const [productions, setProductions] = useState<Production[]>([])
  const [isCreatingEc, setIsCreatingEc] = useState(false)

  // EC created at step 1 — used for CP creation and rollback
  const [createdEcId, setCreatedEcId] = useState<string | null>(null)

  // Step 2 fields
  const [channel, setChannel] = useState<PublicationChannel | 'none'>('none')
  const [format, setFormat] = useState<PublicationFormat | 'none'>('none')
  const [cpBody, setCpBody] = useState('')
  const [cta, setCta] = useState('')
  const [hashtags, setHashtags] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  // Synchronous ref guards — state updates are async and cannot prevent concurrent calls
  const isHandlingNextRef = useRef(false)
  const isHandlingCreateRef = useRef(false)

  const resolvedProjectId = lockedProjectId ?? projectId
  const resolvedProductionId = lockedProductionId ?? productionId

  // Reset all state when dialog opens
  useEffect(() => {
    if (!open) return
    setStep(1)
    setTitle(initialTitle)
    setEcBody(initialBody)
    setAiContext(initialAiContext)
    setProjectId(lockedProjectId ?? 'none')
    setProductionId(lockedProductionId ?? 'none')
    setProductions([])
    setCreatedEcId(null)
    setChannel('none')
    setFormat('none')
    setCpBody('')
    setCta('')
    setHashtags('')
  }, [open, lockedProjectId, lockedProductionId, initialTitle, initialBody, initialAiContext])

  // Load productions when project changes (only when project is not locked)
  useEffect(() => {
    if (lockedProductionId) return
    if (projectId === 'none') {
      setProductions([])
      setProductionId('none')
      return
    }
    let cancelled = false
    fetch(`/api/productions?projectId=${projectId}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setProductions(d.productions || [])
      })
      .catch(() => {
        if (!cancelled) setProductions([])
      })
    return () => {
      cancelled = true
    }
  }, [projectId, lockedProductionId])

  // Reset format when channel changes
  useEffect(() => {
    setFormat('none')
  }, [channel])

  const validFormats = useMemo(() => {
    if (channel === 'none') return []
    return getFormatsForChannel(channel as PublicationChannel)
  }, [channel])

  function handleClose() {
    if (createdEcId) {
      const ecPath = `/projetos/${resolvedProjectId}/conteudos/${createdEcId}`
      toast({
        title: 'Conteúdo editorial salvo',
        description: `"${title.trim() || 'Conteúdo'}" foi salvo como rascunho. Adicione peças de canal quando quiser.`,
        action: (
          <ToastAction altText="Abrir workspace" onClick={() => router.push(ecPath)}>
            Abrir
          </ToastAction>
        ),
      })
    }
    onOpenChange(false)
  }

  async function handleNext() {
    if (isHandlingNextRef.current) return
    isHandlingNextRef.current = true
    try {
      if (!title.trim()) {
        toast({ title: 'Título obrigatório', variant: 'destructive' })
        return
      }
      if (resolvedProjectId === 'none') {
        toast({ title: 'Selecione um projeto', variant: 'destructive' })
        return
      }

      // EC already created (user went back from step 2) — PATCH with current values then advance
      if (createdEcId) {
        setIsCreatingEc(true)
        try {
          const patchPayload: Record<string, string | null> = { title: title.trim() }
          patchPayload.body = ecBody.trim() || null
          patchPayload.aiContext = aiContext.trim() || null
          await fetch(`/api/editorial-contents/${createdEcId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patchPayload),
          })
        } catch {
          // non-fatal: advance anyway; EC keeps previous values
        } finally {
          setIsCreatingEc(false)
        }
        setStep(2)
        return
      }

      setIsCreatingEc(true)
      try {
        const payload: Record<string, string> = {
          title: title.trim(),
          projectId: resolvedProjectId,
        }
        if (resolvedProductionId !== 'none') payload.productionId = resolvedProductionId
        if (ecBody.trim()) payload.body = ecBody.trim()
        if (aiContext.trim()) payload.aiContext = aiContext.trim()

        const res = await fetch('/api/editorial-contents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Erro ao criar conteúdo editorial')
        setCreatedEcId(data.editorialContent.id)
        setStep(2)
      } catch (err) {
        toast({
          title: 'Erro ao criar conteúdo editorial',
          description: err instanceof Error ? err.message : 'Tente novamente.',
          variant: 'destructive',
        })
      } finally {
        setIsCreatingEc(false)
      }
    } finally {
      isHandlingNextRef.current = false
    }
  }

  async function handleCreate() {
    if (isHandlingCreateRef.current) return
    isHandlingCreateRef.current = true
    if (channel === 'none') {
      toast({ title: 'Canal obrigatório', variant: 'destructive' })
      isHandlingCreateRef.current = false
      return
    }
    if (format === 'none') {
      toast({ title: 'Formato obrigatório', variant: 'destructive' })
      isHandlingCreateRef.current = false
      return
    }
    if (!createdEcId) {
      isHandlingCreateRef.current = false
      return
    }

    setIsSaving(true)
    try {
      const cpPayload: Record<string, string> = {
        editorialContentId: createdEcId,
        channel: channel as string,
        format: format as string,
      }
      if (cpBody.trim()) cpPayload.body = cpBody.trim()
      if (cta.trim()) cpPayload.cta = cta.trim()
      if (hashtags.trim()) cpPayload.hashtags = hashtags.trim()

      const cpRes = await fetch('/api/channel-pieces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cpPayload),
      })
      const cpData = await cpRes.json()

      if (!cpRes.ok) {
        // Rollback: attempt to delete the EC created at step 1
        const rollbackRes = await fetch(`/api/editorial-contents/${createdEcId}`, {
          method: 'DELETE',
        })
        if (!rollbackRes.ok) {
          const ecPath = `/projetos/${resolvedProjectId}/conteudos/${createdEcId}`
          toast({
            title: 'Erro ao criar peça de canal',
            description: `A peça não foi criada. O Conteúdo Editorial "${title.trim()}" permanece salvo e não pôde ser removido automaticamente.`,
            variant: 'destructive',
            action: (
              <ToastAction altText="Abrir conteúdo" onClick={() => router.push(ecPath)}>
                Abrir EC
              </ToastAction>
            ),
          })
        } else {
          toast({
            title: 'Erro ao criar peça de canal',
            description: cpData.error || 'Tente novamente.',
            variant: 'destructive',
          })
        }
        return
      }

      toast({ title: 'Publicação rápida criada', description: 'Redirecionando para o workspace...' })
      onOpenChange(false)
      router.push(`/projetos/${resolvedProjectId}/conteudos/${createdEcId}`)
    } catch (err) {
      toast({
        title: 'Erro ao finalizar publicação',
        description: err instanceof Error ? err.message : 'Tente novamente.',
        variant: 'destructive',
      })
    } finally {
      setIsSaving(false)
      isHandlingCreateRef.current = false
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose() }}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>
            {step === 1 ? 'Nova publicação rápida' : 'Definir peça de canal'}
          </DialogTitle>
          <DialogDescription>
            {step === 1
              ? 'Passo 1 de 2 — Defina o conteúdo editorial base.'
              : 'Passo 2 de 2 — Defina o canal e formato da publicação.'}
          </DialogDescription>
        </DialogHeader>

        {step === 1 ? (
          <div className="space-y-4 py-2">
            {sourceLabel && (
              <p className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                Preparando publicação a partir do vídeo <strong>&ldquo;{sourceLabel}&rdquo;</strong>.
              </p>
            )}

            <div className="space-y-2">
              <Label htmlFor="qf-title">Título *</Label>
              <Input
                id="qf-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex: Lançamento produto X — Instagram"
                onKeyDown={(e) => e.key === 'Enter' && handleNext()}
              />
            </div>

            {!lockedProjectId && (
              <div className="space-y-2">
                <Label>Projeto *</Label>
                <Select value={projectId} onValueChange={(v) => { setProjectId(v); setProductionId('none') }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um projeto" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Selecione um projeto</SelectItem>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {!lockedProductionId && projectId !== 'none' && productions.length > 0 && (
              <div className="space-y-2">
                <Label>Produção (opcional)</Label>
                <Select value={productionId} onValueChange={setProductionId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Sem produção" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem produção</SelectItem>
                    {productions.map((prod) => (
                      <SelectItem key={prod.id} value={prod.id}>{prod.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="qf-ec-body">Texto base do conteúdo (opcional)</Label>
              <Textarea
                id="qf-ec-body"
                value={ecBody}
                onChange={(e) => setEcBody(e.target.value)}
                placeholder="Resumo ou rascunho do conteúdo editorial..."
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="qf-ai-context">Contexto para IA (opcional)</Label>
              <Textarea
                id="qf-ai-context"
                value={aiContext}
                onChange={(e) => setAiContext(e.target.value)}
                placeholder="Objetivo, tom, público-alvo..."
                rows={2}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <p className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
              Conteúdo editorial <strong>&ldquo;{title}&rdquo;</strong> criado. Agora defina a peça de canal.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Canal *</Label>
                <Select value={channel} onValueChange={(v) => setChannel(v as PublicationChannel | 'none')}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Selecione</SelectItem>
                    {PUBLICATION_CHANNELS.map((ch) => (
                      <SelectItem key={ch} value={ch}>{CHANNEL_LABELS[ch] ?? ch}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Formato *</Label>
                <Select
                  value={format}
                  onValueChange={(v) => setFormat(v as PublicationFormat | 'none')}
                  disabled={channel === 'none'}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Selecione</SelectItem>
                    {validFormats.map((fmt) => (
                      <SelectItem key={fmt} value={fmt}>{FORMAT_LABELS[fmt] ?? fmt}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="qf-cp-body">Texto da peça (opcional)</Label>
              <Textarea
                id="qf-cp-body"
                value={cpBody}
                onChange={(e) => setCpBody(e.target.value)}
                placeholder="Texto adaptado para o canal e formato..."
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="qf-cta">CTA (opcional)</Label>
              <Input
                id="qf-cta"
                value={cta}
                onChange={(e) => setCta(e.target.value)}
                placeholder="Ex: Acesse o link na bio"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="qf-hashtags">Hashtags (opcional)</Label>
              <Input
                id="qf-hashtags"
                value={hashtags}
                onChange={(e) => setHashtags(e.target.value)}
                placeholder="#produto #lançamento"
              />
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          {step === 2 ? (
            <>
              <Button
                variant="ghost"
                onClick={() => setStep(1)}
                disabled={isSaving}
                className="mr-auto gap-2"
              >
                <ArrowLeft className="h-4 w-4" />
                Voltar
              </Button>
              <Button variant="outline" onClick={handleClose} disabled={isSaving}>
                Cancelar
              </Button>
              <Button onClick={handleCreate} disabled={isSaving}>
                {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Criar publicação
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={handleClose} disabled={isCreatingEc}>
                Cancelar
              </Button>
              <Button onClick={handleNext} disabled={isCreatingEc}>
                {isCreatingEc && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Próximo
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
