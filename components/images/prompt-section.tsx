'use client'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ImageIcon, Loader2, Copy, Check } from 'lucide-react'
import { useState } from 'react'

export type ImageModel =
  | 'gpt-image-2'
  | 'gpt-image-1.5'
  | 'gpt-image-1'
  | 'gpt-image-1-mini'
  | 'nanobanana-v1'
  | 'nanobanana-v2'

interface PromptSectionProps {
  generatedPrompt: string
  setGeneratedPrompt: (value: string) => void
  generatedPromptPt?: string
  onTranslatePrompt?: () => Promise<void>
  isTranslatingPrompt?: boolean
  promptDetails: {
    style: string
    lighting: string | null
    composition: string | null
  } | null
  onCreateImage: (model: ImageModel) => void
  isCreatingImage: boolean
  hasNanoBananaKey?: boolean
  automationEnabled?: boolean
  selectedModel?: ImageModel
  onModelChange?: (model: ImageModel) => void
}

export function PromptSection({
  generatedPrompt,
  setGeneratedPrompt,
  generatedPromptPt = '',
  onTranslatePrompt,
  isTranslatingPrompt = false,
  promptDetails,
  onCreateImage,
  isCreatingImage,
  hasNanoBananaKey = false,
  automationEnabled = false,
  selectedModel = 'gpt-image-2',
  onModelChange,
}: PromptSectionProps) {
  const [copied, setCopied] = useState(false)
  const [activePromptLanguage, setActivePromptLanguage] = useState<'en' | 'pt'>('en')

  const handleCopy = async () => {
    await navigator.clipboard.writeText(
      activePromptLanguage === 'pt' ? generatedPromptPt || generatedPrompt : generatedPrompt,
    )
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleLanguageChange = async (value: string) => {
    const language = value === 'pt' ? 'pt' : 'en'
    setActivePromptLanguage(language)

    if (language === 'pt' && !generatedPromptPt && onTranslatePrompt) {
      await onTranslatePrompt()
    }
  }

  if (!generatedPrompt) return null

  return (
    <div className="rounded-xl border border-border/50 bg-card/30 p-6 backdrop-blur-sm">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-cyan-400">
            <ImageIcon className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Prompt Gerado</h2>
            <p className="text-sm text-muted-foreground">
              Edite o prompt se necessário antes de criar a imagem
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleCopy}
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
        {/* Prompt Details Badges — only render chips backed by real data */}
        {promptDetails && (
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary" className="bg-violet-500/20 text-violet-300">
              {promptDetails.style}
            </Badge>
            {promptDetails.lighting !== null && (
              <Badge variant="secondary" className="bg-cyan-500/20 text-cyan-300">
                {promptDetails.lighting}
              </Badge>
            )}
            {promptDetails.composition !== null && (
              <Badge variant="secondary" className="bg-pink-500/20 text-pink-300">
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
              rows={6}
              className="resize-none bg-background/50 font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              O prompt foi gerado em ingles para melhor compatibilidade com modelos de IA.
            </p>
          </TabsContent>

          <TabsContent value="pt" className="mt-0 space-y-2">
            <div className="relative">
              <Textarea
                value={generatedPromptPt}
                readOnly
                placeholder="A versao em portugues sera gerada quando voce abrir esta aba."
                rows={6}
                className="resize-none bg-background/50 text-sm"
              />
              {isTranslatingPrompt && (
                <div className="absolute inset-0 flex items-center justify-center rounded-md bg-background/70">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Esta versao e apenas para leitura. A imagem continua usando o prompt em ingles.
            </p>
          </TabsContent>
        </Tabs>

        {/* Create Image - Single Button + Model Selector (Manual Mode Only) */}
        <div className="flex flex-wrap items-center justify-end gap-3">
          {/* Model Selector - Only show in manual mode */}
          {!automationEnabled && onModelChange && (
            <div className="flex items-center gap-2">
              <Label className="text-sm text-muted-foreground">Modelo:</Label>
              <Select
                value={selectedModel}
                onValueChange={(value: ImageModel) => onModelChange(value)}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Selecione o modelo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gpt-image-2">GPT Image 2</SelectItem>
                  <SelectItem value="gpt-image-1.5">GPT Image 1.5</SelectItem>
                  <SelectItem value="gpt-image-1">GPT Image 1</SelectItem>
                  <SelectItem value="gpt-image-1-mini">GPT Image 1 Mini</SelectItem>
                  {hasNanoBananaKey && (
                    <>
                      <SelectItem value="nanobanana-v1">NanoBanana V1</SelectItem>
                      <SelectItem value="nanobanana-v2">NanoBanana V2</SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>
          )}
          
          {/* Single Create Image Button */}
          <Button
            onClick={() => onCreateImage(selectedModel)}
            disabled={!generatedPrompt.trim() || isCreatingImage}
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
      </div>
    </div>
  )
}
