// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ChangePasswordForm, type ChangePasswordClient } from './change-password-form'

afterEach(cleanup)

function setup(error: object | null = null) {
  const updateUser = vi.fn(async () => ({ error }))
  render(<ChangePasswordForm createSupabase={() => ({ auth: { updateUser } }) as unknown as ChangePasswordClient} />)
  return updateUser
}

const fill = (password: string, confirmation: string) => {
  fireEvent.change(screen.getByLabelText('Nova senha'), { target: { value: password } })
  fireEvent.change(screen.getByLabelText('Confirmar nova senha'), { target: { value: confirmation } })
}
const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Alterar senha' }))

describe('Configurações > Perfil > Alterar senha', () => {
  it('is present and disabled until both fields are filled', () => {
    setup()
    expect(screen.getByRole('heading', { name: 'Alterar senha' })).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Alterar senha' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('rejects a mismatch and a too-short password without calling the API', async () => {
    const updateUser = setup()
    fill('senha-nova-1', 'outra-coisa')
    submit()
    expect((await screen.findByRole('alert')).textContent).toBe('As senhas não coincidem')
    fill('abc', 'abc')
    submit()
    expect((await screen.findByRole('alert')).textContent).toMatch(/pelo menos 6/)
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('changes the password through the authenticated user API and clears the fields', async () => {
    const updateUser = setup()
    fill('senha-nova-1', 'senha-nova-1')
    submit()
    expect(await screen.findByText('Senha alterada com sucesso.')).toBeTruthy()
    expect(updateUser).toHaveBeenCalledWith({ password: 'senha-nova-1' })
    expect((screen.getByLabelText('Nova senha') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('Confirmar nova senha') as HTMLInputElement).value).toBe('')
  })

  it('shows the server requirement truthfully (recent sign-in) instead of pretending success', async () => {
    setup({ code: 'reauthentication_needed', status: 401 })
    fill('senha-nova-1', 'senha-nova-1')
    submit()
    expect((await screen.findByRole('alert')).textContent).toMatch(/entrar novamente/)
    expect(screen.queryByText('Senha alterada com sucesso.')).toBeNull()
  })
})
