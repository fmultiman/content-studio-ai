'use client'

import { useEffect, useMemo, useSyncExternalStore } from 'react'
import {
  createGenerationSessionAutosave,
  type CreateGenerationSessionAutosaveOptions,
  type GenerationSessionAutosave,
  type SaveToken,
} from '@/lib/generation-session/autosave'

export type UseGenerationSessionAutosaveOptions<S, T extends SaveToken> =
  CreateGenerationSessionAutosaveOptions<S, T> & {
    enabled?: boolean
  }

export function useGenerationSessionAutosave<S, T extends SaveToken>(
  options: UseGenerationSessionAutosaveOptions<S, T>,
) {
  const controller = useMemo(
    () => createGenerationSessionAutosave(options),
    // The adapter/config is intentionally fixed for the lifetime of a Session key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [options.sessionKey],
  )
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  )

  useEffect(() => () => controller.dispose(), [controller])

  return {
    controller,
    ...snapshot,
    enabled: options.enabled !== false,
  }
}
