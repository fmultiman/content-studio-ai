import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Wave 2 — Neutral Schemas.
//
// Proves that no core schema/enum/branch definition hardcodes the Portal
// Comunidades Alternativas fixture. Portal-flavored strings are allowed only
// in test fixtures (lib/schemas/creative/__tests__/fixtures.ts) and in
// discovery docs — never inside the contract modules themselves.

const SCHEMAS_DIR = join(process.cwd(), 'lib', 'schemas', 'creative')

const FORBIDDEN_LITERALS = [
  'Comunidades Alternativas',
  'comunidades-alternativas',
  'Terra Una',
  'terra-una',
  'Portal ',
]

function listNonTestSchemaFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      listNonTestSchemaFiles(full, acc)
    } else if (entry.endsWith('.ts')) {
      acc.push(full)
    }
  }
  return acc
}

describe('Wave 2 — core creative schemas carry no Portal-specific coupling', () => {
  it('contains no Portal/Terra Una literal in any contract module', () => {
    const offenders: { file: string; literal: string }[] = []

    for (const file of listNonTestSchemaFiles(SCHEMAS_DIR)) {
      const contents = readFileSync(file, 'utf8')
      for (const literal of FORBIDDEN_LITERALS) {
        if (contents.includes(literal)) {
          offenders.push({ file, literal })
        }
      }
    }

    expect(offenders).toEqual([])
  })
})
