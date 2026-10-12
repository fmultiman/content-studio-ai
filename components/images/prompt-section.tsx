'use client'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ImageIcon, Loader2, Copy, Check } from 'lucide-react'
import { useState } from 'react'
import { isGeminiImageModel, type ImageModel } from '@/lib/images/image-models'
import { GEMINI_IMAGE_COST_NOTICE, buildImageModelGroups } from '@/lib/images/image-readiness'
import type { GeminiImageAvailability } from '@/lib/images/gemini-availability'

export type { ImageModel }

interface PromptSectionProps {
  generatedPrompt: string
  setGeneratedPrompt: (value: string) => void
  suggestedPrompt?: string
  suggestedOperation?: 'create' | 'improve' | null
  onApplySuggestion?: () => void
  onDiscardSuggestion?: () => void
  generatedPromptPt?: string
  onTranslatePrompt?: () => Promise<void>
  isTranslatingPrompt?: boolean
  canTranslatePrompt?: boolean
  translationError?: string | null
  promptDetails: {
    style: string
    lighting: string | null
    composition: string | null
  } | null
  onCreateImage: (model: ImageModel) => void
  isCreatingImage: boolean
  /** Whether the user's NanoBananaAPI.ai (third-party, legacy) key exists. */
  hasNanoBananaKey?: boolean
  /**
   * FUTURE-064 Slice B. Omit to leave the official Google models out of the selector (callers that predate Slice B).
   * `availability` is the server-derived capability class; it is independent of the credential.
   */
  geminiImage?: { availability: GeminiImageAvailability | null; canonicalWorkspace: boolean }
  /** A saved model id this build does not know. The selector shows no selection until the user chooses one. */
  unrecognizedModel?: string | null
  /** Why "Criar Imagem" is blocked for provider-specific reasons (Google capability/credential, unrecognized model). */
  createDisabledReason?: string | null
  /** An automatic run owns the inputs: the prompt and the image controls are read-only until it finishes. */
  workflowBusy?: boolean
  selectedModel?: ImageModel
  onModelChange?: (model: ImageModel) => void
}

export function PromptSection({
  generatedPrompt,
  setGeneratedPrompt,
  suggestedPrompt = '',
  suggestedOperation = null,
  onApplySuggestion,
  onDiscardSuggestion,
  generatedPromptPt = '',
  onTranslatePrompt,
  isTranslatingPrompt = false,
  canTranslatePrompt = true,
  translationError = null,
  promptDetails,
  onCreateImage,
  isCreatingImage,
  hasNanoBananaKey = false,
  geminiImage,
  unrecognizedModel = null,
  createDisabledReason = null,
  workflowBusy = false,
  selectedModel = 'gpt-image-2',
  onModelChange,
}: PromptSectionProps) {
  const [copied, setCopied] = useState(false)
  const [confirmingApply, setConfirmingApply] = useState(false)
  // Applying a CREATE suggestion replaces an authored prompt: ask first (Improve is the user's own refinement).
  const applyReplacesAuthoredPrompt = suggestedOperation === 'create' && generatedPrompt.trim().length > 0 && generatedPrompt.trim() !== suggestedPrompt.trim()
  const [activePromptLanguage, setActivePromptLanguage] = useState<'en' | 'pt'>('en')
  const modelGroups = buildImageModelGroups({
    selectedModel: unrecognizedModel ? null : selectedModel,
    nanobananaConfigured: hasNanoBananaKey,
    gemini: geminiImage,
  })
  const googleNote = modelGroups.find((group) => group.provider === 'gemini')?.note ?? null
  const showGoogleCostNotice = !unrecognizedModel && isGeminiImageModel(selectedModel)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(
      activePromptLanguage === 'pt' ? generatedPromptPt || generatedPrompt || suggestedPrompt : generatedPrompt || suggestedPrompt,
    )
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleLanguageChange = async (value: string) => {
    const language = value === 'pt' ? 'pt' : 'en'
    setActivePromptLanguage(language)

    if (language === 'pt' && canTranslatePrompt && !generatedPromptPt && onTranslatePrompt) {
      await onTranslatePrompt()
    }
  }

  return (
    <div className="rounded-xl border border-border/50 bg-card/30 p-6 backdrop-blur-sm">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-cyan-400">
            <ImageIcon className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Prompt</h2>
            <p className="text-sm text-muted-foreground">
              Escreva o prompt ou edite o gerado e crie a imagem quando quiser
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleCopy}
          disabled={!generatedPrompt && !suggestedPrompt}
          className="gap-2"
        >
          {copied ? (
            <>
              <Check className="h-4 w-4 text-emerald-500" />
              Copiado!
            </>
          ) : (
            <>
              <Copy className="h-4 w-4" />
              Copiar
            </>
          )}
        </Button>
      </div>

      <div className="space-y-6">
        {suggestedPrompt && (
          <div className="rounded-lg border border-violet-400/40 bg-violet-500/10 p-4" data-testid="prompt-assistance-suggestion">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <p className="font-medium text-foreground">Sugestão da IA</p>
                <p className="text-xs text-muted-foreground">
                  {suggestedOperation === 'improve' ? 'Melhoria proposta para o prompt atual.' : 'Prompt proposto a partir da sua intenção.'}
                </p>
              </div>
              <Badge variant="secondary">Não aplicada</Badge>
            </div>
            <Textarea value={suggestedPrompt} readOnly rows={5} className="resize-none bg-background/50 font-mono text-sm" aria-label="Sugestão de prompt" />
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => { setConfirmingApply(false); onDiscardSuggestion?.() }} disabled={workflowBusy} data-testid="prompt-assistance-discard">Descartar</Button>
              {!confirmingApply && (
                <Button
                  onClick={() => (applyReplacesAuthoredPrompt ? setConfirmingApply(true) : onApplySuggestion?.())}
                  disabled={workflowBusy}
                  data-testid="prompt-assistance-apply"
                >
                  Aplicar
                </Button>
              )}
            </div>
            {confirmingApply && (
              <div className="mt-3 flex flex-wrap items-center justify-end gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200" data-testid="prompt-assistance-apply-confirm">
                <span>Aplicar vai substituir o prompt atual.</span>
                <Button variant="ghost" size="sm" onClick={() => setConfirmingApply(false)} data-testid="prompt-assistance-apply-cancel">Manter o atual</Button>
                <Button size="sm" onClick={() => { setConfirmingApply(false); onApplySuggestion?.() }} data-testid="prompt-assistance-apply-confirmed">Substituir</Button>
              </div>
            )}
          </div>
        )}
        {/* Prompt Details Badges — only render chips backed by real data */}
        {promptDetails && generatedPrompt && (
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary" className="border-transparent bg-[color:color-mix(in_oklch,var(--indicator-brand)_18%,transparent)] text-[var(--text-primary)]">
              {promptDetails.style}
            </Badge>
            {promptDetails.lighting !== null && (
              <Badge variant="info">
                {promptDetails.lighting}
              </Badge>
            )}
            {promptDetails.composition !== null && (
              <Badge variant="secondary" className="border-transparent bg-[color:color-mix(in_oklch,var(--chart-4)_18%,transparent)] text-[var(--text-primary)]">
                {promptDetails.composition}
              </Badge>
            )}
          </div>
        )}

        {/* Editable Prompt */}
        <Tabs value={activePromptLanguage} onValueChange={handleLanguageChange}>
          <div className="mb-2 flex items-center justify-between gap-3">
            <Label htmlFor="generated-prompt">
              {activePromptLanguage === 'pt' ? 'Versao em Portugues' : 'Prompt em Ingles'}
            </Label>
            <TabsList className="grid w-[210px] grid-cols-2">
              <TabsTrigger value="en">Ingles</TabsTrigger>
              <TabsTrigger value="pt">Portugues</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="en" className="mt-0 space-y-2">
            <Textarea
              id="generated-prompt"
              value={generatedPrompt}
              onChange={(e) => setGeneratedPrompt(e.target.value)}
              disabled={workflowBusy}
              placeholder="Escreva aqui o prompt da imagem (em inglês, para melhor compatibilidade) ou use a assistência de IA acima."
              rows={6}
              className="resize-none bg-background/50 font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Prompts em ingles têm melhor compatibilidade com modelos de IA.
            </p>
          </TabsContent>

          <TabsContent value="pt" className="mt-0 space-y-2">
            <div className="relative">
              <Textarea
                value={generatedPromptPt}
                readOnly
                placeholder={
                  canTranslatePrompt
                    ? 'A versao em portugues sera gerada quando voce abrir esta aba.'
                    : 'Tradução indisponível sem provedor configurado.'
                }
                rows={6}
                className="resize-none bg-background/50 text-sm"
              />
              {isTranslatingPrompt && (
                <div className="absolute inset-0 flex items-center justify-center rounded-md bg-background/70">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>
            {(!canTranslatePrompt || translationError) && !generatedPromptPt && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
                <p>{translationError || 'Tradução indisponível sem provedor configurado.'}</p>
                {!canTranslatePrompt && (
                  <a
                    href="/configuracoes"
                    className="mt-2 inline-flex font-medium underline underline-offset-4"
                  >
                    Configurar provedor
                  </a>
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Esta versao e apenas para leitura. A imagem continua usando o prompt em ingles.
            </p>
          </TabsContent>
        </Tabs>

        {/* Image model selector + explicit generation: visible in Manual, Assisted and Automatic flows */}
        <div className="flex flex-wrap items-center justify-end gap-3">
          {onModelChange && (
            <div className="flex items-center gap-2">
              <Label className="text-sm text-muted-foreground">Modelo:</Label>
              <Select
                value={unrecognizedModel ? '' : selectedModel}
                onValueChange={(value: ImageModel) => onModelChange(value)}
                disabled={workflowBusy}
              >
                <SelectTrigger className="w-[260px]" aria-label="Modelo de imagem">
                  <SelectValue placeholder="Selecione o modelo" />
                </SelectTrigger>
                <SelectContent>
                  {modelGroups.map((group) => (
                    <SelectGroup key={group.provider}>
                      <SelectLabel>{group.label}</SelectLabel>
                      {group.options.map((option) => (
                        <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          
          {/* Single Create Image Button */}
          <Button
            onClick={() => onCreateImage(selectedModel)}
            disabled={!generatedPrompt.trim() || isCreatingImage || workflowBusy || Boolean(createDisabledReason)}
            size="lg"
            className="bg-gradient-to-r from-violet-600 to-cyan-500 text-white hover:from-violet-700 hover:to-cyan-600"
          >
            {isCreatingImage ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Criando...
              </>
            ) : (
              <>
                <ImageIcon className="mr-2 h-5 w-5" />
                Criar Imagem
              </>
            )}
          </Button>
        </div>
        {(googleNote || createDisabledReason || showGoogleCostNotice) && (
          <div className="space-y-1 text-right text-xs text-muted-foreground" data-testid="image-model-notices">
            {googleNote && <p data-testid="google-model-note">Google Gemini (oficial): {googleNote}</p>}
            {createDisabledReason && <p role="status" data-testid="create-disabled-reason">{createDisabledReason}</p>}
            {showGoogleCostNotice && <p data-testid="google-cost-notice">{GEMINI_IMAGE_COST_NOTICE}</p>}
          </div>
        )}
      </div>
    </div>
  )
}
