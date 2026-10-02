// @vitest-environment jsdom
// CREATIVE_EDITOR_REAL_SMOKE_CORRECTNESS_HARDENING_V1 — Finding F: the Production filter default belongs to the CALLER.
// Static composition (Project-scoped durable media) opens on "Todas as Productions"; AI Video keeps "Production atual".
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  PROD_CURRENT,
  PROD_OTHER,
  PROJECT,
  OTHER_PROJECT,
  freshState,
  installI2vFetch,
  libraryRow,
  type I2vFixtureState,
} from '@/lib/__tests__/helpers/i2v-source-fixtures'

let state: I2vFixtureState

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        then: (resolve: (value: unknown) => void) => resolve({ data: state.productions }),
      }
      return chain
    },
  }),
}))

import { I2vSourceBrowser } from './i2v-source-browser'

beforeAll(() => {
  const proto = window.HTMLElement.prototype as any
  proto.hasPointerCapture ??= () => false
  proto.setPointerCapture ??= () => undefined
  proto.releasePointerCapture ??= () => undefined
  proto.scrollIntoView ??= () => undefined
  ;(window as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }
})

beforeEach(() => {
  state = freshState()
  state.pageSize = 20
  state.library = [
    libraryRow('sem-production'), // a normal Project Library upload: NO Production association
    libraryRow('da-production-atual', { production_id: PROD_CURRENT }),
    libraryRow('de-outra-production', { production_id: PROD_OTHER }),
    libraryRow('de-outro-projeto', { project_id: OTHER_PROJECT }),
  ]
  vi.stubGlobal('fetch', installI2vFetch(state))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const mount = (props: { productionId?: string | null; defaultProductionMode?: 'current' | 'all' | 'unscoped' } = {}) =>
  render(<I2vSourceBrowser projectId={PROJECT} productionId={props.productionId === undefined ? PROD_CURRENT : props.productionId} selectedId={null} onSelect={() => {}} onClose={() => {}} {...(props.defaultProductionMode ? { defaultProductionMode: props.defaultProductionMode } : {})} />)
const openArquivos = async () => {
  fireEvent.click(screen.getByTestId('i2v-source-tab-library'))
  await screen.findByTestId('i2v-source-filters')
}
const shown = () => screen.queryAllByTestId(/^i2v-library-option-/).map((node) => node.getAttribute('data-testid')!.replace('i2v-library-option-', '')).sort()
const waitList = async () => { await screen.findByTestId('i2v-library-option-sem-production').catch(() => undefined); await new Promise((resolve) => setTimeout(resolve, 0)) }
const filterLabel = () => screen.getByTestId('i2v-source-production-filter').textContent
const lastLibraryParams = () => new URL(state.requests.filter((url) => url.startsWith('/api/library-files/browse?')).at(-1)!, 'http://x').searchParams
const chooseProduction = async (label: string | RegExp) => {
  fireEvent.keyDown(screen.getByTestId('i2v-source-production-filter'), { key: 'Enter' })
  fireEvent.click(await screen.findByRole('option', { name: label }))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('Static caller (defaultProductionMode="all")', () => {
  it('32/33. opens on "Todas as Productions" and the no-Production file is visible immediately, with the other Productions of the Project', async () => {
    mount({ defaultProductionMode: 'all' })
    await openArquivos()
    await waitList()
    expect(filterLabel()).toBe('Todas as Productions')
    expect(lastLibraryParams().get('production')).toBe('all')
    expect(shown()).toEqual(['da-production-atual', 'de-outra-production', 'sem-production'])
  })

  it('34. "Production atual" still filters to the current Production when chosen explicitly', async () => {
    mount({ defaultProductionMode: 'all' })
    await openArquivos()
    await chooseProduction(/Production atual/)
    expect(lastLibraryParams().get('production')).toBe(PROD_CURRENT)
    expect(shown()).toEqual(['da-production-atual'])
  })

  it('35. another Production still filters when it is the "atual" one of the caller (explicit choice)', async () => {
    mount({ productionId: PROD_OTHER, defaultProductionMode: 'all' })
    await openArquivos()
    await chooseProduction(/Production atual/)
    expect(lastLibraryParams().get('production')).toBe(PROD_OTHER)
    expect(shown()).toEqual(['de-outra-production'])
  })

  it('"Sem Production" still lists only the files without one', async () => {
    mount({ defaultProductionMode: 'all' })
    await openArquivos()
    await chooseProduction('Sem Production')
    expect(shown()).toEqual(['sem-production'])
  })

  it('37. project scoping is intact: another Project file is never listed, whatever the filter', async () => {
    mount({ defaultProductionMode: 'all' })
    await openArquivos()
    await waitList()
    expect(shown()).not.toContain('de-outro-projeto')
    expect(lastLibraryParams().get('projectId')).toBe(PROJECT)
  })
})

describe('AI Video caller (no prop): the default is unchanged', () => {
  it('36. still opens on "Production atual" and hides a file without Production until the user widens the filter', async () => {
    mount()
    await openArquivos()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(filterLabel()).toContain('Production atual')
    expect(lastLibraryParams().get('production')).toBe(PROD_CURRENT)
    expect(shown()).toEqual(['da-production-atual'])
    await chooseProduction('Todas as Productions')
    expect(shown()).toEqual(['da-production-atual', 'de-outra-production', 'sem-production'])
  })

  it('36. the dialog of AI Video does not pass the Static default (the browser default is a prop, not a global)', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(`${process.cwd()}/components/videos/create-video-generation-dialog.tsx`, 'utf-8')
    expect(source).not.toContain('defaultProductionMode')
  })
})
