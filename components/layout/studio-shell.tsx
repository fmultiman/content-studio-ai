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
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react'
import type { User as SupabaseUser } from '@supabase/supabase-js'
import {
  Bell,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sparkles,
  LogOut,
  X,
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
import { useStudioShellViewport } from '@/hooks/use-mobile'
import {
  isNavigationItemActive,
  navigationGroups,
  type SidebarNavigationItem,
} from '@/lib/sidebar-navigation'
import {
  canStudioShellExpandImmediately,
  getStudioShellRenderedDesktopMode,
  getLastVisibleStudioShellMode,
  isStudioShellVisibleMode,
  resolveStudioShellState,
  sanitizeStudioShellDesktopPreference,
  STUDIO_SHELL_COMPACT_WIDTH,
  STUDIO_SHELL_EXPANDED_WIDTH,
  STUDIO_SHELL_LAST_VISIBLE_STORAGE_KEY,
  STUDIO_SHELL_MOBILE_BREAKPOINT,
  STUDIO_SHELL_MOBILE_DRAWER_VIEWPORT_WIDTH,
  STUDIO_SHELL_MOBILE_DRAWER_WIDTH,
  STUDIO_SHELL_PAGE_PADDING,
  STUDIO_SHELL_RAIL_MAX_HEIGHT,
  STUDIO_SHELL_RAIL_RADIUS,
  STUDIO_SHELL_RAIL_TOP_OFFSET,
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
const STUDIO_SHELL_STORAGE_CHANGE_EVENT = 'studio-shell-storage-change'

type StudioShellStoredState = {
  desktopPreference: StudioShellDesktopPreference | null
  lastVisibleMode: StudioShellVisibleMode | null
}

const EMPTY_STUDIO_SHELL_STORED_STATE_SNAPSHOT = ''
let storedStudioShellStateSnapshotCache =
  EMPTY_STUDIO_SHELL_STORED_STATE_SNAPSHOT

function subscribeToStudioShellStorage(onStoreChange: () => void) {
  const handleStorageChange = (event: Event) => {
    if (event instanceof StorageEvent) {
      if (
        event.key !== null &&
        event.key !== STUDIO_SHELL_STORAGE_KEY &&
        event.key !== STUDIO_SHELL_LAST_VISIBLE_STORAGE_KEY
      ) {
        return
      }
    }

    onStoreChange()
  }

  window.addEventListener('storage', handleStorageChange)
  window.addEventListener(
    STUDIO_SHELL_STORAGE_CHANGE_EVENT,
    handleStorageChange,
  )

  // Force reconciliation from the live client snapshot right after hydration.
  onStoreChange()

  return () => {
    window.removeEventListener('storage', handleStorageChange)
    window.removeEventListener(
      STUDIO_SHELL_STORAGE_CHANGE_EVENT,
      handleStorageChange,
    )
  }
}

function getStoredStudioShellStateSnapshot() {
  const storedPreference = sanitizeStudioShellDesktopPreference(
    window.localStorage.getItem(STUDIO_SHELL_STORAGE_KEY),
  )
  const storedLastVisibleMode = window.localStorage.getItem(
    STUDIO_SHELL_LAST_VISIBLE_STORAGE_KEY,
  )

  const nextSnapshot = JSON.stringify({
    desktopPreference: storedPreference,
    lastVisibleMode: isStudioShellVisibleMode(storedLastVisibleMode)
      ? storedLastVisibleMode
      : null,
  } satisfies StudioShellStoredState)

  if (storedStudioShellStateSnapshotCache !== nextSnapshot) {
    storedStudioShellStateSnapshotCache = nextSnapshot
  }

  return storedStudioShellStateSnapshotCache
}

function getStoredStudioShellStateServerSnapshot() {
  return EMPTY_STUDIO_SHELL_STORED_STATE_SNAPSHOT
}

function parseStoredStudioShellStateSnapshot(
  snapshot: string,
): StudioShellStoredState {
  if (!snapshot) {
    return {
      desktopPreference: null,
      lastVisibleMode: null,
    }
  }

  try {
    const parsed = JSON.parse(snapshot) as Partial<StudioShellStoredState>

    return {
      desktopPreference: sanitizeStudioShellDesktopPreference(
        parsed.desktopPreference,
      ),
      lastVisibleMode: isStudioShellVisibleMode(parsed.lastVisibleMode)
        ? parsed.lastVisibleMode
        : null,
    }
  } catch {
    return {
      desktopPreference: null,
      lastVisibleMode: null,
    }
  }
}

type StudioShellContextValue = {
  desktopPreference: StudioShellDesktopPreference
  effectiveMode: StudioShellEffectiveMode
  lastVisibleMode: StudioShellVisibleMode
  renderedDesktopMode: StudioShellVisibleMode | null
  canExpandImmediately: boolean
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
            mobileDrawerOpen ? (
              <X className="h-4 w-4" />
            ) : (
              <Menu className="h-4 w-4" />
            )
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
  const {
    canExpandImmediately,
    effectiveMode,
    lastVisibleMode,
    setCompact,
    setExpanded,
  } = useStudioShell()

  if (effectiveMode === MOBILE_DRAWER_EFFECTIVE_MODE) {
    return null
  }

  const isCompact =
    effectiveMode === 'compact' ||
    (effectiveMode === 'hidden' && lastVisibleMode === 'compact')

  if (isCompact && !canExpandImmediately) {
    return null
  }

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
  const Icon = item.icon
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
  const { effectiveMode, isMobileViewport, renderedDesktopMode } = useStudioShell()
  const compact = renderedDesktopMode === 'compact'

  if (isMobileViewport) {
    return (
      <Sidebar
        side="left"
        variant="sidebar"
        collapsible="offcanvas"
        className="z-50 !max-w-none !gap-0 !border-r !border-border-subtle/80 !bg-surface-elevated !p-0 !text-foreground !shadow-elevation-high [backdrop-filter:blur(var(--studio-glass-blur))]"
        style={
          {
            width: `min(${STUDIO_SHELL_MOBILE_DRAWER_WIDTH}, ${STUDIO_SHELL_MOBILE_DRAWER_VIEWPORT_WIDTH})`,
          } as CSSProperties
        }
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
      className="z-30 border-none bg-transparent px-3 pb-3 shadow-none motion-reduce:transition-none [&>[data-sidebar=sidebar]]:rounded-none [&>[data-sidebar=sidebar]]:border-0 [&>[data-sidebar=sidebar]]:bg-transparent [&>[data-sidebar=sidebar]]:shadow-none [&[data-slot=sidebar-container]]:bg-transparent [&[data-slot=sidebar-container]]:border-0 [&[data-slot=sidebar-container]]:shadow-none [&[data-slot=sidebar-container]]:outline-none [&[data-slot=sidebar-container]]:before:hidden [&[data-slot=sidebar-container]]:after:hidden"
      style={{ paddingTop: STUDIO_SHELL_RAIL_TOP_OFFSET }}
      aria-label="Navegação principal"
    >
      <div
        id="studio-shell-navigation"
        className={cn(
          'flex self-start flex-col overflow-hidden border border-border-subtle/80 bg-surface-translucent [backdrop-filter:blur(var(--studio-glass-blur))]',
          compact && 'mt-6',
        )}
        style={{
          borderRadius: STUDIO_SHELL_RAIL_RADIUS,
          boxShadow: 'var(--shadow-elevation-low)',
          maxHeight: STUDIO_SHELL_RAIL_MAX_HEIGHT,
        }}
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
  const viewport = useStudioShellViewport()
  const isMobileViewport = viewport.isMobile
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const previousPathnameRef = useRef(pathname)
  const pendingTriggerFocusRestoreRef = useRef(false)
  const pendingTriggerFocusAfterPathChangeRef = useRef(false)
  const pathnameAtDrawerCloseRef = useRef<string | null>(null)
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false)
  const mobileDrawerOpenRef = useRef(mobileDrawerOpen)
  const [desktopPreferenceOverride, setDesktopPreferenceOverride] =
    useState<StudioShellDesktopPreference | null>(null)
  const [lastVisibleModeOverride, setLastVisibleModeOverride] =
    useState<StudioShellVisibleMode | null>(null)
  const [hiddenVisualMode, setHiddenVisualMode] =
    useState<StudioShellVisibleMode | null>(null)
  const storedShellStateSnapshot = useSyncExternalStore(
    subscribeToStudioShellStorage,
    getStoredStudioShellStateSnapshot,
    getStoredStudioShellStateServerSnapshot,
  )
  const storedShellState = useMemo(
    () => parseStoredStudioShellStateSnapshot(storedShellStateSnapshot),
    [storedShellStateSnapshot],
  )
  const {
    desktopPreference,
    effectiveMode,
    lastVisibleMode,
  } = resolveStudioShellState({
    viewportWidth: viewport.width,
    storedPreference: storedShellState.desktopPreference,
    storedLastVisibleMode: storedShellState.lastVisibleMode,
    desktopPreferenceOverride,
    lastVisibleModeOverride,
  })
  const canExpandImmediately = canStudioShellExpandImmediately(viewport.width)
  const renderedDesktopMode = getStudioShellRenderedDesktopMode({
    effectiveMode,
    lastVisibleMode,
    hiddenVisualMode,
  })

  useEffect(() => {
    if (
      desktopPreferenceOverride === null ||
      lastVisibleModeOverride === null
    ) {
      return
    }

    window.localStorage.setItem(STUDIO_SHELL_STORAGE_KEY, desktopPreference)
    window.localStorage.setItem(
      STUDIO_SHELL_LAST_VISIBLE_STORAGE_KEY,
      lastVisibleMode,
    )
    window.dispatchEvent(new Event(STUDIO_SHELL_STORAGE_CHANGE_EVENT))
  }, [
    desktopPreference,
    desktopPreferenceOverride,
    lastVisibleMode,
    lastVisibleModeOverride,
  ])

  useEffect(() => {
    mobileDrawerOpenRef.current = mobileDrawerOpen
  }, [mobileDrawerOpen])

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
    const mobileBreakpointMediaQuery = window.matchMedia(
      `(max-width: ${STUDIO_SHELL_MOBILE_BREAKPOINT}px)`,
    )

    const handleDesktopTransition = (event: MediaQueryListEvent) => {
      if (!event.matches && mobileDrawerOpenRef.current) {
        setMobileDrawerOpen(false)
      }
    }

    mobileBreakpointMediaQuery.addEventListener('change', handleDesktopTransition)

    return () => {
      mobileBreakpointMediaQuery.removeEventListener(
        'change',
        handleDesktopTransition,
      )
    }
  }, [])

  const hiddenDesktopWidth =
    renderedDesktopMode === 'compact'
      ? `calc(${STUDIO_SHELL_COMPACT_WIDTH} + 0.75rem)`
      : STUDIO_SHELL_EXPANDED_WIDTH

  const commitDesktopPreference = useCallback(
    (nextPreference: StudioShellDesktopPreference) => {
      setDesktopPreferenceOverride(nextPreference)
      setLastVisibleModeOverride(
        getLastVisibleStudioShellMode(nextPreference, lastVisibleMode),
      )
    },
    [lastVisibleMode],
  )

  const restoreLastVisibleMode = useCallback(() => {
    setHiddenVisualMode(null)
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
    setHiddenVisualMode(null)
    commitDesktopPreference('expanded')
  }, [commitDesktopPreference])

  const setCompact = useCallback(() => {
    setHiddenVisualMode(null)
    commitDesktopPreference('compact')
  }, [commitDesktopPreference])

  const setHidden = useCallback(() => {
    setHiddenVisualMode(
      effectiveMode === 'expanded' ? 'expanded' : 'compact',
    )
    commitDesktopPreference('hidden')
  }, [commitDesktopPreference, effectiveMode])

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
      renderedDesktopMode,
      canExpandImmediately,
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
      canExpandImmediately,
      desktopPreference,
      effectiveMode,
      handleMobileDrawerOpenChange,
      isMobileViewport,
      lastVisibleMode,
      mobileDrawerOpen,
      renderedDesktopMode,
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
          data-shell-hidden-visual-mode={hiddenVisualMode ?? ''}
          data-shell-rendered-desktop-mode={renderedDesktopMode ?? ''}
          data-shell-initialized="true"
        >
          <GlobalUtilityBar />
          <StudioShellRail />
          <main
            className="studio-main flex min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto pt-[var(--studio-shell-top-bar-height)] motion-reduce:transition-none"
            data-shell-main
            style={{
              '--studio-shell-page-padding': STUDIO_SHELL_PAGE_PADDING,
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
