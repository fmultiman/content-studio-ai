import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

// Wave 1 — Remotion Isolation Spike.
//
// Proves that no domain module imports Remotion. The allowed surface is
// intentionally narrow: the Remotion entry (remotion/**), the render
// scripts (scripts/creative/**), and the isolated dev preview route
// (app/dev/creative-preview/**). Everything else under app/, lib/ and
// components/ must stay Remotion-free — see
// docs/discovery/creative-rendering/RENDER_ARCHITECTURE_V0.md §8.

const PROJECT_ROOT = process.cwd()

const SCAN_ROOTS = ['app', 'lib', 'components']

const ALLOWED_PREFIXES = [join('app', 'dev', 'creative-preview')]

const SKIP_DIR_NAMES = new Set(['node_modules', '.next', '__tests__'])

const REMOTION_IMPORT_RE = /from\s+['"](remotion|@remotion\/[^'"]+)['"]/

function isAllowed(relPath: string): boolean {
  return ALLOWED_PREFIXES.some(
    (prefix) => relPath === prefix || relPath.startsWith(prefix + sep),
  )
}

function listSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIR_NAMES.has(entry)) continue
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      listSourceFiles(full, acc)
    } else if (/\.(ts|tsx)$/.test(entry)) {
      acc.push(full)
    }
  }
  return acc
}

describe('Wave 1 — Remotion isolation', () => {
  it('does not import remotion outside the allowed spike surface (app/dev/creative-preview only)', () => {
    const offenders: string[] = []

    for (const root of SCAN_ROOTS) {
      const dir = join(PROJECT_ROOT, root)
      let files: string[]
      try {
        files = listSourceFiles(dir)
      } catch {
        continue
      }

      for (const file of files) {
        const relPath = relative(PROJECT_ROOT, file)
        if (isAllowed(relPath)) continue

        const contents = readFileSync(file, 'utf8')
        if (REMOTION_IMPORT_RE.test(contents)) {
          offenders.push(relPath)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it('product code reaches the Remotion adapter only through the Live Authoring Player entry (Creative Editor Video Foundation V1)', () => {
    // RENDER_ARCHITECTURE_V1 §36 allows a Remotion Player as the Video Preview
    // Surface. It lives under remotion/player/ (adapter surface); product code
    // may import that one module and nothing else from remotion/.
    const ADAPTER_IMPORT_RE = /['"]@\/remotion\/([^'"]+)['"]/g
    const offenders: string[] = []
    for (const root of SCAN_ROOTS) {
      let files: string[]
      try {
        files = listSourceFiles(join(PROJECT_ROOT, root))
      } catch {
        continue
      }
      for (const file of files) {
        const relPath = relative(PROJECT_ROOT, file)
        if (isAllowed(relPath)) continue
        for (const match of readFileSync(file, 'utf8').matchAll(ADAPTER_IMPORT_RE)) {
          if (match[1] !== 'player/LiveTimelinePlayer') offenders.push(`${relPath} -> @/remotion/${match[1]}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('the allowed preview route verifies isolation: Wave 6 authoring lab uses DocumentaryCard directly, not via @remotion/player', () => {
    // Wave 6 replaced the Thumbnail/@remotion/player usage with a direct
    // DocumentaryCard render. The preview route is still the allowed surface,
    // but it now demonstrates even stronger Remotion isolation: the browser
    // preview does not depend on the Remotion player at all.
    const previewFile = join(PROJECT_ROOT, 'app', 'dev', 'creative-preview', 'page.tsx')
    const contents = readFileSync(previewFile, 'utf8')
    // Sanity: the route renders DocumentaryCard
    expect(contents).toContain('DocumentaryCard')
    // And does NOT need @remotion/player for the authoring preview
    expect(contents).not.toContain("from '@remotion/player'")
  })
})
