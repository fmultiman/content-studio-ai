'use client'

// VIDEO_GENERATION_LIBRARY_PROMOTION_V1
//
// "Salvar em Arquivos" for ONE generation card. Promotion is explicit and only
// available for a succeeded generation. Saved state comes from the server
// (`library_file_id` on the generation), never from local memory alone, so a
// reload shows the same thing. The request carries only the generation id.

import { useRef, useState } from 'react'
import Link from 'next/link'
import { Check, FolderPlus, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'

export type SaveableGeneration = {
  id: string
  status: string
  library_file_id?: string | null
}

const ERROR_COPY: Record<string, string> = {
  GENERATION_NOT_COMPLETED: 'O vídeo ainda não está pronto para ser salvo.',
  OUTPUT_UNAVAILABLE: 'O arquivo do vídeo não está mais disponível.',
  INVALID_STORAGE_PATH: 'Não foi possível validar o arquivo deste vídeo.',
  MISSING_STORAGE_PATH: 'Não foi possível validar o arquivo deste vídeo.',
  CONCURRENT_PROMOTION: 'O salvamento foi concorrente. Tente novamente.',
}

export function SaveGenerationToLibrary({
  generation,
  size,
  onSaved,
}: {
  generation: SaveableGeneration
  size: 'sm' | 'default'
  onSaved: (generationId: string, libraryFileId: string) => void
}) {
  const { toast } = useToast()
  const [pending, setPending] = useState(false)
  // A ref guards the request itself: two clicks in the same tick can both see `pending === false`.
  const inFlight = useRef(false)

  if (generation.status !== 'succeeded') return null

  if (generation.library_file_id) {
    return (
      <Link
        href="/arquivos"
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
        data-testid="generation-saved-to-library"
        title="Ver em Arquivos"
      >
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
        Salvo em Arquivos
      </Link>
    )
  }

  const save = async () => {
    if (inFlight.current) return
    inFlight.current = true
    setPending(true)
    try {
      const response = await fetch(`/api/video-generations/${generation.id}/save-to-library`, { method: 'POST' })
      const payload = await response.json().catch(() => ({}))
      const libraryFileId: string | undefined = payload?.libraryFile?.id
      if (response.ok && libraryFileId) {
        onSaved(generation.id, libraryFileId)
        toast({
          title: payload.result === 'already_saved' ? 'Já estava em Arquivos' : 'Salvo em Arquivos',
          description: 'O vídeo agora está disponível em Arquivos.',
        })
        return
      }
      toast({
        title: 'Não foi possível salvar em Arquivos',
        description: ERROR_COPY[payload?.code] ?? 'Tente novamente em instantes.',
        variant: 'destructive',
      })
    } catch {
      toast({ title: 'Não foi possível salvar em Arquivos', description: 'Falha de conexão. Tente novamente.', variant: 'destructive' })
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  return (
    <Button
      type="button"
      size={size}
      variant="outline"
      className="gap-1"
      onClick={save}
      disabled={pending}
      aria-busy={pending}
      data-testid="save-generation-to-library"
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <FolderPlus className="h-4 w-4" aria-hidden="true" />}
      {pending ? 'Salvando…' : 'Salvar em Arquivos'}
    </Button>
  )
}
