'use client'

/**
 * CREATIVE_EDITOR_FREE_DEFAULT_AND_TEMPLATE_ENTRY_V1 — the Template tab's
 * truthful mode statement and the ONLY place a composition changes mode.
 *
 * Two modes, no third state: FREE (the default for new authoring; an empty free
 * composition is a blank canvas) or TEMPLATE (an explicit opt-in, from the
 * existing Template registry). A switch REPLACES the composition — nothing is
 * mapped between modes — so any switch that would drop authored work asks
 * first. Shared by the Static editor (whole piece) and the Video editor (one
 * Scene); the caller applies the replacement with its own domain helpers.
 */
import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'

export type CompositionModeTemplate = { id: string; name: string; description?: string }

type Pending = { kind: 'template'; template: CompositionModeTemplate } | { kind: 'free' }

export function CompositionModePanel({ mode, templates, currentTemplateId, scope, freeHasContent, onChooseTemplate, onChooseFree, children }: {
  mode: 'free' | 'template'
  /** The registered Templates this composition may use (existing registry; never a "Blank" entry). */
  templates: readonly CompositionModeTemplate[]
  currentTemplateId?: string | null
  /** How the switched unit is named in the confirmation ("desta cena", "desta peça"). */
  scope: string
  /** Whether the free composition holds authored work (entering a Template would discard it). */
  freeHasContent: boolean
  onChooseTemplate: (templateId: string) => void
  onChooseFree: () => void
  /** Template mode only: that Template's own controls (structure, appearance, anatomy). */
  children?: ReactNode
}) {
  const [pending, setPending] = useState<Pending | null>(null)
  const current = templates.find((template) => template.id === currentTemplateId) ?? null

  function chooseTemplate(template: CompositionModeTemplate) {
    // An empty free composition has nothing to lose: the switch is direct.
    if (mode === 'free' && !freeHasContent) onChooseTemplate(template.id)
    else setPending({ kind: 'template', template })
  }

  function confirm() {
    if (!pending) return
    if (pending.kind === 'template') onChooseTemplate(pending.template.id)
    else onChooseFree()
    setPending(null)
  }

  return (
    <div className="space-y-3" data-testid="composition-mode" data-mode={mode}>
      <div className="space-y-1 rounded-md border border-border/60 p-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Composição atual</p>
        <p className="text-sm font-medium" data-testid="composition-mode-state">{mode === 'free' ? 'Livre · nenhum template aplicado' : `Template · ${current?.name ?? 'Template'}`}</p>
        {mode === 'free' ? (
          <p className="text-[11px] text-muted-foreground">Você posiciona textos e imagens. Cores e fontes seguem os papéis do estilo do projeto (hoje, o padrão do Studio).</p>
        ) : (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => setPending({ kind: 'free' })} data-testid="composition-mode-free">Usar composição livre…</Button>
        )}
      </div>
      {mode === 'free' ? (
        <div className="space-y-1.5" data-testid="composition-mode-templates">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Templates disponíveis</p>
          {templates.map((template) => (
            <div key={template.id} className="space-y-1 rounded-md border border-border/60 p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm">{template.name}</span>
                <Button size="sm" variant="outline" className="h-7 shrink-0 px-2 text-xs" onClick={() => chooseTemplate(template)} data-testid="composition-mode-template" data-template-id={template.id}>Usar template</Button>
              </div>
              {template.description ? <p className="line-clamp-3 text-[11px] text-muted-foreground">{template.description}</p> : null}
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">Um template é opcional: ele traz estruturas, conteúdo de exemplo e materiais prontos. Nada é convertido automaticamente.</p>
        </div>
      ) : children}
      <AlertDialog open={pending !== null} onOpenChange={(open) => { if (!open) setPending(null) }}>
        <AlertDialogContent data-testid="composition-mode-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>{pending?.kind === 'template' ? `Substituir pela composição do template ${pending.template.name}?` : 'Trocar para composição livre?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.kind === 'template'
                ? `Os elementos livres ${scope} serão descartados e substituídos pelos padrões do template. Nada é convertido automaticamente; arquivos da Biblioteca não são apagados.`
                : `A composição do template ${scope} (estrutura, conteúdo, camadas e assets) será substituída por uma composição livre em branco. Nada é convertido automaticamente.`}
              {' '}A troca só é salva quando você clicar em Salvar; até lá, “Voltar ao salvo” desfaz.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="composition-mode-cancel">Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={confirm} data-testid="composition-mode-confirm-action">{pending?.kind === 'template' ? 'Substituir' : 'Trocar para livre'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
