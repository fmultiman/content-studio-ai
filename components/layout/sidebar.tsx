'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  FolderKanban,
  FileText,
  Image,
  Images,
  UploadCloud,
  Video,
  Settings,
  Sparkles,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useState } from 'react'

const navItems = [
  {
    label: 'Dashboard',
    href: '/dashboard',
    icon: LayoutDashboard,
  },
  {
    label: 'Projetos',
    href: '/projetos',
    icon: FolderKanban,
  },
  {
    label: 'Imagens',
    href: '/imagens',
    icon: Image,
  },
  {
    label: 'Vídeos',
    href: '/videos',
    icon: Video,
  },
  {
    label: 'Conteúdos',
    href: '/publicacoes',
    icon: FileText,
  },
  {
    label: 'Arquivos',
    href: '/arquivos',
    icon: UploadCloud,
  },
  {
    label: 'Galeria',
    href: '/galeria',
    icon: Images,
  },
  {
    label: 'Configurações',
    href: '/configuracoes',
    icon: Settings,
  },
]

export function Sidebar() {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  return (
    <aside
      className={cn(
        'flex h-screen flex-col border-r border-border/50 bg-card/30 backdrop-blur-sm transition-all duration-300',
        collapsed ? 'w-16' : 'w-64'
      )}
    >
      {/* Logo */}
      <div className="flex h-16 items-center justify-between border-b border-border/50 px-4">
        <Link href="/dashboard" className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-cyan-500">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          {!collapsed && (
            <span className="font-semibold text-foreground">Content Agent</span>
          )}
        </Link>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-3">
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200',
                isActive
                  ? 'bg-gradient-to-r from-violet-600/20 to-cyan-500/20 text-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                collapsed && 'justify-center px-2'
              )}
            >
              <item.icon
                className={cn(
                  'h-5 w-5 shrink-0',
                  isActive && 'text-violet-400'
                )}
              />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      {!collapsed && (
        <div className="border-t border-border/50 p-4">
          <div className="rounded-lg bg-gradient-to-r from-violet-600/10 to-cyan-500/10 p-3">
            <p className="text-xs text-muted-foreground">
              Versão Beta
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Criação de conteúdo com IA
            </p>
          </div>
        </div>
      )}
    </aside>
  )
}
