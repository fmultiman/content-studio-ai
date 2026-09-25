/**
 * Creative Editor Video — Inspector sections (UI-only labels).
 *
 * Same Inspector language as Static (lib/creative/authoring/editor-workspace.ts)
 * plus Motion. Deliberately NOT here:
 * - "Elementos": VideoScene carries no per-element state and the video adapter
 *   passes no element tuning/stack, so the tab would be empty (no symmetry tabs);
 * - a generic "Timing" tab: timing is contextual to the selected Scene and
 *   lives in the Inspector's Scene header, backed by the same VideoScene.duration
 *   the Timeline edge edits.
 */
export type VideoInspectorSection = 'template' | 'content' | 'assets' | 'style' | 'motion'

export const VIDEO_INSPECTOR_SECTIONS: readonly { value: VideoInspectorSection; label: string; compactLabel: string }[] = [
  { value: 'template', label: 'Template', compactLabel: 'Tpl.' },
  { value: 'content', label: 'Conteúdo', compactLabel: 'Cont.' },
  { value: 'assets', label: 'Assets', compactLabel: 'Assets' },
  { value: 'style', label: 'Estilo', compactLabel: 'Estilo' },
  { value: 'motion', label: 'Motion', compactLabel: 'Motion' },
]

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
