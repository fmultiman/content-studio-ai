import { NextRequest, NextResponse } from 'next/server'
import { providerExecutionBlockedResponse } from '@/lib/providers/execution-policy-http'
import { createClient } from '@/lib/supabase/server'
import { generateImagePrompt, PromptGenerationError } from '@/lib/ai-simulator'
import { resolveProviderExecution } from '@/lib/credentials/provider-execution'
import type { ProjectIdentity } from '@/lib/schemas/project-identity'

// AI_PROVIDER_CREDENTIALS_BYOK_V1
//
// Moves OpenAI prompt-generation execution server-side. Previously the
// browser called `generateImagePrompt()` directly from `/imagens`, which
// sent the user's plaintext OpenAI key straight from client JS to
// `api.openai.com` — fully visible in devtools/network. This route
// resolves the credential server-side and never sends it to, or accepts
// it from, the browser.
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })
    }

    // FUTURE-050: paid provider execution is denied outside Production (and unopted local) — before any input is processed or credential read.
    const blocked = providerExecutionBlockedResponse({ provider: 'openai', operation: 'text_generation' })
    if (blocked) return blocked

    const body = await request.json().catch(() => ({}))
    const userInput = typeof body?.userInput === 'string' ? body.userInput : ''
    const projectContext = typeof body?.projectContext === 'string' ? body.projectContext : null
    const evaluationMode = body?.evaluationMode || 'default'
    const identity = (body?.identity ?? null) as ProjectIdentity | null

    if (!userInput.trim()) {
      return NextResponse.json({ error: 'userInput obrigatorio' }, { status: 400 })
    }

    const execution = await resolveProviderExecution(supabase, { userId: user.id, provider: 'openai' })

    if (execution.status !== 'ready') {
      return NextResponse.json(
        {
          error: 'PROMPT_PROVIDER_NOT_CONFIGURED',
          code: 'PROMPT_PROVIDER_NOT_CONFIGURED',
          providerCode: execution.code,
          provider: 'openai',
          message:
            'A geração de prompts precisa de um provedor de IA configurado. Configure sua chave da OpenAI em Configurações e tente novamente.',
        },
        { status: 400 },
      )
    }

    try {
      const result = await generateImagePrompt(
        userInput,
        projectContext,
        execution.secret,
        evaluationMode,
        identity,
      )
      return NextResponse.json(result)
    } catch (err) {
      if (err instanceof PromptGenerationError) {
        return NextResponse.json(
          { error: err.code, code: err.code, message: err.message },
          { status: err.status && err.status >= 400 && err.status < 600 ? err.status : 502 },
        )
      }
      throw err
    }
  } catch (error) {
    console.error('[Generate Image Prompt] Error:', error)
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Erro interno' }, { status: 500 })
  }
}
