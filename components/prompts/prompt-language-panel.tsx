'use client'

import type { ReactNode } from 'react'
import { Loader2, Languages } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PROMPT_TRANSLATION_COST_NOTICE, PROMPT_TRANSLATION_UNAVAILABLE } from '@/lib/prompts/translation'

export type PromptLanguageView = 'prompt' | 'pt'

// GENERATION_PROMPT_MODES_LANGUAGE_UX_CONVERGENCE_V1 — shared by Imagens and Vídeos.
// "Prompt de geração" is the single canonical text (whatever language the user wrote or the assistance produced);
// "Português (leitura)" is an optional, read-only translation requested only by an explicit click.
export function PromptLanguagePanel({
  view,
  onViewChange,
  translation,
  translating,
  error,
  canTranslate,
  unavailableReason = PROMPT_TRANSLATION_UNAVAILABLE,
  hasPrompt,
  onTranslate,
  disabled = false,
  idPrefix,
  children,
}: {
  view: PromptLanguageView
  onViewChange: (view: PromptLanguageView) => void
  /** Already valid for the current prompt, or empty. */
  translation: string
  translating: boolean
  error: string | null
  canTranslate: boolean
  unavailableReason?: string
  hasPrompt: boolean
  onTranslate: () => void
  disabled?: boolean
  idPrefix: string
  /** The editable generation-prompt field. */
  children: ReactNode
}) {
  return (
    <Tabs value={view} onValueChange={(value) => onViewChange(value === 'pt' ? 'pt' : 'prompt')} data-testid={`${idPrefix}-language-panel`}>
      <TabsList className="grid w-full max-w-[360px] grid-cols-2" aria-label="Idioma de visualização do prompt">
        <TabsTrigger value="prompt" data-testid={`${idPrefix}-tab-prompt`}>Prompt (enviado)</TabsTrigger>
        <TabsTrigger value="pt" data-testid={`${idPrefix}-tab-pt`}>Português (leitura)</TabsTrigger>
      </TabsList>

      <TabsContent value="prompt" className="mt-0 space-y-2">{children}</TabsContent>

      <TabsContent value="pt" className="mt-0 space-y-2" data-testid={`${idPrefix}-translation-view`}>
        {translation ? (
          <>
            <Textarea value={translation} readOnly rows={6} aria-label="Tradução do prompt para português" className="resize-none bg-background/50 text-sm" data-testid={`${idPrefix}-translation-output`} />
            <p className="text-xs text-muted-foreground">Somente leitura. A geração usa o texto da aba “Prompt de geração”; editá-lo descarta esta tradução.</p>
          </>
        ) : (
          <div className="space-y-2 rounded-md border border-border/60 bg-background/30 p-3 text-sm" data-testid={`${idPrefix}-translation-empty`}>
            <p className="text-muted-foreground">
              {hasPrompt ? 'Nenhuma tradução para o prompt atual. Traduza só se quiser entender o texto em português.' : 'Escreva ou aplique um prompt para poder traduzi-lo.'}
            </p>
            {canTranslate && hasPrompt && <p className="text-xs text-muted-foreground" data-testid={`${idPrefix}-translation-cost`}>{PROMPT_TRANSLATION_COST_NOTICE}</p>}
            {!canTranslate && (
              <p role="status" className="text-xs text-amber-200" data-testid={`${idPrefix}-translation-unavailable`}>
                {unavailableReason} <a href="/configuracoes?tab=api" className="font-medium underline underline-offset-4">Configurar provedor</a>
              </p>
            )}
            {error && <p role="alert" className="text-xs text-destructive" data-testid={`${idPrefix}-translation-error`}>{error}</p>}
            <Button type="button" variant="outline" size="sm" onClick={onTranslate} disabled={disabled || translating || !canTranslate || !hasPrompt} data-testid={`${idPrefix}-translate`}>
              {translating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Languages className="mr-2 h-4 w-4" />}
              {translating ? 'Traduzindo…' : 'Traduzir para português'}
            </Button>
          </div>
        )}
      </TabsContent>
    </Tabs>
  )
}
