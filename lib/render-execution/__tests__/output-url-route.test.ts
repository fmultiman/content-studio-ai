import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('Render Execution output-url Route', () => {
  const routeSource = readFileSync(
    join(process.cwd(), 'app', 'api', 'render-executions', '[id]', 'output-url', 'route.ts'),
    'utf-8'
  )

  it('authenticates current Supabase user', () => {
    expect(routeSource).toMatch(/supabase\.auth\.getUser\(\)/)
    expect(routeSource).toMatch(/return NextResponse\.json\(\{ error: 'Nao autorizado' \}, \{ status: 401 \}\)/)
  })

  it('enforces ownership via user.id and rejects non-owner / not found', () => {
    expect(routeSource).toMatch(/\.eq\('user_id', user\.id\)/)
    expect(routeSource).toMatch(/if \(error \|\| !execution\) \{[\s\S]*404/)
  })

  it('rejects execution statuses other than completed', () => {
    expect(routeSource).toMatch(/if \(execution\.status !== 'completed'\)/)
    expect(routeSource).toMatch(/status: 409/)
  })

  it('rejects if output_storage_path is missing', () => {
    expect(routeSource).toMatch(/if \(!execution\.output_storage_path\)/)
    expect(routeSource).toMatch(/status: 500/)
  })

  it('validates the output locator belongs to the expected scratch namespace', () => {
    // Looks for prefix validation: `users/${user.id}/renders/scratch/${id}/`
    expect(routeSource).toMatch(/users\/\$\{user\.id\}\/renders\/scratch\/\$\{id\}\//)
    expect(routeSource).toMatch(/\!execution\.output_storage_path\.startsWith\(allowedPrefix\)/)
  })

  it('generates a presigned URL using the server storage config without exposing credentials', () => {
    expect(routeSource).toMatch(/createPresignedReadUrl\(/)
    // Ensures no AWS keys or config are returned in the JSON
    expect(routeSource).toMatch(/NextResponse\.json\(\{ url, expiresAt:/)
    expect(routeSource).not.toMatch(/accessKey/)
    expect(routeSource).not.toMatch(/secretKey/)
  })
})
