import type { Metadata } from 'next'
import { Geist, Geist_Mono, Inter_Tight, JetBrains_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/ui/toaster'
import './globals.css'

const geist = Geist({
  subsets: ['latin'],
  variable: '--font-geist-sans',
})

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
})

const studioSans = Inter_Tight({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-studio-sans',
})

const studioMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-studio-mono',
})

export const metadata: Metadata = {
  title: 'Content Agent Studio',
  description: 'Plataforma de criação de conteúdo assistida por IA',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="pt-BR"
      suppressHydrationWarning
      className={`${geist.variable} ${geistMono.variable} ${studioSans.variable} ${studioMono.variable}`}
    >
      <body className="font-sans antialiased">
        <ThemeProvider>
          {children}
          <Toaster />
          {process.env.NODE_ENV === 'production' && <Analytics />}
        </ThemeProvider>
      </body>
    </html>
  )
}
