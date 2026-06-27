import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  readViewModePreference,
  resolveViewMode,
  writeViewModePreference,
  type ViewModeStorage,
} from '../view-mode-preference'

function createStorage(initial: Record<string, string> = {}): ViewModeStorage & { values: Record<string, string> } {
  const values = { ...initial }

  return {
    values,
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => {
      values[key] = value
    },
  }
}

describe('view mode preference helpers', () => {
  it('uses a configurable default mode', () => {
    expect(resolveViewMode(null, 'card')).toBe('card')
    expect(readViewModePreference(null, 'image-hub', 'list')).toBe('list')
  })

  it('reads and writes list/card preferences', () => {
    const storage = createStorage()

    writeViewModePreference(storage, 'image-hub', 'card')

    expect(readViewModePreference(storage, 'image-hub', 'list')).toBe('card')
  })

  it('falls back when a saved value is invalid', () => {
    const storage = createStorage({ 'image-hub': 'table' })

    expect(readViewModePreference(storage, 'image-hub', 'list')).toBe('list')
  })

  it('does not throw without storage', () => {
    expect(readViewModePreference(undefined, 'image-hub', 'list')).toBe('list')
    expect(() => writeViewModePreference(undefined, 'image-hub', 'card')).not.toThrow()
  })

  it('keeps image and video preferences isolated by key', () => {
    const storage = createStorage()

    writeViewModePreference(storage, 'image-hub', 'card')
    writeViewModePreference(storage, 'video-hub', 'list')

    expect(readViewModePreference(storage, 'image-hub', 'list')).toBe('card')
    expect(readViewModePreference(storage, 'video-hub', 'card')).toBe('list')
  })

  it('keeps the toggle on native button keyboard semantics', () => {
    const source = readFileSync(join(process.cwd(), 'components/ui/view-mode-toggle.tsx'), 'utf8')

    expect(source).toContain('type="button"')
    expect(source).toContain('aria-pressed={value ===')
    expect(source).toContain("onClick={() => onValueChange('list')}")
    expect(source).toContain("onClick={() => onValueChange('card')}")
    expect(source).not.toContain('onKeyDown')
    expect(source).not.toContain('preventDefault')
    expect(source).not.toContain('tabIndex')
  })
})
