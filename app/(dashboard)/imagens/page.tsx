'use client'

import { useState, useEffect, Suspense, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/layout/header'
import { ImageInputSection } from '@/components/images/image-input-section'
import { PromptSection, type ImageModel } from '@/components/images/prompt-section'
import { ImageResult } from '@/components/images/image-result'
import { generateImagePrompt, regeneratePrompt } from '@/lib/ai-simulator'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { FileText, ChevronRight, Loader2 } from 'lucide-react'
import { GenerationHistory } from '@/components/images/generation-history'
import type { Project, Image as ImageType, ImageDraft, ImageEvaluation, GenerationAttempt } from '@/lib/types'
import { useToast } from '@/hooks/use-toast'

function ImagesPageContent() {
  const { toast } = useToast()
  const router = useRouter()
  const searchParams = useSearchParams()
  
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProject, setSelectedProject] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<ImageDraft[]>([])
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(null)
  
  // Input state
  const [userInput, setUserInput] = useState('')
  const [autoMode, setAutoMode] = useState(false)
  
  // Prompt state
  const [generatedPrompt, setGeneratedPrompt] = useState('')
  const [generatedPromptPt, setGeneratedPromptPt] = useState('')
  const [promptDetails, setPromptDetails] = useState<{
    style: string
    lighting: string
    composition: string
  } | null>(null)
  
  // Image state
  const [currentImage, setCurrentImage] = useState<ImageType | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imageStatus, setImageStatus] = useState<'draft' | 'generating' | 'approved' | 'rejected'>('draft')
  
  // Loading states
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false)
  const [isCreatingImage, setIsCreatingImage] = useState(false)
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [isApproving, setIsApproving] = useState(false)
  const [isSavingDraft, setIsSavingDraft] = useState(false)
  const [isLoadingDrafts, setIsLoadingDrafts] = useState(true)
  const [isDataReady, setIsDataReady] = useState(false)
  const [isTranslatingPrompt, setIsTranslatingPrompt] = useState(false)
  
  // API Key state
  const [openaiApiKey, setOpenaiApiKey] = useState<string | null>(null)
  const [nanobananaApiKey, setNanobananaApiKey] = useState<string | null>(null)
  const [isGeneratingNanoBanana, setIsGeneratingNanoBanana] = useState(false)
  const [automationEnabled, setAutomationEnabled] = useState(false)
  const [defaultImageModel, setDefaultImageModel] = useState<ImageModel>('gpt-image-2')
  const [selectedModel, setSelectedModel] = useState<ImageModel>('gpt-image-2')

  // Evaluator state
  const [evaluatorEnabled, setEvaluatorEnabled] = useState(false)
  const [maxRefinements, setMaxRefinements] = useState(2)
  const [isEvaluating, setIsEvaluating] = useState(false)
  const [currentEvaluation, setCurrentEvaluation] = useState<ImageEvaluation | null>(null)
  const [generationAttempts, setGenerationAttempts] = useState<GenerationAttempt[]>([])
  const [currentAttempt, setCurrentAttempt] = useState(1)

  // Refs para scroll automático
  const promptSectionRef = useRef<HTMLDivElement>(null)
  const resultSectionRef = useRef<HTMLDivElement>(null)

  const saveImageDraft = async () => {
    if (!userInput.trim() && !generatedPrompt.trim()) return null

    const draftName = userInput.split('\n')[0].trim().slice(0, 50) || 'Rascunho sem titulo'
    const response = await fetch('/api/image-drafts', {
      method: currentDraftId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: currentDraftId,
        name: draftName,
        projectId: selectedProject,
        userInput,
        generatedPrompt: generatedPrompt || null,
        generatedPromptPt: generatedPromptPt || null,
        autoMode,
        imageUrl,
        selectedModel,
      }),
    })
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Erro ao salvar rascunho')
    }

    return data.draft as ImageDraft
  }

  // Auto save do rascunho de imagem
  useEffect(() => {
    if (!isDataReady) return

    const autoSaveDraft = async () => {
      try {
        const draft = await saveImageDraft()

        if (draft) {
          setCurrentDraftId(draft.id)
          setDrafts((prev) => {
            const withoutCurrent = prev.filter((item) => item.id !== draft.id)
            return [draft, ...withoutCurrent].slice(0, 5)
          })
        }
      } catch (error) {
        console.error('[v0] Image auto-save error:', error)
      }
    }

    const timeoutId = window.setTimeout(autoSaveDraft, 800)

    const handleBeforeUnload = () => {
      autoSaveDraft()
    }

    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      window.clearTimeout(timeoutId)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [
    userInput,
    generatedPrompt,
    generatedPromptPt,
    selectedProject,
    autoMode,
    imageUrl,
    selectedModel,
    currentDraftId,
    isDataReady,
  ])

  // Fetch projects and drafts on mount
  useEffect(() => {
    const fetchData = async () => {
      const supabase = createClient()
      
      const { data: projectsData } = await supabase
        .from('projects')
        .select('*')
        .order('created_at', { ascending: false })
      
      if (projectsData) setProjects(projectsData)

      // Fetch user settings for API key
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: settingsData } = await supabase
          .from('user_settings')
          .select('openai_api_key, nanobanana_api_key, automation_enabled, default_image_model, image_evaluator_enabled, max_refinement_iterations')
          .eq('user_id', user.id)
          .single()
        
        if (settingsData?.openai_api_key) {
          setOpenaiApiKey(settingsData.openai_api_key)
        }
        if (settingsData?.nanobanana_api_key) {
          setNanobananaApiKey(settingsData.nanobanana_api_key)
        }
        setAutomationEnabled(settingsData?.automation_enabled ?? false)
        const model = normalizeImageModel(settingsData?.default_image_model)
        setDefaultImageModel(model)
        setSelectedModel(model)
        setEvaluatorEnabled(settingsData?.image_evaluator_enabled ?? false)
        setMaxRefinements(settingsData?.max_refinement_iterations ?? 2)
      }

      const draftsResponse = await fetch('/api/image-drafts?limit=5')
      const draftsPayload = await draftsResponse.json()

      if (draftsResponse.ok) {
        setDrafts(draftsPayload.drafts || [])
      } else {
        console.error('[v0] Image drafts load error:', draftsPayload)
      }
      setIsLoadingDrafts(false)

      // Load draft from URL if present
      const draftId = searchParams.get('draft')
      if (draftId) {
        const draftResponse = await fetch(`/api/image-drafts?id=${draftId}`)
        const draftPayload = await draftResponse.json()
        
        if (draftResponse.ok && draftPayload.draft) {
          const draftData = draftPayload.draft as ImageDraft
          setCurrentDraftId(draftData.id)
          setUserInput(draftData.user_input)
          setSelectedProject(draftData.project_id)
          setGeneratedPrompt(draftData.generated_prompt || '')
          setGeneratedPromptPt(draftData.generated_prompt_pt || '')
          setAutoMode(draftData.auto_mode)
          if (draftData.image_url) {
            setImageUrl(draftData.image_url)
            setImageStatus('draft')
          }
        } else if (!draftResponse.ok) {
          console.error('[v0] Image draft load error:', draftPayload)
        }
      }

      // Load project from URL if present
      const projectId = searchParams.get('project')
      if (projectId) {
        setSelectedProject(projectId)
      }
      setIsDataReady(true)
    }
    fetchData()
  }, [searchParams])

  // Save draft handler
  const handleSaveDraft = async () => {
    if (!userInput.trim() && !generatedPrompt.trim()) {
      toast({
        title: 'Conteudo obrigatorio',
        description: 'Por favor, insira uma descricao ou gere um prompt para salvar o rascunho.',
        variant: 'destructive',
      })
      return
    }

    setIsSavingDraft(true)

    try {
      const draft = await saveImageDraft()

      if (draft) {
        setCurrentDraftId(draft.id)
        setDrafts((prev) => {
          const withoutCurrent = prev.filter((item) => item.id !== draft.id)
          return [draft, ...withoutCurrent].slice(0, 5)
        })
      }

      toast({
        title: currentDraftId ? 'Rascunho atualizado!' : 'Rascunho salvo!',
        description: currentDraftId
          ? 'As alteracoes foram salvas.'
          : 'Voce pode continuar editando mais tarde.',
      })
    } catch (error) {
      console.error('[v0] Image draft save error:', error)
      toast({
        title: 'Erro',
        description: 'Nao foi possivel salvar o rascunho.',
        variant: 'destructive',
      })
    } finally {
      setIsSavingDraft(false)
    }
  }

  const loadDraft = (draft: ImageDraft) => {
    setCurrentDraftId(draft.id)
    setUserInput(draft.user_input)
    setSelectedProject(draft.project_id)
    setGeneratedPrompt(draft.generated_prompt || '')
    setGeneratedPromptPt(draft.generated_prompt_pt || '')
    setAutoMode(draft.auto_mode)
    if (draft.selected_model) {
      setSelectedModel(normalizeImageModel(draft.selected_model))
    }
    if (draft.image_url) {
      setImageUrl(draft.image_url)
      setImageStatus('draft')
    }

    toast({
      title: 'Rascunho carregado',
      description: 'O rascunho foi carregado para edição.',
    })
  }

  const clearForm = () => {
    setUserInput('')
    setGeneratedPrompt('')
    setGeneratedPromptPt('')
    setPromptDetails(null)
    setImageUrl(null)
    setCurrentImage(null)
    setSelectedProject(null)
    setCurrentDraftId(null)
    setAutoMode(false)
    setImageStatus('draft')
    // Reset evaluator state
    setCurrentEvaluation(null)
    setGenerationAttempts([])
    setCurrentAttempt(1)
  }

  const updateGeneratedPrompt = (prompt: string) => {
    setGeneratedPrompt(prompt)
    setGeneratedPromptPt('')
  }

  const handleTranslatePrompt = async () => {
    if (!generatedPrompt.trim() || isTranslatingPrompt) return

    setIsTranslatingPrompt(true)

    try {
      const response = await fetch('/api/prompts/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: generatedPrompt }),
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Erro ao traduzir prompt')
      }

      setGeneratedPromptPt(data.translatedPrompt)
    } catch (error) {
      toast({
        title: 'Erro na traducao',
        description: error instanceof Error ? error.message : 'Nao foi possivel traduzir o prompt.',
        variant: 'destructive',
      })
    } finally {
      setIsTranslatingPrompt(false)
    }
  }

  const normalizeImageModel = (model: string | null | undefined): ImageModel => {
    if (
      model === 'gpt-image-2' ||
      model === 'gpt-image-1.5' ||
      model === 'gpt-image-1' ||
      model === 'gpt-image-1-mini' ||
      model === 'nanobanana-v1' ||
      model === 'nanobanana-v2'
    ) {
      return model
    }

    return 'gpt-image-2'
  }

  const isOpenAIImageModel = (model: ImageModel) =>
    model === 'gpt-image-2' ||
    model === 'gpt-image-1.5' ||
    model === 'gpt-image-1' ||
    model === 'gpt-image-1-mini'

  // Evaluate image with AI
  const handleEvaluateImage = async () => {
    if (!imageUrl || !generatedPrompt) return

    setIsEvaluating(true)

    try {
      // Get project context and style profile
      const selectedProjectData = projects.find(p => p.id === selectedProject)
      
      const response = await fetch('/api/evaluate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userInput,
          generatedPrompt,
          imageUrl,
          projectId: selectedProject,
          styleProfile: selectedProjectData?.style_profile || null,
          context: selectedProjectData?.context || null,
          attempt: currentAttempt,
        }),
      })

      const evaluation = await response.json()

      if (!response.ok) {
        throw new Error(evaluation.error || 'Erro na avaliação')
      }

      setCurrentEvaluation(evaluation)

      // Add to history
      const attemptRecord: GenerationAttempt = {
        id: `attempt-${Date.now()}`,
        attempt: currentAttempt,
        prompt: generatedPrompt,
        imageUrl,
        model: selectedModel,
        evaluation,
        timestamp: new Date().toISOString(),
      }
      setGenerationAttempts(prev => [...prev, attemptRecord])

      toast({
        title: evaluation.approved ? 'Imagem aprovada!' : 'Sugestões de melhoria',
        description: evaluation.feedback,
      })

      // Scroll to result
      setTimeout(() => {
        resultSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 100)

    } catch (error) {
      console.error('[v0] Evaluation error:', error)
      toast({
        title: 'Erro na avaliação',
        description: error instanceof Error ? error.message : 'Erro desconhecido',
        variant: 'destructive',
      })
    } finally {
      setIsEvaluating(false)
    }
  }

  // Use refined prompt from evaluation
  const handleUseRefinedPrompt = (refinedPrompt: string) => {
    updateGeneratedPrompt(refinedPrompt)
    setCurrentEvaluation(null)
    setCurrentAttempt(prev => prev + 1)
    
    toast({
      title: 'Prompt atualizado',
      description: 'O prompt refinado foi aplicado. Clique em "Criar Imagem" para gerar.',
    })

    // Scroll to prompt section
    setTimeout(() => {
      promptSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 100)
  }

  // Unified image creation handler
  const handleCreateImageWithModel = async (model: ImageModel) => {
    if (isOpenAIImageModel(model)) {
      await handleCreateImage(undefined, model)
    } else {
      // NanoBanana V1 or V2
      await handleGenerateNanoBanana(model)
    }
  }

  const generateOpenAIImage = async (prompt: string, model: ImageModel) => {
    const response = await fetch('/api/openai/generate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        model,
        size: '1024x1024',
        quality: 'medium',
      }),
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Erro na API da OpenAI')
    }

    if (!data.imageUrl) {
      throw new Error('A OpenAI nao retornou uma imagem')
    }

    return data.imageUrl as string
  }

  // Generate image with NanoBanana (via server route for security)
  const handleGenerateNanoBanana = async (
    model: ImageModel = selectedModel,
    promptOverride?: string,
  ) => {
    // Usar generatedPrompt se disponível, senão userInput como fallback
    const promptToUse = promptOverride?.trim() || generatedPrompt.trim() || userInput.trim()
    
    if (!promptToUse) {
      toast({
        title: 'Prompt obrigatório',
        description: 'Digite uma descrição ou gere um prompt antes de criar a imagem.',
        variant: 'destructive',
      })
      return
    }

    if (!nanobananaApiKey) {
      toast({
        title: 'API Key não configurada',
        description: 'Configure sua API Key do NanoBanana em Configurações > API.',
        variant: 'destructive',
      })
      return
    }

    setIsGeneratingNanoBanana(true)
    setImageStatus('generating')

    try {
      // Determinar versão do modelo
      const modelVersion = model === 'nanobanana-v2' ? 'v2' : 'v1'
      
      // 1. Enviar requisição para gerar (retorna taskId)
      const response = await fetch('/api/nanobanana/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: promptToUse,
          aspectRatio: '1:1',
          projectId: selectedProject,
          model: modelVersion,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Erro na API NanoBanana')
      }

      const taskId = data.taskId
      if (!taskId) {
        throw new Error('TaskId não retornado')
      }

      toast({
        title: 'Gerando imagem...',
        description: 'Aguarde enquanto a imagem é processada.',
      })

      // 2. Polling para verificar status
      const maxAttempts = 60 // 5 minutos (60 x 5s)
      let attempts = 0

      const pollStatus = async (): Promise<void> => {
        attempts++
        
        const statusRes = await fetch(`/api/nanobanana/status/${taskId}`)
        const statusData = await statusRes.json()

        if (statusData.status === 'completed' && statusData.imageUrl) {
          const supabase = createClient()
          const { data: { user } } = await supabase.auth.getUser()

          if (user) {
            if (currentImage) {
              const { data: updatedImage } = await supabase
                .from('images')
                .update({
                  project_id: selectedProject,
                  user_input: userInput,
                  generated_prompt: promptToUse,
                  image_url: statusData.imageUrl,
                  status: 'draft',
                  model,
                })
                .eq('id', currentImage.id)
                .select()
                .single()

              if (updatedImage) setCurrentImage(updatedImage)
            } else {
              const { data: savedImage } = await supabase
                .from('images')
                .insert({
                  user_id: user.id,
                  project_id: selectedProject,
                  user_input: userInput,
                  generated_prompt: promptToUse,
                  image_url: statusData.imageUrl,
                  status: 'draft',
                  model,
                })
                .select()
                .single()

              if (savedImage) setCurrentImage(savedImage)
            }
          }

          setImageUrl(statusData.imageUrl)
          setImageStatus('draft')
          setIsGeneratingNanoBanana(false)
          toast({
            title: 'Imagem gerada!',
            description: 'Sua imagem foi criada com sucesso.',
          })
          // Scroll automático para o resultado
          setTimeout(() => {
            resultSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }, 100)
          return
        }

        if (statusData.status === 'failed') {
          throw new Error(statusData.errorMessage || 'Erro na geração')
        }

        if (attempts >= maxAttempts) {
          throw new Error('Tempo limite excedido')
        }

        // Continuar polling
        await new Promise(resolve => setTimeout(resolve, 5000))
        return pollStatus()
      }

      await pollStatus()

    } catch (error) {
      console.error('[v0] NanoBanana generation error:', error)
      setImageStatus('draft')
      setIsGeneratingNanoBanana(false)
      toast({
        title: 'Erro na geração',
        description: error instanceof Error ? error.message : 'Erro na API NanoBanana',
        variant: 'destructive',
      })
    }
  }

  // Generate prompt handler
  const handleGeneratePrompt = async () => {
    if (!userInput.trim()) return

    setIsGeneratingPrompt(true)

    try {
      // Get project context and style profile if selected
      let projectContext: string | null = null
      let styleProfile: string | null = null
      
      if (selectedProject) {
        const project = projects.find(p => p.id === selectedProject)
        if (project) {
          projectContext = project.context
          styleProfile = project.style_profile
        }
      }

      const result = await generateImagePrompt(
        userInput,
        projectContext,
        styleProfile,
        openaiApiKey || undefined
      )
      
      updateGeneratedPrompt(result.prompt)
      setPromptDetails({
        style: result.style,
        lighting: result.lighting,
        composition: result.composition,
      })

      // Save prompt to database
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      
      if (user) {
        await supabase.from('prompts').insert({
          user_id: user.id,
          original_input: userInput,
          generated_prompt: result.prompt,
          type: 'image',
        })
      }

      toast({
        title: 'Prompt gerado!',
        description: 'O prompt foi criado com sucesso. Você pode editá-lo antes de criar a imagem.',
      })

      // Scroll automático para a seção do prompt
      setTimeout(() => {
        promptSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 100)

      // If auto mode AND automation enabled, automatically create image with default model
      if (autoMode && automationEnabled) {
        await handleCreateImageWithModel(defaultImageModel)
      } else if (autoMode) {
        await handleCreateImage(result.prompt, selectedModel)
      }
    } catch (error) {
      toast({
        title: 'Erro',
        description: 'Não foi possível gerar o prompt. Tente novamente.',
        variant: 'destructive',
      })
    } finally {
      setIsGeneratingPrompt(false)
    }
  }

  // Create image handler
  const handleCreateImage = async (
    promptOverride?: string,
    model: ImageModel = selectedModel,
  ) => {
    const prompt = promptOverride || generatedPrompt
    if (!prompt.trim()) return

    setIsCreatingImage(true)
    setImageStatus('generating')

    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) throw new Error('Usuário não autenticado')

      // Create image record in database
      const { data: imageData, error: insertError } = await supabase
        .from('images')
        .insert({
          user_id: user.id,
          project_id: selectedProject,
          user_input: userInput,
          generated_prompt: prompt,
          status: 'generating',
          model,
        })
        .select()
        .single()

      if (insertError) throw insertError

      // Generate image with OpenAI through the server route, keeping the API key private.
      const generatedUrl = await generateOpenAIImage(prompt, model)
      
      // Update record with generated URL
      const { data: updatedImage } = await supabase
        .from('images')
        .update({
          image_url: generatedUrl,
          status: 'draft',
        })
        .eq('id', imageData.id)
        .select()
        .single()

      setCurrentImage(updatedImage)
      setImageUrl(generatedUrl)
      setImageStatus('draft')

      toast({
        title: 'Imagem criada!',
        description: 'A imagem foi gerada com sucesso.',
      })
    } catch (error) {
      setImageStatus('draft')
      toast({
        title: 'Erro',
        description: error instanceof Error ? error.message : 'Nao foi possivel criar a imagem. Tente novamente.',
        variant: 'destructive',
      })
    } finally {
      setIsCreatingImage(false)
    }
  }

  // Regenerate handler
  const handleRegenerate = async () => {
    setIsRegenerating(true)
    setImageStatus('generating')

    try {
      // Regenerate prompt with variations
      const result = await regeneratePrompt(generatedPrompt)
      updateGeneratedPrompt(result.prompt)
      setPromptDetails({
        style: result.style,
        lighting: result.lighting,
        composition: result.composition,
      })

      // Generate new image
      if (!isOpenAIImageModel(selectedModel)) {
        await handleGenerateNanoBanana(selectedModel, result.prompt)
        return
      }

      const generatedUrl = await generateOpenAIImage(result.prompt, selectedModel)
      
      // Update database if we have a current image
      if (currentImage) {
        const supabase = createClient()
        await supabase
          .from('images')
          .update({
            generated_prompt: result.prompt,
            image_url: generatedUrl,
            status: 'draft',
            model: selectedModel,
          })
          .eq('id', currentImage.id)
      }

      setImageUrl(generatedUrl)
      setImageStatus('draft')

      toast({
        title: 'Imagem regenerada!',
        description: 'Uma nova variação foi criada.',
      })
    } catch (error) {
      setImageStatus('draft')
      toast({
        title: 'Erro',
        description: error instanceof Error ? error.message : 'Nao foi possivel regenerar a imagem. Tente novamente.',
        variant: 'destructive',
      })
    } finally {
      setIsRegenerating(false)
    }
  }

  // Approve handler
  const handleApprove = async () => {
    if (!imageUrl) return

    setIsApproving(true)

    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) throw new Error('UsuÃ¡rio nÃ£o autenticado')

      if (currentImage) {
        const { data: approvedImage } = await supabase
          .from('images')
          .update({ status: 'approved' })
          .eq('id', currentImage.id)
          .select()
          .single()

        if (approvedImage) setCurrentImage(approvedImage)
      } else {
        const { data: approvedImage } = await supabase
          .from('images')
          .insert({
            user_id: user.id,
            project_id: selectedProject,
            user_input: userInput,
            generated_prompt: generatedPrompt || null,
            image_url: imageUrl,
            status: 'approved',
            model: selectedModel,
          })
          .select()
          .single()

        if (approvedImage) setCurrentImage(approvedImage)
      }

      setImageStatus('approved')

      toast({
        title: 'Imagem aprovada!',
        description: 'A imagem foi marcada como aprovada e salva na galeria.',
      })
    } catch (error) {
      toast({
        title: 'Erro',
        description: 'Não foi possível aprovar a imagem. Tente novamente.',
        variant: 'destructive',
      })
    } finally {
      setIsApproving(false)
    }
  }

  return (
    <>
      <Header title="Geração de Imagens" />
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-4xl space-y-6">
          {/* Drafts Section */}
          {!isLoadingDrafts && drafts.length > 0 && (
            <Card className="border-border/50 bg-card/30 backdrop-blur-sm">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="h-5 w-5 text-muted-foreground" />
                    <CardTitle className="text-base">Rascunhos</CardTitle>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {drafts.length}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => router.push('/imagens/rascunhos')}
                    className="gap-1 text-sm"
                  >
                    Ver todos
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {drafts.slice(0, 3).map((draft) => (
                    <button
                      key={draft.id}
                      onClick={() => loadDraft(draft)}
                      className="flex min-w-[180px] flex-col rounded-lg border border-border/50 bg-background/50 p-3 text-left transition-colors hover:bg-background/80"
                    >
                      <span className="font-medium text-foreground line-clamp-1">
                        {draft.name || draft.user_input.split('\n')[0].slice(0, 30)}
                      </span>
                      <span className="mt-1 text-xs text-muted-foreground line-clamp-1">
                        {draft.generated_prompt ? 'Prompt gerado' : 'Sem prompt'}
                      </span>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Current Draft Indicator */}
          {currentDraftId && (
            <div className="flex items-center justify-between rounded-lg border border-violet-500/30 bg-violet-500/10 px-4 py-2">
              <span className="text-sm text-violet-300">
                Editando rascunho
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearForm}
                className="text-violet-300 hover:text-violet-200"
              >
                Limpar e criar novo
              </Button>
            </div>
          )}

          {/* Input Section */}
          <ImageInputSection
            projects={projects}
            userInput={userInput}
            setUserInput={setUserInput}
            selectedProject={selectedProject}
            setSelectedProject={setSelectedProject}
            autoMode={autoMode}
            setAutoMode={setAutoMode}
            onGeneratePrompt={handleGeneratePrompt}
            isGeneratingPrompt={isGeneratingPrompt}
            onSaveDraft={handleSaveDraft}
            isSavingDraft={isSavingDraft}
            generatedPrompt={generatedPrompt}
            automationEnabled={automationEnabled}
          />

          {/* Prompt Section */}
          <div ref={promptSectionRef}>
            <PromptSection
              generatedPrompt={generatedPrompt}
              setGeneratedPrompt={updateGeneratedPrompt}
              generatedPromptPt={generatedPromptPt}
              onTranslatePrompt={handleTranslatePrompt}
              isTranslatingPrompt={isTranslatingPrompt}
              promptDetails={promptDetails}
              onCreateImage={handleCreateImageWithModel}
              isCreatingImage={isCreatingImage || isGeneratingNanoBanana}
              hasNanoBananaKey={!!nanobananaApiKey}
              automationEnabled={automationEnabled}
              selectedModel={selectedModel}
              onModelChange={setSelectedModel}
            />
          </div>

          {/* Image Result */}
          <div ref={resultSectionRef}>
            {imageUrl && (
              <ImageResult
                imageUrl={imageUrl}
                status={imageStatus}
                onRegenerate={handleRegenerate}
                onApprove={handleApprove}
                isRegenerating={isRegenerating}
                isApproving={isApproving}
                imageName={userInput.slice(0, 50)}
                evaluatorEnabled={evaluatorEnabled}
                evaluation={currentEvaluation}
                onEvaluate={handleEvaluateImage}
                isEvaluating={isEvaluating}
                onUseRefinedPrompt={handleUseRefinedPrompt}
              />
            )}
          </div>

          {/* Generation History */}
          {generationAttempts.length > 0 && (
            <GenerationHistory
              attempts={generationAttempts}
              onUsePrompt={handleUseRefinedPrompt}
            />
          )}
        </div>
      </div>
    </>
  )
}

export default function ImagesPage() {
  return (
    <Suspense fallback={
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    }>
      <ImagesPageContent />
    </Suspense>
  )
}
