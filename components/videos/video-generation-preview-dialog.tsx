'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, Download, ExternalLink, Loader2, RefreshCw, Video as VideoIcon } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/ui/status-badge'
import { useToast } from '@/hooks/use-toast'

export function VideoGenerationPreviewDialog({
  item,
  onOpenChange,
  onNavigate,
}: {
  item: any | null // represents the generationCard item from the videos page
  onOpenChange: (open: boolean) => void
  onNavigate: (href: string) => void
}) {
  const { toast } = useToast()
  
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null)
  const [videoPreviewError, setVideoPreviewError] = useState<string | null>(null)
  const [isLoadingVideoPreview, setIsLoadingVideoPreview] = useState(false)

  const loadVideoPreview = (id: string) => {
    let cancelled = false
    setVideoPreviewError(null)
    setIsLoadingVideoPreview(true)

    // Using the endpoint we created to fetch a fresh playback URL
    fetch(`/api/video-generations/${id}/playback-url?disposition=inline`)
      .then(async (response) => {
        if (!response.ok) throw new Error('Falha ao carregar URL de playback')
        const data = await response.json()
        if (cancelled) return
        if (!data.url) throw new Error('URL de playback ausente na resposta')
        setVideoPreviewUrl(data.url)
      })
      .catch((err) => {
        if (!cancelled) setVideoPreviewError('Não foi possível carregar a prévia do vídeo.')
      })
      .finally(() => {
        if (!cancelled) setIsLoadingVideoPreview(false)
      })

    return () => {
      cancelled = true
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVideoPreviewUrl(null)
    setVideoPreviewError(null)
    setIsLoadingVideoPreview(false)

    if (!item || item.kind !== 'generation' || !item.id || item.status !== 'succeeded') {
      return
    }

    return loadVideoPreview(item.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, item?.kind, item?.status])

  const retryVideoPreview = () => {
    if (item?.id) loadVideoPreview(item.id)
  }

  const handleDownload = async () => {
    if (!item?.id) return
    try {
      const response = await fetch(`/api/video-generations/${item.id}/playback-url?disposition=attachment`)
      if (!response.ok) throw new Error('download url fetch failed')
      const data = await response.json()
      if (!data.url) throw new Error('download url missing')

      const link = document.createElement('a')
      link.href = data.url
      link.download = ''
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    } catch {
      toast({ title: 'Erro', description: 'Não foi possível baixar o vídeo.', variant: 'destructive' })
    }
  }

  const handleOpenExternal = async () => {
    if (!item?.id) return
    try {
      const response = await fetch(`/api/video-generations/${item.id}/playback-url?disposition=inline`)
      if (!response.ok) throw new Error('external url fetch failed')
      const data = await response.json()
      if (!data.url) throw new Error('external url missing')
      window.open(data.url, '_blank')
    } catch {
      toast({ title: 'Erro', description: 'Não foi possível abrir o arquivo.', variant: 'destructive' })
    }
  }

  // To display correctly proportioned video based on actual dimensions or aspect ratio request
  // But wait, the video element naturally handles its own aspect ratio if object-contain is used.
  // The gallery uses a dark container: `w-full h-full object-contain bg-black`

  return (
    <Dialog open={Boolean(item)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        {item && (
          <>
            <DialogHeader>
              <DialogTitle className="line-clamp-2">{item.title}</DialogTitle>
              <DialogDescription>
                Vídeo gerado em {new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(item.updatedAt))}.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(260px,0.8fr)]">
              <div className="overflow-hidden rounded-md border bg-muted flex items-center justify-center min-h-[300px]">
                {isLoadingVideoPreview ? (
                  <div className="flex flex-col items-center gap-3 p-6 text-center text-sm text-muted-foreground">
                    <Loader2 className="h-8 w-8 animate-spin" />
                    Carregando vídeo...
                  </div>
                ) : videoPreviewUrl ? (
                  <video
                    key={item.id}
                    src={videoPreviewUrl}
                    controls
                    autoPlay
                    playsInline
                    className="w-full h-full object-contain bg-black"
                    crossOrigin="anonymous"
                  />
                ) : videoPreviewError ? (
                  <div className="flex flex-col items-center gap-3 p-6 text-center text-sm text-muted-foreground">
                    <AlertCircle className="h-8 w-8 text-red-400" />
                    <p>{videoPreviewError}</p>
                    <Button variant="outline" size="sm" className="gap-2" onClick={retryVideoPreview}>
                      <RefreshCw className="h-3 w-3" />
                      Tentar novamente
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 p-6 text-center text-sm text-muted-foreground">
                    <VideoIcon className="h-10 w-10" />
                    Vídeo indisponível
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <StatusBadge
                    label="Gerada"
                    tone="positive"
                  />
                  {item.projectName && <Badge variant="outline">{item.projectName}</Badge>}
                  {item.productionName && <Badge variant="outline">{item.productionName}</Badge>}
                  <Badge variant="outline">{item.meta}</Badge>
                </div>

                <div className="space-y-2 text-sm">
                  {item.projectName !== undefined && (
                    <p>
                      <span className="font-medium">Project:</span>{' '}
                      {item.projectName || 'Project não identificado'}
                    </p>
                  )}
                  {item.productionName !== undefined && (
                    <p>
                      <span className="font-medium">Production:</span>{' '}
                      {item.productionName || 'Sem Production associada'}
                    </p>
                  )}
                  <p>
                    <span className="font-medium">Atualizada em:</span>{' '}
                    {new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(item.updatedAt))}
                  </p>
                  <p>
                    <span className="font-medium">Dimensões / Tipo:</span>{' '}
                    {item.generation.request_config?.resolution || '720p'} · {item.generation.request_config?.aspect_ratio || (item.generation.mode === 'image_to_video' ? 'I2V (da imagem)' : '16:9')} · {item.generation.request_config?.duration || 5}s
                  </p>
                </div>

                {item.generation.prompt && (
                  <div className="rounded-md border bg-background/60 p-3">
                    <p className="text-xs font-medium uppercase text-muted-foreground">
                      Prompt associado
                    </p>
                    <p className="mt-2 max-h-32 overflow-auto text-sm text-muted-foreground">
                      {item.generation.prompt}
                    </p>
                  </div>
                )}
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="gap-2"
                onClick={handleOpenExternal}
              >
                <ExternalLink className="h-4 w-4" />
                Abrir em nova aba
              </Button>
              {item.productionHref && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onNavigate(item.productionHref!)}
                >
                  Ver Production
                </Button>
              )}
              {/* <Button
                type="button"
                className="gap-2"
                onClick={handleDownload}
              >
                <Download className="h-4 w-4" />
                Baixar
              </Button> */}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
