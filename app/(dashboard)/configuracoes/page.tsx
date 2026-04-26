'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/layout/header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
import { User, Bell, Palette, Key, Loader2, Moon, Sun, Monitor, Eye, EyeOff, Save, Check, Sparkles, Zap, Brain } from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import type { User as SupabaseUser } from '@supabase/supabase-js'
import type { UserSettings } from '@/lib/types'
import { useToast } from '@/hooks/use-toast'

type Theme = 'light' | 'dark' | 'system'

export default function SettingsPage() {
  const { toast } = useToast()
  const [user, setUser] = useState<SupabaseUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [showOpenAIKey, setShowOpenAIKey] = useState(false)
  const [showReplicateKey, setShowReplicateKey] = useState(false)
  const [showNanoBananaKey, setShowNanoBananaKey] = useState(false)
  
  // Settings state
  const [settings, setSettings] = useState<Partial<UserSettings>>({
    theme: 'dark',
    auto_mode_default: true,
    save_prompt_history: true,
    notifications_email: true,
    notifications_browser: false,
    openai_api_key: '',
    replicate_api_key: '',
    nanobanana_api_key: '',
    nanobanana_base_url: 'https://api.nanobananaapi.ai/api/v1/nanobanana/generate',
    automation_enabled: false,
    default_image_model: 'gpt-image-2',
    image_evaluator_enabled: false,
    max_refinement_iterations: 2,
  })

  useEffect(() => {
    const fetchData = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      setUser(user)

      if (user) {
        // Fetch user settings
        const { data: settingsData } = await supabase
          .from('user_settings')
          .select('*')
          .eq('user_id', user.id)
          .single()

        if (settingsData) {
          setSettings({
            ...settingsData,
            openai_api_key: settingsData.openai_api_key || '',
            replicate_api_key: settingsData.replicate_api_key || '',
            nanobanana_api_key: settingsData.nanobanana_api_key || '',
            nanobanana_base_url: settingsData.nanobanana_base_url || 'https://api.nanobananaapi.ai/api/v1/nanobanana/generate',
            automation_enabled: settingsData.automation_enabled ?? false,
            default_image_model: settingsData.default_image_model === 'openai'
              ? 'gpt-image-2'
              : settingsData.default_image_model || 'gpt-image-2',
            image_evaluator_enabled: settingsData.image_evaluator_enabled ?? false,
            max_refinement_iterations: settingsData.max_refinement_iterations ?? 2,
          })
          // Apply theme from settings
          applyTheme(settingsData.theme as Theme)
        }
      }
      setIsLoading(false)
    }
    fetchData()
  }, [])

  const applyTheme = (theme: Theme) => {
    const root = document.documentElement
    
    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      root.classList.remove('light', 'dark')
      root.classList.add(systemTheme)
    } else {
      root.classList.remove('light', 'dark')
      root.classList.add(theme)
    }
  }

  const handleThemeChange = (theme: Theme) => {
    setSettings({ ...settings, theme })
    applyTheme(theme)
    // Save to localStorage for immediate persistence
    localStorage.setItem('theme', theme)
  }

  const handleSaveSettings = async () => {
    if (!user) return
    
    setIsSaving(true)
    const supabase = createClient()

    try {
      const { error } = await supabase
        .from('user_settings')
        .upsert({
          user_id: user.id,
          theme: settings.theme,
          auto_mode_default: settings.auto_mode_default,
          save_prompt_history: settings.save_prompt_history,
          notifications_email: settings.notifications_email,
          notifications_browser: settings.notifications_browser,
          openai_api_key: settings.openai_api_key || null,
          replicate_api_key: settings.replicate_api_key || null,
          nanobanana_api_key: settings.nanobanana_api_key || null,
          nanobanana_base_url: settings.nanobanana_base_url || 'https://api.nanobananaapi.ai/api/v1/nanobanana/generate',
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
    } catch (error) {
      console.error('Erro ao salvar configurações:', error)
      toast({
        title: 'Erro',
        description: 'Não foi possível salvar as configurações.',
        variant: 'destructive',
      })
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <>
        <Header title="Configurações" />
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </>
    )
  }

  return (
    <>
      <Header title="Configurações" />
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-3xl">
          <Tabs defaultValue="profile" className="space-y-6">
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="profile" className="gap-2">
                <User className="h-4 w-4" />
                <span className="hidden sm:inline">Perfil</span>
              </TabsTrigger>
              <TabsTrigger value="appearance" className="gap-2">
                <Palette className="h-4 w-4" />
                <span className="hidden sm:inline">Aparência</span>
              </TabsTrigger>
              <TabsTrigger value="automation" className="gap-2">
                <Zap className="h-4 w-4" />
                <span className="hidden sm:inline">Automação</span>
              </TabsTrigger>
              <TabsTrigger value="notifications" className="gap-2">
                <Bell className="h-4 w-4" />
                <span className="hidden sm:inline">Notificações</span>
              </TabsTrigger>
              <TabsTrigger value="api" className="gap-2">
                <Key className="h-4 w-4" />
                <span className="hidden sm:inline">API</span>
              </TabsTrigger>
            </TabsList>

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
                    <div className="grid grid-cols-3 gap-3">
                      <Button
                        variant={settings.theme === 'light' ? 'default' : 'outline'}
                        className="h-auto flex-col gap-2 py-4"
                        onClick={() => handleThemeChange('light')}
                      >
                        <Sun className="h-5 w-5" />
                        <span className="text-xs">Claro</span>
                        {settings.theme === 'light' && (
                          <Check className="absolute right-2 top-2 h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant={settings.theme === 'dark' ? 'default' : 'outline'}
                        className="h-auto flex-col gap-2 py-4"
                        onClick={() => handleThemeChange('dark')}
                      >
                        <Moon className="h-5 w-5" />
                        <span className="text-xs">Escuro</span>
                        {settings.theme === 'dark' && (
                          <Check className="absolute right-2 top-2 h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant={settings.theme === 'system' ? 'default' : 'outline'}
                        className="h-auto flex-col gap-2 py-4"
                        onClick={() => handleThemeChange('system')}
                      >
                        <Monitor className="h-5 w-5" />
                        <span className="text-xs">Sistema</span>
                        {settings.theme === 'system' && (
                          <Check className="absolute right-2 top-2 h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Modo Automático Padrão</Label>
                      <p className="text-sm text-muted-foreground">
                        Ativar modo automático por padrão na geração de imagens
                      </p>
                    </div>
                    <Switch
                      checked={settings.auto_mode_default}
                      onCheckedChange={(checked) =>
                        setSettings({ ...settings, auto_mode_default: checked })
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Salvar Histórico de Prompts</Label>
                      <p className="text-sm text-muted-foreground">
                        Manter histórico de todos os prompts gerados
                      </p>
                    </div>
                    <Switch
                      checked={settings.save_prompt_history}
                      onCheckedChange={(checked) =>
                        setSettings({ ...settings, save_prompt_history: checked })
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
                      <strong>Modo Manual:</strong> Você escreve a descrição, gera o prompt, revisa/edita, e depois escolhe o modelo para criar a imagem.
                    </p>
                    <p className="mt-2 text-sm text-amber-200/80">
                      <strong>Modo Automático:</strong> Você escreve a descrição e o sistema gera o prompt e a imagem automaticamente.
                    </p>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Ativar Automação</Label>
                      <p className="text-sm text-muted-foreground">
                        Gerar prompt e imagem automaticamente ao clicar
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
                      Usado no modo automático para gerar imagens
                    </p>
                    <RadioGroup
                      value={settings.default_image_model || 'gpt-image-2'}
                      onValueChange={(value: 'gpt-image-2' | 'gpt-image-1.5' | 'gpt-image-1' | 'gpt-image-1-mini' | 'nanobanana-v1' | 'nanobanana-v2') =>
                        setSettings({ ...settings, default_image_model: value })
                      }
                      className="flex flex-col gap-3"
                    >
                      <div className="flex items-center space-x-3 rounded-lg border border-border/50 p-3">
                        <RadioGroupItem value="gpt-image-2" id="model-gpt-image-2" />
                        <Label htmlFor="model-gpt-image-2" className="flex-1 cursor-pointer">
                          <span className="font-medium">GPT Image 2</span>
                          <p className="text-sm text-muted-foreground">
                            DALL-E para geração de imagens
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
                        <RadioGroupItem value="nanobanana-v1" id="model-nb-v1" />
                        <Label htmlFor="model-nb-v1" className="flex-1 cursor-pointer">
                          <span className="font-medium">NanoBanana V1</span>
                          <p className="text-sm text-muted-foreground">
                            Modelo estável NanoBanana
                          </p>
                        </Label>
                      </div>
                      <div className="flex items-center space-x-3 rounded-lg border border-border/50 p-3">
                        <RadioGroupItem value="nanobanana-v2" id="model-nb-v2" />
                        <Label htmlFor="model-nb-v2" className="flex-1 cursor-pointer">
                          <span className="font-medium">NanoBanana V2</span>
                          <p className="text-sm text-muted-foreground">
                            Modelo mais recente com melhorias
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
                        O avaliador analisa as imagens geradas com base no seu <strong>style profile</strong> do projeto e sugere melhorias automaticamente.
                      </p>
                    </div>

                    <div className="flex items-center justify-between">
                      <div>
                        <Label>Ativar Avaliador</Label>
                        <p className="text-sm text-muted-foreground">
                          Avaliar imagens automaticamente após geração
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
                          value={[settings.max_refinement_iterations || 2]}
                          onValueChange={([value]) =>
                            setSettings({ ...settings, max_refinement_iterations: value })
                          }
                          min={0}
                          max={3}
                          step={1}
                          className="py-2"
                        />
                        <p className="text-xs text-muted-foreground">
                          Número de tentativas automáticas para melhorar a imagem (0 = apenas avaliação, sem refinamento automático)
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
                  <CardTitle>Chaves de API</CardTitle>
                  <CardDescription>
                    Configure suas chaves de API para integrações externas
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-4">
                    <p className="text-sm text-violet-200/80">
                      <strong>Dica:</strong> Adicione sua chave da OpenAI para usar IA real na geração de prompts. 
                      Sem a chave, o sistema usará simulação local.
                    </p>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="openai-key">OpenAI API Key</Label>
                    <div className="relative">
                      <Input
                        id="openai-key"
                        type={showOpenAIKey ? 'text' : 'password'}
                        placeholder="sk-..."
                        value={settings.openai_api_key || ''}
                        onChange={(e) => setSettings({ ...settings, openai_api_key: e.target.value })}
                        className="bg-background/50 pr-10"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2"
                        onClick={() => setShowOpenAIKey(!showOpenAIKey)}
                      >
                        {showOpenAIKey ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Usada para geração de prompts otimizados via GPT
                    </p>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="replicate-key">Replicate API Key (opcional)</Label>
                    <div className="relative">
                      <Input
                        id="replicate-key"
                        type={showReplicateKey ? 'text' : 'password'}
                        placeholder="r8_..."
                        value={settings.replicate_api_key || ''}
                        onChange={(e) => setSettings({ ...settings, replicate_api_key: e.target.value })}
                        className="bg-background/50 pr-10"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2"
                        onClick={() => setShowReplicateKey(!showReplicateKey)}
                      >
                        {showReplicateKey ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Usada para geração de imagens via Replicate (futuro)
                    </p>
                  </div>

                  {/* NanoBanana Section */}
                  <div className="space-y-4 rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-4">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-5 w-5 text-cyan-400" />
                      <h4 className="font-medium text-cyan-200">NanoBanana (Gemini Flash Image)</h4>
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="nanobanana-key">NanoBanana API Key</Label>
                      <div className="relative">
                        <Input
                          id="nanobanana-key"
                          type={showNanoBananaKey ? 'text' : 'password'}
                          placeholder="nb_..."
                          value={settings.nanobanana_api_key || ''}
                          onChange={(e) => setSettings({ ...settings, nanobanana_api_key: e.target.value })}
                          className="bg-background/50 pr-10"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2"
                          onClick={() => setShowNanoBananaKey(!showNanoBananaKey)}
                        >
                          {showNanoBananaKey ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="nanobanana-url">Base URL (opcional)</Label>
                      <Input
                        id="nanobanana-url"
                        type="text"
                        placeholder="https://nanobananapi.ai/api/v1/nanobanana/generate"
                        value={settings.nanobanana_base_url || ''}
                        onChange={(e) => setSettings({ ...settings, nanobanana_base_url: e.target.value })}
                        className="bg-background/50"
                      />
                      <p className="text-xs text-muted-foreground">
                        URL personalizada (deixe em branco para usar o padrão)
                      </p>
                    </div>

                    <p className="text-xs text-cyan-300/70">
                      Para testar a API, vá em Imagens e use o botão &quot;Gerar Imagem (NanoBanana)&quot;.
                    </p>
                  </div>

                  <Button onClick={handleSaveSettings} disabled={isSaving} className="w-full">
                    {isSaving ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-2 h-4 w-4" />
                    )}
                    Salvar Chaves de API
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </>
  )
}
