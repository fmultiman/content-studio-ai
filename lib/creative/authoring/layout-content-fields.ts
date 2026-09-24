/**
 * Portal Carousel Completion V1 — Content tab fields for the structured
 * layouts (Lista, Grade, Mapa, Rede, Citação, Encerramento).
 *
 * UI-only descriptors: which content fields the Editor exposes, with the SAME
 * bounds as the layout's content schema (lib/schemas/creative/documentary-card.ts)
 * so the form can never produce something the renderer rejects. Not a generic
 * form engine: one closed set of field kinds, one descriptor per layout.
 */
import { BRAZIL_UF_CODES, type DocumentaryCardIcon } from '@/lib/schemas/creative/documentary-card'
import type { AuthoringVariant } from './types'

export type ItemFieldDescriptor =
  | { kind: 'icon'; key: string; label: string }
  | { kind: 'uf'; key: string; label: string }
  | { kind: 'text'; key: string; label: string; rows?: number; optional?: boolean }

export type ContentFieldDescriptor =
  | { kind: 'text'; key: string; label: string; rows?: number; optional?: boolean; hint?: string }
  /** A list of plain strings (one Textarea each). */
  | { kind: 'strings'; key: string; label: string; itemLabel: string; min: number; max: number; optional?: boolean; newItem: string }
  /** A list of small records (icon + text, name + UF…). */
  | { kind: 'items'; key: string; label: string; itemLabel: string; min: number; max: number; optional?: boolean; fields: readonly ItemFieldDescriptor[]; newItem: Record<string, unknown> }
  /** An optional sub-object the author includes or leaves out as a whole. */
  | { kind: 'group'; key: string; label: string; fields: readonly ContentFieldDescriptor[]; newValue: Record<string, unknown> }

const BOLD_HINT = 'Use **texto** para destacar em negrito.'
const title: ContentFieldDescriptor = { kind: 'text', key: 'title', label: 'Título', rows: 2 }
const intro: ContentFieldDescriptor = { kind: 'text', key: 'intro', label: 'Introdução', rows: 3, optional: true, hint: BOLD_HINT }
const iconLabel = (label: string): readonly ItemFieldDescriptor[] => [{ kind: 'icon', key: 'icon', label: 'Ícone' }, { kind: 'text', key: 'label', label }]

export const LAYOUT_CONTENT_FIELDS: Readonly<Partial<Record<AuthoringVariant, readonly ContentFieldDescriptor[]>>> = {
  list: [
    title,
    intro,
    { kind: 'items', key: 'items', label: 'Itens', itemLabel: 'Item', min: 2, max: 4, fields: [{ kind: 'icon', key: 'icon', label: 'Ícone' }, { kind: 'text', key: 'text', label: 'Texto', rows: 3 }], newItem: { icon: 'dot', text: 'Novo item' } },
    { kind: 'text', key: 'image_caption', label: 'Legenda da imagem', rows: 2, optional: true },
    { kind: 'text', key: 'callout', label: 'Destaque final', rows: 3, optional: true },
  ],
  grid: [
    title,
    intro,
    { kind: 'items', key: 'tiles', label: 'Temas', itemLabel: 'Tema', min: 2, max: 6, fields: iconLabel('Rótulo'), newItem: { icon: 'dot', label: 'novo tema' } },
    { kind: 'text', key: 'ideas_title', label: 'Título das ideias', rows: 1, optional: true },
    { kind: 'items', key: 'ideas', label: 'Ideias', itemLabel: 'Ideia', min: 0, max: 6, optional: true, fields: iconLabel('Rótulo'), newItem: { icon: 'dot', label: 'nova ideia' } },
  ],
  map: [
    title,
    intro,
    { kind: 'items', key: 'places', label: 'Lugares', itemLabel: 'Lugar', min: 1, max: 12, fields: [{ kind: 'text', key: 'name', label: 'Nome' }, { kind: 'uf', key: 'uf', label: 'UF' }], newItem: { name: 'Novo lugar', uf: 'SP' } },
    { kind: 'text', key: 'places_more', label: 'Linha final da legenda', rows: 1, optional: true },
    { kind: 'text', key: 'note', label: 'Nota', rows: 3, optional: true },
  ],
  network: [
    title,
    { kind: 'text', key: 'kicker', label: 'Chamada', rows: 1, optional: true },
    intro,
    { kind: 'items', key: 'nodes', label: 'Cartões', itemLabel: 'Cartão', min: 3, max: 9, fields: [{ kind: 'text', key: 'title', label: 'Nome' }, { kind: 'text', key: 'subtitle', label: 'Complemento', optional: true }], newItem: { title: 'Novo cartão' } },
    {
      kind: 'group', key: 'callout', label: 'Caixa de destaque', newValue: { icon: 'radio', text: 'Texto do destaque' },
      fields: [
        { kind: 'text', key: 'text', label: 'Texto', rows: 3, hint: BOLD_HINT },
        { kind: 'strings', key: 'bullets', label: 'Tópicos', itemLabel: 'Tópico', min: 0, max: 9, optional: true, newItem: 'novo tópico' },
      ],
    },
  ],
  quote: [
    title,
    intro,
    { kind: 'strings', key: 'bullets', label: 'Tópicos', itemLabel: 'Tópico', min: 0, max: 4, optional: true, newItem: 'novo tópico' },
    { kind: 'text', key: 'quote', label: 'Citação', rows: 3 },
    { kind: 'text', key: 'callout', label: 'Destaque final', rows: 2, optional: true },
  ],
  closing: [
    { kind: 'text', key: 'title', label: 'Título (Enter quebra a linha)', rows: 3 },
    { kind: 'strings', key: 'body', label: 'Texto', itemLabel: 'Parágrafo', min: 1, max: 3, newItem: 'Novo parágrafo.' },
    { kind: 'items', key: 'items', label: 'Materiais', itemLabel: 'Material', min: 0, max: 6, optional: true, fields: iconLabel('Rótulo'), newItem: { icon: 'book', label: 'novo material' } },
    { kind: 'text', key: 'cta_title', label: 'Convite — título', rows: 1, optional: true },
    { kind: 'text', key: 'cta_text', label: 'Convite — texto', rows: 2, optional: true },
    { kind: 'text', key: 'contact', label: 'Contato', rows: 1, optional: true },
    { kind: 'text', key: 'tagline', label: 'Assinatura', rows: 1, optional: true },
    { kind: 'text', key: 'brand_label', label: 'Nome da marca', rows: 1, optional: true },
  ],
}

/** Product labels for the closed icon set (never the raw id). */
export const ICON_LABELS: Readonly<Record<DocumentaryCardIcon, string>> = {
  microphone: 'Microfone', pencil: 'Lápis', book: 'Livro', dot: 'Marcador', nuclear: 'Nuclear', globe: 'Globo', factory: 'Fábrica',
  cart: 'Carrinho', leaf: 'Folhas', tree: 'Árvore', buildings: 'Prédios', harvest: 'Colheita', house: 'Casa', star: 'Estrela',
  people: 'Pessoas', consensus: 'Consenso', gear: 'Engrenagem', community: 'Comunidade', lock: 'Cadeado', sprout: 'Broto',
  radio: 'Rádio', magazine: 'Revista', newspaper: 'Jornal', bulletin: 'Boletim', tape: 'Fita cassete', photo: 'Fotografia', envelope: 'Envelope',
}

export const UF_OPTIONS: readonly string[] = BRAZIL_UF_CODES
