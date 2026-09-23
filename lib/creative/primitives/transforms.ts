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
}

export const DEFAULT_PRIMITIVE_TRANSFORMS_STATE: PrimitiveTransformsBySlot = {
  paper: { offsetX: 0, offsetY: 0, rotation: 0, scale: 1, opacity: 1 },
  paperStrip: { offsetX: 0, offsetY: 0, rotation: 0, scale: 1, opacity: 1 },
  tape: { offsetX: 0, offsetY: 0, rotation: 0, scale: 1, opacity: 1 },
  tape1: { offsetX: 0, offsetY: 0, rotation: 0, scale: 1, opacity: 1 },
  tape2: { offsetX: 0, offsetY: 0, rotation: 0, scale: 1, opacity: 1 },
  tape3: { offsetX: 0, offsetY: 0, rotation: 0, scale: 1, opacity: 1 },
  botanical: { offsetX: 0, offsetY: 0, rotation: 0, scale: 1, opacity: 1 },
  pin: { offsetX: 0, offsetY: 0, rotation: 0, scale: 1, opacity: 1 },
}
