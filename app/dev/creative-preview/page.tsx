'use client'

import { useMemo, useState } from 'react'
import { Thumbnail } from '@remotion/player'
import { DocumentaryCardComposition } from '@/remotion/DocumentaryCardComposition'
import { documentaryCardPropsFromResolvedInput } from '@/components/creative/documentary-card'
import { resolveDocumentaryCardFixture } from '@/lib/creative/fixtures/documentary-card-fixtures'

/**
 * Wave 4 — isolated Documentary Card preview. It uses local resolved
 * fixtures only and intentionally stays outside the dashboard/Supabase tree.
 */
export default function CreativeRenderingSpikePreviewPage() {
  const [variant, setVariant] = useState<'cover' | 'info'>('cover')
  const [canvas, setCanvas] = useState<'portrait' | 'reel'>('portrait')
  const [identity, setIdentity] = useState<'a' | 'b'>('a')
  const height = canvas === 'portrait' ? 1350 : 1920
  const input = useMemo(
    () => resolveDocumentaryCardFixture({ variant, identity, canvas: { width: 1080, height, unit: 'px' } }),
    [height, identity, variant],
  )
  const props = useMemo(
    () => documentaryCardPropsFromResolvedInput(input, 'video', { preset: 'slow_push', intensity: 0.35 }),
    [input],
  )

  return (
    <main
      style={{
        alignItems: 'center',
        backgroundColor: '#111827',
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
        justifyContent: 'center',
        minHeight: '100vh',
        padding: 24,
      }}
    >
      <p style={{ color: '#cbd5e1', fontFamily: 'monospace', fontSize: 13 }}>
        Documentary Card preview — Wave 4 (isolated, fixture-only)
      </p>
      <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center' }}>
        <label style={{ color: '#e2e8f0', fontFamily: 'monospace', fontSize: 12 }}>
          variant{' '}
          <select value={variant} onChange={(event) => setVariant(event.target.value as 'cover' | 'info')}>
            <option value="cover">cover</option>
            <option value="info">info</option>
          </select>
        </label>
        <label style={{ color: '#e2e8f0', fontFamily: 'monospace', fontSize: 12 }}>
          canvas{' '}
          <select value={canvas} onChange={(event) => setCanvas(event.target.value as 'portrait' | 'reel')}>
            <option value="portrait">1080×1350</option>
            <option value="reel">1080×1920</option>
          </select>
        </label>
        <label style={{ color: '#e2e8f0', fontFamily: 'monospace', fontSize: 12 }}>
          identity{' '}
          <select value={identity} onChange={(event) => setIdentity(event.target.value as 'a' | 'b')}>
            <option value="a">A</option>
            <option value="b">B</option>
          </select>
        </label>
      </div>
      <Thumbnail
        component={DocumentaryCardComposition}
        compositionWidth={1080}
        compositionHeight={height}
        durationInFrames={180}
        fps={30}
        frameToDisplay={72}
        inputProps={props}
        style={{ maxHeight: '74vh', width: 320 }}
      />
    </main>
  )
}
