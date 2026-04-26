import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/layout/header'
import { ActionCards } from '@/components/dashboard/action-cards'
import { StatsCards } from '@/components/dashboard/stats-cards'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Fetch counts for stats
  const [projectsResult, imagesResult, videosResult, promptsResult] = await Promise.all([
    supabase.from('projects').select('id', { count: 'exact', head: true }),
    supabase.from('images').select('id', { count: 'exact', head: true }),
    supabase.from('videos').select('id', { count: 'exact', head: true }),
    supabase.from('prompts').select('id', { count: 'exact', head: true }),
  ])

  const projectsCount = projectsResult.count ?? 0
  const imagesCount = imagesResult.count ?? 0
  const videosCount = videosResult.count ?? 0
  const promptsCount = promptsResult.count ?? 0

  return (
    <>
      <Header title="Dashboard" />
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-7xl space-y-8">
          {/* Welcome Section */}
          <div>
            <h2 className="text-2xl font-bold text-foreground">
              Olá, {user.email?.split('@')[0]}!
            </h2>
            <p className="mt-1 text-muted-foreground">
              O que você gostaria de criar hoje?
            </p>
          </div>

          {/* Stats */}
          <StatsCards
            projectsCount={projectsCount}
            imagesCount={imagesCount}
            videosCount={videosCount}
            promptsCount={promptsCount}
          />

          {/* Action Cards */}
          <div>
            <h3 className="mb-4 text-lg font-semibold text-foreground">
              Ações Rápidas
            </h3>
            <ActionCards />
          </div>

          {/* Recent Activity Placeholder */}
          <div>
            <h3 className="mb-4 text-lg font-semibold text-foreground">
              Atividade Recente
            </h3>
            <div className="rounded-xl border border-border/50 bg-card/30 p-8 text-center backdrop-blur-sm">
              <p className="text-muted-foreground">
                Suas criações recentes aparecerão aqui
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
