'use client'

import { FileText, FolderKanban, Image, Layers3, Video } from 'lucide-react'
import type React from 'react'

interface StatCardProps {
  title: string
  value: string | number
  icon: React.ReactNode
}

function StatCard({ title, value, icon }: StatCardProps) {
  return (
    <div className="flex min-w-0 items-center gap-4 rounded-xl border border-border/50 bg-card/30 p-4 backdrop-blur-sm">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-accent">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm text-muted-foreground">{title}</p>
        <p className="text-2xl font-semibold text-foreground">{value}</p>
      </div>
    </div>
  )
}

interface StatsCardsProps {
  projectsCount: number
  productionsCount: number
  imageDraftsCount: number
  videoDraftsCount: number
  editorialContentsCount: number
}

export function StatsCards({
  projectsCount,
  productionsCount,
  imageDraftsCount,
  videoDraftsCount,
  editorialContentsCount,
}: StatsCardsProps) {
  const stats = [
    {
      title: 'Projects',
      value: projectsCount,
      icon: <FolderKanban className="h-5 w-5 text-violet-400" />,
    },
    {
      title: 'Productions',
      value: productionsCount,
      icon: <Layers3 className="h-5 w-5 text-indigo-400" />,
    },
    {
      title: 'Rascunhos de imagem',
      value: imageDraftsCount,
      icon: <Image className="h-5 w-5 text-cyan-400" />,
    },
    {
      title: 'Rascunhos de vídeo',
      value: videoDraftsCount,
      icon: <Video className="h-5 w-5 text-pink-400" />,
    },
    {
      title: 'Conteúdos',
      value: editorialContentsCount,
      icon: <FileText className="h-5 w-5 text-amber-400" />,
    },
  ]

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {stats.map((stat) => (
        <StatCard key={stat.title} {...stat} />
      ))}
    </div>
  )
}
