import type { ImageEvaluatorParsed, ImageReviewContext, ImageReviewSubject, ReviewCriterionV1, ReviewResultV1 } from '../contracts'
import { ReviewServiceError } from '../errors'

export const IMAGE_REVIEW_ADAPTER_KEY = 'image'
export const IMAGE_REVIEW_ADAPTER_VERSION = 'image-review-v1'
export const IMAGE_EVALUATOR_PROMPT_VERSION = 'image-review-prompt-v1'

/**
 * JSON-schema hint for providers that support structured output (Gemini). It is
 * a request-side hint only: parseImageEvaluatorResponse remains the authority.
 */
export const IMAGE_EVALUATOR_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    score: { type: 'integer', minimum: 0, maximum: 100 },
    feedback: { type: 'string' },
    improvements: { type: 'array', items: { type: 'string' } },
    refinedPrompt: { type: ['string', 'null'] },
    summary: { type: 'string' },
    strengths: { type: 'array', items: { type: 'string' } },
    issues: { type: 'array', items: { type: 'string' } },
    recommendations: { type: 'array', items: { type: 'string' } },
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          label: { type: 'string' },
          score: { type: 'integer', minimum: 0, maximum: 100 },
          assessment: { type: ['string', 'null'], enum: ['strong', 'mixed', 'needs_revision', 'insufficient_evidence', null] },
          evidence: { type: 'array', items: { type: 'string' } },
          applicable: { type: 'boolean' },
        },
        required: ['key', 'label', 'score', 'assessment', 'evidence', 'applicable'],
      },
    },
  },
  required: ['score', 'feedback', 'improvements'],
}

function assessment(score: number): NonNullable<ReviewCriterionV1['assessment']> {
  if (score >= 80) return 'strong'
  if (score >= 60) return 'mixed'
  return 'needs_revision'
}

export function buildImageEvaluationPrompt(context: ImageReviewContext, subject: ImageReviewSubject) {
  const identity = context.project.identity ? JSON.stringify(context.project.identity) : 'None'
  return {
    system: `You are an advisory image reviewer. Review the generated image against the submitted intent and server-authoritative project context. Never output approval or rejection authority. Return only JSON with score (0-100), feedback, improvements, refinedPrompt, criteria, summary, strengths, issues, recommendations. Criteria keys: prompt_adherence, identity_alignment when identity exists, composition, visual_quality, source_fidelity only when sourceSnapshot proves a reference, and text_legibility only when the prompt requests text. Each criterion must contain key, label, score, assessment, evidence, applicable.`,
    input: `SUBMITTED PROMPT:\n${subject.submittedPrompt}\n\nPROJECT CONTEXT:\n${context.project.context ?? 'None'}\n\nPROJECT IDENTITY:\n${identity}\n\nPRODUCTION:\n${context.production ? JSON.stringify(context.production) : 'None'}\n\nEVALUATION MODE:\n${context.project.evaluationMode ?? 'default'}\n\nOUTPUT MEDIA:\n${subject.outputUrl}`,
  }
}

export function parseImageEvaluatorResponse(raw: unknown): ImageEvaluatorParsed {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ReviewServiceError(502, 'REVIEW_INVALID_EVALUATOR_RESPONSE', 'Evaluator response was not an object.')
  }
  const value = raw as Record<string, unknown>
  const score = value.score
  const feedback = value.feedback
  const improvements = value.improvements
  if (typeof score !== 'number' || !Number.isInteger(score) || score < 0 || score > 100) {
    throw new ReviewServiceError(502, 'REVIEW_INVALID_EVALUATOR_RESPONSE', 'Evaluator score is invalid.')
  }
  if (typeof feedback !== 'string' || !feedback.trim() || !Array.isArray(improvements) || improvements.some((item) => typeof item !== 'string')) {
    throw new ReviewServiceError(502, 'REVIEW_INVALID_EVALUATOR_RESPONSE', 'Evaluator response is missing required fields.')
  }
  if (value.refinedPrompt !== null && value.refinedPrompt !== undefined && typeof value.refinedPrompt !== 'string') {
    throw new ReviewServiceError(502, 'REVIEW_INVALID_EVALUATOR_RESPONSE', 'Evaluator refinedPrompt is invalid.')
  }
  const criteria = value.criteria
  if (criteria !== undefined) {
    if (!Array.isArray(criteria)) throw new ReviewServiceError(502, 'REVIEW_INVALID_EVALUATOR_RESPONSE', 'Evaluator criteria is invalid.')
    for (const criterion of criteria) {
      if (!criterion || typeof criterion !== 'object') throw new ReviewServiceError(502, 'REVIEW_INVALID_EVALUATOR_RESPONSE', 'Evaluator criterion is invalid.')
      const c = criterion as Record<string, unknown>
      if (typeof c.key !== 'string' || typeof c.label !== 'string' || typeof c.score !== 'number' || !Number.isInteger(c.score) || c.score < 0 || c.score > 100 || !Array.isArray(c.evidence) || c.evidence.some((item) => typeof item !== 'string') || typeof c.applicable !== 'boolean') {
        throw new ReviewServiceError(502, 'REVIEW_INVALID_EVALUATOR_RESPONSE', 'Evaluator criterion is invalid.')
      }
      if (c.assessment !== null && c.assessment !== 'strong' && c.assessment !== 'mixed' && c.assessment !== 'needs_revision' && c.assessment !== 'insufficient_evidence') {
        throw new ReviewServiceError(502, 'REVIEW_INVALID_EVALUATOR_RESPONSE', 'Evaluator criterion assessment is invalid.')
      }
    }
  }
  return {
    score,
    feedback,
    improvements: improvements as string[],
    refinedPrompt: typeof value.refinedPrompt === 'string' ? value.refinedPrompt : null,
    criteria: criteria as ImageEvaluatorParsed['criteria'],
    summary: typeof value.summary === 'string' ? value.summary : feedback,
    strengths: Array.isArray(value.strengths) && value.strengths.every((v) => typeof v === 'string') ? value.strengths as string[] : [],
    issues: Array.isArray(value.issues) && value.issues.every((v) => typeof v === 'string') ? value.issues as string[] : improvements as string[],
    recommendations: Array.isArray(value.recommendations) && value.recommendations.every((v) => typeof v === 'string') ? value.recommendations as string[] : improvements as string[],
  }
}

export function mapImageEvaluatorResult(parsed: ImageEvaluatorParsed, context: ImageReviewContext, subject: ImageReviewSubject): ReviewResultV1 {
  const criteria = parsed.criteria ?? [
    { key: 'prompt_adherence', label: 'Aderência ao prompt e à intenção', score: parsed.score, assessment: assessment(parsed.score), evidence: [parsed.feedback], applicable: true },
    { key: 'composition', label: 'Composição, hierarquia e legibilidade visual', score: parsed.score, assessment: assessment(parsed.score), evidence: [parsed.feedback], applicable: true },
    { key: 'visual_quality', label: 'Qualidade visual e artefatos perceptíveis', score: parsed.score, assessment: assessment(parsed.score), evidence: [parsed.feedback], applicable: true },
  ]
  return {
    schemaVersion: 1,
    status: 'completed',
    adapter: { key: IMAGE_REVIEW_ADAPTER_KEY, version: IMAGE_REVIEW_ADAPTER_VERSION },
    overall: { score: parsed.score, assessment: assessment(parsed.score) },
    summary: parsed.summary ?? parsed.feedback,
    criteria,
    strengths: parsed.strengths ?? [],
    issues: parsed.issues ?? [],
    recommendations: parsed.recommendations ?? parsed.improvements,
    refinedPrompt: parsed.refinedPrompt,
    adapterResult: { evaluationMode: context.project.evaluationMode ?? 'default', outputId: subject.outputId },
  }
}
