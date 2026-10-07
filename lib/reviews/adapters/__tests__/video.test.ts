import { describe, expect, it } from 'vitest'
import { ReviewResultV1Schema, type VideoReviewContext, type VideoReviewSubject } from '../../contracts'
import { ReviewServiceError } from '../../errors'
import {
  VIDEO_CRITERION_KEYS,
  VIDEO_EVALUATOR_PROMPT_VERSION,
  VIDEO_EVALUATOR_RESPONSE_SCHEMA,
  VIDEO_REVIEW_ADAPTER_KEY,
  VIDEO_REVIEW_ADAPTER_VERSION,
  buildVideoEvaluationPrompt,
  mapVideoEvaluatorResult,
  parseVideoEvaluatorResponse,
} from '../video'

const ID = '00000000-0000-4000-8000-000000000001'

const context: VideoReviewContext = {
  schemaVersion: 1,
  capturedAt: '2026-10-07T00:00:00.000Z',
  project: { id: ID, context: 'Brand X launch', evaluationMode: 'strict', identity: { voice: 'calm' } },
  production: { id: ID, title: 'Spring', intention: 'Promote', type: 'video' },
}

function subject(overrides: Partial<VideoReviewSubject> = {}): VideoReviewSubject {
  return {
    artifactId: ID,
    source: { kind: 'video_generation', id: ID },
    projectId: ID,
    productionId: ID,
    media: { mimeType: 'video/mp4', byteSize: 1234, durationMs: 8000, width: 1280, height: 720, contentHash: 'a'.repeat(64) },
    sourceContext: { submittedPrompt: 'A calm sunrise', provider: 'kling' },
    ...overrides,
  }
}

describe('Video Review adapter: prompt', () => {
  it('asks only about visuals, never audio, and never grants approval authority', () => {
    const { system } = buildVideoEvaluationPrompt(context, subject())
    expect(system).toMatch(/VISUALS only/)
    expect(system).toMatch(/Do not assess, describe or score audio/)
    expect(system).toMatch(/Never output approval, rejection or publishing authority/)
    for (const key of ['visual_consistency', 'composition_readability', 'temporal_coherence', 'technical_defects', 'pacing', 'text_caption_legibility', 'brand_context_alignment', 'prompt_adherence']) {
      expect(system).toContain(key)
    }
    expect(system).not.toMatch(/audio_/)
    expect(VIDEO_CRITERION_KEYS.some((key) => /audio|sound|music|speech/.test(key))).toBe(false)
  })

  it('conditions optional criteria on what the server actually has', () => {
    const { system } = buildVideoEvaluationPrompt(context, subject())
    expect(system).toMatch(/pacing only when it can be inferred/)
    expect(system).toMatch(/text_caption_legibility only when text or captions are visible/)
    expect(system).toMatch(/brand_context_alignment only when project identity or context is provided/)
    expect(system).toMatch(/prompt_adherence only when a submitted prompt is provided/)
    expect(system).toMatch(/refinedPrompt must be null unless a submitted prompt is provided/)
  })

  it('embeds server-resolved context, server-verified facts and no storage coordinates', () => {
    const { input } = buildVideoEvaluationPrompt(context, subject())
    expect(input).toContain('SUBMITTED PROMPT:\nA calm sunrise')
    expect(input).toContain('Brand X launch')
    expect(input).toContain('"voice":"calm"')
    expect(input).toContain('"title":"Spring"')
    expect(input).toContain('duration 8.0s, dimensions 1280x720, mime video/mp4')
    expect(input).toContain('attached as media input')
    expect(input).not.toMatch(/https?:\/\//)
    expect(input).not.toMatch(/users\/|storage/i)
  })

  it('states None / unknown honestly when context or facts are absent', () => {
    const { input } = buildVideoEvaluationPrompt(
      { ...context, project: { id: null, context: null, evaluationMode: null, identity: null }, production: null },
      subject({ sourceContext: {}, media: { mimeType: 'video/mp4', byteSize: 1, durationMs: null, width: null, height: null, contentHash: null } }),
    )
    expect(input).toContain('SUBMITTED PROMPT:\nNone')
    expect(input).toContain('PROJECT CONTEXT:\nNone')
    expect(input).toContain('PROJECT IDENTITY:\nNone')
    expect(input).toContain('duration unknown, dimensions unknown')
  })

  it('does not echo the submitted prompt into the SOURCE block twice', () => {
    const { input } = buildVideoEvaluationPrompt(context, subject())
    expect(input.match(/A calm sunrise/g)).toHaveLength(1)
  })
})

describe('Video Review adapter: strict result parsing', () => {
  const ok = { score: 82, feedback: 'Smooth.', improvements: ['Trim'], refinedPrompt: 'slower pan', criteria: [{ key: 'visual_consistency', label: 'VC', score: 80, assessment: 'strong', evidence: ['stable'], applicable: true }] }

  it('accepts a well-formed response', () => {
    expect(parseVideoEvaluatorResponse(ok)).toMatchObject({ score: 82, refinedPrompt: 'slower pan' })
  })

  it('rejects malformed output as an invalid evaluator response (never a success)', () => {
    for (const bad of [null, 'text', [1], {}, { ...ok, score: 'x' }, { ...ok, score: 101 }, { ...ok, score: 1.5 }, { ...ok, feedback: '' }, { ...ok, improvements: [1] }, { ...ok, refinedPrompt: 5 },
      { ...ok, criteria: 'x' }, { ...ok, criteria: [{ key: 'k' }] }, { ...ok, criteria: [{ ...ok.criteria[0], assessment: 'great' }] }]) {
      expect(() => parseVideoEvaluatorResponse(bad), JSON.stringify(bad)).toThrow(ReviewServiceError)
      try { parseVideoEvaluatorResponse(bad) } catch (error) { expect(error).toMatchObject({ code: 'REVIEW_INVALID_EVALUATOR_RESPONSE', status: 502 }) }
    }
  })
})

describe('Video Review adapter: result mapping', () => {
  it('maps to the shared versioned envelope as an advisory, visual-only result', () => {
    const parsed = parseVideoEvaluatorResponse({ score: 82, feedback: 'Smooth.', improvements: ['Trim'], refinedPrompt: 'slower pan' })
    const result = mapVideoEvaluatorResult(parsed, context, subject())
    expect(ReviewResultV1Schema.parse(result)).toEqual(result)
    expect(result.adapter).toEqual({ key: VIDEO_REVIEW_ADAPTER_KEY, version: VIDEO_REVIEW_ADAPTER_VERSION })
    expect(result.overall).toEqual({ score: 82, assessment: 'strong' })
    expect(result.criteria.map((c) => c.key)).toEqual(['visual_consistency', 'composition_readability', 'temporal_coherence', 'technical_defects'])
    expect(result.adapterResult).toMatchObject({ analyzed: 'visual_only', sourceKind: 'video_generation', durationMs: 8000, evaluationMode: 'strict' })
    expect(Object.keys(result).filter((key) => /approv|publish|accepted/i.test(key))).toEqual([])
    expect(VIDEO_EVALUATOR_PROMPT_VERSION).toBe('video-review-prompt-v1')
  })

  it('keeps a refinement only when the source had a prompt to refine', () => {
    const parsed = parseVideoEvaluatorResponse({ score: 50, feedback: 'ok', improvements: [], refinedPrompt: 'make it better' })
    expect(mapVideoEvaluatorResult(parsed, context, subject()).refinedPrompt).toBe('make it better')
    expect(mapVideoEvaluatorResult(parsed, context, subject({ sourceContext: {} })).refinedPrompt).toBeNull()
    expect(mapVideoEvaluatorResult(parsed, context, subject({ source: { kind: 'render_execution', id: ID }, sourceContext: {} })).refinedPrompt).toBeNull()
  })

  it('derives the assessment band from the score', () => {
    const at = (score: number) => mapVideoEvaluatorResult(parseVideoEvaluatorResponse({ score, feedback: 'f', improvements: [] }), context, subject()).overall.assessment
    expect([at(95), at(80), at(79), at(60), at(59), at(0)]).toEqual(['strong', 'strong', 'mixed', 'mixed', 'needs_revision', 'needs_revision'])
  })

  it('declares a structured-output hint with the shared envelope (a hint, never proof of validity)', () => {
    expect(VIDEO_EVALUATOR_RESPONSE_SCHEMA).toMatchObject({ type: 'object', required: ['score', 'feedback', 'improvements'] })
  })
})
