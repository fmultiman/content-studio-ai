// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { UpdatePasswordForm, type UpdatePasswordClient } from './update-password-form'

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))

afterEach(cleanup)

function client(overrides: { user?: unknown | null; getUserError?: object | null; updateError?: object | null } = {}) {
  const auth = {
    getUser: vi.fn(async () => ({ data: { user: 'user' in overrides ? overrides.user : { id: 'u1' } }, error: overrides.getUserError ?? null })),
    updateUser: vi.fn(async () => ({ error: overrides.updateError ?? null })),
    signOut: vi.fn(async () => ({ error: null })),
  }
  const instance = { auth } as unknown as UpdatePasswordClient
  return { auth, createSupabase: () => instance }
}

const fill = (password: string, confirmation: string) => {
  fireEvent.change(screen.getByLabelText('Nova senha'), { target: { value: password } })
  fireEvent.change(screen.getByLabelText('Confirmar nova senha'), { target: { value: confirmation } })
}

describe('UpdatePasswordForm', () => {
  it('a valid authenticated recovery state offers the form', async () => {
    const { createSupabase } = client()
    render(<UpdatePasswordForm createSupabase={createSupabase} />)
    expect(await screen.findByLabelText('Nova senha')).toBeTruthy()
    expect(screen.getByLabelText('Confirmar nova senha')).toBeTruthy()
  })

  it.each([
    ['no session', { user: null }],
    ['an auth error', { user: null, getUserError: { name: 'AuthSessionMissingError', status: 400 } }],
  ])('%s: the link is invalid/expired and NO form is offered', async (_label, overrides) => {
    const { auth, createSupabase } = client(overrides)
    render(<UpdatePasswordForm createSupabase={createSupabase} />)
    expect(await screen.findByText('Link inválido ou expirado')).toBeTruthy()
    expect(screen.queryByLabelText('Nova senha')).toBeNull()
    expect(screen.getByRole('link', { name: 'Solicitar novo link' }).getAttribute('href')).toBe('/auth/forgot-password')
    expect(auth.updateUser).not.toHaveBeenCalled()
  })

  it('rejects a mismatch without calling the API', async () => {
    const { auth, createSupabase } = client()
    render(<UpdatePasswordForm createSupabase={createSupabase} />)
    await screen.findByLabelText('Nova senha')
    fill('senha-nova-1', 'senha-nova-2')
    fireEvent.click(screen.getByRole('button', { name: 'Alterar senha' }))
    expect((await screen.findByRole('alert')).textContent).toBe('As senhas não coincidem')
    expect(auth.updateUser).not.toHaveBeenCalled()
  })

  it('updates through the user API, ends every session, and removes the form (no resubmission)', async () => {
    const { auth, createSupabase } = client()
    render(<UpdatePasswordForm createSupabase={createSupabase} />)
    await screen.findByLabelText('Nova senha')
    fill('senha-nova-1', 'senha-nova-1')
    fireEvent.click(screen.getByRole('button', { name: 'Alterar senha' }))

    expect(await screen.findByText('Senha alterada')).toBeTruthy()
    expect(auth.updateUser).toHaveBeenCalledTimes(1)
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'senha-nova-1' })
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'global' })
    expect(screen.queryByLabelText('Nova senha')).toBeNull()
    expect(screen.getByRole('link', { name: 'Ir para o login' }).getAttribute('href')).toBe('/login?password_reset=1')
  })

  it('keeps the form and shows a truthful message when the update is refused', async () => {
    const { auth, createSupabase } = client({ updateError: { code: 'same_password', status: 422 } })
    render(<UpdatePasswordForm createSupabase={createSupabase} />)
    await screen.findByLabelText('Nova senha')
    fill('senha-nova-1', 'senha-nova-1')
    fireEvent.click(screen.getByRole('button', { name: 'Alterar senha' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/diferente da senha atual/)
    expect(screen.getByLabelText('Nova senha')).toBeTruthy()
    expect(auth.signOut).not.toHaveBeenCalled()
  })

  it('an expired session at submit time falls back to the invalid-link state', async () => {
    const { createSupabase } = client({ updateError: { name: 'AuthSessionMissingError', status: 400 } })
    render(<UpdatePasswordForm createSupabase={createSupabase} />)
    await screen.findByLabelText('Nova senha')
    fill('senha-nova-1', 'senha-nova-1')
    fireEvent.click(screen.getByRole('button', { name: 'Alterar senha' }))
    await waitFor(() => expect(screen.getByText('Link inválido ou expirado')).toBeTruthy())
    expect(screen.queryByLabelText('Nova senha')).toBeNull()
  })
})
