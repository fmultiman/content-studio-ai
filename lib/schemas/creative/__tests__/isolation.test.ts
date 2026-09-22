import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Wave 2 — Neutral Schemas.
//
// The creative schema layer must stay renderer- and domain-agnostic: no
// remotion/@remotion/*, no React/Next, no Supabase/S3 client. This
// complements — does not replace — the broader Wave 1 sweep in
// lib/creative/__tests__/renderer-isolation.test.ts, which already covers
// this same directory as part of scanning all of lib/**.

const SCHEMAS_DIR = join(process.cwd(), 'lib', 'schemas', 'creative')

const FORBIDDEN_IMPORT_RE =
  /from\s+['"](remotion|@remotion\/[^'"]+|react|react-dom|next(?:\/[^'"]+)?|@\/lib\/supabase\/[^'"]+|@\/lib\/storage\/s3|@aws-sdk\/[^'"]+)['"]/

function listSchemaFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      listSchemaFiles(full, acc)
    } else if (entry.endsWith('.ts')) {
      acc.push(full)
    }
  }
  return acc
}

describe('Wave 2 — lib/schemas/creative/** stays renderer/domain agnostic', () => {
  it('does not import remotion, react, next, supabase, or S3 from any module', () => {
    const offenders: string[] = []

    for (const file of listSchemaFiles(SCHEMAS_DIR)) {
      const contents = readFileSync(file, 'utf8')
      if (FORBIDDEN_IMPORT_RE.test(contents)) {
        offenders.push(file)
      }
    }

    expect(offenders).toEqual([])
  })

  it('only imports zod and sibling schema modules', () => {
    // Matches the module specifier of every `from '...'` clause, regardless
    // of whether the import statement is single- or multi-line.
    const FROM_CLAUSE_RE = /from\s+['"]([^'"]+)['"]/g
    const ALLOWED_SPECIFIER_RE = /^(zod|\.\/[^'"]+)$/
    const offenders: string[] = []

    for (const file of listSchemaFiles(SCHEMAS_DIR)) {
      const contents = readFileSync(file, 'utf8')
      for (const match of contents.matchAll(FROM_CLAUSE_RE)) {
        const specifier = match[1]
        if (!ALLOWED_SPECIFIER_RE.test(specifier)) {
          offenders.push(`${file}: ${specifier}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })
})
