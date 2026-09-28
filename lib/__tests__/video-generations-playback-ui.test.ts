import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const videosPageSource = readFileSync(
  join(process.cwd(), 'app', '(dashboard)', 'videos', 'page.tsx'),
  'utf-8',
)

const videoPreviewDialogSource = readFileSync(
  join(process.cwd(), 'components', 'videos', 'video-generation-preview-dialog.tsx'),
  'utf-8',
)

describe('Video Generations Playback UI', () => {
  it('Assistir opens the in-app player/modal instead of target=_blank', () => {
    // Should set state instead of window.open
    expect(videosPageSource).toMatch(/setSelectedVideoGeneration\(item\)/)
    expect(videosPageSource).not.toMatch(/window\.open\(item\.generation\.public_url, '_blank'\)/)
  })

  it('no primary target=_blank behavior remains on Assistir', () => {
    // The "Assistir" text should be adjacent to the setSelectedVideoGeneration
    const blockStart = videosPageSource.indexOf("setSelectedVideoGeneration(item)")
    const assistirIndex = videosPageSource.indexOf('Assistir', blockStart)
    expect(assistirIndex).toBeGreaterThan(blockStart)
    const substring = videosPageSource.substring(blockStart, assistirIndex)
    expect(substring).not.toMatch(/_blank/)
  })

  it('modal is present and can close', () => {
    expect(videosPageSource).toMatch(/<VideoGenerationPreviewDialog/)
    expect(videosPageSource).toMatch(/onOpenChange=\{\(open\) => \{/)
    expect(videosPageSource).toMatch(/if \(!open\) setSelectedVideoGeneration\(null\)/)
  })

  it('I2V and T2V card playback handled without fixed geometry constraints', () => {
    expect(videoPreviewDialogSource).toMatch(/className="w-full h-full object-contain bg-black"/)
    expect(videoPreviewDialogSource).not.toMatch(/width=\{960\}/)
    expect(videoPreviewDialogSource).not.toMatch(/height=\{1280\}/)
    // Should respect dimension constraints by using object-contain
    expect(videoPreviewDialogSource).toMatch(/object-contain/)
  })

  it('video receives correct playback URL dynamically', () => {
    expect(videoPreviewDialogSource).toMatch(/fetch\(.*\/api\/video-generations\/\$\{.*?\}\/playback-url\?disposition=inline.*\)/)
    expect(videoPreviewDialogSource).toMatch(/setVideoPreviewUrl\(data\.url\)/)
  })
})
