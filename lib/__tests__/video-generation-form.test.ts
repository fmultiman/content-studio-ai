import { describe, expect, it } from 'vitest'
import { normalizeKlingMcpVideoCapabilities } from '@/lib/provider-connections/kling-mcp-video-capabilities'
import type { ProviderConnectionRow } from '@/lib/provider-connections/types'
import { whoAmIFixture } from './helpers/kling-who-am-i-fixture'
import { describeMcpConnection, describeRestConnection } from '@/lib/video-generation/connections'
import { accountConnectionRef, REST_CONNECTION_REF } from '@/lib/video-generation/connection-ref'
import { defaultModel, findOperation } from '@/lib/video-generation/capabilities'
import { restVideoOperations } from '@/lib/video-generation/rest-capabilities'
import { validateControlVocabulary, validateVideoRequest } from '@/lib/video-generation/request'
import {
  EMPTY_SELECTION,
  reconcileSelection,
  selectedModel,
  toSubmitControls,
  visibleControls,
  type VideoFormSelection,
} from '@/lib/video-generation/form-selection'

const NOW = new Date('2026-09-29T12:00:00.000Z')
const MCP_ID = '11111111-1111-4111-8111-111111111111'

const mcpOperations = normalizeKlingMcpVideoCapabilities(whoAmIFixture()).operations

function mcpDescriptor(scopes = ['generation.read', 'account.credit.read', 'generation.create']) {
  const row: ProviderConnectionRow = {
    id: MCP_ID,
    user_id: 'u',
    provider: 'kling',
    connection_method: 'mcp_oauth',
    status: 'connected',
    scopes,
    external_account_id: null,
    capabilities: { membership: { label: 'Pro' }, video: { schemaVersion: 1, operations: mcpOperations } },
    last_checked_at: NOW.toISOString(),
    last_error_code: null,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
  }
  return describeMcpConnection(row, NOW)
}

const rest = describeRestConnection('configured')
const both = [rest, mcpDescriptor()]

describe('validateVideoRequest (server validation against the RESOLVED connection)', () => {
  const ok = (ops: any, raw: any) => {
    const result = validateVideoRequest(ops, raw)
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`)
    return result
  }
  const code = (ops: any, raw: any) => {
    const result = validateVideoRequest(ops, raw)
    return result.ok ? 'OK' : result.code
  }

  it('fills every omitted supported control with an EXPLICIT deterministic default (never a provider default)', () => {
    const { request } = ok(restVideoOperations(), { operation: 'text_to_video' })
    expect(request).toEqual({ operation: 'text_to_video', model: 'kling-v3', duration: 5, resolution: '720p', aspectRatio: '16:9', audio: 'off', multiShot: false })

    // MCP's provider defaults are 1080p / audio on / multi-shot on: Content Studio's are not.
    const mcp = ok(mcpOperations, { operation: 'text_to_video' }).request
    expect(mcp).toMatchObject({ model: 'kling-video-v3_0', duration: 5, resolution: '720p', audio: 'off', multiShot: false })
  })

  it('a control the model does not offer is null and a value for it is REJECTED, not ignored', () => {
    const turbo = ok(mcpOperations, { operation: 'text_to_video', model: 'kling-video-v3_0_turbo' }).request
    expect(turbo).toMatchObject({ audio: null, multiShot: null })

    expect(code(mcpOperations, { operation: 'text_to_video', model: 'kling-video-v3_0_turbo', audio: 'off' })).toBe('UNSUPPORTED_AUDIO')
    expect(code(mcpOperations, { operation: 'text_to_video', model: 'kling-video-v3_0_turbo', audio: 'on' })).toBe('UNSUPPORTED_AUDIO')
    expect(code(mcpOperations, { operation: 'text_to_video', model: 'kling-video-v3_0_turbo', multi_shot: false })).toBe('UNSUPPORTED_MULTI_SHOT')
    expect(code(mcpOperations, { operation: 'text_to_video', model: 'kling-video-o1', multi_shot: true })).toBe('UNSUPPORTED_MULTI_SHOT')
  })

  it('unsupported operation / model / duration / resolution / aspect ratio', () => {
    expect(code(mcpOperations, { operation: 'motion_control' })).toBe('UNSUPPORTED_OPERATION')
    expect(code(mcpOperations, { operation: 'text_to_image' })).toBe('UNSUPPORTED_OPERATION')
    expect(code([{ operation: 'text_to_video', models: mcpOperations[1].models }], { operation: 'image_to_video' })).toBe('UNSUPPORTED_OPERATION')
    expect(code(mcpOperations, { operation: 'text_to_video', model: 'kling-video-v9_9' })).toBe('UNSUPPORTED_MODEL')
    expect(code(mcpOperations, { operation: 'text_to_video', model: 42 })).toBe('UNSUPPORTED_MODEL')
    expect(code(mcpOperations, { operation: 'text_to_video', model: 'kling-video-v2_5', duration: 7 })).toBe('UNSUPPORTED_DURATION')
    expect(code(mcpOperations, { operation: 'text_to_video', model: 'kling-video-v3_0_turbo', resolution: '4k' })).toBe('UNSUPPORTED_RESOLUTION')
    expect(code(restVideoOperations(), { operation: 'text_to_video', resolution: '4k' })).toBe('UNSUPPORTED_RESOLUTION')
    expect(code(restVideoOperations(), { operation: 'text_to_video', duration: 15 })).toBe('UNSUPPORTED_DURATION')
    expect(code(mcpOperations, { operation: 'text_to_video', aspect_ratio: '4:3' })).toBe('UNSUPPORTED_ASPECT_RATIO')
    expect(code(mcpOperations, { operation: 'image_to_video', aspect_ratio: '16:9' })).toBe('UNSUPPORTED_ASPECT_RATIO')
  })

  it('model-specific limits are enforced (a value valid for one model is rejected for another)', () => {
    expect(code(mcpOperations, { operation: 'text_to_video', model: 'kling-video-v3_0', duration: 15, resolution: '4k' })).toBe('OK')
    expect(code(mcpOperations, { operation: 'text_to_video', model: 'kling-video-v2_6', duration: 15 })).toBe('UNSUPPORTED_DURATION')
    expect(code(mcpOperations, { operation: 'text_to_video', model: 'kling-video-v2_6', resolution: '4k' })).toBe('UNSUPPORTED_RESOLUTION')

    // REST Kling 2.6 limits
    expect(code(restVideoOperations(), { operation: 'text_to_video', model: 'kling-v2-6', duration: 7 })).toBe('UNSUPPORTED_DURATION')
    expect(code(restVideoOperations(), { operation: 'text_to_video', model: 'kling-v2-6', resolution: '4k' })).toBe('UNSUPPORTED_RESOLUTION')
    expect(code(restVideoOperations(), { operation: 'text_to_video', model: 'kling-v2-6', multi_shot: true })).toBe('UNSUPPORTED_MULTI_SHOT')
    expect(code(restVideoOperations(), { operation: 'text_to_video', model: 'kling-v2-6', aspect_ratio: '4:3' })).toBe('UNSUPPORTED_ASPECT_RATIO')
    expect(code(restVideoOperations(), { operation: 'image_to_video', model: 'kling-v2-6', aspect_ratio: '16:9' })).toBe('UNSUPPORTED_ASPECT_RATIO')

    // Valid 3.0 and 2.6 requests accepted
    expect(code(restVideoOperations(), { operation: 'text_to_video', model: 'kling-v3', duration: 10, resolution: '1080p', audio: 'on', multi_shot: true, aspect_ratio: '16:9' })).toBe('OK')
    expect(code(restVideoOperations(), { operation: 'text_to_video', model: 'kling-v2-6', duration: 10, resolution: '1080p', audio: 'on', aspect_ratio: '16:9' })).toBe('OK')
  })

  it('output count is pinned to 1: anything else is rejected', () => {
    expect(code(mcpOperations, { operation: 'text_to_video', outputCount: 1 })).toBe('OK')
    for (const outputCount of [2, 4, 0, '1', null]) {
      expect(code(mcpOperations, { operation: 'text_to_video', outputCount })).toBe('UNSUPPORTED_OUTPUT_COUNT')
    }
  })

  it('audio "on" for Kling 2.6 image-to-video requires 1080p', () => {
    expect(code(mcpOperations, { operation: 'image_to_video', model: 'kling-video-v2_6', audio: 'on', resolution: '720p' })).toBe('AUDIO_RESOLUTION_CONFLICT')
    expect(code(mcpOperations, { operation: 'image_to_video', model: 'kling-video-v2_6', audio: 'on', resolution: '1080p' })).toBe('OK')
    expect(code(mcpOperations, { operation: 'image_to_video', model: 'kling-video-v2_6', audio: 'off', resolution: '720p' })).toBe('OK')
  })

  it('malformed control values are rejected', () => {
    expect(code(mcpOperations, { operation: 'text_to_video', audio: 'maybe' })).toBe('UNSUPPORTED_AUDIO')
    expect(code(mcpOperations, { operation: 'text_to_video', multi_shot: 'true' })).toBe('UNSUPPORTED_MULTI_SHOT')
    expect(code(mcpOperations, { operation: 'text_to_video', duration: 'abc' })).toBe('UNSUPPORTED_DURATION')
  })

  it('validateControlVocabulary rejects shape errors before any connection lookup', () => {
    expect(validateControlVocabulary('text_to_video', { aspect_ratio: '4:3' })).toMatchObject({ ok: false, code: 'UNSUPPORTED_ASPECT_RATIO' })
    expect(validateControlVocabulary('image_to_video', { aspect_ratio: '16:9' })).toMatchObject({ ok: false, code: 'UNSUPPORTED_ASPECT_RATIO' })
    expect(validateControlVocabulary('text_to_video', { duration: 0 })).toMatchObject({ ok: false, code: 'UNSUPPORTED_DURATION' })
    expect(validateControlVocabulary('text_to_video', { resolution: '8k' })).toMatchObject({ ok: false, code: 'UNSUPPORTED_RESOLUTION' })
    expect(validateControlVocabulary('text_to_video', { outputCount: 3 })).toMatchObject({ ok: false, code: 'UNSUPPORTED_OUTPUT_COUNT' })
    expect(validateControlVocabulary('text_to_video', { duration: 10, resolution: '1080p', audio: 'on', multi_shot: true, aspect_ratio: '9:16' })).toBeNull()
  })
})

describe('dynamic form reconciliation', () => {
  const start = reconcileSelection(both)
  const withRef = (selection: VideoFormSelection, connectionRef: string) => reconcileSelection(both, { ...selection, connectionRef })
  const set = (selection: VideoFormSelection, patch: Partial<VideoFormSelection>) => reconcileSelection(both, { ...selection, ...patch })

  it('Kling REST stays the default connection when both exist (MCP is never chosen automatically)', () => {
    expect(start.connectionRef).toBe(REST_CONNECTION_REF)
    expect(start).toMatchObject({ operation: 'image_to_video', modelId: 'kling-v3', duration: 5, resolution: '720p', aspectRatio: null, audio: 'off', multiShot: false })
  })

  it('picks a usable connection when REST is not configured; falls back to REST (blocked) when nothing is usable', () => {
    const unconfigured = describeRestConnection('missing')
    expect(reconcileSelection([unconfigured, mcpDescriptor()]).connectionRef).toBe(accountConnectionRef(MCP_ID))
    expect(reconcileSelection([unconfigured, mcpDescriptor(['generation.read'])]).connectionRef).toBe(REST_CONNECTION_REF)
    expect(reconcileSelection([])).toEqual(EMPTY_SELECTION)
  })

  it('switch REST → MCP: models, controls and values are recomputed; compatible values survive', () => {
    const rest10 = set(start, { operation: 'text_to_video', duration: 10, resolution: '1080p', audio: 'on', multiShot: true, aspectRatio: '9:16' })
    const mcp = withRef(rest10, accountConnectionRef(MCP_ID))

    // REST's model id does not exist on MCP → deterministic valid default model.
    expect(mcp.modelId).toBe('kling-video-v3_0')
    // Values valid on both are preserved…
    expect(mcp).toMatchObject({ operation: 'text_to_video', duration: 10, resolution: '1080p', audio: 'on', multiShot: true, aspectRatio: '9:16' })
  })

  it('switch MCP → REST: values REST cannot do are reset to explicit defaults, never carried invisibly', () => {
    const mcp = set(withRef(start, accountConnectionRef(MCP_ID)), { operation: 'text_to_video', modelId: 'kling-video-v3_0', duration: 12, resolution: '4k' })
    expect(mcp).toMatchObject({ duration: 12, resolution: '4k' })

    const back = withRef(mcp, REST_CONNECTION_REF)
    expect(back).toMatchObject({ connectionRef: REST_CONNECTION_REF, modelId: 'kling-v3', duration: 5, resolution: '720p' })
  })

  it('switch T2V → I2V: aspect ratio disappears (null) and is never submitted; back to T2V restores an explicit default', () => {
    const t2v = set(start, { operation: 'text_to_video', aspectRatio: '9:16' })
    expect(t2v.aspectRatio).toBe('9:16')

    const i2v = set(t2v, { operation: 'image_to_video' })
    expect(i2v.aspectRatio).toBeNull()
    expect(toSubmitControls(i2v)).not.toHaveProperty('aspect_ratio')

    expect(set(i2v, { operation: 'text_to_video' }).aspectRatio).toBe('16:9')
  })

  it('switch model: keeps a value only if the new model still supports it, otherwise resets truthfully', () => {
    const mcp = withRef(start, accountConnectionRef(MCP_ID))
    const v3 = set(mcp, { operation: 'text_to_video', modelId: 'kling-video-v3_0', duration: 12, resolution: '4k', audio: 'on', multiShot: true })
    expect(v3).toMatchObject({ duration: 12, resolution: '4k', audio: 'on', multiShot: true })

    // Kling 2.5: 5/10s only, no 4K, no multi-shot.
    const v25 = set(v3, { modelId: 'kling-video-v2_5' })
    expect(v25).toMatchObject({ modelId: 'kling-video-v2_5', duration: 5, resolution: '720p', audio: 'on', multiShot: null })

    // Turbo: no audio, no multi-shot at all.
    const turbo = set(v3, { modelId: 'kling-video-v3_0_turbo' })
    expect(turbo).toMatchObject({ resolution: '720p', audio: null, multiShot: null, duration: 12 })
    expect(visibleControls(selectedModel(both, turbo))).toEqual({ aspectRatio: true, audio: false, multiShot: false })
  })

  it('hidden controls are never part of the submit payload; visible ones are all sent explicitly', () => {
    const mcp = withRef(start, accountConnectionRef(MCP_ID))
    const turbo = set(mcp, { operation: 'text_to_video', modelId: 'kling-video-v3_0_turbo', audio: 'on', multiShot: true })
    const body = toSubmitControls(turbo)
    expect(body).not.toHaveProperty('audio')
    expect(body).not.toHaveProperty('multi_shot')
    expect(body).toEqual({
      connectionRef: accountConnectionRef(MCP_ID),
      mode: 'text_to_video',
      model: 'kling-video-v3_0_turbo',
      duration: 5,
      resolution: '720p',
      aspect_ratio: '16:9',
    })

    const v3 = toSubmitControls(set(turbo, { modelId: 'kling-video-v3_0' }))
    expect(v3).toMatchObject({ audio: 'off', multi_shot: false, duration: 5, resolution: '720p', aspect_ratio: '16:9' })
  })

  it('audio-only-at-1080p: changing resolution away from it turns audio off instead of leaving an invalid state', () => {
    const mcp = withRef(start, accountConnectionRef(MCP_ID))
    const on1080 = set(mcp, { operation: 'image_to_video', modelId: 'kling-video-v2_6', resolution: '1080p', audio: 'on' })
    expect(on1080).toMatchObject({ audio: 'on', resolution: '1080p' })
    expect(set(on1080, { resolution: '720p' })).toMatchObject({ audio: 'off', resolution: '720p' })
  })

  it('never selects the "best" model: the default is REST-continuity (Kling 3.0) or the first listed', () => {
    expect(defaultModel(findOperation(mcpOperations, 'text_to_video')!.models)!.id).toBe('kling-video-v3_0')
    const noV3 = findOperation(mcpOperations, 'text_to_video')!.models.filter((model) => !model.id.startsWith('kling-video-v3'))
    expect(defaultModel(noV3)!.id).toBe(noV3[0].id)
  })

  it('operation choices follow the connection: an operation the connection lacks is not selectable', () => {
    const onlyT2v = { ...mcpDescriptor(), operations: mcpDescriptor().operations.filter((entry) => entry.operation === 'text_to_video') }
    const selection = reconcileSelection([onlyT2v], { ...EMPTY_SELECTION, operation: 'image_to_video' })
    expect(selection.operation).toBe('text_to_video')
  })

  it('a blocked (read-only) connection can still be selected for exploration but its descriptor cannot generate', () => {
    const readOnly = mcpDescriptor(['generation.read', 'account.credit.read'])
    const selection = reconcileSelection([rest, readOnly], { ...EMPTY_SELECTION, connectionRef: readOnly.ref })
    expect(selection.connectionRef).toBe(readOnly.ref)
    expect(selection.modelId).toBe('kling-video-v3_0')
    expect(readOnly.canGenerate).toBe(false)
  })

  it('switch model on REST: Kling 3.0 multiShot=true clears to null on Kling 2.6, and does NOT auto-enable on switch back', () => {
    const v3WithMultiShot = set(start, {
      operation: 'text_to_video',
      modelId: 'kling-v3',
      duration: 10,
      resolution: '1080p',
      audio: 'on',
      multiShot: true,
      aspectRatio: '9:16',
    })
    expect(v3WithMultiShot).toMatchObject({
      modelId: 'kling-v3',
      duration: 10,
      resolution: '1080p',
      audio: 'on',
      multiShot: true,
      aspectRatio: '9:16',
    })
    expect(toSubmitControls(v3WithMultiShot)).toHaveProperty('multi_shot', true)

    // Switch to Kling 2.6: duration 10, resolution 1080p, audio on, aspect 9:16 are preserved.
    // multiShot is cleared to null because Kling 2.6 does not support multi-shot.
    const v26 = set(v3WithMultiShot, { modelId: 'kling-v2-6' })
    expect(v26).toMatchObject({
      modelId: 'kling-v2-6',
      duration: 10,
      resolution: '1080p',
      audio: 'on',
      multiShot: null,
      aspectRatio: '9:16',
    })
    // Hidden control is omitted from the submission payload
    expect(toSubmitControls(v26)).not.toHaveProperty('multi_shot')

    // Switch back to Kling 3.0: multiShot does NOT auto-enable, but takes default false
    const backToV3 = set(v26, { modelId: 'kling-v3' })
    expect(backToV3).toMatchObject({
      modelId: 'kling-v3',
      duration: 10,
      resolution: '1080p',
      audio: 'on',
      multiShot: false,
      aspectRatio: '9:16',
    })
    expect(toSubmitControls(backToV3)).toHaveProperty('multi_shot', false)
  })

  it('reconciliation is deterministic and idempotent', () => {
    const mcp = withRef(start, accountConnectionRef(MCP_ID))
    expect(reconcileSelection(both, mcp)).toEqual(mcp)
    expect(reconcileSelection(both, reconcileSelection(both, mcp))).toEqual(mcp)
  })
})
