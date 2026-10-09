// FUTURE-050 — hosts the test harness refuses to reach with the DEFAULT fetch (see vitest.setup.ts).
// Lives under __tests__ on purpose: provider hosts must stay confined to their real clients in production source
// (lib/__tests__/credential-boundary.test.ts scans for them).
export const PROVIDER_HOSTS = [
  'api.openai.com',
  'generativelanguage.googleapis.com',
  'api-singapore.klingai.com',
  'api.klingai.com',
  'api.nanobananaapi.ai',
  'api.replicate.com',
]
export const PROVIDER_HOST_SUFFIXES = ['.klingai.com', '.kling.ai']
