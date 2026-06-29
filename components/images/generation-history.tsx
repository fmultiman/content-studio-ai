'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Check, X, ChevronDown, ChevronUp, Sparkles } from 'lucide-react'
import { useState } from 'react'
import type { GenerationAttempt } from '@/lib/types'

interface GenerationHistoryProps {
  attempts: GenerationAttempt[]
  onSelectAttempt?: (attempt: GenerationAttempt) => void
  onUsePrompt?: (prompt: string) => void
}

export function GenerationHistory({ 
  attempts, 
  onSelectAttempt,
  onUsePrompt,
}: GenerationHistoryProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  if (attempts.length === 0) return null

  return (
    <Card className="border-border/50 bg-card/30 backdrop-blur-sm">
      <CardContent className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-cyan-400" />
          <h3 className="font-medium">Histórico de Tentativas</h3>
          <Badge variant="outline" className="ml-auto">
            {attempts.length} tentativa(s)
          </Badge>
        </div>
        
        <ScrollArea className="max-h-[400px]">
          <div className="space-y-3">
            {attempts.map((attempt, index) => (
              <div
                key={attempt.id}
                className={`rounded-lg border p-3 transition-all ${
                  expandedId === attempt.id
                    ? 'border-violet-500/50 bg-violet-500/5'
                    : 'border-border/50 hover:border-border'
                }`}
              >
                {/* Header */}
                <button
                  className="flex w-full items-center gap-3"
                  onClick={() => setExpandedId(expandedId === attempt.id ? null : attempt.id)}
                >
                  {/* Attempt Number */}
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-medium">
                    {attempt.attempt}
                  </div>
                  
                  {/* Thumbnail */}
                  {attempt.imageUrl && (
                    <div className="h-12 w-12 overflow-hidden rounded-md">
                      <img
                        src={attempt.imageUrl}
                        alt={`Tentativa ${attempt.attempt}`}
                        className="h-full w-full object-cover"
                      />
                    </div>
                  )}
                  
                  {/* Info */}
                  <div className="flex-1 text-left">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {attempt.model}
                      </span>
                      {attempt.evaluation && (
                        <Badge 
                          variant={attempt.evaluation.approved ? 'success' : 'warning'}
                        >
                          {attempt.evaluation.approved ? (
                            <Check className="mr-1 h-3 w-3" />
                          ) : (
                            <X className="mr-1 h-3 w-3" />
                          )}
                          {attempt.evaluation.score}/100
                        </Badge>
                      )}
                    </div>
                    <p className="line-clamp-1 text-xs text-muted-foreground">
                      {attempt.prompt.slice(0, 80)}...
                    </p>
                  </div>
                  
                  {/* Expand Icon */}
                  {expandedId === attempt.id ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>
                
                {/* Expanded Content */}
                {expandedId === attempt.id && (
                  <div className="mt-4 space-y-4 border-t border-border/50 pt-4">
                    {/* Image */}
                    {attempt.imageUrl && (
                      <div 
                        className="cursor-pointer overflow-hidden rounded-lg"
                        onClick={() => onSelectAttempt?.(attempt)}
                      >
                        <img
                          src={attempt.imageUrl}
                          alt={`Tentativa ${attempt.attempt}`}
                          className="w-full"
                        />
                      </div>
                    )}
                    
                    {/* Prompt */}
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">Prompt usado:</p>
                      <p className="text-sm">{attempt.prompt}</p>
                    </div>
                    
                    {/* Evaluation */}
                    {attempt.evaluation && (
                      <div className="space-y-3 rounded-lg bg-muted/30 p-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-muted-foreground">Avaliação IA</span>
                          <Badge variant="outline">
                            Score: {attempt.evaluation.score}
                          </Badge>
                        </div>
                        
                        <p className="text-sm">{attempt.evaluation.feedback}</p>
                        
                        {attempt.evaluation.improvements.length > 0 && (
                          <div className="space-y-1">
                            <p className="text-xs font-medium text-muted-foreground">Sugestões:</p>
                            <ul className="list-inside list-disc text-sm text-muted-foreground">
                              {attempt.evaluation.improvements.map((imp, i) => (
                                <li key={i}>{imp}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        
                        {attempt.evaluation.refinedPrompt && (
                          <div className="space-y-2">
                            <p className="text-xs font-medium text-muted-foreground">Prompt refinado:</p>
                            <p className="rounded-lg bg-background/50 p-2 text-sm">
                              {attempt.evaluation.refinedPrompt}
                            </p>
                            {onUsePrompt && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => onUsePrompt(attempt.evaluation!.refinedPrompt)}
                                className="w-full"
                              >
                                <Sparkles className="mr-2 h-3 w-3" />
                                Usar este prompt
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}
