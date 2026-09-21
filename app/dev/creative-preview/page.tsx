'use client'

import { useCallback, useMemo, useReducer, useState } from 'react'
import Image from 'next/image'
import { DocumentaryCard, documentaryCardPropsFromResolvedInput } from '@/components/creative/documentary-card'
import {
  AUTHORING_HERO_ASSETS,
  DEFAULT_TUNING,
  DEFAULT_PRIMITIVE_TRANSFORMS,
  DEFAULT_PRIMITIVE_TRANSFORMS_STATE,
  TUNING_BOUNDS,
  clampTuningValue,
  createInitialAuthoringState,
  defaultContentForVariant,
  deriveManifestFromState,
  derivePrimitiveSelectionRequest,
  resolvePreviewInput,
  projectRefForIdentity,
  type AuthoringCanvas,
  type AuthoringCoverContent,
  type AuthoringHeroRef,
  type AuthoringIdentity,
  type AuthoringInfoContent,
  type AuthoringPrimitiveSelection,
  type AuthoringPrimitiveTransforms,
  type AuthoringState,
  type AuthoringVariant,
  type DocumentaryCardPreviewTuning,
  type PrimitiveTransforms,
} from '@/lib/creative/authoring'
import { resolveTemplateComponent } from '@/lib/creative/templates/component-resolver'
import { listPrimitivesForProject, type PrimitiveListItem } from '@/lib/creative/primitives/discovery'

type RenderResult = {
  status: 'succeeded'
  render_id: string
  output_path: string
  output_identifier: string
  image_data_url: string
  variant: string
  canvas: { width: number; height: number; unit: 'px' }
  width: number
  height: number
  duration_ms: number
  diagnostics: unknown[]
  bridge: 'local-dev-only'
  tuned: boolean
  primitive_paper?: string
  primitive_tape?: string
}

// ─── Reducer ──────────────────────────────────────────────────────────────────

type Action =
  | { type: 'SET_FIXTURE'; variant: AuthoringVariant; identity: AuthoringIdentity; canvas: AuthoringCanvas }
  | { type: 'SET_VARIANT'; variant: AuthoringVariant }
  | { type: 'SET_IDENTITY'; identity: AuthoringIdentity }
  | { type: 'SET_CANVAS'; canvas: AuthoringCanvas }
  | { type: 'SET_HERO_REF'; ref: AuthoringHeroRef | undefined }
  | { type: 'SET_COVER_FIELD'; field: keyof AuthoringCoverContent; value: string }
  | { type: 'SET_INFO_FIELD'; field: keyof AuthoringInfoContent; value: string }
  | { type: 'SET_INFO_BODY'; value: string }
  | { type: 'SET_TUNING'; tuning: DocumentaryCardPreviewTuning }
  | { type: 'RESET_TUNING' }
  | { type: 'RESET_CONTENT' }
  | { type: 'TOGGLE_DEBUG' }
  // Phase 2C: primitive selection
  | { type: 'SET_PRIMITIVE_PAPER'; key: string | undefined }
  | { type: 'SET_PRIMITIVE_TAPE'; key: string | undefined }
  | { type: 'RESET_PRIMITIVE_PAPER' }
  | { type: 'RESET_PRIMITIVE_TAPE' }
  | { type: 'SET_PRIMITIVE_TRANSFORM'; slot: 'paper' | 'tape'; field: keyof PrimitiveTransforms; value: number }
  | { type: 'RESET_PRIMITIVE_TRANSFORMS'; slot: 'paper' | 'tape' }

function reducer(state: AuthoringState, action: Action): AuthoringState {
  switch (action.type) {
    case 'SET_FIXTURE': {
      const content = defaultContentForVariant(action.variant, action.identity)
      return {
        ...state,
        variant: action.variant,
        identity: action.identity,
        canvas: action.canvas,
        heroRef: undefined,
        contentOverride: content,
        tuning: DEFAULT_TUNING,
      }
    }
    case 'SET_VARIANT': {
      const content = defaultContentForVariant(action.variant, state.identity)
      return { ...state, variant: action.variant, heroRef: undefined, contentOverride: content }
    }
    case 'SET_IDENTITY':
      return {
        ...state,
        identity: action.identity,
        heroRef: undefined,
        contentOverride: defaultContentForVariant(state.variant, action.identity),
        // Reset primitive selection when identity changes (may not have primitives)
        primitiveSelection: action.identity === 'a'
          ? { paper: 'paper-card-light-01', tape: 'tape-kraft-short-01' }
          : {},
        primitiveTransforms: { ...DEFAULT_PRIMITIVE_TRANSFORMS_STATE },
      }
    case 'SET_CANVAS':
      return { ...state, canvas: action.canvas }
    case 'SET_HERO_REF':
      return { ...state, heroRef: action.ref }
    case 'SET_COVER_FIELD': {
      const content = state.contentOverride as AuthoringCoverContent
      return { ...state, contentOverride: { ...content, [action.field]: action.value } }
    }
    case 'SET_INFO_FIELD': {
      const content = state.contentOverride as AuthoringInfoContent
      return { ...state, contentOverride: { ...content, [action.field]: action.value } }
    }
    case 'SET_INFO_BODY': {
      const content = state.contentOverride as AuthoringInfoContent
      return {
        ...state,
        contentOverride: {
          ...content,
          body_blocks: action.value.split('\n').filter(Boolean),
        },
      }
    }
    case 'SET_TUNING':
      return { ...state, tuning: action.tuning }
    case 'RESET_TUNING':
      return { ...state, tuning: DEFAULT_TUNING }
    case 'RESET_CONTENT':
      return { ...state, contentOverride: defaultContentForVariant(state.variant, state.identity), heroRef: undefined }
    case 'TOGGLE_DEBUG':
      return { ...state, debugPanelOpen: !state.debugPanelOpen }
    // Phase 2C: primitive selection actions
    case 'SET_PRIMITIVE_PAPER':
      return {
        ...state,
        primitiveSelection: { ...state.primitiveSelection, paper: action.key },
        // Reset transforms when changing primitive selection
        primitiveTransforms: {
          ...state.primitiveTransforms,
          paper: { ...DEFAULT_PRIMITIVE_TRANSFORMS },
        },
      }
    case 'SET_PRIMITIVE_TAPE':
      return {
        ...state,
        primitiveSelection: { ...state.primitiveSelection, tape: action.key },
        primitiveTransforms: {
          ...state.primitiveTransforms,
          tape: { ...DEFAULT_PRIMITIVE_TRANSFORMS },
        },
      }
    case 'RESET_PRIMITIVE_PAPER':
      return {
        ...state,
        primitiveSelection: { ...state.primitiveSelection, paper: 'paper-card-light-01' },
        primitiveTransforms: {
          ...state.primitiveTransforms,
          paper: { ...DEFAULT_PRIMITIVE_TRANSFORMS },
        },
      }
    case 'RESET_PRIMITIVE_TAPE':
      return {
        ...state,
        primitiveSelection: { ...state.primitiveSelection, tape: 'tape-kraft-short-01' },
        primitiveTransforms: {
          ...state.primitiveTransforms,
          tape: { ...DEFAULT_PRIMITIVE_TRANSFORMS },
        },
      }
    case 'SET_PRIMITIVE_TRANSFORM': {
      const prevSlot = state.primitiveTransforms[action.slot]
      return {
        ...state,
        primitiveTransforms: {
          ...state.primitiveTransforms,
          [action.slot]: { ...prevSlot, [action.field]: action.value },
        },
      }
    }
    case 'RESET_PRIMITIVE_TRANSFORMS':
      return {
        ...state,
        primitiveTransforms: {
          ...state.primitiveTransforms,
          [action.slot]: { ...DEFAULT_PRIMITIVE_TRANSFORMS },
        },
      }
    default:
      return state
  }
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const S = {
  root: {
    background: '#0d1117',
    color: '#c9d1d9',
    display: 'flex',
    flexDirection: 'column' as const,
    fontFamily: '"Courier New", Courier, monospace',
    fontSize: 12,
    minHeight: '100vh',
  },
  header: {
    alignItems: 'center',
    background: '#161b22',
    borderBottom: '1px solid #30363d',
    display: 'flex',
    gap: 12,
    justifyContent: 'space-between',
    padding: '8px 16px',
  },
  headerTitle: { color: '#58a6ff', fontSize: 13, fontWeight: 700 },
  headerBadge: {
    background: '#1f6feb33',
    border: '1px solid #1f6feb',
    borderRadius: 4,
    color: '#58a6ff',
    fontSize: 10,
    padding: '2px 6px',
  },
  body: {
    display: 'grid',
    flex: 1,
    gap: 0,
    gridTemplateColumns: '280px 1fr',
  },
  panel: {
    background: '#161b22',
    borderRight: '1px solid #30363d',
    display: 'flex',
    flexDirection: 'column' as const,
    overflowY: 'auto' as const,
  },
  section: {
    borderBottom: '1px solid #21262d',
    padding: '10px 14px',
  },
  sectionTitle: {
    color: '#8b949e',
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '.08em',
    marginBottom: 8,
    textTransform: 'uppercase' as const,
  },
  label: { color: '#8b949e', display: 'block', fontSize: 11, marginBottom: 3 },
  select: {
    background: '#0d1117',
    border: '1px solid #30363d',
    borderRadius: 4,
    color: '#c9d1d9',
    fontSize: 11,
    padding: '4px 6px',
    width: '100%',
  },
  textarea: {
    background: '#0d1117',
    border: '1px solid #30363d',
    borderRadius: 4,
    color: '#c9d1d9',
    fontFamily: 'inherit',
    fontSize: 11,
    padding: '4px 6px',
    resize: 'vertical' as const,
    width: '100%',
  },
  input: {
    background: '#0d1117',
    border: '1px solid #30363d',
    borderRadius: 4,
    color: '#c9d1d9',
    fontSize: 11,
    padding: '4px 6px',
    width: '100%',
  },
  row: { display: 'flex', gap: 6, marginBottom: 6 },
  btn: {
    background: '#21262d',
    border: '1px solid #30363d',
    borderRadius: 4,
    color: '#c9d1d9',
    cursor: 'pointer',
    fontSize: 11,
    padding: '4px 10px',
  },
  btnPrimary: {
    background: '#1f6feb',
    border: '1px solid #388bfd',
    borderRadius: 4,
    color: '#fff',
    cursor: 'pointer',
    fontSize: 11,
    padding: '4px 10px',
  },
  btnSm: {
    background: '#21262d',
    border: '1px solid #30363d',
    borderRadius: 4,
    color: '#8b949e',
    cursor: 'pointer',
    fontSize: 10,
    padding: '2px 8px',
  },
  previewArea: {
    alignItems: 'center',
    background: '#010409',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 16,
    justifyContent: 'center',
    minHeight: 0,
    padding: 24,
  },
  finalRenderCard: {
    alignItems: 'center',
    background: '#0d1117',
    border: '1px solid #30363d',
    borderRadius: 6,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
    maxWidth: 380,
    padding: 12,
    width: '100%',
  },
  finalRenderHeader: { alignItems: 'center', display: 'flex', justifyContent: 'space-between', width: '100%' },
  renderMeta: { color: '#8b949e', fontSize: 10, lineHeight: 1.5, textAlign: 'center' as const },
  previewLabel: { color: '#484f58', fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase' as const },
  sliderRow: { alignItems: 'center', display: 'flex', gap: 8, marginBottom: 5 },
  sliderLabel: { color: '#8b949e', fontSize: 10, minWidth: 60 },
  sliderValue: { color: '#58a6ff', fontSize: 10, minWidth: 32, textAlign: 'right' as const },
  assetCard: {
    background: '#0d1117',
    border: '1px solid #30363d',
    borderRadius: 4,
    cursor: 'pointer',
    marginBottom: 6,
    padding: '6px 8px',
  },
  assetCardActive: {
    background: '#1f6feb22',
    border: '1px solid #1f6feb',
    borderRadius: 4,
    cursor: 'pointer',
    marginBottom: 6,
    padding: '6px 8px',
  },
  primitiveCard: {
    alignItems: 'center',
    background: '#0d1117',
    border: '1px solid #30363d',
    borderRadius: 4,
    cursor: 'pointer',
    display: 'flex',
    gap: 8,
    marginBottom: 4,
    padding: '6px 8px',
  },
  primitiveCardActive: {
    alignItems: 'center',
    background: '#1f6feb22',
    border: '1px solid #1f6feb',
    borderRadius: 4,
    cursor: 'pointer',
    display: 'flex',
    gap: 8,
    marginBottom: 4,
    padding: '6px 8px',
  },
  categoryPill: {
    background: '#21262d',
    borderRadius: 3,
    color: '#8b949e',
    fontSize: 9,
    letterSpacing: '.06em',
    padding: '1px 5px',
    textTransform: 'uppercase' as const,
  },
  checker: {
    background: 'repeating-conic-gradient(#333 0% 25%, #1a1a1a 0% 50%) 0 0 / 10px 10px',
    borderRadius: 2,
    display: 'inline-block',
    height: 20,
    marginRight: 6,
    verticalAlign: 'middle',
    width: 20,
  },
  codeBlock: {
    background: '#010409',
    border: '1px solid #21262d',
    borderRadius: 4,
    color: '#7ee787',
    fontSize: 9,
    maxHeight: 200,
    overflow: 'auto',
    padding: '6px 8px',
    whiteSpace: 'pre' as const,
  },
}

// ─── Slider ───────────────────────────────────────────────────────────────────

function Slider({
  label,
  value,
  min,
  max,
  step = 0.5,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
}) {
  return (
    <div style={S.sliderRow}>
      <span style={S.sliderLabel}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => { onChange(Number(e.target.value)) }}
        style={{ flex: 1 }}
      />
      <span style={S.sliderValue}>{value.toFixed(1)}</span>
    </div>
  )
}

// ─── PrimitivePicker ──────────────────────────────────────────────────────────

function PrimitivePicker({
  slot,
  label,
  primitives,
  selectedKey,
  onSelect,
  onReset,
}: {
  slot: 'paper' | 'tape'
  label: string
  primitives: PrimitiveListItem[]
  selectedKey: string | undefined
  onSelect: (key: string | undefined) => void
  onReset: () => void
}) {
  const slotCategory = slot === 'paper' ? 'paper' : 'tape'
  const available = primitives.filter((p) => p.category === slotCategory)

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={S.label}>{label}</span>
        <button style={S.btnSm} onClick={onReset} title={`Reset ${slot} to template default`}>
          Reset {slot}
        </button>
      </div>
      {available.length === 0
        ? <div style={{ color: '#484f58', fontSize: 10 }}>No {slot} primitives available for this project.</div>
        : available.map((primitive) => {
            const isActive = selectedKey === primitive.key
            return (
              <div
                key={primitive.key}
                style={isActive ? S.primitiveCardActive : S.primitiveCard}
                onClick={() => { onSelect(isActive ? undefined : primitive.key) }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') onSelect(isActive ? undefined : primitive.key) }}
              >
                <span style={S.checker} title="Alpha transparent PNG" />
                <div style={{ flex: 1 }}>
                  <div style={{ color: isActive ? '#58a6ff' : '#c9d1d9', fontSize: 11, fontWeight: isActive ? 700 : 400 }}>
                    {primitive.display_name}
                  </div>
                  <div style={{ color: '#484f58', fontSize: 9, marginTop: 1 }}>
                    {primitive.key} · v{primitive.version}
                    <span style={{ ...S.categoryPill, marginLeft: 4 }}>{primitive.category}</span>
                  </div>
                </div>
                {isActive && <span style={{ color: '#3fb950', fontSize: 9 }}>✓</span>}
              </div>
            )
          })
      }
      {selectedKey === undefined && (
        <div style={{ color: '#6e7681', fontSize: 9, marginTop: 2 }}>
          No primitive selected — template fixture fallback active.
        </div>
      )}
    </div>
  )
}

// ─── PrimitiveTransformControls ───────────────────────────────────────────────

function PrimitiveTransformControls({
  slot,
  transforms,
  onChange,
  onReset,
}: {
  slot: 'paper' | 'tape'
  transforms: PrimitiveTransforms
  onChange: (field: keyof PrimitiveTransforms, value: number) => void
  onReset: () => void
}) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ color: '#8b949e', fontSize: 10 }}>{slot} transforms</span>
        <button style={S.btnSm} onClick={onReset}>Reset</button>
      </div>
      <Slider label="offset X" value={transforms.offsetX} min={-120} max={120} step={1} onChange={(v) => { onChange('offsetX', v) }} />
      <Slider label="offset Y" value={transforms.offsetY} min={-120} max={120} step={1} onChange={(v) => { onChange('offsetY', v) }} />
      <Slider label="rotation" value={transforms.rotation} min={-15} max={15} step={0.5} onChange={(v) => { onChange('rotation', v) }} />
      <Slider label="scale" value={transforms.scale} min={0.5} max={2} step={0.01} onChange={(v) => { onChange('scale', v) }} />
      <Slider label="opacity" value={transforms.opacity} min={0} max={1} step={0.01} onChange={(v) => { onChange('opacity', v) }} />
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AuthoringLabPage() {
  const [state, dispatch] = useReducer(reducer, createInitialAuthoringState())
  const [renderState, setRenderState] = useState<'idle' | 'rendering' | 'success' | 'error'>('idle')
  const [renderResult, setRenderResult] = useState<RenderResult | null>(null)
  const [renderError, setRenderError] = useState<string | null>(null)

  // Verify the component resolver produces the same component as render
  const componentResolved = useMemo(() => !!resolveTemplateComponent('editorial.documentary-card'), [])

  // Resolve the preview input — same path as Wave 5 render
  const previewInput = useMemo(() => {
    try {
      return resolvePreviewInput(state)
    } catch {
      return null
    }
  }, [state])

  // Build DocumentaryCard props from resolved input (still mode for preview)
  const cardProps = useMemo(() => {
    if (!previewInput) return null
    const base = documentaryCardPropsFromResolvedInput(previewInput, 'still')
    return { ...base, previewTuning: state.tuning }
  }, [previewInput, state.tuning])

  // Derive the manifest (tuning excluded) for the debug panel
  const derivedManifest = useMemo(() => deriveManifestFromState(state), [state])

  // Phase 2C: derive primitive selection for render request
  const primitiveSelectionRequest = useMemo(() => derivePrimitiveSelectionRequest(state), [state])

  // Phase 2C: discover available primitives for identity 'a' (Portal project)
  const projectRef = useMemo(() => projectRefForIdentity(state.identity), [state.identity])
  const availablePrimitives = useMemo((): PrimitiveListItem[] => {
    if (!projectRef) return []
    const result = listPrimitivesForProject(projectRef)
    return result.found ? result.primitives : []
  }, [projectRef])

  const renderThis = useCallback(async () => {
    setRenderState('rendering')
    setRenderError(null)
    try {
      const response = await fetch('/dev/creative-preview/render', {
        body: JSON.stringify({
          manifest: derivedManifest,
          overrides: { documentaryCard: state.tuning },
          // Phase 2C: pass primitive selection alongside the manifest
          ...(primitiveSelectionRequest ? { primitiveSelection: primitiveSelectionRequest } : {}),
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })
      const payload = await response.json() as RenderResult & { error?: string }
      if (!response.ok) throw new Error(payload.error ?? `Render failed (${response.status})`)
      setRenderResult(payload)
      setRenderState('success')
    } catch (error) {
      setRenderState('error')
      setRenderError(error instanceof Error ? error.message : 'Render failed.')
    }
  }, [derivedManifest, state.tuning, primitiveSelectionRequest])

  // Canvas dimensions for scaling
  const canvasHeight = state.canvas === 'portrait' ? 1350 : 1920
  const canvasWidth = 1080

  // Preview scale to fit in the center column
  const [previewWidth] = useState(360)
  const previewHeight = Math.round((previewWidth / canvasWidth) * canvasHeight)
  const scale = previewWidth / canvasWidth

  const setTuning = useCallback((tuning: DocumentaryCardPreviewTuning) => {
    dispatch({ type: 'SET_TUNING', tuning })
  }, [])

  const coverContent = state.variant === 'cover' ? state.contentOverride as AuthoringCoverContent : null
  const infoContent = state.variant === 'info' ? state.contentOverride as AuthoringInfoContent : null

  const heroTuning = state.tuning.hero
  const titleTuning = state.tuning.title

  const hasPrimitives = availablePrimitives.length > 0

  return (
    <div style={S.root}>
      {/* Header */}
      <div style={S.header}>
        <div style={{ alignItems: 'center', display: 'flex', gap: 10 }}>
          <span style={S.headerTitle}>Documentary Card — Authoring Lab</span>
          <span style={S.headerBadge}>Phase 2C · /dev/creative-preview</span>
          {componentResolved
            ? <span style={{ ...S.headerBadge, background: '#1a7f2233', border: '1px solid #3fb950', color: '#3fb950' }}>component ✓</span>
            : <span style={{ ...S.headerBadge, background: '#7d0c1533', border: '1px solid #da3633', color: '#da3633' }}>component ✗</span>
          }
          {hasPrimitives && (
            <span style={{ ...S.headerBadge, background: '#1a7f2233', border: '1px solid #3fb950', color: '#3fb950' }}>
              {availablePrimitives.length} primitives
            </span>
          )}
        </div>
        <div style={{ alignItems: 'center', display: 'flex', gap: 8 }}>
          <button style={S.btnPrimary} disabled={renderState === 'rendering'} onClick={() => { void renderThis() }}>
            {renderState === 'rendering' ? 'Rendering…' : 'Render this'}
          </button>
          <button style={S.btn} onClick={() => { dispatch({ type: 'TOGGLE_DEBUG' }) }}>
            {state.debugPanelOpen ? 'Hide debug' : 'Show debug'}
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ ...S.body, gridTemplateColumns: state.debugPanelOpen ? '280px 1fr 300px' : '280px 1fr' }}>
        {/* ── Left panel ── */}
        <div style={S.panel}>

          {/* Source / Fixture selector */}
          <div style={S.section}>
            <div style={S.sectionTitle}>Source / Fixture</div>
            <div style={{ marginBottom: 6 }}>
              <label style={S.label}>Variant</label>
              <select
                style={S.select}
                value={state.variant}
                onChange={(e) => { dispatch({ type: 'SET_VARIANT', variant: e.target.value as AuthoringVariant }) }}
              >
                <option value="cover">cover</option>
                <option value="info">info</option>
              </select>
            </div>
            <div style={{ marginBottom: 6 }}>
              <label style={S.label}>Identity / Project</label>
              <select
                style={S.select}
                value={state.identity}
                onChange={(e) => { dispatch({ type: 'SET_IDENTITY', identity: e.target.value as AuthoringIdentity }) }}
              >
                <option value="a">A — Comunidades Alternativas</option>
                <option value="b">B — Acme Labs (neutral)</option>
              </select>
            </div>
            <div style={{ marginBottom: 8 }}>
              <label style={S.label}>Canvas</label>
              <select
                style={S.select}
                value={state.canvas}
                onChange={(e) => { dispatch({ type: 'SET_CANVAS', canvas: e.target.value as AuthoringCanvas }) }}
              >
                <option value="portrait">1080 × 1350 (4:5)</option>
                <option value="reel">1080 × 1920 (9:16)</option>
              </select>
            </div>
            <div style={S.row}>
              <button style={S.btn} onClick={() => { dispatch({ type: 'RESET_CONTENT' }) }}>
                Reset content
              </button>
              <button style={S.btn} onClick={() => { dispatch({ type: 'RESET_TUNING' }) }}>
                Reset tuning
              </button>
            </div>
          </div>

          {/* ── Phase 2C: Primitive Slots ── */}
          {hasPrimitives && (
            <div style={S.section}>
              <div style={S.sectionTitle}>
                Primitives
                <span style={{ color: '#484f58', fontWeight: 400 }}> (project-scoped)</span>
              </div>
              <div style={{ color: '#8b949e', fontSize: 10, marginBottom: 8 }}>
                Select materials from the project&apos;s primitive catalog.
                <br />
                <span style={{ color: '#484f58' }}>Preview uses fixture proxy; final render uses real S3 assets.</span>
              </div>

              {/* Paper slot */}
              <PrimitivePicker
                slot="paper"
                label="Paper slot"
                primitives={availablePrimitives}
                selectedKey={state.primitiveSelection.paper}
                onSelect={(key) => { dispatch({ type: 'SET_PRIMITIVE_PAPER', key }) }}
                onReset={() => { dispatch({ type: 'RESET_PRIMITIVE_PAPER' }) }}
              />

              {/* Tape slot */}
              <PrimitivePicker
                slot="tape"
                label="Tape slot"
                primitives={availablePrimitives}
                selectedKey={state.primitiveSelection.tape}
                onSelect={(key) => { dispatch({ type: 'SET_PRIMITIVE_TAPE', key }) }}
                onReset={() => { dispatch({ type: 'RESET_PRIMITIVE_TAPE' }) }}
              />

              {primitiveSelectionRequest && (
                <div style={{ background: '#0d1117', border: '1px solid #21262d', borderRadius: 3, fontSize: 9, marginTop: 6, padding: '4px 6px' }}>
                  <span style={{ color: '#3fb950' }}>✓ Render will use real project primitives</span><br />
                  <span style={{ color: '#484f58' }}>Manifest stays neutral (no PrimitiveRef)</span>
                </div>
              )}
            </div>
          )}

          {/* Phase 2C: Primitive Transforms */}
          {hasPrimitives && (state.primitiveSelection.paper || state.primitiveSelection.tape) && (
            <div style={S.section}>
              <div style={S.sectionTitle}>
                Primitive Transforms
                <span style={{ color: '#484f58', fontWeight: 400 }}> (authoring-layer)</span>
              </div>
              {state.primitiveSelection.paper && (
                <PrimitiveTransformControls
                  slot="paper"
                  transforms={state.primitiveTransforms.paper}
                  onChange={(field, value) => { dispatch({ type: 'SET_PRIMITIVE_TRANSFORM', slot: 'paper', field, value }) }}
                  onReset={() => { dispatch({ type: 'RESET_PRIMITIVE_TRANSFORMS', slot: 'paper' }) }}
                />
              )}
              {state.primitiveSelection.tape && (
                <PrimitiveTransformControls
                  slot="tape"
                  transforms={state.primitiveTransforms.tape}
                  onChange={(field, value) => { dispatch({ type: 'SET_PRIMITIVE_TRANSFORM', slot: 'tape', field, value }) }}
                  onReset={() => { dispatch({ type: 'RESET_PRIMITIVE_TRANSFORMS', slot: 'tape' }) }}
                />
              )}
            </div>
          )}

          {/* Content editing */}
          <div style={S.section}>
            <div style={S.sectionTitle}>Content</div>
            {coverContent && (
              <>
                {(['eyebrow', 'title', 'subtitle', 'source_line', 'detail_note'] as const).map((field) => (
                  <div key={field} style={{ marginBottom: 6 }}>
                    <label style={S.label}>{field}</label>
                    <textarea
                      style={S.textarea}
                      rows={field === 'title' || field === 'subtitle' ? 3 : 2}
                      value={coverContent[field] ?? ''}
                      onChange={(e) => { dispatch({ type: 'SET_COVER_FIELD', field, value: e.target.value }) }}
                    />
                  </div>
                ))}
              </>
            )}
            {infoContent && (
              <>
                {(['title', 'intro', 'source_line', 'annotation'] as const).map((field) => (
                  <div key={field} style={{ marginBottom: 6 }}>
                    <label style={S.label}>{field}</label>
                    <textarea
                      style={S.textarea}
                      rows={field === 'title' ? 3 : 2}
                      value={infoContent[field] ?? ''}
                      onChange={(e) => { dispatch({ type: 'SET_INFO_FIELD', field, value: e.target.value }) }}
                    />
                  </div>
                ))}
                <div style={{ marginBottom: 6 }}>
                  <label style={S.label}>body_blocks (one per line)</label>
                  <textarea
                    style={S.textarea}
                    rows={4}
                    value={infoContent.body_blocks.join('\n')}
                    onChange={(e) => { dispatch({ type: 'SET_INFO_BODY', value: e.target.value }) }}
                  />
                </div>
              </>
            )}
          </div>

          {/* Asset selection (cover only) */}
          {state.variant === 'cover' && (
            <div style={S.section}>
              <div style={S.sectionTitle}>Hero Asset</div>
              {AUTHORING_HERO_ASSETS.map((asset) => {
                const isActive = (state.heroRef ?? AUTHORING_HERO_ASSETS[0].ref) === asset.ref
                return (
                  <div
                    key={asset.ref}
                    style={isActive ? S.assetCardActive : S.assetCard}
                    onClick={() => { dispatch({ type: 'SET_HERO_REF', ref: isActive ? undefined : asset.ref as AuthoringHeroRef }) }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter') dispatch({ type: 'SET_HERO_REF', ref: isActive ? undefined : asset.ref as AuthoringHeroRef }) }}
                  >
                    <div style={{ alignItems: 'center', display: 'flex', gap: 6 }}>
                      {asset.hasAlpha
                        ? <span style={S.checker} title="Has alpha (transparent)" />
                        : <span style={{ background: '#333', borderRadius: 2, display: 'inline-block', height: 20, marginRight: 6, verticalAlign: 'middle', width: 20 }} title="Opaque" />
                      }
                      <div>
                        <div style={{ color: isActive ? '#58a6ff' : '#c9d1d9', fontSize: 11 }}>{asset.label}</div>
                        <div style={{ color: '#484f58', fontSize: 9 }}>
                          {asset.mimeType} · {asset.dimensions.width}×{asset.dimensions.height}
                          {asset.hasAlpha ? ' · alpha ✓' : ' · opaque'}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Visual tuning (cover only for hero+title; info gets title only) */}
          <div style={S.section}>
            <div style={S.sectionTitle}>
              Visual Tuning
              <span style={{ color: '#484f58', fontWeight: 400 }}> (UI-only, not in manifest)</span>
            </div>
            {state.variant === 'cover' && (
              <>
                <div style={{ color: '#8b949e', fontSize: 10, marginBottom: 6 }}>Hero</div>
                <Slider
                  label="offset X"
                  value={heroTuning.offsetX}
                  min={TUNING_BOUNDS.hero.offsetX.min}
                  max={TUNING_BOUNDS.hero.offsetX.max}
                  onChange={(v) => { setTuning({ ...state.tuning, hero: { ...heroTuning, offsetX: clampTuningValue('hero', 'offsetX', v) } }) }}
                />
                <Slider
                  label="offset Y"
                  value={heroTuning.offsetY}
                  min={TUNING_BOUNDS.hero.offsetY.min}
                  max={TUNING_BOUNDS.hero.offsetY.max}
                  onChange={(v) => { setTuning({ ...state.tuning, hero: { ...heroTuning, offsetY: clampTuningValue('hero', 'offsetY', v) } }) }}
                />
                <Slider
                  label="rotation"
                  value={heroTuning.rotation}
                  min={TUNING_BOUNDS.hero.rotation.min}
                  max={TUNING_BOUNDS.hero.rotation.max}
                  step={0.1}
                  onChange={(v) => { setTuning({ ...state.tuning, hero: { ...heroTuning, rotation: clampTuningValue('hero', 'rotation', v) } }) }}
                />
                <Slider
                  label="scale"
                  value={heroTuning.scale}
                  min={TUNING_BOUNDS.hero.scale.min}
                  max={TUNING_BOUNDS.hero.scale.max}
                  step={0.01}
                  onChange={(v) => { setTuning({ ...state.tuning, hero: { ...heroTuning, scale: clampTuningValue('hero', 'scale', v) } }) }}
                />
              </>
            )}
            <div style={{ color: '#8b949e', fontSize: 10, marginBottom: 6, marginTop: state.variant === 'cover' ? 8 : 0 }}>Title paper</div>
            <Slider
              label="offset X"
              value={titleTuning.offsetX}
              min={TUNING_BOUNDS.title.offsetX.min}
              max={TUNING_BOUNDS.title.offsetX.max}
              onChange={(v) => { setTuning({ ...state.tuning, title: { ...titleTuning, offsetX: clampTuningValue('title', 'offsetX', v) } }) }}
            />
            <Slider
              label="offset Y"
              value={titleTuning.offsetY}
              min={TUNING_BOUNDS.title.offsetY.min}
              max={TUNING_BOUNDS.title.offsetY.max}
              onChange={(v) => { setTuning({ ...state.tuning, title: { ...titleTuning, offsetY: clampTuningValue('title', 'offsetY', v) } }) }}
            />
            <Slider
              label="rotation"
              value={titleTuning.rotation}
              min={TUNING_BOUNDS.title.rotation.min}
              max={TUNING_BOUNDS.title.rotation.max}
              step={0.1}
              onChange={(v) => { setTuning({ ...state.tuning, title: { ...titleTuning, rotation: clampTuningValue('title', 'rotation', v) } }) }}
            />
            <button style={{ ...S.btn, marginTop: 8 }} onClick={() => { dispatch({ type: 'RESET_TUNING' }) }}>
              Reset tuning
            </button>
          </div>
        </div>

        {/* ── Center: live preview ── */}
        <div style={S.previewArea}>
          <span style={S.previewLabel}>
            {state.variant} · {canvasWidth}×{canvasHeight} · identity {state.identity.toUpperCase()} · same DocumentaryCard tree
          </span>

          {cardProps
            ? (
                // Scale wrapper: preview state is UI-only (zoom)
                <div
                  style={{
                    height: previewHeight,
                    overflow: 'hidden',
                    position: 'relative',
                    width: previewWidth,
                  }}
                >
                  <div
                    style={{
                      height: canvasHeight,
                      pointerEvents: 'none',
                      transformOrigin: 'top left',
                      transform: `scale(${scale})`,
                      width: canvasWidth,
                    }}
                  >
                    <DocumentaryCard {...cardProps} />
                  </div>
                </div>
              )
            : (
                <div style={{ color: '#da3633', fontSize: 12 }}>
                  Preview could not be resolved.
                  Check the authoring state / fixture configuration.
                </div>
              )
          }

          <div style={{ color: '#484f58', fontSize: 10, maxWidth: 360, textAlign: 'center' }}>
            Preview scale: {Math.round(scale * 100)}% of {canvasWidth}×{canvasHeight}.
            {primitiveSelectionRequest
              ? ' Using project primitives · paper + tape real S3 assets in final render.'
              : ' No project primitives selected.'}
          </div>

          <div style={S.finalRenderCard}>
            <div style={S.finalRenderHeader}>
              <span style={S.sectionTitle}>Final render</span>
              <span style={{ color: renderState === 'error' ? '#da3633' : renderState === 'success' ? '#3fb950' : '#8b949e', fontSize: 10 }}>
                {renderState === 'idle' ? 'idle' : renderState === 'rendering' ? 'rendering…' : renderState === 'success' ? 'success' : 'error'}
              </span>
            </div>
            {renderResult
              ? (
                  <>
                    <Image alt="Final rendered Documentary Card PNG" height={340} src={renderResult.image_data_url} style={{ height: 'auto', maxHeight: 340, maxWidth: 272, objectFit: 'contain', width: 'auto' }} unoptimized width={272} />
                    <div style={S.renderMeta}>
                      {renderResult.duration_ms} ms · {renderResult.variant} · {renderResult.canvas.width}×{renderResult.canvas.height}<br />
                      {renderResult.tuned ? 'runtime tuning included' : 'default behavior'} · {renderResult.bridge}<br />
                      {renderResult.primitive_paper && <span style={{ color: '#3fb950' }}>paper: {renderResult.primitive_paper}</span>}
                      {renderResult.primitive_paper && renderResult.primitive_tape && ' · '}
                      {renderResult.primitive_tape && <span style={{ color: '#3fb950' }}>tape: {renderResult.primitive_tape}</span>}<br />
                      {renderResult.output_identifier} · diagnostics: {renderResult.diagnostics.length}
                    </div>
                  </>
                )
              : <div style={{ color: '#484f58', fontSize: 11 }}>Click &quot;Render this&quot; to compare the real PNG with the live preview.</div>}
            {renderError && <div style={{ color: '#da3633', fontSize: 10, maxWidth: 360 }}>{renderError}</div>}
          </div>
        </div>

        {/* ── Optional right debug panel ── */}
        {state.debugPanelOpen && (
          <div style={{ ...S.panel, borderLeft: '1px solid #30363d', borderRight: 'none' }}>
            <div style={S.section}>
              <div style={S.sectionTitle}>Primitive Selection State</div>
              <div style={{ color: '#8b949e', fontSize: 10, marginBottom: 4 }}>
                Semantic keys — never signed URLs
              </div>
              <pre style={S.codeBlock}>{JSON.stringify({
                primitiveSelection: state.primitiveSelection,
                primitiveTransforms: state.primitiveTransforms,
                renderRequest: primitiveSelectionRequest ?? null,
              }, null, 2)}</pre>
            </div>
            <div style={S.section}>
              <div style={S.sectionTitle}>Current Tuning</div>
              <div style={{ color: '#8b949e', fontSize: 10, marginBottom: 4 }}>
                UI-only — not in manifest
              </div>
              <pre style={S.codeBlock}>{JSON.stringify(state.tuning, null, 2)}</pre>
            </div>
            <div style={S.section}>
              <div style={S.sectionTitle}>Derived Manifest (tuning excluded)</div>
              <div style={{ color: '#8b949e', fontSize: 10, marginBottom: 4 }}>
                This is what feeds the render path — no PrimitiveRef
              </div>
              <button
                style={S.btn}
                onClick={() => { void navigator.clipboard.writeText(JSON.stringify(derivedManifest, null, 2)) }}
              >
                Copy JSON
              </button>
              <pre style={{ ...S.codeBlock, marginTop: 6 }}>{JSON.stringify(derivedManifest, null, 2)}</pre>
            </div>
            <div style={S.section}>
              <div style={S.sectionTitle}>Resolution Diagnostics</div>
              {previewInput
                ? (
                    <pre style={S.codeBlock}>
                      {JSON.stringify(
                        {
                          template: `${previewInput.resolvedTemplate.ref.id}@${previewInput.resolvedTemplate.ref.version}`,
                          component_key: previewInput.resolvedTemplate.descriptor.component_key,
                          variant: previewInput.manifest.template.variant,
                          canvas: previewInput.manifest.canvas,
                          identity: previewInput.manifest.identity.snapshot_ref,
                          diagnostics: previewInput.diagnostics,
                          resolvedAssets: Object.fromEntries(
                            Object.entries(previewInput.resolvedAssets).map(([k, v]) => [k, { ref: v.ref, mime_type: v.mime_type }]),
                          ),
                        },
                        null,
                        2,
                      )}
                    </pre>
                  )
                : <span style={{ color: '#da3633' }}>Resolution failed</span>
              }
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
