'use client'

// GENERATED_IMAGE_LIBRARY_PROMOTION_V1
//
// "Salvar em Arquivos" for the generated image on /imagens. Promotion is explicit.
// Whether the image is already saved comes from the SERVER (an active LibraryFile
// referencing this image), never from local memory, so a reload shows the same thing.
// The request carries only the image id.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Check, FolderPlus, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'

type SavedState = { imageId: string; status: 'hidden' | 'unsaved' | 'saved' }

const ERROR_COPY: Record<string, string> = {
  OUTPUT_UNAVAILABLE: 'O arquivo da imagem não está mais disponível.',
  INVALID_STORAGE_PATH: 'Não foi possível validar o arquivo desta imagem.',
  MISSING_STORAGE_PATH: 'Esta imagem não tem arquivo salvo para copiar.',
  MISSING_PROJECT: 'Associe a imagem a um Projeto para salvá-la em Arquivos.',
  PROJECT_NOT_FOUND: 'O Projeto desta imagem não foi encontrado.',
  INVALID_IMAGE_OBJECT: 'O arquivo armazenado não é uma imagem válida.',
  SCHEMA_NOT_READY: 'Salvar em Arquivos ainda não está disponível.',
  CONCURRENT_PROMOTION: 'O salvamento foi concorrente. Tente novamente.',
}

export function SaveImageToLibrary({ imageId }: { imageId: string | null | undefined }) {
  const { toast } = useToast()
  // Keyed by image: a state read for another image is 'unknown' (nothing rendered) until its own answer arrives.
  const [known, setKnown] = useState<SavedState | null>(null)
  const [pending, setPending] = useState(false)
  // A ref guards the request itself: two clicks in the same tick can both see `pending === false`.
  const inFlight = useRef(false)

  useEffect(() => {
    if (!imageId) return
    let cancelled = false
    const settle = (status: SavedState['status']) => {
      if (!cancelled) setKnown({ imageId, status })
    }
    fetch(`/api/images/${imageId}/save-to-library`)
      .then(async (response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!payload || payload.available === false) settle('hidden')
        else if (payload.saved) settle('saved')
        else settle(payload.promotable ? 'unsaved' : 'hidden')
      })
      .catch(() => settle('hidden'))
    return () => {
      cancelled = true
    }
  }, [imageId])

  const state = known && known.imageId === imageId ? known.status : 'unknown'

  if (!imageId || state === 'unknown' || state === 'hidden') return null

  if (state === 'saved') {
    return (
      <Link
        href="/arquivos"
        className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
        data-testid="image-saved-to-library"
        title="Ver em Arquivos"
      >
        <Check className="h-4 w-4" aria-hidden="true" />
        Salvo em Arquivos
      </Link>
    )
  }

  const save = async () => {
    if (inFlight.current) return
    inFlight.current = true
    setPending(true)
    try {
      const response = await fetch(`/api/images/${imageId}/save-to-library`, { method: 'POST' })
      const payload = await response.json().catch(() => ({}))
      if (response.ok && payload?.libraryFile?.id) {
        setKnown({ imageId, status: 'saved' })
        toast({
          title: payload.result === 'already_saved' ? 'Já estava em Arquivos' : 'Salvo em Arquivos',
          description: 'A imagem agora está disponível em Arquivos.',
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
      variant="outline"
      onClick={save}
      disabled={pending}
      aria-busy={pending}
      className="flex-1 sm:flex-none"
      data-testid="save-image-to-library"
    >
      {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <FolderPlus className="mr-2 h-4 w-4" aria-hidden="true" />}
      {pending ? 'Salvando…' : 'Salvar em Arquivos'}
    </Button>
  )
}
