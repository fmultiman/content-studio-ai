import React from 'react'
import { DocumentaryCard, documentaryCardPropsFromRuntimeInput } from '@/components/creative/documentary-card'
import type { DocumentaryCardProps } from '@/components/creative/documentary-card'
import { QuoteCard, quoteCardPropsFromRuntimeInput } from '@/components/creative/quote-card'
import type { QuoteCardProps } from '@/components/creative/quote-card'
import type { ResolvedAsset } from '@/lib/creative/assets/resolve-asset'
import type { AuthoringRenderOverrides } from '@/lib/creative/authoring/render-request'
import type { CanvasSpec, MotionSpec, SequenceContext, VisualTokensSnapshot } from '@/lib/schemas/creative/primitives'
import type { PrimitiveTransforms } from '@/lib/creative/primitives/transforms'

/** Renderer-facing input shared by every registered template binding. */
export type TemplateComponentInput = {
  variant: string
  content: unknown
  assets: Record<string, ResolvedAsset>
  tokens: VisualTokensSnapshot
  canvas: CanvasSpec
  sequence?: SequenceContext
  primitiveMaterials?: DocumentaryCardProps['primitiveMaterials']
  primitiveTransforms?: Partial<Record<'paper' | 'tape', PrimitiveTransforms>>
}

export type TemplateComponentRuntime = {
  mode: 'still' | 'video'
  motion?: MotionSpec
  frame?: number
  durationInFrames?: number
  overrides?: AuthoringRenderOverrides
}

/** Template-specific payload conversion is isolated in this binding table. */
export type TemplateComponent = (props: unknown) => React.ReactNode

export type TemplateComponentBinding = {
  component: TemplateComponent
  createProps: (input: TemplateComponentInput, runtime: TemplateComponentRuntime) => unknown
}

const COMPONENT_BINDINGS: Readonly<Record<string, TemplateComponentBinding>> = {
  'editorial.documentary-card': {
    component: DocumentaryCard as unknown as TemplateComponent,
    createProps: (input, runtime) => documentaryCardPropsFromRuntimeInput({
      variant: input.variant as DocumentaryCardProps['variant'],
      content: input.content as DocumentaryCardProps['content'],
      assets: input.assets,
      tokens: input.tokens,
      canvas: input.canvas,
      sequence: input.sequence,
      primitiveMaterials: input.primitiveMaterials,
      primitiveTransforms: input.primitiveTransforms,
    }, {
      mode: runtime.mode,
      motion: runtime.motion,
      frame: runtime.frame,
      durationInFrames: runtime.durationInFrames,
      previewTuning: runtime.overrides?.documentaryCard,
    }),
  },
  'editorial.quote-card': {
    component: QuoteCard as unknown as TemplateComponent,
    createProps: (input, runtime) => quoteCardPropsFromRuntimeInput({
      variant: input.variant as QuoteCardProps['variant'],
      content: input.content as QuoteCardProps['content'],
      assets: input.assets,
      tokens: input.tokens,
      canvas: input.canvas,
      sequence: input.sequence,
    }, {
      mode: runtime.mode,
      motion: runtime.motion,
      frame: runtime.frame,
      durationInFrames: runtime.durationInFrames,
    }),
  },
}

export function resolveTemplateBinding(componentKey: string): TemplateComponentBinding | undefined {
  return COMPONENT_BINDINGS[componentKey]
}

/** Backward-compatible lookup for callers that only need component existence. */
export function resolveTemplateComponent(componentKey: string): TemplateComponent | undefined {
  return resolveTemplateBinding(componentKey)?.component
}

export function listTemplateComponentKeys(): readonly string[] {
  return Object.keys(COMPONENT_BINDINGS)
}
