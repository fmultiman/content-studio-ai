import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration031 = readFileSync(join(process.cwd(), 'scripts/031_create_render_executions.sql'), 'utf8')
const correctionMigration = readFileSync(join(process.cwd(), 'scripts/032_harden_render_execution_insert_authority.sql'), 'utf8')
const renderRoute = readFileSync(join(process.cwd(), 'app/api/video-drafts/[id]/render/route.ts'), 'utf8')
const readRoute = readFileSync(join(process.cwd(), 'app/api/render-executions/[id]/route.ts'), 'utf8')

describe('render execution insert authority (Phase 2I-B1.1)', () => {
  it('does not grant browser roles an INSERT policy or INSERT privilege', () => {
    expect(migration031).not.toMatch(/CREATE\s+POLICY\s+"render_executions_insert_own"/i)
    expect(migration031).toMatch(/REVOKE\s+SELECT,\s*INSERT\s+ON\s+TABLE\s+render_executions\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i)
    expect(correctionMigration).toMatch(/DROP\s+POLICY\s+IF\s+EXISTS\s+"render_executions_insert_own"/i)
    expect(correctionMigration).toMatch(/REVOKE\s+SELECT\s+ON\s+TABLE\s+render_executions\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i)
    expect(correctionMigration).toMatch(/GRANT\s+SELECT,\s*INSERT\s+ON\s+TABLE\s+render_executions\s+TO\s+service_role/i)
  })

  it('keeps SELECT policy while routing insertion through a server-only service-role client', () => {
    expect(migration031).toMatch(/CREATE\s+POLICY\s+"render_executions_select_own"[\s\S]*?FOR\s+SELECT/i)
    expect(renderRoute).toContain("process.env.SUPABASE_SERVICE_ROLE_KEY")
    expect(renderRoute).toContain('const executionAdmin = createRenderExecutionWriteClient()')
    expect(renderRoute).toContain('.from(\'render_executions\')')
    expect(readRoute).toContain('process.env.SUPABASE_SERVICE_ROLE_KEY')
    expect(readRoute).toContain('const executionReader = createRenderExecutionReadClient()')
  })
})
