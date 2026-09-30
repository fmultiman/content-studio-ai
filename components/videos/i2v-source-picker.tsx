'use client'

import { useEffect, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { eligibleLibraryImages, type I2vSource } from '@/lib/video-generation/i2v-source'

// VIDEO_I2V_LIBRARY_SOURCE_PICKER_V1
//
// "Imagem de Origem" chooser for Image-to-Video. Two scoped groups in one place:
//   Geradas  — images generated in this Project        (-> source_image_id)
//   Arquivos — durable images in the Project's Library (-> source_library_file_id)
// It only reports a stable id + class; the server re-resolves ownership, project
// and kind. No storage path, signed URL or database field name is ever shown.

interface GeneratedImageRow {
  id: string
  image_url: string
  user_input: string | null
}

interface LibraryImageRow {
  id: string
  name: string
  project_id: string | null
  kind: string
  deleted_at: string | null
  thumbnail_url: string | null
  public_url: string | null
}

type LoadState = 'loading' | 'ready' | 'failed'
type Group = I2vSource['type']

const GROUP_LABEL: Record<Group, string> = { generated: 'Geradas', library: 'Arquivos' }

interface I2vSourcePickerProps {
  projectId: string
  value: I2vSource | null
  onChange: (source: I2vSource | null) => void
}

function SourceThumb({ src, selected, label, group, id, onPick }: {
  src: string | null
  selected: boolean
  label: string
  group: Group
  id: string
  onPick: () => void
}) {
  const [broken, setBroken] = useState(false)
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={selected}
      title={label}
      data-testid={`i2v-source-option-${group}-${id}`}
      className={cn(
        'relative flex min-w-0 flex-col overflow-hidden rounded-md border text-left outline-none transition-colors',
        'focus-visible:ring-2 focus-visible:ring-[color:var(--control-focus)]',
        selected ? 'border-primary bg-primary/10 ring-1 ring-primary' : 'border-border/50 hover:border-primary/60 hover:bg-accent/30',
      )}
    >
      <div className="relative aspect-square w-full bg-muted">
        {src && !broken ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover" />
        ) : null}
        {selected && (
          <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Check className="h-3 w-3" />
          </span>
        )}
      </div>
      <span className="block truncate px-1.5 py-1 text-[11px] text-muted-foreground">{label}</span>
    </button>
  )
}

export function I2vSourcePicker({ projectId, value, onChange }: I2vSourcePickerProps) {
  const [generated, setGenerated] = useState<GeneratedImageRow[]>([])
  const [generatedState, setGeneratedState] = useState<LoadState>('loading')
  const [library, setLibrary] = useState<LibraryImageRow[]>([])
  const [libraryState, setLibraryState] = useState<LoadState>('loading')
  const [userGroup, setUserGroup] = useState<Group | null>(null)

  // Generated: same query the form always used (Project scoped, newest first).
  useEffect(() => {
    let cancelled = false
    createClient()
      .from('images')
      .select('id, image_url, user_input, created_at')
      .eq('project_id', projectId)
      .neq('image_url', null)
      .order('created_at', { ascending: false })
      .limit(30)
      .then(({ data }: { data: GeneratedImageRow[] | null }) => {
        if (cancelled) return
        setGenerated(data ?? [])
        setGeneratedState('ready')
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  // Arquivos: the Library API already scopes by user, Project, kind and trash, and
  // returns short-lived thumbnail URLs that are never persisted.
  const [libraryReload, setLibraryReload] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/library-files?${new URLSearchParams({ projectId, kind: 'image' })}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`status ${res.status}`)
        const payload = await res.json()
        if (controller.signal.aborted) return
        setLibrary(eligibleLibraryImages((payload?.files ?? []) as LibraryImageRow[], projectId))
        setLibraryState('ready')
      })
      .catch(() => {
        if (!controller.signal.aborted) setLibraryState('failed')
      })
    return () => controller.abort()
  }, [projectId, libraryReload])

  const bothLoaded = generatedState !== 'loading' && libraryState !== 'loading'
  const defaultGroup: Group = generated.length === 0 && library.length > 0 && bothLoaded ? 'library' : 'generated'
  const group: Group = userGroup ?? value?.type ?? defaultGroup

  const selectedLabel =
    value?.type === 'generated'
      ? generated.find((row) => row.id === value.id)?.user_input
      : value?.type === 'library'
        ? library.find((row) => row.id === value.id)?.name
        : null

  return (
    <div className="space-y-2" data-testid="i2v-source-picker">
      <Label id="i2v-source-label">Imagem de Origem</Label>
      <div role="tablist" aria-labelledby="i2v-source-label" className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1">
        {(['generated', 'library'] as const).map((entry) => (
          <button
            key={entry}
            type="button"
            role="tab"
            aria-selected={group === entry}
            data-testid={`i2v-source-tab-${entry}`}
            onClick={() => setUserGroup(entry)}
            className={cn(
              'rounded px-2 py-1 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[color:var(--control-focus)]',
              group === entry ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {GROUP_LABEL[entry]}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="max-h-56 overflow-y-auto rounded-md border border-border/50 p-2" data-testid={`i2v-source-panel-${group}`}>
        {group === 'generated' && (
          generatedState === 'loading' ? (
            <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          ) : generated.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground" data-testid="i2v-source-empty-generated">
              Nenhuma imagem gerada neste Projeto. Gere uma imagem em Imagens ou escolha uma da aba Arquivos.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {generated.map((row) => (
                <SourceThumb
                  key={row.id}
                  id={row.id}
                  group="generated"
                  src={row.image_url}
                  label={row.user_input || 'Imagem gerada'}
                  selected={value?.type === 'generated' && value.id === row.id}
                  onPick={() => onChange({ type: 'generated', id: row.id })}
                />
              ))}
            </div>
          )
        )}
        {group === 'library' && (
          libraryState === 'loading' ? (
            <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          ) : libraryState === 'failed' ? (
            <div className="space-y-2 py-4 text-center" role="alert" data-testid="i2v-source-library-failed">
              <p className="text-xs text-muted-foreground">Não foi possível carregar os Arquivos agora.</p>
              <Button type="button" size="sm" variant="outline" onClick={() => { setLibraryState('loading'); setLibraryReload((n) => n + 1) }}>Tentar novamente</Button>
            </div>
          ) : library.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground" data-testid="i2v-source-empty-library">
              Nenhuma imagem em Arquivos neste Projeto. Envie ou salve uma imagem em Arquivos, ou escolha uma da aba Geradas.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {library.map((file) => (
                <SourceThumb
                  key={file.id}
                  id={file.id}
                  group="library"
                  src={file.thumbnail_url || file.public_url}
                  label={file.name}
                  selected={value?.type === 'library' && value.id === file.id}
                  onPick={() => onChange({ type: 'library', id: file.id })}
                />
              ))}
            </div>
          )
        )}
      </div>

      {bothLoaded && generated.length === 0 && library.length === 0 && libraryState === 'ready' ? (
        <p className="text-xs text-muted-foreground" data-testid="i2v-source-empty-all">
          Este Projeto ainda não tem imagens. Gere uma imagem ou envie/salve uma em Arquivos para animar.
        </p>
      ) : (
        <p className="truncate text-xs text-muted-foreground" data-testid="i2v-source-summary">
          {value ? `Selecionada: ${selectedLabel || 'imagem'} (${GROUP_LABEL[value.type]})` : 'Escolha uma imagem gerada ou um arquivo deste Projeto.'}
        </p>
      )}
    </div>
  )
}
