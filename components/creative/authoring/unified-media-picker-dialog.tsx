'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { I2vSourceBrowser } from '@/components/videos/i2v-source-browser'
import { type I2vSourceSelection } from '@/lib/video-generation/i2v-source'
import { useToast } from '@/hooks/use-toast'
import { Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
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

  const handleSelect = async (selection: I2vSourceSelection) => {
    // 1. If it's a LibraryFile (Arquivos, Galeria, or Enviar), load its actual data
    if (selection.source.type === 'library') {
      setPromoting(true)
      try {
        const supabase = createClient()
        const { data, error } = await supabase
          .from('library_files')
          .select('id, name, public_url, thumbnail_url, mime_type, origin')
          .eq('id', selection.source.id)
          .eq('project_id', projectId)
          .eq('kind', 'image')
          .is('deleted_at', null)
          .single()
        
        if (error || !data) {
          throw new Error('Falha ao obter detalhes do arquivo da biblioteca.')
        }

        onSelect(data)
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

    // 2. If it's a raw generated AI image, promote it via the factual integration API
    if (selection.source.type === 'generated') {
      setPromoting(true)
      try {
        const res = await fetch(`/api/images/${selection.source.id}/save-to-library`, { method: 'POST' })
        const payload = await res.json()
        if (!res.ok) {
          throw new Error(payload.error || 'Ndo foi possivel registrar a imagem na Biblioteca.')
        }

        const libraryFile = payload.libraryFile || payload.data;
        if (!libraryFile || !libraryFile.id) {
          throw new Error('Retorno invalido do servidor: ID do LibraryFile nao encontrado.')
        }

        onSelect(libraryFile)
        toast({
          title: 'Imagem vinculada',
          description: 'A imagem gerada foi adicionada aos arquivos do Projeto para uso.',
        })
        onOpenChange(false)
      } catch (err) {
        toast({
          title: 'Erro de vinculacao',
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
