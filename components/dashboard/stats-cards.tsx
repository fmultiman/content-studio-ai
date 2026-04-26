'use client'

import { FolderKanban, Image, Video, Sparkles } from 'lucide-react'

interface StatCardProps {
  title: string
  value: string | number
  icon: React.ReactNode
  trend?: string
}

function StatCard({ title, value, icon, trend }: StatCardProps) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-border/50 bg-card/30 p-4 backdrop-blur-sm">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-accent">
        {icon}
      </div>
      <div>
        <p className="text-sm text-muted-foreground">{title}</p>
        <p className="text-2xl font-semibold text-foreground">{value}</p>
        {trend && (
          <p className="text-xs text-emerald-500">{trend}</p>
        )}
      </div>
    </div>
  )
}

interface StatsCardsProps {
  projectsCount: number
  imagesCount: number
  videosCount: number
  promptsCount: number
}

export function StatsCards({ projectsCount, imagesCount, videosCount, promptsCount }: StatsCardsProps) {
  const stats = [
    {
      title: 'Projetos',
      value: projectsCount,
      icon: <FolderKanban className="h-5 w-5 text-violet-400" />,
    },
    {
      title: 'Imagens Geradas',
      value: imagesCount,
      icon: <Image className="h-5 w-5 text-cyan-400" />,
    },
    {
      title: 'Vídeos',
      value: videosCount,
      icon: <Video className="h-5 w-5 text-pink-400" />,
    },
    {
      title: 'Prompts Salvos',
      value: promptsCount,
      icon: <Sparkles className="h-5 w-5 text-amber-400" />,
    },
  ]

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => (
        <StatCard key={stat.title} {...stat} />
      ))}
    </div>
  )
}
