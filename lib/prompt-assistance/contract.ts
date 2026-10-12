import { z } from 'zod'

export const PROMPT_ASSISTANCE_PROVIDERS = ['openai', 'gemini'] as const
export type PromptAssistanceProvider = (typeof PROMPT_ASSISTANCE_PROVIDERS)[number]

// Analytics label only (usage metadata). It never selects a provider, authorizes anything or affects billing.
export const PROMPT_ASSISTANCE_WORKFLOWS = ['assisted', 'automatic'] as const
export type PromptAssistanceWorkflow = (typeof PROMPT_ASSISTANCE_WORKFLOWS)[number]

export const PROMPT_ASSISTANCE_OPERATIONS = ['create', 'improve'] as const
export type PromptAssistanceOperation = (typeof PROMPT_ASSISTANCE_OPERATIONS)[number]

export const PROMPT_ASSISTANCE_VIDEO_MODES = ['text_to_video', 'image_to_video'] as const
export type PromptAssistanceVideoMode = (typeof PROMPT_ASSISTANCE_VIDEO_MODES)[number]

const sharedRequestFields = {
  projectId: z.string().uuid().nullable().optional(),
  productionId: z.string().uuid().nullable().optional(),
  operation: z.enum(PROMPT_ASSISTANCE_OPERATIONS),
  workflow: z.enum(PROMPT_ASSISTANCE_WORKFLOWS).optional(),
  originalText: z.string().trim().min(1).max(12_000),
  currentText: z.string().trim().max(12_000).optional(),
  provider: z.enum(PROMPT_ASSISTANCE_PROVIDERS),
  model: z.string().trim().min(1).max(120),
  sourceReference: z.undefined().optional(),
}

// Text assistance never receives source media, URLs or storage references. Each branch stays closed.
export const PromptAssistanceRequestSchema = z.discriminatedUnion('mediaType', [
  z.object({ ...sharedRequestFields, mediaType: z.literal('image'), videoMode: z.undefined().optional() }).strict(),
  z.object({ ...sharedRequestFields, mediaType: z.literal('video'), videoMode: z.enum(PROMPT_ASSISTANCE_VIDEO_MODES) }).strict(),
]).superRefine((value, ctx) => {
  if (value.productionId && !value.projectId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['productionId'], message: 'productionId requires projectId.' })
  }
  // The automatic workflow starts from the creative description only: one `create`, never an improvement loop.
  if (value.workflow === 'automatic' && value.operation !== 'create') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['workflow'], message: 'automatic workflow only supports create.' })
  }
  if (value.operation === 'improve' && !value.currentText?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['currentText'], message: 'currentText is required for improve.' })
  }
})

export type PromptAssistanceRequest = z.infer<typeof PromptAssistanceRequestSchema>

export type PromptAssistanceUsage = {
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  providerRequestId?: string
  /** Service tier exactly as the provider reported it for this execution (never inferred). Absent = not reported. */
  serviceTier?: string | null
  /** Gemini thinking tokens. Billed as output but reported apart from outputTokens (candidates exclude thoughts). */
  thoughtsTokens?: number | null
  /** The cached SUBSET of inputTokens (Gemini cachedContentTokenCount / OpenAI prompt_tokens_details.cached_tokens). */
  cachedInputTokens?: number | null
  /** Gemini tool-use prompt tokens: billed as input, not part of inputTokens. */
  toolUsePromptTokens?: number | null
}

export type PromptAssistanceResponse = {
  suggestedPrompt: string
  provider: PromptAssistanceProvider
  model: string
  operation: PromptAssistanceOperation
  usage: PromptAssistanceUsage | null
}

export type PromptAssistanceErrorCode =
  | 'INVALID_REQUEST'
  | 'PROJECT_NOT_FOUND'
  | 'PRODUCTION_NOT_FOUND'
  | 'IDENTITY_INVALID'
  | 'UNSUPPORTED_MODEL'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_INVALID_RESPONSE'
  | 'PROMPT_ASSISTANCE_BLOCKED'

export class PromptAssistanceError extends Error {
  readonly code: PromptAssistanceErrorCode
  readonly status: number
  readonly usage?: PromptAssistanceUsage | null

  constructor(code: PromptAssistanceErrorCode, message: string, status: number, usage?: PromptAssistanceUsage | null) {
    super(message)
    this.name = 'PromptAssistanceError'
    this.code = code
    this.status = status
    this.usage = usage
  }
}
