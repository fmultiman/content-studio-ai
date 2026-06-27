import { describe, expect, it } from 'vitest'
import {
  PRODUCTION_TABS_GRID_CLASS,
  draftLoadingMessage,
  productionReturnPath,
  productionWorkspaceLoadingMessage,
  resolveProductionDisplay,
} from '../ux-production-hardening'

describe('UX-H1 Production hardening helpers', () => {
  it('renders Production title and intention separately when stored title was concatenated', () => {
    const display = resolveProductionDisplay({
      title: 'Criar uma campanha para Portal NortePortal NorteCampanha multimodal Portal Norte',
      intention: 'Criar uma campanha para Portal Norte',
      projectName: 'Portal Norte',
    })

    expect(display.title).toBe('Campanha multimodal Portal Norte')
    expect(display.intention).toBe('Criar uma campanha para Portal Norte')
  })

  it('keeps a clean Production title unchanged', () => {
    const display = resolveProductionDisplay({
      title: 'Campanha multimodal Portal Norte',
      intention: 'Criar uma campanha para Portal Norte',
      projectName: 'Portal Norte',
    })

    expect(display.title).toBe('Campanha multimodal Portal Norte')
  })

  it('keeps a title that legitimately shares words with the intention', () => {
    const input = {
      title: 'Criar uma campanha com linguagem de bastidor',
      intention: 'Criar uma campanha',
      projectName: 'Portal Norte',
    }

    const display = resolveProductionDisplay(input)

    expect(display.title).toBe('Criar uma campanha com linguagem de bastidor')
  })

  it('resolves a legacy title that starts with the intention lead without the Project name', () => {
    const display = resolveProductionDisplay({
      title: 'Criar uma campanha multimodal para apresentar o Portal NorteCampanha multimodal Portal Norte',
      intention: 'Criar uma campanha multimodal para apresentar o Portal Norte: uma capa visual e um teaser curto.',
      projectName: 'Auditoria UX Reconciliação 2026-06-26 09-15',
    })

    expect(display.title).toBe('Campanha multimodal Portal Norte')
  })

  it('resolves a legacy title that shares a long intention prefix with a wording variation', () => {
    const display = resolveProductionDisplay({
      title: 'Criar a capa e um teaser visual para uma faixa experimentalPortal Norte - capa e teaser',
      intention: 'Criar a capa e um teaser visual para uma faixa experimental chamada Portal Norte.',
      projectName: 'Auditoria UX 2026',
    })

    expect(display.title).toBe('Portal Norte - capa e teaser')
  })

  it('uses a predictable fallback for empty values', () => {
    const display = resolveProductionDisplay({
      title: '   ',
      intention: null,
      projectName: undefined,
    })

    expect(display.title).toBe('Produção sem título')
    expect(display.intention).toBe('')
    expect(display.breadcrumb).toEqual(['Projetos', 'Produção sem título'])
  })

  it('does not mutate the input object', () => {
    const input = {
      title: 'Criar uma campanha para Portal NortePortal NorteCampanha multimodal Portal Norte',
      intention: 'Criar uma campanha para Portal Norte',
      projectName: 'Portal Norte',
    }
    const snapshot = { ...input }

    resolveProductionDisplay(input)

    expect(input).toEqual(snapshot)
  })

  it('builds breadcrumb labels without concatenating intention and title', () => {
    const display = resolveProductionDisplay({
      title: 'Criar uma campanha para Portal NortePortal NorteCampanha multimodal Portal Norte',
      intention: 'Criar uma campanha para Portal Norte',
      projectName: 'Portal Norte',
    })

    expect(display.breadcrumb).toEqual([
      'Projetos',
      'Portal Norte',
      'Campanha multimodal Portal Norte',
    ])
  })

  it('returns an explicit Production path only when content has a production', () => {
    expect(productionReturnPath('project-1', 'production-1')).toBe(
      '/projetos/project-1/producoes/production-1',
    )
    expect(productionReturnPath('project-1', null)).toBeNull()
  })

  it('uses contextual loading messages for Production and drafts', () => {
    expect(productionWorkspaceLoadingMessage('page')).toBe('Carregando Production...')
    expect(productionWorkspaceLoadingMessage('editorial')).toBe('Carregando conteúdos da Production...')
    expect(draftLoadingMessage('image', true)).toBe('Carregando rascunho de imagem...')
    expect(draftLoadingMessage('video', true)).toBe('Carregando rascunho de vídeo...')
    expect(draftLoadingMessage('video', false)).toBe('Carregando editor de vídeo...')
  })

  it('uses a four-column tab grid for the four Production tabs', () => {
    expect(PRODUCTION_TABS_GRID_CLASS).toContain('grid-cols-4')
    expect(PRODUCTION_TABS_GRID_CLASS).not.toContain('grid-cols-5')
  })
})
