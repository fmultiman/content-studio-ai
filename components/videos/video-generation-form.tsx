'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { Image as ImageIcon, FileText } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { PromptLanguagePanel, type PromptLanguageView } from '@/components/prompts/prompt-language-panel'
import { cn } from '@/lib/utils'
import {
  audioAllowedAt,
  findOperation,
  VIDEO_OPERATIONS,
  type VideoAspectRatio,
  type VideoAudio,
  type VideoOperation,
  type VideoResolution,
  type VideoGenerationConnectionDescriptor,
} from '@/lib/video-generation/capabilities'
import { I2vSourcePicker } from '@/components/videos/i2v-source-picker'
import { type I2vSourceSelection } from '@/lib/video-generation/i2v-source'
import { connectionDisplayName, spendingSourceCopy, transportBadge } from '@/lib/video-generation/connection-presentation'
import {
  selectedConnection,
  selectedModel,
  visibleControls,
  type VideoFormSelection,
} from '@/lib/video-generation/form-selection'

const OPERATION_LABEL: Record<VideoOperation, string> = {
  text_to_video: 'Texto para Vídeo',
  image_to_video: 'Imagem para Vídeo',
}

const RESOLUTION_LABEL: Record<VideoResolution, string> = {
  '720p': 'Padrão (720p)',
  '1080p': 'Alta (1080p)',
  '4k': 'Ultra (4K)',
}

const ASPECT_LABEL: Record<VideoAspectRatio, string> = {
  '16:9': 'Horizontal (16:9)',
  '9:16': 'Vertical (9:16)',
  '1:1': 'Quadrado (1:1)',
}

const AUDIO_LABEL: Record<VideoAudio, string> = {
  off: 'Sem áudio',
  on: 'Gerar áudio (IA)',
}

export interface VideoGenerationFormProps {
  projectId: string
  productionId: string
  
  connections: VideoGenerationConnectionDescriptor[]
  
  selection: VideoFormSelection
  onSelectionChange: (patch: Partial<VideoFormSelection>) => void
  
  prompt: string
  onPromptChange: (val: string) => void
  
  sourceSelection: I2vSourceSelection | null
  onSourceSelectionChange: (val: I2vSourceSelection | null) => void
  
  disabled?: boolean
  
  header?: ReactNode

  /** Automatic owns generation: the prompt it produced is shown read-only. */
  promptReadOnly?: boolean
  /** Optional read-only Portuguese view of the generation prompt (explicit action only). */
  promptLanguage?: {
    translation: string
    translating: boolean
    error: string | null
    canTranslate: boolean
    unavailableReason?: string
    onTranslate: () => void
  }
}

export function VideoGenerationForm({
  projectId,
  productionId,
  connections,
  selection,
  onSelectionChange,
  prompt,
  onPromptChange,
  sourceSelection,
  onSourceSelectionChange,
  disabled,
  header,
  promptReadOnly = false,
  promptLanguage,
}: VideoGenerationFormProps) {
  const [promptView, setPromptView] = useState<PromptLanguageView>('prompt')

  // One generation-prompt field for every operation. The Portuguese tab is a read-only view, never a second prompt.
  const renderPromptField = (id: string, label: string, placeholder: string, minHeight: string, extraHint?: string) => {
    const field = (
      <>
        <Label htmlFor={id}>{label}</Label>
        <Textarea
          id={id}
          placeholder={placeholder}
          value={prompt}
          readOnly={promptReadOnly}
          onChange={(event) => onPromptChange(event.target.value)}
          className={minHeight}
        />
        <p className="text-xs text-muted-foreground" data-testid="video-prompt-hint">
          {promptReadOnly
            ? 'No modo Automático o prompt é criado pela IA e fica somente leitura. Use Manual ou Assistido para editá-lo.'
            : `${extraHint ? `${extraHint} ` : ''}Este é o único texto enviado ao provedor. Nada é traduzido ou reescrito sem a sua ação.`}
        </p>
      </>
    )
    if (!promptLanguage) return field
    return (
      <PromptLanguagePanel
        idPrefix="video-prompt"
        view={promptView}
        onViewChange={setPromptView}
        translation={promptLanguage.translation}
        translating={promptLanguage.translating}
        error={promptLanguage.error}
        canTranslate={promptLanguage.canTranslate}
        unavailableReason={promptLanguage.unavailableReason}
        hasPrompt={Boolean(prompt.trim())}
        onTranslate={promptLanguage.onTranslate}
        disabled={disabled}
      >
        {field}
      </PromptLanguagePanel>
    )
  }

  const connection = useMemo(() => selectedConnection(connections, selection), [connections, selection])
  const model = useMemo(() => selectedModel(connections, selection), [connections, selection])
  const controls = visibleControls(model)
  
  const operationChoices = useMemo(
    () => VIDEO_OPERATIONS.filter((operation) => connection && findOperation(connection.operations, operation)),
    [connection],
  )
  
  const modelChoices = useMemo(
    () => (connection && selection.operation ? (findOperation(connection.operations, selection.operation)?.models ?? []) : []),
    [connection, selection.operation],
  )

  if (!connection || !selection.operation || !model || operationChoices.length === 0) {
    return (
      <fieldset disabled={disabled} className="w-full min-w-0 space-y-2">
        {header}
        {connections.length > 0 && (
          <div className="space-y-2">
            <Label htmlFor="video-unavailable-connection">Conexão de geração</Label>
            <Select value={selection.connectionRef ?? undefined} onValueChange={(connectionRef) => onSelectionChange({ connectionRef })}>
              <SelectTrigger id="video-unavailable-connection" data-testid="video-unavailable-connection-select">
                <SelectValue placeholder="Escolha uma conexão" />
              </SelectTrigger>
              <SelectContent>
                {connections.map((entry) => (
                  <SelectItem key={entry.ref} value={entry.ref}>
                    {connectionDisplayName(entry)} ({transportBadge(entry.transport)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {renderPromptField('video-working-prompt', 'Prompt de geração', 'Escreva seu prompt enquanto configura uma conexão Kling.', 'min-h-[140px]')}
        <p className="text-xs text-muted-foreground" role="status">{connections.length === 0 ? 'Configure uma conexão Kling em Configurações' : 'Selecione uma conexão Kling com capacidades disponíveis'} para escolher o modelo e gerar o vídeo. Você pode continuar editando e salvando o prompt.</p>
      </fieldset>
    )
  }

  const consumptionNoun = connection.funding === 'kling_web_credits' ? 'créditos' : 'unidades'
  const heavier =
    (model && selection.duration !== null && selection.duration > 5) ||
    (selection.resolution !== null && selection.resolution !== '720p')

  return (
    <fieldset disabled={disabled} className={cn("w-full min-w-0", disabled && "opacity-60 pointer-events-none")}>
      {header}

      {operationChoices.length > 0 && selection.operation && model && (
        <Tabs
          value={selection.operation}
          onValueChange={(value) => onSelectionChange({ operation: value as VideoOperation })}
          className="w-full"
        >
          {/* OPERATION */}
          <TabsList className={`grid w-full ${operationChoices.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {operationChoices.map((operation) => (
              <TabsTrigger key={operation} value={operation} className="gap-2" data-testid={`operation-${operation}`}>
                {operation === 'image_to_video' ? <ImageIcon className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                {OPERATION_LABEL[operation]}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* MODEL */}
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="video-model">Modelo</Label>
              {connections.length > 0 && (
                <div
                  className="flex items-center gap-1"
                  role="radiogroup"
                  aria-label="Conexão de geração"
                  data-testid="video-connection-toggle"
                >
                  {connections.map((entry) => {
                    const badge = transportBadge(entry.transport)
                    const isSelected = entry.ref === connection.ref
                    return (
                      <button
                        key={entry.ref}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        aria-label={`${connectionDisplayName(entry)} (${badge})`}
                        data-testid={`video-connection-option-${badge.toLowerCase()}`}
                        data-selected={isSelected}
                        onClick={() => onSelectionChange({ connectionRef: entry.ref })}
                        className={cn(
                          'rounded border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide outline-none transition-colors',
                          'focus-visible:border-[var(--border-focus)] focus-visible:ring-2 focus-visible:ring-[color:var(--control-focus)]',
                          isSelected
                            ? 'border-transparent bg-[var(--action-primary)] text-[var(--action-primary-foreground)]'
                            : 'border-[var(--control-border)] bg-transparent text-muted-foreground hover:bg-[var(--control-background-hover)]',
                        )}
                      >
                        {badge}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
            <Select value={selection.modelId ?? undefined} onValueChange={(modelId) => onSelectionChange({ modelId })}>
              <SelectTrigger id="video-model" className="w-full" data-testid="video-model-select">
                <SelectValue placeholder="Escolha um modelo" />
              </SelectTrigger>
              <SelectContent>
                {modelChoices.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground" data-testid="video-connection-detail" data-transport={transportBadge(connection.transport)}>
              {spendingSourceCopy(connection.funding)}
            </p>
            <p className="text-[11px] text-muted-foreground" data-testid="video-model-summary">
              {model.durations.map((d) => `${d}s`).join('/')} — {model.resolutions.join('/')}{model.audio ? ' — áudio' : ''}{model.multiShot ? ' — multi-shot' : ''}
            </p>
          </div>

          <TabsContent value="image_to_video" className="space-y-4 pt-4">
            <I2vSourcePicker key={projectId} projectId={projectId} productionId={productionId} value={sourceSelection} onChange={onSourceSelectionChange} />

            <div className="space-y-2">
              {renderPromptField('video-motion-prompt', 'Prompt de geração (como animar a imagem)', 'Como esta imagem deve ser animada? (Ex: A câmera se aproxima suavemente, o cabelo flutua com o vento)', 'min-h-[100px]')}
            </div>
          </TabsContent>

          <TabsContent value="text_to_video" className="space-y-4 pt-4">
            <div className="space-y-2">
              {renderPromptField('video-working-prompt', 'Prompt de geração', 'Descreva a cena do vídeo detalhadamente...', 'min-h-[140px]')}
            </div>
          </TabsContent>

          {/* CONTROLS */}
          <div className="mt-6 grid grid-cols-1 gap-4 rounded-md bg-secondary/20 p-4 sm:grid-cols-2" data-testid="video-controls">
            <div className="space-y-2">
              <Label htmlFor="video-duration">Duração</Label>
              <Select
                value={selection.duration !== null ? String(selection.duration) : undefined}
                onValueChange={(value) => onSelectionChange({ duration: Number(value) })}
              >
                <SelectTrigger id="video-duration" data-testid="video-duration-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {model.durations.map((value) => (
                    <SelectItem key={value} value={String(value)}>
                      {value} segundos
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="video-resolution">Qualidade / Resolução</Label>
              <Select
                value={selection.resolution ?? undefined}
                onValueChange={(value) => onSelectionChange({ resolution: value as VideoResolution })}
              >
                <SelectTrigger id="video-resolution" data-testid="video-resolution-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {model.resolutions.map((value) => (
                    <SelectItem key={value} value={value}>
                      {RESOLUTION_LABEL[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {controls.aspectRatio && (
              <div className="space-y-2">
                <Label htmlFor="video-aspect">Proporção</Label>
                <Select
                  value={selection.aspectRatio ?? undefined}
                  onValueChange={(value) => onSelectionChange({ aspectRatio: value as VideoAspectRatio })}
                >
                  <SelectTrigger id="video-aspect" data-testid="video-aspect-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {model.aspectRatios.map((value) => (
                      <SelectItem key={value} value={value}>
                        {ASPECT_LABEL[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {controls.audio && selection.audio !== null && (
              <div className="space-y-2">
                <Label htmlFor="video-audio">Áudio automático</Label>
                <Select value={selection.audio} onValueChange={(value) => onSelectionChange({ audio: value as VideoAudio })}>
                  <SelectTrigger id="video-audio" data-testid="video-audio-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="off">{AUDIO_LABEL.off}</SelectItem>
                    <SelectItem value="on" disabled={!audioAllowedAt(model, selection.resolution ?? model.resolutions[0])}>
                      {AUDIO_LABEL.on}
                    </SelectItem>
                  </SelectContent>
                </Select>
                {model.audioRequiresResolution && (
                  <p className="text-[10px] text-muted-foreground">
                    Neste modelo o áudio só está disponível em {RESOLUTION_LABEL[model.audioRequiresResolution]}.
                  </p>
                )}
              </div>
            )}

            {controls.multiShot && selection.multiShot !== null ? (
              <div className="space-y-2">
                <Label htmlFor="video-multishot">Multi-shot</Label>
                <Select
                  value={selection.multiShot ? 'true' : 'false'}
                  onValueChange={(value) => onSelectionChange({ multiShot: value === 'true' })}
                >
                  <SelectTrigger id="video-multishot" data-testid="video-multishot-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="false">Desligado</SelectItem>
                    <SelectItem value="true">Ligado (multi-shot)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : !controls.multiShot ? (
              <div className="space-y-1.5" data-testid="video-multishot-unsupported-note">
                <Label htmlFor="video-multishot" className="text-muted-foreground">Multi-shot</Label>
                <p className="text-xs text-muted-foreground pt-1">
                  {model.label} não oferece Multi-shot neste modo.
                </p>
              </div>
            ) : null}

            {heavier && (
              <p className="text-[10px] text-muted-foreground sm:col-span-2">
                Maior duração ou resolução pode aumentar o consumo de {consumptionNoun}.
              </p>
            )}
          </div>

          {/* ADVANCED SECTION (MCP only) */}
          {(controls.asmr || controls.audioPrompt || controls.musicPrompt) && connection.transport === 'mcp' && (
            <div className="mt-4 space-y-4 rounded-md border border-border/60 bg-background p-4" data-testid="video-advanced-controls">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Configurações Avançadas</p>
              {controls.asmr && selection.asmr !== null && (
                <div className="space-y-2">
                  <Label htmlFor="video-asmr">ASMR</Label>
                  <Select
                    value={selection.asmr ? 'true' : 'false'}
                    onValueChange={(value) => onSelectionChange({ asmr: value === 'true' })}
                  >
                    <SelectTrigger id="video-asmr" data-testid="video-asmr-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="false">Desligado</SelectItem>
                      <SelectItem value="true">Ligado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              {controls.audioPrompt && selection.audioPrompt !== null && (
                <div className="space-y-2">
                  <Label htmlFor="video-audio-prompt">Prompt de Áudio (Efeitos)</Label>
                  <Textarea
                    id="video-audio-prompt"
                    data-testid="video-audio-prompt-textarea"
                    placeholder="Ex: Sons da natureza, o vento soprando."
                    value={selection.audioPrompt}
                    onChange={(e) => onSelectionChange({ audioPrompt: e.target.value })}
                    className="min-h-[80px]"
                  />
                </div>
              )}
              {controls.musicPrompt && selection.musicPrompt !== null && (
                <div className="space-y-2">
                  <Label htmlFor="video-music-prompt">Prompt de Música</Label>
                  <Textarea
                    id="video-music-prompt"
                    data-testid="video-music-prompt-textarea"
                    placeholder="Ex: Uma melodia calma e relaxante de piano."
                    value={selection.musicPrompt}
                    onChange={(e) => onSelectionChange({ musicPrompt: e.target.value })}
                    className="min-h-[80px]"
                  />
                </div>
              )}
            </div>
          )}
        </Tabs>
      )}
    </fieldset>
  )
}
