import { z } from 'zod'

export const PROMPT_ASSISTANCE_PROVIDERS = ['openai', 'gemini'] as const
export type PromptAssistanceProvider = (typeof PROMPT_ASSISTANCE_PROVIDERS)[number]

export const PROMPT_ASSISTANCE_OPERATIONS = ['create', 'improve'] as const
export type PromptAssistanceOperation = (typeof PROMPT_ASSISTANCE_OPERATIONS)[number]

export const PromptAssistanceRequestSchema = z.object({
  projectId: z.string().uuid().nullable().optional(),
  productionId: z.string().uuid().nullable().optional(),
  mediaType: z.literal('image'),
  videoMode: z.undefined().optional(),
  operation: z.enum(PROMPT_ASSISTANCE_OPERATIONS),
  originalText: z.string().trim().min(1).max(12_000),
  currentText: z.string().trim().max(12_000).optional(),
  provider: z.enum(PROMPT_ASSISTANCE_PROVIDERS),
  model: z.string().trim().min(1).max(120),
  sourceReference: z.undefined().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.productionId && !value.projectId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['productionId'], message: 'productionId requires projectId.' })
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
  serviceTier?: string | null
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
