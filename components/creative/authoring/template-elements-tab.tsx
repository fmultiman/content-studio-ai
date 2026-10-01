'use client'

import { useState, type ComponentProps, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Eye, EyeOff } from 'lucide-react'
import { ElementLayers } from '@/components/creative/authoring/element-layers'
import { FreeElementAddActions, FreeSceneElements } from '@/components/creative/video/free-scene-panels'
import { MAX_FREE_ELEMENTS, freeElements } from '@/lib/creative/video-editor/free-composition'
import type { ResolvedTemplateSection } from '@/lib/creative/templates/template-anatomy'

/**
 * STATIC_TEMPLATE_ANATOMY_TREE_V1 — the Template-mode "Elementos" tab.
 *
 * Three distinct things, never merged into one collection:
 *  1. ANATOMIA DO TEMPLATE — the Layout's Template-owned Elements, grouped by
 *     derived Sections (registry metadata, `template-anatomy.ts`). Rows reuse
 *     the existing per-element controls (open panel, eye); a Section adds none.
 *     Real paint order stays editable in "Ordem das camadas" (FRENTE → TRÁS).
 *  2. ADICIONAR ELEMENTOS — the author actions (Texto / Imagem).
 *  3. ELEMENTOS ADICIONADOS — the Custom Elements actually authored on this
 *     slide (an overlay above the Template), or a truthful empty state.
 *
 * Section expansion is local UI state: it is never dispatched, persisted or
 * part of the authoring state, so it can never dirty the slide.
 */

type CustomProps = Omit<ComponentProps<typeof FreeSceneElements>, 'hideAddActions' | 'emptyMessage'>

export function TemplateElementsTab({
  layoutLabel,
  sections,
  order,
  labels,
  openId,
  isDefaultOrder,
  hidden,
  onToggle,
  onToggleVisibility,
  onReorder,
  onRestoreDefault,
  renderPanel,
  custom,
}: {
  layoutLabel: string
  sections: readonly ResolvedTemplateSection[]
  /** Normalized paint order, back -> front (Template Elements only). */
  order: readonly string[]
  labels: Readonly<Record<string, string>>
  openId: string | null
  isDefaultOrder: boolean
  hidden: ReadonlySet<string>
  onToggle: (id: string) => void
  onToggleVisibility: (id: string) => void
  onReorder: (order: string[]) => void
  onRestoreDefault: () => void
  renderPanel: (id: string) => ReactNode
  custom: CustomProps
}) {
  const [orderOpen, setOrderOpen] = useState(false)
  const customFull = freeElements(custom.scene).length >= MAX_FREE_ELEMENTS
  return (
    <div className="space-y-4" data-testid="template-elements-tab">
      <section className="space-y-2" aria-labelledby="template-anatomy-heading" data-testid="template-anatomy">
        <h3 id="template-anatomy-heading" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Anatomia do template</h3>
        <p className="text-[11px] leading-snug text-muted-foreground">
          O que compõe o layout {layoutLabel}. Os grupos só organizam a lista — não são salvos e não mudam a composição.
        </p>
        {/* key: switching Layout starts from a fresh, fully expanded tree (UI state only). */}
        <TemplateAnatomyTree key={sections.map((section) => section.id).join('|')} sections={sections} labels={labels} openId={openId} hidden={hidden} onToggle={onToggle} onToggleVisibility={onToggleVisibility} renderPanel={renderPanel} />
        <div className="rounded-md border border-border/60" data-testid="template-layer-order">
          <button type="button" className="flex w-full items-center justify-between gap-1 px-2 py-1.5 text-left text-xs" aria-expanded={orderOpen} aria-controls="template-layer-order-panel" onClick={() => setOrderOpen((current) => !current)} data-testid="template-layer-order-toggle">
            <span>Ordem das camadas (frente → trás)</span>
            {orderOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />}
          </button>
          {orderOpen ? (
            <div id="template-layer-order-panel" className="border-t border-border/60 p-2">
              <ElementLayers
                orderOnly
                title="Ordem"
                order={order}
                labels={labels}
                openId={null}
                isDefault={isDefaultOrder}
                onToggle={onToggle}
                onReorder={onReorder}
                onRestoreDefault={onRestoreDefault}
                renderPanel={() => null}
                hidden={hidden}
                note={<p className="text-[11px] leading-snug text-muted-foreground">Arraste ≡ para trazer à frente ou levar para trás. É a ordem real de desenho do Template; os elementos adicionados ficam sempre acima dele.</p>}
              />
            </div>
          ) : null}
        </div>
      </section>

      <section className="space-y-2 border-t border-border/60 pt-4" aria-labelledby="add-elements-heading" data-testid="add-elements">
        <h3 id="add-elements-heading" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Adicionar elementos</h3>
        <FreeElementAddActions full={customFull} addImageLabel="Imagem" onAddText={custom.onAddText} onAddImage={custom.onAddImage} />
      </section>

      <section className="space-y-2 border-t border-border/60 pt-4" aria-labelledby="added-elements-heading" data-testid="added-elements">
        <h3 id="added-elements-heading" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Elementos adicionados</h3>
        <FreeSceneElements {...custom} hideAddActions emptyMessage="Nenhum elemento adicionado a este slide. Use Adicionar elementos para colocar um texto ou uma imagem sobre o template." />
      </section>
    </div>
  )
}

/** Sections (expandable groups) of Template Elements. Rows carry only controls the Element already had. */
export function TemplateAnatomyTree({
  sections,
  labels,
  openId,
  hidden,
  onToggle,
  onToggleVisibility,
  renderPanel,
}: {
  sections: readonly ResolvedTemplateSection[]
  labels: Readonly<Record<string, string>>
  openId: string | null
  hidden: ReadonlySet<string>
  onToggle: (id: string) => void
  onToggleVisibility: (id: string) => void
  renderPanel: (id: string) => ReactNode
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const toggleSection = (id: string) => setCollapsed((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  return (
    <div className="space-y-1.5" data-testid="template-anatomy-tree">
      {sections.map((section) => {
        const expanded = !collapsed.has(section.id)
        const listId = `anatomy-section-${section.id}`
        return (
          <div key={section.id} className="rounded-md border border-border/60" data-section-id={section.id} data-expanded={expanded ? 'true' : 'false'}>
            <button type="button" className="flex w-full items-center gap-1 px-2 py-1.5 text-left text-xs font-medium" aria-expanded={expanded} aria-controls={listId} onClick={() => toggleSection(section.id)} data-testid="anatomy-section-toggle">
              {expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
              <span className="min-w-0 flex-1 truncate">{section.label}</span>
              <span className="shrink-0 text-[10px] font-normal text-muted-foreground">{section.elements.length}</span>
            </button>
            {expanded ? (
              <ul id={listId} className="min-w-0 space-y-0.5 border-t border-border/60 p-1">
                {section.elements.map((element) => {
                  const label = labels[element.id] ?? element.label
                  const open = element.id === openId
                  const isHidden = hidden.has(element.id)
                  const panelId = `element-panel-${element.id}`
                  return (
                    <li key={element.id} data-layer-id={element.id} data-open={open ? 'true' : undefined} data-hidden={isHidden ? 'true' : undefined} className={`min-w-0 rounded-md border text-xs ${open ? 'border-primary/70 bg-primary/5' : 'border-transparent'}`}>
                      <div className="flex min-w-0 items-center gap-1">
                        <button
                          type="button"
                          data-layer-eye
                          aria-label={isHidden ? `Mostrar ${label}` : `Ocultar ${label}`}
                          aria-pressed={!isHidden}
                          title={isHidden ? 'Mostrar elemento' : 'Ocultar elemento'}
                          className={`flex h-7 w-6 shrink-0 items-center justify-center rounded-sm hover:bg-muted ${isHidden ? 'text-muted-foreground/60' : 'text-muted-foreground'}`}
                          onClick={() => onToggleVisibility(element.id)}
                        >
                          {isHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>
                        <button type="button" className="flex min-w-0 flex-1 items-center justify-between gap-1 py-1 pr-2 text-left" onClick={() => onToggle(element.id)} aria-expanded={open} aria-controls={open ? panelId : undefined} data-layer-toggle>
                          <span className={`min-w-0 truncate ${isHidden ? 'italic text-muted-foreground' : ''}`}>{label}</span>
                          {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
                        </button>
                      </div>
                      {open ? (
                        <div id={panelId} role="region" aria-label={label} data-layer-panel className="min-w-0 border-t border-border/60 px-2 pb-2 pt-2" onPointerDown={(event) => event.stopPropagation()}>
                          {renderPanel(element.id)}
                        </div>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
