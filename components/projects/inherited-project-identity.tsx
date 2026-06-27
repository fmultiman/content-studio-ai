'use client'

import { AlertTriangle, ExternalLink, Fingerprint, Info, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  getIdentityStatusLabel,
  getWorkspaceIdentityCopy,
  truncateIdentityText,
  type InheritedIdentitySummary,
  type IdentitySurface,
} from '@/lib/inherited-project-identity'

interface IdentityAction {
  label?: string
  href?: string
  onClick?: () => void
}

interface InheritedIdentityIndicatorProps {
  summary: InheritedIdentitySummary
  action?: IdentityAction
}

interface InheritedIdentitySummaryProps {
  summary: InheritedIdentitySummary
  projectHref?: string
  action?: IdentityAction
}

interface WorkspaceIdentityContextProps {
  surface: Exclude<IdentitySurface, 'production'>
  summary: InheritedIdentitySummary
  productionTitle?: string | null
  projectHref?: string
  productionHref?: string
}

export function InheritedIdentityIndicator({
  summary,
  action,
}: InheritedIdentityIndicatorProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-background/50 px-3 py-2 text-sm">
      <IdentityIcon summary={summary} />
      <span className="font-medium text-foreground">{summary.headline}</span>
      {summary.kind === 'partial' && (
        <Badge variant="secondary" className="text-xs">
          {summary.populatedZones}/{summary.totalZones} zonas
        </Badge>
      )}
      {summary.kind === 'legacy' && (
        <Badge variant="outline" className="text-xs">
          contexto livre
        </Badge>
      )}
      {action && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          onClick={action.onClick}
          asChild={!!action.href}
        >
          {action.href ? (
            <a href={action.href}>
              {action.label ?? summary.actionLabel}
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : (
            <>
              {action.label ?? summary.actionLabel}
              <ExternalLink className="h-3.5 w-3.5" />
            </>
          )}
        </Button>
      )}
    </div>
  )
}

export function InheritedIdentitySummaryCard({
  summary,
  projectHref,
  action,
}: InheritedIdentitySummaryProps) {
  return (
    <Card id="inherited-project-identity" className="border-border/50 bg-card/30">
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-background/50">
            <Fingerprint className="h-5 w-5 text-violet-400" />
          </div>
          <div className="min-w-0">
            <CardTitle className="text-base">Identidade herdada do Project</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {summary.kind === 'complete' || summary.kind === 'partial'
                ? `Esta Production herda a identidade atual de ${summary.projectName}.`
                : summary.description}
            </p>
          </div>
        </div>
        <Badge variant={summary.kind === 'invalid' ? 'destructive' : 'secondary'} className="shrink-0">
          {getIdentityStatusLabel(summary)}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {(summary.kind === 'complete' || summary.kind === 'partial') && (
          <>
            <div className="grid gap-3 md:grid-cols-3">
              <SummaryField label="Propósito" value={truncateIdentityText(summary.purpose)} />
              <SummaryField label="Público" value={truncateIdentityText(summary.audience)} />
              <SummaryField
                label="Direção visual"
                value={truncateIdentityText(summary.visualIdentity)}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{summary.principleCount} princípios</Badge>
              <Badge variant="outline">{summary.restrictionCount} restrições</Badge>
              <Badge variant="outline">{summary.preferenceCount} preferências</Badge>
              {summary.kind === 'partial' && (
                <Badge variant="secondary">
                  {summary.populatedZones} de {summary.totalZones} zonas preenchidas
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              A identidade orienta a direção persistente do Project. A intenção desta Production
              continua sendo o objetivo local desta iniciativa.
            </p>
          </>
        )}

        {summary.kind === 'legacy' && (
          <p className="text-sm text-muted-foreground">
            A identidade estruturada ainda não foi definida. O contexto livre do Project continua
            disponível como referência para esta Production.
          </p>
        )}

        {summary.kind === 'empty' && (
          <p className="text-sm text-muted-foreground">
            Estruture propósito, público, direção visual e critérios no Project para tornar a
            herança mais clara entre Productions e entregáveis.
          </p>
        )}

        {summary.kind === 'invalid' && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <p className="text-sm text-destructive">
              A identidade salva não pode ser lida com segurança. Os dados foram preservados no
              Project para correção.
            </p>
          </div>
        )}

        {summary.kind === 'loading' && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando identidade do Project...
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {(action || projectHref) && (
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={action?.onClick}
              asChild={!!projectHref}
            >
              {projectHref ? (
                <a href={projectHref}>
                  {action?.label ?? summary.actionLabel}
                  <ExternalLink className="h-4 w-4" />
                </a>
              ) : (
                <>
                  {action?.label ?? summary.actionLabel}
                  <ExternalLink className="h-4 w-4" />
                </>
              )}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export function WorkspaceIdentityContext({
  surface,
  summary,
  productionTitle,
  projectHref,
  productionHref,
}: WorkspaceIdentityContextProps) {
  const status = getWorkspaceIdentityCopy(surface, summary)
  const helper = getWorkspaceHelper(surface, summary)

  return (
    <div className="rounded-lg border border-border/50 bg-card/30 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Info className="h-4 w-4 shrink-0 text-muted-foreground" />
        <ContextLink label="Project" value={summary.projectName} href={projectHref} />
        {productionTitle && (
          <ContextLink label="Production" value={productionTitle} href={productionHref} />
        )}
        <span className="flex min-w-0 items-center gap-1">
          <span className="text-muted-foreground">Identidade:</span>
          <span className="font-medium text-foreground">{status}</span>
        </span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{helper}</p>
    </div>
  )
}

function SummaryField({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-lg border border-border/50 bg-background/50 p-3">
      <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-sm text-foreground">{value ?? 'Ainda não definido'}</p>
    </div>
  )
}

function getWorkspaceHelper(
  surface: Exclude<IdentitySurface, 'production'>,
  summary: InheritedIdentitySummary,
) {
  if (summary.kind === 'loading') return 'A identidade será exibida quando o Project terminar de carregar.'
  if (summary.kind === 'invalid') return 'Corrija a identidade no Project antes de confiar nesta referência.'
  if (summary.kind === 'legacy') return 'O contexto livre do Project permanece disponível para esta Production.'
  if (summary.kind === 'empty') return 'Este Project ainda não tem identidade estruturada.'

  if (surface === 'image') {
    return 'A identidade estruturada do Project é usada no prompt e na avaliação de imagem.'
  }

  if (surface === 'video') {
    return 'A identidade do Project está disponível como referência para esta Production.'
  }

  return 'A identidade do Project está disponível como referência editorial.'
}

function ContextLink({ label, value, href }: { label: string; value: string; href?: string }) {
  const content = (
    <>
      <span className="text-muted-foreground">{label}:</span>
      <span className="truncate font-medium text-foreground">{value}</span>
    </>
  )

  if (!href) {
    return <span className="flex min-w-0 items-center gap-1">{content}</span>
  }

  return (
    <a className="flex min-w-0 items-center gap-1 hover:underline" href={href}>
      {content}
    </a>
  )
}

function IdentityIcon({ summary }: { summary: InheritedIdentitySummary }) {
  if (summary.kind === 'invalid') {
    return <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
  }

  if (summary.kind === 'loading') {
    return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
  }

  return <Fingerprint className="h-4 w-4 shrink-0 text-violet-400" />
}
