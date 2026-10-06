import { describe, expect, it } from 'vitest'
import { mapImageEvaluatorResult, parseImageEvaluatorResponse } from '@/lib/reviews/adapters/image'

describe('Image Review adapter', () => {
  it('parses a valid evaluator result without an approval verdict', () => {
    const parsed = parseImageEvaluatorResponse({ score: 74, feedback: 'Needs stronger hierarchy.', improvements: ['Increase contrast'], refinedPrompt: 'A clearer composition.' })
    const result = mapImageEvaluatorResult(parsed, {
      schemaVersion: 1,
      capturedAt: '2026-01-01T00:00:00Z',
      project: { id: null, context: null, evaluationMode: 'default', identity: null },
      production: null,
    }, {
      attemptId: '00000000-0000-4000-8000-000000000001', outputId: '00000000-0000-4000-8000-000000000002', projectId: null, productionId: null,
      submittedPrompt: 'A landscape', provider: 'openai', model: 'gpt-image-2', submittedConfig: {}, sourceSnapshot: null,
      outputUrl: 'https://example.test/image.png', outputStoragePath: null, outputMetadata: {},
    })
    expect(result.overall.score).toBe(74)
    expect(result.overall.assessment).toBe('mixed')
    expect(result).not.toHaveProperty('approved')
  })

  it.each([
    [{ score: 101, feedback: 'x', improvements: [], refinedPrompt: null }],
    [{ score: 70, feedback: '', improvements: [], refinedPrompt: null }],
    [{ score: 70, feedback: 'x', improvements: ['ok'], refinedPrompt: 4 }],
    ['not-json-object'],
  ])('rejects malformed evaluator output', (value) => {
    expect(() => parseImageEvaluatorResponse(value)).toThrow()
  })
})
