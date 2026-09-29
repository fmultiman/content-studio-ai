// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const push = vi.fn()
const refresh = vi.fn()
let search = ''
const signInWithPassword = vi.fn()
const signUp = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
  useSearchParams: () => new URLSearchParams(search),
}))
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { signInWithPassword, signUp } }) }))

import LoginPage from '@/app/login/page'
import SignupPage from '@/app/signup/page'

beforeEach(() => {
  search = ''
  push.mockReset()
  refresh.mockReset()
  signInWithPassword.mockReset()
  signUp.mockReset()
})
afterEach(cleanup)

describe('Login', () => {
  it('exposes "Esqueci minha senha?" pointing at the recovery page', () => {
    render(<LoginPage />)
    expect(screen.getByRole('link', { name: 'Esqueci minha senha?' }).getAttribute('href')).toBe('/auth/forgot-password')
  })

  it('regression: email/password sign-in still goes to the dashboard', async () => {
    signInWithPassword.mockResolvedValue({ error: null })
    render(<LoginPage />)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@example.com' } })
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'segredo-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard'))
    expect(signInWithPassword).toHaveBeenCalledWith({ email: 'a@example.com', password: 'segredo-1' })
  })

  it('regression: a failed sign-in shows the error and does not navigate', async () => {
    signInWithPassword.mockResolvedValue({ error: new Error('Invalid login credentials') })
    render(<LoginPage />)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@example.com' } })
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'errada' } })
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByText('Invalid login credentials')).toBeTruthy()
    expect(push).not.toHaveBeenCalled()
  })

  it('confirms a completed password reset without hiding the form', () => {
    search = 'password_reset=1'
    render(<LoginPage />)
    expect(screen.getByRole('status').textContent).toBe('Senha alterada. Entre com a nova senha.')
    expect(screen.getByLabelText('Senha')).toBeTruthy()
  })
})

describe('Signup (regression)', () => {
  it('still rejects mismatched passwords and still sends the confirmation through /auth/callback', async () => {
    render(<SignupPage />)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'novo@example.com' } })
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'senha-nova-1' } })
    fireEvent.change(screen.getByLabelText('Confirmar senha'), { target: { value: 'senha-nova-2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }))
    expect(await screen.findByText('As senhas não coincidem')).toBeTruthy()
    expect(signUp).not.toHaveBeenCalled()

    signUp.mockResolvedValue({ error: null })
    fireEvent.change(screen.getByLabelText('Confirmar senha'), { target: { value: 'senha-nova-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }))
    await waitFor(() => expect(signUp).toHaveBeenCalledTimes(1))
    expect(signUp.mock.calls[0][0].options.emailRedirectTo).toMatch(/\/auth\/callback$/)
  })
})
