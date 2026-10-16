'use client'

import { FileText, FolderKanban, ImageIcon, Layers3, Video, Clapperboard } from 'lucide-react'
import type React from 'react'

interface StatCardProps {
  title: string
  value: string | number
  icon: React.ReactNode
  testId: string
}

function StatCard({ title, value, icon, testId }: StatCardProps) {
  return (
    <div className="flex min-w-0 items-center gap-4 rounded-xl border border-border/50 bg-card/30 p-4 backdrop-blur-sm" data-testid={testId}>
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

// STRUCTURAL_WAVE_1A1: each card counts ONE kind of work. Sessions (the canonical unit of generation continuity), Creative Editor
// edits and editorial contents are different entities and are never merged into one number. `null` = the count could not be read.
interface StatsCardsProps {
  projectsCount: number | null
  productionsCount: number | null
  imageSessionsCount: number | null
  videoSessionsCount: number | null
  videoDraftsCount: number | null
  editorialContentsCount: number | null
}

export function StatsCards({
  projectsCount,
  productionsCount,
  imageSessionsCount,
  videoSessionsCount,
  videoDraftsCount,
  editorialContentsCount,
}: StatsCardsProps) {
  const stats = [
    {
      title: 'Projects',
      testId: 'stat-projects',
      value: projectsCount,
      icon: <FolderKanban className="h-5 w-5 text-violet-400" />,
    },
    {
      title: 'Productions',
      testId: 'stat-productions',
      value: productionsCount,
      icon: <Layers3 className="h-5 w-5 text-indigo-400" />,
    },
    {
      title: 'Sessões de imagem',
      testId: 'stat-image-sessions',
      value: imageSessionsCount,
      icon: <ImageIcon className="h-5 w-5 text-cyan-400" />,
    },
    {
      title: 'Sessões de vídeo',
      testId: 'stat-video-sessions',
      value: videoSessionsCount,
      icon: <Video className="h-5 w-5 text-pink-400" />,
    },
    {
      title: 'Edições de vídeo',
      testId: 'stat-video-drafts',
      value: videoDraftsCount,
      icon: <Clapperboard className="h-5 w-5 text-rose-400" />,
    },
    {
      title: 'Conteúdos',
      testId: 'stat-editorial',
      value: editorialContentsCount,
      icon: <FileText className="h-5 w-5 text-amber-400" />,
    },
  ]

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
      {stats.map((stat) => (
        <StatCard key={stat.title} {...stat} value={stat.value ?? '—'} />
      ))}
    </div>
  )
}
