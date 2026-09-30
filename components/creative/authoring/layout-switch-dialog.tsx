'use client'

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'

/**
 * STATIC_TEMPLATE_LAYOUT_SWITCH_STATE_TRUTH_V1 — explicit confirmation before a
 * Template Layout switch that would discard authored Layout-owned work. Shown
 * only when `layoutLabel` is set (the Layout the switch is waiting on); Cancel
 * changes nothing, "Trocar layout" performs the ONE replacement. UI-only.
 */
export function LayoutSwitchDialog({ layoutLabel, onCancel, onConfirm }: { layoutLabel: string | null; onCancel: () => void; onConfirm: () => void }) {
  return (
    <AlertDialog open={layoutLabel !== null} onOpenChange={(open) => { if (!open) onCancel() }}>
      <AlertDialogContent data-testid="layout-switch-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Trocar o layout{layoutLabel ? ` para ${layoutLabel}` : ''}?</AlertDialogTitle>
          <AlertDialogDescription>
            Trocar o layout substituirá o conteúdo e os ajustes específicos do layout atual. Os elementos adicionados (texto e imagem) são mantidos. Clique em Salvar para persistir.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={onConfirm} data-testid="layout-switch-confirm">Trocar layout</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
