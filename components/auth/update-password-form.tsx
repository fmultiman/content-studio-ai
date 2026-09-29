'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Check, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FORGOT_PASSWORD_PATH, passwordUpdateErrorMessage, validateNewPassword } from '@/lib/auth/recovery'
import { AuthShell } from './auth-shell'

type Phase = 'checking' | 'invalid' | 'ready' | 'saving' | 'done'
type AuthError = { status?: number; code?: string; name?: string } | null

export type UpdatePasswordClient = {
  auth: {
    getUser: () => Promise<{ data: { user: unknown | null }; error: AuthError }>
    updateUser: (attributes: { password: string }) => Promise<{ error: AuthError }>
    signOut: (options?: { scope?: 'global' | 'local' | 'others' }) => Promise<{ error: AuthError }>
  }
}

/**
 * Landing page of the recovery email (after /auth/callback established the
 * session through the PKCE code exchange). The form is only offered when the
 * server confirms a real authenticated user; otherwise the link is treated as
 * invalid/expired. Once the password is changed the form is gone (no
 * resubmission) and every session of the account is ended, so the user proves
 * the new password by signing in again.
 */
export function UpdatePasswordForm({ createSupabase = createClient as unknown as () => UpdatePasswordClient }: { createSupabase?: () => UpdatePasswordClient }) {
  const [phase, setPhase] = useState<Phase>('checking')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    createSupabase().auth
      .getUser()
      .then(({ data, error: userError }) => {
        if (!active) return
        setPhase(!userError && data.user ? 'ready' : 'invalid')
      })
      .catch(() => {
        if (active) setPhase('invalid')
      })
    return () => {
      active = false
    }
  }, [createSupabase])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (phase !== 'ready') return // no duplicate / out-of-state submissions

    const validation = validateNewPassword(password, confirmation)
    if (validation) {
      setError(validation)
      return
    }

    setPhase('saving')
    setError(null)
    try {
      const supabase = createSupabase()
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) {
        setError(passwordUpdateErrorMessage(updateError))
        setPhase(updateError.code === 'session_not_found' || updateError.name === 'AuthSessionMissingError' ? 'invalid' : 'ready')
        return
      }
      // A reset can follow a suspected compromise: end every session of the account.
      await supabase.auth.signOut({ scope: 'global' }).catch(() => undefined)
      setPassword('')
      setConfirmation('')
      setPhase('done')
    } catch {
      setError(passwordUpdateErrorMessage(null))
      setPhase('ready')
    }
  }

  if (phase === 'checking') {
    return (
      <AuthShell title="Redefinir senha">
        <div className="flex justify-center py-4" role="status" aria-label="Verificando link">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AuthShell>
    )
  }

  if (phase === 'invalid') {
    return (
      <AuthShell title="Link inválido ou expirado">
        <div className="flex flex-col gap-6 text-center">
          <p className="text-sm text-muted-foreground" role="alert">
            {error ?? 'Este link de redefinição não é mais válido. Solicite um novo para continuar.'}
          </p>
          <Link href={FORGOT_PASSWORD_PATH} className="text-sm text-violet-400 underline underline-offset-4 hover:text-violet-300">
            Solicitar novo link
          </Link>
        </div>
      </AuthShell>
    )
  }

  if (phase === 'done') {
    return (
      <AuthShell title="Senha alterada">
        <div className="flex flex-col items-center gap-6 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-violet-600 to-cyan-500">
            <Check className="h-8 w-8 text-white" />
          </div>
          <p className="text-sm text-muted-foreground" role="status">
            Sua senha foi alterada e todas as sessões foram encerradas. Entre com a nova senha.
          </p>
          <Button asChild className="w-full bg-gradient-to-r from-violet-600 to-cyan-500 text-white hover:from-violet-700 hover:to-cyan-600">
            <Link href="/login?password_reset=1">Ir para o login</Link>
          </Button>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Redefinir senha" description="Escolha uma nova senha para sua conta">
      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <div className="grid gap-2">
          <Label htmlFor="new-password">Nova senha</Label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="bg-background/50"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="confirm-new-password">Confirmar nova senha</Label>
          <Input
            id="confirm-new-password"
            type="password"
            autoComplete="new-password"
            required
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            className="bg-background/50"
          />
        </div>
        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        <Button
          type="submit"
          className="w-full bg-gradient-to-r from-violet-600 to-cyan-500 text-white hover:from-violet-700 hover:to-cyan-600"
          disabled={phase === 'saving'}
        >
          {phase === 'saving' ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Salvando...
            </>
          ) : (
            'Alterar senha'
          )}
        </Button>
      </form>
    </AuthShell>
  )
}
