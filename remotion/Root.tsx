import React from 'react'
import { Composition, Still } from 'remotion'
import { documentaryCardPropsFromResolvedInput } from '@/components/creative/documentary-card'
import { documentaryCardFixtures } from '@/lib/creative/fixtures/documentary-card-fixtures'
import { DocumentaryCardComposition, DocumentaryCardStillComposition } from './DocumentaryCardComposition'
import { SpikeComposition } from './SpikeComposition'

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
    </>
  )
}
