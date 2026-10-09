// FUTURE-050 — shared test harness guarantees (applies to every vitest file).
//
// 1. Provider flows may run against FAKES: the execution policy's mocked-providers harness is on. Policy tests turn
//    it off and exercise the real classification (lib/providers/__tests__/execution-policy.test.ts).
// 2. No test can reach a real provider by accident: the DEFAULT global fetch refuses provider hosts. A test that
//    installs its own fetch mock (global.fetch = vi.fn(), vi.stubGlobal, vi.spyOn(...).mockImplementation) replaces
//    this guard and is therefore calling a fake, never the network.
import { __setMockedProvidersHarnessForTests } from '@/lib/providers/execution-policy'
import { PROVIDER_HOSTS, PROVIDER_HOST_SUFFIXES } from '@/lib/providers/__tests__/provider-hosts'

__setMockedProvidersHarnessForTests(true)


function hostOf(input: unknown): string | null {
  try {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as { url?: string })?.url
    return raw ? new URL(raw).hostname.toLowerCase() : null
  } catch {
    return null
  }
}

const realFetch = globalThis.fetch

async function providerBlockingFetch(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) {
  const host = hostOf(input)
  if (host && (PROVIDER_HOSTS.includes(host) || PROVIDER_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix)))) {
    throw new Error(`Test harness: a real provider call to ${host} was attempted. Mock fetch in the test.`)
  }
  return realFetch(input, init)
}

globalThis.fetch = providerBlockingFetch as typeof fetch
