import React from 'react'
import { Composition, Still } from 'remotion'
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
    </>
  )
}
