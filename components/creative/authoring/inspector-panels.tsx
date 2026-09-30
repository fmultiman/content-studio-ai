'use client'

import { ImageIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  layoutAssetSlots,
  layoutElementsFrontFirst,
  type AuthoringSlotView,
  type TemplateDefinition,
  type TemplateLayoutDefinition,
} from '@/lib/creative/templates/template-definitions'
import { SLOT_ORIGIN_LABELS, type SlotResource } from '@/lib/creative/authoring/asset-slots'
import type { VisualTokensSnapshot } from '@/lib/schemas/creative/primitives'

/**
 * Template tab — "Estrutura do layout": the active layout's grammar, read
 * straight from the Template registry (elements front-first, slots in
 * first-use order). READ-ONLY: no add / delete / rename / slot editing —
 * that is future Master / Template Development, not the Creative Editor.
 */
export function TemplateAnatomy({ template, layout }: { template: TemplateDefinition; layout: TemplateLayoutDefinition }) {
  const elements = layoutElementsFrontFirst(layout)
  const slots = layoutAssetSlots(template, layout)
  return (
    <section className="space-y-2 rounded-md border border-border/60 p-2" aria-label="Estrutura do layout" data-testid="template-anatomy">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Estrutura do layout</h3>
        <span className="text-[10px] text-muted-foreground">somente leitura</span>
      </div>
      <div>
        <p className="text-[11px] font-medium">Elementos do layout <span className="font-normal text-muted-foreground">({elements.length}, da frente para trás)</span></p>
        <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground" data-testid="anatomy-elements">
          {elements.map((element) => <li key={element.id} className="truncate">{element.label}</li>)}
        </ul>
      </div>
      <div>
        <p className="text-[11px] font-medium">Slots de assets <span className="font-normal text-muted-foreground">({slots.length})</span></p>
        <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground" data-testid="anatomy-slots">
          {slots.map(({ slot, elements: users }) => (
            <li key={slot.id} className="min-w-0">
              <span className="text-foreground/80">{slot.label}</span>
              <span> · {users.map((element) => element.label).join(', ')}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/** Template family grammar. This stays separate from the selected layout's concrete elements and slots. */
export function TemplateFamilyAnatomy({ template }: { template: TemplateDefinition }) {
  return (
    <section className="space-y-2 rounded-md border border-border/60 p-2" aria-label="Estrutura do Template" data-testid="template-family-anatomy">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Estrutura do Template</h3>
        <span className="text-[10px] text-muted-foreground">somente leitura</span>
      </div>
      <ul className="space-y-1 text-[11px] text-muted-foreground" data-testid="template-anatomy-regions">
        {template.anatomy.map((region) => (
          <li key={region.id}>
            <span className="font-medium text-foreground/80">{region.label}</span>
            <span className="block">{region.description}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * CREATIVE_EDITOR_TRUTHFUL_CONSTRAINTS_CLEANUP_V1 — the Template tab's
 * structural REFERENCE, collapsed by default: the Template family vocabulary
 * and the active layout's concrete elements and slots. It is information about
 * the grammar, never an editing surface (Elementos and Assets edit), and never
 * a Template Builder. Native <details> keeps the disclosure keyboard/AT
 * accessible without new state.
 */
export function TemplateReference({ template, layout }: { template: TemplateDefinition; layout?: TemplateLayoutDefinition | null }) {
  return (
    <details className="group rounded-md border border-border/60" data-testid="template-reference">
      <summary className="cursor-pointer select-none px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
        Estrutura do template e do layout <span className="font-normal">(referência, somente leitura)</span>
      </summary>
      <div className="space-y-2 border-t border-border/60 p-2">
        <p className="text-[11px] text-muted-foreground">O que este template e este layout contêm. Para editar, use Elementos (ordem e visibilidade) e Assets (recursos).</p>
        <TemplateFamilyAnatomy template={template} />
        {layout ? <TemplateAnatomy template={template} layout={layout} /> : null}
      </div>
    </details>
  )
}

/**
 * Assets tab — one consistent card per slot the active layout uses: what the
 * slot is, which resource currently fills it, where that resource comes from,
 * and whether it can be replaced / returned to the Template default.
 * Resource selection only: placement and stacking stay in Elementos.
 */
export function AssetSlotCard({
  slot,
  resource,
  usedBy,
  onReplace,
  onUseDefault,
}: {
  slot: AuthoringSlotView
  resource: SlotResource
  usedBy: readonly string[]
  onReplace: () => void
  onUseDefault: () => void
}) {
  return (
    <div className="flex min-w-0 gap-2 rounded-md border border-border/60 p-2" data-asset-slot={slot.id} data-origin={resource.origin}>
      <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded border border-border/60 bg-muted">
        {resource.thumbnailUrl
          // eslint-disable-next-line @next/next/no-img-element -- template fixture or short-lived signed Library URL
          ? <img src={resource.thumbnailUrl} alt="" className="h-full w-full object-contain" />
          : <ImageIcon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex min-w-0 items-center justify-between gap-1">
          <span className="truncate text-xs font-medium">{slot.label}</span>
          <span className={`shrink-0 rounded px-1 py-px text-[10px] ${resource.origin === 'template' ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'}`} data-testid="asset-origin">{SLOT_ORIGIN_LABELS[resource.origin]}</span>
        </div>
        <p className={`truncate text-[11px] ${resource.missing ? 'text-destructive' : 'text-muted-foreground'}`} title={resource.name}>{resource.name}</p>
        <p className="truncate text-[10px] text-muted-foreground" title={usedBy.join(', ')}>Usado por: {usedBy.join(', ')}</p>
        <div className="flex flex-wrap gap-1 pt-0.5">
          <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={onReplace}>Trocar</Button>
          {resource.replaced ? <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={onUseDefault} title="Voltar ao recurso padrão do Template neste slot">Usar padrão</Button> : null}
        </div>
      </div>
    </div>
  )
}

/**
 * Estilo tab — FACTUAL source of the tokens the renderer uses. The product
 * adapter (lib/creative/integration/project-identity-adapter.ts) resolves
 * typography and colors from the Project Identity visual tokens when the
 * Project defines them (each token independently), else the Studio defaults;
 * each layout's appearance (Light/Dark) then sets its own palette. Read-only;
 * no per-element overrides yet.
 */
export function StyleSourcePanel({ tokens, unitLabel = 'slide', free = false }: { tokens: VisualTokensSnapshot | undefined; unitLabel?: 'slide' | 'cena'; free?: boolean }) {
  return (
    <div className="space-y-2" data-testid="style-source" data-free={free}>
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Identidade do Projeto.</span> A tipografia e as cores abaixo vêm da Identidade do Projeto quando ela as define; o que ela não define usa o padrão do Studio.{' '}
        {/* CREATIVE_EDITOR_FREE_DEFAULT_AND_TEMPLATE_ENTRY_V1: a free composition has no Appearance — its roles read these tokens directly. */}
        {free
          ? 'Na composição livre, o fundo e os papéis de cor e fonte dos textos usam estes valores diretamente.'
          : `As fontes seguem estes valores; as cores de fundo e texto de cada ${unitLabel} seguem a Aparência (Light/Dark) do Template.`}
      </p>
      <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Títulos</dt><dd className="truncate">{tokens?.typography.display.family ?? '—'}</dd>
        <dt className="text-muted-foreground">Texto</dt><dd className="truncate">{tokens?.typography.body.family ?? '—'}</dd>
      </dl>
      <div className="flex flex-wrap gap-1.5" aria-label="Cores do estilo do projeto">
        {Object.entries(tokens?.colors ?? {}).map(([name, value]) => <span key={name} title={`${name}: ${value}`} className="h-5 w-5 rounded border border-border/60" style={{ background: value }} />)}
      </div>
      <p className="text-[11px] text-muted-foreground">Somente leitura nesta versão.</p>
    </div>
  )
}
