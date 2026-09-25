import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'

/**
 * Local development harnesses only (/dev/*). In production every page under
 * this segment is a 404, matching the existing guard on
 * /dev/creative-preview/render. Pages here are client components, so the
 * guard lives in this server layout.
 */
export default function DevHarnessLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV === 'production') notFound()
  return children
}
