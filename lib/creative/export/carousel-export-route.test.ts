import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('carousel export route contract', () => {
  const route = readFileSync(join(process.cwd(), 'app', 'api', 'creative', 'static-authoring', 'export', 'route.ts'), 'utf8')

  it('authorizes the ChannelPiece and reads ordered durable media', () => {
    expect(route).toContain(".from('channel_piece_media')")
    expect(route).toContain(".from('library_files')")
    expect(route).toContain(".eq('user_id', user.id)")
    expect(route).toContain(".order('position', { ascending: true })")
    expect(route).toContain('buildCarouselZip(authoredSlides.length, items)')
  })

  it('has no render or persistence path', () => {
    expect(route).not.toContain('render-executions')
    expect(route).not.toContain(".insert(")
    expect(route).not.toContain(".update(")
    expect(route).not.toContain(".upsert(")
    expect(route).toContain("'cache-control': 'no-store'")
  })
})

