'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/layout/header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Download, ImageIcon, Loader2, Plus, CheckCircle2, Clock3, FolderKanban } from 'lucide-react'
import type { Image as ImageType, Project } from '@/lib/types'

type GalleryFilter = 'all' | 'approved' | 'draft'

export default function GalleryPage() {
  const router = useRouter()
  const [images, setImages] = useState<ImageType[]>([])
  const [projects, setProjects] = useState<Record<string, Project>>({})
  const [filter, setFilter] = useState<GalleryFilter>('all')
  const [selectedProject, setSelectedProject] = useState('all')
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchGallery = async () => {
      const supabase = createClient()

      const { data: imagesData } = await supabase
        .from('images')
        .select('*')
        .order('updated_at', { ascending: false })

      if (imagesData) {
        setImages(imagesData)

        const projectIds = [
          ...new Set(imagesData.map((image) => image.project_id).filter(Boolean)),
        ] as string[]

        if (projectIds.length > 0) {
          const { data: projectsData } = await supabase
            .from('projects')
            .select('*')
            .in('id', projectIds)

          if (projectsData) {
            const projectsMap: Record<string, Project> = {}
            projectsData.forEach((project) => {
              projectsMap[project.id] = project
            })
            setProjects(projectsMap)
          }
        }
      }

      setIsLoading(false)
    }

    fetchGallery()
  }, [])

  const filteredImages = useMemo(() => {
    let result = images

    if (selectedProject !== 'all') {
      result = result.filter((image) => image.project_id === selectedProject)
    }

    if (filter === 'approved') {
      return result.filter((image) => image.status === 'approved')
    }

    if (filter === 'draft') {
      return result.filter((image) => image.status !== 'approved')
    }

    return result
  }, [filter, images, selectedProject])

  const approvedCount = images.filter((image) => image.status === 'approved').length
  const draftCount = images.length - approvedCount
  const projectList = Object.values(projects).sort((a, b) =>
    a.name.localeCompare(b.name, 'pt-BR')
  )

  const handleDownload = async (image: ImageType) => {
    if (!image.image_url) return

    const response = await fetch(image.image_url)
    const blob = await response.blob()
    const extension = blob.type === 'image/jpeg'
      ? 'jpg'
      : blob.type === 'image/webp'
        ? 'webp'
        : 'png'
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `content-agent-${image.id}.${extension}`
    document.body.appendChild(a)
    a.click()
    window.URL.revokeObjectURL(url)
    document.body.removeChild(a)
  }

  const statusLabel = (status: ImageType['status']) => {
    if (status === 'approved') return 'Aprovada'
    if (status === 'generating') return 'Gerando'
    if (status === 'rejected') return 'Rejeitada'
    return 'Rascunho'
  }

  return (
    <>
      <Header title="Galeria" />
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-7xl space-y-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-muted-foreground">
                Todos os resultados gerados, aprovados e ainda em rascunho.
              </p>
            </div>
            <Button
              onClick={() => router.push('/imagens')}
              className="gap-2 bg-gradient-to-r from-violet-600 to-cyan-500 text-white"
            >
              <Plus className="h-4 w-4" />
              Nova Imagem
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <ToggleGroup
              type="single"
              value={filter}
              onValueChange={(value: GalleryFilter) => value && setFilter(value)}
              className="rounded-lg border border-border/50"
            >
              <ToggleGroupItem value="all" className="gap-2 text-xs">
                <ImageIcon className="h-3.5 w-3.5" />
                Todas ({images.length})
              </ToggleGroupItem>
              <ToggleGroupItem value="approved" className="gap-2 text-xs">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Aprovadas ({approvedCount})
              </ToggleGroupItem>
              <ToggleGroupItem value="draft" className="gap-2 text-xs">
                <Clock3 className="h-3.5 w-3.5" />
                Rascunhos ({draftCount})
              </ToggleGroupItem>
            </ToggleGroup>

            <div className="flex min-w-[240px] items-center gap-2">
              <FolderKanban className="h-4 w-4 text-muted-foreground" />
              <Select value={selectedProject} onValueChange={setSelectedProject}>
                <SelectTrigger className="bg-background/50">
                  <SelectValue placeholder="Filtrar por projeto" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os projetos</SelectItem>
                  {projectList.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredImages.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <ImageIcon className="mb-4 h-12 w-12 text-muted-foreground" />
                <h3 className="text-lg font-semibold">Nenhuma imagem encontrada</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Gere uma imagem para que ela apareca aqui.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredImages.map((image) => (
                <Card
                  key={image.id}
                  className="overflow-hidden border-border/50 bg-card/30 backdrop-blur-sm"
                >
                  <div className="relative aspect-square bg-muted">
                    {image.image_url ? (
                      <img
                        src={image.image_url}
                        alt={image.user_input}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <ImageIcon className="h-10 w-10 text-muted-foreground" />
                      </div>
                    )}
                    <Badge
                      className="absolute left-2 top-2 bg-background/80 text-foreground backdrop-blur"
                      variant="secondary"
                    >
                      {statusLabel(image.status)}
                    </Badge>
                  </div>
                  <CardContent className="space-y-3 p-4">
                    <div>
                      <p className="line-clamp-2 text-sm text-foreground">
                        {image.user_input}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {image.model && (
                          <Badge variant="outline">{image.model}</Badge>
                        )}
                        {image.project_id && projects[image.project_id] && (
                          <Badge variant="outline">{projects[image.project_id].name}</Badge>
                        )}
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 gap-2"
                        disabled={!image.image_url}
                        onClick={() => handleDownload(image)}
                      >
                        <Download className="h-4 w-4" />
                        Download
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
