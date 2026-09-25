import { describe, expect, it } from 'vitest'
import { CENTERED, applyViewportAction, canvasOrigin, clampPan } from '@/lib/creative/authoring/viewport'

describe('authoring viewport camera', () => {
  it('keeps the canvas recoverable while allowing useful pan', () => {
    expect(clampPan({ x: -999, y: 999 }, { width: 400, height: 300 }, { width: 800, height: 600 })).toEqual({ x: -520, y: 370 })
    expect(canvasOrigin({ width: 400, height: 300 }, { width: 800, height: 600 }, { x: 0, y: 0 })).toEqual({ left: -200, top: -150 })
  })

  it('implements fit, center and actual zoom as explicit camera actions', () => {
    const viewport = { width: 400, height: 300 }
    const scaled = { width: 800, height: 600 }
    expect(applyViewportAction({ zoom: 0.8, pan: { x: 20, y: 20 } }, 'center')).toEqual({ zoom: 0.8, pan: CENTERED })
    expect(applyViewportAction({ zoom: 0.8, pan: { x: 20, y: 20 } }, 'actual')).toEqual({ zoom: 1, pan: CENTERED })
    expect(applyViewportAction({ zoom: 0.8, pan: { x: 20, y: 20 } }, 'fit')).toEqual({ zoom: 'fit', pan: CENTERED })
  })
})
