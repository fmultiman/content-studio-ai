/**
 * STATIC_TEMPLATE_ANATOMY_TREE_V1 — Section registry: factual per-Layout anatomy,
 * derived-only (never persisted / rendered), no invented Element identity.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EDITORIAL_DOCUMENTARY_COLLAGE_TEMPLATE as TEMPLATE, getTemplateLayout } from '../template-definitions'
import { OTHER_SECTION_ID, getLayoutSectionDefinitions, resolveLayoutSections } from '../template-anatomy'

const sectionsOf = (layoutId: string) => {
  const layout = getTemplateLayout(TEMPLATE, layoutId)!
  return resolveLayoutSections(TEMPLATE, layout).map((section) => [section.label, section.elements.map((element) => element.id)] as const)
}

describe('Documentary layouts expose their factual semantic Sections', () => {
  it('Cover', () => {
    expect(sectionsOf('cover')).toEqual([
      ['Bloco de título', ['title', 'paper']],
      ['Hero', ['hero', 'tape1']],
      ['Nota editorial', ['note', 'tape2']],
      ['Decoração', ['botanical', 'botanicalLeaf', 'archival', 'ornament']],
    ])
  })
  it('Info', () => {
    expect(sectionsOf('info')).toEqual([
      ['Bloco de título', ['title', 'paperStrip', 'paperDark']],
      ['Cartão 1', ['card1', 'pin']],
      ['Cartão 2', ['paper', 'pin2', 'tape3']],
      ['Fonte e crédito', ['source']],
      ['Decoração', ['botanicalLeaf', 'botanical', 'tape1', 'tape2', 'archival']],
    ])
  })
  it('Lista', () => {
    expect(sectionsOf('list')).toEqual([
      ['Bloco de título', ['title', 'paperStrip']],
      ['Hero · imagem do documento', ['hero', 'tape1']],
      ['Legenda', ['note', 'tape2']],
      ['Destaque', ['callout']],
      ['Decoração', ['botanicalLeaf', 'botanical', 'archival']],
    ])
  })
  it('Grade', () => {
    expect(sectionsOf('grid')).toEqual([
      ['Bloco de título', ['title', 'paperStrip', 'tape1']],
      ['Grade de temas', ['tiles']],
      ['Ideias transversais', ['note']],
      ['Decoração', ['botanicalLeaf', 'archival']],
    ])
  })
  it('Mapa', () => {
    expect(sectionsOf('map')).toEqual([
      ['Bloco de título', ['title', 'paperStrip']],
      ['Mapa', ['map']],
      ['Nota do mapa', ['note', 'tape1']],
      ['Decoração', ['botanicalLeaf', 'botanical']],
    ])
  })
  it('Rede', () => {
    expect(sectionsOf('network')).toEqual([
      ['Bloco de título', ['title', 'paperStrip']],
      ['Rede', ['cards']],
      ['Destaque', ['callout']],
      ['Decoração', ['ornament']],
    ])
  })
  it('Citação', () => {
    expect(sectionsOf('quote')).toEqual([
      ['Bloco de título', ['title', 'paperStrip']],
      ['Citação', ['quote', 'tape1']],
      ['Hero · imagem', ['hero']],
      ['Destaque', ['callout']],
      ['Decoração', ['botanicalLeaf']],
    ])
  })
  it('Encerramento', () => {
    expect(sectionsOf('closing')).toEqual([
      ['Bloco de título', ['title']],
      ['Convite', ['note', 'tape1']],
      ['Decoração', ['ornament', 'botanicalLeaf', 'botanical']],
    ])
  })
})

describe('Section invariants (all layouts)', () => {
  for (const layout of TEMPLATE.layouts) {
    it(`${layout.id}: lists every real Element exactly once and invents none`, () => {
      const listed = resolveLayoutSections(TEMPLATE, layout).flatMap((section) => section.elements.map((element) => element.id))
      expect([...listed].sort()).toEqual(layout.elements.map((element) => element.id).sort())
      expect(new Set(listed).size).toBe(listed.length)
      // Registered membership is fully backed by real Elements: nothing falls to the fallback section.
      expect(resolveLayoutSections(TEMPLATE, layout).some((section) => section.id === OTHER_SECTION_ID)).toBe(false)
      const real = new Set(layout.elements.map((element) => element.id))
      for (const definition of getLayoutSectionDefinitions(TEMPLATE.id, layout.id)) for (const id of definition.elementIds) expect(real.has(id)).toBe(true)
    })
    it(`${layout.id}: section ids are unique and resolution is deterministic and non-mutating`, () => {
      const before = JSON.stringify(layout)
      const first = resolveLayoutSections(TEMPLATE, layout)
      expect(new Set(first.map((section) => section.id)).size).toBe(first.length)
      expect(resolveLayoutSections(TEMPLATE, layout)).toEqual(first)
      // Paint-order semantics and the Element set are untouched by Sections.
      expect(JSON.stringify(layout)).toBe(before)
    })
  }

  it('an Element no section claims still appears, once, in a trailing fallback section; unknown ids are dropped', () => {
    const layout = { id: 'cover', elements: [...getTemplateLayout(TEMPLATE, 'cover')!.elements, { id: 'fresh', label: 'Novo', kind: 'material' as const, control: { type: 'transform' as const, key: 'paper' as const } }] }
    const resolved = resolveLayoutSections(TEMPLATE, layout)
    expect(resolved[resolved.length - 1]).toMatchObject({ id: OTHER_SECTION_ID })
    expect(resolved[resolved.length - 1].elements.map((element) => element.id)).toEqual(['fresh'])
    expect(resolveLayoutSections(TEMPLATE, { id: 'not-registered', elements: layout.elements.slice(0, 2) }).map((section) => section.id)).toEqual([OTHER_SECTION_ID])
  })
})

describe('Sections are UI/registry metadata only (never persisted, never rendered)', () => {
  const ROOT = process.cwd()
  function sources(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(join(ROOT, dir))) {
      const path = join(dir, name)
      if (statSync(join(ROOT, path)).isDirectory()) { if (name !== '__tests__' && name !== 'node_modules') sources(path, out) } else if (/\.(ts|tsx|mjs)$/.test(name) && !/\.test\./.test(name)) out.push(path)
    }
    return out
  }
  it('no persistence, render, worker or renderer source imports the anatomy registry', () => {
    const consumers = [...sources('lib/creative/authoring'), ...sources('lib/render-execution'), ...sources('components/creative/documentary-card'), ...sources('components/creative/free'), 'infra/render-worker-runtime/export.mjs']
    for (const file of consumers) {
      let text = ''
      try { text = readFileSync(join(ROOT, file), 'utf8') } catch { continue }
      expect(text.includes('template-anatomy'), file).toBe(false)
    }
  })
  it('the worker export list does not carry the anatomy registry', () => {
    expect(readFileSync(join(ROOT, 'infra/render-worker-runtime/export.mjs'), 'utf8')).not.toContain('template-anatomy')
  })
})
