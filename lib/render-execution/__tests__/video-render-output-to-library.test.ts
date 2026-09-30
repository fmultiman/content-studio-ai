import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  validateVideoRenderLibrarySource,
  videoRenderLibraryFilename,
  type VideoRenderLibrarySource,
} from '../video-render-library'

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf-8')

const USER_ID = '11111111-1111-4111-8111-111111111111'
const EXECUTION_ID = '22222222-2222-4222-8222-222222222222'
const PROJECT_ID = '33333333-3333-4333-8333-333333333333'
const DRAFT_ID = '44444444-4444-4444-8444-444444444444'
const SCRATCH_PATH = `users/${USER_ID}/renders/scratch/${EXECUTION_ID}/output.mp4`
const ENV = { RENDER_EXECUTION_SCRATCH_BUCKET: 'content-studio' }

function execution(overrides: Partial<VideoRenderLibrarySource> = {}): VideoRenderLibrarySource {
  return {
    id: EXECUTION_ID,
    user_id: USER_ID,
    project_id: PROJECT_ID,
    video_draft_id: DRAFT_ID,
    kind: 'video',
    status: 'completed',
    output_bucket: 'content-studio',
    output_storage_path: SCRATCH_PATH,
    output_mime_type: 'video/mp4',
    output_size_bytes: 988_731,
    ...overrides,
  }
}

describe('Video render -> Library eligibility', () => {
  it('accepts only a completed video at its exact authoritative scratch target', () => {
    expect(validateVideoRenderLibrarySource(execution(), ENV)).toEqual({
      ok: true,
      bucket: 'content-studio',
      storagePath: SCRATCH_PATH,
      mimeType: 'video/mp4',
      sizeBytes: 988_731,
    })
  })

  it.each(['queued', 'claimed', 'failed'])('rejects %s executions', (status) => {
    expect(validateVideoRenderLibrarySource(execution({ status }), ENV)).toEqual({ ok: false, code: 'EXECUTION_NOT_COMPLETED' })
  })

  it('rejects a static render', () => {
    expect(validateVideoRenderLibrarySource(execution({ kind: 'static_still' }), ENV)).toEqual({ ok: false, code: 'NOT_VIDEO_RENDER' })
  })

  it('rejects missing output metadata and a forged scratch key', () => {
    expect(validateVideoRenderLibrarySource(execution({ output_storage_path: null }), ENV)).toEqual({ ok: false, code: 'OUTPUT_UNAVAILABLE' })
    expect(validateVideoRenderLibrarySource(execution({ output_storage_path: `users/${USER_ID}/library/fake/output.mp4` }), ENV)).toEqual({ ok: false, code: 'INVALID_OUTPUT_TARGET' })
  })

  it('rejects missing Project provenance and non-MP4 output', () => {
    expect(validateVideoRenderLibrarySource(execution({ project_id: null }), ENV)).toEqual({ ok: false, code: 'MISSING_PROJECT' })
    expect(validateVideoRenderLibrarySource(execution({ output_mime_type: 'video/webm' }), ENV)).toEqual({ ok: false, code: 'INVALID_OUTPUT_MIME' })
  })

  it('uses the same deterministic attachment filename identity as the execution', () => {
    expect(videoRenderLibraryFilename(EXECUTION_ID)).toBe(`render-${EXECUTION_ID}.mp4`)
  })
})

describe('POST /api/render-executions/:id/save-to-library authority', () => {
  const route = read('app', 'api', 'render-executions', '[id]', 'save-to-library', 'route.ts')

  it('accepts only the execution id and derives user, Project, draft and output server-side', () => {
    expect(route).toMatch(/supabase\.auth\.getUser\(\)/)
    expect(route).toMatch(/\.from\('render_executions'\)[\s\S]*\.eq\('id', id\)[\s\S]*\.eq\('user_id', user\.id\)/)
    expect(route).toMatch(/\.from\('projects'\)[\s\S]*\.eq\('id', execution\.project_id\)[\s\S]*\.eq\('user_id', user\.id\)/)
    expect(route).toMatch(/\.from\('video_drafts'\)[\s\S]*\.eq\('id', execution\.video_draft_id\)[\s\S]*\.eq\('user_id', user\.id\)/)
    expect(route).not.toMatch(/request\.json|projectId|storagePath: body|outputUrl/)
  })

  it('checks provenance idempotency before copying any bytes', () => {
    const lookup = route.indexOf(".eq('source_render_execution_id', id)")
    const copy = route.indexOf('await copyS3ObjectToLibrary(')
    expect(lookup).toBeGreaterThan(-1)
    expect(copy).toBeGreaterThan(lookup)
    expect(route).toMatch(/result: 'already_saved'/)
    expect(route).toMatch(/result: 'created'/)
  })

  it('creates the durable record from trusted render provenance', () => {
    expect(route).toMatch(/project_id: execution\.project_id/)
    expect(route).toMatch(/folder: projectRoot\?\.path \|\| '\/'/)
    expect(route).toMatch(/kind: 'video'/)
    expect(route).toMatch(/mime_type: eligibility\.mimeType/)
    expect(route).toMatch(/origin: 'studio_render'/)
    expect(route).toMatch(/source_render_execution_id: id/)
    expect(route).toMatch(/storage_path: copied\.storagePath/)
  })

  it('does not attach ChannelPiece media, publish, approve, or mutate authoring', () => {
    expect(route).not.toMatch(/channel_piece_media|channel_pieces|editorial_contents/)
    expect(route).not.toMatch(/approved|publish|publication/)
    expect(route).not.toMatch(/\.from\('video_drafts'\)[\s\S]*\.update\(/)
    expect(route).not.toMatch(/\.from\('render_executions'\)[\s\S]*\.update\(/)
  })

  it('rejects an unreadable/missing source object and compensates a failed durable record', () => {
    expect(route).toMatch(/source copy failed[\s\S]*code: 'OUTPUT_UNAVAILABLE'/)
    expect(route).toMatch(/LibraryFile insert failed[\s\S]*deleteS3Object\(copied\.storagePath\)/)
  })
})

describe('durable bytes and consumption boundaries', () => {
  const storage = read('lib', 'storage', 's3.ts')
  const copyFunction = storage.slice(storage.indexOf('export async function copyS3ObjectToLibrary'), storage.indexOf('// Uploads a binary buffer directly to S3'))
  const libraryDownload = read('app', 'api', 'library-files', '[id]', 'download', 'route.ts')
  const outputUrl = read('app', 'api', 'render-executions', '[id]', 'output-url', 'route.ts')

  it('HEAD-checks then copies scratch into the Library namespace without deleting scratch', () => {
    expect(copyFunction).toMatch(/HeadObjectCommand/)
    expect(copyFunction).toMatch(/users\/\$\{input\.userId\}\/library\/\$\{id\}/)
    expect(copyFunction).toMatch(/CopyObjectCommand/)
    expect(copyFunction).not.toMatch(/DeleteObjectCommand/)
  })

  it('keeps both normal Library download and original render output signing valid', () => {
    // LIBRARY_FILE_REGISTRATION_TRUST_HARDENING_V1: the Library download signs through the owner-proving wrapper.
    expect(libraryDownload).toMatch(/presignLibraryRead\(file/)
    expect(outputUrl).toMatch(/createPresignedReadUrl\(execution\.output_storage_path/)
  })
})

describe('Arquivos / Gallery federation', () => {
  const arquivos = read('app', '(dashboard)', 'arquivos', 'page.tsx')
  const galeria = read('app', '(dashboard)', 'galeria', 'page.tsx')
  const galleryLibrary = read('lib', 'gallery-output-library.ts')

  it('shows uploads plus explicitly durable video renders in Arquivos, while keeping static studio PNGs out', () => {
    expect(arquivos).toMatch(/params\.set\('origin', 'all'\)/)
    expect(arquivos).toMatch(/file\.origin !== 'studio_render' \|\| file\.kind === 'video'/)
    expect(arquivos).toMatch(/projectRootSelected/)
  })

  it('keeps Gallery video history on render executions and studio LibraryFiles image-only, preventing a duplicate MP4 card', () => {
    expect(galeria).toMatch(/\/api\/gallery\/video-outputs/)
    expect(galeria).toMatch(/origin=studio_render&kind=image/)
    expect(galleryLibrary).toMatch(/file\.origin === 'studio_render'[\s\S]*file\.kind \?\? 'image'\) === 'image'/)
  })
})

describe('Video Editor durable-save UX', () => {
  const page = read('app', '(dashboard)', 'creative-editor', 'video', '[draftId]', 'page.tsx')

  it('exposes an explicit completed-output action distinct from Save and Render', () => {
    expect(page).toMatch(/Salvar em Arquivos/)
    expect(page).toMatch(/save-output-to-library/)
    expect(page).toMatch(/Salvo em Arquivos/)
    expect(page).toMatch(/\/save-to-library/)
  })

  it('never routes durable save through saveNow or renderVideo', () => {
    const saveOutput = page.slice(page.indexOf('async function saveOutputToLibrary()'), page.indexOf('async function generatePrompt()'))
    expect(saveOutput).not.toMatch(/saveNow\(|renderVideo\(|setScenes\(|setTimeline\(|setVideoCanvas\(/)
  })

  it('hydrates durable-save truth from server execution summaries', () => {
    expect(page).toMatch(/renderExecution\?\.saved_to_library/)
    expect(page).toMatch(/library_file_id/)
  })
})
