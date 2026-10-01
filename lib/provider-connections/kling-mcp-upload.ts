// VIDEO_MCP_I2V_SOURCE_TRANSPORT_V1
//
// Kling MCP image ingestion for Image -> Video. Content Studio media is private, so the provider can never fetch it:
// a presigned S3 URL is unreachable for Kling and a data URL is not an absolute URL (both observed in Production).
// The contract the CURRENT Kling MCP server declares (mcpVersion 1.3.3, `file_upload` tool description):
//
//   1. call tool `file_upload` {contentType, filename, size}
//        -> a ONE-TIME upload ticket: `ticket`, `upload_url`, `expire_at` (single use)
//   2. POST multipart/form-data to `upload_url` with two fields: `ticket` and `file`
//        (the `file` part Content-Type must be image/png, image/jpeg or video/mp4)
//        -> the response contains the file URL
//   3. that URL is the `first_image` input of `image_to_video` ("Must be url returned by file_upload tool")
//
// Step 2 is performed by THIS server with bytes it loaded from a proven-owner storage key (the browser never supplies a
// URL, path or content). Step 3 happens ONLY after this function returned a valid reference: a failure anywhere in 1-2
// means image_to_video (the paid call) was never attempted.
//
// EVIDENCE NOTE: the tool description documents the ticket/upload field names (`ticket`, `upload_url`, `expire_at`) but
// names NO key for the file URL in the upload response. The parsers below therefore accept a small, explicit set of
// spellings and FAIL CLOSED (MCP_SOURCE_REFERENCE_INVALID, before any paid call) on anything else, reporting only key
// NAMES for diagnosis. The real shape is confirmed by the single approved paid proof.
//
// `file_upload` is provider-side preparation, not a generation: it is NOT recorded in the usage ledger (no billing
// evidence exists for it), it is never retried (a retry could create a second provider-side upload), and nothing it
// returns is persisted as source authority.

import type { CallToolResult } from '@modelcontextprotocol/client'
import { ProtocolError, SdkHttpError } from '@modelcontextprotocol/client'
import { createKlingMcpClient, mapMcpError, parseToolJson, type KlingMcpClientDependencies, type KlingMcpClientLike } from './kling-mcp-client'
import { isKlingMcpSourceUploadTool, KLING_MCP_SOURCE_UPLOAD_TOOL } from './kling-mcp'
import { KlingMcpSubmitError } from './kling-mcp-generation'
import { ProviderAuthorizationRequiredError, ProviderConnectionError } from './types'
import { postMultipartToProvider, ProviderUploadError, type ProviderUploadDependencies } from '@/lib/security/pinned-provider-upload'
import type { I2vSourceMime } from '@/lib/video-generation/i2v-media-policy'

export interface KlingMcpUploadImage {
  bytes: Uint8Array
  /** The VERIFIED mime (from the file signature), never a stored column. */
  mimeType: I2vSourceMime
  filename: string
}

/** The ticket call is bounded on its own: the route allows 60s in total and the POST + paid submit still have to fit. */
export const KLING_MCP_TICKET_TIMEOUT_MS = 20_000

export interface KlingMcpUploadDependencies extends KlingMcpClientDependencies {
  providerUpload?: ProviderUploadDependencies
  nowMs?: () => number
  ticketTimeoutMs?: number
}

export interface KlingMcpUploadTicket {
  ticket: string
  uploadUrl: string
  /** Epoch milliseconds, or null when the provider did not state/format it in a readable way. */
  expiresAtMs: number | null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

const NESTED_KEYS = ['data', 'result', 'file'] as const

function findString(payload: unknown, keys: readonly string[], depth = 0): string | null {
  const record = asRecord(payload)
  if (!record || depth > 2) return null
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  for (const nested of NESTED_KEYS) {
    const found = findString(record[nested], keys, depth + 1)
    if (found) return found
  }
  return null
}

function findValue(payload: unknown, keys: readonly string[], depth = 0): unknown {
  const record = asRecord(payload)
  if (!record || depth > 2) return undefined
  for (const key of keys) if (record[key] !== undefined && record[key] !== null) return record[key]
  for (const nested of NESTED_KEYS) {
    const found = findValue(record[nested], keys, depth + 1)
    if (found !== undefined) return found
  }
  return undefined
}

function parseExpiry(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value < 1e12 ? value * 1000 : value
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value)
    if (Number.isFinite(numeric) && numeric > 0) return numeric < 1e12 ? numeric * 1000 : numeric
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}

/** Step 1 result. Documented names first (`ticket`, `upload_url`, `expire_at`); null when a required field is absent. */
export function parseUploadTicket(payload: unknown): KlingMcpUploadTicket | null {
  const ticket = findString(payload, ['ticket'])
  const uploadUrl = findString(payload, ['upload_url', 'uploadUrl'])
  if (!ticket || !uploadUrl) return null
  return { ticket, uploadUrl, expiresAtMs: parseExpiry(findValue(payload, ['expire_at', 'expireAt'])) }
}

/**
 * Step 2 result: the provider's file URL. Structural validation only (absolute https URL, bounded, no embedded
 * credentials): a provider-hosted reference is NOT held to Content Studio's S3 path rules and no host list is invented.
 */
export function parseUploadedFileUrl(payload: unknown): string | null {
  const candidate = findString(payload, ['url', 'file_url', 'fileUrl', 'fileURL'])
  if (!candidate || candidate.length > 2048) return null
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'https:' || url.username || url.password) return null
    return url.toString()
  } catch {
    return null
  }
}

/** Key NAMES only (never values) — safe to keep for diagnosing an unexpected provider shape. */
export function shapeOf(payload: unknown): string {
  const record = asRecord(payload)
  if (!record) return Array.isArray(payload) ? 'array' : typeof payload
  return Object.keys(record).sort().slice(0, 12).join(',') || '(empty object)'
}

const UPLOAD_SCOPE_MESSAGE = 'A Kling recusou o envio da imagem: a autorização da conta não permite gerar. Autorize a geração em Configurações.'
const UPLOAD_FAILED_MESSAGE = 'Não foi possível enviar a imagem de origem à Kling. Nada foi gerado nem cobrado. Tente novamente.'
const REFERENCE_INVALID_MESSAGE = 'A Kling recebeu a imagem, mas não devolveu uma referência utilizável. Nada foi gerado nem cobrado. Tente novamente.'

function uploadFailed(reason: string): KlingMcpSubmitError {
  return new KlingMcpSubmitError('MCP_FILE_UPLOAD_FAILED', UPLOAD_FAILED_MESSAGE, { outcomeUnknown: false, providerText: reason.slice(0, 200) })
}

class TicketTimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TicketTimeoutError('ticket timeout')), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

/** The single gate through which `file_upload` is invoked. */
async function callUploadTool(client: KlingMcpClientLike, name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  if (!isKlingMcpSourceUploadTool(name)) {
    throw new ProviderConnectionError('PROVIDER_TOOL_ERROR', `Tool "${name}" is not permitted for source upload.`)
  }
  return (await client.callTool({ name, arguments: args })) as CallToolResult
}

/**
 * Uploads ONE trusted source image through the provider's ticket flow and returns the provider-valid file URL.
 * Errors are all pre-submission (`outcomeUnknown: false`): nothing was generated or billed.
 * A rejected access token rethrows ProviderAuthorizationRequiredError so the caller may refresh ONCE and retry: a
 * rejected token never reached the tool, so that retry cannot create a second upload.
 */
export async function uploadKlingMcpSourceImage(
  accessToken: string,
  image: KlingMcpUploadImage,
  deps: KlingMcpUploadDependencies = {},
): Promise<{ url: string }> {
  const { client, transport } = (deps.createClient ?? createKlingMcpClient)(accessToken)
  let connected = false
  try {
    try {
      await client.connect(transport)
      connected = true
    } catch (error) {
      const mapped = mapMcpError(error)
      if (mapped instanceof ProviderAuthorizationRequiredError) throw mapped
      throw uploadFailed('connect failed')
    }

    // Step 1 — ticket.
    let ticketResult: CallToolResult
    try {
      ticketResult = await withTimeout(
        callUploadTool(client, KLING_MCP_SOURCE_UPLOAD_TOOL, {
          contentType: image.mimeType,
          filename: image.filename,
          size: image.bytes.byteLength,
        }),
        deps.ticketTimeoutMs ?? KLING_MCP_TICKET_TIMEOUT_MS,
      )
    } catch (error) {
      // A ticket that never arrived is harmless (single-use, nothing paid): fail, never retry, never block the route.
      if (error instanceof TicketTimeoutError) throw uploadFailed('ticket timeout')
      const mapped = mapMcpError(error)
      if (mapped instanceof ProviderAuthorizationRequiredError) throw mapped
      const httpStatus = error instanceof SdkHttpError ? (error.data as { status?: number } | undefined)?.status : undefined
      if (httpStatus === 403) throw new KlingMcpSubmitError('PROVIDER_REJECTED', UPLOAD_SCOPE_MESSAGE, { outcomeUnknown: false })
      throw uploadFailed(error instanceof ProtocolError ? 'protocol error' : 'ticket call failed')
    }
    if (ticketResult.isError) throw uploadFailed('ticket tool reported an error')

    let ticketPayload: unknown
    try {
      ticketPayload = parseToolJson(ticketResult)
    } catch {
      throw uploadFailed('ticket response unreadable')
    }
    const ticket = parseUploadTicket(ticketPayload)
    if (!ticket) throw uploadFailed(`ticket missing; keys: ${shapeOf(ticketPayload)}`)
    if (ticket.expiresAtMs !== null && ticket.expiresAtMs <= (deps.nowMs ?? Date.now)()) throw uploadFailed('ticket already expired')

    // Step 2 — the bytes, straight from this server to the provider's upload endpoint (one POST, never retried).
    let uploaded
    try {
      uploaded = await postMultipartToProvider(
        ticket.uploadUrl,
        { fields: { ticket: ticket.ticket }, file: { fieldName: 'file', filename: image.filename, contentType: image.mimeType, bytes: image.bytes } },
        undefined,
        deps.providerUpload,
      )
    } catch (error) {
      throw uploadFailed(error instanceof ProviderUploadError ? `upload ${error.code}: ${error.reason}` : 'upload failed')
    }

    // Step 3 — the reference image_to_video will use.
    const url = parseUploadedFileUrl(uploaded.json)
    if (!url) {
      throw new KlingMcpSubmitError('MCP_SOURCE_REFERENCE_INVALID', REFERENCE_INVALID_MESSAGE, {
        outcomeUnknown: false,
        providerText: `no file url; keys: ${shapeOf(uploaded.json)}`,
      })
    }
    return { url }
  } finally {
    if (connected) await client.close().catch(() => undefined)
  }
}
