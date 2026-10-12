// FUTURE-064 Slice B — provider-specific readiness and the grouped model options of /imagens. Pure, client-safe.
//
// "Ready" is decided PER PROVIDER. The historical rule "everything that is not OpenAI is NanoBanana" is gone: OpenAI,
// Google Gemini (official) and NanoBananaAPI.ai (third party) each have their own credential and, for Gemini, a
// server-derived availability that is independent of the credential. A disabled Google capability is reported as
// DISABLED, never as a missing key, and a configured Google key never implies the capability is available.
import {
  type GeminiImageAvailability,
  geminiImageAvailabilityMessage,
} from '@/lib/images/gemini-availability'
import { GEMINI_IMAGE_ALIASES } from '@/lib/providers/gemini/image-models'
import {
  IMAGE_MODEL_LABELS,
  IMAGE_PROVIDER_LABELS,
  NANOBANANA_IMAGE_MODELS,
  NANOBANANA_THIRD_PARTY_LABEL,
  OPENAI_IMAGE_MODELS,
  imageModelProvider,
  type ImageModel,
  type ImageProvider,
} from './image-models'

export type ImageReadinessCode =
  | 'model_unrecognized'
  | 'status_loading'
  | 'openai_not_configured'
  | 'nanobanana_not_configured'
  | 'gemini_requires_session'
  | 'gemini_capability_disabled'
  | 'gemini_capability_unknown'
  | 'gemini_not_configured'

export type ImageReadiness = { ready: true } | { ready: false; code: ImageReadinessCode; message: string }

export type ImageReadinessInput = {
  /** The model that would be submitted; `null` when the saved model is unrecognized and no explicit choice was made. */
  model: ImageModel | null
  unrecognizedModel?: string | null
  providerStatusLoaded: boolean
  openaiConfigured: boolean
  geminiConfigured: boolean
  nanobananaConfigured: boolean
  /** Server-derived; `null` = not (yet) known, which is treated as unavailable. */
  geminiImageAvailability: GeminiImageAvailability | null
  /** Google image generation is Session/Attempt based: it exists only in the canonical generation workspace. */
  canonicalWorkspace: boolean
}

const ready = (): ImageReadiness => ({ ready: true })
const blocked = (code: ImageReadinessCode, message: string): ImageReadiness => ({ ready: false, code, message })

export function evaluateImageReadiness(input: ImageReadinessInput): ImageReadiness {
  if (!input.model) {
    return blocked(
      'model_unrecognized',
      input.unrecognizedModel
        ? `O modelo de imagem salvo (“${input.unrecognizedModel}”) não é reconhecido. Selecione um modelo para continuar.`
        : 'Selecione um modelo de imagem para continuar.',
    )
  }
  if (!input.providerStatusLoaded) return blocked('status_loading', 'Verificando os provedores…')

  switch (imageModelProvider(input.model)) {
    case 'openai':
      return input.openaiConfigured ? ready() : blocked('openai_not_configured', 'Configure o provedor do modelo de imagem selecionado (OpenAI) em Configurações → API.')
    case 'nanobanana':
      return input.nanobananaConfigured
        ? ready()
        : blocked('nanobanana_not_configured', `Configure o provedor do modelo de imagem selecionado (${NANOBANANA_THIRD_PARTY_LABEL}) em Configurações → API.`)
    case 'gemini': {
      if (!input.canonicalWorkspace) {
        return blocked('gemini_requires_session', 'Os modelos Google Gemini estão disponíveis no workspace de geração (use “Nova Imagem”).')
      }
      const availability = input.geminiImageAvailability
      if (!availability) return blocked('gemini_capability_unknown', geminiImageAvailabilityMessage(null))
      // Capability first: a disabled route must never be reported as a missing credential.
      if (!availability.available) return blocked('gemini_capability_disabled', geminiImageAvailabilityMessage(availability))
      return input.geminiConfigured
        ? ready()
        : blocked('gemini_not_configured', 'Configure o provedor do modelo de imagem selecionado (chave do Google Gemini) em Configurações → API.')
    }
  }
}

export type ImageModelOption = { value: ImageModel; label: string; disabled: boolean }
export type ImageModelGroup = { provider: ImageProvider; label: string; options: ImageModelOption[]; note: string | null }

export type ImageModelGroupsInput = {
  selectedModel: ImageModel | null
  nanobananaConfigured: boolean
  /** Omit to leave Google models out entirely (callers that predate Slice B). */
  gemini?: { availability: GeminiImageAvailability | null; canonicalWorkspace: boolean }
}

/**
 * Grouped selector options. OpenAI is always listed (as before). Third-party NanoBananaAPI.ai is listed when its key
 * exists or when it is the current selection (so a saved legacy choice is still displayed). Google models are always
 * listed once the caller opts in, but DISABLED with an explanation unless the capability is available in this workspace.
 */
export function buildImageModelGroups(input: ImageModelGroupsInput): ImageModelGroup[] {
  const groups: ImageModelGroup[] = [
    {
      provider: 'openai',
      label: IMAGE_PROVIDER_LABELS.openai,
      options: OPENAI_IMAGE_MODELS.map((value) => ({ value, label: IMAGE_MODEL_LABELS[value], disabled: false })),
      note: null,
    },
  ]
  if (input.gemini) {
    const availability = input.gemini.availability
    const usable = Boolean(availability?.available) && input.gemini.canonicalWorkspace
    const note = usable
      ? null
      : !input.gemini.canonicalWorkspace
        ? 'Disponível no workspace de geração (use “Nova Imagem”).'
        : geminiImageAvailabilityMessage(availability)
    groups.push({
      provider: 'gemini',
      label: IMAGE_PROVIDER_LABELS.gemini,
      // The current selection is never disabled: that would make the Select display nothing for a value the user already holds.
      options: GEMINI_IMAGE_ALIASES.map((value) => ({ value, label: IMAGE_MODEL_LABELS[value], disabled: !usable && value !== input.selectedModel })),
      note,
    })
  }
  const showNano = input.nanobananaConfigured || (input.selectedModel !== null && imageModelProvider(input.selectedModel) === 'nanobanana')
  if (showNano) {
    groups.push({
      provider: 'nanobanana',
      label: IMAGE_PROVIDER_LABELS.nanobanana,
      options: NANOBANANA_IMAGE_MODELS.map((value) => ({ value, label: IMAGE_MODEL_LABELS[value], disabled: false })),
      note: null,
    })
  }
  return groups
}

/** Concise BYOK cost notice for official Google image generation. Makes no price claim and never states a free tier or $0. */
export const GEMINI_IMAGE_COST_NOTICE =
  'Os modelos oficiais do Google usam a sua chave Gemini (BYOK): cada geração de imagem pode gerar cobrança na sua conta Google. O custo estimado ainda não está disponível no Content Studio.'
