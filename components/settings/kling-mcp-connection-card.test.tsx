// @vitest-environment jsdom
/**
 * KLING_MCP_OAUTH_CONNECTION_SPIKE_V1 — the Kling account (MCP / OAuth) card is
 * status-only: it renders safe metadata, has no credential input, and never
 * receives a token.
 */
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { KlingMcpConnectionCard } from './kling-mcp-connection-card'
import type { PublicProviderConnection } from '@/lib/provider-connections/types'

afterEach(cleanup)

const connection = (overrides: Partial<PublicProviderConnection> = {}): PublicProviderConnection => ({
  id: 'conn-1',
  provider: 'kling',
  connectionMethod: 'mcp_oauth',
  status: 'connected',
  scopes: ['generation.read', 'account.credit.read'],
  generationAuthorized: false,
  accountHint: '4242',
  capabilities: { membership: { type: 'SVIP', label: 'Pro' }, models: { text_to_video: ['a', 'b', 'c'] } },
  lastCheckedAt: '2026-09-29T12:00:00.000Z',
  lastErrorCode: null,
  ...overrides,
})

function renderCard(props: Partial<ComponentProps<typeof KlingMcpConnectionCard>> = {}) {
  const handlers = {
    onConnect: vi.fn().mockResolvedValue(undefined),
    onCheck: vi.fn().mockResolvedValue(undefined),
    onDisconnect: vi.fn().mockResolvedValue(undefined),
  }
  render(
    <KlingMcpConnectionCard connection={null} connectionsAvailable liveCredits={null} {...handlers} {...props} />,
  )
  return handlers
}

describe('KlingMcpConnectionCard', () => {
  it('is clearly the Kling ACCOUNT connection, funded by the user’s own Kling credits', () => {
    renderCard()
    expect(screen.getByText('Conta Kling via MCP')).toBeTruthy()
    expect(screen.getByText(/usar os modelos Kling diretamente com seus créditos/)).toBeTruthy()
  })

  it('shows "Não conectada" with a connect action when there is no connection', () => {
    const handlers = renderCard({ connection: null })
    expect(screen.getByText('Não conectada')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Conectar conta Kling/ }))
    return waitFor(() => expect(handlers.onConnect).toHaveBeenCalledWith('generation'))
  })

  it('explains it asks for generation permissions before connecting', () => {
    renderCard({ connection: null })
    expect(screen.getByText(/pedirá permissão extra para criar gerações/)).toBeTruthy()
  })

  it('shows a loading badge while the connection state is unknown but not failed', () => {
    renderCard({ connection: undefined, loadFailed: false })
    expect(screen.getByText('Carregando...')).toBeTruthy()
  })

  it('shows a loadFailed state instead of "Não conectada" with a retry button', () => {
    const onRetryLoad = vi.fn()
    renderCard({ connection: null, loadFailed: true, onRetryLoad })
    expect(screen.getByText('Estado indisponível')).toBeTruthy()
    expect(screen.queryByText('Não conectada')).toBeNull()
    expect(screen.queryByRole('button', { name: /Conectar conta/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Tentar novamente/ }))
    expect(onRetryLoad).toHaveBeenCalledTimes(1)
  })

  it('disables connecting and says why when this environment cannot store connection secrets', () => {
    renderCard({ connection: null, connectionsAvailable: false, loadFailed: false })
    expect((screen.getByRole('button', { name: /Conectar conta/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/ainda não estão habilitadas neste ambiente/)).toBeTruthy()
  })

  it('a connected account shows safe metadata and check / disconnect actions (no connect button)', () => {
    const handlers = renderCard({ connection: connection() })
    expect(screen.getByText(/Conectada - Somente leitura/)).toBeTruthy()
    expect(screen.getByText('final 4242')).toBeTruthy()
    expect(screen.getByText('Pro')).toBeTruthy()
    expect(screen.getByText('Consultar conta, modelos e créditos')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Conectar conta/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Desconectar/ })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Verificar conexão/ }))
    return waitFor(() => expect(handlers.onCheck).toHaveBeenCalledTimes(1))
  })

  it('does not request or show generate scope, and never shows a credit balance unless a live read was just made', () => {
    renderCard({ connection: connection(), liveCredits: null })
    expect(document.body.textContent).not.toContain('generation.create')
    expect(screen.queryByText(/Créditos na conta Kling/)).toBeNull()
  })

  it('shows a LIVE credit read only when provided (transient, labelled as a live read)', () => {
    renderCard({ connection: connection(), liveCredits: 12345 })
    expect(screen.getByText(/Créditos na conta Kling \(leitura ao vivo\)/)).toBeTruthy()
    expect(screen.getByText((12345).toLocaleString('pt-BR'))).toBeTruthy()
  })

  it('an expired grant offers Reconectar instead of Verificar', () => {
    const handlers = renderCard({ connection: connection({ status: 'authorization_required', generationAuthorized: true }) })
    expect(screen.getByText('Reautorização necessária')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Verificar conexão/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Reconectar/ }))
    return waitFor(() => expect(handlers.onConnect).toHaveBeenCalledWith('generation'))
  })

  it('an errored connection is labelled as such, and offers BOTH Reconectar and Verificar', () => {
    const handlers = renderCard({ connection: connection({ status: 'error', lastErrorCode: 'PROVIDER_CLIENT_REJECTED' }) })
    expect(screen.getByText('Erro na conexão')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Verificar conexão/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Reconectar/ })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Reconectar/ }))
    return waitFor(() => expect(handlers.onConnect).toHaveBeenCalledWith('read_only')) // uses old context since it wasn't generation authorized
  })

  it('disconnect asks for confirmation and states the honest revocation copy', async () => {
    const { onDisconnect } = renderCard({ connection: connection() })
    fireEvent.click(screen.getByRole('button', { name: /^Desconectar$/ }))
    expect(await screen.findByText(/Tentamos revogar a autorização na Kling e apagamos as credenciais guardadas aqui/)).toBeTruthy()
    expect(onDisconnect).not.toHaveBeenCalled()

    const confirm = screen.getAllByRole('button', { name: /^Desconectar$/ }).pop() as HTMLElement
    fireEvent.click(confirm)
    await waitFor(() => expect(onDisconnect).toHaveBeenCalledTimes(1))
  })

  it('a read-only connection says so truthfully and offers "Autorizar geração" (explicit action, never automatic)', async () => {
    const handlers = renderCard({ connection: connection({ generationAuthorized: false }) })

    expect(screen.getByText(/Conexão somente leitura: ainda não gera vídeos/)).toBeTruthy()
    // Nothing starts on render.
    expect(handlers.onConnect).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /Autorizar geração/ }))
    await waitFor(() => expect(handlers.onConnect).toHaveBeenCalledWith('generation'))
  })

  it('once generation is authorized the CTA is gone and the copy says so', () => {
    renderCard({
      connection: connection({ generationAuthorized: true, scopes: ['generation.read', 'account.credit.read', 'generation.create'] })
    })
    expect(screen.queryByRole('button', { name: /Autorizar geração/ })).toBeNull()
    expect(screen.getByText(/Geração de vídeos autorizada/)).toBeTruthy()
  })

  it('does not offer the authorization CTA when the connection is not connected or the environment cannot connect', () => {
    renderCard({ connection: connection({ status: 'authorization_required', generationAuthorized: false }) })
    expect(screen.queryByRole('button', { name: /Autorizar geração/ })).toBeNull()
    cleanup()
    renderCard({ connection: connection({ generationAuthorized: false }), connectionsAvailable: false })
    expect((screen.getByRole('button', { name: /Autorizar geração/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('warns that disconnecting waits for generations still in progress', async () => {
    renderCard({ connection: connection() })
    fireEvent.click(screen.getByRole('button', { name: /^Desconectar$/ }))
    expect(await screen.findByText(/só é liberada quando terminarem/)).toBeTruthy()
  })

  it('has no credential input of any kind and renders no token-like content', () => {
    renderCard({ connection: connection() })
    expect(document.querySelector('input, textarea')).toBeNull()
    expect(document.body.innerHTML).not.toMatch(/access_token|refresh_token|Bearer|ciphertext/i)
  })

  it('accepts no secret through its props (status-only contract)', () => {
    expect(String(KlingMcpConnectionCard)).not.toMatch(/accessToken|refreshToken|secret/i)
  })
})
