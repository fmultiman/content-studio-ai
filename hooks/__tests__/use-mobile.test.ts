import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  createStudioShellViewportSnapshot,
  isStudioShellViewportSnapshotEqual,
  STUDIO_SHELL_VIEWPORT_SERVER_SNAPSHOT,
} from '@/hooks/use-mobile'

describe('studio shell viewport store', () => {
  it('keeps the SSR snapshot wide by default and resolves client snapshots by width without resize', () => {
    expect(STUDIO_SHELL_VIEWPORT_SERVER_SNAPSHOT).toMatchObject({
      width: 1280,
      height: 0,
      isMobile: false,
      isWide: true,
    })

    expect(
      createStudioShellViewportSnapshot({ width: 390, height: 844 }),
    ).toMatchObject({
      width: 390,
      height: 844,
      isMobile: true,
      isWide: false,
    })

    expect(
      createStudioShellViewportSnapshot({ width: 769, height: 900 }),
    ).toMatchObject({
      width: 769,
      height: 900,
      isMobile: false,
      isWide: false,
    })

    expect(
      createStudioShellViewportSnapshot({ width: 1280, height: 800 }),
    ).toMatchObject({
      width: 1280,
      height: 800,
      isMobile: false,
      isWide: true,
    })
  })

  it('compares viewport snapshots by width, height, mobile, and wide flags', () => {
    const a = createStudioShellViewportSnapshot({ width: 768, height: 900 })
    const b = createStudioShellViewportSnapshot({ width: 768, height: 900 })
    const c = createStudioShellViewportSnapshot({ width: 769, height: 900 })

    expect(isStudioShellViewportSnapshotEqual(a, b)).toBe(true)
    expect(isStudioShellViewportSnapshotEqual(a, c)).toBe(false)
  })

  it('keeps an immediate client reconciliation path in both viewport and storage subscriptions', () => {
    const hookSource = readFileSync(
      join(process.cwd(), 'hooks/use-mobile.ts'),
      'utf8',
    )
    const shellSource = readFileSync(
      join(process.cwd(), 'components/layout/studio-shell.tsx'),
      'utf8',
    )

    expect(hookSource).toContain('// Ensure hydration leaves the SSR snapshot immediately, even before resize.')
    expect(hookSource).toContain('notifyViewportChange()')
    expect(shellSource).toContain('// Force reconciliation from the live client snapshot right after hydration.')
    expect(shellSource).toContain('onStoreChange()')
    expect(shellSource).toContain('window.dispatchEvent(new Event(STUDIO_SHELL_STORAGE_CHANGE_EVENT))')
  })
})
