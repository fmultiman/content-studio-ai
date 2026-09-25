import { describe, expect, it } from 'vitest'
import { removeSlideFromCollection } from '@/lib/creative/authoring/slide-collection'

const slides = [{ id: 'slide-1', order: 0 }, { id: 'slide-2', order: 1 }, { id: 'slide-3', order: 2 }]

describe('authored slide collection removal', () => {
  it('removes first, middle and last while selecting the next available slide', () => {
    expect(removeSlideFromCollection(slides, 0)).toMatchObject({ selectedIndex: 0, slides: [{ id: 'slide-2', order: 0 }, { id: 'slide-3', order: 1 }] })
    expect(removeSlideFromCollection(slides, 1)).toMatchObject({ selectedIndex: 1, slides: [{ id: 'slide-1', order: 0 }, { id: 'slide-3', order: 1 }] })
    expect(removeSlideFromCollection(slides, 2)).toMatchObject({ selectedIndex: 1, slides: [{ id: 'slide-1', order: 0 }, { id: 'slide-2', order: 1 }] })
  })

  it('guards invalid indexes and the last remaining slide', () => {
    expect(removeSlideFromCollection(slides.slice(0, 1), 0)).toMatchObject({ selectedIndex: 0, slides: [{ id: 'slide-1', order: 0 }] })
    expect(removeSlideFromCollection(slides, -1)).toMatchObject({ selectedIndex: 0, slides })
  })
})
