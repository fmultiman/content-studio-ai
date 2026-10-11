// AI Integration - Uses OpenAI when available, falls back to simulation
// Prepared for future evolution: intelligent loop, webhook integration, advanced agents

import type { ProjectIdentity } from './schemas/project-identity'
import { buildImageGenerationContext } from './context-compiler'

// =============================================================================
// TYPES & INTERFACES
// =============================================================================

export interface PromptGenerationResult {
  prompt: string
  style: string
  /** null when the model output contains no extractable lighting reference (OpenAI path only). */
  lighting: string | null
  /** null when the model output contains no extractable composition reference (OpenAI path only). */
  composition: string | null
}

export type PromptGenerationErrorCode =
  | 'PROMPT_PROVIDER_NOT_CONFIGURED'
  | 'PROMPT_PROVIDER_FAILED'
  | 'PROMPT_PROVIDER_INVALID_RESPONSE'

export class PromptGenerationError extends Error {
  readonly code: PromptGenerationErrorCode
  readonly status?: number

  constructor(code: PromptGenerationErrorCode, message: string, status?: number) {
    super(message)
    this.name = 'PromptGenerationError'
    this.code = code
    this.status = status
  }
}

type EvaluationMode = 'default' | 'conceptual' | 'aesthetic' | 'commercial' | 'experimental'

// Prepared for intelligent loop (future implementation)
export interface GenerationAttempt {
  attemptNumber: number
  prompt: string
  result?: string
  feedback?: string
  timestamp: Date
}

// Prepared for webhook integration (n8n, external APIs)
export interface WebhookPayload {
  action: 'generate_prompt' | 'generate_image' | 'evaluate_result'
  input: string
  context?: string
  evaluationMode?: EvaluationMode
  retryCount?: number
  metadata?: Record<string, unknown>
}

// Prepared for generation context
export interface GenerationContext {
  userInput: string
  projectContext?: string | null
  evaluationMode?: EvaluationMode
  intention?: string
  retryCount?: number
  previousAttempts?: GenerationAttempt[]
}

// Image generation result
export interface ImageGenerationResult {
  imageUrl: string
  provider: 'nanobanana' | 'replicate' | 'simulation'
}

// Prepared for multi-provider image generation
export interface ImageGenerationOptions {
  provider: 'nanobanana' | 'replicate' | 'simulation'
  prompt: string
  apiKey?: string
  baseUrl?: string
}

// Simulated delay to mimic API call
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// Keyword mappings for prompt enhancement (used in fallback)
const styleKeywords: Record<string, string> = {
  cyberpunk: 'neon-lit cyberpunk aesthetic, blade runner style, rain-soaked streets',
  fantasy: 'ethereal fantasy atmosphere, magical lighting, mystical elements',
  futurista: 'futuristic sci-fi setting, sleek metallic surfaces, holographic elements',
  natureza: 'natural environment, organic textures, golden hour lighting',
  retro: 'vintage retro aesthetic, film grain, nostalgic color grading',
  minimalista: 'minimalist composition, clean lines, negative space',
  cinematico: 'cinematic wide shot, dramatic lighting, film-like quality',
  anime: 'anime art style, vibrant colors, expressive character design',
}

const lightingOptions = [
  'dramatic rim lighting with soft fill',
  'golden hour sunlight with warm tones',
  'moody atmospheric fog with volumetric rays',
  'neon-lit environment with color reflections',
  'soft diffused studio lighting',
  'harsh contrast chiaroscuro lighting',
  'bioluminescent ambient glow',
  'cinematic three-point lighting setup',
]

const compositionOptions = [
  'rule of thirds composition',
  'symmetrical centered framing',
  'dynamic diagonal lines',
  'leading lines drawing focus',
  'depth through foreground elements',
  'wide establishing shot',
  'intimate close-up perspective',
  'bird\'s eye view angle',
]

const qualityEnhancements = [
  '8k resolution',
  'ultra detailed',
  'photorealistic rendering',
  'ray tracing',
  'octane render',
  'unreal engine 5 quality',
  'professional photography',
  'award-winning composition',
]

function detectStyle(input: string): string {
  const lowerInput = input.toLowerCase()
  for (const [key, value] of Object.entries(styleKeywords)) {
    if (lowerInput.includes(key)) {
      return value
    }
  }
  return 'cinematic style, professional quality'
}

function getRandomElement<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)]
}

// Translations for common Portuguese terms
const translations: Record<string, string> = {
  'gato': 'cat',
  'cachorro': 'dog',
  'cidade': 'city',
  'floresta': 'forest',
  'montanha': 'mountain',
  'praia': 'beach',
  'noite': 'night',
  'dia': 'day',
  'pessoa': 'person',
  'mulher': 'woman',
  'homem': 'man',
  'criança': 'child',
  'carro': 'car',
  'casa': 'house',
  'céu': 'sky',
  'lua': 'moon',
  'sol': 'sun',
  'água': 'water',
  'fogo': 'fire',
  'robô': 'robot',
  'dragão': 'dragon',
}

function translateToEnglish(text: string): string {
  let translated = text
  for (const [pt, en] of Object.entries(translations)) {
    translated = translated.replace(new RegExp(pt, 'gi'), en)
  }
  return translated
}

// Generate prompt using OpenAI API
async function generateWithOpenAI(
  userInput: string,
  projectContext?: string | null,
  apiKey?: string,
  evaluationMode: EvaluationMode = 'default',
  identity: ProjectIdentity | null = null,
): Promise<PromptGenerationResult> {
  if (!apiKey) {
    throw new PromptGenerationError(
      'PROMPT_PROVIDER_NOT_CONFIGURED',
      'A geração de prompts precisa de um provedor de IA configurado. Configure sua chave da OpenAI em Configurações e tente novamente.',
    )
  }

  try {
    const systemPrompt = `You generate production-ready prompts for image generation models.

Use the user's intent, the Project context, the normalized Project Identity, restrictions, and generation preferences as internal guidance.

Output contract:
- Return only the final image-generation prompt in English.
- Do not expose internal context, headings, metadata, labels, markdown, JSON, or reasoning.
- Do not include phrases such as "grounded in this context".
- Incorporate Project Identity semantically; do not copy the identity block literally.
- Preserve the user's visual intention.
- Respect explicit restrictions over generic defaults or style preferences.
- Do not add random visual presets that contradict the Project restrictions.
- Avoid repetition and generic AI cliches.

Mode guidance:
- conceptual: symbolic, layered meaning, non-literal visual interpretation.
- aesthetic: refined visual harmony, controlled lighting, balanced composition.
- commercial: clear main subject, immediate visual readability, strong communication.
- experimental: original structure, creative risk, unexpected but coherent visual choices.
- default: balance concept, visual clarity, coherent composition, and atmosphere.`

    const compiledContext = buildImageGenerationContext({
      context: projectContext,
      identity,
    })

    const userMessage = `INPUTS RECEBIDOS

userInput:
${userInput}

PROJECT CONTEXT AND IDENTITY:
${compiledContext || 'Not specified'}

evaluation_mode:
${evaluationMode}`

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        max_tokens: 500,
        temperature: 0.7,
      }),
    })

    if (!response.ok) {
      console.error('[Prompt Generation] OpenAI API error:', response.status)
      throw new PromptGenerationError(
        'PROMPT_PROVIDER_FAILED',
        'Não foi possível gerar o prompt agora. Verifique a configuração do provedor ou tente novamente.',
        response.status,
      )
    }

    const data = await response.json()
    const generatedPrompt = data.choices?.[0]?.message?.content?.trim()

    if (!generatedPrompt) {
      throw new PromptGenerationError(
        'PROMPT_PROVIDER_INVALID_RESPONSE',
        'O provedor de IA não retornou um prompt válido. Tente novamente.',
      )
    }

    // lighting and composition are extracted from the actual model output only; no random fallback.
    const style = identity?.expression?.visual_identity || detectStyle(userInput)
    const lighting = generatedPrompt.match(/lighting[^,.]*/i)?.[0] ?? null
    const composition = generatedPrompt.match(/composition[^,.]*/i)?.[0] ?? null

    return {
      prompt: generatedPrompt,
      style,
      lighting,
      composition,
    }
  } catch (error) {
    if (error instanceof PromptGenerationError) {
      throw error
    }

    console.error('[Prompt Generation] OpenAI request failed:', error)
    throw new PromptGenerationError(
      'PROMPT_PROVIDER_FAILED',
      'Não foi possível gerar o prompt agora. Verifique a configuração do provedor ou tente novamente.',
    )
  }
}

// Fallback simulation when no API key is available
function getModeGuidance(evaluationMode: EvaluationMode) {
  const guidance: Record<EvaluationMode, string> = {
    conceptual: 'symbolic, layered meaning, tension between elements, abstract system transformation, non-literal interpretation',
    aesthetic: 'refined visual harmony, elegant composition, controlled lighting, balanced color palette, polished art direction',
    commercial: 'clear main subject, immediate visual impact, strong readable message, attention-grabbing composition, social media appeal',
    experimental: 'unexpected visual structure, original abstraction, unconventional composition, surprising material contrasts, creative risk',
    default: 'balanced concept, visual clarity, coherent composition, intentional atmosphere',
  }

  return guidance[evaluationMode]
}

export function generateSimulatedPromptForTest(
  userInput: string,
  projectContext?: string | null,
  evaluationMode: EvaluationMode = 'default',
  identity: ProjectIdentity | null = null,
): PromptGenerationResult {
  const compiledContext = buildImageGenerationContext({
    context: projectContext,
    identity,
  })
  const detectedStyle = identity?.expression?.visual_identity || detectStyle(userInput)
  const lighting = getRandomElement(lightingOptions)
  const composition = getRandomElement(compositionOptions)
  const modeGuidance = getModeGuidance(evaluationMode)
  const contextClause = compiledContext ? `, grounded in this context: ${compiledContext}` : ''

  const enhancedPrompt = `${userInput}${contextClause}, ${modeGuidance}, ${detectedStyle}, clear main subject, intentional environment, ${lighting}, ${composition}, specific visual details, avoid generic AI cliches`
  const translatedPrompt = translateToEnglish(enhancedPrompt)

  return {
    prompt: translatedPrompt,
    style: detectedStyle,
    lighting,
    composition,
  }
}

// Main function - tries OpenAI first, falls back to simulation
export async function generateImagePrompt(
  userInput: string,
  projectContext?: string | null,
  apiKey?: string,
  evaluationMode: EvaluationMode = 'default',
  identity: ProjectIdentity | null = null,
): Promise<PromptGenerationResult> {
  if (!apiKey) {
    throw new PromptGenerationError(
      'PROMPT_PROVIDER_NOT_CONFIGURED',
      'A geração de prompts precisa de um provedor de IA configurado. Configure sua chave da OpenAI em Configurações e tente novamente.',
    )
  }

  return generateWithOpenAI(userInput, projectContext, apiKey, evaluationMode, identity)
}

// Simulated image generation (returns placeholder URL)
export async function simulateImageGeneration(prompt: string): Promise<string> {
  await delay(2000)
  const seed = Math.floor(Math.random() * 1000)
  return `https://picsum.photos/seed/${seed}/1024/1024`
}

// =============================================================================
// NANOBANANA IMAGE GENERATION
// =============================================================================

/**
 * Generate image using NanoBanana API (Gemini Flash Image Preview)
 * 
 * API Endpoint: POST /api/v1/nanobanana/generate
 * Request body: { prompt, type: "TEXTTOIMAGE", numImages: 1, callBackUrl? }
 * 
 * @param prompt - The image prompt
 * @param apiKey - NanoBanana API key
 * @param baseUrl - NanoBanana base URL (default: https://api.nanobananaapi.ai)
 * @returns Image URL from the generated image
 */
export async function generateImageNanoBanana(
  prompt: string,
  apiKey: string,
  baseUrl: string = 'https://api.nanobananaapi.ai'
): Promise<ImageGenerationResult> {
  // Validate prompt
  if (!prompt || !prompt.trim()) {
    throw new Error('Prompt não enviado')
  }

  try {
    const response = await fetch(`${baseUrl}/api/v1/nanobanana/generate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: prompt,
        type: 'TEXTTOIMAGE',
        numImages: 1,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[v0] NanoBanana API error:', response.status, errorText)
      throw new Error(`Erro na API NanoBanana: ${response.status}`)
    }

    const data = await response.json()
    
    // Debug: log response structure
    console.log('[v0] NanoBanana response:', data)
    
    // Extract image URL from response
    // Response format may vary - handle multiple possible formats
    let imageUrl: string | null = null

    // Format 1: Direct image URL in response
    if (data.imageUrl) {
      imageUrl = data.imageUrl
    }
    
    // Format 2: Array of images
    if (!imageUrl && data.images && Array.isArray(data.images) && data.images.length > 0) {
      imageUrl = data.images[0].url || data.images[0]
    }
    
    // Format 3: Result object with URL
    if (!imageUrl && data.result?.url) {
      imageUrl = data.result.url
    }
    
    // Format 4: Data object with image
    if (!imageUrl && data.data?.image) {
      imageUrl = data.data.image
    }

    // Format 5: Base64 encoded image
    if (!imageUrl && data.base64) {
      imageUrl = `data:image/png;base64,${data.base64}`
    }

    // Format 6: Output array (common in some APIs)
    if (!imageUrl && data.output && Array.isArray(data.output) && data.output.length > 0) {
      imageUrl = data.output[0]
    }

    if (!imageUrl) {
      console.error('[v0] NanoBanana response structure:', JSON.stringify(data, null, 2))
      throw new Error('Resposta inválida da API')
    }
    
    return {
      imageUrl,
      provider: 'nanobanana',
    }
  } catch (error) {
    console.error('[v0] Error generating image with NanoBanana:', error)
    // Re-throw with better message if it's a generic error
    if (error instanceof Error) {
      throw error
    }
    throw new Error('Erro na API NanoBanana')
  }
}

/**
 * Multi-provider image generation (prepared for future expansion)
 * 
 * @param options - Generation options including provider and prompt
 * @returns Generated image result
 */
export async function generateImage(
  options: ImageGenerationOptions
): Promise<ImageGenerationResult> {
  switch (options.provider) {
    case 'nanobanana':
      if (!options.apiKey) {
        throw new Error('NanoBanana API key is required')
      }
      return generateImageNanoBanana(options.prompt, options.apiKey, options.baseUrl)
    
    case 'replicate':
      // Placeholder for Replicate integration
      throw new Error('Replicate integration not yet implemented')
    
    case 'simulation':
    default:
      const url = await simulateImageGeneration(options.prompt)
      return { imageUrl: url, provider: 'simulation' }
  }
}

// Video scene prompt generation
export async function generateScenePrompt(
  description: string,
  sceneNumber: number
): Promise<string> {
  await delay(800)
  
  const cameraMovements = [
    'slow dolly forward',
    'smooth pan left to right',
    'dramatic zoom in',
    'aerial drone shot descending',
    'tracking shot following subject',
    'static wide angle',
  ]

  const movement = getRandomElement(cameraMovements)
  
  return `Scene ${sceneNumber}: ${description}, ${movement}, cinematic motion blur, smooth 24fps, professional videography`
}

// =============================================================================
// FUTURE: INTELLIGENT LOOP (Not implemented - structure only)
// =============================================================================

/**
 * Intelligent generation loop structure (for future implementation)
 * Flow: generate → evaluate → improve → regenerate
 * 
 * @param context - Generation context with user input and settings
 * @param maxAttempts - Maximum number of generation attempts
 * @returns Final generation result
 */
export async function intelligentGenerationLoop(
  context: GenerationContext,
  maxAttempts: number = 3
): Promise<PromptGenerationResult> {
  // Placeholder for intelligent loop implementation
  // This will be expanded when integrating with evaluation models
  
  const attempts: GenerationAttempt[] = context.previousAttempts || []
  
  // For now, just use standard generation
  const result = await generateImagePrompt(
    context.userInput,
    context.projectContext,
    undefined,
    context.evaluationMode || 'default',
    null,
  )
  
  // Track attempt (for future use)
  attempts.push({
    attemptNumber: attempts.length + 1,
    prompt: result.prompt,
    timestamp: new Date(),
  })
  
  return result
}

// =============================================================================
// FUTURE: WEBHOOK INTEGRATION (Not implemented - structure only)
// =============================================================================

/**
 * Send payload to external webhook (n8n, Make, custom API)
 * Prepared for future integration
 * 
 * @param webhookUrl - Target webhook URL
 * @param payload - Webhook payload
 * @returns Response from webhook
 */
export async function sendToWebhook(
  webhookUrl: string,
  payload: WebhookPayload
): Promise<unknown> {
  // Placeholder for webhook integration
  // Will be implemented when connecting to n8n or external APIs
  
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...payload,
        timestamp: new Date().toISOString(),
        source: 'content-agent-studio',
      }),
    })
    
    if (!response.ok) {
      throw new Error(`Webhook error: ${response.status}`)
    }
    
    return response.json()
  } catch (error) {
    console.error('Webhook call failed:', error)
    throw error
  }
}

/**
 * Process response from external webhook
 * Prepared for future integration
 */
export function processWebhookResponse(response: unknown): PromptGenerationResult | null {
  // Placeholder for webhook response processing
  // Will be implemented based on webhook response format
  
  if (!response || typeof response !== 'object') return null
  
  const data = response as Record<string, unknown>
  
  if (typeof data.prompt === 'string') {
    return {
      prompt: data.prompt,
      style: (data.style as string) || 'generated',
      lighting: (data.lighting as string) || 'auto',
      composition: (data.composition as string) || 'auto',
    }
  }
  
  return null
}
