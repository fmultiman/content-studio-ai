/**
 * Pure state machine for the "Salvar nesta peca" action on a static
 * authoring render result. Deliberately has no knowledge of fetch, the
 * upload route, or React — only the transitions a save action can go
 * through, keyed by the render's own output_identifier so a new render
 * always invalidates a previous save confirmation without erasing it.
 */
export type SaveState = 'idle' | 'saving' | 'success' | 'error'

export type RenderSaveStatus = {
  state: SaveState
  error: string | null
  savedForOutputId: string | null
}

export function initialSaveStatus(): RenderSaveStatus {
  return { state: 'idle', error: null, savedForOutputId: null }
}

export function isSavedForCurrent(status: RenderSaveStatus, currentOutputId: string | null): boolean {
  return status.state === 'success' && currentOutputId !== null && status.savedForOutputId === currentOutputId
}

export function canSave(status: RenderSaveStatus, currentOutputId: string | null): boolean {
  if (currentOutputId === null) return false
  if (status.state === 'saving') return false
  if (isSavedForCurrent(status, currentOutputId)) return false
  return true
}

export function startSaving(status: RenderSaveStatus): RenderSaveStatus {
  return { state: 'saving', error: null, savedForOutputId: status.savedForOutputId }
}

export function saveSucceeded(outputId: string): RenderSaveStatus {
  return { state: 'success', error: null, savedForOutputId: outputId }
}

export function saveFailed(status: RenderSaveStatus, message: string): RenderSaveStatus {
  return { state: 'error', error: message, savedForOutputId: status.savedForOutputId }
}

export function resetForNewRender(status: RenderSaveStatus): RenderSaveStatus {
  return { state: 'idle', error: null, savedForOutputId: status.savedForOutputId }
}
