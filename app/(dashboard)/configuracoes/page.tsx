'use client'

import { IMAGE_MODEL_LABELS, parseImageModel, GEMINI_IMAGE_MODEL_NOT_RELEASED_MESSAGE, isGeminiImageReleasedModel, type ImageModel } from '@/lib/images/image-models'
import { geminiImageAvailabilityMessage, parseGeminiImageAvailability, type GeminiImageAvailability } from '@/lib/images/gemini-availability'
import { Suspense, useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useTheme } from 'next-themes'
import {
  DashboardPage,
  DashboardPageContent,
} from '@/components/layout/dashboard-page'
import { PageHeader } from '@/components/layout/page-header'
import { useStudioIntensity } from '@/components/theme-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { StateMessage } from '@/components/ui/state-message'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
import { Loader2, Moon, Sun, Monitor, Save, Check, Sparkles, Brain } from 'lucide-react'
import { AiProviderCredentialCard, type AiProviderCredentialStatus } from '@/components/settings/ai-provider-credential-card'
import { KlingMcpConnectionCard } from '@/components/settings/kling-mcp-connection-card'
import { UsageHistory } from '@/components/settings/usage-history'
import { SettingsTabsList, resolveSettingsTab } from '@/components/settings/settings-tabs'
import { ChangePasswordForm } from '@/components/settings/change-password-form'
import { Separator } from '@/components/ui/separator'
import type { PublicProviderConnection } from '@/lib/provider-connections/types'
import { Slider } from '@/components/ui/slider'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import type { User as SupabaseUser } from '@supabase/supabase-js'
import type { UserSettings } from '@/lib/types'
import {
  DEFAULT_STUDIO_INTENSITY,
  DEFAULT_THEME,
  normalizeStudioIntensity,
  normalizeUserSelectableTheme,
  type StudioIntensity,
  type UserSelectableTheme,
} from '@/lib/theme'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

const studioIntensityOptions: Array<{
  description: string
  value: StudioIntensity
}> = [
  {
    description: 'Atmosfera discreta e menor carga visual.',
    value: 'soft',
  },
  {
    description: 'Equilibrio entre identidade, profundidade e legibilidade.',
    value: 'balanced',
  },
  {
    description: 'Atmosfera mais presente para uma experiencia visual imersiva.',
    value: 'expressive',
  },
]

function SettingsPageContent() {
  const { toast } = useToast()
  // STRUCTURAL_WAVE_0 (D5): `?tab=<value>` deep links (the AI-credential CTAs use `?tab=api`). An unknown value falls back to the
  // default tab. A tab the user picks stays picked; a NEW `tab` value in the URL (client navigation) is followed once.
  const requestedTab = useSearchParams()?.get('tab') ?? null
  const { theme, setTheme } = useTheme()
  const { studioIntensity, setStudioIntensity } = useStudioIntensity()
  const [user, setUser] = useState<SupabaseUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [activeTab, setActiveTab] = useState(() => resolveSettingsTab(requestedTab))
  const [seenRequestedTab, setSeenRequestedTab] = useState(requestedTab)
  if (seenRequestedTab !== requestedTab) {
    setSeenRequestedTab(requestedTab)
    if (requestedTab) setActiveTab(resolveSettingsTab(requestedTab))
  }
  const [saveFeedback, setSaveFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)
  const [providerStatuses, setProviderStatuses] = useState<Record<string, AiProviderCredentialStatus>>({
    openai: 'loading',
    nano_banana: 'loading',
    kling: 'loading',
    replicate: 'loading',
    gemini: 'loading',
  })
  const [nanobananaBaseUrl, setNanobananaBaseUrl] = useState<string | null>(null)
  // FUTURE-064 Slice B: server-derived capability class (never a variable name/value). null = not known = unavailable.
  const [geminiImageAvailability, setGeminiImageAvailability] = useState<GeminiImageAvailability | null>(null)
  const [klingMcpConnection, setKlingMcpConnection] = useState<PublicProviderConnection | null | undefined>(undefined)
  const [connectionsAvailable, setConnectionsAvailable] = useState(true)
  const [connectionsLoadFailed, setConnectionsLoadFailed] = useState(false)
  const [liveKlingCredits, setLiveKlingCredits] = useState<number | null>(null)
  const isThemeReady = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )

  // Settings state
  const [settings, setSettings] = useState<Partial<UserSettings>>({
    auto_mode_default: true,
    save_prompt_history: true,
    notifications_email: true,
    notifications_browser: false,
    automation_enabled: false,
    default_image_model: 'gpt-image-2',
    image_evaluator_enabled: false,
    max_refinement_iterations: 2,
  })

  const activeTheme = isThemeReady
    ? normalizeUserSelectableTheme(theme, DEFAULT_THEME)
    : null
  const isStudioIntensityReady = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )
  const activeStudioIntensity = isStudioIntensityReady
    ? normalizeStudioIntensity(studioIntensity, DEFAULT_STUDIO_INTENSITY)
    : null

  const announceKlingMcpResult = useCallback((result: string) => {
    const messages: Record<string, { title: string; description: string; variant?: 'destructive' }> = {
      connected: { title: 'Conta Kling conectada', description: 'Autorização somente leitura concluída. Verificando a conexão...' },
      provider_denied: { title: 'Autorização cancelada', description: 'Você não autorizou o acesso à conta Kling.', variant: 'destructive' },
      provider_error: { title: 'A Kling recusou a autorização', description: 'Tente conectar novamente.', variant: 'destructive' },
      missing_parameters: { title: 'Retorno da Kling incompleto', description: 'Inicie a conexão novamente.', variant: 'destructive' },
      invalid_state: { title: 'Autorização inválida ou já usada', description: 'Inicie a conexão novamente.', variant: 'destructive' },
      expired_state: { title: 'Autorização expirada', description: 'Inicie a conexão novamente.', variant: 'destructive' },
      state_mismatch: { title: 'Autorização de outra sessão', description: 'Inicie a conexão novamente com esta conta.', variant: 'destructive' },
      exchange_failed: { title: 'Não foi possível concluir a conexão', description: 'Tente novamente em instantes.', variant: 'destructive' },
      encryption_unavailable: { title: 'Conexões indisponíveis neste ambiente', description: 'O armazenamento seguro de credenciais não está configurado.', variant: 'destructive' },
    }
    toast(messages[result] ?? messages.exchange_failed)
  }, [toast])

  const handleConnectKlingMcp = async (intent: 'read_only' | 'generation' = 'read_only') => {
    try {
      const response = await fetch('/api/provider-connections/kling/mcp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || typeof payload?.authorizationUrl !== 'string') {
        toast({
          title: 'Não foi possível iniciar a conexão',
          description:
            payload?.code === 'CONNECTION_ENCRYPTION_NOT_CONFIGURED'
              ? 'As conexões de conta ainda não estão habilitadas neste ambiente.'
              : 'A Kling não respondeu agora. Tente novamente.',
          variant: 'destructive',
        })
        return
      }
      // Full-page redirect to Kling's own consent screen; tokens never pass through the browser.
      window.location.assign(payload.authorizationUrl)
    } catch {
      toast({ title: 'Falha de rede', description: 'Não foi possível iniciar a conexão. Verifique sua conexão e tente novamente.', variant: 'destructive' })
    }
  }

  const handleCheckKlingMcpConnection = useCallback(async (id: string) => {
    let response: Response
    try {
      response = await fetch(`/api/provider-connections/${id}/check`, { method: 'POST' })
    } catch {
      toast({ title: 'Falha de rede', description: 'Não foi possível verificar a conexão agora.', variant: 'destructive' })
      return
    }
    const payload = await response.json().catch(() => ({}))
    if (response.ok) {
      setKlingMcpConnection(payload.connection as PublicProviderConnection)
      setLiveKlingCredits(typeof payload?.credits?.available === 'number' ? payload.credits.available : null)
      toast({ title: 'Conexão verificada', description: 'A conta Kling respondeu com sucesso (somente leitura).' })
      return
    }
    if (payload?.connectionStatus) {
      setKlingMcpConnection((current) =>
        current ? { ...current, status: payload.connectionStatus, lastErrorCode: payload.code ?? null } : current,
      )
    }
    toast({
      title: payload?.code === 'PROVIDER_AUTHORIZATION_REQUIRED' ? 'Reautorização necessária' : 'Não foi possível verificar a conexão',
      description:
        payload?.code === 'PROVIDER_AUTHORIZATION_REQUIRED'
          ? 'A autorização com a Kling não é mais válida. Reconecte a conta.'
          : payload?.code === 'PROVIDER_SCOPE_INSUFFICIENT'
            ? 'A autorização concedida não cobre esta consulta.'
            : 'Tente novamente em instantes.',
      variant: 'destructive',
    })
  }, [toast])

  const handleDisconnectKlingMcp = async () => {
    if (!klingMcpConnection) return
    let response: Response
    try {
      response = await fetch(`/api/provider-connections/${klingMcpConnection.id}`, { method: 'DELETE' })
    } catch {
      toast({ title: 'Falha de rede', description: 'Não foi possível desconectar agora. Tente novamente.', variant: 'destructive' })
      return
    }
    if (!response.ok) {
      const failure = await response.json().catch(() => ({}))
      toast({
        title: 'Não foi possível desconectar',
        description:
          failure?.code === 'CONNECTION_HAS_ACTIVE_GENERATIONS'
            ? 'Há vídeos ainda em geração com esta conta. Aguarde a conclusão para desconectar.'
            : 'As credenciais ainda estão guardadas. Tente novamente.',
        variant: 'destructive',
      })
      return
    }
    const payload = await response.json().catch(() => ({}))
    setKlingMcpConnection(null)
    setLiveKlingCredits(null)
    if (payload?.revocation === 'succeeded') {
      toast({ title: 'Conta Kling desconectada', description: 'A autorização foi revogada na Kling e as credenciais foram apagadas. Sua chave de API de Kling e seus vídeos não foram afetados.' })
    } else {
      toast({
        title: 'Conta Kling desconectada',
        description: 'Apagamos as credenciais guardadas, mas não conseguimos confirmar a revogação na Kling. Se quiser, remova o acesso do Content Studio nas configurações da sua conta Kling.'
      })
    }
  }

  useEffect(() => {
    const fetchData = async () => {
      setLoadError(null)

      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        setUser(user)

        if (user) {
          // Non-secret preferences only — provider credentials are never
          // selected here. See /api/settings/providers (AI_PROVIDER_CREDENTIALS_BYOK_V1).
          const { data: settingsData } = await supabase
            .from('user_settings')
            .select('theme, studio_intensity, auto_mode_default, save_prompt_history, notifications_email, notifications_browser, automation_enabled, default_image_model, image_evaluator_enabled, max_refinement_iterations')
            .eq('user_id', user.id)
            .single()

          if (settingsData) {
            setSettings({
              ...settingsData,
              automation_enabled: settingsData.automation_enabled ?? false,
              default_image_model: settingsData.default_image_model === 'openai'
                ? 'gpt-image-2'
                : settingsData.default_image_model || 'gpt-image-2',
              image_evaluator_enabled: settingsData.image_evaluator_enabled ?? false,
              max_refinement_iterations: settingsData.max_refinement_iterations ?? 2,
            })
          }

          try {
            const providersResponse = await fetch('/api/settings/providers')
            if (providersResponse.ok) {
              const providersPayload = await providersResponse.json()
              setProviderStatuses({
                openai: providersPayload?.providers?.openai?.status ?? 'missing',
                nano_banana: providersPayload?.providers?.nano_banana?.status ?? 'missing',
                kling: providersPayload?.providers?.kling?.status ?? 'missing',
                replicate: providersPayload?.providers?.replicate?.status ?? 'missing',
                gemini: providersPayload?.providers?.gemini?.status ?? 'missing',
              })
              setNanobananaBaseUrl(providersPayload?.nanobananaBaseUrl ?? null)
              setGeminiImageAvailability(parseGeminiImageAvailability(providersPayload?.imageGeneration?.gemini))
            }
          } catch (providerStatusError) {
            console.error('Erro ao carregar status dos providers:', providerStatusError)
          }

          // Kling account (MCP / OAuth) connection: safe metadata only.
          let loadedConnection: PublicProviderConnection | null = null
          try {
            const connectionsResponse = await fetch('/api/provider-connections')
            if (connectionsResponse.ok) {
              const connectionsPayload = await connectionsResponse.json()
              loadedConnection =
                (connectionsPayload?.connections as PublicProviderConnection[] | undefined)?.find(
                  (connection) => connection.provider === 'kling' && connection.connectionMethod === 'mcp_oauth',
                ) ?? null
              setKlingMcpConnection(loadedConnection)
              setConnectionsAvailable(connectionsPayload?.connectionsAvailable !== false)
              setConnectionsLoadFailed(false)
            } else {
              setConnectionsLoadFailed(true)
            }
          } catch (connectionsError) {
            console.error('Erro ao carregar conexões:', connectionsError)
            setConnectionsLoadFailed(true)
          }

          // Result of the OAuth redirect: show it, open the API tab, then remove
          // the query string so nothing lingers in the URL or history.
          const redirectParams = new URLSearchParams(window.location.search)
          if (redirectParams.get('connection') === 'kling_mcp') {
            const result = redirectParams.get('result') ?? ''
            window.history.replaceState(null, '', window.location.pathname)
            setActiveTab('api')
            announceKlingMcpResult(result)
            if (result === 'connected' && loadedConnection) {
              void handleCheckKlingMcpConnection(loadedConnection.id)
            }
          }
        }
      } catch {
        setLoadError('Não foi possível carregar as configurações agora.')
      } finally {
        setIsLoading(false)
      }
    }
    fetchData()
  }, [announceKlingMcpResult, handleCheckKlingMcpConnection])

  const handleSaveProviderCredential = async (provider: string, apiKey: string, baseUrl?: string) => {
    const response = await fetch(`/api/settings/providers/${provider}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey, baseUrl }),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      toast({
        title: 'Erro ao salvar credencial',
        description: payload?.error || 'Não foi possível salvar a credencial agora.',
        variant: 'destructive',
      })
      throw new Error(payload?.error || 'Falha ao salvar credencial')
    }
    setProviderStatuses((prev) => ({ ...prev, [provider]: 'configured' }))
    if (provider === 'nano_banana' && baseUrl) {
      setNanobananaBaseUrl(baseUrl)
    }
    toast({ title: 'Credencial salva', description: 'O provider está configurado e pronto para uso.' })
  }

  const handleRemoveProviderCredential = async (provider: string) => {
    const response = await fetch(`/api/settings/providers/${provider}`, { method: 'DELETE' })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      toast({
        title: 'Erro ao remover credencial',
        description: payload?.error || 'Não foi possível remover a credencial agora.',
        variant: 'destructive',
      })
      throw new Error(payload?.error || 'Falha ao remover credencial')
    }
    setProviderStatuses((prev) => ({ ...prev, [provider]: 'missing' }))
    toast({ title: 'Credencial removida', description: 'O provider ficará indisponível até uma nova configuração.' })
  }

  const handleThemeChange = (nextTheme: UserSelectableTheme) => {
    setTheme(nextTheme)
  }

  const handleStudioIntensityChange = (nextStudioIntensity: StudioIntensity) => {
    setStudioIntensity(nextStudioIntensity)
  }

  const handleSaveSettings = async () => {
    if (!user) return

    setIsSaving(true)
    setSaveFeedback(null)
    const supabase = createClient()
    const persistedTheme = normalizeUserSelectableTheme(theme, DEFAULT_THEME)
    const persistedStudioIntensity = normalizeStudioIntensity(
      studioIntensity,
      DEFAULT_STUDIO_INTENSITY,
    )

    try {
      const { error } = await supabase
        .from('user_settings')
        .upsert({
          user_id: user.id,
          theme: persistedTheme,
          studio_intensity: persistedStudioIntensity,
          auto_mode_default: settings.auto_mode_default,
          save_prompt_history: settings.save_prompt_history,
          notifications_email: settings.notifications_email,
          notifications_browser: settings.notifications_browser,
          automation_enabled: settings.automation_enabled ?? false,
          default_image_model: settings.default_image_model || 'gpt-image-2',
          image_evaluator_enabled: settings.image_evaluator_enabled ?? false,
          max_refinement_iterations: settings.max_refinement_iterations ?? 2,
        }, {
          onConflict: 'user_id'
        })

      if (error) throw error

      toast({
        title: 'Configurações salvas',
        description: 'Suas preferências foram atualizadas com sucesso.',
      })
      setSaveFeedback({
        tone: 'success',
        message: 'Alterações salvas. Você já pode continuar trabalhando com as novas preferências.',
      })
    } catch (error) {
      console.error('Erro ao salvar configurações:', error)
      toast({
        title: 'Erro',
        description: 'Não foi possível salvar as configurações.',
        variant: 'destructive',
      })
      setSaveFeedback({
        tone: 'error',
        message: 'Não foi possível salvar agora. Revise os campos e tente novamente.',
      })
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <DashboardPage>
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="w-full max-w-3xl">
            <StateMessage
              tone="loading"
              title="Carregando configurações..."
              description="Estamos preparando preferências, integrações e chaves salvas."
            />
          </div>
        </div>
      </DashboardPage>
    )
  }

  return (
    <DashboardPage>
      <DashboardPageContent width="3xl">
          <PageHeader
            context="Sistema"
            title="Configurações"
            description="Gerencie preferências, integrações e chaves usadas pelo Studio."
            className="mb-6"
          />
          {loadError ? (
            <StateMessage
              tone="error"
              title="Não foi possível abrir as configurações"
              description={loadError}
              actionLabel="Tentar novamente"
              onAction={() => window.location.reload()}
            />
          ) : null}
          {saveFeedback ? (
            <StateMessage
              tone={saveFeedback.tone}
              title={saveFeedback.tone === 'success' ? 'Configurações salvas' : 'Falha ao salvar'}
              description={saveFeedback.message}
              compact
            />
          ) : null}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
            <SettingsTabsList />

            {/* Profile Tab */}
            <TabsContent value="profile">
              <Card className="border-border/50 bg-card/30 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle>Perfil</CardTitle>
                  <CardDescription>
                    Gerencie suas informações pessoais
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      value={user?.email || ''}
                      disabled
                      className="bg-background/50"
                    />
                    <p className="text-xs text-muted-foreground">
                      O email não pode ser alterado
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="created">Conta criada em</Label>
                    <Input
                      id="created"
                      value={user?.created_at ? new Date(user.created_at).toLocaleDateString('pt-BR') : ''}
                      disabled
                      className="bg-background/50"
                    />
                  </div>
                  <Separator />
                  <ChangePasswordForm />
                </CardContent>
              </Card>
            </TabsContent>

            {/* Appearance Tab */}
            <TabsContent value="appearance">
              <Card className="border-border/50 bg-card/30 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle>Aparência</CardTitle>
                  <CardDescription>
                    Personalize a experiência do aplicativo
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Theme Selection */}
                  <div className="space-y-3">
                    <Label>Tema</Label>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Button
                        variant={activeTheme === 'light' ? 'default' : 'outline'}
                        className="relative h-auto flex-col gap-2 py-4"
                        aria-pressed={activeTheme === 'light'}
                        disabled={!isThemeReady}
                        onClick={() => handleThemeChange('light')}
                      >
                        <Sun className="h-5 w-5" />
                        <span className="text-xs">Claro</span>
                        {activeTheme === 'light' && (
                          <Check className="absolute right-2 top-2 h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant={activeTheme === 'dark' ? 'default' : 'outline'}
                        className="relative h-auto flex-col gap-2 py-4"
                        aria-pressed={activeTheme === 'dark'}
                        disabled={!isThemeReady}
                        onClick={() => handleThemeChange('dark')}
                      >
                        <Moon className="h-5 w-5" />
                        <span className="text-xs">Escuro</span>
                        {activeTheme === 'dark' && (
                          <Check className="absolute right-2 top-2 h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant={activeTheme === 'system' ? 'default' : 'outline'}
                        className="relative h-auto flex-col gap-2 py-4"
                        aria-pressed={activeTheme === 'system'}
                        disabled={!isThemeReady}
                        onClick={() => handleThemeChange('system')}
                      >
                        <Monitor className="h-5 w-5" />
                        <span className="text-xs">Sistema</span>
                        {activeTheme === 'system' && (
                          <Check className="absolute right-2 top-2 h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant={activeTheme === 'studio' ? 'default' : 'outline'}
                        className="relative h-auto flex-col gap-2 py-4"
                        aria-pressed={activeTheme === 'studio'}
                        disabled={!isThemeReady}
                        onClick={() => handleThemeChange('studio')}
                      >
                        <Sparkles className="h-5 w-5" />
                        <span className="text-xs">Studio</span>
                        {activeTheme === 'studio' && (
                          <Check className="absolute right-2 top-2 h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>

                  {activeTheme === 'studio' && (
                    <div className="space-y-3">
                      <Label>Intensidade do Studio</Label>
                      <RadioGroup
                        value={activeStudioIntensity ?? DEFAULT_STUDIO_INTENSITY}
                        onValueChange={(value) =>
                          handleStudioIntensityChange(value as StudioIntensity)
                        }
                        className="grid gap-3"
                      >
                        {studioIntensityOptions.map((option) => {
                          const radioId = `studio-intensity-${option.value}`
                          const isSelected =
                            option.value ===
                            (activeStudioIntensity ?? DEFAULT_STUDIO_INTENSITY)

                          return (
                            <div
                              key={option.value}
                              data-selected={isSelected}
                              className={cn(
                                'flex items-start gap-3 rounded-lg border p-3 transition-[background-color,border-color,box-shadow]',
                                isSelected
                                  ? 'border-[var(--border-selected)] bg-[var(--control-background-active)] shadow-elevation-low'
                                  : 'border-[var(--control-border)] bg-[var(--control-background)]',
                              )}
                            >
                              <RadioGroupItem value={option.value} id={radioId} />
                              <Label htmlFor={radioId} className="flex-1 cursor-pointer space-y-1">
                                <span className="block font-medium capitalize">{option.value}</span>
                                <p className="text-sm text-muted-foreground">
                                  {option.description}
                                </p>
                              </Label>
                            </div>
                          )
                        })}
                      </RadioGroup>
                    </div>
                  )}

                  <Button onClick={handleSaveSettings} disabled={isSaving} className="w-full">
                    {isSaving ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-2 h-4 w-4" />
                    )}
                    Salvar Preferências
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Automation Tab */}
            <TabsContent value="automation">
              <Card className="border-border/50 bg-card/30 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle>Automação</CardTitle>
                  <CardDescription>
                    Configure o comportamento automático na geração de imagens
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
                    <p className="text-sm text-amber-200/80">
                      <strong>Manual:</strong> você escreve o prompt e cria a imagem. <strong>Assistido:</strong> a IA sugere um prompt; você aplica ou descarta e cria a imagem.
                    </p>
                    <p className="mt-2 text-sm text-amber-200/80">
                      <strong>Automático:</strong> a cada clique em “Gerar automaticamente”, uma chamada de texto cria o prompt e uma geração de imagem é enviada. A execução roda no seu navegador enquanto a página está aberta e nunca começa sozinha.
                    </p>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Permitir o modo Automático</Label>
                      <p className="text-sm text-muted-foreground">
                        Mostra a opção Automático em Imagens. Nada é executado sem você clicar em “Gerar automaticamente”.
                      </p>
                    </div>
                    <Switch
                      checked={settings.automation_enabled}
                      onCheckedChange={(checked) =>
                        setSettings({ ...settings, automation_enabled: checked })
                      }
                    />
                  </div>

                  <div className="space-y-3">
                    <Label>Modelo Padrão de Imagem</Label>
                    <p className="text-sm text-muted-foreground">
                      Modelo de imagem selecionado por padrão ao abrir o workspace de Imagens (Manual, Assistido e Automático)
                    </p>
                    <RadioGroup
                      value={settings.default_image_model || 'gpt-image-2'}
                      onValueChange={(value: string) => {
                        const model = parseImageModel(value)
                        if (model) setSettings({ ...settings, default_image_model: model })
                      }}
                      className="flex flex-col gap-3"
                    >
                      <div className="flex items-center space-x-3 rounded-lg border border-border/50 p-3">
                        <RadioGroupItem value="gpt-image-2" id="model-gpt-image-2" />
                        <Label htmlFor="model-gpt-image-2" className="flex-1 cursor-pointer">
                          <span className="font-medium">GPT Image 2</span>
                          <p className="text-sm text-muted-foreground">
                            Modelo de imagem mais recente da OpenAI
                          </p>
                        </Label>
                      </div>
                      <div className="flex items-center space-x-3 rounded-lg border border-border/50 p-3">
                        <RadioGroupItem value="gpt-image-1.5" id="model-gpt-image-15" />
                        <Label htmlFor="model-gpt-image-15" className="flex-1 cursor-pointer">
                          <span className="font-medium">GPT Image 1.5</span>
                          <p className="text-sm text-muted-foreground">
                            Alta qualidade e boa aderencia ao prompt
                          </p>
                        </Label>
                      </div>
                      <div className="flex items-center space-x-3 rounded-lg border border-border/50 p-3">
                        <RadioGroupItem value="gpt-image-1" id="model-gpt-image-1" />
                        <Label htmlFor="model-gpt-image-1" className="flex-1 cursor-pointer">
                          <span className="font-medium">GPT Image 1</span>
                          <p className="text-sm text-muted-foreground">
                            Modelo anterior de geracao de imagens da OpenAI
                          </p>
                        </Label>
                      </div>
                      <div className="flex items-center space-x-3 rounded-lg border border-border/50 p-3">
                        <RadioGroupItem value="gpt-image-1-mini" id="model-gpt-image-1-mini" />
                        <Label htmlFor="model-gpt-image-1-mini" className="flex-1 cursor-pointer">
                          <span className="font-medium">GPT Image 1 Mini</span>
                          <p className="text-sm text-muted-foreground">
                            Opcao mais economica para testes e rascunhos
                          </p>
                        </Label>
                      </div>
                      <div className="flex items-center space-x-3 rounded-lg border border-border/50 p-3">
                        <RadioGroupItem
                          value="gemini-nb-2.1"
                          id="model-gemini-nb-21"
                          disabled={!geminiImageAvailability?.available && settings.default_image_model !== 'gemini-nb-2.1'}
                        />
                        <Label htmlFor="model-gemini-nb-21" className="flex-1 cursor-pointer">
                          <span className="font-medium">{IMAGE_MODEL_LABELS['gemini-nb-2.1' as ImageModel]}</span>
                          <p className="text-sm text-muted-foreground">
                            API oficial do Google. Usa sua chave Gemini (BYOK) e pode gerar cobrança na sua conta Google.
                          </p>
                        </Label>
                      </div>
                      <div className="flex items-center space-x-3 rounded-lg border border-border/50 p-3">
                        <RadioGroupItem
                          value="gemini-nb-lite"
                          id="model-gemini-nb-lite"
                          disabled={(!geminiImageAvailability?.available || !isGeminiImageReleasedModel('gemini-nb-lite')) && settings.default_image_model !== 'gemini-nb-lite'}
                        />
                        <Label htmlFor="model-gemini-nb-lite" className="flex-1 cursor-pointer">
                          <span className="font-medium">{IMAGE_MODEL_LABELS['gemini-nb-lite' as ImageModel]}</span>
                          <p className="text-sm text-muted-foreground">
                            Variante Lite da API oficial do Google (resolução 1K). Usa sua chave Gemini e pode gerar cobrança na sua conta Google.
                          {!isGeminiImageReleasedModel('gemini-nb-lite') && <> {GEMINI_IMAGE_MODEL_NOT_RELEASED_MESSAGE}</>}
                          </p>
                        </Label>
                      </div>
                      {!geminiImageAvailability?.available && (
                        <p className="text-sm text-muted-foreground" data-testid="settings-google-model-note">
                          Modelos Google Gemini (oficial) indisponíveis como padrão: {geminiImageAvailabilityMessage(geminiImageAvailability)}
                        </p>
                      )}
                      <div className="flex items-center space-x-3 rounded-lg border border-border/50 p-3">
                        <RadioGroupItem value="nanobanana-v1" id="model-nb-v1" />
                        <Label htmlFor="model-nb-v1" className="flex-1 cursor-pointer">
                          <span className="font-medium">{IMAGE_MODEL_LABELS['nanobanana-v1']}</span>
                          <p className="text-sm text-muted-foreground">
                            Serviço de terceiros (não é a API oficial do Google). Mantido temporariamente.
                          </p>
                        </Label>
                      </div>
                      <div className="flex items-center space-x-3 rounded-lg border border-border/50 p-3">
                        <RadioGroupItem value="nanobanana-v2" id="model-nb-v2" />
                        <Label htmlFor="model-nb-v2" className="flex-1 cursor-pointer">
                          <span className="font-medium">{IMAGE_MODEL_LABELS['nanobanana-v2']}</span>
                          <p className="text-sm text-muted-foreground">
                            Serviço de terceiros (não é a API oficial do Google). Mantido temporariamente.
                          </p>
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>

                  {/* Separator */}
                  <div className="border-t border-border/50" />

                  {/* Image Evaluator Section */}
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <Brain className="h-5 w-5 text-cyan-400" />
                      <h3 className="font-semibold">Avaliador de Imagem (IA)</h3>
                    </div>
                    
                    <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-4">
                      <p className="text-sm text-cyan-200/80">
                        O avaliador analisa uma imagem gerada com base no contexto e na identidade do projeto <strong>quando você clica em Avaliar</strong> e sugere um prompt refinado. A avaliação é manual: nenhuma imagem é avaliada ou refeita automaticamente.
                      </p>
                    </div>

                    <div className="flex items-center justify-between">
                      <div>
                        <Label>Ativar Avaliador</Label>
                        <p className="text-sm text-muted-foreground">
                          Mostra o botão Avaliar nas imagens geradas (avaliação manual)
                        </p>
                      </div>
                      <Switch
                        checked={settings.image_evaluator_enabled}
                        onCheckedChange={(checked) =>
                          setSettings({ ...settings, image_evaluator_enabled: checked })
                        }
                      />
                    </div>

                    {settings.image_evaluator_enabled && (
                      <div className="space-y-3 rounded-lg border border-border/50 p-4">
                        <div className="flex items-center justify-between">
                          <Label>Máximo de Refinamentos</Label>
                          <span className="text-sm font-medium text-cyan-400">
                            {settings.max_refinement_iterations}
                          </span>
                        </div>
                        <Slider
                          value={[settings.max_refinement_iterations ?? 2]}
                          min={0}
                          max={3}
                          step={1}
                          disabled
                          className="py-2"
                        />
                        <p className="text-xs text-muted-foreground" data-testid="refinement-reserved-note">
                          Reservado: o refinamento automático ainda não está disponível e este valor não tem efeito hoje. Seu valor salvo é preservado.
                        </p>
                      </div>
                    )}
                  </div>

                  <Button onClick={handleSaveSettings} disabled={isSaving} className="w-full">
                    {isSaving ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-2 h-4 w-4" />
                    )}
                    Salvar Preferências
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Notifications Tab */}
            <TabsContent value="notifications">
              <Card className="border-border/50 bg-card/30 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle>Notificações</CardTitle>
                  <CardDescription>
                    Configure como você quer receber atualizações
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Notificações por Email</Label>
                      <p className="text-sm text-muted-foreground">
                        Receba atualizações sobre suas criações por email
                      </p>
                    </div>
                    <Switch
                      checked={settings.notifications_email}
                      onCheckedChange={(checked) =>
                        setSettings({ ...settings, notifications_email: checked })
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Notificações do Navegador</Label>
                      <p className="text-sm text-muted-foreground">
                        Receba notificações push no navegador
                      </p>
                    </div>
                    <Switch
                      checked={settings.notifications_browser}
                      onCheckedChange={(checked) =>
                        setSettings({ ...settings, notifications_browser: checked })
                      }
                    />
                  </div>
                  <Button onClick={handleSaveSettings} disabled={isSaving} className="w-full">
                    {isSaving ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-2 h-4 w-4" />
                    )}
                    Salvar Preferências
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            {/* API Tab */}
            <TabsContent value="api">
              <Card className="border-border/50 bg-card/30 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle>AI Providers</CardTitle>
                  <CardDescription>
                    Cada provider usa sua própria chave (Bring Your Own Key). A chave nunca é reenviada
                    para o navegador depois de salva — apenas o status de configuração.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-4">
                    <p className="text-sm text-violet-200/80">
                      <strong>Dica:</strong> A geração de prompts por IA requer uma chave da OpenAI configurada.
                      Sem uma chave válida, esse recurso ficará indisponível.
                    </p>
                  </div>

                  <AiProviderCredentialCard
                    providerId="openai"
                    title="OpenAI"
                    description="Geração e tradução de prompts, avaliação de imagem e geração de imagem (GPT Image)."
                    status={providerStatuses.openai}
                    placeholder="sk-..."
                    helpText="Usada para geração de prompts otimizados via GPT e para geração de imagem."
                    onSave={(apiKey) => handleSaveProviderCredential('openai', apiKey)}
                    onRemove={() => handleRemoveProviderCredential('openai')}
                  />

                  <AiProviderCredentialCard
                    providerId="nano_banana"
                    title="NanoBananaAPI.ai (terceiros — legado)"
                    description="Geração de imagem via NanoBananaAPI.ai, um serviço de terceiros que não é a API oficial do Google. Mantido temporariamente; para a API oficial, use a chave do Google Gemini abaixo."
                    status={providerStatuses.nano_banana}
                    placeholder="nb_..."
                    showBaseUrl
                    baseUrl={nanobananaBaseUrl}
                    baseUrlPlaceholder="https://api.nanobananaapi.ai/api/v1/nanobanana/generate"
                    helpText="Base URL personalizada (opcional). Para testar, vá em Imagens e crie uma imagem com um modelo NanoBananaAPI.ai (terceiros — legado)."
                    onSave={(apiKey, baseUrl) => handleSaveProviderCredential('nano_banana', apiKey, baseUrl)}
                    onRemove={() => handleRemoveProviderCredential('nano_banana')}
                  />

                  <AiProviderCredentialCard
                    providerId="kling"
                    title="Kling API (chave de API)"
                    description="Geração de vídeo por IA (texto→vídeo e imagem→vídeo) em /videos, usando a API da Kling."
                    status={providerStatuses.kling}
                    placeholder="Chave de API do Kling..."
                    helpText="Sem uma chave configurada, a geração de vídeo IA fica indisponível em /videos."
                    onSave={(apiKey) => handleSaveProviderCredential('kling', apiKey)}
                    onRemove={() => handleRemoveProviderCredential('kling')}
                  />

                  <KlingMcpConnectionCard
                    connection={klingMcpConnection}
                    loadFailed={connectionsLoadFailed}
                    onRetryLoad={() => window.location.reload()}
                    connectionsAvailable={connectionsAvailable}
                    liveCredits={liveKlingCredits}
                    onConnect={handleConnectKlingMcp}
                    onCheck={async () => {
                      if (klingMcpConnection) await handleCheckKlingMcpConnection(klingMcpConnection.id)
                    }}
                    onDisconnect={handleDisconnectKlingMcp}
                  />

                  <AiProviderCredentialCard
                    providerId="replicate"
                    title="Replicate (opcional)"
                    description="Reservado para uso futuro de geração de imagem via Replicate."
                    status={providerStatuses.replicate}
                    placeholder="r8_..."
                    onSave={(apiKey) => handleSaveProviderCredential('replicate', apiKey)}
                    onRemove={() => handleRemoveProviderCredential('replicate')}
                  />

                  <AiProviderCredentialCard
                    providerId="gemini"
                    title="Google Gemini API"
                    description={`Chave BYOK da API oficial do Google Gemini: avaliações multimodais (Review), assistência de prompt e geração de imagem com os modelos oficiais Nano Banana, e vídeo com o Google Veo (liberado separadamente; pode gerar cobrança na sua conta Google). Geração de imagem Google: ${geminiImageAvailability?.available ? 'habilitada neste ambiente' : 'ainda não habilitada neste ambiente'}.`}
                    status={providerStatuses.gemini}
                    placeholder="Chave da API Gemini..."
                    helpText="A chave fica armazenada por usuário e nunca é devolvida ao navegador. As chamadas à API do Google usam a sua chave e podem gerar cobrança na sua conta Google."
                    onSave={(apiKey) => handleSaveProviderCredential('gemini', apiKey)}
                    onRemove={() => handleRemoveProviderCredential('gemini')}
                  />
                </CardContent>
              </Card>
            </TabsContent>

            {/* Usage Tab — AI_PROVIDER_USAGE_LEDGER_AND_HISTORY_V1 (read-only) */}
            <TabsContent value="usage">
              <UsageHistory />
            </TabsContent>
          </Tabs>
      </DashboardPageContent>
    </DashboardPage>
  )
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>}>
      <SettingsPageContent />
    </Suspense>
  )
}
