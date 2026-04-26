'use client'

import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { RefreshCw, Check, Download, Loader2, Brain, Sparkles } from 'lucide-react'
import type { ImageEvaluation } from '@/lib/types'

interface ImageResultProps {
  imageUrl: string
  status: 'draft' | 'generating' | 'approved' | 'rejected'
  onRegenerate: () => void
  onApprove: () => void
  isRegenerating: boolean
  isApproving: boolean
  imageName?: string
  // Evaluator props
  evaluatorEnabled?: boolean
  evaluation?: ImageEvaluation | null
  onEvaluate?: () => void
  isEvaluating?: boolean
  onUseRefinedPrompt?: (prompt: string) => void
}

export function ImageResult({
  imageUrl,
  status,
  onRegenerate,
  onApprove,
  isRegenerating,
  isApproving,
  imageName,
  evaluatorEnabled = false,
  evaluation = null,
  onEvaluate,
  isEvaluating = false,
  onUseRefinedPrompt,
}: ImageResultProps) {
  const handleDownload = async () => {
    try {
      const response = await fetch(imageUrl)
      const blob = await response.blob()
      
      // Determine file extension from MIME type (preserve original format)
      const mimeType = blob.type
      let extension = 'png' // Default to PNG
      if (mimeType === 'image/jpeg') extension = 'jpg'
      else if (mimeType === 'image/webp') extension = 'webp'
      else if (mimeType === 'image/png') extension = 'png'
      
      // Create filename
      const timestamp = new Date().toISOString().slice(0, 10)
      const baseName = imageName 
        ? imageName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()
        : 'content-agent'
      const filename = `${baseName}-${timestamp}-${Date.now()}.${extension}`
      
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (error) {
      console.error('Erro ao baixar imagem:', error)
    }
  }

  return (
    <div className="rounded-xl border border-border/50 bg-card/30 p-6 backdrop-blur-sm">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-foreground">Resultado</h2>
          <Badge
            variant={status === 'approved' ? 'default' : 'secondary'}
            className={
              status === 'approved'
                ? 'bg-emerald-500/20 text-emerald-300'
                : status === 'generating'
                ? 'bg-amber-500/20 text-amber-300'
                : 'bg-muted'
            }
          >
            {status === 'approved'
              ? 'Aprovada'
              : status === 'generating'
              ? 'Gerando...'
              : 'Rascunho'}
          </Badge>
        </div>
      </div>

      <div className="space-y-6">
        {/* Image Preview */}
        <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-muted">
          {status === 'generating' ? (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <Loader2 className="mx-auto h-12 w-12 animate-spin text-violet-500" />
                <p className="mt-4 text-sm text-muted-foreground">
                  Gerando sua imagem...
                </p>
              </div>
            </div>
          ) : (
            <Image
              src={imageUrl}
              alt="Imagem gerada"
              fill
              className="object-cover"
              crossOrigin="anonymous"
            />
          )}
        </div>

        {/* Evaluation Result */}
        {evaluation && (
          <div className="space-y-3 rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Brain className="h-4 w-4 text-cyan-400" />
                <span className="font-medium">Avaliação IA</span>
              </div>
              <Badge 
                variant={evaluation.approved ? 'default' : 'secondary'}
                className={evaluation.approved 
                  ? 'bg-emerald-500/20 text-emerald-400' 
                  : 'bg-amber-500/20 text-amber-400'
                }
              >
                Score: {evaluation.score}/100
              </Badge>
            </div>
            
            <p className="text-sm text-muted-foreground">{evaluation.feedback}</p>
            
            {evaluation.improvements.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium">Sugestões de melhoria:</p>
                <ul className="list-inside list-disc text-sm text-muted-foreground">
                  {evaluation.improvements.map((imp, i) => (
                    <li key={i}>{imp}</li>
                  ))}
                </ul>
              </div>
            )}
            
            {evaluation.refinedPrompt && onUseRefinedPrompt && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onUseRefinedPrompt(evaluation.refinedPrompt)}
                className="w-full border-cyan-500/30 hover:bg-cyan-500/10"
              >
                <Sparkles className="mr-2 h-4 w-4" />
                Usar prompt refinado
              </Button>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-3">
          {/* Evaluate Button */}
          {evaluatorEnabled && onEvaluate && !evaluation && status !== 'generating' && (
            <Button
              variant="outline"
              onClick={onEvaluate}
              disabled={isEvaluating}
              className="flex-1 border-cyan-500/30 hover:bg-cyan-500/10 sm:flex-none"
            >
              {isEvaluating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Avaliando...
                </>
              ) : (
                <>
                  <Brain className="mr-2 h-4 w-4" />
                  Revisar com IA
                </>
              )}
            </Button>
          )}

          <Button
            variant="outline"
            onClick={onRegenerate}
            disabled={isRegenerating || status === 'generating'}
            className="flex-1 sm:flex-none"
          >
            {isRegenerating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Regenerando...
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-4 w-4" />
                Gerar Novamente
              </>
            )}
          </Button>

          <Button
            variant="outline"
            onClick={handleDownload}
            disabled={status === 'generating'}
            className="flex-1 sm:flex-none"
          >
            <Download className="mr-2 h-4 w-4" />
            Download
          </Button>

          {status !== 'approved' && (
            <Button
              onClick={onApprove}
              disabled={isApproving || status === 'generating'}
              className="flex-1 bg-emerald-600 text-white hover:bg-emerald-700 sm:flex-none"
            >
              {isApproving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Aprovando...
                </>
              ) : (
                <>
                  <Check className="mr-2 h-4 w-4" />
                  Aprovar
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
