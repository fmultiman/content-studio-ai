import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceRoleSupabase } from '@/lib/supabase/service-role'
import { resolveProviderExecution } from '@/lib/credentials/provider-execution'
import { queryNanoBananaTask } from '@/lib/providers/nanobanana/task-details'
import { NANOBANANA_RESULT_IMAGE_POLICY, RemoteImageError, parseRemoteImageUrl } from '@/lib/security/safe-remote-image'

// NANOBANANA_CALLBACK_AUTHENTICATION_V1
//
// This endpoint is PUBLIC and the official Nano Banana callback is UNSIGNED: there is no signature,
// secret or header to verify (docs.nanobananaapi.ai). So nothing in the request body is trusted.
//
//   untrusted callback  ->  only `data.taskId` is read (to find a task that is STILL `processing`)
//                       ->  the provider is asked directly (Get Task Details, with the task OWNER's
//                           own BYOK credential, resolved server-side)
//                       ->  the provider's answer, bound to that exact task id, is the only authority
//                           for status / image_url / failure text.
//
// What the body claims (status code, resultImageUrl, errors, user_id, project_id, ...) is ignored. A
// forged callback therefore cannot set image_url or flip a status; at worst it makes the server ask
// the provider a read-only question about a real, unfinished task. Terminal tasks are never touched
// again (no provider call, no overwrite), which also makes provider retries and replays idempotent.

const MAX_CALLBACK_BYTES = 64 * 1024

// Only the task identity is taken from the body (documented on every callback shape, v1/v2/pro).
const CallbackSchema = z.object({
  data: z.object({ taskId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/) }).passthrough(),
})

const ACK = () => NextResponse.json({ success: true })

export async function POST(request: NextRequest) {
  // Bounded read: never buffer an arbitrary body.
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_CALLBACK_BYTES) {
    return NextResponse.json({ error: 'Invalid callback' }, { status: 413 })
  }

  let body: unknown
  try {
    const text = await request.text()
    if (text.length > MAX_CALLBACK_BYTES) return NextResponse.json({ error: 'Invalid callback' }, { status: 413 })
    body = JSON.parse(text)
  } catch {
    return NextResponse.json({ error: 'Invalid callback' }, { status: 400 })
  }

  const parsed = CallbackSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid callback' }, { status: 400 })
  const providerTaskId = parsed.data.data.taskId

  try {
    const db = createServiceRoleSupabase()

    // Binding: an existing Nano Banana task, found by the provider's id. Owner, project and every other
    // field come from OUR row, never from the request. An unknown id is acknowledged like any other
    // (no hint to an unauthenticated caller about what exists).
    const { data: task } = await db
      .from('generation_tasks')
      .select('id, user_id, status')
      .eq('provider', 'nanobanana')
      .eq('task_id', providerTaskId)
      .maybeSingle()

    // Terminal (or unknown) tasks are never re-opened or overwritten: replay and duplicate-safe.
    if (!task || task.status !== 'processing') return ACK()

    // The owner's own credential, through the existing boundary: no platform fallback.
    const credential = await resolveProviderExecution(db, { userId: task.user_id, provider: 'nano_banana', purpose: 'status_read' })
    if (credential.status !== 'ready') {
      console.warn('[NanoBanana Callback] no owner credential; task left untouched')
      return ACK()
    }

    const answer = await queryNanoBananaTask(credential.secret, providerTaskId)
    if (!answer.ok) {
      // Nothing is mutated. A transient provider problem is retryable (the provider retries non-2xx).
      console.warn('[NanoBanana Callback] provider query not usable:', answer.reason)
      return answer.reason === 'TASK_MISMATCH' ? ACK() : NextResponse.json({ error: 'Retry later' }, { status: 503 })
    }

    const state = answer.task
    if (state.state === 'generating') {
      // The callback raced the provider's own record: nothing to apply yet, ask the provider to call again.
      return NextResponse.json({ error: 'Retry later' }, { status: 503 })
    }

    let update: Record<string, unknown>
    if (state.state === 'succeeded') {
      // The provider's answer is authoritative, but the stored URL must still be the provider's own result
      // host (the same allowlist the image ingestion enforces): anything else is treated as a failed result.
      try {
        parseRemoteImageUrl(state.resultImageUrl, NANOBANANA_RESULT_IMAGE_POLICY)
        update = { status: 'completed', image_url: state.resultImageUrl }
      } catch (error) {
        if (!(error instanceof RemoteImageError)) throw error
        console.warn('[NanoBanana Callback] provider result URL refused by policy:', error.code)
        update = { status: 'failed', error_message: 'Resultado do provedor indisponível.' }
      }
    } else if (state.state === 'failed') {
      update = { status: 'failed', error_message: state.message }
    } else {
      console.warn('[NanoBanana Callback] provider answer unusable:', state.reason)
      update = { status: 'failed', error_message: 'Resposta do provedor inválida.' }
    }

    // processing -> terminal only, atomically: a concurrent/duplicate delivery finds no `processing` row.
    const { error: updateError } = await db
      .from('generation_tasks')
      .update({ ...update, callback_received_at: new Date().toISOString() })
      .eq('id', task.id)
      .eq('status', 'processing')
    if (updateError) return NextResponse.json({ error: 'Retry later' }, { status: 503 })

    return ACK()
  } catch (error) {
    // Class only: messages/URLs/keys are never logged.
    console.error('[NanoBanana Callback] failed:', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ error: 'Retry later' }, { status: 503 })
  }
}

export async function GET() {
  return NextResponse.json({ status: 'ok', endpoint: 'nanobanana-callback' })
}
