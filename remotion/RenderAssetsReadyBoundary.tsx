import React, { useEffect, useState } from 'react'
import { cancelRender, continueRender, delayRender } from 'remotion'

/**
 * Static Render Worker V1 — holds a still capture until every image the
 * template paints has actually loaded.
 *
 * DocumentaryCard paints its materials, hero and logo as CSS
 * `background-image`s, which Remotion does not wait for (it only waits on
 * delayRender handles, fonts and its own <Img>). A still is ONE captured
 * frame, so a late-arriving image — the presigned Pack B primitives from
 * MinIO in particular — was simply missing from the PNG. This preloads each
 * URL with `new Image()` and only releases the frame once all are decoded.
 *
 * A URL that fails to load cancels the render with a clear error instead of
 * producing a silently incomplete PNG; the worker reports that as a normal
 * execution failure.
 */
export const RenderAssetsReadyBoundary: React.FC<{ urls: readonly string[]; children: React.ReactNode }> = ({ urls, children }) => {
  const [handle] = useState(() => delayRender(`Waiting for ${urls.length} template image(s)`))

  useEffect(() => {
    let cancelled = false
    const unique = [...new Set(urls.filter((url) => typeof url === 'string' && url.length > 0))]
    Promise.all(unique.map((url) => new Promise<void>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve()
      image.onerror = () => reject(new Error(`Template image failed to load: ${url.split('?')[0]}`))
      image.src = url
    })))
      .then(() => { if (!cancelled) continueRender(handle) })
      .catch((error: unknown) => { if (!cancelled) cancelRender(error instanceof Error ? error : new Error(String(error))) })
    return () => { cancelled = true }
  }, [handle, urls])

  return <>{children}</>
}
