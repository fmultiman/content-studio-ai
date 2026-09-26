/**
 * VIDEO_FREE_SCENE_COMPOSITION_V1 — a Video Scene composed WITHOUT a Template.
 *
 * Authored truth lives in the Scene's own `composition` (existing Scene JSONB):
 * `{ kind: 'free', elements: [...] }`. The explicit `kind` is the only
 * discriminant: every stored Template composition has no `kind`, and an absent
 * composition stays the legacy Template Cover — nothing is rewritten.
 *
 * - element ids: stable uuids, Scene-local, never derived from array position;
 * - geometry: fractions of the VideoDraft stage (canvas), origin top-left, on stage;
 * - paint order: array order, back -> front (the repository's element_order convention);
 * - style: Project Identity token ROLES only (typography display|body, color roles);
 * - images: LibraryFile identity only (no URL, no metadata copy).
 */
import type {
  FreeElementBox, FreeImageElement, FreeSceneComposition, FreeSceneElement, FreeTextElement, VideoScene,
} from '@/lib/types'
import type { AssetRef } from '@/lib/schemas/creative/primitives'
import type { FreeSegmentPayload } from '@/lib/schemas/creative/timeline'

export const MAX_FREE_ELEMENTS = 24
export const MAX_FREE_TEXT_LENGTH = 500
/** Smallest box side (2% of the stage): keeps every element selectable and visible. */
export const MIN_FREE_BOX = 0.02
const GEOMETRY_DECIMALS = 4

export const FREE_TEXT_ROLES = ['display', 'body'] as const
export const FREE_TEXT_COLORS = ['foreground', 'background', 'accent', 'muted'] as const
export const FREE_TEXT_ALIGNS = ['left', 'center', 'right'] as const
export const FREE_TEXT_SIZES = ['small', 'medium', 'large', 'title'] as const
export const FREE_IMAGE_FITS = ['cover', 'contain'] as const

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The ONE discriminant. Anything else (including absent) is Template-backed. */
export function isFreeComposition(raw: unknown): raw is FreeSceneComposition {
  return isPlainObject(raw) && raw.kind === 'free'
}

export function isFreeScene(scene: Pick<VideoScene, 'composition'>): boolean {
  return isFreeComposition(scene.composition)
}

export function freeElements(scene: Pick<VideoScene, 'composition'>): FreeSceneElement[] {
  return isFreeComposition(scene.composition) && Array.isArray(scene.composition.elements) ? scene.composition.elements : []
}

// ── Geometry ─────────────────────────────────────────────────────────────────

function round(value: number): number {
  const factor = 10 ** GEOMETRY_DECIMALS
  return Math.round(value * factor) / factor
}

/** Keeps a box on stage and at least MIN_FREE_BOX wide/tall (size first, then position). */
export function clampFreeBox(box: FreeElementBox): FreeElementBox {
  const width = round(Math.min(1, Math.max(MIN_FREE_BOX, Number.isFinite(box.width) ? box.width : MIN_FREE_BOX)))
  const height = round(Math.min(1, Math.max(MIN_FREE_BOX, Number.isFinite(box.height) ? box.height : MIN_FREE_BOX)))
  const x = round(Math.min(1 - width, Math.max(0, Number.isFinite(box.x) ? box.x : 0)))
  const y = round(Math.min(1 - height, Math.max(0, Number.isFinite(box.y) ? box.y : 0)))
  return { x, y, width, height }
}

function isValidBox(raw: unknown): raw is FreeElementBox {
  if (!isPlainObject(raw)) return false
  if (Object.keys(raw).some((key) => !['x', 'y', 'width', 'height'].includes(key))) return false
  const { x, y, width, height } = raw
  if (![x, y, width, height].every((value) => typeof value === 'number' && Number.isFinite(value))) return false
  const b = raw as unknown as FreeElementBox
  return b.x >= 0 && b.y >= 0 && b.width >= MIN_FREE_BOX && b.height >= MIN_FREE_BOX && b.x + b.width <= 1 + 1e-9 && b.y + b.height <= 1 + 1e-9
}

// ── Write-boundary validation ────────────────────────────────────────────────

const BASE_KEYS = ['id', 'kind', 'box', 'hidden']
const TEXT_KEYS = new Set([...BASE_KEYS, 'text', 'typography', 'color', 'align', 'size'])
const IMAGE_KEYS = new Set([...BASE_KEYS, 'library_file_id', 'fit'])
const oneOf = (values: readonly string[], value: unknown) => typeof value === 'string' && values.includes(value)

/** Strict structural check of a free composition (PATCH/POST boundary). */
export function validateFreeCompositionShape(raw: unknown): { ok: true } | { ok: false; message: string } {
  if (!isPlainObject(raw) || raw.kind !== 'free') return { ok: false, message: 'Composição livre inválida.' }
  if (Object.keys(raw).some((key) => key !== 'kind' && key !== 'elements')) return { ok: false, message: 'Composição livre aceita só os elementos.' }
  if (!Array.isArray(raw.elements)) return { ok: false, message: 'Composição livre sem lista de elementos.' }
  if (raw.elements.length > MAX_FREE_ELEMENTS) return { ok: false, message: `Composição livre com mais de ${MAX_FREE_ELEMENTS} elementos.` }
  const ids = new Set<string>()
  for (const element of raw.elements) {
    if (!isPlainObject(element)) return { ok: false, message: 'Elemento livre inválido.' }
    if (typeof element.id !== 'string' || element.id.trim().length === 0 || element.id.length > 64) return { ok: false, message: 'Elemento livre sem id estável.' }
    if (ids.has(element.id)) return { ok: false, message: `Elemento livre repetido: ${element.id}.` }
    ids.add(element.id)
    if (!isValidBox(element.box)) return { ok: false, message: 'Posição ou tamanho do elemento fora do palco.' }
    if (element.hidden !== undefined && typeof element.hidden !== 'boolean') return { ok: false, message: 'Visibilidade do elemento inválida.' }
    if (element.kind === 'text') {
      if (Object.keys(element).some((key) => !TEXT_KEYS.has(key))) return { ok: false, message: 'Campo desconhecido no texto livre.' }
      if (typeof element.text !== 'string' || element.text.length > MAX_FREE_TEXT_LENGTH) return { ok: false, message: 'Texto livre inválido ou longo demais.' }
      if (!oneOf(FREE_TEXT_ROLES, element.typography) || !oneOf(FREE_TEXT_COLORS, element.color) || !oneOf(FREE_TEXT_ALIGNS, element.align) || !oneOf(FREE_TEXT_SIZES, element.size)) {
        return { ok: false, message: 'Estilo do texto livre fora dos papéis da Identidade.' }
      }
    } else if (element.kind === 'image') {
      if (Object.keys(element).some((key) => !IMAGE_KEYS.has(key))) return { ok: false, message: 'Campo desconhecido na imagem livre.' }
      if (typeof element.library_file_id !== 'string' || !UUID_RE.test(element.library_file_id)) return { ok: false, message: 'Imagem livre sem arquivo da Biblioteca válido.' }
      if (!oneOf(FREE_IMAGE_FITS, element.fit)) return { ok: false, message: 'Enquadramento da imagem livre inválido.' }
    } else {
      return { ok: false, message: 'Tipo de elemento livre não suportado.' }
    }
  }
  return { ok: true }
}

/** Every LibraryFile a draft's free images reference (validated like Scene heroes: Project-owned images). */
export function freeImageLibraryFileIds(scenes: readonly Pick<VideoScene, 'composition'>[]): string[] {
  const ids = new Set<string>()
  for (const scene of scenes) {
    for (const element of freeElements(scene)) if (element.kind === 'image') ids.add(element.library_file_id)
  }
  return [...ids]
}

// ── Authoring (pure; each touches only this Scene's composition) ─────────────

/** A new, explicitly free Scene (no Template). Same sequence defaults as a Template Scene; static Motion. */
export function createFreeScene(order: number, id: string, durationSeconds: number): VideoScene {
  return {
    id,
    order,
    description: '',
    prompt: null,
    image_url: null,
    library_file_id: null,
    duration: durationSeconds,
    movement: 'static',
    composition: { kind: 'free', elements: [] },
  }
}

function withElements(scene: VideoScene, elements: FreeSceneElement[]): VideoScene {
  if (!isFreeComposition(scene.composition)) return scene
  return { ...scene, composition: { kind: 'free', elements } }
}

export const DEFAULT_FREE_TEXT_BOX: FreeElementBox = { x: 0.08, y: 0.1, width: 0.84, height: 0.2 }
export const DEFAULT_FREE_IMAGE_BOX: FreeElementBox = { x: 0.1, y: 0.35, width: 0.8, height: 0.45 }

export function addFreeTextElement(scene: VideoScene, id: string): VideoScene {
  const elements = freeElements(scene)
  if (!isFreeScene(scene) || elements.length >= MAX_FREE_ELEMENTS || elements.some((element) => element.id === id)) return scene
  const element: FreeTextElement = { id, kind: 'text', box: { ...DEFAULT_FREE_TEXT_BOX }, text: 'Texto', typography: 'display', color: 'foreground', align: 'left', size: 'large' }
  return withElements(scene, [...elements, element])
}

export function addFreeImageElement(scene: VideoScene, id: string, libraryFileId: string): VideoScene {
  const elements = freeElements(scene)
  if (!isFreeScene(scene) || elements.length >= MAX_FREE_ELEMENTS || elements.some((element) => element.id === id)) return scene
  const element: FreeImageElement = { id, kind: 'image', box: { ...DEFAULT_FREE_IMAGE_BOX }, library_file_id: libraryFileId, fit: 'cover' }
  return withElements(scene, [...elements, element])
}

export type FreeTextPatch = Partial<Pick<FreeTextElement, 'text' | 'typography' | 'color' | 'align' | 'size'>>
export type FreeImagePatch = Partial<Pick<FreeImageElement, 'library_file_id' | 'fit'>>

/** Kind-specific fields only; the element's id and kind never change. */
export function updateFreeElement(scene: VideoScene, elementId: string, patch: FreeTextPatch | FreeImagePatch): VideoScene {
  const elements = freeElements(scene)
  const index = elements.findIndex((element) => element.id === elementId)
  if (index < 0) return scene
  const current = elements[index]
  const next = current.kind === 'text'
    ? { ...current, ...pick(patch as FreeTextPatch, ['text', 'typography', 'color', 'align', 'size']) }
    : { ...current, ...pick(patch as FreeImagePatch, ['library_file_id', 'fit']) }
  if (next.kind === 'text' && next.text.length > MAX_FREE_TEXT_LENGTH) next.text = next.text.slice(0, MAX_FREE_TEXT_LENGTH)
  return withElements(scene, elements.map((element, i) => (i === index ? next as FreeSceneElement : element)))
}

function pick<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Partial<T> {
  const out: Partial<T> = {}
  for (const key of keys) if (source[key] !== undefined) out[key] = source[key]
  return out
}

export function setFreeElementBox(scene: VideoScene, elementId: string, box: Partial<FreeElementBox>): VideoScene {
  const elements = freeElements(scene)
  const index = elements.findIndex((element) => element.id === elementId)
  if (index < 0) return scene
  const next = { ...elements[index], box: clampFreeBox({ ...elements[index].box, ...box }) }
  return withElements(scene, elements.map((element, i) => (i === index ? next : element)))
}

export function setFreeElementHidden(scene: VideoScene, elementId: string, hidden: boolean): VideoScene {
  const elements = freeElements(scene)
  if (!elements.some((element) => element.id === elementId)) return scene
  return withElements(scene, elements.map((element) => {
    if (element.id !== elementId) return element
    const { hidden: _hidden, ...rest } = element
    void _hidden
    return hidden ? { ...rest, hidden: true } as FreeSceneElement : rest as FreeSceneElement
  }))
}

export function removeFreeElement(scene: VideoScene, elementId: string): VideoScene {
  const elements = freeElements(scene)
  if (!elements.some((element) => element.id === elementId)) return scene
  return withElements(scene, elements.filter((element) => element.id !== elementId))
}

/** One step in paint order: 'forward' = drawn later (in front). */
export function moveFreeElement(scene: VideoScene, elementId: string, direction: 'forward' | 'backward'): VideoScene {
  const elements = freeElements(scene)
  const index = elements.findIndex((element) => element.id === elementId)
  const target = direction === 'forward' ? index + 1 : index - 1
  if (index < 0 || target < 0 || target >= elements.length) return scene
  const next = [...elements]
  ;[next[index], next[target]] = [next[target], next[index]]
  return withElements(scene, next)
}

// ── Neutral render preparation (derived, never stored) ───────────────────────

export function freeAssetKey(libraryFileId: string): string {
  return `library_file:${libraryFileId}`
}

/**
 * The neutral `free` segment payload: visible elements only (hidden ones are
 * authored but not drawn), paint order kept, empty texts skipped (nothing to
 * draw). Images become manifest-level asset refs resolved like root B-roll.
 */
export function deriveFreeSegment(composition: FreeSceneComposition): { payload: FreeSegmentPayload; assets: Record<string, AssetRef> } {
  const assets: Record<string, AssetRef> = {}
  const elements: FreeSegmentPayload['elements'] = []
  for (const element of composition.elements) {
    if (element.hidden) continue
    if (element.kind === 'text') {
      if (element.text.trim().length === 0) continue
      elements.push({ element_id: element.id, kind: 'text', box: element.box, text: element.text, typography: element.typography, color: element.color, align: element.align, size: element.size })
    } else {
      const key = freeAssetKey(element.library_file_id)
      assets[key] = { type: 'library_file', ref: element.library_file_id, fit: element.fit }
      elements.push({ element_id: element.id, kind: 'image', box: element.box, asset_ref: key, fit: element.fit })
    }
  }
  return { payload: { elements }, assets }
}
