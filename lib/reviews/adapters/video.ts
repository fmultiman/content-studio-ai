// GEMINI_VIDEO_REVIEW_ADAPTER_V1
//
// Video Review ADAPTER: owns what is asked of the evaluator and how its answer is
// validated. It owns no transport. Authentication, the Files API lifecycle, the
// model call and cleanup stay in the execution provider (lib/providers/gemini).
//
// What the adapter asks the provider to evaluate (the only things; nothing else is claimed):
//   visual_consistency      subject/style/identity consistency across the clip
//   composition_readability framing, hierarchy, readability of what is on screen
//   temporal_coherence      continuity of motion and scene changes over time
//   pacing                  only when it can be inferred from the footage
//   technical_defects       visible artifacts: flicker, warping, glitches, compression damage
//   text_caption_legibility only when text/captions are visible
//   brand_context_alignment only when server Project context/identity exists
//   prompt_adherence        only when the source carries a submitted generation prompt
//
// AUDIO IS NOT EVALUATED. The adapter instructs the evaluator to assess visuals only and
// never requests an audio criterion, so no audio claim can be recorded. (The uploaded file
// may contain an audio track; whether the provider uses it is unproven and out of scope.)
//
// The result is advisory: it never approves, blocks or mutates the video or its source.

import type { ReviewResultV1, VideoReviewContext, VideoReviewSubject, ReviewCriterionV1 } from '../contracts'
import { IMAGE_EVALUATOR_RESPONSE_SCHEMA, assessment, parseImageEvaluatorResponse } from './image'
import type { ImageEvaluatorParsed } from '../contracts'

export const VIDEO_REVIEW_ADAPTER_KEY = 'video'
export const VIDEO_REVIEW_ADAPTER_VERSION = 'video-review-v1'
export const VIDEO_EVALUATOR_PROMPT_VERSION = 'video-review-prompt-v1'

export const VIDEO_CRITERION_KEYS = [
  'visual_consistency',
  'composition_readability',
  'temporal_coherence',
  'pacing',
  'technical_defects',
  'text_caption_legibility',
  'brand_context_alignment',
  'prompt_adherence',
] as const

/**
 * Request-side structured-output hint. It has the same envelope as the Image Review (score, feedback,
 * improvements, refinedPrompt, summary, strengths, issues, recommendations, criteria). It is a hint only:
 * parseVideoEvaluatorResponse stays the authority.
 */
export const VIDEO_EVALUATOR_RESPONSE_SCHEMA: Record<string, unknown> = { ...IMAGE_EVALUATOR_RESPONSE_SCHEMA }

function formatDuration(ms: number | null) {
  return ms === null ? 'unknown' : `${(ms / 1000).toFixed(1)}s`
}

export function buildVideoEvaluationPrompt(context: VideoReviewContext, subject: VideoReviewSubject) {
  const identity = context.project.identity ? JSON.stringify(context.project.identity) : 'None'
  const submittedPrompt = typeof subject.sourceContext.submittedPrompt === 'string' && subject.sourceContext.submittedPrompt.trim()
    ? subject.sourceContext.submittedPrompt
    : null
  const dimensions = subject.media.width && subject.media.height ? `${subject.media.width}x${subject.media.height}` : 'unknown'
  return {
    system: [
      'You are an advisory video reviewer. Watch the attached video and review it against any provided intent and the server-authoritative project context.',
      'Evaluate the VISUALS only. Do not assess, describe or score audio, speech or music, and do not claim to have heard anything.',
      'Never output approval, rejection or publishing authority; your output is advice that a person may ignore.',
      'Return only JSON with score (0-100 integer), feedback, improvements, refinedPrompt, criteria, summary, strengths, issues, recommendations.',
      'Criteria keys you may use: visual_consistency, composition_readability, temporal_coherence, technical_defects always;',
      'pacing only when it can be inferred from the footage; text_caption_legibility only when text or captions are visible;',
      'brand_context_alignment only when project identity or context is provided; prompt_adherence only when a submitted prompt is provided.',
      'Each criterion must contain key, label, score, assessment, evidence, applicable. Set applicable=false (score may stay 0) for a criterion that does not apply; do not invent evidence.',
      'refinedPrompt must be null unless a submitted prompt is provided; when provided it is only a suggestion for a future generation.',
      'Ground every statement in what is visible in the video. If the video cannot support a judgement, use assessment "insufficient_evidence".',
    ].join(' '),
    input: [
      `SUBMITTED PROMPT:\n${submittedPrompt ?? 'None'}`,
      `PROJECT CONTEXT:\n${context.project.context ?? 'None'}`,
      `PROJECT IDENTITY:\n${identity}`,
      `PRODUCTION:\n${context.production ? JSON.stringify(context.production) : 'None'}`,
      `EVALUATION MODE:\n${context.project.evaluationMode ?? 'default'}`,
      `SOURCE:\n${JSON.stringify({ kind: subject.source.kind, ...subject.sourceContext, submittedPrompt: undefined })}`,
      `VIDEO FACTS (server-verified): duration ${formatDuration(subject.media.durationMs)}, dimensions ${dimensions}, mime ${subject.media.mimeType}.`,
      'The video is attached as media input.',
    ].join('\n\n'),
  }
}

/** Strict parse of the evaluator's JSON. The envelope is shared with Image; the provider's structured-output mode is never proof of validity. */
export function parseVideoEvaluatorResponse(raw: unknown): ImageEvaluatorParsed {
  return parseImageEvaluatorResponse(raw)
}

export function mapVideoEvaluatorResult(parsed: ImageEvaluatorParsed, context: VideoReviewContext, subject: VideoReviewSubject): ReviewResultV1 {
  const generic = (key: typeof VIDEO_CRITERION_KEYS[number], label: string): ReviewCriterionV1 => (
    { key, label, score: parsed.score, assessment: assessment(parsed.score), evidence: [parsed.feedback], applicable: true }
  )
  const criteria = parsed.criteria ?? [
    generic('visual_consistency', 'Consistência visual ao longo do vídeo'),
    generic('composition_readability', 'Composição e legibilidade visual'),
    generic('temporal_coherence', 'Coerência temporal e continuidade'),
    generic('technical_defects', 'Defeitos técnicos visíveis'),
  ]
  return {
    schemaVersion: 1,
    status: 'completed',
    adapter: { key: VIDEO_REVIEW_ADAPTER_KEY, version: VIDEO_REVIEW_ADAPTER_VERSION },
    overall: { score: parsed.score, assessment: assessment(parsed.score) },
    summary: parsed.summary ?? parsed.feedback,
    criteria,
    strengths: parsed.strengths ?? [],
    issues: parsed.issues ?? [],
    recommendations: parsed.recommendations ?? parsed.improvements,
    // A refinement is only meaningful when there was a prompt to refine; it stays advisory text.
    refinedPrompt: typeof subject.sourceContext.submittedPrompt === 'string' && subject.sourceContext.submittedPrompt.trim() ? parsed.refinedPrompt : null,
    adapterResult: {
      evaluationMode: context.project.evaluationMode ?? 'default',
      artifactId: subject.artifactId,
      sourceKind: subject.source.kind,
      durationMs: subject.media.durationMs,
      analyzed: 'visual_only',
    },
  }
}
