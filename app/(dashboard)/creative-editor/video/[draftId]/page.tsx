'use client'

/**
 * Creative Editor Video — Foundation V1.
 *
 * "The same Creative Editor, now with time." Same shell family as the Static
 * editor (compact header, dominant Preview Surface, floating Dockview
 * Inspector, bottom authoring region), with:
 *
 * - Preview Surface = Live Authoring Player (browser, never an MP4);
 * - authoring unit  = Scene (VideoScene), navigation = CENAS;
 * - precision view  = TIMELINE (primary-Scene Timeline Lite).
 *
 * Authority: VideoDraft + VideoScene[] only, saved through the same
 * `/api/video-drafts` PATCH; it is the ONLY product surface that writes them
 * (VIDEO_DRAFT_SINGLE_WRITER_AND_CANONICAL_ENTRY_V1). `currentFrame` is the
 * editor's single temporal cursor (UI state, never persisted); the Player is
 * its clock and the Timeline playhead follows/seeks it. Final render is the
 * unchanged server-authoritative path (`POST /api/video-drafts/:id/render`).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import {
  AlertCircle, ArrowLeft, ArrowRight, Check, ChevronDown, Download, ExternalLink, Film, Hand, Loader2, MousePointer2, Pause, PanelRight,
  Play, SkipBack, SkipForward, Sparkles, StepBack, StepForward, Trash2, Undo2,
} from 'lucide-react'
import { DashboardPage, DashboardPageContent } from '@/components/layout/dashboard-page'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ContextMetadata } from '@/components/ui/context-metadata'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { CreativeWorkbench, StackedWorkbench, useFloatingWorkbench } from '@/components/creative/editor/creative-workbench'
import { AssetSlotCard, StyleSourcePanel, TemplateAnatomy, TemplateFamilyAnatomy } from '@/components/creative/authoring/inspector-panels'
import { ElementLayers } from '@/components/creative/authoring/element-layers'
import { usePreviewViewport } from '@/components/creative/editor/use-preview-viewport'
import { ViewportZoomControls } from '@/components/creative/editor/viewport-zoom-controls'
import { AuthoringDock } from '@/components/creative/video/authoring-dock'
import { ProjectLibraryAssetPicker } from '@/components/library/project-library-asset-picker'
import { SceneStrip } from '@/components/creative/video/scene-strip'
import { SceneTimeline } from '@/components/creative/video/scene-timeline'
import { createClient } from '@/lib/supabase/client'
import { normalizeProjectIdentity } from '@/lib/project-identity-normalizer'
import { adaptProjectIdentityToVisualTokens } from '@/lib/creative/integration/project-identity-adapter'
import { resolveSlotResource } from '@/lib/creative/authoring/asset-slots'
import { cn } from '@/lib/utils'
import { DEFAULT_HERO_ASSET_REF } from '@/lib/creative/timeline-adapter/video-draft-to-timeline'
import { effectiveVideoCanvas, readVideoCanvas, videoDraftCanvasSupport, type VideoCanvas } from '@/lib/creative/video-editor/video-canvas'
import { addFreeImageElement, addFreeTextElement, createFreeScene, freeElements, isFreeScene, setFreeElementBox, updateFreeElement } from '@/lib/creative/video-editor/free-composition'
import { FreeSceneElements, FreeSceneTemplateState, freeElementLabel } from '@/components/creative/video/free-scene-panels'
import { FreeSceneOverlay } from '@/components/creative/video/free-scene-overlay'
import { DEFAULT_PREVIEW_INTERACTION_MODE, type PreviewInteractionMode } from '@/lib/creative/video-editor/free-manipulation'
import { VideoCanvasControl } from '@/components/creative/video/video-canvas-control'
import { resolveAsset } from '@/lib/creative/assets/resolve-asset'
import {
  TIMELINE_FPS, clampFrame, clampSceneDurationSeconds, deriveSceneRanges, formatSeconds, formatTimecode, reorderScenes,
  sceneIndexAtFrame, setSceneDuration, MIN_SCENE_DURATION_SECONDS, MAX_SCENE_DURATION_SECONDS,
} from '@/lib/creative/video-editor/scene-timeline'
import {
  MAX_VIDEO_SCENES, NEW_SCENE_DURATION_SECONDS, addVideoScene, buildVideoDraftSaveBody, insertVideoScene, motionOptions, normalizeLoadedScenes,
  persistedVideoSnapshot, removeVideoScene, updateVideoScene,
} from '@/lib/creative/video-editor/video-authoring'
import { buildLivePreviewInput, type PreviewLibraryFile } from '@/lib/creative/video-editor/live-preview-input'
import { createFrameCursor, useFrameCursor, type FrameCursor } from '@/lib/creative/video-editor/frame-cursor'
import { VIDEO_INSPECTOR_SECTIONS, sceneHeroSlotState, videoSceneComposition, type VideoInspectorSection } from '@/lib/creative/video-editor/video-workspace'
import {
  VIDEO_SCENE_LAYOUT_IDS, applySceneContentAction, resetSceneElementOrder, resolveSceneComposition, sceneContentFields,
  setSceneAppearance, setSceneElementOrder, setSceneLayout, toggleSceneElementVisibility,
} from '@/lib/creative/video-editor/scene-composition'
import { LayoutContentForm } from '@/components/creative/authoring/layout-content-form'
import { isContentAction } from '@/lib/creative/authoring/reducer'
import type { MotionEffect } from '@/lib/creative/video-editor/video-authoring'
import { layoutUsesContentImage } from '@/lib/creative/templates/template-definitions'
import {
  DEFAULT_AUDIO_FRAMES, DEFAULT_ITEM_FRAMES, EMPTY_TIMELINE, MAX_TEXT_LENGTH, addTemporalItem, effectiveDurationFrames, followsSequenceEnd, itemEndFrame,
  moveTemporalItem, readVideoTimeline, removeTemporalItem, resizeTemporalItem, setAudioEndsWithSequence, setAudioTiming, updateTemporalItem,
  type TemporalItem, type TemporalItemKind, type VideoTimeline,
} from '@/lib/creative/video-editor/temporal-items'
import { resetSceneElementTiming, sceneTimingRows, setSceneElementTiming, type ElementTimingPatch } from '@/lib/creative/video-editor/element-timing'
import { RENDERABLE_AUDIO_MIME, RENDERABLE_VIDEO_MIME } from '@/lib/creative/integration/library-file-adapter'
import { INITIAL_DOCK_STATE, sequenceSummary, type DockState } from '@/lib/creative/video-editor/bottom-dock'
import type { VisualTokensSnapshot } from '@/lib/schemas/creative/primitives'
import type { FreeElementBox, FreeSceneElement, LibraryFile, Project, RenderExecutionSummary, VideoDraft, VideoScene } from '@/lib/types'
import type { LivePlayerController } from '@/remotion/player/LiveTimelinePlayer'

// The Remotion Player adapter is browser-only; it never runs on the server.
const LiveTimelinePlayer = dynamic(() => import('@/remotion/player/LiveTimelinePlayer').then((mod) => mod.LiveTimelinePlayer), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>,
})

const AUTOSAVE_PREF_KEY = 'creative-editor-video:autosave-enabled'
const RENDER_POLL_INTERVAL_MS = 3000
const TEMPLATE_HERO_URL = (() => { const resolved = resolveAsset(DEFAULT_HERO_ASSET_REF); return resolved.valid ? resolved.value.url : undefined })()
/** Movement vocabulary + labels (layout-independent; per-Scene effects come from motionOptions(layout)). */
const MOTION_OPTIONS = motionOptions()
/** Video layouts that draw the Scene's content image (read from the registry). */
const HERO_LAYOUT_LABELS = (() => {
  const template = videoSceneComposition().template
  const labels = template.layouts.filter((layout) => (VIDEO_SCENE_LAYOUT_IDS as readonly string[]).includes(layout.id) && layoutUsesContentImage(layout)).map((layout) => layout.label)
  return labels.length > 1 ? `${labels.slice(0, -1).join(', ')} ou ${labels[labels.length - 1]}` : labels.join('')
})()
const MOTION_EFFECT_LABELS: Record<MotionEffect, string> = {
  none: 'sem movimento',
  'primary-media': 'aproximação lenta · imagem principal',
  scene: 'fade · cena inteira',
  'not-drawn': 'sem efeito visível nesta estrutura',
}

function readAutosavePreference(): boolean {
  if (typeof window === 'undefined') return false
  try { return window.localStorage.getItem(AUTOSAVE_PREF_KEY) === 'true' } catch { return false }
}
function writeAutosavePreference(value: boolean) {
  try { window.localStorage.setItem(AUTOSAVE_PREF_KEY, value ? 'true' : 'false') } catch { /* best-effort only */ }
}

function motionLabel(movement: string | null): string {
  const option = MOTION_OPTIONS.find((candidate) => candidate.value === (movement || 'static'))
  return option ? option.label : movement || 'Estático'
}

/** Text entry keeps its own keys; buttons keep Space/Enter (their own activation). */
function ignoresTransportKey(target: EventTarget | null, key: string): boolean {
  const el = target as HTMLElement | null
  if (!el?.closest) return false
  if (el.closest('input, textarea, select, [contenteditable="true"]')) return true
  return key === ' ' && Boolean(el.closest('button, [role="button"], [role="tab"], [role="radio"]'))
}

type EditorContext = {
  draft: VideoDraft
  project: Pick<Project, 'id' | 'name'> | null
  productionTitle: string | null
  identitySnapshot: VisualTokensSnapshot | null
  identityError: string | null
}

export default function VideoCreativeEditorPage() {
  const params = useParams<{ draftId: string }>()
  const router = useRouter()
  const floating = useFloatingWorkbench()

  const [context, setContext] = useState<EditorContext | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  // AUTHORING state: exactly what VideoDraft persists.
  const [name, setName] = useState('')
  const [scenes, setScenes] = useState<VideoScene[]>([])
  // Gate B: the independent temporal layer (own absolute frames), saved with the Scenes by the same PATCH.
  const [timeline, setTimeline] = useState<VideoTimeline>(EMPTY_TIMELINE)
  // Output stage (VIDEO_CANVAS_OUTPUT_FORMAT_V1): document-level; null = legacy 1080×1920, never backfilled.
  const [videoCanvas, setVideoCanvas] = useState<VideoCanvas | null>(null)
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [autosaveEnabled, setAutosaveEnabledState] = useState(() => readAutosavePreference())
  const skipNextAutosaveRef = useRef(true)
  // EDITOR / VIEW state: never persisted.
  const [libraryFiles, setLibraryFiles] = useState<ReadonlyMap<string, PreviewLibraryFile>>(new Map())
  const [selectedIndex, setSelectedIndex] = useState(0)
  // Selection context: a primary Scene (selectedIndex) OR an independent item — never both (UI only).
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  // Third context (hierarchical Scene timing): one timed element INSIDE the selected Scene (UI only).
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null)
  const [timelinePicker, setTimelinePicker] = useState<null | { mode: 'add' | 'replace'; kind: 'visual' | 'audio' }>(null)
  // The single temporal cursor (currentFrame): editor state outside React render — see frame-cursor.ts.
  const [cursor] = useState(() => createFrameCursor())
  const [playing, setPlaying] = useState(false)
  const [lowerMode, setLowerMode] = useState<'scenes' | 'timeline'>('scenes')
  const [activeTab, setActiveTab] = useState<VideoInspectorSection>('content')
  const [inspectorOpen, setInspectorOpen] = useState(true)
  // VIEWPORT state (shared with Static): Player camera only — never authoring, never dirty, never render.
  // The surface it frames IS the authored stage; zoom/pan stay UI state.
  const stage = effectiveVideoCanvas(videoCanvas)
  const { attach: attachPreviewViewport, ...viewport } = usePreviewViewport({ surfaceWidth: stage.width, surfaceHeight: stage.height, floating, fallbackFitScale: 0.25 })
  // DOCK state (UI only): CENAS/TIMELINE panel mode + height, derived from the measured preview panel.
  const [dock, setDock] = useState<DockState>(INITIAL_DOCK_STATE)
  const [panelEl, setPanelEl] = useState<HTMLDivElement | null>(null)
  const [panelHeight, setPanelHeight] = useState(0)
  const [playerError, setPlayerError] = useState<string | null>(null)
  const [assetPickerOpen, setAssetPickerOpen] = useState(false)
  // VIDEO_FREE_SCENE_COMPOSITION_V1 (UI only): the explicit "Nova cena" choice and the free-image picker.
  const [newSceneOpen, setNewSceneOpen] = useState(false)
  const [freeImagePicker, setFreeImagePicker] = useState<null | { mode: 'add' } | { mode: 'replace'; elementId: string }>(null)
  // Camadas disclosure (UI only, never persisted).
  const [openElementId, setOpenElementId] = useState<string | null>(null)
  // VIDEO_FREE_SCENE_DIRECT_MANIPULATION_V1 — Preview tool (UI only: never saved, never dirty). Hand/Pan is the default.
  const [interactionMode, setInteractionMode] = useState<PreviewInteractionMode>(DEFAULT_PREVIEW_INTERACTION_MODE)
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false)
  const [promptBusy, setPromptBusy] = useState(false)
  const [promptError, setPromptError] = useState<string | null>(null)
  const playerRef = useRef<LivePlayerController | null>(null)
  // OUTPUT state: the existing render_executions lifecycle.
  const [renderExecution, setRenderExecution] = useState<RenderExecutionSummary | null>(null)
  const [renderSubmitting, setRenderSubmitting] = useState(false)
  const [renderError, setRenderError] = useState<string | null>(null)
  const [outputUrl, setOutputUrl] = useState<string | null>(null)
  const [outputUrlError, setOutputUrlError] = useState<string | null>(null)
  const [outputOpen, setOutputOpen] = useState(false)

  const draft = context?.draft ?? null
  const dirty = lastSavedSnapshot !== null && persistedVideoSnapshot(name, scenes, timeline, videoCanvas) !== lastSavedSnapshot

  // --- Load: VideoDraft (authority), Project identity, Project images, latest execution ---
  useEffect(() => {
    let cancelled = false
    async function load() {
      const response = await fetch(`/api/video-drafts?id=${encodeURIComponent(params.draftId)}`)
      const payload = await response.json().catch(() => null) as { draft?: VideoDraft; error?: string } | null
      // The read is owner-scoped, so "missing" and "not yours" look the same; never surface the raw DB error.
      if (!response.ok || !payload?.draft) throw new Error('Rascunho de vídeo não encontrado ou sem acesso.')
      const loaded = payload.draft
      const supabase = createClient()
      let project: EditorContext['project'] = null
      let identitySnapshot: VisualTokensSnapshot | null = null
      let identityError: string | null = null
      if (loaded.project_id) {
        const { data } = await supabase.from('projects').select('id, name, identity').eq('id', loaded.project_id).maybeSingle()
        if (data) {
          project = { id: data.id, name: data.name }
          try {
            const identity = normalizeProjectIdentity(data.identity)
            if (identity) identitySnapshot = adaptProjectIdentityToVisualTokens(data.id, identity)
            else identityError = 'O Projeto ainda não tem Identidade válida; a prévia e o render precisam dela.'
          } catch {
            identityError = 'A Identidade do Projeto é inválida; a prévia e o render precisam dela.'
          }
        }
      }
      let productionTitle: string | null = null
      if (loaded.production_id) {
        const { data } = await supabase.from('productions').select('title').eq('id', loaded.production_id).maybeSingle()
        productionTitle = data?.title ?? null
      }
      if (cancelled) return
      const normalized = normalizeLoadedScenes(loaded.scenes)
      skipNextAutosaveRef.current = true
      setContext({ draft: loaded, project, productionTitle, identitySnapshot, identityError })
      const loadedTimeline = readVideoTimeline(loaded.timeline)
      const loadedCanvas = readVideoCanvas(loaded.canvas)
      setName(loaded.name)
      setScenes(normalized)
      setTimeline(loadedTimeline)
      setVideoCanvas(loadedCanvas)
      setLastSavedSnapshot(persistedVideoSnapshot(loaded.name, normalized, loadedTimeline, loadedCanvas))

      const execResponse = await fetch(`/api/render-executions?videoDraftId=${loaded.id}`).catch(() => null)
      if (execResponse?.ok && !cancelled) {
        const execPayload = await execResponse.json().catch(() => null) as { execution?: RenderExecutionSummary } | null
        if (execPayload?.execution) setRenderExecution(execPayload.execution)
      }
    }
    load().catch((cause: unknown) => { if (!cancelled) setLoadError(cause instanceof Error ? cause.message : 'Erro ao carregar o rascunho.') })
    return () => { cancelled = true }
  }, [params.draftId])

  const projectId = draft?.project_id ?? null
  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    void (async () => {
      try {
        // Images for Scene heroes + (Gate B) video/audio for the independent layer; signed display URLs.
        const response = await fetch(`/api/library-files?projectId=${encodeURIComponent(projectId)}`)
        if (!response.ok) return
        const payload = await response.json() as { files?: LibraryFile[] }
        const media = (payload.files ?? []).filter((file) => file.kind === 'image' || file.kind === 'video' || file.kind === 'audio')
        if (!cancelled) setLibraryFiles(new Map(media.map((file) => [file.id, file])))
      } catch {
        // best-effort: the Player shows the Template's default image until assets load
      }
    })()
    return () => { cancelled = true }
  }, [projectId])

  // Preview panel height (Player + transport + dock): the dock sizes are derived from it.
  useEffect(() => {
    const el = panelEl
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect) setPanelHeight(rect.height)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [panelEl])

  // --- Derived temporal state (never stored) ---
  const ranges = useMemo(() => deriveSceneRanges(scenes), [scenes])
  const totalFrames = ranges.length ? ranges[ranges.length - 1].endFrame : 0
  const safeSelectedIndex = scenes.length ? Math.min(selectedIndex, scenes.length - 1) : -1
  const selectedScene = safeSelectedIndex >= 0 ? scenes[safeSelectedIndex] : null
  const selectedRange = safeSelectedIndex >= 0 ? ranges[safeSelectedIndex] : null

  const identitySnapshot = context?.identitySnapshot ?? null
  const draftId = draft?.id ?? null
  const draftProductionId = draft?.production_id ?? null
  const livePreview = useMemo(() => {
    if (!draftId || !identitySnapshot) return null
    return buildLivePreviewInput({ draft: { id: draftId, project_id: projectId, production_id: draftProductionId }, scenes, timeline, canvas: videoCanvas, identitySnapshot, libraryFiles })
  }, [draftId, projectId, draftProductionId, identitySnapshot, scenes, timeline, videoCanvas, libraryFiles])

  // The selected Scene's composition (VIDEO_SCENE_COMPOSITION_PARITY_V1): the Inspector hydrates from it on every
  // selection change — derived from the Scene itself, so no per-Scene UI state can bleed between Scenes.
  // A free Scene has no Template composition: sceneView then describes the draft's Template family only.
  const selectedIsFree = selectedScene ? isFreeScene(selectedScene) : false
  const sceneView = useMemo(() => videoSceneComposition(selectedScene && !isFreeScene(selectedScene) ? selectedScene : undefined), [selectedScene])
  // Draft-level rule: every Template-backed Scene must draw the stage; free Scenes only need platform bounds.
  const canvasSupport = useMemo(() => videoDraftCanvasSupport(scenes, { width: stage.width, height: stage.height }), [scenes, stage.width, stage.height])
  const canvasSupportFor = useCallback((candidate: VideoCanvas) => videoDraftCanvasSupport(scenes, candidate), [scenes])
  const sceneMotionOptions = useMemo(() => motionOptions(sceneView.resolved.layoutId), [sceneView])

  const thumbnails = useMemo(() => Object.fromEntries(scenes.map((scene) => {
    if (isFreeScene(scene)) {
      const image = freeElements(scene).find((element) => element.kind === 'image' && !element.hidden)
      const file = image?.kind === 'image' ? libraryFiles.get(image.library_file_id) : undefined
      return [scene.id, file ? (file.thumbnail_url || file.public_url) : undefined]
    }
    // A layout without a content image does not draw the Scene's hero, so the card does not show it either.
    if (!resolveSceneComposition(scene).usesHero) return [scene.id, undefined]
    const file = scene.library_file_id ? libraryFiles.get(scene.library_file_id) : undefined
    return [scene.id, file ? (file.thumbnail_url || file.public_url) : scene.library_file_id ? undefined : TEMPLATE_HERO_URL]
  })), [scenes, libraryFiles])
  const libraryFileNames = useMemo(() => new Map([...libraryFiles.values()].map((file) => [file.id, file.name])), [libraryFiles])
  // Free Scene child rows / timing section label (VIDEO_FREE_ELEMENT_TIMING_V1): same names as the Elementos list.
  const freeTimingLabel = useCallback((element: FreeSceneElement) => `${element.kind === 'text' ? 'Texto' : 'Imagem'} · ${freeElementLabel(element, element.kind === 'image' ? libraryFileNames.get(element.library_file_id) : undefined)}`, [libraryFileNames])
  const sceneCaptions = useMemo(() => Object.fromEntries(scenes.map((scene) => {
    if (isFreeScene(scene)) {
      const text = freeElements(scene).find((element) => element.kind === 'text')
      return [scene.id, text ? `Livre · ${freeElementLabel(text)}` : 'Livre · em branco']
    }
    const composition = resolveSceneComposition(scene)
    const title = typeof composition.content.title === 'string' ? composition.content.title.replace(/\s+/g, ' ').trim() : ''
    return [scene.id, title ? `${composition.layout.label} · ${title}` : composition.layout.label]
  })), [scenes])

  // --- currentFrame: ONE editor cursor. The Player is the clock; every seek goes through it. ---
  const seek = useCallback((target: number) => {
    const next = clampFrame(target, totalFrames)
    playerRef.current?.seekTo(next)
    cursor.set(next)
  }, [cursor, totalFrames])
  const togglePlay = useCallback(() => playerRef.current?.toggle(), [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (ignoresTransportKey(event.target, event.key) || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === ' ') { event.preventDefault(); togglePlay() }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); seek(cursor.get() - (event.shiftKey ? TIMELINE_FPS : 1)) }
      else if (event.key === 'ArrowRight') { event.preventDefault(); seek(cursor.get() + (event.shiftKey ? TIMELINE_FPS : 1)) }
      else if (event.key === 'Home') { event.preventDefault(); seek(0) }
      else if (event.key === 'End') { event.preventDefault(); seek(totalFrames - 1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cursor, seek, togglePlay, totalFrames])

  // --- Scene authoring (VideoScene[] only) ---
  function selectScene(index: number, seekToStart = true) {
    if (index < 0 || index >= scenes.length) return
    setSelectedIndex(index)
    setSelectedItemId(null)
    setSelectedElementId(null)
    if (seekToStart && ranges[index]) seek(ranges[index].startFrame)
  }
  function selectSceneById(sceneId: string) {
    const index = scenes.findIndex((scene) => scene.id === sceneId)
    if (index >= 0) { setSelectedIndex(index); setSelectedItemId(null); setSelectedElementId(null) }
  }
  /** A Scene element keeps its owning Scene selected; its Camadas entry opens and the playhead goes to its entry. */
  function selectSceneElement(sceneId: string, elementId: string) {
    const index = scenes.findIndex((scene) => scene.id === sceneId)
    if (index < 0) return
    setSelectedIndex(index)
    setSelectedItemId(null)
    setSelectedElementId(elementId)
    setActiveTab('element')
    setOpenElementId(elementId)
    const row = sceneTimingRows(scenes[index], ranges[index].startFrame, ranges[index].durationFrames, freeTimingLabel).find((candidate) => candidate.elementId === elementId)
    if (row && !row.range.outside) seek(row.globalStartFrame)
  }

  // --- Independent temporal items (Gate B): absolute frames, never follow Scenes ---
  const selectedItem = selectedItemId ? timeline.items.find((item) => item.id === selectedItemId) ?? null : null
  /** Selecting an independent item leaves the Scene-element context (never both). */
  function selectItem(itemId: string | null) {
    setSelectedItemId(itemId)
    setSelectedElementId(null)
  }
  const selectedElementRow = useMemo(() => {
    if (selectedItemId || !selectedElementId || !selectedScene || !selectedRange) return null
    return sceneTimingRows(selectedScene, selectedRange.startFrame, selectedRange.durationFrames, freeTimingLabel).find((row) => row.elementId === selectedElementId) ?? null
  }, [selectedItemId, selectedElementId, selectedScene, selectedRange, freeTimingLabel])
  function editSelectedElementTiming(patch: ElementTimingPatch) {
    if (!selectedElementId || !selectedRange) return
    const elementId = selectedElementId
    const frames = selectedRange.durationFrames
    editSelectedScene((scene) => setSceneElementTiming(scene, elementId, patch, frames))
  }
  function addTextItem() {
    const result = addTemporalItem(timeline, { kind: 'text', text: 'Nome · função' }, cursor.get(), 3 * TIMELINE_FPS, crypto.randomUUID())
    if (!result) return
    setTimeline(result.timeline)
    selectItem(result.item.id)
  }
  function addMediaItem(kind: 'visual' | 'audio', file: LibraryFile) {
    // The FIRST audio is a bed: from 0, explicitly ending with the video (follows Scene retiming).
    // Later audio (voice-over, etc.) starts at the playhead with a fixed 5 s. B-roll: 2 s at the playhead.
    const isBed = kind === 'audio' && !timeline.items.some((item) => item.kind === 'audio')
    const at = isBed ? 0 : cursor.get()
    const frames = kind === 'audio' ? DEFAULT_AUDIO_FRAMES : DEFAULT_ITEM_FRAMES
    const result = addTemporalItem(timeline, kind === 'audio' ? { kind: 'audio', library_file_id: file.id, endsWithSequence: isBed } : { kind: 'visual', library_file_id: file.id }, at, frames, crypto.randomUUID())
    if (!result) return
    setTimeline(result.timeline)
    selectItem(result.item.id)
  }
  function onAddItem(kind: TemporalItemKind) {
    if (kind === 'text') addTextItem()
    else setTimelinePicker({ mode: 'add', kind })
  }
  function temporalItemLabel(item: TemporalItem): string {
    if (item.kind === 'text') return item.text.split('\n')[0]
    return libraryFiles.get(item.library_file_id)?.name ?? 'Arquivo da Biblioteca'
  }
  function patchSelectedScene(patch: Partial<Omit<VideoScene, 'id' | 'order'>>) {
    if (!selectedScene) return
    setScenes((current) => updateVideoScene(current, selectedScene.id, patch))
  }
  /** Scene composition edit (scene-composition.ts): touches ONLY that Scene's `composition`. */
  function editSelectedScene(edit: (scene: VideoScene) => VideoScene) {
    if (!selectedScene) return
    const sceneId = selectedScene.id
    setScenes((current) => current.map((scene) => (scene.id === sceneId ? edit(scene) : scene)))
  }
  /** "Nova cena" always asks: Em branco (free composition) or the Template. Cancelling changes nothing. */
  function addScene() {
    if (scenes.length >= MAX_VIDEO_SCENES) return
    setNewSceneOpen(true)
  }
  function createScene(kind: 'free' | 'template') {
    setNewSceneOpen(false)
    if (scenes.length >= MAX_VIDEO_SCENES) return
    const afterIndex = safeSelectedIndex >= 0 ? safeSelectedIndex : undefined
    const result = kind === 'free'
      ? insertVideoScene(scenes, createFreeScene(scenes.length + 1, crypto.randomUUID(), NEW_SCENE_DURATION_SECONDS), afterIndex)
      : addVideoScene(scenes, afterIndex)
    setSelectedItemId(null)
    setSelectedElementId(null)
    setOpenElementId(null)
    if (kind === 'free') setActiveTab('element')
    setScenes(result.scenes)
    setSelectedIndex(result.index)
    const start = deriveSceneRanges(result.scenes)[result.index]?.startFrame ?? 0
    cursor.set(start)
    requestAnimationFrame(() => playerRef.current?.seekTo(start))
  }
  function removeSelectedScene() {
    if (!selectedScene || scenes.length <= 1) return
    setScenes(removeVideoScene(scenes, selectedScene.id))
    setSelectedIndex(Math.max(0, safeSelectedIndex - 1))
    setRemoveDialogOpen(false)
  }
  function moveScene(fromIndex: number, toIndex: number) {
    if (toIndex < 0 || toIndex >= scenes.length || fromIndex === toIndex) return
    const moved = scenes[fromIndex]
    const next = reorderScenes(scenes, fromIndex, toIndex)
    setScenes(next)
    setSelectedIndex(next.findIndex((scene) => scene.id === moved.id))
  }
  function changeDuration(sceneId: string, seconds: number) {
    setScenes((current) => setSceneDuration(current, sceneId, seconds))
  }

  // --- Direct manipulation (Select tool): ONE free-element selection shared with the Inspector (openElementId) ---
  function selectFreeElementFromPreview(sceneId: string, elementId: string | null) {
    const index = scenes.findIndex((scene) => scene.id === sceneId)
    if (index < 0) return
    if (index !== safeSelectedIndex) setSelectedIndex(index) // the playhead is already inside it: no seek
    setSelectedItemId(null)
    // The same element selection as the Timeline child row (VIDEO_FREE_ELEMENT_TIMING_V1): its timing section follows.
    setSelectedElementId(elementId)
    setOpenElementId(elementId)
    if (elementId) setActiveTab('element')
  }
  /** Authored edit: the same pure helper the Inspector geometry fields use. */
  function changeFreeBoxFromPreview(sceneId: string, elementId: string, box: FreeElementBox) {
    setScenes((current) => current.map((scene) => (scene.id === sceneId ? setFreeElementBox(scene, elementId, box) : scene)))
  }
  /** Manipulation freezes the frame being edited (the Player is the only clock). */
  function pauseForManipulation() {
    if (playerRef.current?.isPlaying()) playerRef.current.pause()
  }

  // --- Save (explicit authority) + optional autosave, same PATCH as /videos ---
  const saveNow = useCallback(async (): Promise<boolean> => {
    if (!draft) return false
    setSaveStatus('saving')
    setSaveError(null)
    const snapshot = persistedVideoSnapshot(name, scenes, timeline, videoCanvas)
    try {
      const response = await fetch('/api/video-drafts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildVideoDraftSaveBody(draft, name, scenes, timeline, videoCanvas)),
      })
      const payload = await response.json().catch(() => null) as { draft?: VideoDraft; error?: string } | null
      if (!response.ok || !payload?.draft) throw new Error(payload?.error || 'Não foi possível salvar.')
      setLastSavedSnapshot(snapshot)
      setContext((current) => current && payload.draft ? { ...current, draft: { ...current.draft, ...payload.draft, scenes: current.draft.scenes } } : current)
      setSaveStatus('saved')
      return true
    } catch (cause: unknown) {
      setSaveStatus('error')
      setSaveError(cause instanceof Error ? cause.message : 'Não foi possível salvar.')
      return false
    }
  }, [draft, name, scenes, timeline, videoCanvas])

  useEffect(() => {
    if (!draft) return
    if (skipNextAutosaveRef.current) { skipNextAutosaveRef.current = false; return }
    if (!autosaveEnabled || !dirty) return
    const timeout = window.setTimeout(() => { void saveNow() }, 800)
    return () => window.clearTimeout(timeout)
  }, [draft, name, scenes, timeline, videoCanvas, autosaveEnabled, dirty, saveNow])

  /** Authored stage change: dirty like any edit. The camera re-fits (UI state, never dirty). */
  function changeVideoCanvas(next: VideoCanvas) {
    setVideoCanvas(next)
    viewport.action('fit')
  }

  function revert() {
    if (!lastSavedSnapshot) return
    const saved = JSON.parse(lastSavedSnapshot) as { name: string; scenes: VideoScene[]; timeline?: VideoTimeline; canvas?: VideoCanvas }
    const savedCanvas = readVideoCanvas(saved.canvas)
    if (effectiveVideoCanvas(savedCanvas).width !== stage.width || effectiveVideoCanvas(savedCanvas).height !== stage.height) viewport.action('fit')
    setVideoCanvas(savedCanvas)
    setName(saved.name)
    setScenes(saved.scenes)
    setTimeline(readVideoTimeline(saved.timeline))
    setSelectedItemId((id) => (id && saved.timeline?.items.some((item) => item.id === id) ? id : null))
    setSelectedIndex((index) => Math.min(index, Math.max(0, saved.scenes.length - 1)))
  }

  function setAutosaveEnabled(value: boolean) {
    setAutosaveEnabledState(value)
    writeAutosavePreference(value)
  }

  // --- Final render: existing server-authoritative path, from the SAVED VideoDraft ---
  async function renderVideo() {
    if (!draft || renderSubmitting) return
    setRenderError(null)
    if (dirty) {
      // Render reads the persisted VideoDraft server-side; unsaved edits must be saved first (explicitly labelled).
      const saved = await saveNow()
      if (!saved) return
    }
    setRenderSubmitting(true)
    setOutputUrl(null)
    setOutputUrlError(null)
    try {
      const response = await fetch(`/api/video-drafts/${draft.id}/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
      })
      const payload = await response.json().catch(() => null) as { executionId?: string; status?: RenderExecutionSummary['status']; queuedAt?: string; error?: string } | null
      if (!response.ok || !payload?.executionId || !payload.status) throw new Error(payload?.error || 'Não foi possível iniciar a renderização.')
      setRenderExecution({
        id: payload.executionId, video_draft_id: draft.id, status: payload.status, queued_at: payload.queuedAt ?? new Date().toISOString(), attempt: 1,
        claimed_at: null, completed_at: null, failed_at: null, output_mime_type: null, output_size_bytes: null, output_duration_ms: null, error_code: null, error_message: null,
      })
    } catch (cause: unknown) {
      setRenderError(cause instanceof Error ? cause.message : 'Não foi possível iniciar a renderização.')
    } finally {
      setRenderSubmitting(false)
    }
  }

  const executionId = renderExecution?.id ?? null
  const executionStatus = renderExecution?.status ?? null
  useEffect(() => {
    if (!executionId || (executionStatus !== 'queued' && executionStatus !== 'claimed')) return
    let cancelled = false
    let timeoutId: number | undefined
    const poll = async () => {
      try {
        const response = await fetch(`/api/render-executions/${executionId}`)
        if (response.ok && !cancelled) {
          const payload = await response.json() as { execution?: RenderExecutionSummary }
          if (payload.execution && !cancelled) setRenderExecution(payload.execution)
        }
      } catch {
        // transient: the next tick retries
      }
      if (!cancelled) timeoutId = window.setTimeout(poll, RENDER_POLL_INTERVAL_MS)
    }
    timeoutId = window.setTimeout(poll, RENDER_POLL_INTERVAL_MS)
    return () => { cancelled = true; if (timeoutId) window.clearTimeout(timeoutId) }
  }, [executionId, executionStatus])

  const fetchOutputUrl = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/render-executions/${id}/output-url`)
      const payload = await response.json().catch(() => null) as { url?: string } | null
      if (response.ok && payload?.url) { setOutputUrl(payload.url); return }
      setOutputUrlError('Não foi possível carregar o vídeo renderizado.')
    } catch {
      setOutputUrlError('Não foi possível carregar o vídeo renderizado.')
    }
  }, [])

  function openOutput() {
    if (!executionId) return
    setOutputOpen(true)
    if (!outputUrl) { setOutputUrlError(null); void fetchOutputUrl(executionId) }
  }

  async function downloadOutput() {
    if (!executionId) return
    const response = await fetch(`/api/render-executions/${executionId}/output-url?disposition=attachment`).catch(() => null)
    const payload = await response?.json().catch(() => null) as { url?: string } | null
    if (payload?.url) window.location.href = payload.url
  }

  async function generatePrompt() {
    if (!selectedScene?.description.trim() || !draft) return
    setPromptBusy(true)
    setPromptError(null)
    try {
      const response = await fetch('/api/videos/generate-scene-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: selectedScene.description, sceneNumber: safeSelectedIndex + 1, duration: selectedScene.duration, movement: selectedScene.movement, projectId: draft.project_id, videoName: name }),
      })
      const payload = await response.json().catch(() => null) as { prompt?: string; error?: string } | null
      if (!response.ok || !payload?.prompt) throw new Error(payload?.error || 'Erro ao gerar prompt da cena.')
      patchSelectedScene({ prompt: payload.prompt })
    } catch (cause: unknown) {
      setPromptError(cause instanceof Error ? cause.message : 'Erro ao gerar prompt da cena.')
    } finally {
      setPromptBusy(false)
    }
  }

  // --- Loading / error states ---
  if (loadError) {
    return <DashboardPage><DashboardPageContent width="4xl"><Card><CardContent className="space-y-4 p-6"><p className="text-sm text-muted-foreground">{loadError}</p><Button variant="outline" onClick={() => router.push('/videos')}>Voltar para Vídeos</Button></CardContent></Card></DashboardPageContent></DashboardPage>
  }
  if (!context || !draft) {
    return <DashboardPage><DashboardPageContent width="4xl"><div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div></DashboardPageContent></DashboardPage>
  }

  // --- Preview Surface: Live Authoring Player ---
  const canvasW = stage.width
  const canvasH = stage.height
  const playerWidth = viewport.scaledWidth
  const playerHeight = viewport.scaledHeight
  // A stored stage the Template does not declare (only reachable through the API) is named plainly, not as a resolver error.
  const stageBlocker = canvasSupport.supported ? null : canvasSupport.templateBackedScenes > 0
    ? `O template ${canvasSupport.templateLabel} não desenha ${canvasW}×${canvasH} (${canvasSupport.templateBackedScenes} cena${canvasSupport.templateBackedScenes > 1 ? 's' : ''} com template). Escolha um formato compatível em Formato.`
    : `${canvasW}×${canvasH} está fora dos limites de formato do vídeo.`
  const previewBlocker = context.identityError
    ?? stageBlocker
    ?? (!livePreview ? null : !livePreview.ok ? livePreview.message : null)
  const renderActive = renderSubmitting || executionStatus === 'queued' || executionStatus === 'claimed'
  // A composition the Template rejects (e.g. a required field left empty) is shown in the Player and blocks render.
  const canRender = Boolean(draft.project_id && draft.production_id && scenes.length > 0 && !context.identityError && livePreview?.ok !== false)

  const transport = (
    <div className={cn('flex shrink-0 items-center justify-between gap-2 border-t border-border/40 px-3 py-1.5', floating ? 'flex-nowrap overflow-x-auto' : 'flex-wrap')} data-testid="player-transport">
      <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Reprodução">
        <Button size="icon-sm" variant="ghost" onClick={() => seek(0)} aria-label="Ir para o início" title="Início (Home)"><SkipBack className="h-3.5 w-3.5" /></Button>
        <Button size="icon-sm" variant="ghost" onClick={() => seek(cursor.get() - 1)} aria-label="Frame anterior" title="Frame anterior (←, Shift = 1s)"><StepBack className="h-3.5 w-3.5" /></Button>
        <Button size="icon-sm" variant="default" onClick={togglePlay} disabled={!livePreview?.ok} aria-label={playing ? 'Pausar' : 'Reproduzir'} title="Reproduzir / pausar (Espaço)" data-testid="player-play-toggle" data-playing={playing}>{playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}</Button>
        <Button size="icon-sm" variant="ghost" onClick={() => seek(cursor.get() + 1)} aria-label="Próximo frame" title="Próximo frame (→, Shift = 1s)"><StepForward className="h-3.5 w-3.5" /></Button>
        <Button size="icon-sm" variant="ghost" onClick={() => seek(totalFrames - 1)} aria-label="Ir para o fim" title="Fim (End)"><SkipForward className="h-3.5 w-3.5" /></Button>
        <TransportReadout cursor={cursor} totalFrames={totalFrames} ranges={ranges} />
      </div>
      <ViewportZoomControls
        zoom={viewport.zoom}
        fitScale={viewport.fitScale}
        onZoomChange={viewport.setZoom}
        onStep={viewport.step}
        onAction={viewport.action}
        trailing={<>
          <div className="ml-1 flex shrink-0 items-center rounded-md border border-border/60 p-0.5" role="radiogroup" aria-label="Ferramenta da prévia" data-testid="preview-tool">
            <Button size="icon-sm" variant={interactionMode === 'select' ? 'secondary' : 'ghost'} role="radio" aria-checked={interactionMode === 'select'} onClick={() => setInteractionMode('select')} aria-label="Selecionar e editar" title="Selecionar e editar (mover e redimensionar elementos de cenas livres)" data-testid="preview-tool-select"><MousePointer2 className="h-3.5 w-3.5" /></Button>
            <Button size="icon-sm" variant={interactionMode === 'pan' ? 'secondary' : 'ghost'} role="radio" aria-checked={interactionMode === 'pan'} onClick={() => setInteractionMode('pan')} aria-label="Mão (mover a visualização)" title="Mão: arrastar move a visualização" data-testid="preview-tool-pan"><Hand className="h-3.5 w-3.5" /></Button>
          </div>
          {floating && !inspectorOpen ? <Button size="icon-sm" variant="outline" onClick={() => setInspectorOpen(true)} aria-label="Abrir Inspector" title="Abrir Inspector" data-testid="inspector-launcher"><PanelRight className="h-3.5 w-3.5" /></Button> : null}
        </>}
      />
      <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Estado do vídeo">
        <Button size="sm" variant="ghost" className="h-8 shrink-0 gap-1 px-1.5 text-[11px]" disabled={!dirty} onClick={revert} title="Descartar alterações não salvas e restaurar o último estado salvo."><Undo2 className="h-3 w-3" />Voltar ao salvo</Button>
        <label className="ml-1 flex shrink-0 cursor-pointer items-center gap-1 text-[11px] text-muted-foreground"><input type="checkbox" checked={autosaveEnabled} onChange={(event) => setAutosaveEnabled(event.target.checked)} />Auto-save</label>
      </div>
    </div>
  )

  const sceneViews = lowerMode === 'scenes' ? (
    <SceneStrip
      scenes={scenes}
      ranges={ranges}
      cursor={cursor}
      selectedIndex={safeSelectedIndex}
      thumbnails={thumbnails}
      motionLabel={motionLabel}
      captions={sceneCaptions}
      canAdd={scenes.length < MAX_VIDEO_SCENES}
      onSelect={(index) => selectScene(index)}
      onAdd={addScene}
    />
  ) : (
    <SceneTimeline
      scenes={scenes}
      cursor={cursor}
      playing={playing}
      selectedSceneId={selectedScene?.id ?? null}
      thumbnails={thumbnails}
      onSeek={seek}
      onSelectScene={selectSceneById}
      onReorder={moveScene}
      onDurationChange={changeDuration}
      items={timeline.items}
      selectedItemId={selectedItemId}
      itemLabel={temporalItemLabel}
      onSelectItem={selectItem}
      onMoveItem={(id, frame) => setTimeline((current) => moveTemporalItem(current, id, frame))}
      onResizeItem={(id, frames) => setTimeline((current) => resizeTemporalItem(current, id, frames))}
      onAddItem={onAddItem}
      selectedElement={selectedScene && selectedElementId && !selectedItemId ? { sceneId: selectedScene.id, elementId: selectedElementId } : null}
      onSelectElement={selectSceneElement}
      freeElementLabel={freeTimingLabel}
    />
  )

  const canvas = (
    <div ref={setPanelEl} className={floating ? 'flex h-full min-h-0 flex-col' : 'flex flex-col'} data-testid="video-preview-panel">
      <div
        ref={attachPreviewViewport}
        className={floating ? 'relative min-h-0 flex-1 overflow-hidden' : 'relative h-[min(62vh,560px)] overflow-hidden'}
        style={{ cursor: interactionMode === 'select' ? 'default' : viewport.panning ? 'grabbing' : 'grab', touchAction: floating || interactionMode === 'select' ? 'none' : 'pan-y' }}
        {...(interactionMode === 'pan' ? viewport.panHandlers : {})}
        data-interaction-mode={interactionMode}
        aria-label="Prévia ao vivo (arraste para mover a visualização)"
        data-testid="live-player-viewport"
        data-pan={`${Math.round(viewport.effectivePan.x)},${Math.round(viewport.effectivePan.y)}`}
      >
        {previewBlocker ? (
          <div className="absolute inset-0 flex items-center justify-center p-3"><div className="flex max-w-sm flex-col items-center gap-2 text-center text-sm text-muted-foreground" role="alert"><AlertCircle className="h-5 w-5" />{previewBlocker}</div></div>
        ) : livePreview?.ok ? (
          // Same camera as the Static Canvas: centered + pan, never scrolled. The Player never takes pointer
          // input (dragging pans the view; playback is the transport / Space), exactly like the Canvas card.
          <div className="absolute overflow-hidden rounded-sm shadow-lg" style={{ left: viewport.origin.left, top: viewport.origin.top, width: playerWidth, height: playerHeight, pointerEvents: 'none' }} data-testid="live-player" data-live-duration-frames={livePreview.resolvedInput.manifest.specification.duration_frames}>
            <LiveTimelinePlayer
              resolvedInput={livePreview.resolvedInput}
              width={playerWidth}
              height={playerHeight}
              controllerRef={playerRef}
              onFrame={cursor.set}
              onPlayingChange={setPlaying}
              onError={setPlayerError}
            />
          </div>
        ) : <div className="absolute inset-0 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
        {/* Editor-only chrome over the Player (never rendered by the Player/worker): Select tool on the free Scene under the playhead. */}
        {interactionMode === 'select' && !previewBlocker && livePreview?.ok ? (
          <FreeSceneOverlay
            scenes={scenes}
            ranges={ranges}
            cursor={cursor}
            left={viewport.origin.left}
            top={viewport.origin.top}
            width={playerWidth}
            height={playerHeight}
            selectedElementId={openElementId}
            onSelect={selectFreeElementFromPreview}
            onBoxChange={changeFreeBoxFromPreview}
            onInteractionStart={pauseForManipulation}
          />
        ) : null}
        {playerError ? <p className="absolute bottom-2 left-2 right-2 rounded bg-destructive/90 px-2 py-1 text-xs text-destructive-foreground" role="alert">Prévia: {playerError}</p> : null}
        {livePreview?.ok && livePreview.missingAssets.length > 0 ? <p className="absolute left-2 top-2 rounded bg-black/70 px-2 py-1 text-[11px] text-white">Carregando {livePreview.missingAssets.length} asset(s) da Biblioteca…</p> : null}
        <span className="pointer-events-none absolute right-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white/80">Prévia ao vivo</span>
      </div>
      {transport}
      <AuthoringDock
        view={lowerMode}
        onViewChange={setLowerMode}
        dock={dock}
        onDockChange={setDock}
        workbenchHeight={floating ? panelHeight : 720}
        resizable={floating}
        summary={sequenceSummary(scenes, totalFrames / TIMELINE_FPS)}
      >
        {sceneViews}
      </AuthoringDock>
    </div>
  )

  const inspector = (
    <div className="space-y-3">
      {selectedScene && selectedRange ? (
        <section className="space-y-2 rounded-md border border-border/60 bg-muted/30 p-2" aria-label="Cena selecionada" data-testid="scene-context">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold">Cena {safeSelectedIndex + 1} <span className="font-normal text-muted-foreground">de {scenes.length}</span></p>
            <p className="text-[11px] tabular-nums text-muted-foreground">{formatTimecode(selectedRange.startFrame)} → {formatTimecode(selectedRange.endFrame)}</p>
          </div>
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1 space-y-1">
              <Label htmlFor="scene-duration" className="text-[11px]">Duração (s)</Label>
              <Input
                key={`${selectedScene.id}:${selectedScene.duration}`}
                id="scene-duration"
                type="number"
                inputMode="decimal"
                min={MIN_SCENE_DURATION_SECONDS}
                max={MAX_SCENE_DURATION_SECONDS}
                step={0.5}
                defaultValue={Number(selectedScene.duration.toFixed(2))}
                onBlur={(event) => { const value = Number(event.target.value); if (Number.isFinite(value) && value !== selectedScene.duration) changeDuration(selectedScene.id, clampSceneDurationSeconds(value)) }}
                onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur() }}
                className="h-8"
                data-testid="scene-duration-input"
              />
            </div>
            <div className="flex shrink-0 gap-1">
              <Button size="icon-sm" variant="outline" onClick={() => moveScene(safeSelectedIndex, safeSelectedIndex - 1)} disabled={safeSelectedIndex <= 0} aria-label="Mover cena para antes" title="Mover para antes"><ArrowLeft className="h-3.5 w-3.5" /></Button>
              <Button size="icon-sm" variant="outline" onClick={() => moveScene(safeSelectedIndex, safeSelectedIndex + 1)} disabled={safeSelectedIndex >= scenes.length - 1} aria-label="Mover cena para depois" title="Mover para depois"><ArrowRight className="h-3.5 w-3.5" /></Button>
              <Button size="icon-sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => setRemoveDialogOpen(true)} disabled={scenes.length <= 1} aria-label={`Remover cena ${safeSelectedIndex + 1}`} title={scenes.length <= 1 ? 'O vídeo precisa de pelo menos uma cena' : 'Remover cena'}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
        </section>
      ) : null}
      {selectedElementRow && selectedScene && selectedRange ? (
        // Hierarchical Scene timing: WHEN this element participates inside its Scene (Scene-local; moves with the Scene).
        <section className="space-y-2 rounded-md border border-violet-500/40 bg-violet-500/5 p-2" aria-label={`Elemento ${selectedElementRow.label} da cena ${safeSelectedIndex + 1}`} data-testid="element-timing" data-element-id={selectedElementRow.elementId}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold">{selectedElementRow.label} <span className="font-normal text-muted-foreground">· elemento da cena {safeSelectedIndex + 1}</span></p>
            <p className="text-[11px] tabular-nums text-muted-foreground" data-testid="element-timing-global">{selectedElementRow.range.outside ? 'fora da cena' : `${formatTimecode(selectedElementRow.globalStartFrame)} → ${formatTimecode(selectedElementRow.globalEndFrame)}`}</p>
          </div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Timing na cena</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="element-start" className="text-[11px]">Início na cena (s)</Label>
              <Input key={`${selectedScene.id}:${selectedElementRow.elementId}:s:${selectedElementRow.authored?.start_frame ?? 0}`} id="element-start" type="number" min={0} step={0.1} defaultValue={Number(((selectedElementRow.authored?.start_frame ?? 0) / TIMELINE_FPS).toFixed(2))} className="h-8"
                onBlur={(event) => { const value = Number(event.target.value); if (Number.isFinite(value)) editSelectedElementTiming({ start_frame: Math.round(value * TIMELINE_FPS) }) }}
                onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur() }} data-testid="element-start-input" />
            </div>
            {selectedElementRow.range.followsScene ? (
              <div className="space-y-1">
                <span className="text-[11px] font-medium">Duração</span>
                <p className="flex h-8 items-center text-xs text-muted-foreground" data-testid="element-duration-follow">Até o fim da cena · {formatSeconds((selectedElementRow.range.endFrame - selectedElementRow.range.startFrame) / TIMELINE_FPS)}</p>
              </div>
            ) : (
              <div className="space-y-1">
                <Label htmlFor="element-duration" className="text-[11px]">Duração (s)</Label>
                <Input key={`${selectedScene.id}:${selectedElementRow.elementId}:d:${selectedElementRow.authored?.duration_frames ?? 0}`} id="element-duration" type="number" min={0.1} step={0.1} defaultValue={Number(((selectedElementRow.authored?.duration_frames ?? 0) / TIMELINE_FPS).toFixed(2))} className="h-8"
                  onBlur={(event) => { const value = Number(event.target.value); if (Number.isFinite(value)) editSelectedElementTiming({ duration_frames: Math.round(value * TIMELINE_FPS) }) }}
                  onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur() }} data-testid="element-duration-input" />
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Fim do elemento">
            <span className="text-[11px] text-muted-foreground">Fim</span>
            {([['scene', 'Até o fim da cena'], ['fixed', 'Duração fixa']] as const).map(([mode, label]) => {
              const checked = (mode === 'scene') === selectedElementRow.range.followsScene
              return <Button key={mode} size="sm" variant={checked ? 'default' : 'outline'} role="radio" aria-checked={checked} className="h-7 px-2 text-xs" data-testid="element-end-mode" data-value={mode}
                onClick={() => { if (!checked) editSelectedElementTiming({ duration_frames: mode === 'scene' ? null : selectedElementRow.range.endFrame - selectedElementRow.range.startFrame }) }}>{label}</Button>
            })}
          </div>
          {selectedElementRow.hidden ? <p className="text-[11px] text-amber-600 dark:text-amber-400" role="alert" data-testid="element-timing-hidden">Oculto em {selectedIsFree ? 'Elementos' : 'Camadas'}: não aparece, qualquer que seja o tempo.</p> : null}
          {selectedElementRow.range.outside ? <p className="text-[11px] text-amber-600 dark:text-amber-400" role="alert" data-testid="element-timing-warning">Começa em {formatSeconds((selectedElementRow.authored?.start_frame ?? 0) / TIMELINE_FPS)}, depois do fim da cena ({formatSeconds(selectedRange.durationFrames / TIMELINE_FPS)}): não aparece. O tempo salvo é mantido; aumente a cena ou ajuste o início.</p>
            : selectedElementRow.range.clipped ? <p className="text-[11px] text-amber-600 dark:text-amber-400" role="alert" data-testid="element-timing-warning">A cena ficou mais curta: o elemento é cortado no fim da cena ({formatSeconds(selectedRange.durationFrames / TIMELINE_FPS)}). O tempo salvo ({formatSeconds((selectedElementRow.authored?.duration_frames ?? 0) / TIMELINE_FPS)}) é mantido e volta se a cena crescer.</p> : null}
          <p className="text-[11px] text-muted-foreground">O tempo é da cena: ao reordenar, o elemento anda junto com ela. Motion continua sendo o movimento da cena inteira.</p>
          <div className="flex flex-wrap justify-between gap-2 border-t border-border/40 pt-2">
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelectedElementId(null)}>Voltar à cena {safeSelectedIndex + 1}</Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!selectedElementRow.authored} onClick={() => { const elementId = selectedElementRow.elementId; editSelectedScene((scene) => resetSceneElementTiming(scene, elementId)) }} data-testid="element-timing-reset">Cena inteira</Button>
          </div>
        </section>
      ) : null}
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as VideoInspectorSection)}>
        <TabsList className="flex w-full" data-inspector-tabs={VIDEO_INSPECTOR_SECTIONS.length}>
          {VIDEO_INSPECTOR_SECTIONS.map((section) => (
            <TabsTrigger key={section.value} value={section.value} className="min-w-0 flex-auto px-1 text-[11px]" title={section.label} aria-label={section.label}>
              <span className="inspector-tab-full">{section.label}</span>
              <span className="inspector-tab-compact" aria-hidden="true">{section.compactLabel}</span>
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="template" className="space-y-3 pt-3">
          <div className="space-y-1.5">
            <Label htmlFor="video-name" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Nome do vídeo</Label>
            <Input id="video-name" value={name} onChange={(event) => setName(event.target.value)} className="h-8" />
          </div>
          {selectedIsFree ? <FreeSceneTemplateState /> : <>
          <div className="space-y-1.5" data-testid="video-template">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Template</p>
            <p className="text-sm">{sceneView.template.name}</p>
            <p className="text-[11px] text-muted-foreground">Família visual do vídeo inteiro. Estrutura e aparência são escolhidas por cena.</p>
          </div>
          {selectedScene ? (
            <div className="space-y-2 rounded-md border border-border/60 p-2" data-testid="scene-structure">
              <p className="text-xs font-semibold">Cena {safeSelectedIndex + 1}</p>
              <div className="space-y-1">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Estrutura</span>
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Estrutura da cena">
                  {VIDEO_SCENE_LAYOUT_IDS.map((layoutId) => {
                    const option = sceneView.template.layouts.find((layout) => layout.id === layoutId)
                    if (!option) return null
                    const checked = sceneView.resolved.layoutId === layoutId
                    return <Button key={layoutId} size="sm" variant={checked ? 'default' : 'outline'} role="radio" aria-checked={checked} className="h-7 px-2 text-xs" onClick={() => editSelectedScene((scene) => setSceneLayout(scene, layoutId))} data-testid="scene-layout-option" data-value={layoutId}>{option.label}</Button>
                  })}
                </div>
              </div>
              <div className="space-y-1">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Aparência</span>
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Aparência da cena">
                  {sceneView.layout.supportedAppearances.map((appearance) => {
                    const checked = sceneView.appearance === appearance
                    return <Button key={appearance} size="sm" variant={checked ? 'default' : 'outline'} role="radio" aria-checked={checked} className="h-7 px-2 text-xs" onClick={() => editSelectedScene((scene) => setSceneAppearance(scene, appearance))} data-testid="scene-appearance-option" data-value={appearance}>{appearance === 'light' ? 'Light' : 'Dark'}</Button>
                  })}
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">Trocar a estrutura recomeça o conteúdo com o exemplo do Template (o título é mantido) e restaura as camadas padrão. Duração e Motion não mudam.</p>
              {sceneView.resolved.fallbacks.length > 0 ? <p className="text-[11px] text-amber-600 dark:text-amber-400" role="alert">Esta cena tem {sceneView.resolved.fallbacks.includes('layout') ? 'uma estrutura' : 'uma aparência'} salva que o vídeo não suporta; o padrão do Template está sendo usado.</p> : null}
            </div>
          ) : null}
          </>}
          <ContextMetadata dense items={[
            { label: 'Formato', value: `${canvasW}×${canvasH} · ${TIMELINE_FPS} fps` },
            { label: 'Cenas', value: String(scenes.length) },
            { label: 'Duração', value: formatSeconds(totalFrames / TIMELINE_FPS) },
          ]} />
          {selectedIsFree ? null : <>
            <TemplateFamilyAnatomy template={sceneView.template} />
            <TemplateAnatomy template={sceneView.template} layout={sceneView.layout} />
          </>}
        </TabsContent>
        <TabsContent value="content" className="space-y-3 pt-3">
          {selectedScene ? <>
            {selectedIsFree ? (
              <p className="rounded-md border border-dashed border-border/60 p-2 text-[11px] text-muted-foreground" data-testid="free-scene-content">Composição livre: os textos desta cena são elementos, editados em Elementos (sem estrutura de template).</p>
            ) : (
            /* What this Scene DRAWS: its layout's bounded content (same form + descriptors as Static). */
            <section className="space-y-2" aria-label="Conteúdo desenhado na cena" data-testid="scene-content" data-layout={sceneView.resolved.layoutId}>
              <p className="text-[11px] text-muted-foreground">Conteúdo da estrutura <span className="font-medium text-foreground">{sceneView.layout.label}</span> desta cena — exatamente o que a prévia e o render final desenham.</p>
              <LayoutContentForm
                key={`${selectedScene.id}:${sceneView.resolved.layoutId}`}
                fields={sceneContentFields(sceneView.resolved.layoutId)}
                content={sceneView.resolved.content}
                dispatch={(action) => { if (isContentAction(action)) editSelectedScene((scene) => applySceneContentAction(scene, action)) }}
              />
            </section>
            )}
            <div className="space-y-1.5 border-t border-border/40 pt-3">
              <Label htmlFor="scene-description">Roteiro da cena</Label>
              <Textarea id="scene-description" value={selectedScene.description} onChange={(event) => patchSelectedScene({ description: event.target.value })} rows={3} placeholder="O que acontece nesta cena…" data-testid="scene-description" />
              <p className="text-[11px] text-muted-foreground">Briefing de apoio. Não é desenhado no vídeo — o que aparece é o conteúdo acima.</p>
            </div>
            <div className="space-y-1.5 rounded-md border border-dashed border-border/60 p-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="scene-prompt" className="text-xs">Assistência · prompt gerado</Label>
                <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px]" disabled={!selectedScene.description.trim() || promptBusy} onClick={() => void generatePrompt()}>{promptBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}Gerar</Button>
              </div>
              <Textarea id="scene-prompt" value={selectedScene.prompt ?? ''} onChange={(event) => patchSelectedScene({ prompt: event.target.value || null })} rows={3} className="font-mono text-[11px]" placeholder="Prompt para geração de imagem/vídeo (opcional)" />
              <p className="text-[11px] text-muted-foreground">Apoio à geração de mídia. Não altera a montagem nem o render.</p>
              {promptError ? <p className="text-[11px] text-destructive" role="alert">{promptError}</p> : null}
            </div>
          </> : <p className="text-xs text-muted-foreground">Selecione uma cena.</p>}
        </TabsContent>
        <TabsContent value="assets" className="space-y-2 pt-3">
          {selectedScene ? <>
            {selectedIsFree ? (
              <div className="space-y-1.5" data-testid="free-scene-assets">
                <p className="text-[11px] text-muted-foreground">Imagens da Biblioteca usadas pelos elementos desta cena livre (sem slots de template). Troque ou ajuste cada uma em Elementos.</p>
                {freeElements(selectedScene).map((element) => element.kind === 'image' ? (
                  <div key={element.id} className="flex items-center justify-between gap-2 rounded-md border border-border/60 p-1.5" data-testid="free-scene-asset" data-element-id={element.id}>
                    <span className="min-w-0 truncate text-xs">{libraryFiles.get(element.library_file_id)?.name ?? 'Arquivo da Biblioteca'}{element.hidden ? ' · oculto' : ''}</span>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setFreeImagePicker({ mode: 'replace', elementId: element.id })}>Trocar</Button>
                  </div>
                ) : null)}
              </div>
            ) : /* Same slot card + resolver as Static: VideoScene.library_file_id is this Scene's hero override. */
            sceneView.usesHero ? <>
              <p className="text-[11px] text-muted-foreground">Recurso que preenche a imagem desta cena. Os materiais de colagem (papéis, fitas…) seguem o padrão do Template.</p>
              <div data-testid="scene-asset">
                <AssetSlotCard
                  slot={sceneView.heroSlot}
                  resource={resolveSlotResource(sceneView.heroSlot, sceneHeroSlotState(selectedScene), libraryFiles, [])}
                  usedBy={sceneView.heroUsedBy}
                  onReplace={() => setAssetPickerOpen(true)}
                  onUseDefault={() => patchSelectedScene({ library_file_id: null })}
                />
              </div>
            </> : (
              <p className="rounded-md border border-dashed border-border/60 p-2 text-[11px] text-muted-foreground" data-testid="scene-asset-unused">
                A estrutura {sceneView.layout.label} não desenha imagem de conteúdo.{selectedScene.library_file_id ? ` A imagem escolhida para esta cena continua guardada e volta a aparecer se a cena usar ${HERO_LAYOUT_LABELS}.` : ''} Os materiais de colagem seguem o padrão do Template.
              </p>
            )}
            {selectedScene.image_url ? <p className="text-[11px] text-amber-600 dark:text-amber-400">Esta cena tem uma imagem legada enviada no editor antigo; ela não é usada na prévia nem no render. Use Trocar para escolher um asset da Biblioteca.</p> : null}
          </> : null}
        </TabsContent>
        <TabsContent value="style" className="pt-3">
          <StyleSourcePanel tokens={context.identitySnapshot ?? undefined} unitLabel="cena" />
        </TabsContent>
        <TabsContent value="element" className="pt-3">
          {selectedIsFree && selectedScene ? (
            <FreeSceneElements
              scene={selectedScene}
              fileNames={libraryFileNames}
              openId={openElementId}
              onOpen={setOpenElementId}
              onEdit={editSelectedScene}
              onAddText={() => { const id = crypto.randomUUID(); editSelectedScene((scene) => addFreeTextElement(scene, id)); setOpenElementId(id) }}
              onAddImage={() => setFreeImagePicker({ mode: 'add' })}
              onReplaceImage={(elementId) => setFreeImagePicker({ mode: 'replace', elementId })}
              onTiming={(elementId) => selectSceneElement(selectedScene.id, elementId)}
            />
          ) : (
          /* Same Camadas as Static: this Scene's stack order + visibility (authored, previewed and rendered). */
          <ElementLayers
            order={sceneView.stackOrder}
            labels={sceneView.elementLabels}
            openId={openElementId}
            isDefault={sceneView.stackIsDefault}
            onToggle={(id) => setOpenElementId((current) => (current === id ? null : id))}
            onReorder={(order) => editSelectedScene((scene) => setSceneElementOrder(scene, order))}
            onRestoreDefault={() => editSelectedScene(resetSceneElementOrder)}
            renderPanel={() => <p className="text-[11px] leading-snug text-muted-foreground">Posição, escala e rotação por elemento ainda não existem em vídeo; a ordem e a visibilidade desta camada sim.</p>}
            hidden={new Set(sceneView.hiddenElements)}
            onToggleVisibility={(id) => editSelectedScene((scene) => toggleSceneElementVisibility(scene, id))}
            note={<p className="text-[11px] leading-snug text-muted-foreground" data-testid="video-elements-note">Camadas da cena {safeSelectedIndex + 1} ({sceneView.layout.label}), na ordem em que a prévia e o render final as desenham.</p>}
          />
          )}
        </TabsContent>
        <TabsContent value="motion" className="space-y-2 pt-3">
          {selectedScene && selectedIsFree ? (
            <p className="rounded-md border border-dashed border-border/60 p-2 text-[11px] text-muted-foreground" data-testid="free-scene-motion">Composição livre: o Motion desta versão é desenhado pelo Template, então esta cena fica estática. Movimento por elemento não existe.</p>
          ) : selectedScene ? <>
            <p className="text-[11px] text-muted-foreground">Movimento semântico da cena inteira, desenhado pelo Template (sem keyframes, sem movimento por elemento). O efeito depende da estrutura da cena ({sceneView.layout.label}).</p>
            <div className="grid gap-1" role="radiogroup" aria-label="Movimento da cena">
              {sceneMotionOptions.map((option) => {
                const checked = (selectedScene.movement || 'static') === option.value
                return (
                  <button key={option.value} type="button" role="radio" aria-checked={checked} onClick={() => patchSelectedScene({ movement: option.value })}
                    className={cn('flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left text-xs', checked ? 'border-primary bg-primary/10' : 'border-border/60 hover:border-border')}
                    data-testid="motion-option" data-value={option.value}>
                    <span>{option.label}</span>
                    <span className={cn('shrink-0 text-[10px]', option.supported && option.effect !== 'not-drawn' ? 'text-muted-foreground' : 'text-amber-600 dark:text-amber-400')} data-testid="motion-effect" data-effect={option.effect}>{option.supported ? MOTION_EFFECT_LABELS[option.effect] : 'sem preset · estático'}</span>
                  </button>
                )
              })}
            </div>
          </> : null}
        </TabsContent>
      </Tabs>
    </div>
  )

  // Gate B: selecting an independent item switches the Inspector CONTEXT (no Scene tabs mixed in).
  const itemLane = selectedItem ? { visual: 'B-roll', text: 'Texto', audio: 'Áudio' }[selectedItem.kind] : ''
  const itemInspector = selectedItem ? (
    <section className="space-y-3" aria-label={`Item independente: ${itemLane}`} data-testid="item-inspector" data-kind={selectedItem.kind}>
      <div className="space-y-1 rounded-md border border-border/60 bg-muted/30 p-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold">{itemLane} <span className="font-normal text-muted-foreground">· item independente</span></p>
          <p className="text-[11px] tabular-nums text-muted-foreground">{formatTimecode(selectedItem.start_frame)} → {formatTimecode(itemEndFrame(selectedItem, totalFrames))}</p>
        </div>
        <p className="text-[11px] text-muted-foreground">{followsSequenceEnd(selectedItem)
          ? 'Início próprio na timeline do vídeo (não acompanha a reordenação de cenas); termina junto com o fim da sequência de cenas.'
          : 'Tempo próprio na timeline do vídeo: não acompanha as cenas ao reordenar nem ao mudar a duração delas.'}</p>
        {!followsSequenceEnd(selectedItem) && itemEndFrame(selectedItem, totalFrames) > totalFrames ? <p className="text-[11px] text-amber-600 dark:text-amber-400" role="alert">Passa do fim do vídeo ({formatSeconds(totalFrames / TIMELINE_FPS)}); a parte excedente não entra na prévia nem no render.</p> : null}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="item-start" className="text-[11px]">Início (s)</Label>
          <Input key={`${selectedItem.id}:s:${selectedItem.start_frame}`} id="item-start" type="number" min={0} step={0.1} defaultValue={Number((selectedItem.start_frame / TIMELINE_FPS).toFixed(2))} className="h-8"
            onBlur={(event) => { const value = Number(event.target.value); if (Number.isFinite(value)) setTimeline((current) => moveTemporalItem(current, selectedItem.id, Math.round(value * TIMELINE_FPS))) }}
            onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur() }} data-testid="item-start-input" />
        </div>
        {followsSequenceEnd(selectedItem) ? (
          <div className="space-y-1">
            <span className="text-[11px] font-medium">Duração</span>
            <p className="flex h-8 items-center text-xs text-muted-foreground" data-testid="item-duration-follow">Até o fim do vídeo · {formatSeconds(effectiveDurationFrames(selectedItem, totalFrames) / TIMELINE_FPS)}</p>
          </div>
        ) : (
          <div className="space-y-1">
            <Label htmlFor="item-duration" className="text-[11px]">Duração (s)</Label>
            <Input key={`${selectedItem.id}:d:${selectedItem.duration_frames}`} id="item-duration" type="number" min={0.5} step={0.1} defaultValue={Number(((selectedItem.duration_frames ?? 0) / TIMELINE_FPS).toFixed(2))} className="h-8"
              onBlur={(event) => { const value = Number(event.target.value); if (Number.isFinite(value)) setTimeline((current) => resizeTemporalItem(current, selectedItem.id, Math.round(value * TIMELINE_FPS))) }}
              onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur() }} data-testid="item-duration-input" />
          </div>
        )}
      </div>
      {selectedItem.kind === 'text' ? (
        <div className="space-y-1">
          <Label htmlFor="item-text" className="text-[11px]">Texto (Enter = linha de apoio)</Label>
          <Textarea id="item-text" value={selectedItem.text} maxLength={MAX_TEXT_LENGTH} rows={3}
            onChange={(event) => setTimeline((current) => updateTemporalItem<'text'>(current, selectedItem.id, { text: event.target.value }))} data-testid="item-text" />
          <p className="text-[11px] text-muted-foreground">Apresentação única de lower third (faixa inferior sobre todas as camadas).</p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 p-2">
            <span className="min-w-0 truncate text-xs" title={temporalItemLabel(selectedItem)} data-testid="item-file">{temporalItemLabel(selectedItem)}</span>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setTimelinePicker({ mode: 'replace', kind: selectedItem.kind === 'audio' ? 'audio' : 'visual' })}>Trocar</Button>
          </div>
          {selectedItem.kind === 'visual' ? (
            <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Enquadramento do B-roll">
              <span className="text-[11px] text-muted-foreground">Enquadramento</span>
              {(['cover', 'contain'] as const).map((fit) => {
                const checked = (selectedItem.fit ?? 'cover') === fit
                return <Button key={fit} size="sm" variant={checked ? 'default' : 'outline'} role="radio" aria-checked={checked} className="h-7 px-2 text-xs" onClick={() => setTimeline((current) => updateTemporalItem<'visual'>(current, selectedItem.id, { fit }))}>{fit === 'cover' ? 'Preencher' : 'Conter'}</Button>
              })}
              <p className="w-full text-[11px] text-muted-foreground">Cobre a cena principal durante o intervalo. Vídeo começa do início do arquivo e fica sem som (o som vem da faixa de Áudio).</p>
            </div>
          ) : selectedItem.kind === 'audio' ? (
            <div className="space-y-3" data-testid="audio-controls">
              <div className="space-y-1">
                <Label htmlFor="item-volume" className="text-[11px]">Volume · {Math.round(selectedItem.volume * 100)}%</Label>
                <input id="item-volume" type="range" min={0} max={100} step={5} value={Math.round(selectedItem.volume * 100)} className="w-full"
                  onChange={(event) => setTimeline((current) => updateTemporalItem<'audio'>(current, selectedItem.id, { volume: Number(event.target.value) / 100 }))} data-testid="item-volume" />
              </div>
              <div className="space-y-1">
                <span className="text-[11px] font-medium">Fim</span>
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Fim do áudio">
                  {([['fixed', 'Duração fixa'], ['sequence', 'Até o fim do vídeo']] as const).map(([mode, label]) => {
                    const checked = (mode === 'sequence') === followsSequenceEnd(selectedItem)
                    return <Button key={mode} size="sm" variant={checked ? 'default' : 'outline'} role="radio" aria-checked={checked} className="h-7 px-2 text-xs" onClick={() => setTimeline((current) => setAudioEndsWithSequence(current, selectedItem.id, mode === 'sequence', totalFrames))} data-testid="audio-end-mode" data-value={mode}>{label}</Button>
                  })}
                </div>
                <p className="text-[11px] text-muted-foreground">{followsSequenceEnd(selectedItem) ? 'Acompanha o fim da sequência de cenas: se as cenas mudarem de duração, o áudio termina junto. Não repete o arquivo.' : 'Termina após a duração definida, mesmo que as cenas mudem.'}</p>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {([['source_in_frame', 'Início no arquivo (s)', 'item-source-in'], ['fade_in_frames', 'Fade in (s)', 'item-fade-in'], ['fade_out_frames', 'Fade out (s)', 'item-fade-out']] as const).map(([field, label, id]) => (
                  <div key={field} className="space-y-1">
                    <Label htmlFor={id} className="text-[11px] leading-tight">{label}</Label>
                    <Input key={`${selectedItem.id}:${field}:${selectedItem[field] ?? 0}`} id={id} type="number" min={0} step={0.1} defaultValue={Number(((selectedItem[field] ?? 0) / TIMELINE_FPS).toFixed(2))} className="h-8"
                      onBlur={(event) => { const value = Number(event.target.value); if (Number.isFinite(value)) setTimeline((current) => setAudioTiming(current, selectedItem.id, { [field]: Math.round(value * TIMELINE_FPS) })) }}
                      onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur() }} data-testid={`${id}-input`} />
                  </div>
                ))}
              </div>
              <AudioSourceHint url={libraryFiles.get(selectedItem.library_file_id)?.public_url ?? null} neededSeconds={((selectedItem.source_in_frame ?? 0) + effectiveDurationFrames(selectedItem, totalFrames)) / TIMELINE_FPS} />
              <p className="text-[11px] text-muted-foreground">Vários áudios podem se sobrepor: eles são mixados. As linhas Áudio 1, 2… da Timeline só organizam a visualização.</p>
            </div>
          ) : null}
        </div>
      )}
      <div className="flex flex-wrap justify-between gap-2 border-t border-border/40 pt-2">
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelectedItemId(null)}>Voltar à cena {safeSelectedIndex + 1}</Button>
        <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs text-destructive hover:text-destructive" onClick={() => { setTimeline((current) => removeTemporalItem(current, selectedItem.id)); setSelectedItemId(null) }} data-testid="item-remove"><Trash2 className="h-3.5 w-3.5" />Remover do vídeo</Button>
      </div>
    </section>
  ) : null

  const freeImagePickerTarget = freeImagePicker?.mode === 'replace' && selectedScene ? freeElements(selectedScene).find((element) => element.id === freeImagePicker.elementId) : undefined
  const freeImagePickerSelectedId = freeImagePickerTarget?.kind === 'image' ? freeImagePickerTarget.library_file_id : null
  const saveStatusLabel =saveStatus === 'saving' ? 'Salvando…' : saveStatus === 'error' ? 'Falha ao salvar' : dirty ? 'Alterações não salvas' : 'Salvo'
  const contextItems = [
    { label: 'Project', value: context.project?.name ?? 'Sem Project' },
    { label: 'Production', value: context.productionTitle ?? 'Sem Production' },
    { label: 'VideoDraft', value: name || draft.name, fullWidth: true },
  ]

  const header = (
    <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 pb-2" data-testid="editor-header">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Button variant="ghost" size="icon-sm" className="-ml-2 shrink-0" onClick={() => router.push('/videos')} aria-label="Voltar para Vídeos" title="Voltar para Vídeos"><ArrowLeft className="h-4 w-4" /></Button>
        <h1 className="shrink-0 text-base font-semibold">Creative Editor</h1>
        <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className="shrink-0">Video</span>
          <span aria-hidden="true">·</span>
          <VideoCanvasControl canvas={stage} authored={videoCanvas !== null} onChange={changeVideoCanvas} supportFor={canvasSupportFor} />
          {selectedScene ? <><span aria-hidden="true">·</span><span className="shrink-0 font-medium text-foreground" data-testid="header-scene-indicator">Cena {safeSelectedIndex + 1}</span></> : null}
        </p>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="h-7 shrink-0 gap-1 px-2 text-xs text-muted-foreground">Contexto<ChevronDown className="h-3 w-3" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-80 max-w-[calc(100vw-2rem)] p-3"><ContextMetadata items={contextItems} dense /></DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
        {renderActive ? <span className="flex items-center gap-1 text-xs text-muted-foreground" data-testid="render-status" data-phase={executionStatus ?? 'submitting'}><Loader2 className="h-3.5 w-3.5 animate-spin" />{executionStatus === 'claimed' ? 'Renderizando no servidor…' : 'Na fila…'}</span> : null}
        {executionStatus === 'failed' && !renderActive ? <span className="flex max-w-[16rem] items-center gap-1 text-xs text-destructive" role="alert" title={renderExecution?.error_message ?? undefined} data-testid="render-status" data-phase="failed"><AlertCircle className="h-3.5 w-3.5 shrink-0" /><span className="truncate">Render falhou{renderExecution?.error_message ? ` · ${renderExecution.error_message}` : ''}</span></span> : null}
        {executionStatus === 'completed' && !renderActive ? <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={openOutput} data-testid="render-status" data-phase="completed"><Film className="h-3.5 w-3.5" />Ver vídeo renderizado</Button> : null}
        {renderError ? <span className="max-w-[14rem] truncate text-xs text-destructive" role="alert" title={renderError}>{renderError}</span> : null}
        <span className="text-xs text-muted-foreground" data-testid="save-status" title={saveError ?? undefined}>{saveStatusLabel}</span>
        <Button size="sm" variant="outline" className="gap-1.5" disabled={!dirty && saveStatus !== 'error'} onClick={() => void saveNow()} title="Salvar o VideoDraft (não renderiza)." data-testid="save-button">{saveStatus === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}Salvar</Button>
        <Button size="sm" className="gap-1.5" onClick={() => void renderVideo()} disabled={!canRender || renderActive || saveStatus === 'saving'} title={dirty ? 'O render usa o VideoDraft salvo: salva as alterações e então renderiza o MP4 no servidor.' : 'Renderizar o MP4 final no servidor a partir do VideoDraft salvo.'} data-testid="render-button">
          {renderActive ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}{dirty ? 'Salvar e renderizar' : 'Renderizar vídeo'}
        </Button>
      </div>
    </header>
  )

  const dialogs = <>
    {/* VIDEO_FREE_SCENE_COMPOSITION_V1: a new Scene is always an explicit choice (never a silent Template). */}
    <Dialog open={newSceneOpen} onOpenChange={setNewSceneOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nova cena</DialogTitle>
          <DialogDescription>Começar com uma cena em branco ou com uma estrutura do template. As outras cenas não mudam.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2" data-testid="new-scene-options">
          <button type="button" className="rounded-md border border-border/70 p-3 text-left hover:border-primary" onClick={() => createScene('free')} data-testid="new-scene-free">
            <span className="block text-sm font-medium">Em branco</span>
            <span className="block text-xs text-muted-foreground">Composição livre: você posiciona textos e imagens. Sem template.</span>
          </button>
          <button type="button" className="rounded-md border border-border/70 p-3 text-left hover:border-primary" onClick={() => createScene('template')} data-testid="new-scene-template">
            <span className="block text-sm font-medium">{sceneView.template.name}</span>
            <span className="block text-xs text-muted-foreground">Template do vídeo: começa com a estrutura Cover e seus exemplos.</span>
          </button>
        </div>
      </DialogContent>
    </Dialog>
    <ProjectLibraryAssetPicker
      open={freeImagePicker !== null}
      onOpenChange={(open) => { if (!open) setFreeImagePicker(null) }}
      projectId={draft.project_id}
      selectedId={freeImagePickerSelectedId}
      allowedKinds={['image']}
      title="Imagem da composição livre"
      description="Escolha uma imagem do Projeto. Ela é referenciada (não copiada) e posicionada dentro do formato do vídeo."
      onSelect={(file) => {
        setLibraryFiles((current) => new Map(current).set(file.id, file))
        const picker = freeImagePicker
        if (picker?.mode === 'replace') editSelectedScene((scene) => updateFreeElement(scene, picker.elementId, { library_file_id: file.id }))
        else { const id = crypto.randomUUID(); editSelectedScene((scene) => addFreeImageElement(scene, id, file.id)); setOpenElementId(id) }
        setFreeImagePicker(null)
      }}
    />
    <AlertDialog open={removeDialogOpen} onOpenChange={setRemoveDialogOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remover cena {safeSelectedIndex + 1}?</AlertDialogTitle>
          <AlertDialogDescription>A cena sai da sequência de autoria (clique em Salvar para persistir). Vídeos já renderizados não são alterados.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={removeSelectedScene}>Remover cena</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <ProjectLibraryAssetPicker
      open={assetPickerOpen}
      onOpenChange={setAssetPickerOpen}
      projectId={draft.project_id}
      selectedId={selectedScene?.library_file_id ?? null}
      allowedKinds={['image']}
      title={`Imagem da cena ${safeSelectedIndex + 1}`}
      description="Escolha uma imagem do Projeto para esta cena. O arquivo é referenciado, não copiado."
      onSelect={(file) => {
        setLibraryFiles((current) => new Map(current).set(file.id, file))
        patchSelectedScene({ library_file_id: file.id })
      }}
    />
    {/* Gate B: media for the independent layer (B-roll = image/video, Áudio = audio), referenced by LibraryFile id. */}
    <ProjectLibraryAssetPicker
      open={timelinePicker !== null}
      onOpenChange={(open) => { if (!open) setTimelinePicker(null) }}
      projectId={draft.project_id}
      selectedId={timelinePicker?.mode === 'replace' && selectedItem && selectedItem.kind !== 'text' ? selectedItem.library_file_id : null}
      allowedKinds={timelinePicker?.kind === 'audio' ? ['audio'] : ['image', 'video']}
      allowedMimeTypes={timelinePicker?.kind === 'audio' ? RENDERABLE_AUDIO_MIME : ['image/png', 'image/jpeg', 'image/webp', 'image/gif', ...RENDERABLE_VIDEO_MIME]}
      title={timelinePicker?.kind === 'audio' ? 'Áudio do vídeo' : 'B-roll'}
      description={timelinePicker?.kind === 'audio' ? 'Escolha um arquivo de áudio do Projeto. Ele toca pela timeline, independente das cenas.' : 'Escolha uma imagem ou um vídeo do Projeto para cobrir a cena durante um intervalo próprio.'}
      onSelect={(file) => {
        setLibraryFiles((current) => new Map(current).set(file.id, file))
        if (timelinePicker?.mode === 'replace' && selectedItem && selectedItem.kind !== 'text') setTimeline((current) => updateTemporalItem<'visual'>(current, selectedItem.id, { library_file_id: file.id }))
        else if (timelinePicker) addMediaItem(timelinePicker.kind, file)
        setTimelinePicker(null)
      }}
    />
    {/* OUTPUT PLAYER — the completed MP4 from render_executions. Distinct from the Live Authoring Player. */}
    <Dialog open={outputOpen} onOpenChange={setOutputOpen}>
      <DialogContent className="max-w-[min(92vw,520px)]">
        <DialogHeader>
          <DialogTitle>Vídeo renderizado</DialogTitle>
          <DialogDescription>MP4 final do último render concluído no servidor. Não reflete alterações feitas depois dele.</DialogDescription>
        </DialogHeader>
        {/* Sized from the MP4 this execution produced (Render != Save: the draft's stage may have changed since). */}
        <div className="relative mx-auto max-h-[65vh] w-full overflow-hidden rounded-md bg-black" style={{ aspectRatio: renderExecution?.output_width && renderExecution.output_height ? `${renderExecution.output_width} / ${renderExecution.output_height}` : '9 / 16' }} data-testid="output-player-frame">
          {outputUrl
            ? <video src={outputUrl} controls playsInline crossOrigin="anonymous" className="h-full w-full object-contain" data-testid="output-player" />
            : outputUrlError
              ? <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-white/80">{outputUrlError}</p>
              : <div className="absolute inset-0 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-white/70" /></div>}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void downloadOutput()}><Download className="h-3.5 w-3.5" />Baixar</Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => router.push('/galeria')}><ExternalLink className="h-3.5 w-3.5" />Abrir na Galeria</Button>
        </div>
      </DialogContent>
    </Dialog>
  </>

  if (!floating) {
    return (
      <DashboardPage>
        <div className="min-w-0 space-y-3 px-4 py-3">
          {header}
          <StackedWorkbench canvas={canvas} inspector={itemInspector ?? inspector} />
          {dialogs}
        </div>
      </DashboardPage>
    )
  }

  return (
    <DashboardPage>
      <div className="flex h-[calc(100dvh-var(--studio-shell-top-bar-height))] min-h-0 min-w-0 flex-col px-[var(--studio-shell-page-padding)] pb-3 pt-2">
        {header}
        <CreativeWorkbench className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border/50 bg-background" canvas={canvas} inspector={itemInspector ?? inspector} inspectorOpen={inspectorOpen} onInspectorOpenChange={setInspectorOpen} />
        {dialogs}
      </div>
    </DashboardPage>
  )
}

/** Timecode + frame + Scene under the playhead: subscribes to the cursor, so only this re-renders per frame. */
function TransportReadout({ cursor, totalFrames, ranges }: { cursor: FrameCursor; totalFrames: number; ranges: ReturnType<typeof deriveSceneRanges> }) {
  const frame = clampFrame(useFrameCursor(cursor), totalFrames)
  return <>
    <span className="ml-2 whitespace-nowrap text-xs tabular-nums text-foreground" data-testid="player-timecode" data-frame={frame}>{formatTimecode(frame)} <span className="text-muted-foreground">/ {formatTimecode(totalFrames)}</span></span>
    <span className="ml-2 hidden whitespace-nowrap text-[11px] tabular-nums text-muted-foreground sm:inline">f {frame} · Cena {sceneIndexAtFrame(ranges, frame) + 1}</span>
  </>
}

/**
 * AUDIO V1: a truthful, NON-authoritative hint about the source file length,
 * read from the browser's media metadata (never persisted). Warns when the
 * placement (source start + effective duration) asks for more than the file
 * has: the engine plays silence after the source ends — it never loops or stretches.
 */
function AudioSourceHint({ url, neededSeconds }: { url: string | null; neededSeconds: number }) {
  const [fileSeconds, setFileSeconds] = useState<{ url: string; seconds: number } | null>(null)
  useEffect(() => {
    if (!url) return
    const audio = new Audio()
    audio.preload = 'metadata'
    const onLoaded = () => { if (Number.isFinite(audio.duration)) setFileSeconds({ url, seconds: audio.duration }) }
    audio.addEventListener('loadedmetadata', onLoaded)
    audio.src = url
    return () => { audio.removeEventListener('loadedmetadata', onLoaded); audio.src = '' }
  }, [url])
  const seconds = fileSeconds && fileSeconds.url === url ? fileSeconds.seconds : null
  if (seconds === null) return null
  const short = neededSeconds > seconds + 0.05
  return (
    <p className={cn('text-[11px]', short ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')} role={short ? 'alert' : undefined} data-testid="audio-source-hint">
      Arquivo: {formatSeconds(seconds)}.{short ? ` A colocação pede ${formatSeconds(neededSeconds)} a partir do início escolhido: depois do fim do arquivo fica silêncio (não repete).` : ''}
    </p>
  )
}
