'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  DashboardPage,
  DashboardPageContent,
} from '@/components/layout/dashboard-page'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  ArrowLeft,
  Loader2,
  FileText,
  Video,
  Trash2,
  Calendar,
  Layers,
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import type { VideoDraft, Project } from '@/lib/types'

export default function VideoDraftsPage() {
  const router = useRouter()
  const { toast } = useToast()
  
  const [drafts, setDrafts] = useState<VideoDraft[]>([])
  const [projects, setProjects] = useState<Record<string, Project>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    const fetchDrafts = async () => {
      const supabase = createClient()
      
      // Fetch all drafts
      const { data: draftsData } = await supabase
        .from('video_drafts')
        .select('*')
        .order('updated_at', { ascending: false })
      
      if (draftsData) {
        setDrafts(draftsData)
        
        // Fetch related projects
        const projectIds = [...new Set(draftsData.map(d => d.project_id).filter(Boolean))]
        if (projectIds.length > 0) {
          const { data: projectsData } = await supabase
            .from('projects')
            .select('*')
            .in('id', projectIds)
          
          if (projectsData) {
            const projectsMap: Record<string, Project> = {}
            projectsData.forEach(p => { projectsMap[p.id] = p })
            setProjects(projectsMap)
          }
        }
      }
      
      setIsLoading(false)
    }
    
    fetchDrafts()
  }, [])

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    
    try {
      const supabase = createClient()
      await supabase.from('video_drafts').delete().eq('id', id)
      
      setDrafts(prev => prev.filter(d => d.id !== id))
      
      toast({
        title: 'Rascunho excluído',
        description: 'O rascunho foi removido com sucesso.',
      })
    } catch (error) {
      toast({
        title: 'Erro',
        description: 'Não foi possível excluir o rascunho.',
        variant: 'destructive',
      })
    } finally {
      setDeletingId(null)
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  if (isLoading) {
    return (
      <DashboardPage className="items-center justify-center">
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </DashboardPage>
    )
  }

  return (
    <DashboardPage>
      <DashboardPageContent width="4xl" className="space-y-6">
          {/* Back Button */}
          <Button
            variant="ghost"
            onClick={() => router.push('/videos')}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar para Vídeos
          </Button>

          {drafts.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-16">
                <FileText className="mb-4 h-12 w-12 text-muted-foreground" />
                <h3 className="text-lg font-semibold">Nenhum rascunho salvo</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Seus rascunhos de vídeo aparecerão aqui.
                </p>
                <Button
                  className="mt-4"
                  onClick={() => router.push('/videos')}
                >
                  Criar Vídeo
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {drafts.map((draft) => (
                <Card
                  key={draft.id}
                  className="border-border/50 bg-card/30 backdrop-blur-sm transition-colors hover:bg-card/50"
                >
                  <CardContent className="flex items-center justify-between p-4">
                    <div
                      className="flex flex-1 cursor-pointer items-center gap-4"
                      onClick={() => router.push(`/videos?draft=${draft.id}`)}
                    >
                      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br from-pink-500/20 to-violet-500/20">
                        <Video className="h-6 w-6 text-pink-400" />
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-foreground">
                          {draft.name}
                        </h3>
                        <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
                          {draft.project_id && projects[draft.project_id] && (
                            <span>{projects[draft.project_id].name}</span>
                          )}
                          <span className="flex items-center gap-1">
                            <Layers className="h-3.5 w-3.5" />
                            {(draft.scenes || []).length} cenas
                          </span>
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3.5 w-3.5" />
                            {formatDate(draft.updated_at)}
                          </span>
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(draft.id)}
                      disabled={deletingId === draft.id}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      {deletingId === draft.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
      </DashboardPageContent>
    </DashboardPage>
  )
}
