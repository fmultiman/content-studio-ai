'use client'

import { useParams } from 'next/navigation'
import { ImagesPageShell } from '@/app/(dashboard)/imagens/page'

// IMAGE_GENERATION_WORKSPACE_REGRESSION_RECOVERY_V1: in Next.js 16 the page `params` prop is a
// Promise, so reading the id synchronously off that prop yields `undefined` and silently rendered the
// hub instead of the canonical workspace. `useParams()` is the supported client-side accessor (the
// Video Generation Session route uses the same one).
export default function ImageGenerationSessionPage() {
  const params = useParams<{ sessionId: string }>()
  const sessionId = typeof params?.sessionId === 'string' && params.sessionId ? params.sessionId : undefined
  return <ImagesPageShell canonicalSessionId={sessionId} />
}
