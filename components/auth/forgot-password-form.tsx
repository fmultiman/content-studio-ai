'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  RECOVERY_NEUTRAL_SUCCESS,
  buildRecoveryRedirectUrl,
  classifyRecoveryRequest,
  recoveryOutcomeMessage,
} from '@/lib/auth/recovery'
import { AuthShell } from './auth-shell'

type Phase = 'idle' | 'loading' | 'sent'

type RecoveryClient = {
  auth: { resetPasswordForEmail: (email: string, options: { redirectTo: string }) => Promise<{ error: { status?: number; code?: string } | null }> }
}

export function ForgotPasswordForm({ invalidLink = false, createSupabase = createClient as () => RecoveryClient }: { invalidLink?: boolean; createSupabase?: () => RecoveryClient }) {
  const [email, setEmail] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (phase === 'loading') return // no duplicate submissions
    setPhase('loading')
    setError(null)

    try {
      // Normal end-user recovery API; the redirect is an explicit, canonical
      // production URL (never a Host header, never the Supabase Site URL fallback).
      const { error: requestError } = await createSupabase().auth.resetPasswordForEmail(email.trim(), {
        redirectTo: buildRecoveryRedirectUrl(),
      })
      const outcome = classifyRecoveryRequest(requestError)
      if (outcome === 'sent') {
        setPhase('sent')
        return
      }
      setError(recoveryOutcomeMessage(outcome))
    } catch {
      setError(recoveryOutcomeMessage('failed'))
    }
    setPhase('idle')
  }

  if (phase === 'sent') {
    return (
      <AuthShell title="Verifique seu email">
        <div className="flex flex-col gap-6 text-center">
          <p className="text-sm text-muted-foreground" role="status">{RECOVERY_NEUTRAL_SUCCESS}</p>
          <Link href="/login" className="text-sm text-violet-400 underline underline-offset-4 hover:text-violet-300">
            Voltar ao login
          </Link>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Esqueci minha senha" description="Informe seu email para receber as instruções de redefinição">
      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        {invalidLink ? (
          <p className="text-sm text-destructive" role="alert">
            Este link de redefinição é inválido ou expirou. Solicite um novo abaixo.
          </p>
        ) : null}
        <div className="grid gap-2">
          <Label htmlFor="recovery-email">Email</Label>
          <Input
            id="recovery-email"
            type="email"
            placeholder="seu@email.com"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="bg-background/50"
          />
        </div>
        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        <Button
          type="submit"
          className="w-full bg-gradient-to-r from-violet-600 to-cyan-500 text-white hover:from-violet-700 hover:to-cyan-600"
          disabled={phase === 'loading'}
        >
          {phase === 'loading' ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Enviando...
            </>
          ) : (
            'Enviar instruções'
          )}
        </Button>
        <div className="text-center text-sm text-muted-foreground">
          <Link href="/login" className="text-violet-400 underline underline-offset-4 hover:text-violet-300">
            Voltar ao login
          </Link>
        </div>
      </form>
    </AuthShell>
  )
}
