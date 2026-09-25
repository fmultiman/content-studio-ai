/**
 * Creative Editor Video routes. No imports on purpose: used by proxy.ts
 * (every request) and by list surfaces, which must not pull the Template
 * registries into their bundles.
 */

/**
 * Canonical Creative Editor Video route for ONE VideoDraft.
 *
 * Neutral on purpose: the Creative Editor (authoring / composition) is an
 * independent surface, not a child of /videos. Long-term, /videos is AI
 * video/clip source-media generation plus that workflow's history/results
 * (analogous to /imagens); reusable media lives in the Library; outputs live
 * in the Gallery. /videos' links into this route are migration shortcuts, not
 * ownership; other entries (Video ChannelPieces, Project/Production context,
 * a VideoDraft link) may open the same route. The VideoDraft
 * id is the only authority in the URL; Project/Production context is read from
 * the draft itself — no ChannelPiece <-> VideoDraft link is implied.
 */
export const CREATIVE_EDITOR_VIDEO_BASE_PATH = '/creative-editor/video'

export function videoCreativeEditorHref(videoDraftId: string): string {
  return `${CREATIVE_EDITOR_VIDEO_BASE_PATH}/${encodeURIComponent(videoDraftId)}`
}

const VIDEO_DRAFT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * VideoDraft single writer (VIDEO_DRAFT_SINGLE_WRITER_AND_CANONICAL_ENTRY_V1).
 *
 * `/videos?draft=<id>` was the pre-Creative-Editor authoring workspace. It is
 * no longer a writer: any request for it is sent to the canonical editor.
 * Returns the redirect target, or null when the URL is not a legacy authoring
 * link. A malformed draft id falls back to the /videos hub (never an editor
 * URL built from untrusted input). Authentication and draft ownership are
 * NOT decided here — the canonical route is itself protected and loads the
 * draft through the ownership-scoped API.
 */
export function legacyVideoAuthoringRedirect(pathname: string, searchParams: URLSearchParams): string | null {
  if (pathname !== '/videos' && pathname !== '/videos/') return null
  const draftId = searchParams.get('draft')
  if (draftId === null) return null
  const trimmed = draftId.trim()
  return VIDEO_DRAFT_ID_RE.test(trimmed) ? videoCreativeEditorHref(trimmed.toLowerCase()) : '/videos'
}
