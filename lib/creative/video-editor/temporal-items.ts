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
 *   audio             -> a Project LibraryFile (audio) mixed under the picture
 *
 * Domain rules (no engine concepts here):
 *  - frames are canonical (timeline.v0 is frame-based; 30 fps);
 *  - anchoring is ABSOLUTE: an item keeps its frames when Scenes are reordered
 *    or retimed (it does not follow a Scene);
 *  - visual/text: one lane per kind, never overlapping (deterministic stacking
 *    without a persisted Track);
 *  - audio (VIDEO_AUDIO_AUTHORING_V1): items MAY overlap — audio mixes, it does
 *    not stack, so no lane/row is authored; UI rows and manifest tracks are
 *    derived. An audio item may end with the primary sequence (`end_anchor`)
 *    instead of a fixed `duration_frames` — exactly one of the two is stored;
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
  /** Placement duration in frames — NOT a source trim. */
  duration_frames: number
}
export type VisualItem = Envelope & { kind: 'visual'; library_file_id: string; fit?: 'cover' | 'contain' }
export type TextItem = Envelope & { kind: 'text'; style: 'lower_third'; text: string }
/**
 * Audio (Gate B + AUDIO V1). Placement end is EITHER a fixed `duration_frames`
 * OR `end_anchor: 'sequence_end'` (ends with the primary Scene sequence) —
 * never both, so there is one authority for the effective end.
 */
export type AudioItem = Omit<Envelope, 'duration_frames'> & {
  kind: 'audio'
  library_file_id: string
  /** 0..1 linear gain. */
  volume: number
  duration_frames?: number
  end_anchor?: 'sequence_end'
  /** Frames into the SOURCE file where this placement starts playing (default 0). */
  source_in_frame?: number
  /** Linear ramp from silence at the placement start / to silence at its end (default 0). */
  fade_in_frames?: number
  fade_out_frames?: number
}
export type TemporalItem = VisualItem | TextItem | AudioItem

export type VideoTimeline = { version: typeof VIDEO_TIMELINE_VERSION; items: TemporalItem[] }

export const MAX_TEMPORAL_ITEMS = 60
export const MIN_ITEM_FRAMES = 15 // 0.5 s, same floor as a primary Scene
export const MAX_ITEM_FRAMES = 30 * 60 * 10 // 10 min
export const MAX_TEXT_LENGTH = 120
export const DEFAULT_ITEM_FRAMES = 60 // 2 s
export const DEFAULT_AUDIO_FRAMES = 150 // 5 s

export const EMPTY_TIMELINE: VideoTimeline = { version: VIDEO_TIMELINE_VERSION, items: [] }

/** Lane label order (UI) and paint order (render): primary < visual < text; audio has no picture (rows derived). */
export const TEMPORAL_LANES: readonly { kind: TemporalItemKind; label: string }[] = [
  { kind: 'visual', label: 'B-roll' },
  { kind: 'text', label: 'Texto' },
  { kind: 'audio', label: 'Áudio' },
]

export function followsSequenceEnd(item: TemporalItem): item is AudioItem & { end_anchor: 'sequence_end' } {
  return item.kind === 'audio' && item.end_anchor === 'sequence_end'
}

/**
 * Effective placement duration. Fixed items: their own duration. An audio
 * item anchored to the sequence end: from its start to the CURRENT end of the
 * primary Scene sequence (0 when it starts after it). Never stored.
 */
export function effectiveDurationFrames(item: TemporalItem, totalFrames: number): number {
  if (followsSequenceEnd(item)) return Math.max(0, totalFrames - item.start_frame)
  return item.duration_frames ?? 0
}

export function itemEndFrame(item: TemporalItem, totalFrames: number = Number.POSITIVE_INFINITY): number {
  if (followsSequenceEnd(item)) return Number.isFinite(totalFrames) ? Math.max(item.start_frame, totalFrames) : item.start_frame
  return item.start_frame + (item.duration_frames ?? 0)
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
  audio: ['library_file_id', 'volume', 'end_anchor', 'source_in_frame', 'fade_in_frames', 'fade_out_frames'],
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
  const follows = kind === 'audio' && item.end_anchor !== undefined
  if (follows) {
    if (item.end_anchor !== 'sequence_end') return { ok: false, message: `${label}: fim inválido.` }
    if (item.duration_frames !== undefined) return { ok: false, message: `${label}: um áudio que termina com o vídeo não guarda duração fixa.` }
  } else if (!isInt(item.duration_frames, MIN_ITEM_FRAMES, MAX_ITEM_FRAMES)) {
    return { ok: false, message: `${label}: duração inválida.` }
  }
  if (kind === 'visual') {
    if (typeof item.library_file_id !== 'string' || !UUID_RE.test(item.library_file_id)) return { ok: false, message: `${label}: arquivo inválido.` }
    if (item.fit !== undefined && item.fit !== 'cover' && item.fit !== 'contain') return { ok: false, message: `${label}: enquadramento inválido.` }
  } else if (kind === 'text') {
    if (item.style !== 'lower_third') return { ok: false, message: `${label}: estilo inválido.` }
    if (typeof item.text !== 'string' || !item.text.trim() || item.text.length > MAX_TEXT_LENGTH) return { ok: false, message: `${label}: texto obrigatório (até ${MAX_TEXT_LENGTH} caracteres).` }
  } else {
    if (typeof item.library_file_id !== 'string' || !UUID_RE.test(item.library_file_id)) return { ok: false, message: `${label}: arquivo inválido.` }
    if (typeof item.volume !== 'number' || !Number.isFinite(item.volume) || item.volume < 0 || item.volume > 1) return { ok: false, message: `${label}: volume inválido.` }
    for (const key of ['source_in_frame', 'fade_in_frames', 'fade_out_frames'] as const) {
      if (item[key] !== undefined && !isInt(item[key], 0, MAX_ITEM_FRAMES)) return { ok: false, message: `${label}: ${key === 'source_in_frame' ? 'início no arquivo' : 'fade'} inválido.` }
    }
    const fades = ((item.fade_in_frames as number | undefined) ?? 0) + ((item.fade_out_frames as number | undefined) ?? 0)
    if (!follows && fades > (item.duration_frames as number)) return { ok: false, message: `${label}: fade in + fade out não podem passar da duração.` }
  }
  return { ok: true }
}

/** Visual/text share one lane per kind and must not overlap (deterministic stacking). Audio mixes: never an overlap error. */
export function findSameKindOverlap(items: readonly TemporalItem[]): [TemporalItem, TemporalItem] | null {
  for (const kind of ['visual', 'text'] as const) {
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
  if (overlap) return { ok: false, message: 'Itens de B-roll (ou de texto) não podem se sobrepor.' }
  return { ok: true }
}

/** LibraryFile ids referenced by the independent layer (ownership check at the API). */
export function timelineLibraryFileRefs(timeline: VideoTimeline): { id: string; kind: 'visual' | 'audio' }[] {
  return timeline.items.flatMap((item) => (item.kind === 'text' ? [] : [{ id: item.library_file_id, kind: item.kind }]))
}

// ── Derived audio rows (UI projection, never authored) ────────────────────────

/**
 * Deterministic interval packing for AUDIO display rows: stable sort by
 * start frame then id; each item takes the lowest row whose last interval has
 * ended (end-exclusive); a new row opens only when overlap requires it.
 * Rows are viewport projection: moving an item may change its row.
 */
export function packAudioRows(items: readonly TemporalItem[], totalFrames: number): { rowOf: Record<string, number>; rowCount: number } {
  const audio = items.filter((item) => item.kind === 'audio').sort((a, b) => a.start_frame - b.start_frame || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const rowEnds: number[] = []
  const rowOf: Record<string, number> = {}
  for (const item of audio) {
    const end = Math.max(item.start_frame + 1, itemEndFrame(item, totalFrames))
    let row = rowEnds.findIndex((rowEnd) => rowEnd <= item.start_frame)
    if (row === -1) { row = rowEnds.length; rowEnds.push(end) } else rowEnds[row] = end
    rowOf[item.id] = row
  }
  return { rowOf, rowCount: Math.max(1, rowEnds.length) }
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

/** First free placement at/after `atFrame` in a visual/text lane (null when no room); audio is placed where asked (it mixes). */
export function freePlacement(items: readonly TemporalItem[], kind: TemporalItemKind, atFrame: number, frames: number): number | null {
  let start = Math.max(0, Math.round(atFrame))
  if (kind === 'audio') return start <= MAX_ITEM_FRAMES ? start : null
  const lane = items.filter((item) => item.kind === kind).sort((a, b) => a.start_frame - b.start_frame)
  for (const other of lane) {
    if (start + frames <= other.start_frame) return start
    if (start < itemEndFrame(other)) start = itemEndFrame(other)
  }
  return start + frames <= MAX_ITEM_FRAMES ? start : null
}

export type NewItemPayload =
  | { kind: 'visual'; library_file_id: string; fit?: 'cover' | 'contain' }
  | { kind: 'text'; text: string }
  | { kind: 'audio'; library_file_id: string; volume?: number; endsWithSequence?: boolean }

export function addTemporalItem(timeline: VideoTimeline, payload: NewItemPayload, atFrame: number, frames: number, id: string): { timeline: VideoTimeline; item: TemporalItem } | null {
  const duration = Math.min(MAX_ITEM_FRAMES, Math.max(MIN_ITEM_FRAMES, Math.round(frames)))
  const start = freePlacement(timeline.items, payload.kind, atFrame, duration)
  if (start === null || timeline.items.length >= MAX_TEMPORAL_ITEMS) return null
  let item: TemporalItem
  if (payload.kind === 'visual') item = { id, start_frame: start, duration_frames: duration, kind: 'visual', library_file_id: payload.library_file_id, ...(payload.fit ? { fit: payload.fit } : {}) }
  else if (payload.kind === 'text') item = { id, start_frame: start, duration_frames: duration, kind: 'text', style: 'lower_third', text: payload.text }
  else item = { id, start_frame: start, kind: 'audio', library_file_id: payload.library_file_id, volume: payload.volume ?? 1, ...(payload.endsWithSequence ? { end_anchor: 'sequence_end' as const } : { duration_frames: duration }) }
  return { timeline: { ...timeline, items: [...timeline.items, item] }, item }
}

/** Move keeping duration (and source offset). Visual/text clamp between same-kind neighbours; audio moves freely (it mixes). */
export function moveTemporalItem(timeline: VideoTimeline, id: string, startFrame: number): VideoTimeline {
  const item = timeline.items.find((candidate) => candidate.id === id)
  if (!item) return timeline
  let start = Math.max(0, Math.round(startFrame))
  if (item.kind !== 'audio') {
    const others = timeline.items.filter((candidate) => candidate.kind === item.kind && candidate.id !== id)
    for (const other of others) {
      const overlaps = start < itemEndFrame(other) && start + item.duration_frames > other.start_frame
      if (!overlaps) continue
      start = startFrame >= item.start_frame ? Math.max(0, other.start_frame - item.duration_frames) : itemEndFrame(other)
    }
    if (others.some((other) => start < itemEndFrame(other) && start + item.duration_frames > other.start_frame)) return timeline
  }
  if (start === item.start_frame) return timeline
  return { ...timeline, items: timeline.items.map((candidate) => (candidate.id === id ? { ...candidate, start_frame: start } : candidate)) }
}

/**
 * Right-edge resize = new placement duration. Visual/text: bounded by the next
 * same-kind item. Audio: never shorter than its fades (fades are not silently
 * changed); an audio item anchored to the sequence end has no free duration.
 */
export function resizeTemporalItem(timeline: VideoTimeline, id: string, durationFrames: number): VideoTimeline {
  const item = timeline.items.find((candidate) => candidate.id === id)
  if (!item || followsSequenceEnd(item)) return timeline
  let min = MIN_ITEM_FRAMES
  let max = MAX_ITEM_FRAMES
  if (item.kind === 'audio') min = Math.max(min, (item.fade_in_frames ?? 0) + (item.fade_out_frames ?? 0))
  else max = Math.min(max, sameLaneNeighbours(timeline.items, item).nextStart - item.start_frame)
  const duration = Math.min(max, Math.max(min, Math.round(durationFrames)))
  if (duration === item.duration_frames) return timeline
  return { ...timeline, items: timeline.items.map((candidate) => (candidate.id === id ? { ...candidate, duration_frames: duration } : candidate)) }
}

export function removeTemporalItem(timeline: VideoTimeline, id: string): VideoTimeline {
  return { ...timeline, items: timeline.items.filter((item) => item.id !== id) }
}

export function updateTemporalItem<K extends TemporalItemKind>(timeline: VideoTimeline, id: string, patch: Partial<Omit<Extract<TemporalItem, { kind: K }>, 'id' | 'kind' | 'start_frame' | 'duration_frames' | 'end_anchor'>>): VideoTimeline {
  return { ...timeline, items: timeline.items.map((item) => (item.id === id ? ({ ...item, ...patch } as TemporalItem) : item)) }
}

/**
 * Explicit end intent of an audio item. Fixed -> follow drops the stored
 * duration (one authority); follow -> fixed freezes the CURRENT effective
 * duration so nothing jumps. Other items are never touched.
 */
export function setAudioEndsWithSequence(timeline: VideoTimeline, id: string, follow: boolean, totalFrames: number): VideoTimeline {
  return {
    ...timeline,
    items: timeline.items.map((item) => {
      if (item.id !== id || item.kind !== 'audio' || follow === followsSequenceEnd(item)) return item
      const { duration_frames: _duration, end_anchor: _anchor, ...rest } = item
      void _duration; void _anchor
      if (follow) return { ...rest, end_anchor: 'sequence_end' as const }
      const fades = (item.fade_in_frames ?? 0) + (item.fade_out_frames ?? 0)
      return { ...rest, duration_frames: Math.min(MAX_ITEM_FRAMES, Math.max(MIN_ITEM_FRAMES, fades, effectiveDurationFrames(item, totalFrames))) }
    }),
  }
}

/**
 * Source offset / fades of an audio item, as whole frames >= 0. For a fixed
 * item the edited fade is capped so fade in + fade out never exceed the
 * placement (validation-level truth, not renderer magic). Absent/0 = removed.
 */
export function setAudioTiming(timeline: VideoTimeline, id: string, patch: { source_in_frame?: number; fade_in_frames?: number; fade_out_frames?: number }): VideoTimeline {
  return {
    ...timeline,
    items: timeline.items.map((item) => {
      if (item.id !== id || item.kind !== 'audio') return item
      const next: AudioItem = { ...item }
      for (const key of ['source_in_frame', 'fade_in_frames', 'fade_out_frames'] as const) {
        if (!(key in patch)) continue
        const value = Math.min(MAX_ITEM_FRAMES, Math.max(0, Math.round(patch[key] ?? 0)))
        if (value > 0) next[key] = value
        else delete next[key]
      }
      if (!followsSequenceEnd(next) && next.duration_frames !== undefined) {
        const room = next.duration_frames
        if ('fade_in_frames' in patch && (next.fade_in_frames ?? 0) + (next.fade_out_frames ?? 0) > room) next.fade_in_frames = Math.max(0, room - (next.fade_out_frames ?? 0)) || undefined
        if ('fade_out_frames' in patch && (next.fade_in_frames ?? 0) + (next.fade_out_frames ?? 0) > room) next.fade_out_frames = Math.max(0, room - (next.fade_in_frames ?? 0)) || undefined
        if (next.fade_in_frames === undefined) delete next.fade_in_frames
        if (next.fade_out_frames === undefined) delete next.fade_out_frames
      }
      return next
    }),
  }
}

// ── Neutral manifest derivation ───────────────────────────────────────────────

export const TEMPORAL_TRACKS: Readonly<Record<TemporalItemKind, TimelineTrack>> = {
  visual: { id: 'video-broll', kind: 'video', order: 1 },
  text: { id: 'overlay-text', kind: 'overlay', order: 2 },
  // One DERIVED audio track: timeline.v0 allows overlapping segments on a track, and audio mixes.
  audio: { id: 'audio-main', kind: 'audio', order: 3 },
}

export type TemporalDerivationDiagnostic = { code: 'item_clipped' | 'item_outside_timeline' | 'fade_clamped'; itemId: string; message: string }

/**
 * Items -> neutral segments/tracks/assets for the TimelineManifest. The primary
 * sequence defines the timeline length: a fixed item reaching past it is
 * CLIPPED in the derived manifest (one starting after it is dropped); an audio
 * item anchored to the sequence end simply ends there. Diagnostics report it —
 * the authored item itself is left untouched.
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
  const ordered = [...timeline.items].sort((a, b) => TEMPORAL_ITEM_KINDS.indexOf(a.kind) - TEMPORAL_ITEM_KINDS.indexOf(b.kind) || a.start_frame - b.start_frame || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  for (const item of ordered) {
    if (item.start_frame >= totalFrames) {
      diagnostics.push({ code: 'item_outside_timeline', itemId: item.id, message: `Item "${item.id}" starts after the primary sequence ends; it is not rendered.` })
      continue
    }
    const authored = effectiveDurationFrames(item, totalFrames)
    const duration = Math.min(authored, totalFrames - item.start_frame)
    if (!followsSequenceEnd(item) && duration < authored) diagnostics.push({ code: 'item_clipped', itemId: item.id, message: `Item "${item.id}" ends after the primary sequence; it is clipped at the end of the video.` })
    const base = { id: `item:${item.id}`, track_id: TEMPORAL_TRACKS[item.kind].id, start_frame: item.start_frame, duration_frames: duration }
    usedKinds.add(item.kind)
    if (item.kind === 'text') {
      segments.push({ ...base, kind: 'text', payload: { text: item.text.trim(), role: 'lower_third' } })
      continue
    }
    const assetKey = `library_file:${item.library_file_id}`
    if (item.kind === 'visual') {
      assets[assetKey] = { type: 'library_file', ref: item.library_file_id, fit: item.fit ?? 'cover' }
      segments.push({ ...base, kind: 'media', payload: { asset_ref: assetKey, fit: item.fit ?? 'cover' } })
      continue
    }
    assets[assetKey] = { type: 'library_file', ref: item.library_file_id }
    // Fades must fit the EFFECTIVE placement (clipping or a shorter sequence can shrink it): scale them down proportionally.
    let fadeIn = item.fade_in_frames ?? 0
    let fadeOut = item.fade_out_frames ?? 0
    if (fadeIn + fadeOut > duration) {
      const scale = duration / (fadeIn + fadeOut)
      fadeIn = Math.floor(fadeIn * scale)
      fadeOut = Math.floor(fadeOut * scale)
      diagnostics.push({ code: 'fade_clamped', itemId: item.id, message: `Item "${item.id}" fades are longer than its effective placement; they were shortened proportionally.` })
    }
    segments.push({
      ...base,
      kind: 'audio',
      payload: {
        asset_ref: assetKey,
        gain: item.volume,
        ...(item.source_in_frame ? { source_in_frame: item.source_in_frame } : {}),
        ...(fadeIn > 0 ? { fade_in_frames: fadeIn } : {}),
        ...(fadeOut > 0 ? { fade_out_frames: fadeOut } : {}),
      },
    })
  }
  const tracks = TEMPORAL_ITEM_KINDS.filter((kind) => usedKinds.has(kind)).map((kind) => TEMPORAL_TRACKS[kind])
  return { tracks, segments, assets, diagnostics }
}
