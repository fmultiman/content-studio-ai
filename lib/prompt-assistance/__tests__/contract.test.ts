import { describe, expect, it } from 'vitest'
import { PromptAssistanceRequestSchema } from '../contract'

// FUTURE-057 Slice A — the optional `workflow` analytics label is validated and has no authority.

const base = {
  mediaType: 'image',
  operation: 'create',
  originalText: 'Uma montanha antiga',
  provider: 'openai',
  model: 'gpt-4o-mini',
}

describe('PromptAssistanceRequestSchema workflow label', () => {
  it.each([undefined, 'assisted', 'automatic'])('accepts %s', (workflow) => {
    expect(PromptAssistanceRequestSchema.safeParse({ ...base, ...(workflow ? { workflow } : {}) }).success).toBe(true)
  })

  it.each(['background', 'AUTOMATIC', '', 'manual', 1, null])('rejects the unknown label %j', (workflow) => {
    expect(PromptAssistanceRequestSchema.safeParse({ ...base, workflow }).success).toBe(false)
  })

  it('the automatic workflow only supports a single CREATE from the description (never an improve loop)', () => {
    expect(PromptAssistanceRequestSchema.safeParse({ ...base, operation: 'improve', currentText: 'x', workflow: 'automatic' }).success).toBe(false)
    expect(PromptAssistanceRequestSchema.safeParse({ ...base, operation: 'improve', currentText: 'x', workflow: 'assisted' }).success).toBe(true)
  })

  it('still rejects unknown fields (strict) — the label is not a way to smuggle provider, credential or authorization data', () => {
    expect(PromptAssistanceRequestSchema.safeParse({ ...base, workflow: 'automatic', apiKey: 'x' }).success).toBe(false)
    expect(PromptAssistanceRequestSchema.safeParse({ ...base, workflow: 'automatic', authorized: true }).success).toBe(false)
  })
})

describe('PromptAssistanceRequestSchema video', () => {
  const video = { ...base, mediaType: 'video', videoMode: 'text_to_video' }

  it.each(['text_to_video', 'image_to_video'])('accepts only the selected %s mode with the existing text operations', (videoMode) => {
    expect(PromptAssistanceRequestSchema.parse({ ...video, videoMode })).toEqual({ ...video, videoMode })
    expect(PromptAssistanceRequestSchema.safeParse({ ...video, videoMode, operation: 'improve', currentText: 'edited prompt' }).success).toBe(true)
  })

  it('applies the same closed workflow, provider and text bounds to video', () => {
    expect(PromptAssistanceRequestSchema.safeParse({ ...video, originalText: 'x'.repeat(12_000), model: 'm'.repeat(120) }).success).toBe(true)
    for (const overrides of [
      { originalText: ' ' }, { originalText: 'x'.repeat(12_001) }, { currentText: 'x'.repeat(12_001) },
      { model: '' }, { model: 'm'.repeat(121) }, { provider: 'kling' }, { workflow: 'manual' },
      { videoMode: undefined }, { videoMode: 'image' }, { mediaType: 'audio' },
    ]) {
      expect(PromptAssistanceRequestSchema.safeParse({ ...video, ...overrides }).success).toBe(false)
    }
  })
})
