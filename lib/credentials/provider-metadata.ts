// AI_PROVIDER_CREDENTIALS_EXECUTION_MODES_V1
//
// Static, non-secret provider metadata. Kept deliberately separate from
// credential storage and from execution mode so the domain concepts do not
// collapse into one "provider settings" object:
//
//   Provider          the external service (openai, kling, ...)
//   Connection method how a credential is obtained/held for that provider
//                     (today only an API key)
//   Transport         how Content Studio reaches the provider (today only REST)
//   Execution mode    who pays (see provider-execution.ts)
//   Credential source whose credential is used (see provider-execution.ts)
//
// Future connection methods (OAuth, MCP, Browser Bridge, ...) and transports
// are intentionally NOT listed: not every provider supports every mechanism,
// and nothing here implies they exist. They join these unions only when a
// real implementation lands.

import type { AiProvider } from './provider-credentials'

export type ProviderConnectionMethod = 'api_key'

export type ProviderTransport = 'rest'

export interface ProviderMetadata {
  label: string
  connectionMethods: readonly ProviderConnectionMethod[]
  transports: readonly ProviderTransport[]
  /** False when the provider has credential storage/UI but no generation path. */
  executionImplemented: boolean
}

export const PROVIDER_METADATA: Record<AiProvider, ProviderMetadata> = {
  openai: {
    label: 'OpenAI',
    connectionMethods: ['api_key'],
    transports: ['rest'],
    executionImplemented: true,
  },
  nano_banana: {
    label: 'Nano Banana',
    connectionMethods: ['api_key'],
    transports: ['rest'],
    executionImplemented: true,
  },
  kling: {
    label: 'Kling',
    connectionMethods: ['api_key'],
    transports: ['rest'],
    executionImplemented: true,
  },
  replicate: {
    label: 'Replicate',
    connectionMethods: ['api_key'],
    transports: ['rest'],
    executionImplemented: false,
  },
}

/** Connection method a saved credential is held under (V1: always an API key). */
export function primaryConnectionMethod(provider: AiProvider): ProviderConnectionMethod {
  return PROVIDER_METADATA[provider].connectionMethods[0]
}
