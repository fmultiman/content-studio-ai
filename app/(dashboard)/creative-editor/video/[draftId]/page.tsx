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
 * `/api/video-drafts` PATCH the /videos workspace uses. `currentFrame` is the
 * editor's single temporal cursor (UI state, never persisted); the Player is
 * its clock and the Timeline playhead follows/seeks it. Final render is the
 * unchanged server-authoritative path (`POST /api/video-drafts/:id/render`).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import {
  AlertCircle, ArrowLeft, ArrowRight, Check, ChevronDown, Download, ExternalLink, Film, ImageIcon, Loader2, Pause, PanelRight,
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
import { StyleSourcePanel } from '@/components/creative/authoring/inspector-panels'
import { ProjectLibraryAssetPicker } from '@/components/library/project-library-asset-picker'
import { SceneStrip } from '@/components/creative/video/scene-strip'
import { SceneTimeline } from '@/components/creative/video/scene-timeline'
import { createClient } from '@/lib/supabase/client'
import { normalizeProjectIdentity } from '@/lib/project-identity-normalizer'
import { adaptProjectIdentityToVisualTokens } from '@/lib/creative/integration/project-identity-adapter'
import { calculatePreviewFitScale } from '@/lib/creative/authoring/viewport'
import { cn } from '@/lib/utils'
import { DEFAULT_HERO_ASSET_REF, DEFAULT_TIMELINE_CANVAS } from '@/lib/creative/timeline-adapter/video-draft-to-timeline'
import { resolveAsset } from '@/lib/creative/assets/resolve-asset'
import {
  TIMELINE_FPS, clampFrame, clampSceneDurationSeconds, deriveSceneRanges, formatSeconds, formatTimecode, reorderScenes,
  sceneIndexAtFrame, setSceneDuration, MIN_SCENE_DURATION_SECONDS, MAX_SCENE_DURATION_SECONDS,
} from '@/lib/creative/video-editor/scene-timeline'
import {
  MAX_VIDEO_SCENES, PRESET_LABELS, addVideoScene, buildVideoDraftSaveBody, motionOptions, normalizeLoadedScenes,
  persistedVideoSnapshot, removeVideoScene, updateVideoScene,
} from '@/lib/creative/video-editor/video-authoring'
import { buildLivePreviewInput, type PreviewLibraryFile } from '@/lib/creative/video-editor/live-preview-input'
import { createFrameCursor, useFrameCursor, type FrameCursor } from '@/lib/creative/video-editor/frame-cursor'
import { VIDEO_INSPECTOR_SECTIONS, type VideoInspectorSection } from '@/lib/creative/video-editor/video-workspace'
import type { VisualTokensSnapshot } from '@/lib/schemas/creative/primitives'
import type { LibraryFile, Project, RenderExecutionSummary, VideoDraft, VideoScene } from '@/lib/types'
import type { LivePlayerController } from '@/remotion/player/LiveTimelinePlayer'

// The Remotion Player adapter is browser-only; it never runs on the server.
const LiveTimelinePlayer = dynamic(() => import('@/remotion/player/LiveTimelinePlayer').then((mod) => mod.LiveTimelinePlayer), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>,
})

const AUTOSAVE_PREF_KEY = 'creative-editor-video:autosave-enabled'
const RENDER_POLL_INTERVAL_MS = 3000
const PREVIEW_ZOOM_LEVELS = [0.25, 0.33, 0.5] as const
const TEMPLATE_HERO_URL = (() => { const resolved = resolveAsset(DEFAULT_HERO_ASSET_REF); return resolved.valid ? resolved.value.url : undefined })()
const MOTION_OPTIONS = motionOptions()

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
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [autosaveEnabled, setAutosaveEnabledState] = useState(() => readAutosavePreference())
  const skipNextAutosaveRef = useRef(true)
  // EDITOR / VIEW state: never persisted.
  const [libraryFiles, setLibraryFiles] = useState<ReadonlyMap<string, PreviewLibraryFile>>(new Map())
  const [selectedIndex, setSelectedIndex] = useState(0)
  // The single temporal cursor (currentFrame): editor state outside React render — see frame-cursor.ts.
  const [cursor] = useState(() => createFrameCursor())
  const [playing, setPlaying] = useState(false)
  const [lowerMode, setLowerMode] = useState<'scenes' | 'timeline'>('scenes')
  const [activeTab, setActiveTab] = useState<VideoInspectorSection>('content')
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [previewZoom, setPreviewZoom] = useState<'fit' | number>('fit')
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 })
  const [previewContainer, setPreviewContainer] = useState<HTMLDivElement | null>(null)
  const [playerError, setPlayerError] = useState<string | null>(null)
  const [assetPickerOpen, setAssetPickerOpen] = useState(false)
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
  const dirty = lastSavedSnapshot !== null && persistedVideoSnapshot(name, scenes) !== lastSavedSnapshot

  // --- Load: VideoDraft (authority), Project identity, Project images, latest execution ---
  useEffect(() => {
    let cancelled = false
    async function load() {
      const response = await fetch(`/api/video-drafts?id=${encodeURIComponent(params.draftId)}`)
      const payload = await response.json().catch(() => null) as { draft?: VideoDraft; error?: string } | null
      if (!response.ok || !payload?.draft) throw new Error(payload?.error || 'Rascunho de vídeo não encontrado.')
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
      setName(loaded.name)
      setScenes(normalized)
      setLastSavedSnapshot(persistedVideoSnapshot(loaded.name, normalized))

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
        const response = await fetch(`/api/library-files?projectId=${encodeURIComponent(projectId)}&kind=image`)
        if (!response.ok) return
        const payload = await response.json() as { files?: LibraryFile[] }
        if (!cancelled) setLibraryFiles(new Map((payload.files ?? []).map((file) => [file.id, file])))
      } catch {
        // best-effort: the Player shows the Template's default image until assets load
      }
    })()
    return () => { cancelled = true }
  }, [projectId])

  // Preview Surface size (callback-ref: the Player mounts inside a Dockview portal).
  useEffect(() => {
    const el = previewContainer
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect) setPreviewSize({ width: rect.width, height: rect.height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [previewContainer])

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
    return buildLivePreviewInput({ draft: { id: draftId, project_id: projectId, production_id: draftProductionId }, scenes, identitySnapshot, libraryFiles })
  }, [draftId, projectId, draftProductionId, identitySnapshot, scenes, libraryFiles])

  const thumbnails = useMemo(() => Object.fromEntries(scenes.map((scene) => {
    const file = scene.library_file_id ? libraryFiles.get(scene.library_file_id) : undefined
    return [scene.id, file ? (file.thumbnail_url || file.public_url) : scene.library_file_id ? undefined : TEMPLATE_HERO_URL]
  })), [scenes, libraryFiles])

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
    if (seekToStart && ranges[index]) seek(ranges[index].startFrame)
  }
  function selectSceneById(sceneId: string) {
    const index = scenes.findIndex((scene) => scene.id === sceneId)
    if (index >= 0) setSelectedIndex(index)
  }
  function patchSelectedScene(patch: Partial<Omit<VideoScene, 'id' | 'order'>>) {
    if (!selectedScene) return
    setScenes((current) => updateVideoScene(current, selectedScene.id, patch))
  }
  function addScene() {
    if (scenes.length >= MAX_VIDEO_SCENES) return
    const result = addVideoScene(scenes, safeSelectedIndex >= 0 ? safeSelectedIndex : undefined)
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

  // --- Save (explicit authority) + optional autosave, same PATCH as /videos ---
  const saveNow = useCallback(async (): Promise<boolean> => {
    if (!draft) return false
    setSaveStatus('saving')
    setSaveError(null)
    const snapshot = persistedVideoSnapshot(name, scenes)
    try {
      const response = await fetch('/api/video-drafts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildVideoDraftSaveBody(draft, name, scenes)),
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
  }, [draft, name, scenes])

  useEffect(() => {
    if (!draft) return
    if (skipNextAutosaveRef.current) { skipNextAutosaveRef.current = false; return }
    if (!autosaveEnabled || !dirty) return
    const timeout = window.setTimeout(() => { void saveNow() }, 800)
    return () => window.clearTimeout(timeout)
  }, [draft, name, scenes, autosaveEnabled, dirty, saveNow])

  function revert() {
    if (!lastSavedSnapshot) return
    const saved = JSON.parse(lastSavedSnapshot) as { name: string; scenes: VideoScene[] }
    setName(saved.name)
    setScenes(saved.scenes)
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
  const canvasW = livePreview?.ok ? livePreview.resolvedInput.manifest.specification.width : DEFAULT_TIMELINE_CANVAS.width
  const canvasH = livePreview?.ok ? livePreview.resolvedInput.manifest.specification.height : DEFAULT_TIMELINE_CANVAS.height
  const measuredFit = calculatePreviewFitScale(previewSize.width - 24, previewSize.height - 24, canvasW, canvasH)
  const fitScale = measuredFit > 0 ? measuredFit : 0.25
  const scale = previewZoom === 'fit' ? fitScale : previewZoom
  const playerWidth = Math.floor(canvasW * scale)
  const playerHeight = Math.floor(canvasH * scale)
  const previewBlocker = context.identityError
    ?? (!livePreview ? null : !livePreview.ok ? livePreview.message : null)
  const renderActive = renderSubmitting || executionStatus === 'queued' || executionStatus === 'claimed'
  const canRender = Boolean(draft.project_id && draft.production_id && scenes.length > 0 && !context.identityError)

  const transport = (
    <div className="flex shrink-0 flex-nowrap items-center justify-between gap-2 overflow-x-auto border-t border-border/40 px-3 py-1.5" data-testid="player-transport">
      <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Reprodução">
        <Button size="icon-sm" variant="ghost" onClick={() => seek(0)} aria-label="Ir para o início" title="Início (Home)"><SkipBack className="h-3.5 w-3.5" /></Button>
        <Button size="icon-sm" variant="ghost" onClick={() => seek(cursor.get() - 1)} aria-label="Frame anterior" title="Frame anterior (←, Shift = 1s)"><StepBack className="h-3.5 w-3.5" /></Button>
        <Button size="icon-sm" variant="default" onClick={togglePlay} disabled={!livePreview?.ok} aria-label={playing ? 'Pausar' : 'Reproduzir'} title="Reproduzir / pausar (Espaço)" data-testid="player-play-toggle" data-playing={playing}>{playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}</Button>
        <Button size="icon-sm" variant="ghost" onClick={() => seek(cursor.get() + 1)} aria-label="Próximo frame" title="Próximo frame (→, Shift = 1s)"><StepForward className="h-3.5 w-3.5" /></Button>
        <Button size="icon-sm" variant="ghost" onClick={() => seek(totalFrames - 1)} aria-label="Ir para o fim" title="Fim (End)"><SkipForward className="h-3.5 w-3.5" /></Button>
        <TransportReadout cursor={cursor} totalFrames={totalFrames} ranges={ranges} />
      </div>
      <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Zoom da prévia">
        <select aria-label="Zoom da prévia" className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={previewZoom === 'fit' ? 'fit' : String(previewZoom)} onChange={(event) => setPreviewZoom(event.target.value === 'fit' ? 'fit' : Number(event.target.value))}>
          <option value="fit">Fit · {Math.round(fitScale * 100)}%</option>
          {PREVIEW_ZOOM_LEVELS.map((level) => <option key={level} value={level}>{Math.round(level * 100)}%</option>)}
        </select>
        {floating && !inspectorOpen ? <Button size="icon-sm" variant="outline" onClick={() => setInspectorOpen(true)} aria-label="Abrir Inspector" title="Abrir Inspector" data-testid="inspector-launcher"><PanelRight className="h-3.5 w-3.5" /></Button> : null}
      </div>
    </div>
  )

  const canvas = (
    <div className={floating ? 'flex h-full min-h-0 flex-col' : 'flex flex-col'}>
      <div ref={setPreviewContainer} className={floating ? 'relative min-h-0 flex-1 overflow-auto' : 'relative h-[min(62vh,560px)] overflow-auto'} data-testid="live-player-viewport">
        <div className="flex min-h-full min-w-full items-center justify-center p-3">
          {previewBlocker ? (
            <div className="flex max-w-sm flex-col items-center gap-2 text-center text-sm text-muted-foreground" role="alert"><AlertCircle className="h-5 w-5" />{previewBlocker}</div>
          ) : livePreview?.ok ? (
            <div className="relative overflow-hidden rounded-sm shadow-lg" style={{ width: playerWidth, height: playerHeight }} data-testid="live-player" data-live-duration-frames={livePreview.resolvedInput.manifest.specification.duration_frames}>
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
          ) : <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
        </div>
        {playerError ? <p className="absolute bottom-2 left-2 right-2 rounded bg-destructive/90 px-2 py-1 text-xs text-destructive-foreground" role="alert">Prévia: {playerError}</p> : null}
        {livePreview?.ok && livePreview.missingAssets.length > 0 ? <p className="absolute left-2 top-2 rounded bg-black/70 px-2 py-1 text-[11px] text-white">Carregando {livePreview.missingAssets.length} asset(s) da Biblioteca…</p> : null}
        <span className="pointer-events-none absolute right-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white/80">Prévia ao vivo</span>
      </div>
      {transport}
    </div>
  )

  const selectedFile = selectedScene?.library_file_id ? libraryFiles.get(selectedScene.library_file_id) : undefined

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
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as VideoInspectorSection)}>
        <TabsList className="flex w-full">
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
          <div className="space-y-1 text-xs">
            <p className="font-medium uppercase tracking-wide text-muted-foreground">Template</p>
            <p className="text-foreground">Documentary Card · Capa</p>
            <p className="text-muted-foreground">Fixo nesta versão: cada cena usa a mesma estrutura do render final (título “Cena N”, imagem da cena, Identidade do Projeto).</p>
          </div>
          <ContextMetadata dense items={[
            { label: 'Formato', value: `${canvasW}×${canvasH} · ${TIMELINE_FPS} fps` },
            { label: 'Cenas', value: String(scenes.length) },
            { label: 'Duração', value: formatSeconds(totalFrames / TIMELINE_FPS) },
          ]} />
        </TabsContent>
        <TabsContent value="content" className="space-y-3 pt-3">
          {selectedScene ? <>
            <div className="space-y-1.5">
              <Label htmlFor="scene-description">Descrição da cena</Label>
              <Textarea id="scene-description" value={selectedScene.description} onChange={(event) => patchSelectedScene({ description: event.target.value })} rows={4} placeholder="O que acontece nesta cena…" data-testid="scene-description" />
              <p className="text-[11px] text-muted-foreground">Roteiro/briefing da cena. Nesta versão não é desenhado no vídeo (o Template mostra “Cena N”).</p>
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
        <TabsContent value="assets" className="space-y-3 pt-3">
          {selectedScene ? <>
            <p className="text-[11px] text-muted-foreground">Imagem principal da cena (papel “hero” do Template).</p>
            <div className="flex items-center gap-3 rounded-md border border-border/60 p-2" data-testid="scene-asset">
              <div className="relative h-16 w-12 shrink-0 overflow-hidden rounded bg-muted">
                {thumbnails[selectedScene.id]
                  // eslint-disable-next-line @next/next/no-img-element -- short-lived signed display URL
                  ? <img src={thumbnails[selectedScene.id]} alt="" className="h-full w-full object-cover" />
                  : <ImageIcon className="m-3 h-5 w-5 text-muted-foreground" />}
              </div>
              <div className="min-w-0 text-xs">
                <p className="truncate font-medium">{selectedFile ? selectedFile.name : selectedScene.library_file_id ? 'Asset da Biblioteca (carregando…)' : 'Padrão do Template'}</p>
                <p className="text-muted-foreground">{selectedScene.library_file_id ? 'Biblioteca do Projeto' : 'Imagem de exemplo do Template'}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setAssetPickerOpen(true)} data-testid="scene-asset-pick">{selectedScene.library_file_id ? 'Trocar da Biblioteca' : 'Escolher da Biblioteca'}</Button>
              {selectedScene.library_file_id ? <Button size="sm" variant="ghost" onClick={() => patchSelectedScene({ library_file_id: null })}>Usar padrão do Template</Button> : null}
            </div>
            {selectedScene.image_url ? <p className="text-[11px] text-amber-600 dark:text-amber-400">Esta cena tem uma imagem legada enviada no editor antigo; ela não é usada na prévia nem no render. Escolha um asset da Biblioteca.</p> : null}
          </> : null}
        </TabsContent>
        <TabsContent value="style" className="pt-3">
          <StyleSourcePanel tokens={context.identitySnapshot ?? undefined} unitLabel="cena" />
        </TabsContent>
        <TabsContent value="motion" className="space-y-2 pt-3">
          {selectedScene ? <>
            <p className="text-[11px] text-muted-foreground">Movimento semântico da cena, resolvido pelo Template (sem keyframes).</p>
            <div className="grid gap-1" role="radiogroup" aria-label="Movimento da cena">
              {MOTION_OPTIONS.map((option) => {
                const checked = (selectedScene.movement || 'static') === option.value
                return (
                  <button key={option.value} type="button" role="radio" aria-checked={checked} onClick={() => patchSelectedScene({ movement: option.value })}
                    className={cn('flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left text-xs', checked ? 'border-primary bg-primary/10' : 'border-border/60 hover:border-border')}
                    data-testid="motion-option" data-value={option.value}>
                    <span>{option.label}</span>
                    <span className={cn('shrink-0 text-[10px]', option.supported ? 'text-muted-foreground' : 'text-amber-600 dark:text-amber-400')}>{option.supported ? PRESET_LABELS[option.preset] ?? option.preset : 'sem preset · estático'}</span>
                  </button>
                )
              })}
            </div>
          </> : null}
        </TabsContent>
      </Tabs>
    </div>
  )

  const lower = (
    <section className="shrink-0 overflow-hidden rounded-lg border border-border/50 bg-background" aria-label="Autoria temporal" data-testid="video-lower-region" data-mode={lowerMode}>
      <div className="flex items-center gap-2 border-b border-border/40 px-3 py-1">
        <div className="flex rounded-md border border-border/60 p-0.5" role="tablist" aria-label="Vista">
          {(['scenes', 'timeline'] as const).map((mode) => (
            <button key={mode} type="button" role="tab" aria-selected={lowerMode === mode} onClick={() => setLowerMode(mode)}
              className={cn('rounded px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide', lowerMode === mode ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
              data-testid={`lower-mode-${mode}`}>
              {mode === 'scenes' ? 'Cenas' : 'Timeline'}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground" data-testid="sequence-summary">{scenes.length} {scenes.length === 1 ? 'cena' : 'cenas'} · {formatSeconds(totalFrames / TIMELINE_FPS)}</span>
      </div>
      {lowerMode === 'scenes' ? (
        <SceneStrip
          scenes={scenes}
          ranges={ranges}
          cursor={cursor}
          selectedIndex={safeSelectedIndex}
          thumbnails={thumbnails}
          motionLabel={motionLabel}
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
        />
      )}
    </section>
  )

  const saveStatusLabel = saveStatus === 'saving' ? 'Salvando…' : saveStatus === 'error' ? 'Falha ao salvar' : dirty ? 'Alterações não salvas' : 'Salvo'
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
          <span className="truncate">Video · Reel 9:16</span>
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
        <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Estado de autoria">
          <Button size="sm" variant="ghost" className="h-8 gap-1 px-1.5 text-[11px]" disabled={!dirty} onClick={revert} title="Descartar alterações não salvas e restaurar o último estado salvo."><Undo2 className="h-3 w-3" />Voltar ao salvo</Button>
          <label className="flex shrink-0 cursor-pointer items-center gap-1 text-[11px] text-muted-foreground"><input type="checkbox" checked={autosaveEnabled} onChange={(event) => setAutosaveEnabled(event.target.checked)} />Auto-save</label>
        </div>
        <span className="text-xs text-muted-foreground" data-testid="save-status" title={saveError ?? undefined}>{saveStatusLabel}</span>
        <Button size="sm" variant="outline" className="gap-1.5" disabled={!dirty && saveStatus !== 'error'} onClick={() => void saveNow()} title="Salvar o VideoDraft (não renderiza)." data-testid="save-button">{saveStatus === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}Salvar</Button>
        <Button size="sm" className="gap-1.5" onClick={() => void renderVideo()} disabled={!canRender || renderActive || saveStatus === 'saving'} title={dirty ? 'O render usa o VideoDraft salvo: salva as alterações e então renderiza o MP4 no servidor.' : 'Renderizar o MP4 final no servidor a partir do VideoDraft salvo.'} data-testid="render-button">
          {renderActive ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}{dirty ? 'Salvar e renderizar' : 'Renderizar vídeo'}
        </Button>
      </div>
    </header>
  )

  const dialogs = <>
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
    {/* OUTPUT PLAYER — the completed MP4 from render_executions. Distinct from the Live Authoring Player. */}
    <Dialog open={outputOpen} onOpenChange={setOutputOpen}>
      <DialogContent className="max-w-[min(92vw,520px)]">
        <DialogHeader>
          <DialogTitle>Vídeo renderizado</DialogTitle>
          <DialogDescription>MP4 final do último render concluído no servidor. Não reflete alterações feitas depois dele.</DialogDescription>
        </DialogHeader>
        <div className="relative mx-auto aspect-[9/16] max-h-[65vh] w-full overflow-hidden rounded-md bg-black">
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
          <StackedWorkbench canvas={<>{canvas}{lower}</>} inspector={inspector} />
          {dialogs}
        </div>
      </DashboardPage>
    )
  }

  return (
    <DashboardPage>
      <div className="flex h-[calc(100dvh-var(--studio-shell-top-bar-height))] min-h-0 min-w-0 flex-col gap-2 px-[var(--studio-shell-page-padding)] pb-3 pt-2">
        {header}
        <CreativeWorkbench className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border/50 bg-background" canvas={canvas} inspector={inspector} inspectorOpen={inspectorOpen} onInspectorOpenChange={setInspectorOpen} />
        {lower}
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
