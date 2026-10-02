/**
 * STATIC_TEMPLATE_ANATOMY_TREE_V1 — Template Anatomy SECTIONS.
 *
 * A Section is a DERIVED, layout-scoped UI grouping of a Layout's existing
 * Template Elements (Template → Layout → Section → Element). It exists only so
 * the Inspector "Elementos" tab can explain a composition ("what is this
 * Layout made of?"). It is NOT persisted authored state, NOT a Group entity,
 * NOT a scene-graph node and NOT read by the renderer, the worker or any
 * save/enqueue path — which is also why it lives beside (not inside)
 * template-definitions.ts, the file the render worker bundles verbatim.
 *
 * Membership references the SAME stable Template Element ids the layout
 * already declares (`TemplateLayoutDefinition.elements`); no identity is
 * invented. Anything a layout draws that is not an Element (page number, gold
 * rules, background chrome, per-item geometry inside a compound element) is
 * internal implementation and is deliberately absent.
 *
 * Pure and dependency-free, like template-definitions.
 */
import { EDITORIAL_DOCUMENTARY_COLLAGE_V1, type TemplateDefinition, type TemplateElementDefinition, type TemplateLayoutDefinition } from './template-definitions'

export type TemplateSectionDefinition = {
  /** Stable UI id, unique inside its layout. Never persisted. */
  id: string
  /** Human label shown in the Elementos tab. */
  label: string
  /** Template Element ids (as declared by the layout) that belong to the section, in display order. */
  elementIds: readonly string[]
}

export type ResolvedTemplateSection = {
  id: string
  label: string
  elements: TemplateElementDefinition[]
}

/** Id of the deterministic fallback section for an Element no section claims (a future Element never vanishes). */
export const OTHER_SECTION_ID = 'other'

const section = (id: string, label: string, ...elementIds: string[]): TemplateSectionDefinition => ({ id, label, elementIds })

const TITLE_BLOCK = 'title-block'
const DECORATION = 'decoration'

/** editorial-documentary-collage-v1 — Section registry, layout id → sections (display order, top to bottom). */
const EDITORIAL_DOCUMENTARY_COLLAGE_SECTIONS: Readonly<Record<string, readonly TemplateSectionDefinition[]>> = {
  cover: [
    section('header', 'Cabeçalho', 'kicker'),
    section(TITLE_BLOCK, 'Bloco de título', 'title', 'paper'),
    section('intro', 'Introdução', 'intro'),
    section('source-editorial', 'Fonte editorial', 'source'),
    section('hero', 'Hero', 'tape1', 'hero'),
    section('editorial-note', 'Nota editorial', 'tape2', 'noteText', 'note'),
    section('signature', 'Assinatura', 'brandLogo'),
    section(DECORATION, 'Decoração', 'botanical', 'botanicalLeaf', 'archival', 'ornament'),
  ],
  info: [
    section(TITLE_BLOCK, 'Bloco de título', 'title', 'paperStrip', 'paperDark'),
    section('card-1', 'Cartão 1', 'card1', 'card1Text', 'pin'),
    section('card-2', 'Cartão 2', 'paper', 'card2Text', 'pin2'),
    section('body', 'Texto de apoio', 'bodyText', 'annotation'),
    section('intro-banner', 'Faixa da chamada', 'introBanner', 'introText'),
    section('signature', 'Assinatura', 'brandTab', 'brandLogo'),
    section('source-credit', 'Fonte e crédito', 'source'),
    section(DECORATION, 'Decoração', 'botanicalLeaf', 'botanical', 'tape1', 'tape2', 'tape3', 'archival'),
  ],
  list: [
    section(TITLE_BLOCK, 'Bloco de título', 'title', 'paperStrip'),
    section('intro', 'Introdução', 'intro'),
    section('items', 'Itens', 'items'),
    section('hero', 'Hero · imagem do documento', 'heroFrame', 'hero', 'tape1'),
    section('caption', 'Legenda', 'note', 'noteText', 'tape2'),
    section('callout', 'Destaque', 'callout', 'calloutText'),
    section('signature', 'Assinatura', 'brandLogo'),
    section(DECORATION, 'Decoração', 'botanicalLeaf', 'botanical', 'archival'),
  ],
  grid: [
    section(TITLE_BLOCK, 'Bloco de título', 'title', 'paperStrip', 'tape1'),
    section('intro', 'Introdução', 'intro'),
    section('tiles', 'Grade de temas', 'tiles'),
    section('ideas', 'Ideias transversais', 'note', 'ideasText'),
    section(DECORATION, 'Decoração', 'botanicalLeaf', 'archival'),
  ],
  map: [
    section(TITLE_BLOCK, 'Bloco de título', 'title', 'paperStrip'),
    section('intro', 'Introdução', 'intro'),
    section('map', 'Mapa', 'map', 'mapPins'),
    section('legend', 'Legenda', 'legend'),
    section('map-note', 'Nota do mapa', 'note', 'noteText', 'tape1'),
    section(DECORATION, 'Decoração', 'botanicalLeaf', 'botanical'),
  ],
  network: [
    section(TITLE_BLOCK, 'Bloco de título', 'title', 'paperStrip'),
    section('header', 'Chamada e introdução', 'kicker', 'intro'),
    section('network', 'Rede', 'links', 'cards', 'cardsText'),
    section('callout', 'Destaque', 'callout', 'calloutText'),
    section(DECORATION, 'Decoração', 'ornament'),
  ],
  quote: [
    section(TITLE_BLOCK, 'Bloco de título', 'title', 'paperStrip'),
    section('intro', 'Introdução e tópicos', 'intro', 'bullets'),
    section('quote', 'Citação', 'quote', 'quoteText', 'tape1'),
    section('hero', 'Hero · imagem', 'heroFrame', 'hero'),
    section('callout', 'Destaque', 'callout', 'calloutText'),
    section(DECORATION, 'Decoração', 'botanicalLeaf'),
  ],
  closing: [
    section(TITLE_BLOCK, 'Bloco de título', 'title'),
    section('body', 'Texto de apoio', 'body', 'items'),
    section('invitation', 'Convite', 'note', 'inviteText', 'tape1'),
    section('signature', 'Assinatura', 'brandLogo'),
    section('closing-line', 'Fecho', 'divider', 'tagline'),
    section(DECORATION, 'Decoração', 'ornament', 'botanicalLeaf', 'botanical'),
  ],
}

const SECTIONS_BY_TEMPLATE: Readonly<Record<string, Readonly<Record<string, readonly TemplateSectionDefinition[]>>>> = {
  [EDITORIAL_DOCUMENTARY_COLLAGE_V1]: EDITORIAL_DOCUMENTARY_COLLAGE_SECTIONS,
}

/**
 * The Sections of a layout, resolved against its real Elements. Deterministic
 * and total: ids the layout does not declare are dropped, an Element claimed
 * twice stays in its first section, and any Element no section claims lands in
 * a trailing fallback section (so the tree always lists every Element exactly
 * once, and only Elements the layout really has). Empty sections are omitted.
 */
export function resolveLayoutSections(template: Pick<TemplateDefinition, 'id'>, layout: Pick<TemplateLayoutDefinition, 'id' | 'elements'>): ResolvedTemplateSection[] {
  const declared = SECTIONS_BY_TEMPLATE[template.id]?.[layout.id] ?? []
  const byId = new Map(layout.elements.map((element) => [element.id, element]))
  const placed = new Set<string>()
  const resolved: ResolvedTemplateSection[] = []
  for (const definition of declared) {
    const elements: TemplateElementDefinition[] = []
    for (const id of definition.elementIds) {
      const element = byId.get(id)
      if (!element || placed.has(id)) continue
      placed.add(id)
      elements.push(element)
    }
    if (elements.length > 0) resolved.push({ id: definition.id, label: definition.label, elements })
  }
  const orphans = layout.elements.filter((element) => !placed.has(element.id))
  if (orphans.length > 0) resolved.push({ id: OTHER_SECTION_ID, label: 'Outros elementos', elements: orphans })
  return resolved
}

/** The registered section definitions of a layout (raw, unresolved) — for registry-level checks. */
export function getLayoutSectionDefinitions(templateId: string, layoutId: string): readonly TemplateSectionDefinition[] {
  return SECTIONS_BY_TEMPLATE[templateId]?.[layoutId] ?? []
}
