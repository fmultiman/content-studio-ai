import { useState } from 'react'
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
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [projectImages, setProjectImages] = useState<any[]>([])
  
  // Load images when dialog opens for I2V
  useState(() => {
    if (open && projectId) {
       createClient().from('images').select('id, image_url, user_input').eq('project_id', projectId).eq('status', 'approved').neq('image_url', null).limit(50).then(({ data }) => {
         if (data) setProjectImages(data)
       })
    }
  })

  // We fetch again here to be safe and responsive.
  const handleOpenChange = (newOpen: boolean) => {
    if (newOpen && projectId) {
      createClient().from('images').select('id, image_url, user_input, created_at').eq('project_id', projectId).neq('image_url', null).order('created_at', { ascending: false }).limit(20).then(({ data }) => {
         if (data) setProjectImages(data)
       })
    }
    onOpenChange(newOpen)
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
          duration: '5'
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
        
        <Tabs value={mode} onValueChange={(v: any) => setMode(v)} className="w-full">
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
          </TabsContent>
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
