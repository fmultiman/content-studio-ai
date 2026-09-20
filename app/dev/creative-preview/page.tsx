'use client'

import { Thumbnail } from '@remotion/player'
import { SpikeComposition } from '@/remotion/SpikeComposition'

/**
 * Wave 1 — Remotion Isolation Spike preview.
 *
 * Deliberately isolated: sibling of app/login and app/signup, outside the
 * (dashboard) route group, so it never mounts StudioShell or any component
 * that touches Supabase/domain state. It exists only to prove that the same
 * React component used for server-side still/video rendering can also drive
 * a live in-app preview (@remotion/player), per RENDER_ARCHITECTURE_V0.md
 * §10 (preview and final render must share the same visual tree).
 *
 * Not linked from sidebar-navigation.ts. Does not replace or modify any
 * existing /imagens or /videos UI.
 */
export default function CreativeRenderingSpikePreviewPage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 24,
        backgroundColor: '#020617',
        padding: 24,
      }}
    >
      <p style={{ color: '#94a3b8', fontFamily: 'monospace', fontSize: 13 }}>
        Creative Rendering Spike — Wave 1 (isolated dev route, no domain/DB access)
      </p>
      <Thumbnail
        component={SpikeComposition}
        compositionWidth={1080}
        compositionHeight={1920}
        durationInFrames={180}
        fps={30}
        frameToDisplay={60}
        style={{ width: 320 }}
      />
    </main>
  )
}
