import { DashboardContinuationHub } from '@/components/dashboard/continuation-hub'
import { StatsCards } from '@/components/dashboard/stats-cards'
import {
  DashboardPage as DashboardShellPage,
  DashboardPageContent,
} from '@/components/layout/dashboard-page'
import { PageHeader } from '@/components/layout/page-header'
import {
  buildRecentProductions,
  buildRecentProjects,
  buildRecentWorkItems,
  getDashboardEmptyState,
  type DashboardEditorialContent,
  type DashboardImageDraft,
  type DashboardProduction,
  type DashboardProject,
  type DashboardVideoDraft,
} from '@/lib/dashboard-continuation'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const [
    projectsResult,
    productionsResult,
    imageDraftsResult,
    videoDraftsResult,
    editorialContentsResult,
    projectsCountResult,
    productionsCountResult,
    imageDraftsCountResult,
    videoDraftsCountResult,
    editorialContentsCountResult,
  ] = await Promise.all([
    supabase
      .from('projects')
      .select('id, name, description, context, identity, updated_at')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(6),
    supabase
      .from('productions')
      .select('id, project_id, title, intention, type, updated_at')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(10),
    supabase
      .from('image_drafts')
      .select('id, project_id, production_id, name, user_input, image_status, updated_at')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(20),
    supabase
      .from('video_drafts')
      .select('id, project_id, production_id, name, updated_at')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(20),
    supabase
      .from('editorial_contents')
      .select('id, project_id, production_id, title, status, updated_at')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(20),
    supabase
      .from('projects')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id),
    supabase
      .from('productions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id),
    supabase
      .from('image_drafts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id),
    supabase
      .from('video_drafts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id),
    supabase
      .from('editorial_contents')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id),
  ])

  const projects = (projectsResult.data ?? []) as DashboardProject[]
  const productions = (productionsResult.data ?? []) as DashboardProduction[]
  const imageDrafts = (imageDraftsResult.data ?? []) as DashboardImageDraft[]
  const videoDrafts = (videoDraftsResult.data ?? []) as DashboardVideoDraft[]
  const editorialContents = (editorialContentsResult.data ?? []) as DashboardEditorialContent[]
  const recentProductions = buildRecentProductions({
    productions,
    projects,
    imageDrafts,
    videoDrafts,
    editorialContents,
  })
  const recentWorkItems = buildRecentWorkItems({
    imageDrafts,
    videoDrafts,
    editorialContents,
    projects,
    productions,
  })
  const recentProjects = buildRecentProjects({ projects, productions })

  const projectsCount = projectsCountResult.count ?? 0
  const productionsCount = productionsCountResult.count ?? 0
  const imageDraftsCount = imageDraftsCountResult.count ?? 0
  const videoDraftsCount = videoDraftsCountResult.count ?? 0
  const editorialContentsCount = editorialContentsCountResult.count ?? 0
  const emptyState = getDashboardEmptyState({
    projectCount: projectsCount,
    productionCount: productionsCount,
    recentItemCount: recentWorkItems.length,
  })
  const hasLoadError = [
    projectsResult,
    productionsResult,
    imageDraftsResult,
    videoDraftsResult,
    editorialContentsResult,
  ].some((result) => result.error)

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
          />

          <section className="space-y-4" aria-labelledby="resumo-dashboard">
            <div>
              <h3 id="resumo-dashboard" className="text-lg font-semibold text-foreground">
                Resumo
              </h3>
              <p className="text-sm text-muted-foreground">
                Métricas secundárias do trabalho salvo.
              </p>
            </div>
            <StatsCards
              projectsCount={projectsCount}
              productionsCount={productionsCount}
              imageDraftsCount={imageDraftsCount}
              videoDraftsCount={videoDraftsCount}
              editorialContentsCount={editorialContentsCount}
            />
          </section>
      </DashboardPageContent>
    </DashboardShellPage>
  )
}
