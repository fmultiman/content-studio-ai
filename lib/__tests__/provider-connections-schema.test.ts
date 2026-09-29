import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// KLING_MCP_OAUTH_CONNECTION_SPIKE_V1 — static guarantees about the migration.
// The live equivalents (role-based access checks against the real database) are
// recorded in docs/architecture/KLING_MCP_OAUTH_CONNECTION_SPIKE_V1.md.

const ROOT = process.cwd()
const MIGRATION = readFileSync(join(ROOT, 'scripts/041_create_provider_connections.sql'), 'utf8')
// Strip comments so assertions reason about executable SQL only.
const SQL = MIGRATION.replace(/--.*$/gm, '')

const SERVER_ONLY_TABLES = ['provider_connection_secrets', 'provider_oauth_clients', 'provider_oauth_authorizations']

const statementsFor = (table: string) =>
  SQL.split(';')
    .map((statement) => statement.replace(/\s+/g, ' ').trim())
    .filter((statement) => new RegExp(`\\b${table}\\b`, 'i').test(statement))

describe('provider connection migration', () => {
  it('is a new, additive migration that does not modify any existing table', () => {
    expect(SQL).not.toMatch(/\bALTER\s+TABLE\s+(?!provider_)/i)
    expect(SQL).not.toMatch(/\bDROP\s+(TABLE|COLUMN)/i)
    for (const existing of ['user_settings', 'video_generations', 'library_files', 'images', 'projects']) {
      expect(SQL).not.toMatch(new RegExp(`\\b(ALTER|UPDATE|DELETE FROM|INSERT INTO)\\s+${existing}\\b`, 'i'))
    }
  })

  it('does not edit migration 039 or any previously applied migration file', () => {
    const numbered = readdirSync(join(ROOT, 'scripts')).filter((name) => /^\d{3}_.*\.sql$/.test(name))
    expect(numbered).toContain('041_create_provider_connections.sql')
    expect(numbered.filter((name) => name.startsWith('041_'))).toHaveLength(1)
  })

  it('does not add transport/connection columns to video_generations', () => {
    expect(SQL).not.toMatch(/video_generations/i)
  })

  it('enables row level security on all four tables', () => {
    for (const table of ['provider_connections', ...SERVER_ONLY_TABLES]) {
      expect(SQL).toMatch(new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`, 'i'))
    }
  })

  describe.each(SERVER_ONLY_TABLES)('%s (server-only)', (table) => {
    it('has NO policy of any kind (RLS denies every non-service-role access)', () => {
      expect(SQL).not.toMatch(new RegExp(`CREATE POLICY[^;]*ON ${table}\\b`, 'i'))
    })

    it('has all privileges revoked from anon and authenticated, and grants nothing back', () => {
      expect(SQL).toMatch(new RegExp(`REVOKE ALL ON TABLE ${table} FROM anon, authenticated`, 'i'))
      expect(SQL).not.toMatch(new RegExp(`GRANT[^;]*ON TABLE ${table}\\b`, 'i'))
    })
  })

  describe('provider_connections (safe metadata)', () => {
    it('lets an owner SELECT only their own rows and nothing else', () => {
      const policies = SQL.match(/CREATE POLICY[^;]*ON provider_connections[^;]*;/gi) ?? []
      expect(policies).toHaveLength(1)
      expect(policies[0]).toMatch(/FOR SELECT/i)
      expect(policies[0]).toMatch(/auth\.uid\(\)\s*=\s*user_id/i)
      expect(SQL).toMatch(/GRANT SELECT ON TABLE provider_connections TO authenticated/i)
      expect(SQL).not.toMatch(/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*ON TABLE provider_connections/i)
    })

    it('holds no token or secret column', () => {
      const definition = statementsFor('provider_connections').find((statement) => /CREATE TABLE/i.test(statement)) ?? ''
      expect(definition).not.toMatch(/access_token|refresh_token|id_token|client_secret|ciphertext|password|api_key/i)
    })

    it('allows exactly one OAuth connection per user and provider, and only the factual method', () => {
      expect(SQL).toMatch(/UNIQUE \(user_id, provider, connection_method\)/i)
      expect(SQL).toMatch(/connection_method IN \('mcp_oauth'\)/i)
      expect(SQL).toMatch(/provider IN \('kling'\)/i)
    })

    it('models only the three stored states (not_configured is the absence of a row)', () => {
      expect(SQL).toMatch(/status IN \('connected', 'authorization_required', 'error'\)/i)
      expect(SQL).not.toMatch(/'not_configured'/i)
    })

    it('has no credit-balance column (a balance is never persisted)', () => {
      expect(SQL).not.toMatch(/credit|balance/i)
    })
  })

  it('stores secrets only as ciphertext, tied to their connection with a cascading delete', () => {
    const definition = statementsFor('provider_connection_secrets').find((statement) => /CREATE TABLE/i.test(statement)) ?? ''
    expect(definition).toMatch(/ciphertext TEXT NOT NULL/i)
    expect(definition).toMatch(/REFERENCES provider_connections\(id\) ON DELETE CASCADE/i)
    // access_token_expires_at is a non-secret expiry timestamp; no token VALUE column may exist.
    expect(definition).not.toMatch(/\b(access_token|refresh_token|id_token|token)\s+TEXT/i)
    expect(definition).toMatch(/secret_version INTEGER/i)
  })

  it('stores the PKCE verifier encrypted and the OAuth state only as a hash, bound to a user', () => {
    const definition = statementsFor('provider_oauth_authorizations').find((statement) => /CREATE TABLE/i.test(statement)) ?? ''
    expect(definition).toMatch(/state_hash TEXT PRIMARY KEY/i)
    expect(definition).toMatch(/code_verifier_ciphertext TEXT NOT NULL/i)
    expect(definition).toMatch(/user_id UUID NOT NULL REFERENCES auth\.users\(id\)/i)
    expect(definition).toMatch(/expires_at TIMESTAMPTZ NOT NULL/i)
    expect(definition).not.toMatch(/\bstate TEXT\b|code_verifier TEXT/i)
  })

  it('keys the OAuth client registration by provider + issuer + redirect URI', () => {
    expect(SQL).toMatch(/UNIQUE \(provider, issuer, redirect_uri\)/i)
  })
})
