'use client'

import { ImagesPageShell } from '@/app/(dashboard)/imagens/page'

export default function ImageGenerationSessionPage({ params }: { params: { sessionId: string } }) {
  return <ImagesPageShell canonicalSessionId={params.sessionId} />
}
