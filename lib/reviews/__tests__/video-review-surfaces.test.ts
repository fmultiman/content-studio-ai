import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// VIDEO_REVIEW_UI_AND_HISTORY_V1 — where the Review action lives, and that nothing else moved.

const root = process.cwd()
const read = (file: string) => readFileSync(join(root, file), 'utf8')

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(join(root, dir))) {
    if (entry === 'node_modules' || entry === '.next') continue
    const rel = `${dir}/${entry}`
    if (statSync(join(root, rel)).isDirectory()) sourceFiles(rel, acc)
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) acc.push(rel)
  }
  return acc
}

describe('Library (Arquivos)', () => {
  const page = read('app/(dashboard)/arquivos/page.tsx')

  it('offers Revisar only for live videos, never in the trash, and sends only the LibraryFile id', () => {
    const marker = page.indexOf('VideoReviewControl source=')
    expect(marker).toBeGreaterThan(0)
    const around = page.slice(marker - 260, marker + 160)
    expect(around).toContain('!showTrash && isLibraryFileReviewable(file)')
    expect(around).toContain("source={{ kind: 'library_file', id: file.id }}")
    expect(page.match(/<VideoReviewControl/g)).toHaveLength(1)
    // Nothing about the file's location or media facts is handed to the control.
    expect(around).not.toMatch(/public_url|storage_path|mime_type|file_size|thumbnail/)
  })

  it('leaves the existing image and file actions exactly where they were', () => {
    expect(page).toContain('openImagePreview(file.id)')
    expect(page).toContain('/api/library-files/${file.id}/download')
    expect(page).toContain('Visualizar')
    expect(page).toContain('Baixar')
    expect(page).toContain('openMoveDialog([file.id])')
    // The Review control lives inside the same CardActions that holds Visualizar/Baixar.
    const actions = page.slice(page.indexOf('<CardActions'), page.indexOf('</CardActions>'))
    expect(actions).toContain('VideoReviewControl')
    expect(actions.indexOf('Baixar')).toBeLessThan(actions.indexOf('VideoReviewControl'))
  })
})

describe('Video Generation workspace', () => {
  const page = read('app/(dashboard)/videos/geracoes/[sessionId]/page.tsx')

  it('offers Revisar on a completed result with a usable persisted video, sending only the generation id', () => {
    // Parity V1 added an explicit, user-click-only `onUseRefinedPrompt` hand-off before `source`; the request still carries only the generation id.
    const marker = page.indexOf('<VideoReviewControl')
    expect(marker).toBeGreaterThan(0)
    const around = page.slice(marker - 200, marker + 400)
    expect(around).toContain('isGenerationReviewable(generation)')
    expect(around).toContain("source={{ kind: 'video_generation', id: generation.id }}")
    expect(page.match(/<VideoReviewControl/g)).toHaveLength(1)
  })

  it('does not touch Session autosave, Attempt history, idempotency or the generation request', () => {
    for (const keep of ['useGenerationSessionAutosave', 'SessionSaveStatus', 'attempts-timeline-list', 'SaveGenerationToLibrary', 'clientRequestId']) {
      expect(page).toContain(keep)
    }
    // The Review code is isolated: the page imports only the control and the eligibility predicate.
    expect(page).not.toMatch(/video-review-result|\/api\/reviews\/video/)
  })
})

describe('boundaries of this mission', () => {
  it('the Review control is used by exactly the generation workspace and the Library page', () => {
    const importers = [...sourceFiles('app'), ...sourceFiles('components'), ...sourceFiles('lib')]
      .filter((file) => !file.startsWith('components/reviews/'))
      .filter((file) => /components\/reviews\/video-review-control/.test(read(file)))
      .sort()
    expect(importers).toEqual(['app/(dashboard)/arquivos/page.tsx', 'app/(dashboard)/videos/geracoes/[sessionId]/page.tsx'])
  })

  it('adds no provider or model selector, no usage/cost display and no automatic prompt adoption', () => {
    const ui = [read('components/reviews/video-review-control.tsx'), read('components/reviews/video-review-result.tsx')].join('\n')
    expect(ui).not.toMatch(/<Select|SelectItem|combobox|provider_usage|custo|R\$|\$\s?\d|gratuit/i)
    // Parity V1: the only adoption path is the optional, user-click `onUseRefinedPrompt` callback (button "Usar prompt refinado");
    // the Review UI never writes the workspace prompt itself.
    expect(ui).not.toMatch(/setPrompt|aplicar prompt/i)
    expect(read('components/reviews/video-review-result.tsx')).toMatch(/item\.status === 'completed' && onUseRefinedPrompt/)
  })

  it('never mutates a generation, a VideoDraft or a VideoScene', () => {
    const ui = [read('components/reviews/video-review-control.tsx'), read('components/reviews/video-review-result.tsx')].join('\n')
    expect(ui).not.toMatch(/video-generations|video-drafts|video_scenes|video-scenes|library-files|PATCH|PUT|DELETE/)
    // Its only requests: the history GET, the Review POST (same endpoint) and the credential STATUS read.
    expect(ui.match(/fetch\(/g)).toHaveLength(3)
    expect([...ui.matchAll(/['"`](\/api\/[^'"`?$]*)/g)].map((match) => match[1]).sort()).toEqual(['/api/reviews/video', '/api/settings/providers'])
    expect(ui.match(/method: 'POST'/g)).toHaveLength(1)
  })
})
