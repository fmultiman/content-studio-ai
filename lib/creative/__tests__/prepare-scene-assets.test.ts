import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  adaptVideoDraftToTimelineManifest,
  type AdaptVideoDraftInput,
} from '@/lib/creative/timeline-adapter/video-draft-to-timeline'
import { prepareTimelineLibraryFileAssets } from '@/lib/creative/timeline-adapter/prepare-scene-assets'
import { TimelineManifestSchema } from '@/lib/schemas/creative/timeline'
import { resolveTimelineManifest } from '@/lib/creative/resolution/resolve-timeline'
import type { LibraryFile, VideoScene } from '@/lib/types'

const FIXTURE_IDENTITY = { snapshot_ref: 'fixture:identity:comunidades-alternativas:v1', token_profile: 'default' }

// Real-shaped LibraryFile (project 8659505e-cd48-4937-9dd9-3f18058210a0, "Portal Comunidades
// Alternativas"). storage_path here is a fixture-shaped placeholder, not the real path -- the
// real path was only used transiently for the live presign proof documented in
// PHASE_2G_B_TIMELINE_LIBRARYFILE_ASSET_BOUNDARY.md and never committed.
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
    description: 'Uma pessoa caminha por uma trilha ao amanhecer.',
    prompt: 'cinematic wide shot, golden hour',
    image_url: null,
    duration: 3,
    movement: 'static',
    ...overrides,
  }
}

function makeDraft(scenes: VideoScene[]): AdaptVideoDraftInput['draft'] {
  return { id: 'draft-2gb', project_id: REAL_SHAPED_LIBRARY_FILE.project_id, production_id: 'production-2gb', scenes }
}

const REAL_HERO_ASSET_REF = { type: 'library_file' as const, ref: REAL_SHAPED_LIBRARY_FILE.id, fit: 'cover' as const }

describe('adapter boundary — explicit scene asset binding', () => {
  it('places the caller-supplied library_file AssetRef into the manifest for a bound scene', () => {
    const draft = makeDraft([makeScene()])
    const { manifest } = adaptVideoDraftToTimelineManifest({
      draft,
      identity: FIXTURE_IDENTITY,
      sceneAssets: { 'scene-1': REAL_HERO_ASSET_REF },
    })
    const segment = manifest.segments[0]
    expect(segment.kind).toBe('template')
    if (segment.kind === 'template') {
      expect(segment.payload.assets.hero).toEqual(REAL_HERO_ASSET_REF)
    }
  })

  it('falls back to the default fixture hero for a scene with no explicit binding', () => {
    const draft = makeDraft([makeScene({ id: 'scene-unbound' })])
    const { manifest } = adaptVideoDraftToTimelineManifest({
      draft,
      identity: FIXTURE_IDENTITY,
      sceneAssets: { 'scene-1': REAL_HERO_ASSET_REF }, // does not match scene-unbound
    })
    const segment = manifest.segments[0]
    if (segment.kind === 'template') {
      expect(segment.payload.assets.hero.type).toBe('fixture')
    }
  })

  it('still ignores scene.image_url even when an explicit real binding is also supplied', () => {
    const draft = makeDraft([makeScene({ image_url: 'data:image/png;base64,SENSITIVE_MARKER' })])
    const { manifest, diagnostics } = adaptVideoDraftToTimelineManifest({
      draft,
      identity: FIXTURE_IDENTITY,
      sceneAssets: { 'scene-1': REAL_HERO_ASSET_REF },
    })
    expect(JSON.stringify(manifest)).not.toContain('SENSITIVE_MARKER')
    expect(JSON.stringify(manifest)).not.toContain('base64')
    const segment = manifest.segments[0]
    if (segment.kind === 'template') expect(segment.payload.assets.hero).toEqual(REAL_HERO_ASSET_REF)
    expect(diagnostics.some((d) => d.code === 'scene_image_url_not_used')).toBe(true)
  })

  it('never embeds storage_path, a signed URL, or an S3 endpoint in the manifest', () => {
    const draft = makeDraft([makeScene()])
    const { manifest } = adaptVideoDraftToTimelineManifest({
      draft,
      identity: FIXTURE_IDENTITY,
      sceneAssets: { 'scene-1': REAL_HERO_ASSET_REF },
    })
    const serialized = JSON.stringify(manifest)
    expect(serialized).not.toMatch(/storage_path|s3\.multihuman|X-Amz-Signature|amazonaws/i)
  })
})

describe('LibraryFile mapping', () => {
  it('accepts a real-shaped library_file AssetRef end to end through the manifest', () => {
    const draft = makeDraft([makeScene()])
    const { manifest } = adaptVideoDraftToTimelineManifest({ draft, identity: FIXTURE_IDENTITY, sceneAssets: { 'scene-1': REAL_HERO_ASSET_REF } })
    expect(TimelineManifestSchema.safeParse(manifest).success).toBe(true)
  })

  it('preserves the real MIME type through adaptLibraryFileToResolvedAsset', async () => {
    const context = { createPresignedReadUrl: async () => 'https://signed.example/fake-url' }
    const draft = makeDraft([makeScene()])
    const { manifest } = adaptVideoDraftToTimelineManifest({ draft, identity: FIXTURE_IDENTITY, sceneAssets: { 'scene-1': REAL_HERO_ASSET_REF } })
    const lookup = (ref: string) => (ref === REAL_SHAPED_LIBRARY_FILE.id ? REAL_SHAPED_LIBRARY_FILE : undefined)
    const { resolvedAssets } = await prepareTimelineLibraryFileAssets(manifest, lookup, context)
    const key = `${manifest.segments[0].id}:hero`
    expect(resolvedAssets[key].mime_type).toBe('image/png')
    expect(resolvedAssets[key].source).toBe('library_file')
  })
})

describe('runtime asset preparation', () => {
  it('produces a ResolvedAsset whose url only exists at runtime (never the storage_path)', async () => {
    const context = { createPresignedReadUrl: vi.fn(async (path: string) => `https://signed.example/${path.length}`) }
    const draft = makeDraft([makeScene()])
    const { manifest } = adaptVideoDraftToTimelineManifest({ draft, identity: FIXTURE_IDENTITY, sceneAssets: { 'scene-1': REAL_HERO_ASSET_REF } })
    const lookup = () => REAL_SHAPED_LIBRARY_FILE
    const { resolvedAssets } = await prepareTimelineLibraryFileAssets(manifest, lookup, context)
    const key = `${manifest.segments[0].id}:hero`
    expect(resolvedAssets[key].url).toMatch(/^https:\/\/signed\.example\//)
    expect(resolvedAssets[key].url).not.toBe(REAL_SHAPED_LIBRARY_FILE.storage_path)
    expect(context.createPresignedReadUrl).toHaveBeenCalledWith(REAL_SHAPED_LIBRARY_FILE.storage_path)
  })

  it('reports storage_path only as an internal field of ResolvedAsset.path, not a leaked secret', async () => {
    const context = { createPresignedReadUrl: async () => 'https://signed.example/x' }
    const draft = makeDraft([makeScene()])
    const { manifest } = adaptVideoDraftToTimelineManifest({ draft, identity: FIXTURE_IDENTITY, sceneAssets: { 'scene-1': REAL_HERO_ASSET_REF } })
    const { resolvedAssets } = await prepareTimelineLibraryFileAssets(manifest, () => REAL_SHAPED_LIBRARY_FILE, context)
    const key = `${manifest.segments[0].id}:hero`
    expect(resolvedAssets[key].path).toBe(REAL_SHAPED_LIBRARY_FILE.storage_path)
    // The manifest itself (checked above) never carries this -- only the runtime-only ResolvedAsset does.
  })

  it('fails explicitly (no silent fixture fallback) when the LibraryFile ref is unknown', async () => {
    const context = { createPresignedReadUrl: async () => 'https://signed.example/x' }
    const draft = makeDraft([makeScene()])
    const { manifest } = adaptVideoDraftToTimelineManifest({ draft, identity: FIXTURE_IDENTITY, sceneAssets: { 'scene-1': REAL_HERO_ASSET_REF } })
    const { resolvedAssets, diagnostics } = await prepareTimelineLibraryFileAssets(manifest, () => undefined, context)
    expect(Object.keys(resolvedAssets)).toHaveLength(0)
    expect(diagnostics.some((d) => d.code === 'library_file_not_found')).toBe(true)
  })

  it('fails explicitly when the LibraryFile is a non-image kind', async () => {
    const context = { createPresignedReadUrl: async () => 'https://signed.example/x' }
    const draft = makeDraft([makeScene()])
    const { manifest } = adaptVideoDraftToTimelineManifest({ draft, identity: FIXTURE_IDENTITY, sceneAssets: { 'scene-1': REAL_HERO_ASSET_REF } })
    const nonImageFile: LibraryFile = { ...REAL_SHAPED_LIBRARY_FILE, kind: 'document', mime_type: 'application/pdf' }
    const { resolvedAssets, diagnostics } = await prepareTimelineLibraryFileAssets(manifest, () => nonImageFile, context)
    expect(Object.keys(resolvedAssets)).toHaveLength(0)
    expect(diagnostics.some((d) => d.code === 'library_file_unresolvable')).toBe(true)
  })

  it('fails explicitly when presigning fails', async () => {
    const context = { createPresignedReadUrl: async () => null }
    const draft = makeDraft([makeScene()])
    const { manifest } = adaptVideoDraftToTimelineManifest({ draft, identity: FIXTURE_IDENTITY, sceneAssets: { 'scene-1': REAL_HERO_ASSET_REF } })
    const { resolvedAssets, diagnostics } = await prepareTimelineLibraryFileAssets(manifest, () => REAL_SHAPED_LIBRARY_FILE, context)
    expect(Object.keys(resolvedAssets)).toHaveLength(0)
    expect(diagnostics.some((d) => d.code === 'library_file_unresolvable')).toBe(true)
  })

  it('fails explicitly when storage_path is missing, without falling back to a fixture', async () => {
    const context = { createPresignedReadUrl: async () => 'https://signed.example/x' }
    const draft = makeDraft([makeScene()])
    const { manifest } = adaptVideoDraftToTimelineManifest({ draft, identity: FIXTURE_IDENTITY, sceneAssets: { 'scene-1': REAL_HERO_ASSET_REF } })
    const noPathFile: LibraryFile = { ...REAL_SHAPED_LIBRARY_FILE, storage_path: '' }
    const { resolvedAssets, diagnostics } = await prepareTimelineLibraryFileAssets(manifest, () => noPathFile, context)
    expect(Object.keys(resolvedAssets)).toHaveLength(0)
    expect(diagnostics.some((d) => d.code === 'library_file_unresolvable')).toBe(true)
  })
})

describe('timeline resolution with a real library_file asset', () => {
  it('validates through TimelineManifestSchema', () => {
    const draft = makeDraft([makeScene()])
    const { manifest } = adaptVideoDraftToTimelineManifest({ draft, identity: FIXTURE_IDENTITY, sceneAssets: { 'scene-1': REAL_HERO_ASSET_REF } })
    expect(TimelineManifestSchema.safeParse(manifest).success).toBe(true)
  })

  it('is accepted by resolveTimelineManifest (the neutral resolver still resolves library_file to its own placeholder)', () => {
    const draft = makeDraft([makeScene()])
    const { manifest } = adaptVideoDraftToTimelineManifest({ draft, identity: FIXTURE_IDENTITY, sceneAssets: { 'scene-1': REAL_HERO_ASSET_REF } })
    const result = resolveTimelineManifest(manifest)
    expect(result.valid).toBe(true)
  })

  it('the real hero, once runtime-prepared, reports source "library_file" with the real MIME and a runtime URL', async () => {
    const context = { createPresignedReadUrl: async () => 'https://signed.example/real-proof' }
    const draft = makeDraft([makeScene()])
    const { manifest } = adaptVideoDraftToTimelineManifest({ draft, identity: FIXTURE_IDENTITY, sceneAssets: { 'scene-1': REAL_HERO_ASSET_REF } })
    const result = resolveTimelineManifest(manifest)
    expect(result.valid).toBe(true)

    const { resolvedAssets } = await prepareTimelineLibraryFileAssets(manifest, () => REAL_SHAPED_LIBRARY_FILE, context)
    const key = `${manifest.segments[0].id}:hero`
    expect(resolvedAssets[key]).toMatchObject({ source: 'library_file', mime_type: 'image/png', url: 'https://signed.example/real-proof' })
  })
})

describe('isolation — no storage concerns leak into neutral/render layers', () => {
  const ADAPTER_DIR = join(process.cwd(), 'lib', 'creative', 'timeline-adapter')
  const FORBIDDEN_IMPORT_RE =
    /from\s+['"](remotion|@remotion\/[^'"]+|react|react-dom|next(?:\/[^'"]+)?|@\/lib\/supabase\/[^'"]+|@\/lib\/storage\/s3|@aws-sdk\/[^'"]+)['"]/

  function listFiles(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) listFiles(full, acc)
      else if (entry.endsWith('.ts')) acc.push(full)
    }
    return acc
  }

  it('lib/creative/timeline-adapter/** never imports Supabase, S3, Remotion, React, or Next', () => {
    const offenders: string[] = []
    for (const file of listFiles(ADAPTER_DIR)) {
      const contents = readFileSync(file, 'utf8')
      if (FORBIDDEN_IMPORT_RE.test(contents)) offenders.push(file)
    }
    expect(offenders).toEqual([])
  })

  it('DocumentaryCard has no Supabase/S3 import', () => {
    const STORAGE_IMPORT_RE = /from\s+['"](@\/lib\/supabase\/[^'"]+|@\/lib\/storage\/s3|@aws-sdk\/[^'"]+)['"]/
    const contents = readFileSync(join(process.cwd(), 'components', 'creative', 'documentary-card', 'DocumentaryCard.tsx'), 'utf8')
    expect(contents).not.toMatch(STORAGE_IMPORT_RE)
  })

  it('the Remotion timeline composition has no LibraryFile/Supabase lookup', () => {
    const contents = readFileSync(join(process.cwd(), 'remotion', 'timeline', 'TimelineComposition.tsx'), 'utf8')
    expect(contents).not.toMatch(/LibraryFile|@\/lib\/supabase|createPresignedReadUrl/)
  })
})
