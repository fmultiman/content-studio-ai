'use client'

import { ChevronRight, ImageIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export type ImageSessionCardSession = {
  id: string
  name?: string | null
  workingPrompt?: string | null
  updatedAt: string
  thumbnailUrl?: string | null
}

// IMAGE_GENERATION_WORKSPACE_REGRESSION_RECOVERY_V1: "Gerações recentes" card. Shows the server-resolved
// thumbnail of the Session's current image, or an intentional placeholder when there is none.
export function ImageSessionCard({ session, projectName, productionTitle, onContinue }: {
  session: ImageSessionCardSession
  projectName?: string | null
  productionTitle?: string | null
  onContinue: (sessionId: string) => void
}) {
  return (
    <Card className="border-border/50 bg-card/30" data-testid="image-session-card">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex min-w-0 items-center gap-3">
          {session.thumbnailUrl ? (
            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg" data-testid="image-session-thumbnail">
              <img src={session.thumbnailUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
            </div>
          ) : (
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500/20 to-cyan-500/20" data-testid="image-session-placeholder">
              <ImageIcon className="h-8 w-8 text-violet-400" aria-hidden="true" />
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{session.workingPrompt || session.name || 'Geração sem descrição'}</p>
            <p className="text-xs text-muted-foreground">{projectName || 'Sem Project'} · {productionTitle || 'Sem Production'} · {new Date(session.updatedAt).toLocaleDateString('pt-BR')}</p>
          </div>
        </div>
        <Button size="sm" onClick={() => onContinue(session.id)} className="gap-1">Continuar <ChevronRight className="h-4 w-4" /></Button>
      </CardContent>
    </Card>
  )
}
