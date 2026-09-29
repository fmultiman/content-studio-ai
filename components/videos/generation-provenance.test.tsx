// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { describeMcpConnection, describeRestConnection } from '@/lib/video-generation/connections'
import {
  connectionDisplayName,
  connectionNamesById,
  describeGenerationProvenance,
  spendingSourceCopy,
  transportBadge,
} from '@/lib/video-generation/connection-presentation'
import type { ProviderConnectionRow } from '@/lib/provider-connections/types'
import { GenerationProvenance } from './generation-provenance'

// VIDEO_GENERATION_MODAL_SAFETY_AND_TRANSPORT_UX_V1 — history answers
// "was this generated through API or MCP?" from data that is already persisted.

afterEach(cleanup)

const MCP_ID = '11111111-1111-4111-8111-111111111111'
const NOW = new Date()
const mcpConnection = describeMcpConnection(
  {
    id: MCP_ID,
    user_id: 'u',
    provider: 'kling',
    connection_method: 'mcp_oauth',
    status: 'connected',
    scopes: ['generation.read', 'account.credit.read', 'generation.create'],
    external_account_id: null,
    capabilities: { membership: { label: 'Pro' } },
    last_checked_at: NOW.toISOString(),
    last_error_code: null,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
  } as unknown as ProviderConnectionRow,
  NOW,
)
const names = connectionNamesById([describeRestConnection('configured'), mcpConnection])

describe('connection presentation (pure)', () => {
  it('labels transports API / MCP; a legacy row without a transport is REST, therefore API', () => {
    expect(transportBadge('rest')).toBe('API')
    expect(transportBadge('mcp')).toBe('MCP')
    expect(transportBadge(null)).toBe('API')
    expect(transportBadge(undefined)).toBe('API')
  })

  it('states the spending source truthfully and without any amount', () => {
    expect(spendingSourceCopy('kling_api_package')).toBe('Usa o pacote de recursos da sua API Kling.')
    expect(spendingSourceCopy('kling_web_credits')).toBe('Usa os créditos da sua conta Kling (web).')
    for (const funding of ['kling_api_package', 'kling_web_credits'] as const) expect(spendingSourceCopy(funding)).not.toMatch(/\d/)
  })

  it('names connections the way the product does', () => {
    expect(connectionDisplayName(describeRestConnection('configured'))).toBe('Kling API')
    expect(connectionDisplayName(mcpConnection)).toBe('Minha conta Kling — Pro')
  })

  it('maps only account connections by id (the API key is not a stored connection)', () => {
    expect([...names.entries()]).toEqual([[MCP_ID, 'Minha conta Kling — Pro']])
  })
})

describe('describeGenerationProvenance', () => {
  it('MCP generation with a known connection: transport + the connection name', () => {
    expect(describeGenerationProvenance({ transport: 'mcp', connection_id: MCP_ID }, names)).toEqual({ badge: 'MCP', connectionName: 'Minha conta Kling — Pro' })
  })
  it('REST generation: API + Kling API', () => {
    expect(describeGenerationProvenance({ transport: 'rest', connection_id: null }, names)).toEqual({ badge: 'API', connectionName: 'Kling API' })
  })
  it('historical row without transport metadata: API (REST by definition), no connection to name', () => {
    expect(describeGenerationProvenance({}, names)).toEqual({ badge: 'API', connectionName: 'Kling API' })
  })
  it('MCP row whose connection was disconnected (connection_id NULL) or is unknown: transport only — never an invented name', () => {
    expect(describeGenerationProvenance({ transport: 'mcp', connection_id: null }, names)).toEqual({ badge: 'MCP', connectionName: null })
    expect(describeGenerationProvenance({ transport: 'mcp', connection_id: '99999999-9999-4999-8999-999999999999' }, names)).toEqual({ badge: 'MCP', connectionName: null })
    expect(describeGenerationProvenance({ transport: 'mcp', connection_id: MCP_ID }, new Map())).toEqual({ badge: 'MCP', connectionName: null })
  })
})

describe('<GenerationProvenance /> in a history card', () => {
  it('shows the MCP badge and the account connection name', () => {
    render(<GenerationProvenance generation={{ transport: 'mcp', connection_id: MCP_ID }} connectionNames={names} />)
    expect(screen.getByTestId('generation-transport-badge').textContent).toBe('MCP')
    expect(screen.getByTestId('generation-provenance').textContent).toContain('Minha conta Kling — Pro')
    expect(screen.getByTestId('generation-provenance').getAttribute('data-transport')).toBe('MCP')
  })

  it('shows the API badge for a REST generation', () => {
    render(<GenerationProvenance generation={{ transport: 'rest' }} connectionNames={names} />)
    expect(screen.getByTestId('generation-transport-badge').textContent).toBe('API')
    expect(screen.getByTestId('generation-provenance').textContent).toContain('Kling API')
  })

  it('degrades gracefully for a historical row: transport truthfully, no invented connection', () => {
    render(<GenerationProvenance generation={{ transport: 'mcp', connection_id: null }} connectionNames={new Map()} />)
    expect(screen.getByTestId('generation-transport-badge').textContent).toBe('MCP')
    const text = screen.getByTestId('generation-provenance').textContent ?? ''
    expect(text).not.toContain('Minha conta')
    expect(text).not.toContain('Kling API')
  })
})

describe('/videos wiring', () => {
  const page = readFileSync(join(process.cwd(), 'app/(dashboard)/videos/page.tsx'), 'utf8')
  it('renders the provenance line for generation cards in both the list and the card view', () => {
    expect(page.match(/<GenerationProvenance /g) ?? []).toHaveLength(2)
    expect(page).toMatch(/item\.kind === 'generation'/)
  })
  it('only loads connection names when an MCP generation exists (no extra request otherwise) and never blocks history on it', () => {
    expect(page).toMatch(/hasMcpConnectionRows/)
    expect(page).toMatch(/\.catch\(\(\) => undefined\)/)
  })
})
