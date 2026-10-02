'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { I2vSourceBrowser } from '@/components/videos/i2v-source-browser'
import { type I2vSourceSelection } from '@/lib/video-generation/i2v-source'
import { useToast } from '@/hooks/use-toast'
import { Loader2 } from 'lucide-react'
import type { SlotLibraryFile } from '@/lib/creative/authoring/asset-slots'

/**
 * UnifiedMediaPickerDialog (STATIC_TEMPLATE_CUSTOM_ELEMENTS_V1 / CREATIVE_EDITOR_UNIFIED_MEDIA_PICKER_V1)
 *
 * Wraps the shared media-source browser (already built for AI Video) into a Dialog
 * compatible with the Static Editor's `ProjectLibraryAssetPicker` usage pattern.
 *
 * If the user picks a generated AI image (which only has an `image.id`), this picker
 * dynamically promotes it to a durable `library_file` (via /save-to-library) so that
 * the Static editor's existing authoring/renderer contracts are fulfilled without
 * introducing a secondary image type or changing worker resolution.
 */
export function UnifiedMediaPickerDialog({
  open,
  onOpenChange,
  projectId,
  productionId = null,
  selectedId,
  onSelect,
  title = 'Escolher imagem',
  description = 'Escolha uma imagem gerada, da Galeria, Arquivos ou envie um arquivo.',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  productionId?: string | null
  selectedId?: string | null
  onSelect: (file: SlotLibraryFile) => void
  title?: string
  description?: string
}) {
  const [promoting, setPromoting] = useState(false)
  const { toast } = useToast()

  const handleOpenChange = (v: boolean) => {
    if (!v && promoting) return
    onOpenChange(v)
  }

  /**
   * The ONE way a chosen LibraryFile enters the editor: a server read that returns it exactly as the Library lists
   * return it (signed display URL). The raw table row is never handed to the editor — its stored `public_url` is
   * not a usable browser source, so the Canvas would paint a broken image (alt text = file name).
   */
  const loadDisplayFile = async (fileId: string): Promise<SlotLibraryFile> => {
    const response = await fetch(`/api/library-files/${encodeURIComponent(fileId)}/display?${new URLSearchParams({ projectId })}`)
    const payload = await response.json().catch(() => null) as { file?: SlotLibraryFile } | null
    if (!response.ok || !payload?.file?.id) throw new Error('Falha ao obter detalhes do arquivo da biblioteca.')
    return payload.file
  }

  const handleSelect = async (selection: I2vSourceSelection) => {
    // 1. A LibraryFile (Arquivos, Galeria or Enviar): load its signed display row.
    if (selection.source.type === 'library') {
      setPromoting(true)
      try {
        onSelect(await loadDisplayFile(selection.source.id))
        onOpenChange(false)
      } catch (err) {
        toast({
          title: 'Erro de leitura',
          description: err instanceof Error ? err.message : 'Tente novamente.',
          variant: 'destructive',
        })
      } finally {
        setPromoting(false)
      }
      return
    }

    // 2. A raw generated AI image: promote it via the factual integration API, then load it like any LibraryFile.
    if (selection.source.type === 'generated') {
      setPromoting(true)
      try {
        const res = await fetch(`/api/images/${selection.source.id}/save-to-library`, { method: 'POST' })
        const payload = await res.json()
        if (!res.ok) {
          throw new Error(payload.error || 'Não foi possível registrar a imagem na Biblioteca.')
        }

        const promoted = payload.libraryFile || payload.data
        if (!promoted || !promoted.id) {
          throw new Error('Retorno inválido do servidor: ID do LibraryFile não encontrado.')
        }

        onSelect(await loadDisplayFile(promoted.id as string))
        toast({
          title: 'Imagem vinculada',
          description: 'A imagem gerada foi adicionada aos arquivos do Projeto para uso.',
        })
        onOpenChange(false)
      } catch (err) {
        toast({
          title: 'Erro de vinculação',
          description: err instanceof Error ? err.message : 'Tente novamente.',
          variant: 'destructive',
        })
      } finally {
        setPromoting(false)
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-[95vw] max-w-5xl flex-col gap-0 p-0 sm:max-h-[80vh]">
        <DialogHeader className="px-6 pb-2 pt-6">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden px-6 pb-6">
          {promoting ? (
            <div className="flex flex-1 flex-col items-center justify-center p-12 text-muted-foreground gap-4">
              <Loader2 className="h-8 w-8 animate-spin" />
              <p className="text-sm">Vinculando imagem aos arquivos selecionáveis do projeto...</p>
            </div>
          ) : (
            <I2vSourceBrowser
              projectId={projectId}
              productionId={productionId}
              // Static composition: Arquivos is Project-scoped durable media, a Production is an optional filter.
              defaultProductionMode="all"
              selectedId={selectedId ?? null}
              onSelect={handleSelect}
              onClose={() => onOpenChange(false)}
              locked={promoting}
              onUploadBusyChange={setPromoting}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
