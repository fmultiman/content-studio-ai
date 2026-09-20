import React from 'react'
import { Composition, Still, type CalculateMetadataFunction } from 'remotion'
import { documentaryCardPropsFromResolvedInput } from '@/components/creative/documentary-card'
import { documentaryCardFixtures } from '@/lib/creative/fixtures/documentary-card-fixtures'
import { documentaryCardTimelinePreview } from '@/lib/creative/fixtures/timeline-preview-fixtures'
import { resolveTimelineManifest } from '@/lib/creative/resolution/resolve-timeline'
import { DocumentaryCardComposition, DocumentaryCardStillComposition, StaticRenderManifestStillComposition, type StaticRenderManifestStillProps } from './DocumentaryCardComposition'
import { SpikeComposition } from './SpikeComposition'
import { TimelineComposition, type TimelineCompositionProps } from './timeline'

/**
 * Wave 1 — Remotion Isolation Spike entry root.
 *
 * Registers exactly two technical compositions used only to prove that
 * Remotion can render a still and a short video from this repo, sharing
 * one React component. No domain data, no Project Identity, no Portal
 * fixture, no database. See docs/discovery/creative-rendering/ for the
 * governing constraints.
 */
export const RemotionRoot: React.FC = () => {
  const coverStillProps = documentaryCardPropsFromResolvedInput(documentaryCardFixtures.cover45)
  const infoStillProps = documentaryCardPropsFromResolvedInput(documentaryCardFixtures.info45)
  const coverVideoProps = documentaryCardPropsFromResolvedInput(documentaryCardFixtures.cover916, 'video', { preset: 'slow_push', intensity: 0.35 })
  const infoVideoProps = documentaryCardPropsFromResolvedInput(documentaryCardFixtures.info45, 'video', { preset: 'fade', intensity: 0.2 })
  const coverNeutralStillProps = documentaryCardPropsFromResolvedInput(documentaryCardFixtures.coverNeutral45)
  const timelineResolved = resolveTimelineManifest(documentaryCardTimelinePreview)
  if (!timelineResolved.valid) throw new Error(`Timeline preview fixture failed resolution: ${JSON.stringify(timelineResolved.errors)}`)

  const calculateStaticMetadata: CalculateMetadataFunction<StaticRenderManifestStillProps> = ({ props }) => ({
    durationInFrames: 1,
    fps: 30,
    width: props.resolvedInput.manifest.canvas.width,
    height: props.resolvedInput.manifest.canvas.height,
  })
  const calculateTimelineMetadata: CalculateMetadataFunction<TimelineCompositionProps> = ({ props }) => ({
    durationInFrames: props.resolvedInput.manifest.specification.duration_frames,
    fps: props.resolvedInput.manifest.specification.fps,
    width: props.resolvedInput.manifest.specification.width,
    height: props.resolvedInput.manifest.specification.height,
  })

  return (
    <>
      <Still id="SpikeStill" component={SpikeComposition} width={1080} height={1350} />
      <Composition
        id="SpikeVideo"
        component={SpikeComposition}
        durationInFrames={180}
        fps={30}
        width={1080}
        height={1920}
      />
      <Still id="DocumentaryCardCoverStill" component={DocumentaryCardStillComposition} defaultProps={coverStillProps} width={1080} height={1350} />
      <Still id="DocumentaryCardInfoStill" component={DocumentaryCardStillComposition} defaultProps={infoStillProps} width={1080} height={1350} />
      <Still id="DocumentaryCardCoverNeutralStill" component={DocumentaryCardStillComposition} defaultProps={coverNeutralStillProps} width={1080} height={1350} />
      <Composition id="DocumentaryCardCoverVideo" component={DocumentaryCardComposition} defaultProps={coverVideoProps} durationInFrames={180} fps={30} width={1080} height={1920} />
      <Composition id="DocumentaryCardInfoVideo" component={DocumentaryCardComposition} defaultProps={infoVideoProps} durationInFrames={180} fps={30} width={1080} height={1350} />
      <Composition
        id="TimelineManifestPreview"
        component={TimelineComposition}
        defaultProps={{ resolvedInput: timelineResolved.value }}
        durationInFrames={180}
        fps={30}
        width={1080}
        height={1920}
        calculateMetadata={calculateTimelineMetadata}
      />
      <Composition
        id="StaticRenderManifestStill"
        component={StaticRenderManifestStillComposition}
        defaultProps={{ resolvedInput: documentaryCardFixtures.cover45 }}
        durationInFrames={1}
        fps={30}
        width={1080}
        height={1350}
        calculateMetadata={calculateStaticMetadata}
      />
    </>
  )
}
