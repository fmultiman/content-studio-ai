// @vitest-environment jsdom
/**
 * Integration regression for the Creative Editor Dockview workbench (real
 * dockview-react, real Radix Tabs). Guards the 66354e6 production failure:
 * clicks landed but Dockview-hosted panels were frozen on their first render.
 */
import { useState } from 'react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CreativeWorkbench } from './creative-workbench'

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  window.matchMedia ??= ((query: string) => ({
    matches: true, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
})

afterEach(cleanup)

function Harness() {
  const [count, setCount] = useState(0)
  const [section, setSection] = useState('template')
  return (
    <div style={{ width: 1200, height: 700 }}>
      <CreativeWorkbench
        canvas={<div><span data-testid="canvas-count">{count}</span><button type="button" onClick={() => setCount((value) => value + 1)}>Aumentar zoom</button></div>}
        inspector={(
          <div>
            <span data-testid="inspector-count">{count}</span>
            <Tabs value={section} onValueChange={setSection}>
              <TabsList>
                <TabsTrigger value="template">Template</TabsTrigger>
                <TabsTrigger value="content">Conteúdo</TabsTrigger>
              </TabsList>
              <TabsContent value="template">template-panel</TabsContent>
              <TabsContent value="content">content-panel</TabsContent>
            </Tabs>
            <button type="button" data-testid="inner-control" onClick={() => setCount((value) => value + 1)}>inner</button>
          </div>
        )}
      />
    </div>
  )
}

async function renderWorkbench() {
  const view = render(<Harness />)
  // Dockview adds panels in onReady; their portals mount on the following render.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  const palette = view.container.querySelector<HTMLElement>('.dv-floating-overlay-host > .dv-resize-container')
  if (!palette) throw new Error('floating Inspector palette not mounted')
  return { ...view, palette }
}

describe('CreativeWorkbench (Dockview integration)', () => {
  it('re-renders Canvas and Inspector panels with live page state (no frozen portal closures)', async () => {
    await renderWorkbench()
    expect(screen.getByTestId('canvas-count').textContent).toBe('0')
    fireEvent.click(screen.getByText('Aumentar zoom'))
    expect(screen.getByTestId('canvas-count').textContent).toBe('1')
    expect(screen.getByTestId('inspector-count').textContent).toBe('1')
    fireEvent.click(screen.getByTestId('inner-control'))
    expect(screen.getByTestId('canvas-count').textContent).toBe('2')
  })

  it('switches Inspector section content when a tab is clicked', async () => {
    await renderWorkbench()
    expect(screen.getByText('template-panel')).toBeTruthy()
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Conteúdo' }), { button: 0 })
    expect(screen.getByText('content-panel')).toBeTruthy()
    expect(screen.queryByText('template-panel')).toBeNull()
  })

  it('only the palette header starts a drag; internal controls never do', async () => {
    const { palette } = await renderWorkbench()
    const inner = screen.getByTestId('inner-control')
    fireEvent.pointerDown(inner, { pointerId: 1, button: 0, clientX: 50, clientY: 50 })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 120, clientY: 140 })
    expect(palette.classList.contains('dv-resize-container-dragging')).toBe(false)
    fireEvent.pointerUp(window, { pointerId: 1 })

    const tab = screen.getByRole('tab', { name: 'Template' })
    fireEvent.pointerDown(tab, { pointerId: 2, button: 0, clientX: 50, clientY: 50 })
    fireEvent.pointerMove(window, { pointerId: 2, clientX: 120, clientY: 140 })
    expect(palette.classList.contains('dv-resize-container-dragging')).toBe(false)
    fireEvent.pointerUp(window, { pointerId: 2 })

    const handle = palette.querySelector<HTMLElement>('.dv-void-container')
    expect(handle).toBeTruthy()
    fireEvent.pointerDown(handle!, { pointerId: 3, button: 0, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(window, { pointerId: 3, clientX: 60, clientY: 80 })
    expect(palette.classList.contains('dv-resize-container-dragging')).toBe(true)
    fireEvent.pointerUp(window, { pointerId: 3 })
    expect(palette.classList.contains('dv-resize-container-dragging')).toBe(false)
  })

  it('disables docking: no draggable tabs or drag handles', async () => {
    const { container } = await renderWorkbench()
    const draggables = [...container.querySelectorAll<HTMLElement>('.dv-tab, .dv-void-container')].filter((element) => element.draggable)
    expect(draggables).toHaveLength(0)
  })

  it('minimizes to the header and restores the Inspector content', async () => {
    const { palette } = await renderWorkbench()
    expect(screen.getByTestId('inspector-body')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Minimizar Inspector' }))
    expect(screen.queryByTestId('inspector-body')).toBeNull()
    expect(palette.classList.contains('creative-inspector-minimized')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Restaurar Inspector' }))
    expect(screen.getByTestId('inspector-body')).toBeTruthy()
    expect(palette.classList.contains('creative-inspector-minimized')).toBe(false)
    // Section state belongs to the page, not the palette: restore keeps it.
    expect(screen.getByText('template-panel')).toBeTruthy()
  })
})
