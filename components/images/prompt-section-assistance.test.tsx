// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PromptSection } from './prompt-section'

const base = {
  generatedPrompt: '',
  setGeneratedPrompt: vi.fn(),
  suggestedPrompt: 'A refined editorial river cover.',
  suggestedOperation: 'improve' as const,
  onApplySuggestion: vi.fn(),
  onDiscardSuggestion: vi.fn(),
  promptDetails: null,
  onCreateImage: vi.fn(),
  isCreatingImage: false,
}

afterEach(() => cleanup())

describe('PromptSection AI assistance suggestion', () => {
  it('shows a non-authoritative suggestion with Apply and Discard', () => {
    render(<PromptSection {...base} />)
    expect(screen.getByTestId('prompt-assistance-suggestion')).toBeTruthy()
    expect(screen.getByDisplayValue('A refined editorial river cover.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Aplicar' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Descartar' })).toBeTruthy()
    // Generation is a separate explicit action: with no prompt in the editor the button is disabled.
    expect((screen.getByRole('button', { name: /Criar Imagem/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('delegates Apply and Discard without changing authored state itself', () => {
    const onApplySuggestion = vi.fn()
    const onDiscardSuggestion = vi.fn()
    render(<PromptSection {...base} onApplySuggestion={onApplySuggestion} onDiscardSuggestion={onDiscardSuggestion} />)
    fireEvent.click(screen.getByTestId('prompt-assistance-apply'))
    fireEvent.click(screen.getByTestId('prompt-assistance-discard'))
    expect(onApplySuggestion).toHaveBeenCalledTimes(1)
    expect(onDiscardSuggestion).toHaveBeenCalledTimes(1)
    expect(base.setGeneratedPrompt).not.toHaveBeenCalled()
  })
})
