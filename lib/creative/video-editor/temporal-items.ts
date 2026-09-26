/**
 * VIDEO_TIMELINE_GATE_B_INDEPENDENT_TEMPORAL_COMPOSITION_V1 — the VideoDraft's
 * authored INDEPENDENT temporal layer (`video_drafts.timeline`).
 *
 * The primary Scene sequence stays in `scenes` (contiguous, derived starts).
 * Independent items have their OWN absolute placement on the root timeline,
 * so they can overlap Scenes, cross Scene boundaries and span the draft:
 *
 *   visual (B-roll)   -> a Project LibraryFile (image or video) over the Scene
 *   text  (lower third)-> one bounded text presentation over everything
 *   audio             -> a Project LibraryFile (audio) under the whole mix
 *
 * Domain rules (no engine concepts here):
 *  - frames are canonical (timeline.v0 is frame-based; 30 fps);
 *  - anchoring is ABSOLUTE: an item keeps its frames when Scenes are reordered
 *    or retimed (it does not follow a Scene);
 *  - one lane per kind: items of the same kind never overlap, which makes
 *    stacking deterministic without a persisted Track;
 *  - Track and Segment are DERIVED here (manifest contract), never authored.
 */
import type { AssetRef } from '@/lib/schemas/creative/primitives'
import type { TimelineSegment, TimelineTrack } from '@/lib/schemas/creative/timeline'

export const VIDEO_TIMELINE_VERSION = 1 as const
export const TEMPORAL_ITEM_KINDS = ['visual', 'text', 'audio'] as const
export type TemporalItemKind = (typeof TEMPORAL_ITEM_KINDS)[number]

type Envelope = {
  id: string
  /** Absolute root-timeline frame (30 fps). */
  start_frame: number
  /** Placement duration in frames — NOT a source trim (source in/out is out of scope). */
  duration_frames: number
}
export type VisualItem = Envelope & { kind: 'visual'; library_file_id: string; fit?: 'cover' | 'contain' }
export type TextItem = Envelope & { kind: 'text'; style: 'lower_third'; text: string }
export type AudioItem = Envelope & { kind: 'audio'; library_file_id: string; volume: number }
export type TemporalItem = VisualItem | TextItem | AudioItem

export type VideoTimeline = { version: typeof VIDEO_TIMELINE_VERSION; items: TemporalItem[] }

export const MAX_TEMPORAL_ITEMS = 60
export const MIN_ITEM_FRAMES = 15 // 0.5 s, same floor as a primary Scene
export const MAX_ITEM_FRAMES = 30 * 60 * 10 // 10 min
export const MAX_TEXT_LENGTH = 120
export const DEFAULT_ITEM_FRAMES = 60 // 2 s

export const EMPTY_TIMELINE: VideoTimeline = { version: VIDEO_TIMELINE_VERSION, items: [] }

/** Lane label order (UI) and paint order (render): primary < visual < text; audio has no picture. */
export const TEMPORAL_LANES: readonly { kind: TemporalItemKind; label: string }[] = [
  { kind: 'visual', label: 'B-roll' },
  { kind: 'text', label: 'Texto' },
  { kind: 'audio', label: 'Áudio' },
]

export function itemEndFrame(item: Pick<Envelope, 'start_frame' | 'duration_frames'>): number {
  return item.start_frame + item.duration_frames
}

/** Loaded value -> typed timeline. NULL/absent (every draft before Gate B) = no independent items. Never rewrites storage. */
export function readVideoTimeline(raw: unknown): VideoTimeline {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { items?: unknown }).items)) return EMPTY_TIMELINE
  return { version: VIDEO_TIMELINE_VERSION, items: (raw as { items: TemporalItem[] }).items }
}

/** What persists: null when there is nothing, so untouched drafts stay byte-identical. */
export function persistedVideoTimeline(timeline: VideoTimeline): VideoTimeline | null {
  return timeline.items.length > 0 ? { version: VIDEO_TIMELINE_VERSION, items: timeline.items } : null
}

// ── Validation (write boundary) ───────────────────────────────────────────────

const isInt = (value: unknown, min: number, max: number): value is number => Number.isInteger(value) && (value as number) >= min && (value as number) <= max
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ENVELOPE_KEYS = ['id', 'kind', 'start_frame', 'duration_frames']
const PAYLOAD_KEYS: Record<TemporalItemKind, string[]> = {
  visual: ['library_file_id', 'fit'],
  text: ['style', 'text'],
  audio: ['library_file_id', 'volume'],
}

export type TimelineValidation = { ok: true } | { ok: false; message: string }

function validateItem(raw: unknown, index: number): TimelineValidation {
  const label = `Item ${index + 1}`
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, message: `${label}: inválido.` }
  const item = raw as Record<string, unknown>
  if (!TEMPORAL_ITEM_KINDS.includes(item.kind as TemporalItemKind)) return { ok: false, message: `${label}: tipo desconhecido.` }
  const kind = item.kind as TemporalItemKind
  for (const key of Object.keys(item)) {
    if (!ENVELOPE_KEYS.includes(key) && !PAYLOAD_KEYS[kind].includes(key)) return { ok: false, message: `${label}: campo desconhecido ${key}.` }
  }
  if (typeof item.id !== 'string' || !ID_RE.test(item.id)) return { ok: false, message: `${label}: id inválido.` }
  if (!isInt(item.start_frame, 0, MAX_ITEM_FRAMES)) return { ok: false, message: `${label}: início inválido.` }
  if (!isInt(item.duration_frames, MIN_ITEM_FRAMES, MAX_ITEM_FRAMES)) return { ok: false, message: `${label}: duração inválida.` }
  if (kind === 'visual') {
    if (typeof item.library_file_id !== 'string' || !UUID_RE.test(item.library_file_id)) return { ok: false, message: `${label}: arquivo inválido.` }
    if (item.fit !== undefined && item.fit !== 'cover' && item.fit !== 'contain') return { ok: false, message: `${label}: enquadramento inválido.` }
  } else if (kind === 'text') {
    if (item.style !== 'lower_third') return { ok: false, message: `${label}: estilo inválido.` }
    if (typeof item.text !== 'string' || !item.text.trim() || item.text.length > MAX_TEXT_LENGTH) return { ok: false, message: `${label}: texto obrigatório (até ${MAX_TEXT_LENGTH} caracteres).` }
  } else {
    if (typeof item.library_file_id !== 'string' || !UUID_RE.test(item.library_file_id)) return { ok: false, message: `${label}: arquivo inválido.` }
    if (typeof item.volume !== 'number' || !Number.isFinite(item.volume) || item.volume < 0 || item.volume > 1) return { ok: false, message: `${label}: volume inválido.` }
  }
  return { ok: true }
}

/** Items of the same kind share one lane and must not overlap (deterministic stacking). */
export function findSameKindOverlap(items: readonly TemporalItem[]): [TemporalItem, TemporalItem] | null {
  for (const kind of TEMPORAL_ITEM_KINDS) {
    const lane = items.filter((item) => item.kind === kind).sort((a, b) => a.start_frame - b.start_frame)
    for (let i = 1; i < lane.length; i++) if (lane[i].start_frame < itemEndFrame(lane[i - 1])) return [lane[i - 1], lane[i]]
  }
  return null
}

/**
 * Structural validation of `video_drafts.timeline` (PATCH/POST). It does NOT
 * require items to end inside the current Scene total: Scenes can be
 * shortened later, and the derivation clips (an authored value is never
 * silently rewritten). LibraryFile ownership/kind is checked by the API.
 */
export function validateVideoTimeline(raw: unknown): TimelineValidation {
  if (raw === null || raw === undefined) return { ok: true }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, message: 'Timeline inválida.' }
  const value = raw as Record<string, unknown>
  for (const key of Object.keys(value)) if (key !== 'version' && key !== 'items') return { ok: false, message: `Timeline: campo desconhecido ${key}.` }
  if (value.version !== VIDEO_TIMELINE_VERSION) return { ok: false, message: 'Timeline: versão não suportada.' }
  if (!Array.isArray(value.items)) return { ok: false, message: 'Timeline: itens inválidos.' }
  if (value.items.length > MAX_TEMPORAL_ITEMS) return { ok: false, message: `Timeline: no máximo ${MAX_TEMPORAL_ITEMS} itens.` }
  const ids = new Set<string>()
  for (const [index, item] of value.items.entries()) {
    const check = validateItem(item, index)
    if (!check.ok) return check
    const id = (item as TemporalItem).id
    if (ids.has(id)) return { ok: false, message: `Item ${index + 1}: id duplicado.` }
    ids.add(id)
  }
  const overlap = findSameKindOverlap(value.items as TemporalItem[])
  if (overlap) return { ok: false, message: 'Itens do mesmo tipo não podem se sobrepor.' }
  return { ok: true }
}

/** LibraryFile ids referenced by the independent layer (ownership check at the API). */
export function timelineLibraryFileRefs(timeline: VideoTimeline): { id: string; kind: 'visual' | 'audio' }[] {
  return timeline.items.flatMap((item) => (item.kind === 'text' ? [] : [{ id: item.library_file_id, kind: item.kind }]))
}

// ── Authoring edits (pure; they touch ONLY timeline.items) ────────────────────

function sameLaneNeighbours(items: readonly TemporalItem[], item: TemporalItem): { previousEnd: number; nextStart: number } {
  let previousEnd = 0
  let nextStart = Number.POSITIVE_INFINITY
  for (const other of items) {
    if (other.kind !== item.kind || other.id === item.id) continue
    if (itemEndFrame(other) <= item.start_frame) previousEnd = Math.max(previousEnd, itemEndFrame(other))
    else if (other.start_frame >= item.start_frame) nextStart = Math.min(nextStart, other.start_frame)
  }
  return { previousEnd, nextStart }
}

/** First free placement at/after `atFrame` in the kind's lane (null when no room of `frames`). */
export function freePlacement(items: readonly TemporalItem[], kind: TemporalItemKind, atFrame: number, frames: number): number | null {
  const lane = items.filter((item) => item.kind === kind).sort((a, b) => a.start_frame - b.start_frame)
  let start = Math.max(0, Math.round(atFrame))
  for (const other of lane) {
    if (start + frames <= other.start_frame) return start
    if (start < itemEndFrame(other)) start = itemEndFrame(other)
  }
  return start + frames <= MAX_ITEM_FRAMES ? start : null
}

export type NewItemPayload =
  | { kind: 'visual'; library_file_id: string; fit?: 'cover' | 'contain' }
  | { kind: 'text'; text: string }
  | { kind: 'audio'; library_file_id: string; volume?: number }

export function addTemporalItem(timeline: VideoTimeline, payload: NewItemPayload, atFrame: number, frames: number, id: string): { timeline: VideoTimeline; item: TemporalItem } | null {
  const duration = Math.min(MAX_ITEM_FRAMES, Math.max(MIN_ITEM_FRAMES, Math.round(frames)))
  const start = freePlacement(timeline.items, payload.kind, atFrame, duration)
  if (start === null || timeline.items.length >= MAX_TEMPORAL_ITEMS) return null
  const envelope = { id, start_frame: start, duration_frames: duration }
  const item: TemporalItem = payload.kind === 'visual'
    ? { ...envelope, kind: 'visual', library_file_id: payload.library_file_id, ...(payload.fit ? { fit: payload.fit } : {}) }
    : payload.kind === 'text'
      ? { ...envelope, kind: 'text', style: 'lower_third', text: payload.text }
      : { ...envelope, kind: 'audio', library_file_id: payload.library_file_id, volume: payload.volume ?? 1 }
  return { timeline: { ...timeline, items: [...timeline.items, item] }, item }
}

/** Move keeping duration; clamped between the same-kind neighbours (no overlap, never before 0). */
export function moveTemporalItem(timeline: VideoTimeline, id: string, startFrame: number): VideoTimeline {
  const item = timeline.items.find((candidate) => candidate.id === id)
  if (!item) return timeline
  const others = timeline.items.filter((candidate) => candidate.kind === item.kind && candidate.id !== id)
  let start = Math.max(0, Math.round(startFrame))
  // Resolve against the lane in the direction of travel.
  for (const other of others) {
    const overlaps = start < itemEndFrame(other) && start + item.duration_frames > other.start_frame
    if (!overlaps) continue
    start = startFrame >= item.start_frame ? Math.max(0, other.start_frame - item.duration_frames) : itemEndFrame(other)
  }
  const still = others.some((other) => start < itemEndFrame(other) && start + item.duration_frames > other.start_frame)
  if (still || start === item.start_frame) return timeline
  return { ...timeline, items: timeline.items.map((candidate) => (candidate.id === id ? { ...candidate, start_frame: start } : candidate)) }
}

/** Right-edge resize = new placement duration, bounded by the next same-kind item. */
export function resizeTemporalItem(timeline: VideoTimeline, id: string, durationFrames: number): VideoTimeline {
  const item = timeline.items.find((candidate) => candidate.id === id)
  if (!item) return timeline
  const { nextStart } = sameLaneNeighbours(timeline.items, item)
  const max = Math.min(MAX_ITEM_FRAMES, nextStart - item.start_frame)
  const duration = Math.min(max, Math.max(MIN_ITEM_FRAMES, Math.round(durationFrames)))
  if (duration === item.duration_frames) return timeline
  return { ...timeline, items: timeline.items.map((candidate) => (candidate.id === id ? { ...candidate, duration_frames: duration } : candidate)) }
}

export function removeTemporalItem(timeline: VideoTimeline, id: string): VideoTimeline {
  return { ...timeline, items: timeline.items.filter((item) => item.id !== id) }
}

export function updateTemporalItem<K extends TemporalItemKind>(timeline: VideoTimeline, id: string, patch: Partial<Omit<Extract<TemporalItem, { kind: K }>, 'id' | 'kind' | 'start_frame' | 'duration_frames'>>): VideoTimeline {
  return { ...timeline, items: timeline.items.map((item) => (item.id === id ? ({ ...item, ...patch } as TemporalItem) : item)) }
}

// ── Neutral manifest derivation ───────────────────────────────────────────────

export const TEMPORAL_TRACKS: Readonly<Record<TemporalItemKind, TimelineTrack>> = {
  visual: { id: 'video-broll', kind: 'video', order: 1 },
  text: { id: 'overlay-text', kind: 'overlay', order: 2 },
  audio: { id: 'audio-main', kind: 'audio', order: 3 },
}

export type TemporalDerivationDiagnostic = { code: 'item_clipped' | 'item_outside_timeline'; itemId: string; message: string }

/**
 * Items -> neutral segments/tracks/assets for the TimelineManifest. The primary
 * sequence defines the timeline length; an item reaching past it is CLIPPED in
 * the derived manifest (and one starting after it is dropped), with a
 * diagnostic — the authored item itself is left untouched.
 */
export function deriveTemporalSegments(timeline: VideoTimeline, totalFrames: number): {
  tracks: TimelineTrack[]
  segments: TimelineSegment[]
  assets: Record<string, AssetRef>
  diagnostics: TemporalDerivationDiagnostic[]
} {
  const segments: TimelineSegment[] = []
  const assets: Record<string, AssetRef> = {}
  const diagnostics: TemporalDerivationDiagnostic[] = []
  const usedKinds = new Set<TemporalItemKind>()
  const ordered = [...timeline.items].sort((a, b) => TEMPORAL_ITEM_KINDS.indexOf(a.kind) - TEMPORAL_ITEM_KINDS.indexOf(b.kind) || a.start_frame - b.start_frame)
  for (const item of ordered) {
    if (item.start_frame >= totalFrames) {
      diagnostics.push({ code: 'item_outside_timeline', itemId: item.id, message: `Item "${item.id}" starts after the primary sequence ends; it is not rendered.` })
      continue
    }
    const duration = Math.min(item.duration_frames, totalFrames - item.start_frame)
    if (duration < item.duration_frames) diagnostics.push({ code: 'item_clipped', itemId: item.id, message: `Item "${item.id}" ends after the primary sequence; it is clipped at the end of the video.` })
    const base = { id: `item:${item.id}`, track_id: TEMPORAL_TRACKS[item.kind].id, start_frame: item.start_frame, duration_frames: duration }
    usedKinds.add(item.kind)
    if (item.kind === 'text') {
      segments.push({ ...base, kind: 'text', payload: { text: item.text.trim(), role: 'lower_third' } })
    } else {
      const assetKey = `library_file:${item.library_file_id}`
      assets[assetKey] = { type: 'library_file', ref: item.library_file_id, ...(item.kind === 'visual' ? { fit: item.fit ?? 'cover' } : {}) }
      segments.push(item.kind === 'visual'
        ? { ...base, kind: 'media', payload: { asset_ref: assetKey, fit: item.fit ?? 'cover' } }
        : { ...base, kind: 'audio', payload: { asset_ref: assetKey, gain: item.volume } })
    }
  }
  const tracks = TEMPORAL_ITEM_KINDS.filter((kind) => usedKinds.has(kind)).map((kind) => TEMPORAL_TRACKS[kind])
  return { tracks, segments, assets, diagnostics }
}
