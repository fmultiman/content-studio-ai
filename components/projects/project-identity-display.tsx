'use client'

import { Fingerprint, AlertTriangle, Plus, Edit2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { ProjectIdentity } from '@/lib/schemas/project-identity'

interface ProjectIdentityDisplayProps {
  identity: ProjectIdentity | null
  readError: string | null
  onStructure: () => void
  onEdit: () => void
}

export function ProjectIdentityDisplay({
  identity,
  readError,
  onStructure,
  onEdit,
}: ProjectIdentityDisplayProps) {
  // ── State 1: read error ────────────────────────────────────────────────────
  if (readError !== null) {
    return (
      <Card className="border-destructive/40 bg-destructive/5 backdrop-blur-sm">
        <CardContent className="flex flex-col gap-3 py-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-destructive">Identidade com problema</p>
              <p className="text-sm text-muted-foreground">{readError}</p>
              <p className="text-xs text-muted-foreground">
                Os dados foram preservados no banco para diagnóstico.
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" disabled className="w-fit gap-2">
            <Edit2 className="h-4 w-4" />
            Editar identidade
          </Button>
        </CardContent>
      </Card>
    )
  }

  // ── State 2: no identity ───────────────────────────────────────────────────
  if (identity === null) {
    return (
      <Card className="border-border/50 bg-card/30 backdrop-blur-sm">
        <CardContent className="flex flex-col items-center justify-center gap-4 py-10 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-border/50 bg-muted/40">
            <Fingerprint className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-semibold">Identidade não estruturada</h3>
            <p className="max-w-sm text-sm text-muted-foreground">
              Este Project funciona normalmente sem identidade estruturada. Ao definir propósito,
              público e critérios, os agentes futuros poderão produzir conteúdos mais coerentes
              com este Projeto.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={onStructure}
          >
            <Plus className="h-4 w-4" />
            Estruturar identidade
          </Button>
        </CardContent>
      </Card>
    )
  }

  // ── State 3: identity present ──────────────────────────────────────────────
  return (
    <Card className="border-border/50 bg-card/30 backdrop-blur-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500/20 to-cyan-500/20">
            <Fingerprint className="h-5 w-5 text-violet-400" />
          </div>
          <CardTitle className="text-base font-semibold">Identidade do Projeto</CardTitle>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={onEdit}>
          <Edit2 className="h-4 w-4" />
          Editar
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Foundation */}
        {identity.foundation?.purpose && (
          <IdentitySection label="Propósito">
            <p className="text-sm text-foreground whitespace-pre-wrap">
              {identity.foundation.purpose}
            </p>
          </IdentitySection>
        )}

        {/* Relationship */}
        {identity.relationship?.audience && (
          <IdentitySection label="Público">
            <p className="text-sm text-foreground whitespace-pre-wrap">
              {identity.relationship.audience}
            </p>
          </IdentitySection>
        )}

        {/* Expression */}
        {(identity.expression?.visual_identity || identity.expression?.voice) && (
          <IdentitySection label="Expressão">
            <div className="space-y-2">
              {identity.expression.visual_identity && (
                <div>
                  <span className="text-xs font-medium text-muted-foreground">
                    Identidade visual
                  </span>
                  <p className="text-sm text-foreground whitespace-pre-wrap">
                    {identity.expression.visual_identity}
                  </p>
                </div>
              )}
              {identity.expression.voice && (
                <div>
                  <span className="text-xs font-medium text-muted-foreground">
                    Voz e linguagem
                  </span>
                  <p className="text-sm text-foreground whitespace-pre-wrap">
                    {identity.expression.voice}
                  </p>
                </div>
              )}
            </div>
          </IdentitySection>
        )}

        {/* Governance */}
        {(identity.governance?.principles?.length ||
          identity.governance?.restrictions?.length) && (
          <IdentitySection label="Governança">
            <div className="space-y-2">
              {identity.governance.principles && identity.governance.principles.length > 0 && (
                <div>
                  <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    Princípios
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {identity.governance.principles.map((p) => (
                      <Badge key={p} variant="secondary" className="text-xs">
                        {p}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {identity.governance.restrictions && identity.governance.restrictions.length > 0 && (
                <div>
                  <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    Restrições
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {identity.governance.restrictions.map((r) => (
                      <Badge
                        key={r}
                        variant="outline"
                        className="border-destructive/30 text-xs text-destructive/80"
                      >
                        {r}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </IdentitySection>
        )}

        {/* Practice */}
        {identity.practice?.generation_preferences &&
          identity.practice.generation_preferences.length > 0 && (
            <IdentitySection label="Prática">
              <div className="flex flex-wrap gap-1.5">
                {identity.practice.generation_preferences.map((pref) => (
                  <Badge key={pref} variant="secondary" className="text-xs">
                    {pref}
                  </Badge>
                ))}
              </div>
            </IdentitySection>
          )}
      </CardContent>
    </Card>
  )
}

// ─── Internal helper ──────────────────────────────────────────────────────────

function IdentitySection({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="border-t border-border/30 pt-4 first:border-t-0 first:pt-0">
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  )
}
