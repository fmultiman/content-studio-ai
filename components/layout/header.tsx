'use client'

interface HeaderProps {
  title?: string
}

export function Header({ title }: HeaderProps) {
  if (!title) {
    return null
  }

  return (
    <section className="shrink-0 px-6 pt-4">
      <h1 className="text-xl font-semibold tracking-[-0.025em] text-foreground">
        {title}
      </h1>
    </section>
  )
}
