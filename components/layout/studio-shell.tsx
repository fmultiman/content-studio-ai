'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react'
import type { User as SupabaseUser } from '@supabase/supabase-js'
import {
  Bell,
  FileText,
  FolderKanban,
  Image,
  Images,
  LayoutDashboard,
  PanelLeft,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sparkles,
  UploadCloud,
  Video,
  LogOut,
} from 'lucide-react'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from '@/components/ui/sidebar'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useIsMobile } from '@/hooks/use-mobile'
import {
  isNavigationItemActive,
  navigationGroups,
  type SidebarNavigationItem,
  type SidebarNavigationItemId,
} from '@/lib/sidebar-navigation'
import {
  getDefaultStudioShellDesktopPreference,
  getLastVisibleStudioShellMode,
  getStudioShellEffectiveMode,
  isStudioShellVisibleMode,
  sanitizeStudioShellDesktopPreference,
  STUDIO_SHELL_COMPACT_WIDTH,
  STUDIO_SHELL_EXPANDED_WIDTH,
  STUDIO_SHELL_LAST_VISIBLE_STORAGE_KEY,
  STUDIO_SHELL_MOBILE_BREAKPOINT,
  STUDIO_SHELL_STORAGE_KEY,
  STUDIO_SHELL_TOP_BAR_HEIGHT,
  STUDIO_SHELL_TRANSITION_MS,
  STUDIO_SHELL_WIDE_BREAKPOINT,
  type StudioShellDesktopPreference,
  type StudioShellEffectiveMode,
  type StudioShellVisibleMode,
} from '@/lib/studio-shell-state'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

const MOBILE_DRAWER_EFFECTIVE_MODE = 'mobile-drawer' as const

const navigationIcons: Record<SidebarNavigationItemId, typeof LayoutDashboard> = {
  dashboard: LayoutDashboard,
  projects: FolderKanban,
  contents: FileText,
  images: Image,
  videos: Video,
  gallery: Images,
  files: UploadCloud,
}

type StudioShellContextValue = {
  desktopPreference: StudioShellDesktopPreference
  effectiveMode: StudioShellEffectiveMode
  lastVisibleMode: StudioShellVisibleMode
  isMobileViewport: boolean
  mobileDrawerOpen: boolean
  setMobileDrawerOpen: (open: boolean) => void
  closeMobileDrawerForNavigation: () => void
  toggleFromHeader: () => void
  setExpanded: () => void
  setCompact: () => void
  setHidden: () => void
  restoreLastVisibleMode: () => void
  triggerLabel: string
  triggerRef: RefObject<HTMLButtonElement | null>
}

const StudioShellContext = createContext<StudioShellContextValue | null>(null)

function useStudioShell() {
  const context = useContext(StudioShellContext)

  if (!context) {
    throw new Error('useStudioShell must be used within a StudioShell.')
  }

  return context
}

function getTriggerLabel(mode: StudioShellEffectiveMode, mobileDrawerOpen: boolean) {
  if (mode === MOBILE_DRAWER_EFFECTIVE_MODE) {
    return mobileDrawerOpen ? 'Fechar navegação' : 'Abrir navegação'
  }

  if (mode === 'hidden') {
    return 'Mostrar navegação'
  }

  return 'Ocultar navegação'
}

function UtilityAction({
  ariaLabel,
  children,
  href,
  onClick,
}: {
  ariaLabel: string
  children: ReactNode
  href?: string
  onClick?: () => void
}) {
  const button = href ? (
    <Button asChild variant="ghost" size="icon" className="h-8 w-8 rounded-lg">
      <Link href={href} aria-label={ariaLabel}>
        {children}
      </Link>
    </Button>
  ) : (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-8 w-8 rounded-lg"
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {children}
    </Button>
  )

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{ariaLabel}</TooltipContent>
    </Tooltip>
  )
}

export function StudioShellHeaderTrigger() {
  const {
    effectiveMode,
    mobileDrawerOpen,
    toggleFromHeader,
    triggerLabel,
    triggerRef,
  } = useStudioShell()

  const isVisibleState =
    effectiveMode === 'hidden' || (effectiveMode === MOBILE_DRAWER_EFFECTIVE_MODE && mobileDrawerOpen)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            'h-8 w-8 rounded-lg text-muted-foreground transition-colors hover:bg-surface-interactive hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            isVisibleState
              ? 'bg-surface-interactive text-foreground'
              : '',
          )}
          aria-label={triggerLabel}
          aria-expanded={
            effectiveMode === MOBILE_DRAWER_EFFECTIVE_MODE
              ? mobileDrawerOpen
              : effectiveMode !== 'hidden'
          }
          aria-controls="studio-shell-navigation"
          onClick={toggleFromHeader}
        >
          {effectiveMode === MOBILE_DRAWER_EFFECTIVE_MODE ? (
            <PanelLeft className="h-4 w-4" />
          ) : effectiveMode === 'hidden' ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
          <span className="sr-only">{triggerLabel}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{triggerLabel}</TooltipContent>
    </Tooltip>
  )
}

function GlobalUtilityBar() {
  const router = useRouter()
  const [user, setUser] = useState<SupabaseUser | null>(null)

  useEffect(() => {
    const supabase = createClient()

    const getUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      setUser(user)
    }

    getUser()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const userInitials = user?.email ? user.email.slice(0, 2).toUpperCase() : 'U'
  const userName = user?.email?.split('@')[0] || 'Usuário'

  return (
    <header
      className="fixed inset-x-0 top-0 z-40 border-b border-border-subtle/80 bg-surface-translucent/95 px-3 shadow-elevation-low [backdrop-filter:blur(var(--studio-glass-blur))]"
      style={{ height: STUDIO_SHELL_TOP_BAR_HEIGHT }}
    >
      <div className="mx-auto flex h-full w-full items-center gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <StudioShellHeaderTrigger />
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href="/dashboard"
                aria-label="Abrir dashboard"
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-cyan-500 text-white transition-transform hover:scale-[1.02] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <Sparkles className="h-4 w-4" />
              </Link>
            </TooltipTrigger>
            <TooltipContent>Abrir dashboard</TooltipContent>
          </Tooltip>
          <Link
            href="/dashboard"
            className="hidden min-[1400px]:inline-flex items-center text-sm font-medium tracking-[-0.02em] text-foreground/88 transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Content Studio
          </Link>
        </div>

        <div
          data-slot="shell-utility-center"
          className="min-w-0 flex-1"
          aria-hidden="true"
        />

        <div className="flex items-center gap-1">
          <UtilityAction ariaLabel="Notificações">
            <Bell className="h-4 w-4" />
          </UtilityAction>
          <UtilityAction ariaLabel="Abrir configurações" href="/configuracoes">
            <Settings className="h-4 w-4" />
          </UtilityAction>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-lg"
                aria-label={`Abrir menu da conta de ${userName}`}
              >
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-gradient-to-br from-violet-600 to-cyan-500 text-[0.7rem] text-white">
                    {userInitials}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel className="space-y-1">
                <p className="text-sm font-medium text-foreground">{userName}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {user?.email || 'Sem sessão ativa'}
                </p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => router.push('/configuracoes')}>
                <Settings className="mr-2 h-4 w-4" />
                Configurações
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} className="text-destructive">
                <LogOut className="mr-2 h-4 w-4" />
                Sair
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}

function RailControlButton({
  ariaLabel,
  children,
  onClick,
}: {
  ariaLabel: string
  children: ReactNode
  onClick: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-surface-interactive hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          aria-label={ariaLabel}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{ariaLabel}</TooltipContent>
    </Tooltip>
  )
}

function StudioShellDesktopControls() {
  const { effectiveMode, lastVisibleMode, setCompact, setExpanded } = useStudioShell()

  if (effectiveMode === MOBILE_DRAWER_EFFECTIVE_MODE) {
    return null
  }

  const isCompact =
    effectiveMode === 'compact' ||
    (effectiveMode === 'hidden' && lastVisibleMode === 'compact')

  return (
    <div className="flex items-center justify-center">
      <RailControlButton
        ariaLabel={isCompact ? 'Expandir navegação' : 'Compactar navegação'}
        onClick={isCompact ? setExpanded : setCompact}
      >
        {isCompact ? (
          <span aria-hidden="true" className="text-base font-semibold leading-none">
            &gt;
          </span>
        ) : (
          <span aria-hidden="true" className="text-base font-semibold leading-none">
            &lt;
          </span>
        )}
      </RailControlButton>
    </div>
  )
}

function StudioShellNavLink({
  item,
  compact,
}: {
  item: SidebarNavigationItem
  compact: boolean
}) {
  const pathname = usePathname()
  const { closeMobileDrawerForNavigation, isMobileViewport } = useStudioShell()
  const Icon = navigationIcons[item.id]
  const isActive = isNavigationItemActive(item, pathname)

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={isActive}
        tooltip={item.label}
        className={cn(
          'min-h-9 rounded-xl px-2.5 text-sm font-medium text-muted-foreground !transition-[background-color,color] hover:bg-surface-interactive hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[active=true]:bg-surface-selected data-[active=true]:text-foreground',
          compact
            ? '!h-8 !w-8 !justify-center !p-2'
            : 'justify-start',
        )}
      >
        <Link
          href={item.href}
          className={cn(
            'flex items-center',
            compact ? 'justify-center' : 'w-full justify-start gap-2',
          )}
          aria-label={compact ? item.label : undefined}
          aria-current={isActive ? 'page' : undefined}
          onClick={() => {
            if (isMobileViewport) {
              window.setTimeout(() => {
                closeMobileDrawerForNavigation()
              }, 0)
              return
            }
          }}
        >
          <Icon
            aria-hidden="true"
            className={cn('h-5 w-5 shrink-0', isActive && 'text-primary')}
          />
          <span className={compact ? 'sr-only' : undefined}>{item.label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

function StudioShellRail() {
  const { effectiveMode, isMobileViewport, lastVisibleMode } = useStudioShell()
  const compact =
    effectiveMode === 'compact' ||
    (effectiveMode === 'hidden' && lastVisibleMode === 'compact')

  if (isMobileViewport) {
    return (
      <Sidebar
        side="left"
        variant="sidebar"
        collapsible="offcanvas"
        className="z-50 !w-[min(11.75rem,56vw)] !max-w-none !gap-0 !border-r !border-border-subtle/80 !bg-surface-elevated !p-0 !text-foreground !shadow-elevation-high [backdrop-filter:blur(var(--studio-glass-blur))]"
        aria-label="NavegaÃ§Ã£o principal"
      >
        <div
          id="studio-shell-navigation"
          className="flex h-full flex-col overflow-hidden"
        >
          <div className="flex items-center gap-2.5 border-b border-border-subtle/70 px-2.5 py-3">
            <Link
              href="/dashboard"
              aria-label="Abrir dashboard"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-cyan-500 text-white"
            >
              <Sparkles className="h-4 w-4" />
            </Link>
            <p className="min-w-0 text-sm font-medium tracking-[-0.02em] text-foreground">
              Content Studio
            </p>
          </div>

          <SidebarContent className="gap-3 px-2 py-3">
            {navigationGroups.map((group) => (
              <SidebarGroup key={group.id} className="p-0">
                <SidebarGroupLabel className="px-2 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">
                  {group.label}
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu className="gap-px">
                    {group.items.map((item) => (
                      <StudioShellNavLink key={item.id} item={item} compact={false} />
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ))}
          </SidebarContent>
        </div>
      </Sidebar>
    )
  }

  return (
    <Sidebar
      side="left"
      variant="sidebar"
      collapsible={effectiveMode === 'hidden' ? 'offcanvas' : 'icon'}
      className="z-30 border-none bg-transparent px-3 pb-3 pt-[3.75rem] shadow-none motion-reduce:transition-none [&>[data-sidebar=sidebar]]:rounded-none [&>[data-sidebar=sidebar]]:border-0 [&>[data-sidebar=sidebar]]:bg-transparent [&>[data-sidebar=sidebar]]:shadow-none [&[data-slot=sidebar-container]]:bg-transparent [&[data-slot=sidebar-container]]:border-0 [&[data-slot=sidebar-container]]:shadow-none [&[data-slot=sidebar-container]]:outline-none [&[data-slot=sidebar-container]]:before:hidden [&[data-slot=sidebar-container]]:after:hidden"
      aria-label="Navegação principal"
    >
      <div
        id="studio-shell-navigation"
        className={cn(
          'flex max-h-[calc(100svh-4.5rem)] self-start flex-col overflow-hidden rounded-[1.25rem] border border-border-subtle/80 bg-surface-translucent shadow-[0_10px_24px_rgb(2_6_23_/_0.16)] [backdrop-filter:blur(var(--studio-glass-blur))] dark:shadow-[0_12px_28px_rgb(2_6_23_/_0.24)]',
          compact && 'mt-6',
        )}
      >
        <SidebarHeader
          className="items-center border-b border-border-subtle/70 px-2 py-1.5"
        >
          <StudioShellDesktopControls />
        </SidebarHeader>

        <SidebarContent className="gap-2.5 px-2 py-1.5">
          {navigationGroups.map((group) => (
            <SidebarGroup
              key={group.id}
              className={cn(
                'p-0',
                compact ? 'items-center' : 'items-stretch',
              )}
            >
              <SidebarGroupLabel
                className={cn(
                  'px-2 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70',
                  compact && 'hidden',
                )}
              >
                {group.label}
              </SidebarGroupLabel>
              <SidebarGroupContent className={cn(compact && 'flex justify-center')}>
                <SidebarMenu className={cn(compact ? 'items-center gap-px' : 'gap-px')}>
                  {group.items.map((item) => (
                    <StudioShellNavLink key={item.id} item={item} compact={compact} />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>
      </div>
    </Sidebar>
  )
}

export function StudioShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const isMobileViewport = useIsMobile()
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const previousPathnameRef = useRef(pathname)
  const pendingTriggerFocusRestoreRef = useRef(false)
  const pendingTriggerFocusAfterPathChangeRef = useRef(false)
  const pathnameAtDrawerCloseRef = useRef<string | null>(null)
  const [viewportWidth, setViewportWidth] = useState(STUDIO_SHELL_WIDE_BREAKPOINT)
  const [desktopPreference, setDesktopPreference] =
    useState<StudioShellDesktopPreference>('expanded')
  const [lastVisibleMode, setLastVisibleMode] =
    useState<StudioShellVisibleMode>('expanded')
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false)
  const [hasExplicitPreference, setHasExplicitPreference] = useState(false)
  const [isInitialized, setIsInitialized] = useState(false)

  useEffect(() => {
    const updateViewportWidth = () => {
      const nextViewportWidth = window.innerWidth
      setViewportWidth(nextViewportWidth)

      if (!hasExplicitPreference) {
        const nextDefaultPreference =
          getDefaultStudioShellDesktopPreference(nextViewportWidth)
        setDesktopPreference(nextDefaultPreference)
        setLastVisibleMode((currentLastVisibleMode) =>
          getLastVisibleStudioShellMode(nextDefaultPreference, currentLastVisibleMode),
        )
      }
    }

    const storedPreference = sanitizeStudioShellDesktopPreference(
      window.localStorage.getItem(STUDIO_SHELL_STORAGE_KEY),
    )
    const storedLastVisibleMode = window.localStorage.getItem(
      STUDIO_SHELL_LAST_VISIBLE_STORAGE_KEY,
    )
    const nextViewportWidth = window.innerWidth
    const nextDefaultPreference =
      getDefaultStudioShellDesktopPreference(nextViewportWidth)
    const nextDesktopPreference = storedPreference ?? nextDefaultPreference
    const nextLastVisibleMode = isStudioShellVisibleMode(storedLastVisibleMode)
      ? storedLastVisibleMode
      : nextDesktopPreference === 'hidden'
        ? 'expanded'
        : nextDesktopPreference

    setViewportWidth(nextViewportWidth)
    setDesktopPreference(nextDesktopPreference)
    setLastVisibleMode(nextLastVisibleMode)
    setHasExplicitPreference(Boolean(storedPreference))
    setIsInitialized(true)

    window.addEventListener('resize', updateViewportWidth)

    return () => {
      window.removeEventListener('resize', updateViewportWidth)
    }
  }, [hasExplicitPreference])

  useEffect(() => {
    if (!isInitialized || !hasExplicitPreference) {
      return
    }

    window.localStorage.setItem(STUDIO_SHELL_STORAGE_KEY, desktopPreference)
    window.localStorage.setItem(
      STUDIO_SHELL_LAST_VISIBLE_STORAGE_KEY,
      lastVisibleMode,
    )
  }, [desktopPreference, hasExplicitPreference, isInitialized, lastVisibleMode])

  useEffect(() => {
    if (!mobileDrawerOpen && pendingTriggerFocusRestoreRef.current) {
      if (
        pendingTriggerFocusAfterPathChangeRef.current &&
        pathnameAtDrawerCloseRef.current === pathname
      ) {
        return
      }

      requestAnimationFrame(() => {
        triggerRef.current?.focus()
        pendingTriggerFocusRestoreRef.current = false
        pendingTriggerFocusAfterPathChangeRef.current = false
        pathnameAtDrawerCloseRef.current = null
      })
    }
  }, [mobileDrawerOpen, pathname])

  useEffect(() => {
    if (!isMobileViewport && mobileDrawerOpen) {
      setMobileDrawerOpen(false)
    }
  }, [isMobileViewport, mobileDrawerOpen])

  const effectiveMode = getStudioShellEffectiveMode(desktopPreference, viewportWidth)
  const hiddenDesktopWidth =
    effectiveMode === 'hidden' && lastVisibleMode === 'compact'
      ? `calc(${STUDIO_SHELL_COMPACT_WIDTH} + 0.75rem)`
      : STUDIO_SHELL_EXPANDED_WIDTH

  const commitDesktopPreference = useCallback(
    (nextPreference: StudioShellDesktopPreference) => {
      setDesktopPreference(nextPreference)
      setLastVisibleMode((currentLastVisibleMode) =>
        getLastVisibleStudioShellMode(nextPreference, currentLastVisibleMode),
      )
      setHasExplicitPreference(true)
    },
    [],
  )

  const restoreLastVisibleMode = useCallback(() => {
    commitDesktopPreference(lastVisibleMode)
  }, [commitDesktopPreference, lastVisibleMode])

  const handleMobileDrawerOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        pendingTriggerFocusRestoreRef.current = true
        pendingTriggerFocusAfterPathChangeRef.current = false
        pathnameAtDrawerCloseRef.current = pathname
      }

      setMobileDrawerOpen(nextOpen)
    },
    [pathname],
  )

  const closeMobileDrawerForNavigation = useCallback(() => {
    pendingTriggerFocusRestoreRef.current = true
    pendingTriggerFocusAfterPathChangeRef.current = true
    pathnameAtDrawerCloseRef.current = pathname
    setMobileDrawerOpen(false)
  }, [pathname])

  useEffect(() => {
    if (
      isMobileViewport &&
      mobileDrawerOpen &&
      previousPathnameRef.current !== pathname
    ) {
      closeMobileDrawerForNavigation()
    }

    previousPathnameRef.current = pathname
  }, [
    closeMobileDrawerForNavigation,
    isMobileViewport,
    mobileDrawerOpen,
    pathname,
  ])

  const setExpanded = useCallback(() => {
    commitDesktopPreference('expanded')
  }, [commitDesktopPreference])

  const setCompact = useCallback(() => {
    commitDesktopPreference('compact')
  }, [commitDesktopPreference])

  const setHidden = useCallback(() => {
    commitDesktopPreference('hidden')
  }, [commitDesktopPreference])

  const toggleFromHeader = useCallback(() => {
    if (isMobileViewport) {
      setMobileDrawerOpen((currentOpen) => !currentOpen)
      return
    }

    if (effectiveMode === 'hidden') {
      restoreLastVisibleMode()
      return
    }

    setHidden()
  }, [effectiveMode, isMobileViewport, restoreLastVisibleMode, setHidden])

  const triggerLabel = getTriggerLabel(effectiveMode, mobileDrawerOpen)

  const contextValue = useMemo<StudioShellContextValue>(
    () => ({
      desktopPreference,
      effectiveMode,
      lastVisibleMode,
      isMobileViewport,
      mobileDrawerOpen,
      setMobileDrawerOpen: handleMobileDrawerOpenChange,
      closeMobileDrawerForNavigation,
      toggleFromHeader,
      setExpanded,
      setCompact,
      setHidden,
      restoreLastVisibleMode,
      triggerLabel,
      triggerRef,
    }),
    [
      closeMobileDrawerForNavigation,
      desktopPreference,
      effectiveMode,
      handleMobileDrawerOpenChange,
      isMobileViewport,
      lastVisibleMode,
      mobileDrawerOpen,
      restoreLastVisibleMode,
      setCompact,
      setExpanded,
      setHidden,
      toggleFromHeader,
      triggerLabel,
    ],
  )

  return (
    <StudioShellContext.Provider value={contextValue}>
      <SidebarProvider
        open={effectiveMode === 'expanded'}
        onOpenChange={(nextOpen) => {
          if (isMobileViewport) {
            return
          }

          commitDesktopPreference(nextOpen ? 'expanded' : 'compact')
        }}
        openMobile={mobileDrawerOpen}
        onOpenMobileChange={handleMobileDrawerOpenChange}
        style={
          {
            '--sidebar-width': hiddenDesktopWidth,
            '--sidebar-width-icon': STUDIO_SHELL_COMPACT_WIDTH,
          } as CSSProperties
        }
      >
        <div
          className="studio-shell flex h-screen w-full min-w-0 overflow-hidden bg-transparent"
          data-shell-desktop-preference={desktopPreference}
          data-shell-effective-mode={effectiveMode}
          data-shell-last-visible-mode={lastVisibleMode}
          data-shell-initialized={isInitialized ? 'true' : 'false'}
        >
          <GlobalUtilityBar />
          <StudioShellRail />
          <main
            className="studio-main flex min-w-0 flex-1 flex-col overflow-hidden pt-[var(--studio-shell-top-bar-height)] motion-reduce:transition-none"
            data-shell-main
            style={{
              '--studio-shell-top-bar-height': STUDIO_SHELL_TOP_BAR_HEIGHT,
              transitionDuration: `${STUDIO_SHELL_TRANSITION_MS}ms`,
            } as CSSProperties}
          >
            {children}
          </main>
        </div>
      </SidebarProvider>
    </StudioShellContext.Provider>
  )
}
