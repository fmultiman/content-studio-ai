import { describe, expect, it } from 'vitest'
import {
  adaptVideoDraftToTimelineManifest,
  type AdaptVideoDraftInput,
} from '@/lib/creative/timeline-adapter/video-draft-to-timeline'
import {
  patchResolvedTimelineAssets,
  prepareTimelineLibraryFileAssets,
} from '@/lib/creative/timeline-adapter/prepare-scene-assets'
import { resolveTimelineManifest } from '@/lib/creative/resolution/resolve-timeline'
import type { LibraryFile, VideoScene } from '@/lib/types'

const FIXTURE_IDENTITY = { snapshot_ref: 'fixture:identity:comunidades-alternativas:v1', token_profile: 'default' }

const REAL_SHAPED_LIBRARY_FILE: LibraryFile = {
  id: 'afa6868e-a2d6-473d-9df7-bbf713ad8b02',
  user_id: 'user-real-owner',
  project_id: '8659505e-cd48-4937-9dd9-3f18058210a0',
  folder: '/Portal Comunidades Alternativas/assets/pack-b-staging',
  name: 'paper-card-light-01.png',
  kind: 'image',
  mime_type: 'image/png',
  file_size: 1766502,
  storage_provider: 's3',
  storage_path: 'users/fixture-shaped/library/paper-card-light-01.png',
  public_url: 'https://s3.multihuman.com.br/content-studio/fixture-shaped/paper-card-light-01.png',
  thumbnail_url: null,
  deleted_at: null,
  created_at: '2026-06-22T00:00:00Z',
  updated_at: '2026-06-22T00:00:00Z',
}

function makeScene(overrides: Partial<VideoScene> = {}): VideoScene {
  return {
    id: 'scene-1',
    order: 1,
    description: 'render input proof scene',
    prompt: null,
    image_url: null,
    duration: 3,
    movement: 'zoom_in',
    ...overrides,
  }
}

function makeDraft(scenes: VideoScene[]): AdaptVideoDraftInput['draft'] {
  return { id: 'draft-2gc', project_id: REAL_SHAPED_LIBRARY_FILE.project_id, production_id: 'production-2gc', scenes }
}

const REAL_HERO_ASSET_REF = { type: 'library_file' as const, ref: REAL_SHAPED_LIBRARY_FILE.id, fit: 'cover' as const }

describe('render input — VideoDraft-shaped fixture produces a render-ready ResolvedTimelineInput', () => {
  it('produces a ResolvedTimelineInput whose hero is still the neutral placeholder before patching', () => {
    const draft = makeDraft([makeScene()])
    const { manifest } = adaptVideoDraftToTimelineManifest({ draft, identity: FIXTURE_IDENTITY, sceneAssets: { 'scene-1': REAL_HERO_ASSET_REF } })
    const resolved = resolveTimelineManifest(manifest)
    expect(resolved.valid).toBe(true)
    if (!resolved.valid) return
    const hero = resolved.value.resolvedTemplateSegments[0].resolvedAssets.hero
    expect(hero.source).toBe('library_file')
    expect(hero.url).toBe('') // neutral resolver's own placeholder, unchanged by this phase
  })

  it('patches the real, runtime-prepared asset into the resolved input (real-library-file-shaped binding survives to ResolvedAsset)', async () => {
    const context = { createPresignedReadUrl: async () => 'https://signed.example/render-proof' }
    const draft = makeDraft([makeScene()])
    const { manifest } = adaptVideoDraftToTimelineManifest({ draft, identity: FIXTURE_IDENTITY, sceneAssets: { 'scene-1': REAL_HERO_ASSET_REF } })
    const resolved = resolveTimelineManifest(manifest)
    expect(resolved.valid).toBe(true)
    if (!resolved.valid) return

    const { resolvedAssets: patch } = await prepareTimelineLibraryFileAssets(manifest, () => REAL_SHAPED_LIBRARY_FILE, context)
    const patched = patchResolvedTimelineAssets(resolved.value, patch)
    const hero = patched.resolvedTemplateSegments[0].resolvedAssets.hero
    expect(hero.source).toBe('library_file')
    expect(hero.mime_type).toBe('image/png')
    expect(hero.url).toBe('https://signed.example/render-proof')
  })

  it('leaves everything else in the resolved input untouched (manifest, tokens, typography, diagnostics)', async () => {
    const context = { createPresignedReadUrl: async () => 'https://signed.example/x' }
    const draft = makeDraft([makeScene()])
    const { manifest } = adaptVideoDraftToTimelineManifest({ draft, identity: FIXTURE_IDENTITY, sceneAssets: { 'scene-1': REAL_HERO_ASSET_REF } })
    const resolved = resolveTimelineManifest(manifest)
    if (!resolved.valid) throw new Error('fixture drift')
    const { resolvedAssets: patch } = await prepareTimelineLibraryFileAssets(manifest, () => REAL_SHAPED_LIBRARY_FILE, context)
    const patched = patchResolvedTimelineAssets(resolved.value, patch)
    expect(patched.manifest).toBe(resolved.value.manifest)
    expect(patched.tokens).toBe(resolved.value.tokens)
    expect(patched.typography).toBe(resolved.value.typography)
  })

  it('is a no-op when the patch is empty', () => {
    const draft = makeDraft([makeScene()])
    const { manifest } = adaptVideoDraftToTimelineManifest({ draft, identity: FIXTURE_IDENTITY, sceneAssets: { 'scene-1': REAL_HERO_ASSET_REF } })
    const resolved = resolveTimelineManifest(manifest)
    if (!resolved.valid) throw new Error('fixture drift')
    const patched = patchResolvedTimelineAssets(resolved.value, {})
    expect(patched).toBe(resolved.value)
  })

  it('preserves the expected frame range and motion for the single scene (timeline seam)', async () => {
    const context = { createPresignedReadUrl: async () => 'https://signed.example/x' }
    const draft = makeDraft([makeScene({ duration: 4, movement: 'zoom_in' })])
    const { manifest } = adaptVideoDraftToTimelineManifest({ draft, identity: FIXTURE_IDENTITY, sceneAssets: { 'scene-1': REAL_HERO_ASSET_REF } })
    const resolved = resolveTimelineManifest(manifest)
    if (!resolved.valid) throw new Error('fixture drift')
    const { resolvedAssets: patch } = await prepareTimelineLibraryFileAssets(manifest, () => REAL_SHAPED_LIBRARY_FILE, context)
    const patched = patchResolvedTimelineAssets(resolved.value, patch)
    const { segment } = patched.resolvedTemplateSegments[0]
    expect(segment.start_frame).toBe(0)
    expect(segment.duration_frames).toBe(120) // 4s * 30fps
    expect(segment.payload.motion).toEqual({ preset: 'slow_push' })
  })

  it('never surfaces a signed URL or storage_path anywhere in the manifest, only in the runtime-only patched ResolvedAsset', async () => {
    const context = { createPresignedReadUrl: async () => 'https://signed.example/should-not-leak' }
    const draft = makeDraft([makeScene()])
    const { manifest } = adaptVideoDraftToTimelineManifest({ draft, identity: FIXTURE_IDENTITY, sceneAssets: { 'scene-1': REAL_HERO_ASSET_REF } })
    expect(JSON.stringify(manifest)).not.toContain('signed.example')
    const resolved = resolveTimelineManifest(manifest)
    if (!resolved.valid) throw new Error('fixture drift')
    const { resolvedAssets: patch } = await prepareTimelineLibraryFileAssets(manifest, () => REAL_SHAPED_LIBRARY_FILE, context)
    const patched = patchResolvedTimelineAssets(resolved.value, patch)
    // The manifest embedded inside the resolved input is the same object -- still clean.
    expect(JSON.stringify(patched.manifest)).not.toContain('signed.example')
    // Only the (runtime-only, never persisted) resolvedAssets carry the URL.
    expect(patched.resolvedTemplateSegments[0].resolvedAssets.hero.url).toContain('signed.example')
  })
})
