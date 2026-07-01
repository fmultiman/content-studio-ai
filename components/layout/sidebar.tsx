'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import {
  ChevronLeft,
  FileText,
  FolderKanban,
  Image,
  Images,
  LayoutDashboard,
  Menu,
  Sparkles,
  UploadCloud,
  Video,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  isNavigationItemActive,
  navigationGroups,
  type SidebarNavigationItemId,
} from '@/lib/sidebar-navigation'
import { cn } from '@/lib/utils'

const navigationIcons: Record<SidebarNavigationItemId, typeof LayoutDashboard> = {
  dashboard: LayoutDashboard,
  projects: FolderKanban,
  contents: FileText,
  images: Image,
  videos: Video,
  gallery: Images,
  files: UploadCloud,
}

export function Sidebar() {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const toggleLabel = collapsed ? 'Abrir menu' : 'Fechar menu'

  return (
    <aside
      className={cn(
        'studio-shell-pane flex h-screen flex-col border-r border-border-subtle bg-surface-translucent shadow-elevation-low [backdrop-filter:blur(var(--studio-glass-blur))] transition-all duration-300',
        collapsed ? 'w-16' : 'w-64',
      )}
    >
      <div
        className={cn(
          'flex h-16 items-center border-b border-border-subtle',
          collapsed ? 'justify-center px-2' : 'justify-between px-4',
        )}
      >
        {!collapsed ? (
          <Link href="/dashboard" className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-cyan-500">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <span className="text-base font-semibold tracking-[-0.03em] text-foreground">
              Content Agent
            </span>
          </Link>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          aria-label={toggleLabel}
          title={toggleLabel}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? <Menu className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>
      </div>

      <nav
        className="flex-1 space-y-3 overflow-y-auto p-3 pr-2 [scrollbar-color:rgba(148,163,184,0.35)_transparent] [scrollbar-width:thin]"
        aria-label="Navegação principal"
      >
        {navigationGroups.map((group) => (
          <section key={group.id} aria-label={group.label} className="space-y-1">
            {!collapsed ? (
              <p className="px-3 pb-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
                {group.label}
              </p>
            ) : null}

            {group.items.map((item) => {
              const Icon = navigationIcons[item.id]
              const isActive = isNavigationItemActive(item, pathname)

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive ? 'page' : undefined}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                    isActive
                      ? 'border border-border-selected bg-surface-selected text-foreground shadow-glow-soft'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                    collapsed && 'justify-center px-2',
                  )}
                >
                  <Icon
                    aria-hidden="true"
                    className={cn('h-5 w-5 shrink-0', isActive && 'text-primary')}
                  />
                  {!collapsed ? <span>{item.label}</span> : null}
                </Link>
              )
            })}
          </section>
        ))}
      </nav>
    </aside>
  )
}
