import { Sidebar } from '@/components/layout/sidebar'
import { ThemePreferenceBootstrap } from '@/components/theme-preference-bootstrap'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <ThemePreferenceBootstrap />
      <Sidebar />
      <main className="flex flex-1 flex-col overflow-hidden">
        {children}
      </main>
    </div>
  )
}
