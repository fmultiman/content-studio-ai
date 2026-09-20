import React from 'react'
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion'

/**
 * Trivial, project-neutral visual used only to prove that a single React
 * component can serve both a <Still> and a <Composition> in this repo,
 * without depending on any domain code, Tailwind, next/font, or app aliases.
 *
 * Intentionally has no relation to Project/Production/Portal — see
 * Wave 1 constraints in docs/discovery/creative-rendering/.
 */
export const SpikeComposition: React.FC = () => {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()

  const progress = durationInFrames > 1 ? frame / (durationInFrames - 1) : 0

  const opacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  const scale = interpolate(progress, [0, 1], [0.92, 1.12], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  const rotate = interpolate(progress, [0, 1], [0, 45], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  return (
    <AbsoluteFill
      style={{
        backgroundColor: '#0f172a',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'Arial, Helvetica, sans-serif',
      }}
    >
      <div
        style={{
          width: 160,
          height: 160,
          borderRadius: 24,
          backgroundColor: '#38bdf8',
          marginBottom: 48,
          opacity,
          transform: `scale(${scale}) rotate(${rotate}deg)`,
        }}
      />
      <div
        style={{
          color: '#f8fafc',
          fontSize: 56,
          fontWeight: 700,
          letterSpacing: 1,
          opacity,
        }}
      >
        Creative Rendering Spike
      </div>
      <div
        style={{
          color: '#94a3b8',
          fontSize: 26,
          marginTop: 16,
          opacity,
        }}
      >
        Remotion isolation proof — Wave 1
      </div>
    </AbsoluteFill>
  )
}
