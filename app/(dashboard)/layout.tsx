import { StudioShell } from '@/components/layout/studio-shell'
import { ThemePreferenceBootstrap } from '@/components/theme-preference-bootstrap'
import { GenerationSessionNavigationProvider } from '@/components/generation-session/session-navigation-guard'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="h-screen overflow-hidden bg-transparent">
      <ThemePreferenceBootstrap />
      <GenerationSessionNavigationProvider>
        <StudioShell>{children}</StudioShell>
      </GenerationSessionNavigationProvider>
    </div>
  )
}
