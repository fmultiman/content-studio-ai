// GEMINI_REVIEW_PROVIDER_FOUNDATION_V1
//
// OpenAI Chat Completions adapted to the shared Review execution-provider
// boundary. The outbound request is the one the Image Review has always sent
// (json_object response format, low-detail image, 1400 max tokens); only its
// location moved out of the Review service.

import { assertProviderExecutionAllowed } from '@/lib/providers/execution-policy'
import {
  ReviewProviderError,
  assertMediaSupported,
  type ReviewExecutionProvider,
  type ReviewExecutionRequest,
  type ReviewExecutionResponse,
} from '../execution-provider'

export const OPENAI_REVIEW_DEFAULT_TIMEOUT_MS = 60_000
export const OPENAI_REVIEW_DEFAULT_MODEL = 'gpt-4o-mini'

export function resolveOpenAiReviewModel() {
  return process.env.OPENAI_EVALUATION_MODEL || OPENAI_REVIEW_DEFAULT_MODEL
}

async function mediaUrl(media: ReviewExecutionRequest['media'][number]) {
  if (media.url) return media.url
  const bytes = await media.load()
  return `data:${media.mimeType};base64,${Buffer.from(bytes).toString('base64')}`
}

export function createOpenAiReviewProvider(options: { fetchImpl?: typeof fetch } = {}): ReviewExecutionProvider {
  const fetchImpl = options.fetchImpl ?? fetch
  return {
    providerId: 'openai',
    capabilities: new Set(['image_review'] as const),
    async execute(request: ReviewExecutionRequest): Promise<ReviewExecutionResponse> {
      // FUTURE-050 outbound-boundary backstop.
      assertProviderExecutionAllowed({ provider: 'openai', operation: 'image_review' })
      assertMediaSupported(this, request.media)
      const content: Array<Record<string, unknown>> = [{ type: 'text', text: request.input }]
      for (const media of request.media) {
        content.push({ type: 'image_url', image_url: { url: await mediaUrl(media), detail: 'low' } })
      }
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), request.timeoutMs ?? OPENAI_REVIEW_DEFAULT_TIMEOUT_MS)
      let response: Response
      try {
        response = await fetchImpl('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${request.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: request.model,
            messages: [
              { role: 'system', content: request.instructions },
              { role: 'user', content },
            ],
            response_format: { type: 'json_object' },
            max_tokens: 1400,
          }),
          signal: controller.signal,
        })
      } catch (error) {
        if ((error as { name?: string })?.name === 'AbortError') throw new ReviewProviderError('timeout', 'OpenAI Review request timed out.')
        throw new ReviewProviderError('provider_server_error', 'OpenAI Review request failed.')
      } finally {
        clearTimeout(timer)
      }
      const data = await response.json().catch(() => ({})) as Record<string, any>
      if (!response.ok) {
        const kind = response.status === 401 || response.status === 403 ? 'invalid_credential' : response.status >= 500 ? 'provider_server_error' : 'provider_client_error'
        throw new ReviewProviderError(kind, 'Image evaluator provider failed.', response.status)
      }
      const rawText = data.choices?.[0]?.message?.content
      if (typeof rawText !== 'string' || !rawText.trim()) throw new ReviewProviderError('invalid_response', 'Image evaluator returned no result.')
      return {
        rawText,
        providerId: 'openai',
        model: request.model,
        providerRequestId: typeof data.id === 'string' ? data.id : undefined,
        usage: data.usage && typeof data.usage === 'object' ? data.usage : undefined,
        warnings: [],
      }
    },
  }
}
