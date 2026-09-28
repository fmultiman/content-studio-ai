import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Image as ImageIcon, FileText, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import type { Project, Production, Image } from '@/lib/types'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { createClient } from '@/lib/supabase/client'

interface CreateVideoGenerationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  productionId: string
  onSuccess?: () => void
}

export function CreateVideoGenerationDialog({
  open,
  onOpenChange,
  projectId,
  productionId,
  onSuccess,
}: CreateVideoGenerationDialogProps) {
  const router = useRouter()
  const { toast } = useToast()
  
  const [mode, setMode] = useState<'image_to_video' | 'text_to_video'>('image_to_video')
  const [prompt, setPrompt] = useState('')
  const [sourceImageId, setSourceImageId] = useState('')
  
  const [duration, setDuration] = useState<5 | 10>(5)
  const [resolution, setResolution] = useState<'720p' | '1080p'>('720p')
  const [audio, setAudio] = useState<'off' | 'on'>('off')
  const [multiShot, setMultiShot] = useState<'false' | 'true'>('false')
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16' | '1:1'>('16:9')

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [projectImages, setProjectImages] = useState<any[]>([])
  
  // Load images when dialog opens for I2V
  useEffect(() => {
    if (open && projectId) {
      createClient()
        .from('images')
        .select('id, image_url, user_input, created_at')
        .eq('project_id', projectId)
        .neq('image_url', null)
        .order('created_at', { ascending: false })
        .limit(30)
        .then(({ data }) => {
          if (data) setProjectImages(data)
        })
    }
  }, [open, projectId])

  // We fetch again here to be safe and responsive.
  const handleOpenChange = (newOpen: boolean) => {
    if (newOpen && projectId) {
      createClient().from('images').select('id, image_url, user_input, created_at').eq('project_id', projectId).neq('image_url', null).order('created_at', { ascending: false }).limit(20).then(({ data }) => {
         if (data) setProjectImages(data)
       })
    }
    onOpenChange(newOpen)
  }

  const handleModeChange = (newMode: 'image_to_video' | 'text_to_video') => {
    setMode(newMode)
    if (newMode === 'text_to_video') {
      setSourceImageId('')
    }
  }

  const handleSubmit = async () => {
    if (!prompt.trim()) {
      toast({ title: 'Prompt obrigatório', variant: 'destructive' })
      return
    }
    
    if (mode === 'image_to_video' && !sourceImageId) {
      toast({ title: 'Selecione uma imagem', variant: 'destructive' })
      return
    }

    setIsSubmitting(true)
    
    try {
      const res = await fetch('/api/video-generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          productionId,
          mode,
          prompt,
          sourceImageId: mode === 'image_to_video' ? sourceImageId : undefined,
          duration,
          resolution,
          audio,
          multi_shot: multiShot === 'true',
          aspect_ratio: mode === 'text_to_video' ? aspectRatio : undefined
        })
      })
      
      const data = await res.json()
      
      if (!res.ok) {
        throw new Error(data.error || 'Erro ao criar geração de vídeo')
      }
      
      toast({ title: 'Geração iniciada!', description: 'O vídeo está sendo gerado pela IA (Kling)' })
      onOpenChange(false)
      if (onSuccess) onSuccess()
      
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Mágica IA: Criar Novo Vídeo</DialogTitle>
          <DialogDescription>
            Gere um vídeo do zero usando Inteligência Artificial (Kling 3.0). O resultado fará parte desta Produção.
          </DialogDescription>
        </DialogHeader>
        
          <Tabs value={mode} onValueChange={(v: any) => handleModeChange(v)} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
               <TabsTrigger value="image_to_video" className="gap-2"><ImageIcon className="w-4 h-4" /> Imagem → Vídeo</TabsTrigger>
               <TabsTrigger value="text_to_video" className="gap-2"><FileText className="w-4 h-4" /> Texto → Vídeo</TabsTrigger>
            </TabsList>
            
            <TabsContent value="image_to_video" className="space-y-4 pt-4">
               <div className="space-y-2">
                 <Label>Imagem de Origem</Label>
                 <Select value={sourceImageId} onValueChange={setSourceImageId}>
                    <SelectTrigger className="w-full h-14">
                       <SelectValue placeholder="Escolha uma imagem gerada neste Projeto..." />
                    </SelectTrigger>
                    <SelectContent>
                       {projectImages.map(img => (
                          <SelectItem key={img.id} value={img.id} className="py-2">
                             <div className="flex items-center gap-3">
                                <img src={img.image_url} alt="thumbnail" className="w-10 h-10 object-cover rounded-md" />
                                <span className="truncate w-64 text-sm">{img.user_input}</span>
                             </div>
                          </SelectItem>
                       ))}
                    </SelectContent>
                 </Select>
               </div>
               
               <div className="space-y-2">
                  <Label>Motion Prompt (Dicas de animação)</Label>
                  <Textarea 
                    placeholder="Como esta imagem deve ser animada? (Ex: A câmera se aproxima suavemente, o cabelo flineia com o vento)" 
                    value={prompt} onChange={(e) => setPrompt(e.target.value)} 
                    className="min-h-[100px]"
                  />
               </div>
            </TabsContent>
            
            <TabsContent value="text_to_video" className="space-y-4 pt-4">
               <div className="space-y-2">
                  <Label>Prompt</Label>
                  <Textarea 
                    placeholder="Descreva a cena do vídeo detalhadamente..." 
                    value={prompt} onChange={(e) => setPrompt(e.target.value)} 
                    className="min-h-[140px]"
                  />
               </div>

               <div className="space-y-2">
                  <Label>Proporção</Label>
                  <Select value={aspectRatio} onValueChange={(v: any) => setAspectRatio(v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione o formato" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="16:9">Horizontal (16:9)</SelectItem>
                      <SelectItem value="9:16">Vertical (9:16)</SelectItem>
                      <SelectItem value="1:1">Quadrado (1:1)</SelectItem>
                    </SelectContent>
                  </Select>
               </div>
            </TabsContent>

            {/* SHARED CONTROLS BELOW PROMPT */}
            <div className="grid grid-cols-2 gap-4 mt-6 p-4 rounded-md bg-secondary/20">
               <div className="space-y-2">
                  <Label>Duração</Label>
                  <Select value={duration.toString()} onValueChange={(v) => setDuration(Number(v) as 5 | 10)}>
                    <SelectTrigger>
                      <SelectValue placeholder="5 segundos" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="5">5 segundos</SelectItem>
                      <SelectItem value="10">10 segundos</SelectItem>
                    </SelectContent>
                  </Select>
                  {duration === 10 && <p className="text-[10px] text-muted-foreground mt-1">Custa +3 unidades.</p>}
               </div>

               <div className="space-y-2">
                  <Label>Qualidade / Resolução</Label>
                  <Select value={resolution} onValueChange={(v: any) => setResolution(v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Padrão (720p)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="720p">Padrão (720p)</SelectItem>
                      <SelectItem value="1080p">Alta (1080p)</SelectItem>
                    </SelectContent>
                  </Select>
                  {resolution === '1080p' && <p className="text-[10px] text-muted-foreground mt-1">Custa o triplo de unidades.</p>}
               </div>

               <div className="space-y-2">
                  <Label>Áudio Automático</Label>
                  <Select value={audio} onValueChange={(v: any) => setAudio(v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Sem áudio" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="off">Sem Áudio</SelectItem>
                      <SelectItem value="on">Gerar Áudio (IA)</SelectItem>
                    </SelectContent>
                  </Select>
               </div>

               <div className="space-y-2">
                  <Label>Movimento Extra (Multi-shot)</Label>
                  <Select value={multiShot} onValueChange={(v: any) => setMultiShot(v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Padrão" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="false">Padrão</SelectItem>
                      <SelectItem value="true">Ativo (Multi-shot)</SelectItem>
                    </SelectContent>
                  </Select>
               </div>
            </div>
          </Tabs>
        
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={isSubmitting} className="gap-2">
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            Gerar Vídeo IA
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
