// VIDEO_GENERATION_SESSION_PERSISTENCE_AND_API_V1
//
// Pure domain helpers for the persisted VideoGenerationSession (the mutable, resumable working state).
//
// There is ONE authority for the shape of a working state: VideoGenerationWorkingStateV1Schema
// (./working-state.ts, slice 036A). Persistence only SPLITS that document across two columns:
//
//   working_prompt  <- state.prompt                       (the direct prompt, verbatim, first-class)
//   working_config  <- { schemaVersion, source, selection } (state without the prompt)
//
// and API reads re-compose it. The prompt is never stored inside working_config, so there is no second copy
// that could diverge. Validation here is SYNTACTIC only (shape, schemaVersion, sizes). Whether a source or a
// connection still exists / is usable is decided at Generate time by the existing server authorities
// (resolveGenerationConnection, resolveI2vSource) - a persisted id is never authority.

import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { VideoGenerationWorkingStateV1Schema, type VideoGenerationWorkingStateV1 } from './working-state'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value)

/**
 * Abuse / DB-bloat guards. They are deliberately provider-agnostic: the repo has no prompt-length authority, so
 * these only bound what a user session can park in the database, not what Kling accepts at Generate time.
 */
export const SESSION_LIMITS = {
  /** Draft prompt, in UTF-16 code units. */
  promptMaxChars: 20_000,
  /** Serialized working_config (source + selection incl. audio/music prompts), in UTF-8 bytes. */
  configMaxBytes: 32 * 1024,
  /** Whole request body, in UTF-8 bytes. */
  bodyMaxBytes: 128 * 1024,
  /** Sessions returned by one list call (no pagination in V1). */
  listMax: 100,
} as const

const byteLength = (value: string) => new TextEncoder().encode(value).byteLength

type WorkingConfig = Omit<VideoGenerationWorkingStateV1, 'prompt'>

/** Reuses the 036A schema and adds only persistence-time bounds. */
export const SessionWorkingStateSchema = VideoGenerationWorkingStateV1Schema.superRefine((state, ctx) => {
  if (state.prompt.length > SESSION_LIMITS.promptMaxChars) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['prompt'], message: `prompt exceeds ${SESSION_LIMITS.promptMaxChars} characters` })
  }
  if (state.source && !isUuid(state.source.id)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['source', 'id'], message: 'source id must be a UUID' })
  }
  if (state.lastFrame && !isUuid(state.lastFrame.id)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['lastFrame', 'id'], message: 'last frame id must be a UUID' })
  }
  if (byteLength(JSON.stringify(splitWorkingState(state).working_config)) > SESSION_LIMITS.configMaxBytes) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['selection'], message: `working config exceeds ${SESSION_LIMITS.configMaxBytes} bytes` })
  }
})

export function splitWorkingState(state: VideoGenerationWorkingStateV1): { working_prompt: string; working_config: WorkingConfig } {
  const { prompt, ...config } = state
  return { working_prompt: prompt, working_config: config }
}

export function composeWorkingState(row: { working_prompt: string; working_config: unknown }) {
  return VideoGenerationWorkingStateV1Schema.safeParse({
    ...(row.working_config && typeof row.working_config === 'object' ? row.working_config : {}),
    prompt: row.working_prompt,
  })
}

/** Create: the first call that carries a Session id. Scope is fixed here and can never change afterwards. */
export const CreateSessionBodySchema = z
  .object({
    projectId: z.string().refine(isUuid, 'projectId must be a UUID'),
    productionId: z.string().refine(isUuid, 'productionId must be a UUID'),
    workingState: z.unknown(),
  })
  .strict()

/** Update: whole-document replacement of the working state, guarded by the version the client hydrated. */
export const PatchSessionBodySchema = z
  .object({
    expectedUpdatedAt: z.string().min(1).max(64),
    workingState: z.unknown(),
  })
  .strict()

export interface SessionRow {
  id: string
  user_id: string
  project_id: string
  production_id: string
  working_prompt: string
  working_config: unknown
  created_at: string
  updated_at: string
}

/** Columns a route may read; nothing else is ever selected or echoed. */
export const SESSION_COLUMNS = 'id,user_id,project_id,production_id,working_prompt,working_config,created_at,updated_at'

/**
 * What the Workspace needs and nothing more. `updatedAt` is the optimistic-concurrency token: it must be echoed
 * back verbatim as `expectedUpdatedAt` (never re-parsed or re-formatted, which would lose microseconds).
 * `workingState` is null only when the stored document is not a valid V1 state (e.g. written by a future version).
 */
export function toSessionResponse(row: SessionRow) {
  const parsed = composeWorkingState(row)
  return {
    id: row.id,
    projectId: row.project_id,
    productionId: row.production_id,
    workingState: parsed.success ? parsed.data : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export type SessionResponse = ReturnType<typeof toSessionResponse>

export function formatValidationIssues(error: z.ZodError) {
  return error.issues.slice(0, 5).map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
}

/** Reads a JSON object body with a hard byte cap, before any parsing work or database access. */
export async function readBoundedJsonBody(
  req: NextRequest,
  maxBytes: number = SESSION_LIMITS.bodyMaxBytes,
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; status: number; code: string; message: string }> {
  const declared = Number(req.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' }
  }
  let text: string
  try {
    text = await req.text()
  } catch {
    return { ok: false, status: 400, code: 'INVALID_JSON', message: 'Invalid JSON body.' }
  }
  if (byteLength(text) > maxBytes) {
    return { ok: false, status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' }
  }
  try {
    const body = JSON.parse(text)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { ok: false, status: 400, code: 'INVALID_BODY', message: 'Invalid request body.' }
    }
    return { ok: true, body }
  } catch {
    return { ok: false, status: 400, code: 'INVALID_JSON', message: 'Invalid JSON body.' }
  }
}
