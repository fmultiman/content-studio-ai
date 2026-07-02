import {
  FileText,
  FolderKanban,
  Image,
  Images,
  LayoutDashboard,
  UploadCloud,
  Video,
  type LucideIcon,
} from 'lucide-react'

export type SidebarNavigationItemId =
  | 'dashboard'
  | 'projects'
  | 'contents'
  | 'images'
  | 'videos'
  | 'gallery'
  | 'files'

export type SidebarNavigationGroupId =
  | 'workspace'
  | 'creation'
  | 'libraries'

export interface SidebarNavigationItem {
  id: SidebarNavigationItemId
  icon: LucideIcon
  label: string
  href: string
}

export interface SidebarNavigationGroup {
  id: SidebarNavigationGroupId
  label: string
  items: SidebarNavigationItem[]
}

export const navigationGroups: SidebarNavigationGroup[] = [
  {
    id: 'workspace',
    label: 'Workspace',
    items: [
      {
        id: 'dashboard',
        icon: LayoutDashboard,
        label: 'Dashboard',
        href: '/dashboard',
      },
      {
        id: 'projects',
        icon: FolderKanban,
        label: 'Projetos',
        href: '/projetos',
      },
      {
        id: 'contents',
        icon: FileText,
        label: 'Conteúdos',
        href: '/conteudos',
      },
    ],
  },
  {
    id: 'creation',
    label: 'Criação',
    items: [
      { id: 'images', icon: Image, label: 'Imagens', href: '/imagens' },
      { id: 'videos', icon: Video, label: 'Vídeos', href: '/videos' },
    ],
  },
  {
    id: 'libraries',
    label: 'Bibliotecas',
    items: [
      { id: 'gallery', icon: Images, label: 'Galeria', href: '/galeria' },
      { id: 'files', icon: UploadCloud, label: 'Arquivos', href: '/arquivos' },
    ],
  },
]

function normalizePathname(pathname: string) {
  const [pathWithoutQuery] = pathname.split(/[?#]/)
  const normalized = pathWithoutQuery.replace(/\/+$/, '')
  return normalized || '/'
}

export function isNavigationItemActive(
  item: Pick<SidebarNavigationItem, 'href'>,
  pathname: string,
) {
  const currentPath = normalizePathname(pathname)
  const itemPath = normalizePathname(item.href)

  return currentPath === itemPath || currentPath.startsWith(`${itemPath}/`)
}

export function getActiveNavigationItem(pathname: string) {
  return (
    flattenNavigationGroups().find((item) =>
      isNavigationItemActive(item, pathname),
    ) ?? null
  )
}

export function flattenNavigationGroups() {
  return navigationGroups.flatMap((group) => [...group.items])
}
