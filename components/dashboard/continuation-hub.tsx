import Link from 'next/link'
import type React from 'react'
import {
  ArrowRight,
  CalendarClock,
  FileText,
  FolderKanban,
  ImageIcon,
  Layers3,
  Plus,
  Video,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type {
  DashboardEmptyState,
  RecentProductionCard,
  RecentProjectCard,
  RecentWorkItem,
} from '@/lib/dashboard-continuation'
import { cn } from '@/lib/utils'

type DashboardContinuationProps = {
  userName: string
  productions: RecentProductionCard[]
  workItems: RecentWorkItem[]
  projects: RecentProjectCard[]
  emptyState: DashboardEmptyState | null
}

export function DashboardContinuationHub({
  userName,
  productions,
  workItems,
  projects,
  emptyState,
}: DashboardContinuationProps) {
  const latestProduction = productions[0] ?? null
  const latestProject = projects[0] ?? null

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h2 className="text-2xl font-bold text-foreground">Olá, {userName}!</h2>
        <p className="text-muted-foreground">
          Continue uma Production ou retome um item recente com o contexto certo.
        </p>
      </section>

      {emptyState && (
        <DashboardEmptyStateCard emptyState={emptyState} />
      )}

      <section className="space-y-4" aria-labelledby="continuar-trabalhando">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 id="continuar-trabalhando" className="text-lg font-semibold text-foreground">
              Continuar trabalhando
            </h3>
            <p className="text-sm text-muted-foreground">
              Productions recentes são a entrada principal para continuar de onde você parou.
            </p>
          </div>
          {latestProduction && (
            <Button asChild variant="outline" size="sm">
              <Link href={latestProduction.href}>
                Continuar última Production
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          )}
        </div>

        {productions.length > 0 ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {productions.map((production) => (
              <ProductionCard key={production.id} production={production} />
            ))}
          </div>
        ) : (
          <EmptyPanel
            title="Nenhuma Production ainda"
            description="Crie uma Production dentro de um Project para organizar imagens, vídeos e conteúdos."
            href={latestProject?.href ?? '/projetos'}
            actionLabel={latestProject ? 'Abrir Project recente' : 'Abrir Projects'}
          />
        )}
      </section>

      <section className="space-y-4" aria-labelledby="itens-recentes">
        <div>
          <h3 id="itens-recentes" className="text-lg font-semibold text-foreground">
            Itens recentes
          </h3>
          <p className="text-sm text-muted-foreground">
            Acesso rápido a rascunhos e conteúdos sem substituir a Production.
          </p>
        </div>

        {workItems.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {workItems.map((item) => (
              <WorkItemCard key={`${item.type}-${item.id}`} item={item} />
            ))}
          </div>
        ) : (
          <EmptyPanel
            title="Sem itens recentes"
            description="Quando uma Production tiver rascunhos ou conteúdos, eles aparecerão aqui."
            href={latestProduction?.href ?? '/projetos'}
            actionLabel={latestProduction ? 'Abrir Production' : 'Abrir Projects'}
          />
        )}
      </section>

      <section className="space-y-4" aria-labelledby="projects-recentes">
        <div>
          <h3 id="projects-recentes" className="text-lg font-semibold text-foreground">
            Projects recentes
          </h3>
          <p className="text-sm text-muted-foreground">
            Use Projects para revisar identidade, contexto e criar novas Productions.
          </p>
        </div>

        {projects.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        ) : (
          <EmptyPanel
            title="Nenhum Project criado"
            description="Projects guardam identidade, contexto e histórico do trabalho."
            href="/projetos?new=true"
            actionLabel="Criar Project"
          />
        )}
      </section>

      <section className="space-y-4" aria-labelledby="criar-com-contexto">
        <div>
          <h3 id="criar-com-contexto" className="text-lg font-semibold text-foreground">
            Criar
          </h3>
          <p className="text-sm text-muted-foreground">
            Comece pelo contexto certo antes de criar entregáveis.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {latestProduction && (
            <ActionLink
              href={latestProduction.href}
              icon={<Layers3 className="h-5 w-5 text-violet-400" />}
              title="Continuar Production"
              description="Abra o workspace multimodal mais recente."
            />
          )}
          <ActionLink
            href={latestProject?.href ?? '/projetos'}
            icon={<Plus className="h-5 w-5 text-cyan-400" />}
            title="Nova Production"
            description={
              latestProject
                ? 'Abra um Project recente e use Nova Produção.'
                : 'Crie ou escolha um Project antes de criar uma Production.'
            }
          />
          <ActionLink
            href="/projetos?new=true"
            icon={<FolderKanban className="h-5 w-5 text-emerald-400" />}
            title="Novo Project"
            description="Defina identidade, contexto e histórico para um novo trabalho."
          />
        </div>
      </section>
    </div>
  )
}

function ProductionCard({ production }: { production: RecentProductionCard }) {
  return (
    <article className="rounded-xl border border-border/50 bg-card/30 p-5 backdrop-blur-sm transition-colors hover:border-violet-500/50">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-3">
          <div className="space-y-1">
            <Badge variant="secondary">{production.projectName}</Badge>
            <h4 className="line-clamp-2 text-lg font-semibold text-foreground">
              {production.title}
            </h4>
          </div>
          {production.intention && (
            <p className="line-clamp-2 text-sm text-muted-foreground" title={production.intention}>
              {production.intention}
            </p>
          )}
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <Counter label="imagens" value={production.counters.images} />
            <Counter label="vídeos" value={production.counters.videos} />
            <Counter label="conteúdos" value={production.counters.editorial} />
          </div>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <CalendarClock className="h-3.5 w-3.5" />
            Atividade em {formatDate(production.activityAt)}
          </p>
        </div>
        <Button asChild size="sm" className="shrink-0">
          <Link href={production.href} aria-label={`Continuar Production ${production.title}`}>
            Continuar Production
          </Link>
        </Button>
      </div>
    </article>
  )
}

function WorkItemCard({ item }: { item: RecentWorkItem }) {
  return (
    <article className="rounded-lg border border-border/50 bg-card/25 p-4 transition-colors hover:border-border">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <WorkItemIcon type={item.type} />
          <div className="min-w-0">
            <Badge variant="outline">{item.label}</Badge>
            <h4 className="mt-2 line-clamp-2 text-sm font-semibold text-foreground">
              {item.title}
            </h4>
          </div>
        </div>
        <Button asChild variant="ghost" size="sm" className="shrink-0">
          <Link href={item.href} aria-label={`Abrir ${item.label}: ${item.title}`}>
            Abrir
          </Link>
        </Button>
      </div>
      <div className="space-y-1 text-xs text-muted-foreground">
        <p className="truncate">Project: {item.projectName}</p>
        {item.productionName ? (
          <p className="truncate">Production: {item.productionName}</p>
        ) : (
          <p>Sem Production vinculada</p>
        )}
        <p>
          {item.status} · {formatDate(item.updatedAt)}
        </p>
      </div>
    </article>
  )
}

function ProjectCard({ project }: { project: RecentProjectCard }) {
  return (
    <article className="rounded-lg border border-border/50 bg-card/25 p-4">
      <div className="space-y-3">
        <div className="space-y-1">
          <h4 className="line-clamp-2 text-sm font-semibold text-foreground">
            {project.name}
          </h4>
          {project.description && (
            <p className="line-clamp-2 text-xs text-muted-foreground">
              {project.description}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">
            {project.productionCount} {project.productionCount === 1 ? 'Production' : 'Productions'}
          </Badge>
          <Badge variant="outline">{project.identityLabel}</Badge>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {formatDate(project.updatedAt)}
          </span>
          <Button asChild variant="outline" size="sm">
            <Link href={project.href} aria-label={`Abrir Project ${project.name}`}>
              Abrir Project
            </Link>
          </Button>
        </div>
      </div>
    </article>
  )
}

function DashboardEmptyStateCard({ emptyState }: { emptyState: DashboardEmptyState }) {
  return (
    <section className="rounded-xl border border-dashed border-border/70 bg-card/20 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">{emptyState.title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{emptyState.description}</p>
        </div>
        <Button asChild>
          <Link href={emptyState.href}>{emptyState.actionLabel}</Link>
        </Button>
      </div>
    </section>
  )
}

function EmptyPanel({
  title,
  description,
  href,
  actionLabel,
}: {
  title: string
  description: string
  href: string
  actionLabel: string
}) {
  return (
    <div className="rounded-xl border border-dashed border-border/60 bg-card/20 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h4 className="font-semibold text-foreground">{title}</h4>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={href}>{actionLabel}</Link>
        </Button>
      </div>
    </div>
  )
}

function ActionLink({
  href,
  icon,
  title,
  description,
}: {
  href: string
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <Link
      href={href}
      className="group rounded-xl border border-border/50 bg-card/30 p-4 transition-colors hover:border-violet-500/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent">
          {icon}
        </div>
        <div className="min-w-0">
          <h4 className="font-semibold text-foreground">{title}</h4>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </div>
    </Link>
  )
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <span className="rounded-md bg-accent px-2 py-1">
      {value} {label}
    </span>
  )
}

function WorkItemIcon({ type }: { type: RecentWorkItem['type'] }) {
  const className = 'h-4 w-4'
  if (type === 'image') return <ImageIcon className={cn(className, 'text-cyan-400')} />
  if (type === 'video') return <Video className={cn(className, 'text-pink-400')} />
  return <FileText className={cn(className, 'text-amber-400')} />
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value))
}
