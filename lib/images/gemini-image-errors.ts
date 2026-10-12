// FUTURE-064 Slice B — maps the responses of POST /api/gemini/generate-image (Slice A contract) to what the user sees.
// Pure, client-safe. Distinguishes: capability disabled / environment blocked / credential missing / credential
// unreadable / credential rejected / quota / blocked content / provider failure. A disabled capability is NEVER
// described as a missing credential.

export type GeminiImageFailureKind =
  | 'capability_disabled'
  | 'environment_blocked'
  | 'credential_missing'
  | 'credential_unavailable'
  | 'credential_rejected'
  | 'rate_limited'
  | 'content_blocked'
  | 'invalid_model'
  | 'source_not_supported'
  | 'session'
  | 'conflict'
  | 'unauthenticated'
  | 'provider'
  | 'storage'
  | 'other'

export type GeminiImageFailure = {
  kind: GeminiImageFailureKind
  message: string
  /** True when the server proved the capability is off for this runtime, so the UI should stop offering Google models. */
  capabilityOff: boolean
}

const MESSAGES: Record<string, { kind: GeminiImageFailureKind; message: string }> = {
  GEMINI_IMAGE_MODEL_NOT_RELEASED: { kind: 'invalid_model', message: 'O modelo de imagem selecionado ainda não foi liberado. Selecione outro modelo; nenhuma cobrança foi iniciada.' },
  GEMINI_IMAGE_GENERATION_DISABLED: { kind: 'capability_disabled', message: 'A geração de imagem com o Google Gemini ainda não foi habilitada neste ambiente. Nenhuma cobrança foi iniciada.' },
  PROVIDER_EXECUTION_DISABLED_IN_ENVIRONMENT: { kind: 'environment_blocked', message: 'A geração com provedores externos está desativada neste ambiente (Preview/local). Nenhuma cobrança foi iniciada.' },
  PROVIDER_NOT_CONFIGURED: { kind: 'credential_missing', message: 'Configure a chave do Google Gemini em Configurações → API.' },
  PROVIDER_CREDENTIAL_UNAVAILABLE: { kind: 'credential_unavailable', message: 'Não foi possível ler suas credenciais agora. Tente novamente em instantes.' },
  PROVIDER_CREDENTIAL_REJECTED: { kind: 'credential_rejected', message: 'O Google Gemini recusou a chave configurada. Verifique a chave em Configurações → API.' },
  PROVIDER_RATE_LIMITED: { kind: 'rate_limited', message: 'Limite ou cota do Google Gemini atingido. Tente novamente mais tarde.' },
  PROVIDER_CONTENT_BLOCKED: { kind: 'content_blocked', message: 'O Google Gemini bloqueou este conteúdo. Ajuste o prompt e tente novamente.' },
  INVALID_IMAGE_MODEL: { kind: 'invalid_model', message: 'O servidor não aceitou o modelo de imagem selecionado. Escolha outro modelo.' },
  SOURCE_NOT_SUPPORTED: { kind: 'source_not_supported', message: 'Os modelos Google ainda não aceitam imagens de referência.' },
  UNSUPPORTED_FIELD: { kind: 'other', message: 'O servidor recusou um parâmetro do pedido.' },
  SESSION_NOT_FOUND: { kind: 'session', message: 'Geração não encontrada. Recarregue o workspace.' },
  PROJECT_NOT_FOUND: { kind: 'session', message: 'Project indisponível para esta geração.' },
  PRODUCTION_NOT_FOUND: { kind: 'session', message: 'Production indisponível para esta geração.' },
  IDEMPOTENCY_CONFLICT: { kind: 'conflict', message: 'Este pedido já foi usado com outros parâmetros. Tente novamente.' },
  PROVIDER_TIMEOUT: { kind: 'provider', message: 'O Google Gemini demorou demais para responder. Verifique o histórico antes de tentar de novo: a cobrança pode ter ocorrido.' },
  PROVIDER_UNAVAILABLE: { kind: 'provider', message: 'Não foi possível concluir a geração no Google Gemini. A cobrança pode ter ocorrido; verifique o histórico antes de tentar de novo.' },
  PROVIDER_MODEL_UNAVAILABLE: { kind: 'provider', message: 'O modelo do Google Gemini não está disponível agora.' },
  PROVIDER_ERROR: { kind: 'provider', message: 'O Google Gemini rejeitou o pedido.' },
  EMPTY_PROVIDER_RESULT: { kind: 'provider', message: 'O Google Gemini não retornou uma imagem.' },
  INVALID_PROVIDER_RESPONSE: { kind: 'provider', message: 'O Google Gemini retornou uma resposta inválida.' },
  STORAGE_UNAVAILABLE: { kind: 'storage', message: 'A imagem foi gerada, mas o armazenamento está indisponível. A cobrança pode ter ocorrido.' },
  OUTPUT_SAVE_FAILED: { kind: 'storage', message: 'A imagem foi gerada, mas não foi possível salvá-la. A cobrança pode ter ocorrido.' },
}

/** `body` is the parsed JSON error payload (may be anything); `status` the HTTP status. */
export function describeGeminiImageFailure(status: number, body: unknown): GeminiImageFailure {
  const code = body && typeof body === 'object' && typeof (body as { code?: unknown }).code === 'string' ? (body as { code: string }).code : null
  const known = code && Object.prototype.hasOwnProperty.call(MESSAGES, code) ? MESSAGES[code] : null
  if (known) {
    return { ...known, capabilityOff: known.kind === 'capability_disabled' || known.kind === 'environment_blocked' }
  }
  if (status === 401) return { kind: 'unauthenticated', message: 'Sua sessão expirou. Entre novamente.', capabilityOff: false }
  if (status === 429) return { kind: 'rate_limited', message: MESSAGES.PROVIDER_RATE_LIMITED.message, capabilityOff: false }
  return { kind: 'other', message: 'Não foi possível gerar a imagem com o Google Gemini.', capabilityOff: false }
}

/** What a 200 replay of an earlier request id means (the server never spends again for a replay). */
export type GeminiReplayOutcome =
  | { kind: 'image'; imageUrl: string }
  | { kind: 'failed'; message: string }
  | { kind: 'in_progress'; message: string }

export function interpretGeminiReplay(body: { replayed?: unknown; status?: unknown; imageUrl?: unknown; image?: unknown }): GeminiReplayOutcome {
  if (body.status === 'succeeded' && typeof body.imageUrl === 'string' && body.imageUrl && body.image) {
    return { kind: 'image', imageUrl: body.imageUrl }
  }
  if (body.status === 'failed') {
    return { kind: 'failed', message: 'A tentativa anterior falhou e nenhuma nova cobrança foi feita. Clique em “Criar Imagem” para tentar novamente.' }
  }
  return { kind: 'in_progress', message: 'Esta geração ainda está em andamento ou foi interrompida. Aguarde ou verifique o histórico antes de tentar novamente.' }
}
