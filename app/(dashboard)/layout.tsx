import { Sidebar } from '@/components/layout/sidebar'
import { ThemePreferenceBootstrap } from '@/components/theme-preference-bootstrap'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="studio-shell flex h-screen overflow-hidden bg-transparent">
      <ThemePreferenceBootstrap />
      <Sidebar />
      <main className="studio-main flex flex-1 flex-col overflow-hidden">
        {children}
      </main>
    </div>
  )
}
