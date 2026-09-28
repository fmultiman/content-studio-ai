// @vitest-environment jsdom
/**
 * AI_PROVIDER_CREDENTIALS_EXECUTION_MODES_V1 — the Settings provider card is
 * status-only: it never receives, prefills, or retains a saved secret.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AiProviderCredentialCard } from './ai-provider-credential-card'

afterEach(cleanup)

function renderCard(status: 'configured' | 'missing', handlers: { onSave?: any; onRemove?: any } = {}) {
  const onSave = handlers.onSave ?? vi.fn().mockResolvedValue(undefined)
  const onRemove = handlers.onRemove ?? vi.fn().mockResolvedValue(undefined)
  render(
    <AiProviderCredentialCard
      providerId="kling"
      title="Kling"
      description="Geração de vídeo"
      status={status}
      onSave={onSave}
      onRemove={onRemove}
    />,
  )
  return { onSave, onRemove }
}

describe('AiProviderCredentialCard', () => {
  it('a configured provider shows only a status badge — no input, no secret', () => {
    renderCard('configured')
    expect(screen.getByText('Configurado ✓')).toBeTruthy()
    expect(document.querySelector('input')).toBeNull()
    expect(screen.getByRole('button', { name: 'Substituir' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remover' })).toBeTruthy()
  })

  it('a missing provider offers Configurar and no Remover', () => {
    renderCard('missing')
    expect(screen.getByText('Não configurado')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Configurar' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Remover' })).toBeNull()
  })

  it('Substituir opens an EMPTY password input (never prefilled)', () => {
    renderCard('configured')
    fireEvent.click(screen.getByRole('button', { name: 'Substituir' }))
    const input = document.querySelector('input') as HTMLInputElement
    expect(input).toBeTruthy()
    expect(input.value).toBe('')
    expect(input.type).toBe('password')
    expect(input.autocomplete).toBe('off')
  })

  it('saving sends the typed value once and clears it from the UI afterwards', async () => {
    const { onSave } = renderCard('missing')
    fireEvent.click(screen.getByRole('button', { name: 'Configurar' }))
    const input = document.querySelector('input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'typed-secret-value' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledWith('typed-secret-value', undefined))
    await waitFor(() => expect(document.querySelector('input')).toBeNull())
    expect(document.body.innerHTML).not.toContain('typed-secret-value')

    fireEvent.click(screen.getByRole('button', { name: 'Configurar' }))
    expect((document.querySelector('input') as HTMLInputElement).value).toBe('')
  })

  it('cancelling discards the typed value', () => {
    renderCard('missing')
    fireEvent.click(screen.getByRole('button', { name: 'Configurar' }))
    fireEvent.change(document.querySelector('input') as HTMLInputElement, { target: { value: 'half-typed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(document.body.innerHTML).not.toContain('half-typed')
    fireEvent.click(screen.getByRole('button', { name: 'Configurar' }))
    expect((document.querySelector('input') as HTMLInputElement).value).toBe('')
  })

  it('does not accept a secret through its props (status-only contract)', () => {
    const source = String(AiProviderCredentialCard)
    expect(source).not.toMatch(/initialSecret|savedKey|secretValue|defaultApiKey/)
  })
})
