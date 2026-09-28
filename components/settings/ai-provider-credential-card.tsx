'use client'

// AI_PROVIDER_CREDENTIALS_BYOK_V1
//
// Shared "AI Providers" credential card used by Settings → API for every
// user-owned provider credential (OpenAI, NanoBanana, Kling, Replicate).
// The saved secret is never fetched, never prefilled, and never rendered —
// only a `configured` / `missing` status badge. Save/Replace always starts
// from an empty input; Remove clears the credential server-side.

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { StatusBadge } from '@/components/ui/status-badge'
import { Eye, EyeOff, KeyRound, Loader2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

export type AiProviderCredentialStatus = 'configured' | 'missing' | 'loading'

interface AiProviderCredentialCardProps {
  providerId: string
  title: string
  description: string
  status: AiProviderCredentialStatus
  placeholder?: string
  helpText?: string
  showBaseUrl?: boolean
  baseUrl?: string | null
  baseUrlPlaceholder?: string
  onSave: (apiKey: string, baseUrl?: string) => Promise<void>
  onRemove: () => Promise<void>
}

export function AiProviderCredentialCard({
  providerId,
  title,
  description,
  status,
  placeholder = 'sk-...',
  helpText,
  showBaseUrl = false,
  baseUrl,
  baseUrlPlaceholder,
  onSave,
  onRemove,
}: AiProviderCredentialCardProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [baseUrlDraft, setBaseUrlDraft] = useState(baseUrl || '')
  const [showKey, setShowKey] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isRemoving, setIsRemoving] = useState(false)

  const isConfigured = status === 'configured'

  const startEditing = () => {
    setApiKey('')
    setShowKey(false)
    setIsEditing(true)
  }

  const cancelEditing = () => {
    setApiKey('')
    setIsEditing(false)
  }

  const handleSave = async () => {
    if (!apiKey.trim()) return
    setIsSaving(true)
    try {
      await onSave(apiKey.trim(), showBaseUrl ? baseUrlDraft.trim() || undefined : undefined)
      setApiKey('')
      setIsEditing(false)
    } finally {
      setIsSaving(false)
    }
  }

  const handleRemove = async () => {
    setIsRemoving(true)
    try {
      await onRemove()
      setApiKey('')
      setIsEditing(false)
    } finally {
      setIsRemoving(false)
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-border/50 p-4" data-provider={providerId}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="font-medium">{title}</h4>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        {status === 'loading' ? (
          <StatusBadge label="Carregando..." tone="neutral" />
        ) : isConfigured ? (
          <StatusBadge label="Configurado ✓" tone="success" />
        ) : (
          <StatusBadge label="Não configurado" tone="unavailable" />
        )}
      </div>

      {!isEditing ? (
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={startEditing}>
            <KeyRound className="mr-2 h-3.5 w-3.5" />
            {isConfigured ? 'Substituir' : 'Configurar'}
          </Button>
          {isConfigured && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="ghost" size="sm" disabled={isRemoving}>
                  {isRemoving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Remover'}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remover credencial de {title}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    O provider ficará indisponível até que uma nova chave seja configurada.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={handleRemove}>Remover</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="space-y-1">
            <Label htmlFor={`${providerId}-api-key`}>API Key</Label>
            <div className="relative">
              <Input
                id={`${providerId}-api-key`}
                type={showKey ? 'text' : 'password'}
                placeholder={placeholder}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoComplete="off"
                className="bg-background/50 pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2"
                onClick={() => setShowKey(!showKey)}
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          {showBaseUrl && (
            <div className="space-y-1">
              <Label htmlFor={`${providerId}-base-url`}>Base URL (opcional)</Label>
              <Input
                id={`${providerId}-base-url`}
                type="text"
                placeholder={baseUrlPlaceholder}
                value={baseUrlDraft}
                onChange={(e) => setBaseUrlDraft(e.target.value)}
                className="bg-background/50"
              />
            </div>
          )}
          {helpText && <p className="text-xs text-muted-foreground">{helpText}</p>}
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={handleSave} disabled={isSaving || !apiKey.trim()}>
              {isSaving && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              Salvar
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={cancelEditing} disabled={isSaving}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
