// GENERATION_PROMPT_MODES_LANGUAGE_UX_CONVERGENCE_V1 — client contract of the optional Portuguese reading view.
//
// The translation is a READ-ONLY view of the generation prompt. It is never sent to a provider, never replaces the
// prompt and is only requested by an explicit user action (it can cost the user's own OpenAI key — BYOK).

export const PROMPT_TRANSLATION_UNAVAILABLE = 'Tradução indisponível sem provedor configurado.'
export const PROMPT_TRANSLATION_COST_NOTICE =
  'A tradução usa a sua chave OpenAI (BYOK) e pode gerar cobrança. Ela é só para leitura: a geração continua usando o prompt original.'

export class PromptTranslationError extends Error {}

/** One explicit request to /api/prompts/translate. Resolves the translated text or throws a user-facing error. */
export async function requestPromptTranslation(prompt: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch('/api/prompts/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
    signal,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (data?.code === 'PROMPT_PROVIDER_NOT_CONFIGURED') throw new PromptTranslationError(PROMPT_TRANSLATION_UNAVAILABLE)
    throw new PromptTranslationError(typeof data?.error === 'string' && data.error ? data.error : 'Erro ao traduzir o prompt.')
  }
  const text = typeof data?.translatedPrompt === 'string' ? data.translatedPrompt.trim() : ''
  if (!text) throw new PromptTranslationError('O provedor não retornou uma tradução.')
  return text
}
