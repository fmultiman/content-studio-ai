import { z } from 'zod'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value)

export const IMAGE_SESSION_LIMITS = {
  promptMaxChars: 20_000,
  stateMaxBytes: 64 * 1024,
  bodyMaxBytes: 128 * 1024,
  listMax: 100,
} as const

const ImageReferenceSchema = z.object({
  type: z.enum(['image', 'library_file']),
  id: z.string().refine(isUuid, 'reference id must be a UUID'),
}).strict()

export const ImageGenerationWorkingStateV1Schema = z.object({
  schemaVersion: z.literal(1),
  generatedPrompt: z.string().nullable().default(null),
  generatedPromptPt: z.string().nullable().default(null),
  promptDetails: z.unknown().nullable().default(null),
  autoMode: z.boolean(),
  selectedModel: z.string().nullable().default(null),
  imageStatus: z.string().nullable().default(null),
  currentAttempt: z.number().int().nonnegative().nullable().default(null),
  currentImageId: z.string().refine(isUuid, 'currentImageId must be a UUID').nullable().default(null),
  sourceReferences: z.array(ImageReferenceSchema).default([]),
  generationConfig: z.object({
    size: z.string().nullable().default(null),
    quality: z.string().nullable().default(null),
    aspectRatio: z.string().nullable().default(null),
    style: z.string().nullable().default(null),
    providerOptions: z.record(z.string(), z.unknown()).default({}),
  }).strict().default({}),
  legacyImageUrl: z.string().nullable().default(null),
}).strict()

export type ImageGenerationWorkingStateV1 = z.infer<typeof ImageGenerationWorkingStateV1Schema>

export interface ImageGenerationSessionRow {
  id: string
  user_id: string
  project_id: string | null
  production_id: string | null
  name: string | null
  working_prompt: string
  working_state: unknown
  current_image_id: string | null
  status: 'active' | 'archived'
  revision: number
  legacy_image_draft_id: string | null
  legacy_current_evaluation: unknown
  created_at: string
  updated_at: string
}

export const SESSION_COLUMNS = [
  'id', 'user_id', 'project_id', 'production_id', 'name', 'working_prompt',
  'working_state', 'current_image_id', 'status', 'revision',
  'legacy_image_draft_id', 'legacy_current_evaluation', 'created_at', 'updated_at',
].join(',')

const byteLength = (value: string) => new TextEncoder().encode(value).byteLength

export function parseWorkingState(raw: unknown) {
  const parsed = ImageGenerationWorkingStateV1Schema.safeParse(raw)
  if (!parsed.success) return parsed
  if (parsed.data.generatedPrompt && parsed.data.generatedPrompt.length > IMAGE_SESSION_LIMITS.promptMaxChars) {
    return {
      success: false as const,
      error: new z.ZodError([{ code: z.ZodIssueCode.too_big, type: 'string', maximum: IMAGE_SESSION_LIMITS.promptMaxChars, inclusive: true, path: ['generatedPrompt'], message: `generatedPrompt exceeds ${IMAGE_SESSION_LIMITS.promptMaxChars} characters` }]),
    }
  }
  if (byteLength(JSON.stringify(parsed.data)) > IMAGE_SESSION_LIMITS.stateMaxBytes) {
    return {
      success: false as const,
      error: new z.ZodError([{ code: z.ZodIssueCode.custom, path: [], message: `workingState exceeds ${IMAGE_SESSION_LIMITS.stateMaxBytes} bytes` }]),
    }
  }
  return parsed
}

export const CreateSessionBodySchema = z.object({
  id: z.string().refine(isUuid, 'id must be a UUID').optional(),
  projectId: z.string().refine(isUuid, 'projectId must be a UUID').nullable().optional(),
  productionId: z.string().refine(isUuid, 'productionId must be a UUID').nullable().optional(),
  name: z.string().max(200).nullable().optional(),
  workingPrompt: z.string().max(IMAGE_SESSION_LIMITS.promptMaxChars).default(''),
  workingState: z.unknown(),
}).strict()

export const PatchSessionBodySchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  workingPrompt: z.string().max(IMAGE_SESSION_LIMITS.promptMaxChars),
  workingState: z.unknown(),
}).strict()

export function formatValidationIssues(error: z.ZodError) {
  return error.issues.slice(0, 8).map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
}

export function toSessionResponse(row: ImageGenerationSessionRow) {
  const parsed = ImageGenerationWorkingStateV1Schema.safeParse(row.working_state)
  return {
    id: row.id,
    projectId: row.project_id,
    productionId: row.production_id,
    name: row.name,
    workingPrompt: row.working_prompt,
    workingState: parsed.success ? parsed.data : null,
    currentImageId: row.current_image_id,
    status: row.status,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export type SessionResponse = ReturnType<typeof toSessionResponse>

export async function readBoundedJsonBody(req: Request, maxBytes = IMAGE_SESSION_LIMITS.bodyMaxBytes) {
  const declared = Number(req.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false as const, status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' }
  }
  const text = await req.text()
  if (byteLength(text) > maxBytes) {
    return { ok: false as const, status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' }
  }
  try {
    const body: unknown = JSON.parse(text)
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('object required')
    return { ok: true as const, body: body as Record<string, unknown> }
  } catch {
    return { ok: false as const, status: 400, code: 'INVALID_JSON', message: 'Invalid JSON body.' }
  }
}
