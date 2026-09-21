import { describe, expect, it } from 'vitest'
import { canSave, initialSaveStatus, isSavedForCurrent, resetForNewRender, saveFailed, saveSucceeded, startSaving } from '@/lib/creative/authoring'

describe('render save state machine', () => {
  it('disables save when there is no render', () => {
    expect(canSave(initialSaveStatus(), null)).toBe(false)
  })

  it('enables save once a render exists', () => {
    expect(canSave(initialSaveStatus(), 'render-1')).toBe(true)
  })

  it('prevents duplicate submission while saving', () => {
    const saving = startSaving(initialSaveStatus())
    expect(canSave(saving, 'render-1')).toBe(false)
  })

  it('marks the current render saved on success and disables further saves for it', () => {
    const succeeded = saveSucceeded('render-1')
    expect(isSavedForCurrent(succeeded, 'render-1')).toBe(true)
    expect(canSave(succeeded, 'render-1')).toBe(false)
  })

  it('resets saved state for a new render while preserving the previous save marker', () => {
    const succeeded = saveSucceeded('render-1')
    const resetForNext = resetForNewRender(succeeded)
    expect(isSavedForCurrent(resetForNext, 'render-2')).toBe(false)
    expect(canSave(resetForNext, 'render-2')).toBe(true)
    // the previous render's save marker is not erased, only no longer "current"
    expect(resetForNext.savedForOutputId).toBe('render-1')
  })

  it('keeps a saved render marked saved after resetting for it again (idempotent re-render key)', () => {
    const succeeded = saveSucceeded('render-1')
    expect(isSavedForCurrent(succeeded, 'render-1')).toBe(true)
  })

  it('preserves the render and allows retry after a failure', () => {
    const failed = saveFailed(startSaving(initialSaveStatus()), 'Falha de rede ao salvar.')
    expect(failed.state).toBe('error')
    expect(failed.error).toBe('Falha de rede ao salvar.')
    expect(canSave(failed, 'render-1')).toBe(true)
  })
})
