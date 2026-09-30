// @vitest-environment jsdom
/**
 * STATIC_TEMPLATE_LAYOUT_SWITCH_STATE_TRUTH_V1 — the destructive-switch confirmation.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LayoutSwitchDialog } from './layout-switch-dialog'

afterEach(cleanup)

describe('LayoutSwitchDialog', () => {
  it('renders nothing while no switch is waiting', () => {
    render(<LayoutSwitchDialog layoutLabel={null} onCancel={vi.fn()} onConfirm={vi.fn()} />)
    expect(screen.queryByTestId('layout-switch-dialog')).toBeNull()
  })

  it('names the target and states what is replaced and what is kept', () => {
    render(<LayoutSwitchDialog layoutLabel="Info" onCancel={vi.fn()} onConfirm={vi.fn()} />)
    expect(screen.getByRole('alertdialog').textContent).toContain('Trocar o layout para Info?')
    expect(screen.getByRole('alertdialog').textContent).toContain('Trocar o layout substituirá o conteúdo e os ajustes específicos do layout atual.')
    expect(screen.getByRole('alertdialog').textContent).toContain('elementos adicionados')
  })

  it('12. Cancelar performs nothing and reports cancel only', () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    render(<LayoutSwitchDialog layoutLabel="Info" onCancel={onCancel} onConfirm={onConfirm} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalled()
  })

  it('13. Trocar layout confirms exactly once', () => {
    const onConfirm = vi.fn()
    render(<LayoutSwitchDialog layoutLabel="Info" onCancel={vi.fn()} onConfirm={onConfirm} />)
    fireEvent.click(screen.getByRole('button', { name: 'Trocar layout' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})
