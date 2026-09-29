'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { passwordUpdateErrorMessage, validateNewPassword } from '@/lib/auth/recovery'

type AuthError = { status?: number; code?: string; name?: string } | null
export type ChangePasswordClient = { auth: { updateUser: (attributes: { password: string }) => Promise<{ error: AuthError }> } }

/**
 * Configurações > Perfil > Alterar senha. Uses the normal authenticated user
 * API (`updateUser`) for the signed-in user only; if the project requires a
 * recent sign-in for password changes, that server response is shown truthfully.
 */
export function ChangePasswordForm({ createSupabase = createClient as unknown as () => ChangePasswordClient }: { createSupabase?: () => ChangePasswordClient }) {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (saving) return
    setSuccess(false)

    const validation = validateNewPassword(password, confirmation)
    if (validation) {
      setError(validation)
      return
    }

    setSaving(true)
    setError(null)
    try {
      const { error: updateError } = await createSupabase().auth.updateUser({ password })
      if (updateError) {
        setError(passwordUpdateErrorMessage(updateError))
      } else {
        setPassword('')
        setConfirmation('')
        setSuccess(true)
      }
    } catch {
      setError(passwordUpdateErrorMessage(null))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" data-testid="change-password-form">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">Alterar senha</h3>
        <p className="text-xs text-muted-foreground">Defina uma nova senha para entrar na sua conta.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="settings-new-password">Nova senha</Label>
        <Input
          id="settings-new-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="bg-background/50"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="settings-confirm-password">Confirmar nova senha</Label>
        <Input
          id="settings-confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          className="bg-background/50"
        />
      </div>
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      {success ? <p className="text-sm text-emerald-500" role="status">Senha alterada com sucesso.</p> : null}
      <Button type="submit" disabled={saving || !password || !confirmation}>
        {saving ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Salvando...
          </>
        ) : (
          'Alterar senha'
        )}
      </Button>
    </form>
  )
}
