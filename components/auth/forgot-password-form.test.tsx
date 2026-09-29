// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ForgotPasswordForm } from './forgot-password-form'

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))

const PROD_REDIRECT = 'https://content.multihuman.com.br/auth/callback?next=%2Fauth%2Fupdate-password'

beforeEach(() => vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://content.multihuman.com.br'))
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

function setup(result: { error: { status?: number; code?: string } | null } | Promise<never> = { error: null }, props: { invalidLink?: boolean } = {}) {
  const resetPasswordForEmail = vi.fn(() => (result instanceof Promise ? result : Promise.resolve(result)))
  render(<ForgotPasswordForm createSupabase={() => ({ auth: { resetPasswordForEmail } })} {...props} />)
  return resetPasswordForEmail
}

const submit = (email = 'pessoa@example.com') => {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } })
  fireEvent.click(screen.getByRole('button', { name: 'Enviar instruções' }))
}

describe('ForgotPasswordForm', () => {
  it('requests recovery through the normal user API with the explicit production redirect', async () => {
    const reset = setup()
    submit('  pessoa@example.com ')
    await waitFor(() => expect(reset).toHaveBeenCalledTimes(1))
    expect(reset).toHaveBeenCalledWith('pessoa@example.com', { redirectTo: PROD_REDIRECT })
    expect(PROD_REDIRECT).not.toMatch(/localhost/)
  })

  it('shows the same neutral confirmation, never revealing whether the account exists', async () => {
    setup()
    submit('quem-sabe@example.com')
    expect(await screen.findByText('Se houver uma conta com este email, enviaremos as instruções para redefinir a senha.')).toBeTruthy()
    expect(screen.queryByText(/não encontrad|não existe|cadastrad/i)).toBeNull()
    expect(screen.getByRole('link', { name: 'Voltar ao login' }).getAttribute('href')).toBe('/login')
  })

  it('reports a rate limit truthfully and lets the user retry later', async () => {
    setup({ error: { status: 429, code: 'over_email_send_rate_limit' } })
    submit()
    expect((await screen.findByRole('alert')).textContent).toMatch(/Muitas tentativas/)
    expect((screen.getByRole('button', { name: 'Enviar instruções' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows a generic error (no Supabase internals) when sending fails, including a thrown failure', async () => {
    setup({ error: { status: 500, code: 'unexpected_failure' } })
    submit()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/Não foi possível enviar/)
    expect(alert.textContent).not.toMatch(/unexpected_failure|500/)
  })

  it('does not double-submit while a request is in flight', async () => {
    let release: (value: { error: null }) => void = () => undefined
    const pending = new Promise<{ error: null }>((resolve) => { release = resolve })
    const reset = vi.fn(() => pending)
    render(<ForgotPasswordForm createSupabase={() => ({ auth: { resetPasswordForEmail: reset } })} />)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@example.com' } })
    const form = screen.getByRole('button', { name: 'Enviar instruções' }).closest('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(reset).toHaveBeenCalledTimes(1)
    expect((screen.getByRole('button', { name: /Enviando/ }) as HTMLButtonElement).disabled).toBe(true)
    release({ error: null })
    await screen.findByText(/Se houver uma conta/)
  })

  it('explains an invalid/expired link arriving from the callback', () => {
    setup({ error: null }, { invalidLink: true })
    expect(screen.getByRole('alert').textContent).toMatch(/inválido ou expirou/)
  })
})
