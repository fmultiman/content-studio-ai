import { describe, expect, it } from 'vitest'
import { contextualContentForChannelPiece, isStaticChannelPiece, isStaticEditorProjectIdentityReady, staticAuthoringTarget } from '@/lib/creative/context/static-authoring'
import { createContextualAuthoringState, deriveManifestFromState, derivePrimitiveSelectionRequest } from '@/lib/creative/authoring'
import type { AuthoringProductContext } from '@/lib/creative/authoring'
import type { ChannelPiece, EditorialContent } from '@/lib/types'
import { normalizeProjectIdentity } from '@/lib/project-identity-normalizer'
import { adaptProjectIdentityToVisualTokens } from '@/lib/creative/integration/project-identity-adapter'

const identity = {
  schema_version: 1 as const,
  foundation: { purpose: 'Registrar memoria cultural.' },
  relationship: { audience: 'Comunidades leitoras.' },
  expression: { visual_identity: 'Editorial e documental.' },
}

const editorialContent = {
  id: 'ec-1', project_id: 'project-1', production_id: 'production-1',
  title: 'Conteúdo editorial', body: 'Corpo editorial', status: 'draft',
} as EditorialContent

const channelPiece = {
  id: 'cp-1', editorial_content_id: 'ec-1', channel: 'instagram', format: 'carousel',
  title: 'Peça do carrossel', body: 'Texto da peça', cta: 'Leia mais', hashtags: ['#memoria'], status: 'draft',
} as unknown as ChannelPiece

describe('static authoring product context', () => {
  it('maps static ChannelPiece metadata without introducing a parallel target enum', () => {
    expect(isStaticChannelPiece(channelPiece.channel, channelPiece.format)).toBe(true)
    expect(staticAuthoringTarget(channelPiece.channel, channelPiece.format)).toMatchObject({ mode: 'static', canvas: { width: 1080, height: 1350 } })
    expect(staticAuthoringTarget('instagram', 'reel')).toBeNull()
    expect(isStaticChannelPiece('instagram', 'reel')).toBe(false)
    expect(isStaticChannelPiece('tiktok', 'reel')).toBe(false)
    expect(isStaticChannelPiece('instagram', 'carousel')).toBe(true)
    expect(contextualContentForChannelPiece(editorialContent, channelPiece)).toEqual({
      eyebrow: 'instagram', title: 'Peça do carrossel', subtitle: 'Texto da peça', source_line: 'carousel', detail_note: 'Leia mais',
    })
  })

  // Creative Editor Static Shell V1: null cta must OMIT detail_note, never send ''.
  it('omits detail_note entirely when cta is null, instead of an invalid empty string', () => {
    const withoutCta = { ...channelPiece, cta: null } as unknown as ChannelPiece
    const content = contextualContentForChannelPiece(editorialContent, withoutCta)
    expect(content).not.toHaveProperty('detail_note')
    expect(content).toEqual({ eyebrow: 'instagram', title: 'Peça do carrossel', subtitle: 'Texto da peça', source_line: 'carousel' })
  })

  it('initializes shared AuthoringState from real-shaped context and keeps fixture identity out of its manifest', () => {
    const context: AuthoringProductContext = {
      projectId: 'project-1', projectName: 'Portal', productionId: 'production-1', productionTitle: 'Produção',
      editorialContentId: 'ec-1', editorialContentTitle: editorialContent.title, channelPieceId: 'cp-1',
      channel: channelPiece.channel, format: channelPiece.format, projectIdentity: identity,
      identitySnapshot: adaptProjectIdentityToVisualTokens('project-1', identity), primitiveProjectRef: 'project:portal-comunidades-alternativas',
    }
    const state = createContextualAuthoringState(context, 'portrait', contextualContentForChannelPiece(editorialContent, channelPiece), {
      paper: 'paper-card-light-01', tape: 'tape-kraft-short-01',
    })
    const manifest = deriveManifestFromState(state)
    expect(state.productContext?.projectId).toBe('project-1')
    expect(state.contentOverride).toMatchObject({ title: 'Peça do carrossel' })
    expect(derivePrimitiveSelectionRequest(state)).toEqual({ projectRef: 'project:portal-comunidades-alternativas', paper: 'paper-card-light-01', tape: 'tape-kraft-short-01' })
    expect(manifest.source).toEqual({ type: 'channel_piece', ref: 'cp-1' })
    expect(manifest.metadata).not.toHaveProperty('fixture')
    expect(manifest.identity.snapshot_ref).toBe(context.identitySnapshot.snapshot_ref)
  })
})

describe('isStaticEditorProjectIdentityReady — the Static Editor readiness gate, shared with the handoff chooser', () => {
  it.each([
    ['valid identity', identity],
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['empty object', {}],
    ['wrong schema_version', { schema_version: 2, foundation: { purpose: 'x' } }],
    ['not an object', 'texto'],
  ])('%s: ready exactly when normalizeProjectIdentity (the route gate) yields an identity', (_label, raw) => {
    let routeReady: boolean
    try { routeReady = normalizeProjectIdentity(raw) !== null } catch { routeReady = false }
    expect(isStaticEditorProjectIdentityReady(raw)).toBe(routeReady)
  })
  it('never throws', () => {
    expect(() => isStaticEditorProjectIdentityReady({ schema_version: 1, unknown: 'x' })).not.toThrow()
  })
})
