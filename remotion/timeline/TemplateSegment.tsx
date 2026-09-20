import React from 'react'
import { DocumentaryCard, documentaryCardPropsFromRuntimeInput } from '@/components/creative/documentary-card'
import type { ResolvedTimelineInput, ResolvedTimelineTemplateSegment } from '@/lib/creative/resolution/resolve-timeline'
import { resolveTemplateComponent } from '@/lib/creative/templates/component-resolver'
import { remotionProps } from '../DocumentaryCardComposition'
import { segmentFrameState } from './frame-model'

// Resolve the registered component once at the adapter module boundary. This
// keeps React's component identity stable while the segment still verifies the
// neutral component_key on every render.
const RegisteredDocumentaryCard = resolveTemplateComponent('editorial.documentary-card')

type TemplateSegmentProps = {
  globalFrame: number
  resolvedInput: ResolvedTimelineInput
  resolvedSegment: ResolvedTimelineTemplateSegment
}

/** Maps one resolved, neutral template segment into the shared visual tree. */
export const TemplateSegment: React.FC<TemplateSegmentProps> = ({ globalFrame, resolvedInput, resolvedSegment }) => {
  const { segment, resolvedAssets, resolvedTemplate } = resolvedSegment
  const state = segmentFrameState(globalFrame, segment.start_frame, segment.duration_frames)
  if (!state.visible || state.localFrame === null) return null

  if (resolvedTemplate.descriptor.component_key !== 'editorial.documentary-card' || !RegisteredDocumentaryCard) {
    throw new Error(`No visual component is registered for ${resolvedTemplate.descriptor.component_key}`)
  }
  const variant = resolvedTemplate.ref.variant
  if (variant !== 'cover' && variant !== 'info') throw new Error(`Unsupported timeline template variant: ${variant ?? '(missing)'}`)

  const props = documentaryCardPropsFromRuntimeInput({
    variant,
    content: segment.payload.content as never,
    assets: resolvedAssets,
    tokens: resolvedInput.tokens,
    canvas: {
      width: resolvedInput.manifest.specification.width,
      height: resolvedInput.manifest.specification.height,
      unit: 'px',
    },
    sequence: segment.payload.sequence,
  }, {
    mode: 'video',
    motion: segment.payload.motion,
    frame: state.localFrame,
    durationInFrames: segment.duration_frames,
  })

  // Registry selection proves the component_key boundary; all V0 registered
  // template components currently share the DocumentaryCard props contract.
  return <RegisteredDocumentaryCard {...remotionProps(props)} />
}
