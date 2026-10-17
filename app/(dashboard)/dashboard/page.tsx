import { DashboardContinuationHub } from '@/components/dashboard/continuation-hub'
import { StatsCards } from '@/components/dashboard/stats-cards'
import {
  DashboardPage as DashboardShellPage,
  DashboardPageContent,
} from '@/components/layout/dashboard-page'
import { PageHeader } from '@/components/layout/page-header'
import { loadDashboardViewModel } from '@/lib/dashboard-data'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // STRUCTURAL_WAVE_1A1: continuity is derived from the canonical generation SESSIONS (images and videos), Creative Editor drafts and
  // editorial contents; see lib/dashboard-data.ts for the query plan and lib/session-continuity.ts for the counting rules.
  const { recentProductions, recentWorkItems, recentProjects, stats, emptyState, hasLoadError } =
    await loadDashboardViewModel(supabase, user.id)

  return (
    <DashboardShellPage>
      <DashboardPageContent width="7xl" className="space-y-8">
          <PageHeader
            context="Workspace"
            title="Dashboard"
            description="Retome Productions, itens recentes e ações globais com o contexto certo."
          />
          {hasLoadError && (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
              Não foi possível carregar todos os dados do Dashboard. Tente atualizar a página.
            </div>
          )}

          <DashboardContinuationHub
            userName={user.email?.split('@')[0] ?? 'criador'}
            productions={recentProductions}
            workItems={recentWorkItems}
            projects={recentProjects}
            emptyState={emptyState}
            hasLoadError={hasLoadError}
          />

          <section className="space-y-4" aria-labelledby="resumo-dashboard">
            <div>
              <h3 id="resumo-dashboard" className="text-lg font-semibold text-foreground">
                Resumo
              </h3>
              <p className="text-sm text-muted-foreground">
                Cada número conta um tipo de trabalho; sessões, edições e conteúdos não são somados.
              </p>
            </div>
            <StatsCards
              projectsCount={stats.projects}
              productionsCount={stats.productions}
              imageSessionsCount={stats.imageSessions}
              videoSessionsCount={stats.videoSessions}
              videoDraftsCount={stats.videoDrafts}
              editorialContentsCount={stats.editorialContents}
            />
          </section>
      </DashboardPageContent>
    </DashboardShellPage>
  )
}
