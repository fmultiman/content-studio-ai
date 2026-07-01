import { StudioShell } from '@/components/layout/studio-shell'
import { ThemePreferenceBootstrap } from '@/components/theme-preference-bootstrap'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="h-screen overflow-hidden bg-transparent">
      <ThemePreferenceBootstrap />
      <StudioShell>{children}</StudioShell>
    </div>
  )
}
