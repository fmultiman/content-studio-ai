'use client'

import Link from 'next/link'
import { cn } from '@/lib/utils'
import { FolderPlus, ImagePlus, VideoIcon, ArrowRight } from 'lucide-react'

interface ActionCardProps {
  title: string
  description: string
  href: string
  icon: React.ReactNode
  gradient: string
}

function ActionCard({ title, description, href, icon, gradient }: ActionCardProps) {
  return (
    <Link
      href={href}
      className={cn(
        'group relative flex flex-col justify-between overflow-hidden rounded-xl border border-border/50 p-6 transition-all duration-300 hover:border-transparent hover:shadow-xl',
        'bg-gradient-to-br from-card/80 to-card/40 backdrop-blur-sm',
        'hover:scale-[1.02]'
      )}
    >
      {/* Gradient overlay on hover */}
      <div
        className={cn(
          'absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-10',
          gradient
        )}
      />

      <div className="relative z-10">
        <div
          className={cn(
            'mb-4 flex h-12 w-12 items-center justify-center rounded-lg',
            gradient
          )}
        >
          {icon}
        </div>
        <h3 className="mb-2 text-lg font-semibold text-foreground">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>

      <div className="relative z-10 mt-6 flex items-center text-sm font-medium text-violet-400">
        <span>Começar</span>
        <ArrowRight className="ml-2 h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
      </div>
    </Link>
  )
}

export function ActionCards() {
  const actions = [
    {
      title: 'Criar Projeto',
      description: 'Organize suas criações em projetos para melhor gerenciamento e contexto.',
      href: '/projetos?new=true',
      icon: <FolderPlus className="h-6 w-6 text-white" />,
      gradient: 'bg-gradient-to-br from-violet-600 to-violet-400',
    },
    {
      title: 'Gerar Imagem',
      description: 'Crie imagens incríveis com prompts otimizados por IA.',
      href: '/imagens',
      icon: <ImagePlus className="h-6 w-6 text-white" />,
      gradient: 'bg-gradient-to-br from-cyan-500 to-cyan-400',
    },
    {
      title: 'Gerar Vídeo',
      description: 'Transforme suas imagens em vídeos dinâmicos com cenas personalizadas.',
      href: '/videos',
      icon: <VideoIcon className="h-6 w-6 text-white" />,
      gradient: 'bg-gradient-to-br from-pink-500 to-pink-400',
    },
  ]

  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      {actions.map((action) => (
        <ActionCard key={action.title} {...action} />
      ))}
    </div>
  )
}
