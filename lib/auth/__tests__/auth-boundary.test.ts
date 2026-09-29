import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * AUTH_PASSWORD_RECOVERY_V1 — the recovery/password flows may only use the
 * end-user Supabase Auth surface. Source-level guard over every file of the
 * feature: no service-role/admin Auth API, no hardcoded local origin, no
 * secret/token logging, no known throwaway password.
 */
const root = path.resolve(__dirname, '..', '..', '..')
const FEATURE_FILES = [
  'lib/auth/recovery.ts',
  'lib/auth/callback.ts',
  'app/auth/callback/route.ts',
  'app/auth/forgot-password/page.tsx',
  'app/auth/update-password/page.tsx',
  'components/auth/auth-shell.tsx',
  'components/auth/forgot-password-form.tsx',
  'components/auth/update-password-form.tsx',
  'components/settings/change-password-form.tsx',
  'app/login/page.tsx',
]

const FORBIDDEN: Array<[string, RegExp]> = [
  ['service-role key / client', /service[-_]?role|SUPABASE_SERVICE/i],
  ['admin Auth API', /auth\.admin|\.admin\./],
  ['admin user write', /updateUserById|createUser\s*\(|generateLink|deleteUser/],
  ['throwaway password', /password123/i],
  ['hardcoded local origin', /localhost|127\.0\.0\.1|0\.0\.0\.0/],
  ['any console logging (could leak tokens)', /console\.\w+\(/],
  ['raw token access', /access_token|refresh_token|provider_token/],
]

describe('AUTH_PASSWORD_RECOVERY_V1 — no admin Auth, localhost or secret logging in the feature', () => {
  for (const file of FEATURE_FILES) {
    it(`${file} stays on the end-user Auth surface`, () => {
      const source = readFileSync(path.join(root, file), 'utf8')
      for (const [label, pattern] of FORBIDDEN) {
        expect(source, `${file}: ${label}`).not.toMatch(pattern)
      }
    })
  }
})
