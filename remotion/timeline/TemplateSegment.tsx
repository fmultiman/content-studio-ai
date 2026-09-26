import React from 'react'
import type { ResolvedTimelineInput, ResolvedTimelineTemplateSegment } from '@/lib/creative/resolution/resolve-timeline'
import { resolveTemplateBinding } from '@/lib/creative/templates/component-resolver'
import { remotionTemplateProps } from '../DocumentaryCardComposition'
import { segmentFrameState } from './frame-model'
import type { DocumentaryCardProps } from '@/components/creative/documentary-card'

type TemplateSegmentProps = {
  globalFrame: number
  resolvedInput: ResolvedTimelineInput
  resolvedSegment: ResolvedTimelineTemplateSegment
  primitiveMaterials?: DocumentaryCardProps['primitiveMaterials']
  primitiveTransforms?: DocumentaryCardProps['primitiveTransforms']
  /**
   * Final template-props step. Defaults to the Remotion-bundle URL normalizer
   * (final render path, unchanged). The browser Live Authoring Player serves
   * fixture/material URLs from Next's public root and passes an identity.
   */
  adaptTemplateProps?: <T>(props: T) => T
}

/** Maps one resolved, neutral template segment into the shared visual tree. */
export const TemplateSegment: React.FC<TemplateSegmentProps> = ({ globalFrame, resolvedInput, resolvedSegment, primitiveMaterials, primitiveTransforms, adaptTemplateProps = remotionTemplateProps }) => {
  const { segment, resolvedAssets, resolvedTemplate } = resolvedSegment
  const state = segmentFrameState(globalFrame, segment.start_frame, segment.duration_frames)
  if (!state.visible || state.localFrame === null) return null

  const binding = resolveTemplateBinding(resolvedTemplate.descriptor.component_key)
  if (!binding) {
    throw new Error(`No visual component is registered for ${resolvedTemplate.descriptor.component_key}`)
  }
  // VIDEO_SCENE_COMPOSITION_PARITY_V1: the Scene's appearance and element
  // stack reach the shared visual tree exactly like a Static slide's. Absent
  // (older manifests) = the template's previous defaults, unchanged.
  const props = binding.createProps({
    variant: resolvedTemplate.ref.variant,
    appearance: resolvedTemplate.ref.appearance,
    elementOrder: segment.payload.layering?.element_order,
    hiddenElements: segment.payload.layering?.hidden_elements,
    content: segment.payload.content,
    assets: resolvedAssets,
    tokens: resolvedInput.tokens,
    canvas: {
      width: resolvedInput.manifest.specification.width,
      height: resolvedInput.manifest.specification.height,
      unit: 'px',
    },
    sequence: segment.payload.sequence,
    primitiveMaterials,
    primitiveTransforms,
  }, {
    mode: 'video',
    motion: segment.payload.motion,
    frame: state.localFrame,
    durationInFrames: segment.duration_frames,
  })

  return <>{binding.component(adaptTemplateProps(props))}</>
}
