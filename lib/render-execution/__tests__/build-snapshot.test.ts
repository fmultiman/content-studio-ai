import { describe, expect, it } from 'vitest'
import {
  buildRenderExecutionSnapshot,
  assertSnapshotHasNoSignedUrl,
  RENDER_EXECUTION_SNAPSHOT_SCHEMA_VERSION,
} from '@/lib/render-execution/build-snapshot'
import type { VideoScene } from '@/lib/types'

const IDENTITY_SNAPSHOT = {
  schema_version: 'visual-tokens.v0' as const,
  snapshot_ref: 'project:11111111-1111-1111-1111-111111111111:snapshot',
  typography: {
    display: { family: 'Fraunces', weight: 700, style: 'normal' as const },
    body: { family: 'Source Sans 3', weight: 400, style: 'normal' as const },
  },
  colors: { background: '#F6F0E4', foreground: '#16352F' },
  spacing: { unit: 8, default_gap: 16 },
}

function makeScene(overrides: Partial<VideoScene> = {}): VideoScene {
  return {
    id: 'scene-1',
    order: 1,
    description: 'snapshot proof scene',
    prompt: null,
    image_url: null,
    library_file_id: 'afa6868e-a2d6-473d-9df7-bbf713ad8b02',
    duration: 3,
    movement: 'zoom_in',
    ...overrides,
  }
}

function makeDraft(scenes: VideoScene[]) {
  return {
    id: 'draft-2i-b1',
    project_id: '11111111-1111-1111-1111-111111111111',
    production_id: '22222222-2222-2222-2222-222222222222',
    scenes,
  }
}

describe('buildRenderExecutionSnapshot — snapshot immutability (Task 7)', () => {
  it('produces a manifest reflecting the VideoDraft state passed in at call time', () => {
    const draftA = makeDraft([makeScene({ duration: 3 })])
    const { snapshot: snapshotA } = buildRenderExecutionSnapshot({ draft: draftA, identitySnapshot: IDENTITY_SNAPSHOT })

    expect(snapshotA.manifest.specification.duration_frames).toBe(90) // 3s * 30fps

    // Later "authoring" mutation: a new VideoDraft state B (as if the user
    // edited the draft after clicking render).
    const draftB = makeDraft([makeScene({ duration: 8 })])
    const { snapshot: snapshotB } = buildRenderExecutionSnapshot({ draft: draftB, identitySnapshot: IDENTITY_SNAPSHOT })

    // Snapshot A must remain exactly as it was computed -- the function call
    // that produced it is not affected by a later, independent call.
    expect(snapshotA.manifest.specification.duration_frames).toBe(90)
    expect(snapshotB.manifest.specification.duration_frames).toBe(240) // 8s * 30fps
  })

  it('does not alias the caller-owned scenes array or scene objects (mutating the source after the call cannot retroactively change the snapshot)', () => {
    const scene = makeScene({ duration: 3 })
    const scenes = [scene]
    const draft = makeDraft(scenes)

    const { snapshot } = buildRenderExecutionSnapshot({ draft, identitySnapshot: IDENTITY_SNAPSHOT })
    const framesBeforeMutation = snapshot.manifest.specification.duration_frames

    // Mutate the original scene/array in place, exactly as an in-memory
    // reference to a freshly-fetched VideoDraft row might be mutated
    // elsewhere in a long-lived process.
    scene.duration = 999
    scenes.push(makeScene({ id: 'scene-2', order: 2, duration: 1 }))

    expect(snapshot.manifest.specification.duration_frames).toBe(framesBeforeMutation)
    expect(snapshot.manifest.segments).toHaveLength(1)
  })

  it('two independent snapshots of the same draft.id at different scene states are structurally distinct rows, never merged', () => {
    const { snapshot: snapshotA } = buildRenderExecutionSnapshot({
      draft: makeDraft([makeScene({ duration: 2 })]),
      identitySnapshot: IDENTITY_SNAPSHOT,
    })
    const { snapshot: snapshotB } = buildRenderExecutionSnapshot({
      draft: makeDraft([makeScene({ duration: 5 })]),
      identitySnapshot: IDENTITY_SNAPSHOT,
    })

    expect(snapshotA).not.toBe(snapshotB)
    expect(snapshotA.manifest).not.toBe(snapshotB.manifest)
    expect(snapshotA.manifest.specification.duration_frames).not.toBe(snapshotB.manifest.specification.duration_frames)
  })
})

describe('buildRenderExecutionSnapshot — no signed URL / no runtime credential persistence (Task 8)', () => {
  it('never contains a presigned S3/MinIO query-string signature', () => {
    const { snapshot } = buildRenderExecutionSnapshot({
      draft: makeDraft([makeScene()]),
      identitySnapshot: IDENTITY_SNAPSHOT,
    })
    const serialized = JSON.stringify(snapshot)

    expect(serialized).not.toContain('X-Amz-Signature')
    expect(serialized).not.toContain('X-Amz-Credential')
    expect(serialized).not.toContain('X-Amz-Expires')
    expect(serialized).not.toContain('Signature=')
  })

  it('never contains a real storage host (S3-compatible endpoint or internal MinIO hostname)', () => {
    const { snapshot } = buildRenderExecutionSnapshot({
      draft: makeDraft([makeScene()]),
      identitySnapshot: IDENTITY_SNAPSHOT,
    })
    const serialized = JSON.stringify(snapshot)

    expect(serialized).not.toContain('s3.multihuman.com.br')
    expect(serialized).not.toContain('minio:9000')
    expect(serialized).not.toContain('http://')
    expect(serialized).not.toContain('https://')
  })

  it('the hero asset for a bound scene is an opaque library_file reference, never a URL', () => {
    const { snapshot } = buildRenderExecutionSnapshot({
      draft: makeDraft([makeScene({ library_file_id: 'afa6868e-a2d6-473d-9df7-bbf713ad8b02' })]),
      identitySnapshot: IDENTITY_SNAPSHOT,
    })
    const hero = snapshot.manifest.segments[0]
    expect(hero.kind).toBe('template')
    if (hero.kind !== 'template') return
    expect(hero.payload.assets.hero).toEqual({
      type: 'library_file',
      ref: 'afa6868e-a2d6-473d-9df7-bbf713ad8b02',
      fit: 'cover',
    })
  })

  it('assertSnapshotHasNoSignedUrl passes for a real snapshot and throws for a deliberately-corrupted one', () => {
    const { snapshot } = buildRenderExecutionSnapshot({
      draft: makeDraft([makeScene()]),
      identitySnapshot: IDENTITY_SNAPSHOT,
    })
    expect(() => assertSnapshotHasNoSignedUrl(snapshot)).not.toThrow()

    const corrupted = {
      ...snapshot,
      identitySnapshot: { ...snapshot.identitySnapshot, snapshot_ref: 'https://s3.multihuman.com.br/leak?X-Amz-Signature=abc' },
    }
    expect(() => assertSnapshotHasNoSignedUrl(corrupted)).toThrow(/signed URL/)
  })

  it('the wrapper schema_version is the stable snapshot-shape marker, independent of the inner manifest schema_version', () => {
    const { snapshot } = buildRenderExecutionSnapshot({
      draft: makeDraft([makeScene()]),
      identitySnapshot: IDENTITY_SNAPSHOT,
    })
    expect(snapshot.schema_version).toBe(RENDER_EXECUTION_SNAPSHOT_SCHEMA_VERSION)
    expect(snapshot.manifest.schema_version).toBe('timeline.v0')
  })
})
