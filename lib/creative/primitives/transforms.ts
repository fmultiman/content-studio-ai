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
  tape: PrimitiveTransforms
}

export const DEFAULT_PRIMITIVE_TRANSFORMS_STATE: PrimitiveTransformsBySlot = {
  paper: { ...DEFAULT_PRIMITIVE_TRANSFORMS },
  tape: { ...DEFAULT_PRIMITIVE_TRANSFORMS },
}
