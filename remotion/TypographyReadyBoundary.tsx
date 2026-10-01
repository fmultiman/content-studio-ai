import React, { useEffect, useState } from 'react'
import { continueRender, delayRender } from 'remotion'
import { awaitTypographyReady, type ResolvedTypography } from '@/lib/creative/typography/resolve-typography'

export function TypographyReadyBoundary({ typography, children }: { typography: ResolvedTypography; children: React.ReactNode }) {
  const [handle] = useState(() => delayRender('Waiting for deterministic local typography'))
  const [error, setError] = useState<string | undefined>()

  // Keyed by the declared faces (not object identity): a caller that derives `typography` per render must not restart the wait.
  const facesKey = typography.cssText
  useEffect(() => {
    let active = true
    void awaitTypographyReady(typography).then((diagnostics) => {
      if (!active) return
      if (diagnostics.length > 0) {
        setError(diagnostics.map((diagnostic) => diagnostic.message).join('; '))
        continueRender(handle)
        return
      }
      continueRender(handle)
    })
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `facesKey` is the identity of `typography`'s faces
  }, [handle, facesKey])

  if (error) throw new Error(`typography_error: ${error}`)
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: typography.cssText }} />
      {children}
    </>
  )
}
