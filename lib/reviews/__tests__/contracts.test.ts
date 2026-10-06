import { describe, expect, it } from 'vitest'
import { ReviewRequestSchema, ReviewResultV1Schema } from '@/lib/reviews/contracts'

const valid = {
  schemaVersion: 1 as const,
  status: 'completed' as const,
  adapter: { key: 'image', version: 'image-review-v1' },
  overall: { score: 82, assessment: 'strong' as const },
  summary: 'Clear and coherent result.',
  criteria: [{ key: 'composition', label: 'Composition', score: 82, assessment: 'strong' as const, evidence: ['Good hierarchy'], applicable: true }],
  strengths: ['Hierarchy'],
  issues: [],
  recommendations: [],
  refinedPrompt: null,
  adapterResult: { evaluationMode: 'default' },
}

describe('Review contracts', () => {
  it('accepts a valid versioned result', () => {
    expect(ReviewResultV1Schema.parse(valid)).toEqual(valid)
  })

  it('rejects impossible score and approval-shaped fields', () => {
    expect(ReviewResultV1Schema.safeParse({ ...valid, overall: { score: 101, assessment: 'strong' } }).success).toBe(false)
    expect(ReviewResultV1Schema.safeParse({ ...valid, approved: true }).success).toBe(false)
  })

  it('accepts only the frozen identifier request', () => {
    const request = { attemptId: '00000000-0000-4000-8000-000000000001', clientRequestId: '00000000-0000-4000-8000-000000000002' }
    expect(ReviewRequestSchema.parse(request)).toEqual(request)
    expect(ReviewRequestSchema.safeParse({ ...request, identity: {} }).success).toBe(false)
  })
})
