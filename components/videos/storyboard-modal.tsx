'use client'

import { ArrowRight, ImageIcon } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { VideoScene } from '@/lib/types'

interface StoryboardModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  scenes: VideoScene[]
  videoName: string
  onSelectScene: (index: number) => void
}

export function StoryboardModal({
  open,
  onOpenChange,
  scenes,
  videoName,
  onSelectScene,
}: StoryboardModalProps) {
  const totalDuration = scenes.reduce((acc, scene) => acc + scene.duration, 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[90vh] max-h-[90vh] w-[90vw] max-w-[90vw] border-border/60 bg-black p-0 text-white sm:max-w-[90vw]">
        <DialogHeader className="border-b border-white/10 px-6 py-5">
          <DialogTitle className="text-xl">
            Storyboard{videoName ? ` - ${videoName}` : ''}
          </DialogTitle>
          <DialogDescription className="text-white/60">
            {scenes.length} {scenes.length === 1 ? 'cena' : 'cenas'} · {totalDuration}s total
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="h-full">
          <div className="flex min-h-[calc(90vh-96px)] items-center p-8">
            {scenes.length === 0 ? (
              <div className="flex w-full flex-col items-center justify-center text-center">
                <ImageIcon className="mb-4 h-12 w-12 text-white/30" />
                <h3 className="text-lg font-semibold">Nenhuma cena ainda</h3>
                <p className="mt-1 text-sm text-white/50">
                  Adicione cenas para visualizar o storyboard.
                </p>
              </div>
            ) : (
              <div className="flex items-start gap-4">
                {scenes.map((scene, index) => (
                  <div key={scene.id} className="flex items-start gap-4">
                    <button
                      type="button"
                      onClick={() => onSelectScene(index)}
                      className="group w-56 shrink-0 text-left"
                    >
                      <div className="relative aspect-video overflow-hidden rounded-lg border border-white/15 bg-zinc-900 transition group-hover:border-cyan-400">
                        {scene.image_url ? (
                          <img
                            src={scene.image_url}
                            alt={`Cena ${index + 1}`}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-zinc-900">
                            <ImageIcon className="h-10 w-10 text-white/25" />
                          </div>
                        )}

                        <div className="absolute left-2 top-2 rounded bg-black/75 px-2 py-1 text-xs font-medium text-white">
                          Cena {index + 1}
                        </div>
                        <div className="absolute right-2 top-2 rounded bg-black/75 px-2 py-1 text-xs font-medium text-white">
                          {scene.duration}s
                        </div>
                        {scene.movement && (
                          <div className="absolute bottom-2 left-2 rounded bg-black/70 px-2 py-1 text-[11px] text-white/85">
                            {scene.movement}
                          </div>
                        )}
                      </div>

                      <p className="mt-2 line-clamp-2 min-h-10 text-xs leading-5 text-white/70">
                        {scene.description || 'Sem descricao preenchida.'}
                      </p>
                    </button>

                    {index < scenes.length - 1 && (
                      <div className="mt-16 flex h-8 w-8 shrink-0 items-center justify-center text-white/35">
                        <ArrowRight className="h-6 w-6" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
