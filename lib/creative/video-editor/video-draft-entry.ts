/**
 * Creating a VideoDraft is not editing it: every creation entry (the /videos
 * hub, a Production) creates the draft through the existing
 * `POST /api/video-drafts` authority and then hands off to the ONE canonical
 * authoring surface, `/creative-editor/video/[draftId]`.
 */
import { createVideoScene } from './video-authoring'
import { videoCreativeEditorHref } from './video-routes'

export type CreateVideoDraftResult = { ok: true; draftId: string; href: string } | { ok: false; error: string }

export async function createVideoDraftForCreativeEditor(input: {
  projectId: string
  productionId: string
  name?: string
  fetchImpl?: typeof fetch
}): Promise<CreateVideoDraftResult> {
  const doFetch = input.fetchImpl ?? fetch
  try {
    const response = await doFetch('/api/video-drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: input.name ?? 'Novo vídeo',
        projectId: input.projectId,
        productionId: input.productionId,
        scenes: [createVideoScene([])],
      }),
    })
    const payload = await response.json().catch(() => null) as { draft?: { id?: string }; error?: string } | null
    const draftId = payload?.draft?.id
    if (!response.ok || !draftId) return { ok: false, error: payload?.error || 'Não foi possível criar o vídeo.' }
    return { ok: true, draftId, href: videoCreativeEditorHref(draftId) }
  } catch {
    return { ok: false, error: 'Não foi possível criar o vídeo.' }
  }
}
