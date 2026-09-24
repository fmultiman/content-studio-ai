/** Shared renderer-neutral values for the paper/tape material slots. */
export interface PrimitiveTransforms {
  /** Render/CSS pixels. */
  offsetX: number
  /** Render/CSS pixels. */
  offsetY: number
  /** Degrees. */
  rotation: number
  /** Dimensionless multiplier. */
  scale: number
  /** Normalized opacity in [0, 1]. */
  opacity: number
}

export const DEFAULT_PRIMITIVE_TRANSFORMS: PrimitiveTransforms = {
  offsetX: 0,
  offsetY: 0,
  rotation: 0,
  scale: 1,
  opacity: 1,
}

export interface PrimitiveTransformsBySlot {
  paper: PrimitiveTransforms
  paperStrip: PrimitiveTransforms
  tape: PrimitiveTransforms
  tape1: PrimitiveTransforms
  tape2: PrimitiveTransforms
  tape3: PrimitiveTransforms
  botanical: PrimitiveTransforms
  pin: PrimitiveTransforms
  /** Creative Editor Template Foundation V1 — Pack B element channels (optional in persisted rows). */
  paperDark: PrimitiveTransforms
  botanicalLeaf: PrimitiveTransforms
  pin2: PrimitiveTransforms
  archival: PrimitiveTransforms
  ornament: PrimitiveTransforms
  note: PrimitiveTransforms
  card1: PrimitiveTransforms
}

/** Every per-element transform channel, legacy `tape` fallback included. */
export type PrimitiveTransformSlot = keyof PrimitiveTransformsBySlot
export const PRIMITIVE_TRANSFORM_SLOTS: readonly PrimitiveTransformSlot[] = [
  'paper', 'paperStrip', 'tape', 'tape1', 'tape2', 'tape3', 'botanical', 'pin',
  'paperDark', 'botanicalLeaf', 'pin2', 'archival', 'ornament', 'note', 'card1',
]

export const DEFAULT_PRIMITIVE_TRANSFORMS_STATE: PrimitiveTransformsBySlot = {
  paper: { offsetX: 0, offsetY: 0, rotation: 0, scale: 1, opacity: 1 },
  paperStrip: { offsetX: 0, offsetY: 0, rotation: 0, scale: 1, opacity: 1 },
  tape: { offsetX: 0, offsetY: 0, rotation: 0, scale: 1, opacity: 1 },
  tape1: { offsetX: 0, offsetY: 0, rotation: 0, scale: 1, opacity: 1 },
  tape2: { offsetX: 0, offsetY: 0, rotation: 0, scale: 1, opacity: 1 },
  tape3: { offsetX: 0, offsetY: 0, rotation: 0, scale: 1, opacity: 1 },
  botanical: { offsetX: 0, offsetY: 0, rotation: 0, scale: 1, opacity: 1 },
  pin: { offsetX: 0, offsetY: 0, rotation: 0, scale: 1, opacity: 1 },
  paperDark: { offsetX: 0, offsetY: 0, rotation: 0, scale: 1, opacity: 1 },
  botanicalLeaf: { offsetX: 0, offsetY: 0, rotation: 0, scale: 1, opacity: 1 },
  pin2: { offsetX: 0, offsetY: 0, rotation: 0, scale: 1, opacity: 1 },
  archival: { offsetX: 0, offsetY: 0, rotation: 0, scale: 1, opacity: 1 },
  ornament: { offsetX: 0, offsetY: 0, rotation: 0, scale: 1, opacity: 1 },
  note: { offsetX: 0, offsetY: 0, rotation: 0, scale: 1, opacity: 1 },
  card1: { offsetX: 0, offsetY: 0, rotation: 0, scale: 1, opacity: 1 },
}
